import asyncio
import json
import uuid
import time
import tempfile
import os
from datetime import datetime
from typing import Dict, List, Optional, Union
from google import genai
from google.genai.types import GenerateContentConfig, Part, HttpOptions, HarmCategory, HarmBlockThreshold
from google.cloud import storage
from flask_socketio import SocketIO, emit
import threading
import queue
import io
import wave
from dotenv import load_dotenv
from google.api_core.client_options import ClientOptions
from google.api_core import retry
import google.api_core.exceptions
import base64

load_dotenv()

def upload_audio_to_gcs(audio_data: bytes, project_id: str, file_extension: str = ".wav") -> str:
    """
    Uploads audio data to Google Cloud Storage and returns the gs:// URI.
    
    Args:
        audio_data: Raw audio data as bytes
        project_id: Google Cloud Project ID
        file_extension: File extension for the audio file
        
    Returns:
        The gs:// URI of the uploaded file
    """
    # Create a unique bucket name for this project if it doesn't exist
    bucket_name = f"{project_id}-transcriber-temp"
    
    # Initialize the storage client
    storage_client = storage.Client(project=project_id)
    
    try:
        # Try to get the bucket, create if it doesn't exist
        try:
            bucket = storage_client.bucket(bucket_name)
            bucket.reload()  # Check if bucket exists
        except Exception:
            # Create bucket if it doesn't exist
            bucket = storage_client.create_bucket(bucket_name)
            print(f"Created bucket: {bucket_name}")
    except Exception as e:
        print(f"Error with bucket {bucket_name}: {e}")
        # Fallback to a more unique bucket name
        bucket_name = f"{project_id}-transcriber-{uuid.uuid4().hex[:8]}"
        bucket = storage_client.create_bucket(bucket_name)
        print(f"Created fallback bucket: {bucket_name}")
    
    # Generate a unique object name
    object_name = f"live-audio-{uuid.uuid4().hex}{file_extension}"
    
    # Upload the file
    blob = bucket.blob(object_name)
    blob.upload_from_string(audio_data)
    
    gs_uri = f"gs://{bucket_name}/{object_name}"
    print(f"Live audio uploaded to: {gs_uri}")
    
    return gs_uri

def delete_from_gcs(gs_uri: str, project_id: str):
    """
    Deletes a file from Google Cloud Storage.
    
    Args:
        gs_uri: The gs:// URI of the file to delete
        project_id: Google Cloud Project ID
    """
    try:
        # Parse the gs:// URI
        if not gs_uri.startswith("gs://"):
            return
            
        uri_parts = gs_uri[5:].split("/", 1)  # Remove gs:// and split
        bucket_name = uri_parts[0]
        object_name = uri_parts[1]
        
        storage_client = storage.Client(project=project_id)
        bucket = storage_client.bucket(bucket_name)
        blob = bucket.blob(object_name)
        blob.delete()
        
        print(f"Deleted live audio file: {gs_uri}")
    except Exception as e:
        print(f"Warning: Could not delete live audio file {gs_uri}: {e}")

