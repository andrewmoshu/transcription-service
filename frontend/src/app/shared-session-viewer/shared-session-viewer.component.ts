import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { MatDividerModule } from '@angular/material/divider';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatMenuModule } from '@angular/material/menu';
import { MatTabsModule } from '@angular/material/tabs';
import { Subscription } from 'rxjs';
import { 
  LiveTranscriptionService, 
  SharedSessionInfo, 
  TranscriptUpdate,
  SessionStatusUpdate,
  SummaryInfo
} from '../services/live-transcription.service';

@Component({
  selector: 'app-shared-session-viewer',
  standalone: true,
  imports: [
    CommonModule,
    MatCardModule,
    MatIconModule,
    MatButtonModule,
    MatChipsModule,
    MatDividerModule,
    MatSnackBarModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
    MatMenuModule,
    MatTabsModule
  ],
  templateUrl: './shared-session-viewer.component.html',
  styleUrls: ['./shared-session-viewer.component.css']
})
export class SharedSessionViewerComponent implements OnInit, OnDestroy {
  sessionId: string = '';
  sessionInfo: SharedSessionInfo | null = null;
  transcriptLines: string[] = [];
  fullTranscript = '';
  isConnected = false;
  isLoading = true;
  sessionSummary: SummaryInfo | null = null;
  activeTab = 0; // 0 for transcript, 1 for summary
  
