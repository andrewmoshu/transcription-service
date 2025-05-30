# Meeting Analyzer & Chatbot

A full-stack application for transcribing and analyzing meeting audio files using Google Gemini AI. The application features a modern Angular frontend and a Flask backend API.

## 🌟 Features

- **Audio Transcription**: Upload audio files and get accurate transcriptions with chapter organization
- **AI-Powered Analysis**: Automatically generate meeting summaries, key takeaways, and detailed notes
- **Interactive Chat**: Ask questions about the meeting content using AI
- **Search Functionality**: Search within transcripts with real-time highlighting
- **Modern UI**: Beautiful, responsive interface built with Angular Material
- **Multiple Format Support**: MP3, WAV, M4A, FLAC, AAC, OGG, OPUS, WEBM

## 📸 Screenshot

The application features a clean, modern interface with:
- Drag-and-drop file upload
- Tabbed interface for different views (Transcript, Takeaways, Summary, Notes, Chat)
- Chapter-based transcript organization
- Real-time search with highlighting
- Interactive chat interface

## 🏗️ Architecture

The project consists of two main components:

### Backend (Flask API)
- RESTful API endpoints for audio processing
- Integration with Google Gemini AI for transcription and analysis
- Session management for chat functionality
- CORS-enabled for frontend communication

### Frontend (Angular)
- Single-page application with Angular 19
- Material Design components
- Responsive layout
- Real-time updates and interactions

## 🚀 Getting Started

### Prerequisites

- Python 3.8+
- Node.js 18+
- npm 9+
- Google Cloud API credentials with Gemini AI access

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

5. Run the Flask server:
```bash
python api.py
```

The API will be available at `http://localhost:5000`

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

## 📁 Project Structure

```
transcriber/
├── backend/
│   ├── api.py              # Flask API endpoints
│   ├── transcription.py    # Audio transcription logic
│   ├── llm_utils.py        # AI integration utilities
│   ├── requirements.txt    # Python dependencies
│   └── README.md
├── frontend/
│   ├── src/
│   │   ├── app/
│   │   │   ├── meeting-analyzer/   # Main component
│   │   │   └── services/           # API services
│   │   └── styles.css
│   ├── package.json
│   └── README.md
└── README.md
```

## 🔌 API Endpoints

- `POST /api/transcribe` - Upload and transcribe audio files
- `POST /api/chat` - Send chat messages about the meeting
- `GET /api/chat/history/:sessionId` - Get chat history
- `POST /api/search` - Search within transcripts
- `GET /api/health` - Check API status

## 🛠️ Technologies Used

### Backend
- Flask
- Google Vertex AI (Gemini)
- LangChain
- Python-dotenv

### Frontend
- Angular 19
- Angular Material
- TypeScript
- RxJS
- HTML5/CSS3

## 📝 Usage

1. Start both backend and frontend servers
2. Open http://localhost:4200 in your browser
3. Upload an audio file by dragging and dropping or clicking the upload button
4. Wait for the processing to complete
5. Explore the different tabs:
   - **Transcript**: View the full transcription with chapters
   - **Takeaways**: See key points from the meeting
   - **Summary**: Read a concise summary
   - **Notes**: View detailed meeting notes
   - **Chat**: Ask questions about the meeting