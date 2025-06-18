import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';
import { AuthService } from './auth.service';

export interface Chapter {
  title: string;
  time_range: string;
  content: string;
  contains_search_term?: boolean;
}

export interface TranscriptionResponse {
  success: boolean;
  session_id: string;
  transcript: string;
  chapters: Chapter[];
  takeaways: string;
  summary: string;
  notes: string;
  filename: string;
}

export interface ChatResponse {
  success: boolean;
  response: string;
}

export interface ChatHistory {
  success: boolean;
  history: Array<{
    role: 'user' | 'assistant';
    content: string;
  }>;
}

export interface SearchResponse {
  success: boolean;
  chapters: Chapter[];
  total_found: number;
}

@Injectable({
  providedIn: 'root'
})
export class MeetingService {
  private apiUrl = 'http://localhost:5000/api';

  constructor(
    private http: HttpClient,
    private authService: AuthService
  ) { }

  transcribeAudio(file: File): Observable<TranscriptionResponse> {
    const formData = new FormData();
    formData.append('audio', file);
    
    // Add password to the form data if available
    const password = this.authService.getAdminPassword();
    if (password) {
      formData.append('password', password);
    }
    
    // Add owner ID from localStorage
    const ownerId = localStorage.getItem('live-transcription-owner-id');
    if (ownerId) {
      formData.append('owner_id', ownerId);
    }

    return this.http.post<TranscriptionResponse>(
      `${this.apiUrl}/transcribe`,
      formData
    );
  }

  sendChatMessage(sessionId: string, question: string): Observable<ChatResponse> {
    return this.http.post<ChatResponse>(
      `${this.apiUrl}/chat`,
      { session_id: sessionId, question }
    );
  }

  getChatHistory(sessionId: string): Observable<ChatHistory> {
    return this.http.get<ChatHistory>(`${this.apiUrl}/chat/history/${sessionId}`);
  }

  searchTranscript(sessionId: string, searchTerm: string): Observable<SearchResponse> {
    return this.http.post<SearchResponse>(
      `${this.apiUrl}/search`,
      { session_id: sessionId, search_term: searchTerm }
    );
  }

  checkHealth(): Observable<any> {
    return this.http.get(`${this.apiUrl}/health`);
  }
} 