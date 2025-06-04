import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, Subject, BehaviorSubject } from 'rxjs';
import io from 'socket.io-client';

export interface LiveSession {
  session_id: string;
  created_at: Date;
  is_active: boolean;
  is_shared?: boolean;
  title?: string;
}

export interface TranscriptUpdate {
  timestamp: string;
  text: string;
  session_id: string;
}

export interface LiveSessionResponse {
  success: boolean;
  session_id?: string;
  message?: string;
  error?: string;
}

export interface LiveTranscriptResponse {
  success: boolean;
  session_id?: string;
  transcript?: string;
  error?: string;
}

export interface ShareInfo {
  is_shared: boolean;
  share_url?: string;
  created_at?: string;
  is_active?: boolean;
  title?: string;
}

export interface SharedSessionInfo {
  session_id: string;
  is_shared: boolean;
  created_at?: string;
  is_active?: boolean;
  title?: string;
}

export interface SessionStatusUpdate {
  session_id: string;
  is_active: boolean;
  is_shared: boolean;
  status: 'started' | 'stopped' | 'ended' | 'sharing_enabled' | 'sharing_disabled';
  timestamp: string;
}

@Injectable({
  providedIn: 'root'
})
export class LiveTranscriptionService {
  private apiUrl = 'http://localhost:5000/api';
  private socketUrl = 'http://localhost:5000';
  private socket!: any;

  // Observables for real-time updates
  private transcriptUpdates$ = new Subject<TranscriptUpdate[]>();
  private currentTranscript$ = new Subject<{ session_id: string, updates: TranscriptUpdate[] }>();
  private connectionStatus$ = new BehaviorSubject<boolean>(false);
  private currentSession$ = new BehaviorSubject<LiveSession | null>(null);
  private sessionStatusUpdates$ = new Subject<SessionStatusUpdate>();
  private errors$ = new Subject<string>();
  private sharedSessionJoined$ = new Subject<{session_id: string, session_info: SharedSessionInfo}>();

  constructor(private http: HttpClient) {
    this.initializeSocket();
  }

  private initializeSocket(): void {
    console.log('=== INITIALIZING SOCKET ===');
    
    // Disconnect any existing socket first
    if (this.socket) {
      this.socket.disconnect();
    }
    
    this.socket = io(this.socketUrl, {
      transports: ['polling', 'websocket'], // Try polling first, then upgrade
      upgrade: true,
      rememberUpgrade: false, // Don't remember upgrades to prevent issues
      timeout: 20000,
      forceNew: true, // Force new connection to prevent caching issues
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 5
    });

    this.socket.on('connect', () => {
      console.log('Connected to live transcription server');
      this.connectionStatus$.next(true);
    });

    this.socket.on('disconnect', (reason: string) => {
      console.log('Disconnected from live transcription server:', reason);
      this.connectionStatus$.next(false);
    });

    this.socket.on('connect_error', (error: any) => {
      console.warn('Socket connection error:', error);
      this.connectionStatus$.next(false);
    });

    this.socket.on('reconnect', (attemptNumber: number) => {
      console.log('Reconnected after', attemptNumber, 'attempts');
      this.connectionStatus$.next(true);
    });

    this.socket.on('reconnect_error', (error: any) => {
      console.warn('Reconnection failed:', error);
    });

    this.socket.on('transcript_update', (data: { session_id: string, updates: TranscriptUpdate[] }) => {
      console.log('Received transcript_update event:', data);
      this.transcriptUpdates$.next(data.updates);
    });

    this.socket.on('current_transcript', (data: { session_id: string, transcript: string }) => {
      console.log('Received current_transcript event:', data);
      if (data.transcript) {
        // Parse the transcript into updates
        const lines = data.transcript.split('\n').filter(line => line.trim());
        const updates: TranscriptUpdate[] = lines.map(line => {
          // Extract timestamp and text from lines like "[HH:MM:SS] text"
          const match = line.match(/^\[(\d{2}:\d{2}:\d{2})\]\s*(.*)$/);
          if (match) {
            return {
              timestamp: match[1],
              text: match[2],
              session_id: data.session_id
            };
          } else {
            // Fallback for lines without timestamp
            return {
              timestamp: new Date().toTimeString().split(' ')[0],
              text: line,
              session_id: data.session_id
            };
          }
        });
        
        if (updates.length > 0) {
          console.log('Parsed current transcript into', updates.length, 'updates');
          this.currentTranscript$.next({ session_id: data.session_id, updates });
        }
      }
    });

    this.socket.on('session_status_update', (data: SessionStatusUpdate) => {
      console.log('Received session_status_update event:', data);
      this.sessionStatusUpdates$.next(data);
    });

    this.socket.on('error', (error: { message: string }) => {
      console.error('Socket error:', error);
      this.errors$.next(error.message);
    });

    this.socket.on('joined_session', (data: { session_id: string, message: string }) => {
      console.log('Joined session:', data);
    });

    this.socket.on('left_session', (data: { session_id: string, message: string }) => {
      console.log('Left session:', data);
    });

    this.socket.on('joined_shared_session', (data: { session_id: string, session_info: SharedSessionInfo, message: string }) => {
      console.log('Joined shared session:', data);
      this.sharedSessionJoined$.next({ session_id: data.session_id, session_info: data.session_info });
    });
    
    console.log('=== SOCKET INITIALIZATION COMPLETE ===');
  }