class LiveTranscriptionSession:
    """Manages a live transcription session"""
    
    def __init__(self, session_id: str, owner_id: str = None):
        self.session_id = session_id
        self.owner_id = owner_id or str(uuid.uuid4())  # Generate unique owner ID if not provided
        self.created_at = datetime.now()
        self.is_active = False
        self.transcript_buffer = ""
        self.audio_queue = queue.Queue()
        self.transcript_queue = queue.Queue()
        self.processing_thread = None
        self.last_activity = datetime.now()
        self.last_owner_activity = datetime.now()  # Track owner-specific activity
        self.complete_audio_buffer = io.BytesIO()  # Store complete raw audio
        self.is_shared = False  # New: Track if session is shared
        self.title = f"Session {session_id[:8]}..."  # New: Session title for sharing
        self.owner_connected = False  # Track if owner is currently connected
        self.paused_at = None  # Track when session was paused/disconnected
        self.resume_count = 0  # Track how many times session has been resumed
        self.persisted_audio_file = None  # Track saved audio file for resumption
        self.summary = None  # Store generated summary
        self.summary_generated_at = None  # Track when summary was generated
        self.meeting_analysis = None  # Store complete meeting analysis (chapters, takeaways, notes)
        
        # Vertex AI setup
        self.project_id = os.getenv("GOOGLE_CLOUD_PROJECT")
        self.location = os.getenv("GOOGLE_CLOUD_LOCATION", "us-central1")
        
        if not self.project_id:
            raise ValueError("GOOGLE_CLOUD_PROJECT environment variable not set. Required for Vertex AI.")
        
        # Set environment variables for Vertex AI SDK integration
        os.environ["GOOGLE_CLOUD_PROJECT"] = self.project_id
        os.environ["GOOGLE_CLOUD_LOCATION"] = self.location
        os.environ["GOOGLE_GENAI_USE_VERTEXAI"] = "True"
        
        # Initialize the Vertex AI client
        self.genai_client = genai.Client(http_options=HttpOptions(api_version="v1"))
        
        # Try to restore audio from previous session if resuming
        self._try_restore_persisted_audio()
        
    def _try_restore_persisted_audio(self):
        """Try to restore persisted audio data from disk"""
        try:
            if not self.persisted_audio_file:
                # Look for any persisted audio files for this session
                audio_dir = "session_audio"
                if os.path.exists(audio_dir):
                    import glob
                    pattern = f"session_{self.session_id}_*.pcm"
                    files = glob.glob(os.path.join(audio_dir, pattern))
                    if files:
                        # Get the most recent file
                        files.sort(key=os.path.getctime)
                        latest_file = files[-1]
                        
                        with open(latest_file, 'rb') as f:
                            audio_data = f.read()
                        
                        # Clear buffer and write restored data
                        self.complete_audio_buffer = io.BytesIO()
                        self.complete_audio_buffer.write(audio_data)
                        self.persisted_audio_file = latest_file
                        
                        duration = len(audio_data) / (16000 * 2)  # 16kHz, 16-bit
                        print(f"Restored {len(audio_data)} bytes of audio data ({duration:.1f}s) from {latest_file}")
            else:
                # Restore from known persisted file
                if os.path.exists(self.persisted_audio_file):
                    with open(self.persisted_audio_file, 'rb') as f:
                        audio_data = f.read()
                    
                    # Clear buffer and write restored data
                    self.complete_audio_buffer = io.BytesIO()
                    self.complete_audio_buffer.write(audio_data)
                    
                    duration = len(audio_data) / (16000 * 2)  # 16kHz, 16-bit
                    print(f"Restored {len(audio_data)} bytes of audio data ({duration:.1f}s) from {self.persisted_audio_file}")
                    
        except Exception as e:
            print(f"Error restoring persisted audio: {e}")
    
    def _persist_audio_data(self):
        """Persist current audio data to disk for potential resumption"""
        try:
            # Get current position in buffer
            current_pos = self.complete_audio_buffer.tell()
            # Seek to beginning to get all data
            self.complete_audio_buffer.seek(0)
            audio_data = self.complete_audio_buffer.read()
            # Restore position
            self.complete_audio_buffer.seek(current_pos)
            
            if len(audio_data) == 0:
                return None
            
            # Create session audio directory
            audio_dir = "session_audio"
            os.makedirs(audio_dir, exist_ok=True)
            
            # Create filename with session ID and timestamp
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            audio_filename = f"{audio_dir}/session_{self.session_id}_{timestamp}.pcm"
            
            with open(audio_filename, 'wb') as f:
                f.write(audio_data)
            
            # Clean up old persisted files for this session (keep only the latest)
            import glob
            pattern = f"session_{self.session_id}_*.pcm"
            files = glob.glob(os.path.join(audio_dir, pattern))
            files.sort(key=os.path.getctime)
            
            # Remove all but the latest file
            for old_file in files[:-1]:
                try:
                    os.remove(old_file)
                    print(f"Cleaned up old audio file: {old_file}")
                except:
                    pass
            
            self.persisted_audio_file = audio_filename
            duration = len(audio_data) / (16000 * 2)
            print(f"Persisted {len(audio_data)} bytes of audio data ({duration:.1f}s) to {audio_filename}")
            
            return audio_filename
            
        except Exception as e:
            print(f"Error persisting audio data: {e}")
            return None
    
    def get_persisted_audio_path(self):
        """Get the path to the persisted audio file for this session"""
        return self.persisted_audio_file
    
    def get_complete_audio_for_summary(self):
        """Get complete audio data for summary generation (including persisted data)"""
        try:
            # Get current position
            current_pos = self.complete_audio_buffer.tell()
            # Seek to beginning to read all data
            self.complete_audio_buffer.seek(0)
            current_audio = self.complete_audio_buffer.read()
            # Restore position
            self.complete_audio_buffer.seek(current_pos)
            
            # If we have persisted audio and current audio, we need to combine them
            if self.persisted_audio_file and os.path.exists(self.persisted_audio_file):
                # Check if current buffer has new data beyond the persisted file
                with open(self.persisted_audio_file, 'rb') as f:
                    persisted_audio = f.read()
                
                # If current buffer is longer than persisted, there's new data
                if len(current_audio) > len(persisted_audio):
                    # Use current buffer (it includes persisted + new data)
                    return current_audio
                else:
                    # Use persisted data (current might be empty after resume)
                    return persisted_audio
            else:
                # No persisted data, use current buffer
                return current_audio
                
        except Exception as e:
            print(f"Error getting complete audio for summary: {e}")
            # Fallback to current buffer
            current_pos = self.complete_audio_buffer.tell()
            self.complete_audio_buffer.seek(0)
            data = self.complete_audio_buffer.read()
            self.complete_audio_buffer.seek(current_pos)
            return data
    
    def create_wav_file_for_summary(self):
        """Create a WAV file from complete audio data for summary generation"""
        try:
            audio_data = self.get_complete_audio_for_summary()
            if len(audio_data) == 0:
                return None
            
            # Create a proper WAV file
            audio_file = io.BytesIO()
            with wave.open(audio_file, 'wb') as wav_file:
                wav_file.setnchannels(1)  # Mono
                wav_file.setsampwidth(2)  # 16-bit
                wav_file.setframerate(16000)  # 16kHz
                wav_file.writeframes(audio_data)
            
            # Create temporary file for summary generation
            import tempfile
            with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as temp_file:
                temp_file.write(audio_file.getvalue())
                temp_file_path = temp_file.name
            
            duration = len(audio_data) / (16000 * 2)
            print(f"Created WAV file for summary: {temp_file_path} ({len(audio_data)} bytes, {duration:.1f}s)")
            
            return temp_file_path
            
        except Exception as e:
            print(f"Error creating WAV file for summary: {e}")
            return None
    
    def start_processing(self):
        """Start the audio processing thread"""
        if not self.processing_thread or not self.processing_thread.is_alive():
            self.is_active = True
            # Don't reset the buffer - keep existing audio data for continuity
            # self.complete_audio_buffer = io.BytesIO()  # REMOVED - keep existing buffer
            
            # If we're resuming and have no audio in buffer but have persisted audio, restore it
            if self.complete_audio_buffer.tell() == 0 and self.persisted_audio_file:
                self._try_restore_persisted_audio()
            
            self.processing_thread = threading.Thread(target=self._process_audio_stream)
            self.processing_thread.daemon = True
            self.processing_thread.start()
    
    def stop_processing(self):
        """Stop the audio processing"""
        self.is_active = False
        if self.processing_thread:
            self.processing_thread.join(timeout=5)
        
        # Persist audio data for potential resumption
        self._persist_audio_data()
        
        # Save complete raw recording (for debugging/backup)
        self._save_complete_raw_recording()
    
    def add_audio_chunk(self, audio_data: bytes):
        """Add audio chunk to processing queue"""
        self.last_activity = datetime.now()
        if self.is_active:
            print(f"Adding audio chunk to session {self.session_id}: {len(audio_data)} bytes")
            
            # Always seek to end before writing to ensure we append
            current_pos = self.complete_audio_buffer.tell()
            self.complete_audio_buffer.seek(0, 2)  # Seek to end
            self.complete_audio_buffer.write(audio_data)
            # Don't restore position - stay at end for next write
            
            self.audio_queue.put(audio_data)
    
    def _save_complete_raw_recording(self):
        """Save complete raw recording when session stops"""
        try:
            # Get current position
            current_pos = self.complete_audio_buffer.tell()
            # Seek to beginning to read all data
            self.complete_audio_buffer.seek(0)
            audio_data = self.complete_audio_buffer.read()
            # Restore position
            self.complete_audio_buffer.seek(current_pos)
            
            if len(audio_data) == 0:
                print("No audio data to save")
                return
            
            # Create debug directory if it doesn't exist
            debug_dir = "debug_audio"
            os.makedirs(debug_dir, exist_ok=True)
            
            # Create filename with timestamp
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            
            # Save raw PCM data
            pcm_filename = f"{debug_dir}/complete_raw_{self.session_id}_{timestamp}.pcm"
            with open(pcm_filename, 'wb') as f:
                f.write(audio_data)
            
            # Also create a proper WAV file for easier testing
            wav_filename = f"{debug_dir}/complete_raw_{self.session_id}_{timestamp}.wav"
            audio_file = io.BytesIO()
            with wave.open(audio_file, 'wb') as wav_file:
                wav_file.setnchannels(1)  # Mono
                wav_file.setsampwidth(2)  # 16-bit
                wav_file.setframerate(16000)  # 16kHz
                wav_file.writeframes(audio_data)
            
            with open(wav_filename, 'wb') as f:
                f.write(audio_file.getvalue())
            
            duration = len(audio_data) / (16000 * 2)  # 16000 Hz, 16-bit (2 bytes)
            print(f"Saved complete raw recording: {pcm_filename} and {wav_filename} ({len(audio_data)} bytes, {duration:.1f}s)")
            
        except Exception as e:
            print(f"Error saving complete raw recording: {e}")
    
    def _process_audio_stream(self):
        """Process audio chunks and generate transcriptions"""
        audio_buffer = io.BytesIO()
        
        while self.is_active:
            try:
                # Get audio chunk with timeout
                try:
                    chunk = self.audio_queue.get(timeout=1.0)
                    audio_buffer.write(chunk)
                    
                    # Process when we have enough audio (e.g., 5 seconds worth)
                    if audio_buffer.tell() >= 48000 * 2 * 5:  # 5 seconds at 16kHz, 16-bit
                        self._transcribe_buffer(audio_buffer.getvalue())
                        audio_buffer = io.BytesIO()  # Reset buffer
                        
                except queue.Empty:
                    # Process remaining buffer if we have data
                    if audio_buffer.tell() > 0:
                        self._transcribe_buffer(audio_buffer.getvalue())
                        audio_buffer = io.BytesIO()
                    continue
                    
            except Exception as e:
                print(f"Error in audio processing: {e}")
                break
    
    def _transcribe_buffer(self, audio_data: bytes):
        """Transcribe audio buffer using Vertex AI and Google Cloud Storage"""
        gs_uri = None
        try:
            print(f"Transcribing raw PCM audio buffer: {len(audio_data)} bytes")
            
            # The audio_data is now raw 16-bit PCM data from Web Audio API
            # We need to create a proper WAV file with headers
            
            # Create a properly formatted WAV file in memory
            audio_file = io.BytesIO()
            with wave.open(audio_file, 'wb') as wav_file:
                wav_file.setnchannels(1)  # Mono
                wav_file.setsampwidth(2)  # 16-bit
                wav_file.setframerate(16000)  # 16kHz
                wav_file.writeframes(audio_data)  # audio_data is already raw PCM
            
            # Get the complete WAV file data
            wav_data = audio_file.getvalue()
            
            # Upload to Google Cloud Storage
            gs_uri = upload_audio_to_gcs(wav_data, self.project_id, ".wav")
            
            print(f"Uploaded raw PCM audio to GCS: {gs_uri}")
            
            # Generate transcription using Vertex AI with improved prompt
            prompt = """Please transcribe this audio accurately. IMPORTANT RULES:
            
1. ONLY transcribe clear spoken words and sentences
2. DO NOT transcribe background noise, breathing sounds, coughing, or ambient noise
3. DO NOT transcribe if there is only silence or no clear speech
4. DO NOT transcribe unclear mumbling or inaudible sounds
5. Only return actual spoken text, no additional commentary or descriptions
6. If there is no clear speech to transcribe, return nothing (empty response)
7. Focus on meaningful spoken content only

Transcribe the audio:"""
            
            response = self.genai_client.models.generate_content(
                model="gemini-2.5-flash-preview-05-20",
                contents=[
                    prompt,
                    Part.from_uri(file_uri=gs_uri, mime_type="audio/wav")
                ],
                config=GenerateContentConfig(audio_timestamp=True),
            )
            
            # Clean up the uploaded file
            delete_from_gcs(gs_uri, self.project_id)
            
            if response.candidates and response.candidates[0].content.parts:
                transcript_chunk = response.candidates[0].content.parts[0].text.strip()
                
                # Additional filtering to avoid noise transcription
                if transcript_chunk and self._is_valid_transcription(transcript_chunk):
                    timestamp = datetime.now().strftime("%H:%M:%S")
                    
                    print(f"Transcribed: [{timestamp}] {transcript_chunk}")
                    
                    # Add to transcript buffer
                    self.transcript_buffer += f"[{timestamp}] {transcript_chunk}\n"
                    
                    # Add to transcript queue for real-time updates
                    self.transcript_queue.put({
                        'timestamp': timestamp,
                        'text': transcript_chunk,
                        'session_id': self.session_id
                    })
                else:
                    print("Skipped transcription: no valid speech content detected")
            else:
                print("No transcription result from Vertex AI")
                if response.prompt_feedback:
                    print(f"Prompt Feedback: {response.prompt_feedback}")
                if response.candidates and response.candidates[0].finish_reason:
                    print(f"Finish Reason: {response.candidates[0].finish_reason}")
            
        except Exception as e:
            print(f"Error transcribing raw PCM audio with Vertex AI: {e}")
            import traceback
            traceback.print_exc()
            # Clean up the uploaded file if it exists
            if gs_uri:
                delete_from_gcs(gs_uri, self.project_id)
    
    def _is_valid_transcription(self, text: str) -> bool:
        """Check if the transcription contains valid speech content"""
        if not text or len(text.strip()) < 1:
            return False
        
        # Filter out only obvious noise-related transcriptions
        noise_indicators = [
            '[noise]', '[sound]', '[breathing]', '[cough]', '[silence]',
            '[music]', '[background]', '[static]', '[wind]', '[click]',
            '*noise*', '*sound*', '*breathing*', '*silence*',
            'background noise', 'ambient sound', 'no speech',
            'inaudible', 'unclear', 'muffled'
        ]
        
        text_lower = text.lower().strip()
        
        # Check if text is exactly one of the noise indicators
        if text_lower in noise_indicators:
            return False
        
        # Check if text contains obvious noise indicators (full match)
        for indicator in noise_indicators:
            if text_lower == indicator or f" {indicator} " in f" {text_lower} ":
                return False
        
        # Only skip very short single characters that are clearly not words
        if len(text_lower) == 1 and text_lower in ['a', 'i', 'o', 'e', 'u']:
            return False
        
        # More permissive letter count check - allow if at least 30% letters
        if len(text) > 3:  # Only apply to longer text
            letter_count = sum(1 for c in text if c.isalpha())
            if letter_count < len(text) * 0.3:  # Less than 30% letters
                return False
        
        return True
    
    def get_transcript_updates(self):
        """Get new transcript updates"""
        updates = []
        while not self.transcript_queue.empty():
            try:
                updates.append(self.transcript_queue.get_nowait())
            except queue.Empty:
                break
        return updates
    
    def get_full_transcript(self):
        """Get the complete transcript"""
        return self.transcript_buffer
    
    def enable_sharing(self):
        """Enable sharing for this session"""
        self.is_shared = True
        self.last_activity = datetime.now()
    
    def disable_sharing(self):
        """Disable sharing for this session"""
        self.is_shared = False
        self.last_activity = datetime.now()
    
    def get_share_info(self):
        """Get sharing information for this session"""
        return {
            'session_id': self.session_id,
            'is_shared': self.is_shared,
            'is_active': self.is_active,
            'created_at': self.created_at.isoformat(),
            'title': self.title
        }
    
    def set_owner_connected(self, connected: bool):
        """Set owner connection status"""
        was_connected = self.owner_connected
        self.owner_connected = connected
        
        if connected and not was_connected:
            # Owner reconnected
            self.last_owner_activity = datetime.now()
            if self.paused_at:
                # Calculate pause duration for logging
                pause_duration = datetime.now() - self.paused_at
                print(f"Owner reconnected to session {self.session_id} after {pause_duration.total_seconds():.1f} seconds")
                self.paused_at = None
                self.resume_count += 1
        elif not connected and was_connected:
            # Owner disconnected - persist audio data for potential resumption
            self.paused_at = datetime.now()
            print(f"Owner disconnected from session {self.session_id}")
            
            # Persist current audio data
            if self.complete_audio_buffer.tell() > 0:
                self._persist_audio_data()
                print(f"Audio data persisted for potential resumption")
    
    def is_owner(self, owner_id: str) -> bool:
        """Check if the provided owner_id matches this session's owner"""
        return self.owner_id == owner_id
    
    def get_owner_info(self):
        """Get owner information for this session"""
        return {
            'owner_id': self.owner_id,
            'owner_connected': self.owner_connected,
            'last_owner_activity': self.last_owner_activity.isoformat(),
            'paused_at': self.paused_at.isoformat() if self.paused_at else None,
            'resume_count': self.resume_count
        }
    
    def can_be_resumed(self) -> bool:
        """Check if this session can be resumed (not too old, not deleted)"""
        # Allow resumption within 24 hours of last owner activity
        time_since_activity = datetime.now() - self.last_owner_activity
        return time_since_activity.total_seconds() < 86400  # 24 hours
    
    def set_summary(self, summary: str):
        """Set the summary for this session"""
        self.summary = summary
        self.summary_generated_at = datetime.now()
        self.last_activity = datetime.now()
        print(f"Summary saved for session {self.session_id}")
    
    def set_meeting_analysis(self, analysis_data: dict):
        """Set the complete meeting analysis data"""
        self.meeting_analysis = analysis_data
        # Also extract summary if provided
        if 'summary' in analysis_data:
            self.summary = analysis_data['summary']
            self.summary_generated_at = datetime.now()
        self.last_activity = datetime.now()
        print(f"Meeting analysis saved for session {self.session_id}")
    
    def set_title(self, title: str):
        """Set a custom title for this session"""
        self.title = title
        self.last_activity = datetime.now()
        print(f"Title updated for session {self.session_id}: {title}")
    
    def get_summary(self):
        """Get the summary for this session"""
        return {
            'summary': self.summary,
            'generated_at': self.summary_generated_at.isoformat() if self.summary_generated_at else None
        }
    
    def get_session_state(self):
        """Get complete session state for reconnection"""
        return {
            'session_id': self.session_id,
            'owner_id': self.owner_id,
            'created_at': self.created_at.isoformat(),
            'is_active': self.is_active,
            'is_shared': self.is_shared,
            'title': self.title,
            'owner_connected': self.owner_connected,
            'last_owner_activity': self.last_owner_activity.isoformat(),
            'paused_at': self.paused_at.isoformat() if self.paused_at else None,
            'resume_count': self.resume_count,
            'transcript': self.get_full_transcript(),
            'can_be_resumed': self.can_be_resumed(),
            'has_persisted_audio': self.persisted_audio_file is not None,
            'persisted_audio_path': self.persisted_audio_file,
            'has_summary': self.summary is not None,
            'summary_generated_at': self.summary_generated_at.isoformat() if self.summary_generated_at else None
        }

