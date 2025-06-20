from flask import Flask, request, jsonify
from flask_cors import CORS
from flask_socketio import SocketIO, emit, join_room, leave_room
import threading
import time
import os
import tempfile
import uuid
from dotenv import load_dotenv
import google.generativeai as genai
from werkzeug.utils import secure_filename
from langchain.memory import ConversationBufferMemory

# Import project modules
from live_transcription import LiveTranscriptionManager
from transcription import transcribe_audio
from llm_utils import (
    generate_meeting_takeaways,
    generate_meeting_summary,
    generate_meeting_notes,
    get_chat_response
)

# Load environment variables
load_dotenv()

# Configure Gemini
genai.configure(api_key=os.environ.get("GOOGLE_API_KEY"))

# Create Flask app with SocketIO
app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'your-secret-key-here')

# Configure CORS properly
CORS(app, origins=["http://localhost:4200"], supports_credentials=True)

# Initialize SocketIO with better configuration
socketio = SocketIO(
    app, 
    cors_allowed_origins=["http://localhost:4200"], 
    async_mode='threading',
    logger=False,  # Disable verbose logging to reduce noise
    engineio_logger=False,  # Disable engine.io logging
    ping_timeout=30,  # Reduce ping timeout
    ping_interval=10,  # More frequent pings
    max_http_buffer_size=1e6,  # 1MB buffer
    transports=['polling', 'websocket'],  # Try polling first
    allow_upgrades=True,
    always_connect=False,
    manage_session=False  # Let client manage sessions
)

# Initialize live transcription manager
transcription_manager = LiveTranscriptionManager(socketio)

# Store memory sessions per meeting (for chat functionality)
meeting_sessions = {}

# Helper functions for meeting analysis
SUPPORTED_AUDIO_TYPES = {
    "audio/mpeg": "mp3",
    "audio/wav": "wav",
    "audio/mp4": "m4a",
    "audio/x-m4a": "m4a",
    "audio/flac": "flac",
    "audio/aac": "aac",
    "audio/ogg": "ogg",
    "audio/opus": "opus",
    "audio/webm": "webm",
}

def get_mime_type(file_name: str, uploaded_file_type: str) -> str:
    """Determines the MIME type, prioritizing the file type, then extension."""
    if uploaded_file_type and uploaded_file_type in SUPPORTED_AUDIO_TYPES:
        return uploaded_file_type
    
    ext = os.path.splitext(file_name)[1].lower()
    mime_map = {
        ".mp3": "audio/mpeg",
        ".wav": "audio/wav",
        ".m4a": "audio/mp4",
        ".flac": "audio/flac",
        ".aac": "audio/aac",
        ".ogg": "audio/ogg",
        ".opus": "audio/opus",
        ".webm": "audio/webm"
    }
    
    return mime_map.get(ext, "audio/mpeg")

def parse_chapter_transcript(transcript: str) -> list:
    """Parses a chapter-based transcript into sections."""
    if not transcript or transcript.startswith("Error:"):
        return []
    
    chapters = []
    current_chapter = None
    current_content = []
    
    lines = transcript.split('\n')
    
    for line in lines:
        line = line.strip()
        if line.startswith('CHAPTER:'):
            # Save previous chapter if exists
            if current_chapter:
                chapters.append({
                    'title': current_chapter['title'],
                    'time_range': current_chapter['time_range'],
                    'content': '\n'.join(current_content).strip()
                })
            
            # Parse new chapter
            chapter_line = line[8:].strip()
            
            if '(' in chapter_line and ')' in chapter_line:
                title = chapter_line[:chapter_line.rfind('(')].strip()
                time_range = chapter_line[chapter_line.rfind('('):].strip('()')
            else:
                title = chapter_line
                time_range = "Time not specified"
            
            current_chapter = {
                'title': title,
                'time_range': time_range
            }
            current_content = []
        else:
            if line:
                current_content.append(line)
    
    # Add the last chapter
    if current_chapter:
        chapters.append({
            'title': current_chapter['title'],
            'time_range': current_chapter['time_range'],
            'content': '\n'.join(current_content).strip()
        })
    
    # If no chapters were found, treat the entire transcript as one chapter
    if not chapters and transcript:
        chapters.append({
            'title': "Full Meeting Transcript",
            'time_range': "Complete Duration",
            'content': transcript.strip()
        })
    
    return chapters

# Add error handling middleware
@app.errorhandler(Exception)
def handle_exception(e):
    """Handle uncaught exceptions"""
    print(f"Unhandled exception: {e}")
    import traceback
    traceback.print_exc()
    return jsonify({'error': 'Internal server error', 'message': str(e)}), 500

