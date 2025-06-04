import asyncio
import json
import uuid
import time
import tempfile
import os
from datetime import datetime
from typing import Dict, List, Optional
from google import genai
from google.genai.types import GenerateContentConfig, Part, HttpOptions
from google.cloud import storage
from flask_socketio import SocketIO, emit
import threading
import queue
import io
import wave
from dotenv import load_dotenv

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
    
    def __init__(self, session_id: str):
        self.session_id = session_id
        self.created_at = datetime.now()
        self.is_active = False
        self.transcript_buffer = ""
        self.audio_queue = queue.Queue()
        self.transcript_queue = queue.Queue()
        self.processing_thread = None
        self.last_activity = datetime.now()
        self.complete_audio_buffer = io.BytesIO()  # Store complete raw audio
        self.is_shared = False  # New: Track if session is shared
        self.title = f"Session {session_id[:8]}..."  # New: Session title for sharing
        
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
        
    def start_processing(self):
        """Start the audio processing thread"""
        if not self.processing_thread or not self.processing_thread.is_alive():
            self.is_active = True
            self.complete_audio_buffer = io.BytesIO()  # Reset buffer
            self.processing_thread = threading.Thread(target=self._process_audio_stream)
            self.processing_thread.daemon = True
            self.processing_thread.start()
    
    def stop_processing(self):
        """Stop the audio processing"""
        self.is_active = False
        if self.processing_thread:
            self.processing_thread.join(timeout=5)
        
        # Save complete raw recording
        self._save_complete_raw_recording()
    
    def add_audio_chunk(self, audio_data: bytes):
        """Add audio chunk to processing queue"""
        self.last_activity = datetime.now()
        if self.is_active:
            print(f"Adding audio chunk to session {self.session_id}: {len(audio_data)} bytes")
            
            # Add to complete buffer
            self.complete_audio_buffer.write(audio_data)
            
            self.audio_queue.put(audio_data)
    
    def _save_complete_raw_recording(self):
        """Save complete raw recording when session stops"""
        try:
            audio_data = self.complete_audio_buffer.getvalue()
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
                    
                    # Process when we have enough audio (e.g., 3 seconds worth)
                    if audio_buffer.tell() >= 48000 * 2 * 3:  # 3 seconds at 16kHz, 16-bit
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
            'is_shared': self.is_shared,
            'created_at': self.created_at.isoformat(),
            'is_active': self.is_active,
            'title': self.title
        }

class LiveTranscriptionManager:
    """Manages multiple live transcription sessions"""
    
    def __init__(self, socketio: SocketIO):
        self.socketio = socketio
        self.sessions: Dict[str, LiveTranscriptionSession] = {}
        self.cleanup_thread = None
        self.start_cleanup_thread()
    
    def create_session(self) -> str:
        """Create a new transcription session"""
        session_id = str(uuid.uuid4())
        session = LiveTranscriptionSession(session_id)
        self.sessions[session_id] = session
        return session_id
    
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
        """Delete a session"""
        if session_id in self.sessions:
            session = self.sessions[session_id]
            session.stop_processing()
            del self.sessions[session_id]
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
                    # Delete sessions inactive for more than 1 hour
                    if (current_time - session.last_activity).seconds > 3600:
                        sessions_to_delete.append(session_id)
                
                for session_id in sessions_to_delete:
                    self.delete_session(session_id)
                    print(f"Cleaned up inactive session: {session_id}")
                
                # Check every 5 minutes
                time.sleep(300)
                
            except Exception as e:
                print(f"Error in cleanup thread: {e}")
                time.sleep(300)
    
    def broadcast_transcript_updates(self):
        """Broadcast transcript updates to connected clients"""
        for session_id, session in self.sessions.items():
            updates = session.get_transcript_updates()
            if updates:
                self.socketio.emit('transcript_update', {
                    'session_id': session_id,
                    'updates': updates
                }, room=f"session_{session_id}") 