class LiveTranscriptionManager:
    """Manages multiple live transcription sessions"""
    
    def __init__(self, socketio: SocketIO):
        self.socketio = socketio
        self.sessions: Dict[str, LiveTranscriptionSession] = {}
        self.owner_sessions: Dict[str, List[str]] = {}  # Map owner_id to list of session_ids
        self.cleanup_thread = None
        self.sessions_dir = "saved_sessions"
        
        # Create directory for saved sessions
        os.makedirs(self.sessions_dir, exist_ok=True)
        
        # Load existing sessions from disk
        self._load_sessions_from_disk()
        
        self.start_cleanup_thread()
    
    def create_session(self, owner_id: str = None) -> tuple[str, str]:
        """Create a new transcription session"""
        session_id = str(uuid.uuid4())
        if not owner_id:
            owner_id = str(uuid.uuid4())
        
        session = LiveTranscriptionSession(session_id, owner_id)
        self.sessions[session_id] = session
        
        # Track owner sessions
        if owner_id not in self.owner_sessions:
            self.owner_sessions[owner_id] = []
        self.owner_sessions[owner_id].append(session_id)
        
        return session_id, owner_id
    
    def get_owner_sessions(self, owner_id: str) -> List[dict]:
        """Get all sessions for a specific owner"""
        if owner_id not in self.owner_sessions:
            return []
        
        owner_session_states = []
        for session_id in self.owner_sessions[owner_id]:
            if session_id in self.sessions:
                session = self.sessions[session_id]
                owner_session_states.append(session.get_session_state())
        
        return owner_session_states
    
    def find_resumable_session(self, owner_id: str) -> Optional[str]:
        """Find the most recent resumable session for an owner"""
        if owner_id not in self.owner_sessions:
            return None
        
        # Find the most recent session that can be resumed
        resumable_sessions = []
        for session_id in self.owner_sessions[owner_id]:
            if session_id in self.sessions:
                session = self.sessions[session_id]
                if session.can_be_resumed():
                    resumable_sessions.append((session_id, session.last_owner_activity))
        
        if resumable_sessions:
            # Return the most recently active session
            resumable_sessions.sort(key=lambda x: x[1], reverse=True)
            return resumable_sessions[0][0]
        
        return None
    
    def resume_session(self, session_id: str, owner_id: str) -> bool:
        """Resume a session for an owner"""
        if session_id not in self.sessions:
            return False
        
        session = self.sessions[session_id]
        if not session.is_owner(owner_id) or not session.can_be_resumed():
            return False
        
        session.set_owner_connected(True)
        return True
    
    def set_owner_connection_status(self, session_id: str, owner_id: str, connected: bool) -> bool:
        """Set owner connection status for a session"""
        if session_id not in self.sessions:
            return False
        
        session = self.sessions[session_id]
        if not session.is_owner(owner_id):
            return False
        
        session.set_owner_connected(connected)
        return True
    
    def get_session_state(self, session_id: str, owner_id: str = None) -> Optional[dict]:
        """Get session state (with owner verification if owner_id provided)"""
        if session_id not in self.sessions:
            return None
        
        session = self.sessions[session_id]
        if owner_id and not session.is_owner(owner_id):
            return None
        
        return session.get_session_state()
    
    def get_session_audio_for_summary(self, session_id: str, owner_id: str = None) -> Optional[str]:
        """Get complete audio data as WAV file for summary generation (owner verification)"""
        if session_id not in self.sessions:
            return None
        
        session = self.sessions[session_id]
        if owner_id and not session.is_owner(owner_id):
            return None
        
        # For saved sessions, check if we have a persisted WAV file
        if session.persisted_audio_file and session.persisted_audio_file.endswith('.wav') and os.path.exists(session.persisted_audio_file):
            print(f"Using persisted WAV file for session {session_id}: {session.persisted_audio_file}")
            return session.persisted_audio_file
        
        # Otherwise, create a WAV file from the audio data (PCM or buffer)
        # This handles both PCM files and in-memory buffers
        return session.create_wav_file_for_summary()
    
    def get_session_audio_duration(self, session_id: str, owner_id: str = None) -> Optional[float]:
        """Get the duration of audio for a session"""
        if session_id not in self.sessions:
            return None
        
        session = self.sessions[session_id]
        
        # Verify owner if provided
        if owner_id and not session.is_owner(owner_id):
            return None
        
        audio_data = session.get_complete_audio_for_summary()
        if audio_data:
            # Calculate duration: 16kHz, 16-bit (2 bytes per sample)
            duration = len(audio_data) / (16000 * 2)
            return duration
        
        return 0.0
    
    def save_session_summary(self, session_id: str, summary: str, owner_id: str = None) -> bool:
        """Save a summary for a session"""
        if session_id not in self.sessions:
            return False
        
        session = self.sessions[session_id]
        
        # Verify owner if provided
        if owner_id and not session.is_owner(owner_id):
            return False
        
        session.set_summary(summary)
        
        # Also update the title to something more meaningful
        # Extract first meaningful sentence from summary for title
        first_sentence = summary.split('.')[0] if '.' in summary else summary[:100]
        if len(first_sentence) > 50:
            first_sentence = first_sentence[:47] + '...'
        session.set_title(f"Session: {first_sentence}")
        
        # Save session to disk since it now has a summary
        self._save_session_to_disk(session_id)
        
        return True
    
    def save_meeting_analysis(self, session_id: str, analysis_data: dict, owner_id: str = None) -> bool:
        """Save complete meeting analysis for a session"""
        if session_id not in self.sessions:
            return False
        
        session = self.sessions[session_id]
        
        # Verify owner if provided
        if owner_id and not session.is_owner(owner_id):
            return False
        
        session.set_meeting_analysis(analysis_data)
        
        # Update title from summary
        if 'summary' in analysis_data:
            first_sentence = analysis_data['summary'].split('.')[0] if '.' in analysis_data['summary'] else analysis_data['summary'][:100]
            if len(first_sentence) > 50:
                first_sentence = first_sentence[:47] + '...'
            session.set_title(f"{first_sentence}")
        
        # All transcripts with analysis are public by default
        # No need to explicitly enable sharing
        
        # Save session to disk
        self._save_session_to_disk(session_id)
        
        return True
    
    def get_session_summary(self, session_id: str) -> Optional[dict]:
        """Get the summary for a session (accessible via share link)"""
        if session_id not in self.sessions:
            return None
        
        session = self.sessions[session_id]
        
        # Only return summary if session is shared
        if not session.is_shared:
            return None
        
        return session.get_summary()
    
    def get_meeting_analysis(self, session_id: str, owner_id: str = None) -> Optional[dict]:
        """Get complete meeting analysis for a session"""
        if session_id not in self.sessions:
            return None
        
        session = self.sessions[session_id]
        
        # Allow viewing any session that has meeting analysis
        # This makes all analyzed transcripts publicly viewable
        if session.meeting_analysis:
            return session.meeting_analysis
        
        return None
    
    def get_all_transcripts(self, owner_id: str = None) -> List[dict]:
        """Get all available transcripts"""
        transcripts = []
        
        for session_id, session in self.sessions.items():
            # Include all transcripts that have meeting analysis
            # This makes the transcript library truly public
            if session.meeting_analysis:
                # Include basic info about each transcript
                transcript_info = {
                    'session_id': session_id,
                    'title': session.title,
                    'created_at': session.created_at.isoformat(),
                    'last_activity': session.last_activity.isoformat(),
                    'is_active': session.is_active,
                    'is_shared': True,  # Always show as shared for UI consistency
                    'has_summary': session.summary is not None,
                    'summary_generated_at': session.summary_generated_at.isoformat() if session.summary_generated_at else None,
                    'owner_id': session.owner_id if owner_id and session.is_owner(owner_id) else None,  # Only include owner_id for owned sessions
                    'is_owner': session.is_owner(owner_id) if owner_id else False,  # Add flag to indicate ownership
                    'duration': self.get_session_audio_duration(session_id),
                    'has_audio': os.path.exists(f"saved_sessions/{session_id}.wav") if session.summary else False
                }
                
                transcripts.append(transcript_info)
        
        # Sort by last activity, most recent first
        transcripts.sort(key=lambda x: x['last_activity'], reverse=True)
        
        return transcripts
    
    def start_session(self, session_id: str) -> bool:
        """Start a transcription session"""
        if session_id in self.sessions:
            session = self.sessions[session_id]
            session.start_processing()
            return True
        return False
    
    def stop_session(self, session_id: str) -> bool:
        """Stop a transcription session"""
        if session_id in self.sessions:
            session = self.sessions[session_id]
            session.stop_processing()
            return True
        return False
    
    def add_audio_to_session(self, session_id: str, audio_data: bytes) -> bool:
        """Add audio data to a session"""
        if session_id in self.sessions:
            session = self.sessions[session_id]
            session.add_audio_chunk(audio_data)
            return True
        return False
    
    def get_session_transcript(self, session_id: str) -> Optional[str]:
        """Get the full transcript for a session"""
        if session_id in self.sessions:
            return self.sessions[session_id].get_full_transcript()
        return None
    
    def delete_session(self, session_id: str) -> bool:
        """Delete or end a session"""
        if session_id in self.sessions:
            session = self.sessions[session_id]
            session.stop_processing()
            
            # If session has a summary, mark it as ended instead of deleting
            if session.summary is not None:
                session.is_active = False
                session.owner_connected = False
                session.last_activity = datetime.now()
                print(f"Session {session_id} ended but preserved (has summary)")
                return True
            else:
                # Only delete sessions without summaries
                del self.sessions[session_id]
                
                # Remove from owner sessions mapping
                if session.owner_id in self.owner_sessions:
                    try:
                        self.owner_sessions[session.owner_id].remove(session_id)
                        if not self.owner_sessions[session.owner_id]:  # Remove empty list
                            del self.owner_sessions[session.owner_id]
                    except ValueError:
                        pass  # Session already removed
                
                print(f"Session {session_id} deleted (no summary)")
                return True
        return False
    
    def enable_sharing(self, session_id: str) -> bool:
        """Enable sharing for a session"""
        if session_id in self.sessions:
            session = self.sessions[session_id]
            session.enable_sharing()
            return True
        return False
    
    def disable_sharing(self, session_id: str) -> bool:
        """Disable sharing for a session"""
        if session_id in self.sessions:
            session = self.sessions[session_id]
            session.disable_sharing()
            return True
        return False
    
    def get_share_info(self, session_id: str) -> Optional[dict]:
        """Get sharing info for a session"""
        if session_id in self.sessions:
            return self.sessions[session_id].get_share_info()
        return None
    
    def get_shared_session_info(self, session_id: str) -> Optional[dict]:
        """Get public info for a shared session (for viewers)"""
        if session_id in self.sessions:
            session = self.sessions[session_id]
            if session.is_shared:
                return session.get_share_info()
        return None
    
    def get_shared_session_transcript(self, session_id: str) -> Optional[str]:
        """Get transcript for a shared session (for viewers)"""
        if session_id in self.sessions:
            session = self.sessions[session_id]
            if session.is_shared:
                return session.get_full_transcript()
        return None
    
    def start_cleanup_thread(self):
        """Start the cleanup thread for inactive sessions"""
        if not self.cleanup_thread or not self.cleanup_thread.is_alive():
            self.cleanup_thread = threading.Thread(target=self._cleanup_inactive_sessions)
            self.cleanup_thread.daemon = True
            self.cleanup_thread.start()
    
    def _cleanup_inactive_sessions(self):
        """Clean up inactive sessions periodically"""
        while True:
            try:
                current_time = datetime.now()
                sessions_to_delete = []
                
                for session_id, session in self.sessions.items():
                    # Only delete sessions inactive for more than 24 hours AND has no summary, OR
                    # sessions that have been inactive for 1 hour AND owner hasn't been active for 6 hours AND has no summary
                    session_inactive_time = (current_time - session.last_activity).total_seconds()
                    owner_inactive_time = (current_time - session.last_owner_activity).total_seconds()
                    
                    # Delete if:
                    # 1. Session has been inactive for more than 24 hours AND has no summary, OR
                    # 2. Session inactive for 1+ hours AND owner inactive for 6+ hours AND session not resumable AND has no summary
                    should_delete = (
                        session.summary is None and (  # Only delete if no summary
                            session_inactive_time > 86400 or  # 24 hours
                            (session_inactive_time > 3600 and owner_inactive_time > 21600 and not session.can_be_resumed())  # 1 hour + 6 hours
                        )
                    )
                    
                    if should_delete:
                        sessions_to_delete.append(session_id)
                
                for session_id in sessions_to_delete:
                    # Also remove from owner sessions mapping
                    session = self.sessions.get(session_id)
                    if session and session.owner_id in self.owner_sessions:
                        try:
                            self.owner_sessions[session.owner_id].remove(session_id)
                            if not self.owner_sessions[session.owner_id]:  # Remove empty list
                                del self.owner_sessions[session.owner_id]
                        except ValueError:
                            pass  # Session already removed
                    
                    self.delete_session(session_id)
                    # Also delete from disk if it exists
                    self._delete_session_from_disk(session_id)
                    print(f"Cleaned up inactive session: {session_id}")
                
                # Check every 30 minutes (increased from 5 minutes to be less aggressive)
                time.sleep(1800)
                
            except Exception as e:
                print(f"Error in cleanup thread: {e}")
                time.sleep(1800)
    
    def broadcast_transcript_updates(self):
        """Broadcast transcript updates to connected clients"""
        for session_id, session in self.sessions.items():
            updates = session.get_transcript_updates()
            if updates:
                self.socketio.emit('transcript_update', {
                    'session_id': session_id,
                    'updates': updates
                }, room=f"session_{session_id}")
    
    def _save_session_to_disk(self, session_id: str):
        """Save a session to disk as JSON with audio file"""
        try:
            if session_id not in self.sessions:
                return
            
            session = self.sessions[session_id]
            
            # Only save sessions with summaries
            if session.summary is None:
                return
            
            # Create sessions directory if it doesn't exist
            sessions_dir = "saved_sessions"
            os.makedirs(sessions_dir, exist_ok=True)
            
            # Save audio file if available
            audio_file_path = None
            audio_duration = 0
            
            try:
                # Get complete audio data
                audio_data = session.get_complete_audio_for_summary()
                if audio_data and len(audio_data) > 0:
                    # Save as WAV file
                    audio_file_path = os.path.join(sessions_dir, f"{session_id}.wav")
                    
                    # Create WAV file
                    with wave.open(audio_file_path, 'wb') as wav_file:
                        wav_file.setnchannels(1)  # Mono
                        wav_file.setsampwidth(2)  # 16-bit
                        wav_file.setframerate(16000)  # 16kHz
                        wav_file.writeframes(audio_data)
                    
                    # Calculate duration
                    audio_duration = len(audio_data) / (16000 * 2)  # 16kHz, 16-bit
                    print(f"Saved audio file: {audio_file_path} ({audio_duration:.1f}s)")
            except Exception as e:
                print(f"Error saving audio file: {e}")
            
            # Prepare session data for JSON serialization
            session_data = {
                'session_id': session.session_id,
                'owner_id': session.owner_id,
                'created_at': session.created_at.isoformat(),
                'last_activity': session.last_activity.isoformat(),
                'last_owner_activity': session.last_owner_activity.isoformat(),
                'is_active': session.is_active,
                'is_shared': session.is_shared,
                'title': session.title,
                'transcript': session.transcript_buffer,
                'summary': session.summary,
                'summary_generated_at': session.summary_generated_at.isoformat() if session.summary_generated_at else None,
                'meeting_analysis': session.meeting_analysis,  # Complete analysis data
                'resume_count': session.resume_count,
                'audio_file': f"{session_id}.wav" if audio_file_path else None,
                'audio_duration': audio_duration
            }
            
            # Save to JSON file
            session_file = os.path.join(sessions_dir, f"{session_id}.json")
            with open(session_file, 'w', encoding='utf-8') as f:
                json.dump(session_data, f, ensure_ascii=False, indent=2)
            
            print(f"Session {session_id} saved to disk: {session_file}")
            
        except Exception as e:
            print(f"Error saving session {session_id} to disk: {e}")
    
    def _load_sessions_from_disk(self):
        """Load saved sessions from disk"""
        try:
            sessions_dir = "saved_sessions"
            if not os.path.exists(sessions_dir):
                return
            
            # Load all JSON files
            import glob
            session_files = glob.glob(os.path.join(sessions_dir, "*.json"))
            
            for session_file in session_files:
                try:
                    with open(session_file, 'r', encoding='utf-8') as f:
                        session_data = json.load(f)
                    
                    # Recreate session
                    session_id = session_data['session_id']
                    owner_id = session_data['owner_id']
                    
                    # Create new session instance
                    session = LiveTranscriptionSession(session_id, owner_id)
                    
                    # Restore session state
                    session.created_at = datetime.fromisoformat(session_data['created_at'])
                    session.last_activity = datetime.fromisoformat(session_data['last_activity'])
                    session.last_owner_activity = datetime.fromisoformat(session_data['last_owner_activity'])
                    session.is_active = session_data.get('is_active', False)
                    session.is_shared = session_data.get('is_shared', False)
                    session.title = session_data.get('title', f"Session {session_id[:8]}...")
                    session.transcript_buffer = session_data.get('transcript', '')
                    session.summary = session_data.get('summary')
                    session.summary_generated_at = datetime.fromisoformat(session_data['summary_generated_at']) if session_data.get('summary_generated_at') else None
                    session.meeting_analysis = session_data.get('meeting_analysis')  # Restore complete analysis
                    session.resume_count = session_data.get('resume_count', 0)
                    
                    # All transcripts with analysis are public by default
                    # No need to fix sharing status
                    
                    # Handle audio file reference
                    audio_file = session_data.get('audio_file')
                    if audio_file:
                        audio_file_path = os.path.join(sessions_dir, audio_file)
                        if os.path.exists(audio_file_path):
                            # Don't load the audio into memory, just keep the reference
                            session.persisted_audio_file = audio_file_path
                    
                    # Mark as not connected since we're loading from disk
                    session.owner_connected = False
                    session.paused_at = datetime.now()
                    
                    # Add to sessions
                    self.sessions[session_id] = session
                    
                    # Track owner sessions
                    if owner_id not in self.owner_sessions:
                        self.owner_sessions[owner_id] = []
                    self.owner_sessions[owner_id].append(session_id)
                    
                    print(f"Loaded session {session_id} from disk")
                    
                except Exception as e:
                    print(f"Error loading session from {session_file}: {e}")
            
            print(f"Loaded {len(session_files)} sessions from disk")
            
        except Exception as e:
            print(f"Error loading sessions from disk: {e}")
    
    def _delete_session_from_disk(self, session_id: str):
        """Delete a session from disk"""
        try:
            sessions_dir = "saved_sessions"
            
            # Delete JSON file
            session_file = os.path.join(sessions_dir, f"{session_id}.json")
            if os.path.exists(session_file):
                os.remove(session_file)
                print(f"Deleted session JSON {session_id} from disk")
            
            # Delete audio file
            audio_file = os.path.join(sessions_dir, f"{session_id}.wav")
            if os.path.exists(audio_file):
                os.remove(audio_file)
                print(f"Deleted session audio {session_id} from disk")
                
        except Exception as e:
            print(f"Error deleting session {session_id} from disk: {e}") 