  private subscriptions: Subscription[] = [];

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private liveTranscriptionService: LiveTranscriptionService,
    private snackBar: MatSnackBar
  ) {}

  ngOnInit(): void {
    this.sessionId = this.route.snapshot.paramMap.get('sessionId') || '';
    if (this.sessionId) {
      this.loadSharedSession();
      this.setupSubscriptions();
    } else {
      this.showError('Invalid session ID');
      this.router.navigate(['/']);
    }
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach(sub => sub.unsubscribe());
    if (this.sessionId) {
      this.liveTranscriptionService.leaveSession(this.sessionId);
    }
    this.liveTranscriptionService.disconnect();
  }

  private loadSharedSession(): void {
    this.isLoading = true;
    
    // Get session info
    this.subscriptions.push(
      this.liveTranscriptionService.getSharedSessionInfo(this.sessionId).subscribe({
        next: (response) => {
          if (response.success) {
            this.sessionInfo = {
              session_id: response.session_id,
              is_shared: response.is_shared,
              created_at: response.created_at,
              is_active: response.is_active,
              title: response.title
            };
            
            // Join the shared session
            this.liveTranscriptionService.joinSharedSession(this.sessionId);
            
            // Load current transcript
            this.loadCurrentTranscript();
            
            // Load summary if available
            this.loadSessionSummary();
          } else {
            this.showError('Session not found or not shared');
            this.router.navigate(['/']);
          }
        },
        error: (error) => {
          console.error('Error loading shared session:', error);
          this.showError('Failed to load shared session');
          this.router.navigate(['/']);
        }
      })
    );
  }

  private loadCurrentTranscript(): void {
    this.subscriptions.push(
      this.liveTranscriptionService.getSharedSessionTranscript(this.sessionId).subscribe({
        next: (response) => {
          if (response.success && response.transcript) {
            this.updateTranscript(response.transcript);
          }
          this.isLoading = false;
        },
        error: (error) => {
          console.error('Error loading transcript:', error);
          this.isLoading = false;
        }
      })
    );
  }

  private setupSubscriptions(): void {
    // Connection status
    this.subscriptions.push(
      this.liveTranscriptionService.getConnectionStatus().subscribe(
        connected => {
          this.isConnected = connected;
          if (connected && this.sessionId) {
            this.liveTranscriptionService.joinSharedSession(this.sessionId);
          }
        }
      )
    );

    // Session status updates
    this.subscriptions.push(
      this.liveTranscriptionService.getSessionStatusUpdates().subscribe(
        statusUpdate => {
          this.handleSessionStatusUpdate(statusUpdate);
        }
      )
    );

    // Transcript updates
    this.subscriptions.push(
      this.liveTranscriptionService.getTranscriptUpdates().subscribe(
        updates => {
          this.handleTranscriptUpdates(updates);
        }
      )
    );

    // Current transcript
    this.subscriptions.push(
      this.liveTranscriptionService.getCurrentTranscript().subscribe(
        data => {
          if (data.session_id === this.sessionId) {
            this.handleCurrentTranscript(data.updates);
          }
        }
      )
    );

    // Shared session joined
    this.subscriptions.push(
      this.liveTranscriptionService.getSharedSessionJoined().subscribe(
        data => {
          if (data.session_id === this.sessionId) {
            console.log('Successfully joined shared session');
            this.showSuccess('Connected to live session');
          }
        }
      )
    );

    // Errors
    this.subscriptions.push(
      this.liveTranscriptionService.getErrors().subscribe(
        error => {
          this.showError(error);
        }
      )
    );
  }

  private handleSessionStatusUpdate(statusUpdate: SessionStatusUpdate): void {
    if (statusUpdate.session_id === this.sessionId && this.sessionInfo) {
      console.log('Session status update received:', statusUpdate);
      
      // Update session info with new status
      this.sessionInfo = {
        ...this.sessionInfo,
        is_active: statusUpdate.is_active,
        is_shared: statusUpdate.is_shared
      };

      // Show status change notification
      switch (statusUpdate.status) {
        case 'started':
          this.showSuccess('Recording started');
          break;
        case 'stopped':
          this.showSuccess('Recording stopped');
          break;
        case 'ended':
          this.showSuccess('Session ended');
          break;
        case 'sharing_disabled':
          this.showError('Session sharing has been disabled');
          // Optionally redirect user when sharing is disabled
          setTimeout(() => {
            this.router.navigate(['/']);
          }, 3000);
          break;
      }
    }
  }

  private handleTranscriptUpdates(updates: TranscriptUpdate[]): void {
    updates.forEach(update => {
      const timestampedLine = `[${update.timestamp}] ${update.text}`;
      this.transcriptLines.push(timestampedLine);
    });
    
    this.fullTranscript = this.transcriptLines.join('\n');
    this.scrollToBottom();
  }

  private handleCurrentTranscript(updates: TranscriptUpdate[]): void {
    this.transcriptLines = [];
    updates.forEach(update => {
      const timestampedLine = `[${update.timestamp}] ${update.text}`;
      this.transcriptLines.push(timestampedLine);
    });
    
    this.fullTranscript = this.transcriptLines.join('\n');
    this.scrollToBottom();
  }

  private updateTranscript(transcript: string): void {
    if (transcript) {
      this.transcriptLines = transcript.split('\n').filter(line => line.trim());
      this.fullTranscript = transcript;
      this.scrollToBottom();
    }
  }

  private scrollToBottom(): void {
    setTimeout(() => {
      const transcriptArea = document.querySelector('.transcript-content');
      if (transcriptArea) {
        transcriptArea.scrollTop = transcriptArea.scrollHeight;
      }
    }, 100);
  }

  downloadTranscript(): void {
    if (!this.fullTranscript) return;
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `shared-session-${this.sessionId.substring(0, 8)}-transcript-${timestamp}.txt`;
    
    const blob = new Blob([this.fullTranscript], { type: 'text/plain' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
    
    this.showSuccess('Transcript downloaded');
  }

  getStatusText(): string {
    if (!this.isConnected) return 'Disconnected';
    if (!this.sessionInfo) return 'Loading...';
    return this.sessionInfo.is_active ? 'Live' : 'Session Ended';
  }

  getStatusColor(): string {
    if (!this.isConnected) return 'warn';
    if (!this.sessionInfo) return 'accent';
    return this.sessionInfo.is_active ? 'primary' : 'accent';
  }

  trackByLine(index: number, line: string): number {
    return index;
  }

  extractTimestamp(line: string): string | null {
    const match = line.match(/^\[(\d{2}:\d{2}:\d{2})\]/);
    return match ? match[1] : null;
  }

  removeTimestamp(line: string): string {
    return line.replace(/^\[\d{2}:\d{2}:\d{2}\]\s*/, '');
  }

  private showSuccess(message: string): void {
    this.snackBar.open(message, 'Close', {
      duration: 3000,
      panelClass: ['success-snackbar']
    });
  }

  private showError(message: string): void {
    this.snackBar.open(message, 'Close', {
      duration: 5000,
      panelClass: ['error-snackbar']
    });
  }

  private loadSessionSummary(): void {
    this.subscriptions.push(
      this.liveTranscriptionService.getSharedSessionSummary(this.sessionId).subscribe({
        next: (response) => {
          if (response.success && response.summary) {
            this.sessionSummary = {
              summary: response.summary,
              generated_at: response.generated_at
            };
          }
        },
        error: (error: any) => {
          console.error('Error loading session summary:', error);
          // Don't show error - summary might not be available yet
        }
      })
    );
  }
} 