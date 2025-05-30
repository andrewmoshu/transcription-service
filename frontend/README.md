# Meeting Analyzer Frontend

A modern Angular-based web application for transcribing and analyzing meeting audio files using Google Gemini AI.

## Features

- 🎙️ **Audio File Upload**: Drag-and-drop or click to upload audio files
- 📝 **Automatic Transcription**: Convert audio to text with chapter organization
- 📊 **Meeting Analysis**: Generate summaries, takeaways, and detailed notes
- 🔍 **Search Functionality**: Search within transcripts with highlighting
- 💬 **AI Chat**: Ask questions about the meeting content
- 🎨 **Modern UI**: Beautiful Material Design interface with responsive layout

## Supported Audio Formats

- MP3, WAV, M4A, FLAC, AAC, OGG, OPUS, WEBM

## Prerequisites

- Node.js (v18 or higher)
- npm (v9 or higher)
- Backend API running on http://localhost:5000

## Installation

1. Install dependencies:
```bash
npm install
```

2. Start the development server:
```bash
npm start
```

The application will be available at `http://localhost:4200`

## Project Structure

```
src/
├── app/
│   ├── meeting-analyzer/
│   │   ├── meeting-analyzer.component.ts
│   │   ├── meeting-analyzer.component.html
│   │   └── meeting-analyzer.component.css
│   ├── services/
│   │   └── meeting.service.ts
│   ├── app.component.ts
│   ├── app.component.html
│   └── app.config.ts
├── styles.css
└── index.html
```

## Backend Integration

This frontend requires the Flask backend API to be running. The API endpoints used are:

- `POST /api/transcribe` - Upload and transcribe audio files
- `POST /api/chat` - Send chat messages about the meeting
- `GET /api/chat/history/:sessionId` - Get chat history
- `POST /api/search` - Search within transcripts
- `GET /api/health` - Check API status

## Building for Production

```bash
npm run build
```

The build artifacts will be stored in the `dist/` directory.

## Technologies Used

- Angular 19
- Angular Material
- RxJS
- TypeScript
- HTML5/CSS3

## License

This project is licensed under the MIT License.
