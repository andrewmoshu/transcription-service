# Meeting Analyzer & Live Transcription

A full-stack application for transcribing and analyzing meeting audio files using Google Gemini AI. Now featuring **live transcription** capabilities for real-time speech-to-text conversion!

## 🌟 Features

### File-Based Analysis
- **Audio Transcription**: Upload audio files and get accurate transcriptions with chapter organization
- **AI-Powered Analysis**: Automatically generate meeting summaries, key takeaways, and detailed notes
- **Interactive Chat**: Ask questions about the meeting content using AI
- **Search Functionality**: Search within transcripts with real-time highlighting
- **Multiple Format Support**: MP3, WAV, M4A, FLAC, AAC, OGG, OPUS, WEBM

### Live Transcription (NEW!)
- **Real-time Speech-to-Text**: Live microphone transcription with immediate results
- **Session Management**: Create and manage live transcription sessions
- **WebSocket Streaming**: Real-time audio streaming with low latency
- **Browser-based Recording**: Direct microphone access through web browser
- **Python Client**: Standalone Python application for desktop microphone capture
- **Cross-platform Support**: Works on Windows, macOS, and Linux

### User Interface
- **Modern UI**: Beautiful, responsive interface built with Angular Material
- **Tabbed Interface**: Switch between file analysis and live transcription
- **Real-time Updates**: Live transcript display with timestamps
- **Session Management**: Easy session creation, control, and cleanup

## 📸 Screenshot

The application features a clean, modern interface with:
- Drag-and-drop file upload
- Tabbed interface for different views (Transcript, Takeaways, Summary, Notes, Chat)
- Chapter-based transcript organization
- Real-time search with highlighting
- Interactive chat interface

## 🏗️ Architecture

The project consists of three main components:

### Backend Services
1. **Main API (Port 5000)**: File-based transcription and analysis
2. **Live Transcription Server (Port 5001)**: WebSocket server for real-time transcription

### Frontend (Angular)
- Single-page application with Angular 19
- Material Design components
- WebSocket client for live transcription
- Responsive layout with tabbed interface

### Client Applications
- **Web Interface**: Browser-based live transcription
- **Python Client**: Standalone desktop application for microphone capture

## 🚀 Getting Started

### Prerequisites

- Python 3.8+
- Node.js 18+
- npm 9+
- Google Cloud API credentials with Gemini AI access
- Microphone access (for live transcription)

### Backend Setup

1. Navigate to the backend directory:
```bash
cd backend
```

2. Create a virtual environment:
```bash
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
```

3. Install dependencies:
```bash
pip install -r requirements.txt
```

4. Set up environment variables:
   - Create a `.env` file in the backend directory
   - Add your Google API key: `GOOGLE_API_KEY=your_api_key_here`

5. Run both servers:

**Main API Server (for file analysis):**
```bash
python api.py
```

**Live Transcription Server (for real-time):**
```bash
python live_app.py
```

The main API will be available at `http://localhost:5000`
The live transcription server will be available at `http://localhost:5001`

### Frontend Setup

1. Navigate to the frontend directory:
```bash
cd frontend
```

2. Install dependencies:
```bash
npm install
```

3. Start the development server:
```bash
npm start
```

The application will be available at `http://localhost:4200`

### Python Client Setup (Optional)

For standalone desktop microphone capture:

1. Navigate to the client application directory:
```bash
cd client_app
```

2. Install dependencies:
```bash
pip install -r requirements.txt
```

3. Run the client:
```bash
python live_mic_client.py
```

## 📁 Project Structure

```
transcriber/
├── backend/
│   ├── api.py                    # Main Flask API
│   ├── live_app.py              # Live transcription WebSocket server
│   ├── live_transcription.py    # Live transcription logic
│   ├── transcription.py         # File transcription logic
│   ├── llm_utils.py             # AI integration utilities
│   ├── requirements.txt         # Python dependencies
│   └── README.md
├── frontend/
│   ├── src/
│   │   ├── app/
│   │   │   ├── meeting-analyzer/        # File analysis component
│   │   │   ├── live-transcription/      # Live transcription component
│   │   │   └── services/                # API and WebSocket services
│   │   └── styles.css
│   ├── package.json
│   └── README.md
├── client_app/
│   ├── live_mic_client.py       # Python desktop client
│   ├── requirements.txt         # Client dependencies
│   └── README.md
└── README.md
```

## 🔌 API Endpoints

### Main API (Port 5000)
- `POST /api/transcribe` - Upload and transcribe audio files
- `POST /api/chat` - Send chat messages about the meeting
- `GET /api/chat/history/:sessionId` - Get chat history
- `POST /api/search` - Search within transcripts
- `GET /api/health` - Check API status

### Live Transcription API (Port 5001)
- `POST /api/sessions` - Create new transcription session
- `POST /api/sessions/:id/start` - Start transcription session
- `POST /api/sessions/:id/stop` - Stop transcription session
- `DELETE /api/sessions/:id` - Delete transcription session
- `GET /api/sessions/:id/transcript` - Get session transcript
- `WebSocket /` - Real-time audio streaming and transcript updates

## 🛠️ Technologies Used

### Backend
- Flask & Flask-SocketIO
- Google Vertex AI (Gemini)
- WebSocket support
- LangChain
- PyAudio (for client app)
- Python-dotenv

### Frontend
- Angular 19
- Angular Material
- Socket.IO Client
- TypeScript
- RxJS
- HTML5 Media APIs

### Client Application
- Python 3.8+
- PyAudio for microphone access
- WebSocket client
- Asyncio for concurrent operations

## 📝 Usage

### File Analysis
1. Start the main API server (`python api.py`)
2. Start the frontend (`npm start`)
3. Open http://localhost:4200 and use the "File Analysis" tab
4. Upload an audio file and explore the analysis results

### Live Transcription (Web Interface)
1. Start the live transcription server (`python live_app.py`)
2. Start the frontend (`npm start`) 
3. Open http://localhost:4200 and use the "Live Transcription" tab
4. Create a new session and start recording
5. Speak into your microphone to see real-time transcription

### Live Transcription (Python Client)
1. Start the live transcription server (`python live_app.py`)
2. In a separate terminal, run the Python client (`python client_app/live_mic_client.py`)
3. Follow the prompts to start transcription
4. Speak into your microphone to see results in the terminal

## 🔧 Configuration

### Audio Settings (Live Transcription)
- Sample Rate: 16,000 Hz
- Channels: 1 (Mono)
- Format: 16-bit PCM
- Processing: 3-second audio chunks

### Session Management
- Automatic cleanup of inactive sessions (1 hour timeout)
- Session-based audio streaming
- Real-time transcript updates via WebSocket

## 🎯 Use Cases

- **Meeting Transcription**: Record and transcribe meetings in real-time
- **Interview Recording**: Capture interviews with live feedback
- **Lecture Notes**: Real-time transcription of lectures or presentations
- **Content Creation**: Transcribe podcasts, videos, or audio content
- **Accessibility**: Provide real-time captions for audio content
- **Documentation**: Convert spoken content to written documentation