  // Observable getters
  getTranscriptUpdates(): Observable<TranscriptUpdate[]> {
    return this.transcriptUpdates$.asObservable();
  }

  getCurrentTranscript(): Observable<{ session_id: string, updates: TranscriptUpdate[] }> {
    return this.currentTranscript$.asObservable();
  }

  getConnectionStatus(): Observable<boolean> {
    return this.connectionStatus$.asObservable();
  }

  getCurrentSession(): Observable<LiveSession | null> {
    return this.currentSession$.asObservable();
  }

  getSessionStatusUpdates(): Observable<SessionStatusUpdate> {
    return this.sessionStatusUpdates$.asObservable();
  }

  getErrors(): Observable<string> {
    return this.errors$.asObservable();
  }

  getSharedSessionJoined(): Observable<{session_id: string, session_info: SharedSessionInfo}> {
    return this.sharedSessionJoined$.asObservable();
  }

  // Session management
  createSession(): Observable<LiveSessionResponse> {
    return this.http.post<LiveSessionResponse>(`${this.apiUrl}/sessions`, {});
  }

  deleteSession(sessionId: string): Observable<LiveSessionResponse> {
    return this.http.delete<LiveSessionResponse>(`${this.apiUrl}/sessions/${sessionId}`);
  }

  startSession(sessionId: string): Observable<LiveSessionResponse> {
    return this.http.post<LiveSessionResponse>(`${this.apiUrl}/sessions/${sessionId}/start`, {});
  }

  stopSession(sessionId: string): Observable<LiveSessionResponse> {
    return this.http.post<LiveSessionResponse>(`${this.apiUrl}/sessions/${sessionId}/stop`, {});
  }

  getSessionTranscript(sessionId: string): Observable<LiveTranscriptResponse> {
    return this.http.get<LiveTranscriptResponse>(`${this.apiUrl}/sessions/${sessionId}/transcript`);
  }

  // Sharing methods
  enableSharing(sessionId: string): Observable<any> {
    return this.http.post(`${this.apiUrl}/sessions/${sessionId}/share`, {});
  }

  disableSharing(sessionId: string): Observable<any> {
    return this.http.delete(`${this.apiUrl}/sessions/${sessionId}/share`);
  }

  getShareInfo(sessionId: string): Observable<{success: boolean, session_id: string, is_shared: boolean, share_url?: string, created_at?: string, is_active?: boolean}> {
    return this.http.get<{success: boolean, session_id: string, is_shared: boolean, share_url?: string, created_at?: string, is_active?: boolean}>(`${this.apiUrl}/sessions/${sessionId}/share`);
  }

  // Public access methods for shared sessions
  getSharedSessionInfo(sessionId: string): Observable<{success: boolean, session_id: string, is_shared: boolean, created_at?: string, is_active?: boolean, title?: string}> {
    return this.http.get<{success: boolean, session_id: string, is_shared: boolean, created_at?: string, is_active?: boolean, title?: string}>(`${this.apiUrl}/shared/${sessionId}/info`);
  }

  getSharedSessionTranscript(sessionId: string): Observable<{success: boolean, session_id: string, transcript: string}> {
    return this.http.get<{success: boolean, session_id: string, transcript: string}>(`${this.apiUrl}/shared/${sessionId}/transcript`);
  }

  // Socket operations
  joinSession(sessionId: string): void {
    console.log(`Joining session: ${sessionId}`);
    this.socket.emit('join_session', { session_id: sessionId });
  }

  joinSharedSession(sessionId: string): void {
    console.log(`Joining shared session: ${sessionId}`);
    this.socket.emit('join_shared_session', { session_id: sessionId });
  }

  leaveSession(sessionId: string): void {
    if (this.socket && this.socket.connected) {
      console.log(`Leaving session: ${sessionId}`);
      this.socket.emit('leave_session', { session_id: sessionId });
    }
  }

  sendAudioChunk(sessionId: string, audioData: string): void {
    if (this.socket && this.socket.connected) {
      this.socket.emit('audio_chunk', {
        session_id: sessionId,
        audio_data: audioData
      });
    }
  }

  requestCurrentTranscript(sessionId: string): void {
    if (this.socket && this.socket.connected) {
      console.log(`Requesting current transcript for session: ${sessionId}`);
      this.socket.emit('get_current_transcript', { session_id: sessionId });
    }
  }

  // Health check
  checkHealth(): Observable<any> {
    return this.http.get(`${this.apiUrl}/health`);
  }

  disconnect(): void {
    if (this.socket) {
      console.log('Disconnecting socket...');
      this.socket.removeAllListeners(); // Remove all listeners first
      this.socket.disconnect();
      this.socket = null;
    }
    this.connectionStatus$.next(false);
  }
} 