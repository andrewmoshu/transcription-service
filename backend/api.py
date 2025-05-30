from flask import Flask, request, jsonify
from flask_cors import CORS
import os
import tempfile
from dotenv import load_dotenv
import uuid
from werkzeug.utils import secure_filename

# Load environment variables
load_dotenv()

# Import project modules
from transcription import transcribe_audio
from llm_utils import (
    generate_meeting_takeaways,
    generate_meeting_summary,
    generate_meeting_notes,
    get_chat_response
)
from langchain.memory import ConversationBufferMemory

# Create Flask app
app = Flask(__name__)
CORS(app, origins=['http://localhost:4200'])  # Enable CORS for Angular dev server

# Store memory sessions per meeting
meeting_sessions = {}

# Helper functions
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

# API Routes
@app.route('/api/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    return jsonify({'status': 'healthy', 'service': 'Meeting Analyzer API'})

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

if __name__ == '__main__':
    app.run(debug=True, port=5000, host='0.0.0.0') 