# Add connection timeout handling
@socketio.on_error()
def error_handler(e):
    """Handle socket errors"""
    try:
        print(f'Socket error occurred: {e}')
        # Don't emit errors here as it might cause more issues
    except Exception as handler_error:
        print(f'Error in error handler: {handler_error}')

# Start the update broadcasting thread
def broadcast_updates():
    """Periodically broadcast transcript updates"""
    while True:
        try:
            transcription_manager.broadcast_transcript_updates()
            time.sleep(1)  # Broadcast every second
        except Exception as e:
            print(f"Error broadcasting updates: {e}")
            time.sleep(5)  # Wait longer on error to avoid spam

# Start broadcast thread with proper error handling
try:
    broadcast_thread = threading.Thread(target=broadcast_updates)
    broadcast_thread.daemon = True
    broadcast_thread.start()
    print("Broadcast thread started successfully")
except Exception as e:
    print(f"Failed to start broadcast thread: {e}")

# =============================================================================
# REST API Endpoints
# =============================================================================

@app.route('/api/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    try:
        return jsonify({
            'status': 'healthy', 
            'services': ['live-transcription', 'meeting-analyzer']
        }), 200
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 500

# Live Transcription API Endpoints
@app.route('/api/sessions', methods=['POST'])
def create_session():
    """Create a new live transcription session"""
    try:
        session_id = transcription_manager.create_session()
        return jsonify({
            'success': True,
            'session_id': session_id,
            'message': 'Session created successfully'
        }), 200
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/api/sessions/<session_id>/share', methods=['POST'])
def enable_session_sharing(session_id):
    """Enable sharing for a session"""
    try:
        success = transcription_manager.enable_sharing(session_id)
        if success:
            # Broadcast session status update to all clients in the session room
            from datetime import datetime
            share_info = transcription_manager.get_share_info(session_id)
            socketio.emit('session_status_update', {
                'session_id': session_id,
                'is_active': share_info.get('is_active', False) if share_info else False,
                'is_shared': True,
                'status': 'sharing_enabled',
                'timestamp': datetime.now().isoformat()
            }, room=f"session_{session_id}")
            
            return jsonify({
                'success': True,
                'session_id': session_id,
                'share_url': f'/shared/{session_id}',
                'message': 'Session sharing enabled'
            }), 200
        else:
            return jsonify({
                'success': False,
                'error': 'Session not found'
            }), 404
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/api/sessions/<session_id>/share', methods=['DELETE'])
def disable_session_sharing(session_id):
    """Disable sharing for a session"""
    try:
        success = transcription_manager.disable_sharing(session_id)
        if success:
            # Broadcast session status update to all clients in the session room
            from datetime import datetime
            share_info = transcription_manager.get_share_info(session_id)
            socketio.emit('session_status_update', {
                'session_id': session_id,
                'is_active': share_info.get('is_active', False) if share_info else False,
                'is_shared': False,
                'status': 'sharing_disabled',
                'timestamp': datetime.now().isoformat()
            }, room=f"session_{session_id}")
            
            return jsonify({
                'success': True,
                'message': 'Session sharing disabled'
            }), 200
        else:
            return jsonify({
                'success': False,
                'error': 'Session not found'
            }), 404
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/api/sessions/<session_id>/share', methods=['GET'])
def get_session_share_info(session_id):
    """Get sharing info for a session"""
    try:
        info = transcription_manager.get_share_info(session_id)
        if info:
            return jsonify({
                'success': True,
                'session_id': session_id,
                'is_shared': info['is_shared'],
                'share_url': f'/shared/{session_id}' if info['is_shared'] else None,
                'created_at': info.get('created_at'),
                'is_active': info.get('is_active', False)
            }), 200
        else:
            return jsonify({
                'success': False,
                'error': 'Session not found'
            }), 404
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/api/shared/<session_id>/info', methods=['GET'])
def get_shared_session_info(session_id):
    """Get public info for a shared session (for viewers)"""
    try:
        info = transcription_manager.get_shared_session_info(session_id)
        if info:
            return jsonify({
                'success': True,
                'session_id': session_id,
                'is_shared': info['is_shared'],
                'created_at': info.get('created_at'),
                'is_active': info.get('is_active', False),
                'title': info.get('title', f'Session {session_id[:8]}...')
            }), 200
        else:
            return jsonify({
                'success': False,
                'error': 'Session not found or not shared'
            }), 404
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/api/shared/<session_id>/transcript', methods=['GET'])
def get_shared_session_transcript(session_id):
    """Get transcript for a shared session (for viewers)"""
    try:
        transcript = transcription_manager.get_shared_session_transcript(session_id)
        if transcript is not None:
            return jsonify({
                'success': True,
                'session_id': session_id,
                'transcript': transcript
            }), 200
        else:
            return jsonify({
                'success': False,
                'error': 'Session not found or not shared'
            }), 404
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/api/sessions/<session_id>', methods=['DELETE'])
def delete_session(session_id):
    """Delete a transcription session"""
    try:
        # Get session info before deletion for broadcasting
        share_info = transcription_manager.get_share_info(session_id)
        
        success = transcription_manager.delete_session(session_id)
        if success:
            # Broadcast session status update to all clients in the session room before deletion
            from datetime import datetime
            socketio.emit('session_status_update', {
                'session_id': session_id,
                'is_active': False,
                'is_shared': share_info.get('is_shared', False) if share_info else False,
                'status': 'ended',
                'timestamp': datetime.now().isoformat()
            }, room=f"session_{session_id}")
            
            return jsonify({
                'success': True,
                'message': 'Session deleted successfully'
            }), 200
        else:
            return jsonify({
                'success': False,
                'error': 'Session not found'
            }), 404
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/api/sessions/<session_id>/transcript', methods=['GET'])
def get_session_transcript(session_id):
    """Get the full transcript for a session"""
    try:
        transcript = transcription_manager.get_session_transcript(session_id)
        if transcript is not None:
            return jsonify({
                'success': True,
                'session_id': session_id,
                'transcript': transcript
            }), 200
        else:
            return jsonify({
                'success': False,
                'error': 'Session not found'
            }), 404
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/api/sessions/<session_id>/start', methods=['POST'])
def start_session(session_id):
    """Start a transcription session"""
    try:
        success = transcription_manager.start_session(session_id)
        if success:
            # Broadcast session status update to all clients in the session room
            from datetime import datetime
            share_info = transcription_manager.get_share_info(session_id)
            socketio.emit('session_status_update', {
                'session_id': session_id,
                'is_active': True,
                'is_shared': share_info.get('is_shared', False) if share_info else False,
                'status': 'started',
                'timestamp': datetime.now().isoformat()
            }, room=f"session_{session_id}")
            
            return jsonify({
                'success': True,
                'message': 'Session started successfully'
            }), 200
        else:
            return jsonify({
                'success': False,
                'error': 'Session not found'
            }), 404
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/api/sessions/<session_id>/stop', methods=['POST'])
def stop_session(session_id):
    """Stop a transcription session"""
    try:
        success = transcription_manager.stop_session(session_id)
        if success:
            # Broadcast session status update to all clients in the session room
            from datetime import datetime
            share_info = transcription_manager.get_share_info(session_id)
            socketio.emit('session_status_update', {
                'session_id': session_id,
                'is_active': False,
                'is_shared': share_info.get('is_shared', False) if share_info else False,
                'status': 'stopped',
                'timestamp': datetime.now().isoformat()
            }, room=f"session_{session_id}")
            
            return jsonify({
                'success': True,
                'message': 'Session stopped successfully'
            }), 200
        else:
            return jsonify({
                'success': False,
                'error': 'Session not found'
            }), 404
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

# Meeting Analysis API Endpoints
@app.route('/api/transcribe', methods=['POST'])
def transcribe_endpoint():
    """Endpoint for transcribing audio files"""
    try:
        if 'audio' not in request.files:
            return jsonify({'error': 'No audio file provided'}), 400
        
        audio_file = request.files['audio']
        if audio_file.filename == '':
            return jsonify({'error': 'No file selected'}), 400
        
        # Secure the filename
        filename = secure_filename(audio_file.filename)
        
        # Save uploaded file temporarily
        with tempfile.NamedTemporaryFile(delete=False, suffix=os.path.splitext(filename)[1]) as tmp_file:
            audio_file.save(tmp_file.name)
            tmp_file_path = tmp_file.name
        
        # Get MIME type
        mime_type = get_mime_type(filename, audio_file.content_type)
        
        # Transcribe
        transcript = transcribe_audio(tmp_file_path, mime_type)
        os.remove(tmp_file_path)
        
        if transcript and not transcript.startswith("Error:"):
            # Generate meeting analysis
            takeaways = generate_meeting_takeaways(transcript)
            summary = generate_meeting_summary(transcript)
            notes = generate_meeting_notes(transcript)
            
            # Parse chapters
            chapters = parse_chapter_transcript(transcript)
            
            # Create a session ID for this meeting
            session_id = str(uuid.uuid4())
            meeting_sessions[session_id] = {
                'transcript': transcript,
                'memory': ConversationBufferMemory(memory_key="chat_history", return_messages=True),
                'chat_history': []
            }
            
            return jsonify({
                'success': True,
                'session_id': session_id,
                'transcript': transcript,
                'chapters': chapters,
                'takeaways': takeaways,
                'summary': summary,
                'notes': notes,
                'filename': filename
            })
        else:
            return jsonify({'error': transcript or 'Transcription failed'}), 500
            
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/chat', methods=['POST'])
def chat_endpoint():
    """Endpoint for chatting about the meeting"""
    try:
        data = request.get_json()
        session_id = data.get('session_id')
        question = data.get('question')
        
        if not session_id or session_id not in meeting_sessions:
            return jsonify({'error': 'Invalid session ID'}), 400
        
        if not question:
            return jsonify({'error': 'No question provided'}), 400
        
        session = meeting_sessions[session_id]
        
        # Get chat response
        response = get_chat_response(
            transcript=session['transcript'],
            user_question=question,
            memory=session['memory']
        )
        
        # Store chat history
        session['chat_history'].append({
            'role': 'user',
            'content': question
        })
        session['chat_history'].append({
            'role': 'assistant',
            'content': response
        })
        
        return jsonify({
            'success': True,
            'response': response
        })
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/chat/history/<session_id>', methods=['GET'])
def get_chat_history(session_id):
    """Get chat history for a session"""
    try:
        if session_id not in meeting_sessions:
            return jsonify({'error': 'Invalid session ID'}), 400
        
        return jsonify({
            'success': True,
            'history': meeting_sessions[session_id]['chat_history']
        })
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/search', methods=['POST'])
def search_endpoint():
    """Endpoint for searching within transcript"""
    try:
        data = request.get_json()
        session_id = data.get('session_id')
        search_term = data.get('search_term', '').lower()
        
        if not session_id or session_id not in meeting_sessions:
            return jsonify({'error': 'Invalid session ID'}), 400
        
        transcript = meeting_sessions[session_id]['transcript']
        chapters = parse_chapter_transcript(transcript)
        
        if search_term:
            filtered_chapters = []
            for chapter in chapters:
                if (search_term in chapter['title'].lower() or 
                    search_term in chapter['content'].lower()):
                    
                    # Highlight search terms
                    highlighted_chapter = {
                        'title': chapter['title'],
                        'time_range': chapter['time_range'],
                        'content': chapter['content'],
                        'contains_search_term': True
                    }
                    filtered_chapters.append(highlighted_chapter)
                    
            return jsonify({
                'success': True,
                'chapters': filtered_chapters,
                'total_found': len(filtered_chapters)
            })
        else:
            return jsonify({
                'success': True,
                'chapters': chapters,
                'total_found': len(chapters)
            })
            
    except Exception as e:
        return jsonify({'error': str(e)}), 500

# =============================================================================
# SocketIO Event Handlers
# =============================================================================

@socketio.on('connect')
def handle_connect():
    """Handle client connection"""
    try:
        client_id = getattr(request, 'sid', 'unknown')
        print(f'Client connected: {client_id}')
        emit('connected', {'message': 'Connected to unified transcription server'})
    except Exception as e:
        print(f'Error in connect handler: {e}')

@socketio.on('disconnect')
def handle_disconnect(reason=None):
    """Handle client disconnection"""
    try:
        client_id = getattr(request, 'sid', 'unknown')
        if reason:
            print(f'Client disconnected: {client_id} (reason: {reason})')
        else:
            print(f'Client disconnected: {client_id}')
    except Exception as e:
        print(f'Error in disconnect handler: {e}')

@socketio.on('join_session')
def handle_join_session(data):
    """Handle client joining a transcription session"""
    try:
        session_id = data.get('session_id')
        client_id = getattr(request, 'sid', 'unknown')
        if session_id:
            join_room(f"session_{session_id}")
            emit('joined_session', {
                'session_id': session_id,
                'message': f'Joined session {session_id}'
            })
            print(f'Client {client_id} joined session {session_id}')
        else:
            emit('error', {'message': 'Session ID is required'})
    except Exception as e:
        print(f'Error in join_session handler: {e}')
        try:
            emit('error', {'message': f'Error joining session: {str(e)}'})
        except:
            pass

@socketio.on('join_shared_session')
def handle_join_shared_session(data):
    """Handle viewer joining a shared transcription session"""
    try:
        session_id = data.get('session_id')
        client_id = getattr(request, 'sid', 'unknown')
        if session_id:
            # Check if session exists and is shared
            info = transcription_manager.get_shared_session_info(session_id)
            if info and info.get('is_shared'):
                join_room(f"session_{session_id}")
                emit('joined_shared_session', {
                    'session_id': session_id,
                    'session_info': info,
                    'message': f'Joined shared session {session_id}'
                })
                print(f'Viewer {client_id} joined shared session {session_id}')
                
                # Send current transcript to the viewer
                transcript = transcription_manager.get_shared_session_transcript(session_id)
                if transcript:
                    emit('current_transcript', {
                        'session_id': session_id,
                        'transcript': transcript
                    })
            else:
                emit('error', {'message': 'Session not found or not shared'})
        else:
            emit('error', {'message': 'Session ID is required'})
    except Exception as e:
        print(f'Error in join_shared_session handler: {e}')
        try:
            emit('error', {'message': f'Error joining shared session: {str(e)}'})
        except:
            pass

@socketio.on('leave_session')
def handle_leave_session(data):
    """Handle client leaving a transcription session"""
    try:
        session_id = data.get('session_id')
        client_id = getattr(request, 'sid', 'unknown')
        if session_id:
            leave_room(f"session_{session_id}")
            emit('left_session', {
                'session_id': session_id,
                'message': f'Left session {session_id}'
            })
            print(f'Client {client_id} left session {session_id}')
    except Exception as e:
        print(f'Error in leave_session handler: {e}')
        try:
            emit('error', {'message': f'Error leaving session: {str(e)}'})
        except:
            pass

@socketio.on('audio_chunk')
def handle_audio_chunk(data):
    """Handle incoming audio chunk from client"""
    try:
        session_id = data.get('session_id')
        audio_data = data.get('audio_data')
        
        if not session_id or not audio_data:
            print("Missing session_id or audio_data")
            try:
                emit('error', {'message': 'Session ID and audio data are required'})
            except:
                pass
            return
        
        # Convert base64 audio data to bytes if needed
        import base64
        if isinstance(audio_data, str):
            try:
                audio_bytes = base64.b64decode(audio_data)
                print(f"Processed audio chunk for session {session_id}: {len(audio_bytes)} bytes")
            except Exception as decode_error:
                print(f"Error decoding base64 audio: {decode_error}")
                try:
                    emit('error', {'message': f'Error decoding audio data: {str(decode_error)}'})
                except:
                    pass
                return
        else:
            audio_bytes = bytes(audio_data)
            print(f"Using raw audio bytes length: {len(audio_bytes)}")
        
        # Add audio to session
        success = transcription_manager.add_audio_to_session(session_id, audio_bytes)
        
        if not success:
            print(f"Failed to add audio to session {session_id}")
            try:
                emit('error', {'message': 'Session not found or not active'})
            except:
                pass
            
    except Exception as e:
        print(f"Error handling audio chunk: {e}")
        try:
            emit('error', {'message': f'Error processing audio: {str(e)}'})
        except:
            pass

@socketio.on('get_transcript')
def handle_get_transcript(data):
    """Handle request for current transcript"""
    try:
        session_id = data.get('session_id')
        if not session_id:
            try:
                emit('error', {'message': 'Session ID is required'})
            except:
                pass
            return
        
        transcript = transcription_manager.get_session_transcript(session_id)
        if transcript is not None:
            try:
                emit('current_transcript', {
                    'session_id': session_id,
                    'transcript': transcript
                })
            except:
                pass
        else:
            try:
                emit('error', {'message': 'Session not found'})
            except:
                pass
            
    except Exception as e:
        print(f"Error getting transcript: {e}")
        try:
            emit('error', {'message': f'Error getting transcript: {str(e)}'})
        except:
            pass

@socketio.on_error_default
def default_error_handler(e):
    """Handle any unhandled socket errors"""
    print(f'Socket error: {e}')
    try:
        emit('error', {'message': 'An unexpected error occurred'})
    except Exception as emit_error:
        print(f'Error while emitting error message: {emit_error}')

# =============================================================================
# Server Startup
# =============================================================================

if __name__ == '__main__':
    print("Starting Unified Transcription Server...")
    print("Server will run on http://localhost:5000")
    print("WebSocket endpoint: ws://localhost:5000")
    print("Services: Live Transcription + Meeting Analysis")
    
    try:
        # Run the SocketIO server with improved configuration
        socketio.run(
            app, 
            debug=False,  # Disable debug mode in production
            host='localhost', 
            port=5000,  # Use single port for both services
            allow_unsafe_werkzeug=True,
            use_reloader=False,  # Disable auto-reloader to prevent issues
            log_output=False  # Reduce log noise
        )
    except Exception as e:
        print(f"Failed to start server: {e}")
        import traceback
        traceback.print_exc() 