from flask import Flask, request, jsonify
from flask_cors import CORS
from flask_socketio import SocketIO, emit, join_room, leave_room
import threading
import time
import os
from dotenv import load_dotenv
import google.generativeai as genai
from live_transcription import LiveTranscriptionManager

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
    ping_timeout=60,
    ping_interval=25,
    transports=['websocket', 'polling']
)

# Initialize live transcription manager
transcription_manager = LiveTranscriptionManager(socketio)

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
    print(f'Socket error occurred: {e}')

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

# REST API Endpoints
@app.route('/api/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    try:
        return jsonify({'status': 'healthy', 'service': 'live-transcription'}), 200
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 500

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
        success = transcription_manager.delete_session(session_id)
        if success:
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

# SocketIO Event Handlers
@socketio.on('connect')
def handle_connect():
    """Handle client connection"""
    try:
        print(f'Client connected: {request.sid}')
        emit('connected', {'message': 'Connected to live transcription server'})
    except Exception as e:
        print(f'Error in connect handler: {e}')

@socketio.on('disconnect')
def handle_disconnect():
    """Handle client disconnection"""
    try:
        print(f'Client disconnected: {request.sid}')
    except Exception as e:
        print(f'Error in disconnect handler: {e}')

@socketio.on('join_session')
def handle_join_session(data):
    """Handle client joining a transcription session"""
    try:
        session_id = data.get('session_id')
        if session_id:
            join_room(f"session_{session_id}")
            emit('joined_session', {
                'session_id': session_id,
                'message': f'Joined session {session_id}'
            })
            print(f'Client {request.sid} joined session {session_id}')
        else:
            emit('error', {'message': 'Session ID is required'})
    except Exception as e:
        print(f'Error in join_session handler: {e}')
        emit('error', {'message': f'Error joining session: {str(e)}'})

@socketio.on('join_shared_session')
def handle_join_shared_session(data):
    """Handle viewer joining a shared transcription session"""
    try:
        session_id = data.get('session_id')
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
                print(f'Viewer {request.sid} joined shared session {session_id}')
                
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
        emit('error', {'message': f'Error joining shared session: {str(e)}'})

@socketio.on('leave_session')
def handle_leave_session(data):
    """Handle client leaving a transcription session"""
    try:
        session_id = data.get('session_id')
        if session_id:
            leave_room(f"session_{session_id}")
            emit('left_session', {
                'session_id': session_id,
                'message': f'Left session {session_id}'
            })
            print(f'Client {request.sid} left session {session_id}')
    except Exception as e:
        print(f'Error in leave_session handler: {e}')
        emit('error', {'message': f'Error leaving session: {str(e)}'})

@socketio.on('audio_chunk')
def handle_audio_chunk(data):
    """Handle incoming audio chunk from client"""
    try:
        session_id = data.get('session_id')
        audio_data = data.get('audio_data')
        
        if not session_id or not audio_data:
            print("Missing session_id or audio_data")
            emit('error', {'message': 'Session ID and audio data are required'})
            return
        
        # Convert base64 audio data to bytes if needed
        import base64
        if isinstance(audio_data, str):
            try:
                audio_bytes = base64.b64decode(audio_data)
                print(f"Processed audio chunk for session {session_id}: {len(audio_bytes)} bytes")
            except Exception as decode_error:
                print(f"Error decoding base64 audio: {decode_error}")
                emit('error', {'message': f'Error decoding audio data: {str(decode_error)}'})
                return
        else:
            audio_bytes = bytes(audio_data)
            print(f"Using raw audio bytes length: {len(audio_bytes)}")
        
        # Add audio to session
        success = transcription_manager.add_audio_to_session(session_id, audio_bytes)
        
        if not success:
            print(f"Failed to add audio to session {session_id}")
            emit('error', {'message': 'Session not found or not active'})
            
    except Exception as e:
        print(f"Error handling audio chunk: {e}")
        emit('error', {'message': f'Error processing audio: {str(e)}'})

@socketio.on('get_transcript')
def handle_get_transcript(data):
    """Handle request for current transcript"""
    try:
        session_id = data.get('session_id')
        if not session_id:
            emit('error', {'message': 'Session ID is required'})
            return
        
        transcript = transcription_manager.get_session_transcript(session_id)
        if transcript is not None:
            emit('current_transcript', {
                'session_id': session_id,
                'transcript': transcript
            })
        else:
            emit('error', {'message': 'Session not found'})
            
    except Exception as e:
        print(f"Error getting transcript: {e}")
        emit('error', {'message': f'Error getting transcript: {str(e)}'})

@socketio.on_error_default
def default_error_handler(e):
    """Handle any unhandled socket errors"""
    print(f'Socket error: {e}')
    emit('error', {'message': 'An unexpected error occurred'})

if __name__ == '__main__':
    print("Starting Live Transcription Server...")
    print("Server will run on http://localhost:5001")
    print("WebSocket endpoint: ws://localhost:5001")
    
    try:
        # Run the SocketIO server with improved configuration
        socketio.run(
            app, 
            debug=False,  # Disable debug mode in production
            host='localhost', 
            port=5001,
            allow_unsafe_werkzeug=True,
            use_reloader=False,  # Disable auto-reloader to prevent issues
            log_output=False  # Reduce log noise
        )
    except Exception as e:
        print(f"Failed to start server: {e}")
        import traceback
        traceback.print_exc() 