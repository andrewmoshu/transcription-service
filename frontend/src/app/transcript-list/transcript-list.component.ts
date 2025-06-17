import { Component, OnInit, OnDestroy, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { LiveTranscriptionService, TranscriptInfo } from '../services/live-transcription.service';

@Component({
  selector: 'app-transcript-list',
  standalone: true,
  imports: [
    CommonModule,
    MatCardModule,
    MatIconModule,
    MatButtonModule,
    MatChipsModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
    MatSnackBarModule
  ],
  templateUrl: './transcript-list.component.html',
  styleUrls: ['./transcript-list.component.css']
})
export class TranscriptListComponent implements OnInit, OnDestroy {
  transcripts: TranscriptInfo[] = [];
  isLoading = true;
  ownerId: string | null = null;
  private subscriptions: Subscription[] = [];
  
  @Output() switchToMeetingAnalyzer = new EventEmitter<void>();

  constructor(
    private liveTranscriptionService: LiveTranscriptionService,
    private router: Router,
    private snackBar: MatSnackBar
  ) {}

  ngOnInit(): void {
    // Get owner ID from localStorage
    this.ownerId = localStorage.getItem('live-transcription-owner-id');
    this.loadTranscripts();
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach(sub => sub.unsubscribe());
  }

  private loadTranscripts(): void {
    this.isLoading = true;
    
    this.subscriptions.push(
      this.liveTranscriptionService.getAllTranscripts(this.ownerId || undefined).subscribe({
        next: (response) => {
          if (response.success) {
            this.transcripts = response.transcripts;
            console.log(`Loaded ${this.transcripts.length} transcripts`);
          } else {
            this.showError('Failed to load transcripts');
          }
          this.isLoading = false;
        },
        error: (error) => {
          console.error('Error loading transcripts:', error);
          this.showError('Failed to load transcripts');
          this.isLoading = false;
        }
      })
    );
  }

  viewTranscript(transcript: TranscriptInfo): void {
    // Load the meeting analysis
    this.liveTranscriptionService.getMeetingAnalysis(transcript.session_id, this.ownerId || undefined).subscribe({
      next: (response) => {
        if (response.success && response.analysis) {
          // Store the analysis in session storage for the meeting analyzer
          // Include the session_id which is needed for chat functionality
          const analysisData = {
            ...response.analysis,
            sessionId: transcript.session_id  // Ensure session ID is included
          };
          sessionStorage.setItem('live-session-analysis', JSON.stringify(analysisData));
          
          // Emit event to switch to meeting analyzer
          this.switchToMeetingAnalyzer.emit();
        } else {
          this.showError('Failed to load meeting analysis');
        }
      },
      error: (error) => {
        console.error('Error loading meeting analysis:', error);
        this.showError('Failed to load meeting analysis');
      }
    });
  }

  formatDuration(seconds?: number): string {
    if (!seconds) return 'N/A';
    
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);
    
    if (minutes > 0) {
      return `${minutes}m ${remainingSeconds}s`;
    } else {
      return `${remainingSeconds}s`;
    }
  }

  getStatusIcon(transcript: TranscriptInfo): string {
    if (transcript.is_active) return 'radio_button_checked';
    if (transcript.has_summary) return 'check_circle';
    return 'radio_button_unchecked';
  }

  getStatusText(transcript: TranscriptInfo): string {
    if (transcript.is_active) return 'Active';
    if (transcript.has_summary) return 'Complete';
    return 'Ended';
  }

  getStatusColor(transcript: TranscriptInfo): string {
    if (transcript.is_active) return 'primary';
    if (transcript.has_summary) return 'accent';
    return 'warn';
  }

  private showInfo(message: string): void {
    this.snackBar.open(message, 'Close', {
      duration: 3000,
      panelClass: ['info-snackbar']
    });
  }

  private showError(message: string): void {
    this.snackBar.open(message, 'Close', {
      duration: 5000,
      panelClass: ['error-snackbar']
    });
  }
}
