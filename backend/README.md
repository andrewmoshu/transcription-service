# Unified Transcription Server

A unified Flask-SocketIO server that combines both live transcription and meeting analysis functionality.

## Features

- **Live Transcription**: Real-time speech-to-text using WebSocket connections
- **Meeting Analysis**: Upload audio files for transcription, summary, and analysis
- **Chat Interface**: Ask questions about transcribed meetings
- **Search**: Search through transcripts and chapters

## Architecture

The unified server combines the functionality of the previous `live_app.py` and `api.py` into a single application running on port 5000.

### Endpoints

#### Live Transcription API
- `POST /api/sessions` - Create new transcription session
- `DELETE /api/sessions/{id}` - Delete transcription session  
- `POST /api/sessions/{id}/start` - Start transcription
- `POST /api/sessions/{id}/stop` - Stop transcription
- `GET /api/sessions/{id}/transcript` - Get session transcript

#### Meeting Analysis API
- `POST /api/transcribe` - Upload and analyze audio file
- `POST /api/chat` - Chat about meeting content
- `GET /api/chat/history/{session_id}` - Get chat history
- `POST /api/search` - Search transcript content

#### WebSocket Events
- `connect` - Client connects to server
- `join_session` - Join transcription session
- `leave_session` - Leave transcription session
- `audio_chunk` - Send audio data for real-time transcription
- `get_transcript` - Request current transcript

## Setup

### Prerequisites
- Python 3.8+
- Google Cloud credentials (for Vertex AI)
- Required Python packages (see requirements.txt)

### Environment Variables
```bash
GOOGLE_API_KEY=your_gemini_api_key
GOOGLE_CLOUD_PROJECT=your_gcp_project
GOOGLE_CLOUD_LOCATION=us-central1
SECRET_KEY=your_secret_key
```

### Installation
```bash
cd backend
pip install -r requirements.txt
python unified_app.py
```

The server will start on `http://localhost:5000`

## Migration from Separate Servers

If you were previously running `live_app.py` (port 5001) and `api.py` (port 5000) separately:

1. Stop both servers
2. Run the new unified server: `python unified_app.py`
3. The frontend automatically connects to port 5000 for both services

## Dependencies

- Flask & Flask-SocketIO
- Google Generative AI (Gemini)
- LangChain
- Other dependencies in requirements.txt

## Error Handling

The unified server includes comprehensive error handling:
- Global exception handlers
- Socket error management
- Connection timeout handling
- Graceful error recovery 