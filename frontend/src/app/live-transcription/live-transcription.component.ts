import { Component, OnInit, OnDestroy, inject, Inject, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatTabsModule } from '@angular/material/tabs';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDividerModule } from '@angular/material/divider';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSnackBarModule, MatSnackBar } from '@angular/material/snack-bar';
import { MatDialogModule, MatDialog, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatSelectModule } from '@angular/material/select';
import { MatRadioModule } from '@angular/material/radio';
import { Subject, interval, takeUntil, Subscription } from 'rxjs';
import { AudioSourceDialogComponent, AudioSourceSelection } from '../audio-source-dialog/audio-source-dialog.component';
import { AuthDialogComponent, AuthDialogData } from '../auth-dialog/auth-dialog.component';
import { AuthService } from '../services/auth.service';
import {
  LiveTranscriptionService,
  LiveSession,
  TranscriptUpdate,
  LiveTranscriptResponse,
  SessionStatusUpdate,
  LiveSessionResponse,
  SessionState,
  SessionResumeResponse
} from '../services/live-transcription.service';
import { MeetingService, TranscriptionResponse } from '../services/meeting.service';

// Import the worklet using audio-worklet-loader
import audioProcessorWorkletUrl from '../audio-processor.worklet.js';

// Confirmation dialog component
@Component({
  selector: 'app-confirmation-dialog',
  standalone: true,
  imports: [CommonModule, MatDialogModule, MatButtonModule, MatIconModule],
  template: `
    <div class="confirmation-dialog">
      <h2 mat-dialog-title>
        <mat-icon class="dialog-icon">{{getDialogIcon()}}</mat-icon>
        {{data.title}}
      </h2>
      
      <mat-dialog-content>
        <div class="message-content">
          <p class="main-message">{{getMainMessage()}}</p>
          <p class="sub-message" *ngIf="getSubMessage()">{{getSubMessage()}}</p>
        </div>
      </mat-dialog-content>
      
      <mat-dialog-actions>
        <button mat-button (click)="onCancel()" class="cancel-btn">
          <mat-icon>close</mat-icon>
          {{data.cancelText}}
        </button>
        <button mat-flat-button color="primary" (click)="onConfirm()" class="confirm-btn">
          <mat-icon>{{getConfirmIcon()}}</mat-icon>
          {{data.confirmText}}
        </button>
      </mat-dialog-actions>
    </div>
  `,
  styles: [`
    .confirmation-dialog {
      min-width: 400px;
      max-width: 500px;
    }

    .confirmation-dialog h2 {
      display: flex;
      align-items: center;
      gap: 12px;
      margin: 0;
      padding: 0;
      color: rgba(255, 255, 255, 0.95);
      font-weight: 400;
      font-size: 1.25rem;
    }

    .dialog-icon {
      font-size: 24px;
      width: 24px;
      height: 24px;
    }

    .dialog-icon.info {
      color: #00b4d8;
    }

    .dialog-icon.warning {
      color: #ff9800;
    }

    .dialog-icon.success {
      color: #4caf50;
    }

    .message-content {
      margin-top: 8px;
    }

    .main-message {
      color: rgba(255, 255, 255, 0.9);
      font-size: 1rem;
      line-height: 1.5;
      margin: 0 0 12px 0;
    }

    .sub-message {
      color: rgba(255, 255, 255, 0.7);
      font-size: 0.9rem;
      line-height: 1.4;
      margin: 0;
      white-space: pre-line;
    }

    mat-dialog-actions {
      display: flex;
      gap: 12px;
      justify-content: flex-end;
      padding: 0 !important;
      margin-top: 24px;
    }

    .cancel-btn {
      display: flex;
      align-items: center;
      gap: 6px;
      color: rgba(255, 255, 255, 0.7) !important;
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 8px;
      padding: 8px 16px;
    }

    .cancel-btn:hover {
      background: rgba(255, 255, 255, 0.05) !important;
      border-color: rgba(255, 255, 255, 0.2);
    }

    .confirm-btn {
      display: flex;
      align-items: center;
      gap: 6px;
      background: rgba(0, 180, 216, 0.1) !important;
      border: 1px solid rgba(0, 180, 216, 0.3) !important;
      color: #00b4d8 !important;
      border-radius: 8px;
      padding: 8px 16px;
    }

    .confirm-btn:hover {
      background: rgba(0, 180, 216, 0.15) !important;
      border-color: rgba(0, 180, 216, 0.4) !important;
    }
  `]
})
export class ConfirmationDialogComponent {
  constructor(
    public dialogRef: MatDialogRef<ConfirmationDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: ConfirmationDialogData
  ) {}

  onConfirm(): void {
    this.dialogRef.close(true);
  }

  onCancel(): void {
    this.dialogRef.close(false);
  }

  getDialogIcon(): string {
    switch (this.data.title.toLowerCase()) {
      case 'warning':
        return 'warning';
      case 'success':
        return 'check_circle';
      default:
        return 'info';
    }
  }

  getMainMessage(): string {
    return this.data.message;
  }

  getSubMessage(): string | null {
    return this.data.subMessage || null;
  }

  getConfirmIcon(): string {
    return this.data.title.toLowerCase() === 'warning' ? 'warning' : 'check_circle';
  }
}

// Add confirmation dialog component interface
interface ConfirmationDialogData {
  title: string;
  message: string;
  subMessage?: string;
  confirmText: string;
  cancelText: string;
}

@Component({
  selector: 'app-live-transcription',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatTabsModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatCardModule,
    MatInputModule,
    MatFormFieldModule,
    MatSnackBarModule,
    MatDividerModule,
    MatChipsModule,
    MatDialogModule,
    MatTooltipModule,
    MatSelectModule,
    MatRadioModule
  ],
  templateUrl: './live-transcription.component.html',
  styleUrls: ['./live-transcription.component.css']
})
export class LiveTranscriptionComponent implements OnInit, OnDestroy {
  // Session management
  currentSession: LiveSession | null = null;
  ownerId: string | null = null; // Track session owner ID
  isConnected = false;
  isCreatingSession = false;
  isRecording = false;
  isPaused = false; // Track if we're between recording sessions
  isShared = false;
  shareUrl = '';
  
  // Reconnection state
  hasResumableSession = false;
  resumableSessionId: string | null = null;
  resumableSessionState: SessionState | null = null;
  isCheckingForResumableSession = false;
  isResumingSession = false;
  private isReconnectionDialogOpen = false; // Add flag to track dialog state
  
  // Transcript data
  transcriptLines: string[] = [];
  fullTranscript = '';
  
  // Subscriptions
  private subscriptions: Subscription[] = [];
  
  // Audio capture methods - Updated for AudioWorklet
  private audioContext: AudioContext | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private microphoneStream: MediaStream | null = null;
  private systemStream: MediaStream | null = null;
  private audioWorkletNode: AudioWorkletNode | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private mixerNode: GainNode | null = null;
  audioChunks: Blob[] = []; // Keep for MediaRecorder fallback
  private chunkCounter = 0;
  private audioBuffer: Float32Array[] = [];
  private completeRawBuffer: Float32Array[] = []; // Store complete recording
  private accumulatedAudioChunks: Blob[] = []; // Accumulate audio across sessions
  private accumulatedRawBuffer: Float32Array[] = []; // Accumulate raw audio across sessions
  
  // Chunk configuration
  private readonly CHUNK_DURATION_SAMPLES = 80000; // 5 seconds at 16kHz
  
  // Processing state
  isProcessingSummary = false;
  isProcessingChunk = false;

  // Audio device management
  private availableMicDevices: MediaDeviceInfo[] = [];
  audioSourceInfo = '';

  @Output() sessionEnded = new EventEmitter<void>();
  @Output() switchToMeetingAnalyzer = new EventEmitter<void>();

  constructor(
    private liveTranscriptionService: LiveTranscriptionService,
    private meetingService: MeetingService,
    private authService: AuthService,
    private snackBar: MatSnackBar,
    private dialog: MatDialog
  ) {}

  ngOnInit(): void {
    // Load owner ID from localStorage or generate new one
    this.ownerId = localStorage.getItem('live-transcription-owner-id');
    if (!this.ownerId) {
      this.ownerId = this.generateOwnerId();
      localStorage.setItem('live-transcription-owner-id', this.ownerId);
    }
    
    this.setupSubscriptions();
    this.checkHealth();
    this.loadAudioDevices();
    
    // Check for resumable sessions after a short delay to ensure service is ready
    setTimeout(() => {
      this.checkForResumableSession();
    }, 1000);
  }

  private generateOwnerId(): string {
    return 'owner-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
  }

  private checkForResumableSession(): void {
    if (!this.ownerId || !this.isConnected) {
      return;
    }

    // Prevent redundant checks
    if (this.isCheckingForResumableSession || this.isReconnectionDialogOpen) {
      console.log('Already checking for resumable session or dialog open, skipping...');
      return;
    }

    this.isCheckingForResumableSession = true;
    
    this.liveTranscriptionService.findResumableSession(this.ownerId).subscribe({
      next: (response) => {
        this.isCheckingForResumableSession = false;
        
        if (response.success && response.session_id && response.session_state) {
          this.hasResumableSession = true;
          this.resumableSessionId = response.session_id;
          this.resumableSessionState = response.session_state;
          
          console.log('Found resumable session:', response.session_id);
          this.showReconnectionPrompt();
        } else {
          console.log('No resumable session found');
          this.hasResumableSession = false;
        }
      },
      error: (error) => {
        this.isCheckingForResumableSession = false;
        console.error('Error checking for resumable session:', error);
        this.hasResumableSession = false;
      }
    });
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach(sub => sub.unsubscribe());
    if (this.currentSession && this.ownerId) {
      // Notify server that owner is disconnecting
      this.liveTranscriptionService.leaveSession(this.currentSession.session_id, this.ownerId);
      this.stopSession();
    }
    this.liveTranscriptionService.disconnect();
  }

  private async loadAudioDevices(): Promise<void> {
    try {
      // Request microphone permission first to get device labels
      const tempStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      tempStream.getTracks().forEach(track => track.stop());
      
      // Now get the actual device list
      const devices = await navigator.mediaDevices.enumerateDevices();
      this.availableMicDevices = devices.filter(device => device.kind === 'audioinput');
      console.log('Available microphone devices:', this.availableMicDevices);
      
      // Check browser capabilities for system audio
      this.checkBrowserCapabilities();
      
    } catch (error) {
      console.error('Error loading audio devices:', error);
      this.showError('Unable to access microphone devices. Please check permissions.');
    }
  }

  private checkBrowserCapabilities(): void {
    console.log('=== BROWSER CAPABILITIES CHECK ===');
    console.log('User Agent:', navigator.userAgent);
    console.log('getDisplayMedia supported:', !!navigator.mediaDevices.getDisplayMedia);
    console.log('Screen Capture API supported:', 'getDisplayMedia' in navigator.mediaDevices);
    
    // Check for specific browser features
    const userAgent = navigator.userAgent.toLowerCase();
    console.log('Browser detection:', {
      isChrome: userAgent.includes('chrome') && !userAgent.includes('edge'),
      isEdge: userAgent.includes('edge'),
      isFirefox: userAgent.includes('firefox'),
      isSafari: userAgent.includes('safari') && !userAgent.includes('chrome')
    });
    
    // Test if we can access screen capture permissions
    if (navigator.permissions) {
      navigator.permissions.query({ name: 'camera' as any }).then(result => {
        console.log('Camera permission state:', result.state);
      }).catch(err => {
        console.log('Permission query not supported');
      });
    }
    
    console.log('=== END CAPABILITIES CHECK ===');
  }

  private setupSubscriptions(): void {
    console.log('=== SETTING UP SUBSCRIPTIONS ===');
    
    // Connection status
    this.subscriptions.push(
      this.liveTranscriptionService.getConnectionStatus().subscribe(
        connected => {
          const wasConnected = this.isConnected;
          console.log('Connection status changed:', connected, 'Was connected:', wasConnected);
          this.isConnected = connected;
          if (connected) {
            this.showSuccess('Connected to live transcription server');
            // Check for resumable sessions when we connect
            if (this.ownerId && !this.currentSession && !this.isCheckingForResumableSession && !wasConnected) {
              console.log('Triggering check for resumable session...');
              this.checkForResumableSession();
            }
          } else {
            this.showError('Disconnected from server');
          }
        }
      )
    );

    // Current session
    this.subscriptions.push(
      this.liveTranscriptionService.getCurrentSession().subscribe(
        session => {
          console.log('Current session changed:', session?.session_id);
          this.currentSession = session;
        }
      )
    );

    // Session resumed
    this.subscriptions.push(
      this.liveTranscriptionService.getSessionResumed().subscribe(
        data => {
          console.log('Session resumed event received:', data);
          this.handleSessionResumed(data);
        }
      )
    );

    // Transcript updates
    this.subscriptions.push(
      this.liveTranscriptionService.getTranscriptUpdates().subscribe(
        updates => {
          console.log('Transcript updates subscription triggered with', updates.length, 'updates');
          this.handleTranscriptUpdates(updates);
        },
        error => {
          console.error('Transcript updates subscription error:', error);
        }
      )
    );

    // Current transcript (full history)
    this.subscriptions.push(
      this.liveTranscriptionService.getCurrentTranscript().subscribe(
        data => {
          console.log('Current transcript subscription triggered for session', data.session_id, 'with', data.updates.length, 'updates');
          this.handleCurrentTranscript(data.updates);
        },
        error => {
          console.error('Current transcript subscription error:', error);
        }
      )
    );

    // Errors
    this.subscriptions.push(
      this.liveTranscriptionService.getErrors().subscribe(
        error => {
          console.log('Error subscription triggered:', error);
          this.showError(`WebSocket error: ${error}`);
        }
      )
    );
    
    console.log('Total subscriptions created:', this.subscriptions.length);
    console.log('=== SUBSCRIPTIONS SETUP COMPLETE ===');
  }

  private handleTranscriptUpdates(updates: TranscriptUpdate[]): void {
    console.log('=== TRANSCRIPT UPDATES DEBUG ===');
    console.log('Received updates count:', updates.length);
    console.log('Current session:', this.currentSession?.session_id);
    console.log('Is recording:', this.isRecording);
    console.log('Is paused:', this.isPaused);
    console.log('Current transcript lines before update:', this.transcriptLines.length);
    
    updates.forEach((update, index) => {
      console.log(`Update ${index + 1}:`, {
        timestamp: update.timestamp,
        text: update.text?.substring(0, 100) + (update.text?.length > 100 ? '...' : ''),
        textLength: update.text?.length
      });
      
      const transcriptLine = `[${update.timestamp}] ${update.text}`;
      this.transcriptLines.push(transcriptLine);
      console.log(`Added line ${this.transcriptLines.length}:`, transcriptLine.substring(0, 100));
    });
    
    this.fullTranscript = this.transcriptLines.join('\n');
    console.log('Full transcript length after update:', this.fullTranscript.length);
    console.log('Total transcript lines after update:', this.transcriptLines.length);
    console.log('=== END TRANSCRIPT UPDATES DEBUG ===');
    
    // Auto-scroll to bottom
    setTimeout(() => this.scrollToBottom(), 100);
  }

  private handleCurrentTranscript(updates: TranscriptUpdate[]): void {
    console.log('=== CURRENT TRANSCRIPT DEBUG ===');
    console.log('Received current transcript with', updates.length, 'updates');
    console.log('Current session:', this.currentSession?.session_id);
    console.log('Existing transcript lines before replacement:', this.transcriptLines.length);
    
    // Replace the entire transcript with the current one
    this.transcriptLines = [];
    
    updates.forEach((update, index) => {
      console.log(`Current transcript update ${index + 1}:`, {
        timestamp: update.timestamp,
        text: update.text?.substring(0, 100) + (update.text?.length > 100 ? '...' : ''),
        textLength: update.text?.length
      });
      
      const transcriptLine = `[${update.timestamp}] ${update.text}`;
      this.transcriptLines.push(transcriptLine);
    });
    
    this.fullTranscript = this.transcriptLines.join('\n');
    console.log('Full transcript length after replacement:', this.fullTranscript.length);
    console.log('Total transcript lines after replacement:', this.transcriptLines.length);
    console.log('=== END CURRENT TRANSCRIPT DEBUG ===');
    
    // Auto-scroll to bottom
    setTimeout(() => this.scrollToBottom(), 100);
  }

  private scrollToBottom(): void {
    const transcriptArea = document.querySelector('.transcript-area');
    if (transcriptArea) {
      transcriptArea.scrollTop = transcriptArea.scrollHeight;
    }
  }

  checkHealth(): void {
    this.liveTranscriptionService.checkHealth().subscribe({
      next: (response) => {
        console.log('Unified transcription server is healthy:', response);
      },
      error: (error) => {
        this.showError('Unified transcription server is not available. Please ensure it is running on port 5000.');
      }
    });
  }

  createSession(): void {
    if (this.isCreatingSession || this.currentSession) {
      return;
    }

    this.isCreatingSession = true;
    console.log('Creating new session with owner ID:', this.ownerId);

    this.liveTranscriptionService.createSession(this.ownerId || undefined).subscribe({
      next: (response: LiveSessionResponse) => {
        this.isCreatingSession = false;
        
        if (response.success && response.session_id) {
          const session: LiveSession = {
            session_id: response.session_id,
            created_at: new Date(),
            is_active: false,
            owner_id: response.owner_id
          };
          
          this.currentSession = session;
          
          // Update owner ID if it was generated server-side
          if (response.owner_id && response.owner_id !== this.ownerId) {
            this.ownerId = response.owner_id;
            localStorage.setItem('live-transcription-owner-id', this.ownerId);
          }
          
          // Clear any resumable session state
          this.clearResumableSession();
          
          this.showSuccess(`Session created: ${response.session_id.substring(0, 8)}...`);
          
          // Join the session as owner
          this.liveTranscriptionService.joinSession(response.session_id, this.ownerId || undefined);
          
          console.log('Session created successfully:', session);
          console.log('Button states after creation:', {
            canCreateSession: this.canCreateSession(),
            canStartRecording: this.canStartRecording(),
            isCreatingSession: this.isCreatingSession
          });
        } else {
          this.showError(response.error || 'Failed to create session');
        }
      },
      error: (error) => {
        this.isCreatingSession = false;
        console.error('Error creating session:', error);
        
        // Check if it's an authentication error
        if (error.status === 401) {
          this.showAuthDialog('Create Session', 'Admin authentication is required to create new sessions.').then(authenticated => {
            if (authenticated) {
              // Retry the operation after successful authentication
              this.createSession();
            }
          });
        } else {
          this.showError('Failed to create session: ' + (error.error?.error || error.message));
        }
      }
    });
  }

  toggleSharing(): void {
    if (!this.currentSession) return;

    if (this.isShared) {
      // Disable sharing
      this.liveTranscriptionService.disableSharing(this.currentSession.session_id).subscribe({
        next: (response) => {
          if (response.success) {
            this.isShared = false;
            this.shareUrl = '';
            this.showSuccess('Session sharing disabled');
          } else {
            this.showError('Failed to disable sharing');
          }
        },
        error: (error) => {
          console.error('Error disabling sharing:', error);
          if (error.status === 401) {
            this.showAuthDialog('Disable Sharing', 'Admin authentication is required to disable sharing.').then(authenticated => {
              if (authenticated) {
                this.toggleSharing();
              }
            });
          } else {
            this.showError('Failed to disable sharing');
          }
        }
      });
    } else {
      // Enable sharing
      this.liveTranscriptionService.enableSharing(this.currentSession.session_id).subscribe({
        next: (response) => {
          if (response.success) {
            this.isShared = true;
            this.shareUrl = `${window.location.origin}/shared/${this.currentSession!.session_id}`;
            this.showSuccess('Session sharing enabled!');
            this.copyShareLink();
          } else {
            this.showError('Failed to enable sharing');
          }
        },
        error: (error) => {
          console.error('Error enabling sharing:', error);
          if (error.status === 401) {
            this.showAuthDialog('Enable Sharing', 'Admin authentication is required to enable sharing.').then(authenticated => {
              if (authenticated) {
                this.toggleSharing();
              }
            });
          } else {
            this.showError('Failed to enable sharing');
          }
        }
      });
    }
  }

  private copyShareLink(): void {
    if (this.shareUrl) {
      navigator.clipboard.writeText(this.shareUrl).then(() => {
        this.showSuccess('Share link copied to clipboard!');
      }).catch(() => {
        this.showInfo(`Share link: ${this.shareUrl}`);
      });
    }
  }

  private checkSharingStatus(): void {
    if (!this.currentSession) return;

    this.liveTranscriptionService.getShareInfo(this.currentSession.session_id).subscribe({
      next: (response) => {
        if (response.success) {
          this.isShared = response.is_shared;
          if (this.isShared && response.share_url) {
            this.shareUrl = `${window.location.origin}${response.share_url}`;
          }
        }
      },
      error: (error) => {
        console.error('Error checking sharing status:', error);
      }
    });
  }

  startSession(): void {
    if (!this.currentSession) {
      this.showError('No active session. Please create a new session first.');
      return;
    }

    if (this.isRecording) {
      this.showError('Recording is already in progress');
      return;
    }

    console.log('=== START SESSION DEBUG ===');
    console.log('Session ID:', this.currentSession.session_id);
    console.log('Is paused:', this.isPaused);
    console.log('Is connected:', this.isConnected);
    console.log('Current transcript lines:', this.transcriptLines.length);

    // Show audio source selection dialog
    this.showAudioSourceSelection();
  }

  private showAudioSourceSelection(): void {
    if (this.availableMicDevices.length === 0) {
      this.showError('No microphone devices available. Please check your audio setup.');
      return;
    }

    const dialogRef = this.dialog.open(AudioSourceDialogComponent, {
      width: '500px',
      panelClass: 'dark-dialog',
      data: { audioDevices: this.availableMicDevices }
    });

    dialogRef.afterClosed().subscribe((result: AudioSourceSelection) => {
      if (result) {
        const includeSystemAudio = result.sourceType === 'both';
        const includeSystemOnly = result.sourceType === 'system-only';
        const useMicrophone = result.sourceType === 'microphone' || result.sourceType === 'both';
        
        const micDeviceId = useMicrophone ? (result.deviceId || this.availableMicDevices[0]?.deviceId) : '';
        
        this.startRecordingWithSources(
          micDeviceId, 
          includeSystemAudio || includeSystemOnly, 
          useMicrophone
        );
      }
    });
  }

  private startRecordingWithSources(
    micDeviceId: string, 
    includeSystemAudio: boolean, 
    useMicrophone: boolean = true
  ): void {
    this.liveTranscriptionService.startSession(this.currentSession!.session_id).subscribe({
      next: (response) => {
        console.log('Start session response:', response);
        if (response.success) {
          const wasResuming = this.isPaused;
          this.isRecording = true;
          this.isPaused = false;
          this.showSuccess(wasResuming ? 'Recording resumed' : 'Live transcription started');
          console.log('Starting audio capture...');
          this.startAudioCapture(micDeviceId, includeSystemAudio, useMicrophone);
          
          // Only request current transcript if this is NOT a resume
          if (!wasResuming) {
            console.log('Fresh start - requesting current transcript...');
            setTimeout(() => {
              this.liveTranscriptionService.requestCurrentTranscript(this.currentSession!.session_id);
            }, 1000);
          } else {
            console.log('Resuming - keeping existing transcript, waiting for new updates...');
          }
        } else {
          console.error('Start session failed:', response.error);
          this.showError(response.error || 'Failed to start session');
        }
      },
      error: (error) => {
        console.error('Start session error:', error);
        if (error.status === 401) {
          this.showAuthDialog('Start Recording', 'Admin authentication is required to start recording.').then(authenticated => {
            if (authenticated) {
              this.startRecordingWithSources(micDeviceId, includeSystemAudio, useMicrophone);
            }
          });
        } else {
          this.showError('Failed to start session');
        }
      }
    });
  }

  private async startAudioCapture(micDeviceId: string, includeSystemAudio: boolean, useMicrophone: boolean = true): Promise<void> {
    try {
      console.log('Starting audio capture with microphone:', useMicrophone, 'system audio:', includeSystemAudio);
      
      // Get microphone access with specific device (only if needed)
      if (useMicrophone && micDeviceId) {
        this.microphoneStream = await navigator.mediaDevices.getUserMedia({ 
          audio: {
            deviceId: micDeviceId,
            sampleRate: 16000,
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          } 
        });
        console.log('Microphone stream obtained successfully');
      } else {
        console.log('Skipping microphone setup - audio-only mode');
        this.microphoneStream = null;
      }
      
      // Try to get system audio if requested
      if (includeSystemAudio) {
        try {
          console.log('Attempting to capture system audio...');
          
          // Build common audio constraints
          const commonAudioConstraints: MediaTrackConstraints = {
            channelCount: 1,
            sampleRate: 16000,
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false
          };
          
          this.systemStream = await this.captureDisplayAudio(commonAudioConstraints);
          
          if (!this.systemStream) {
            throw new Error('System audio stream not available after capture attempt');
          }
          
          // Verify audio tracks
          const audioTracks = this.systemStream.getAudioTracks();
          console.log('System audio tracks:', audioTracks);
          
          if (audioTracks.length === 0) {
            console.warn('No audio tracks in system stream');
            this.systemStream.getTracks().forEach(track => track.stop());
            this.systemStream = null;
            throw new Error('No audio tracks available from selected source');
          }
          
          // Check audio track capabilities
          const audioTrack = audioTracks[0];
          console.log('Audio track settings:', audioTrack.getSettings());
          console.log('Audio track capabilities:', audioTrack.getCapabilities());
          
          console.log('System audio stream obtained successfully');
          this.showSuccess('System audio capture enabled!');
          
        } catch (systemError: any) {
          console.error('System audio capture failed:', systemError);
          
          // Provide specific error messages based on error type
          let errorMessage = 'System audio capture failed. Using microphone only.';
          
          if (systemError.name === 'NotAllowedError') {
            errorMessage = 'Screen sharing permission denied. Please allow screen sharing and try again.';
          } else if (systemError.name === 'NotSupportedError') {
            errorMessage = 'System audio capture not supported in this browser. Try Chrome or Edge for best compatibility.';
          } else if (systemError.name === 'NotFoundError') {
            errorMessage = 'No screen/window available for audio capture. Make sure applications with audio are running.';
          } else if (systemError.name === 'AbortError') {
            errorMessage = 'Screen sharing cancelled by user. Using microphone only.';
          } else if (systemError.name === 'TypeError') {
            errorMessage = 'Browser does not support system audio capture. Try Chrome or Edge.';
          } else if (systemError.message?.includes('not supported')) {
            errorMessage = 'System audio capture not supported. Try enabling "Experimental Web Platform features" in Chrome flags.';
          } else if (systemError.message?.includes('audio tracks')) {
            errorMessage = 'Selected source has no audio. Please select a window with active audio.';
          } else if (systemError.message) {
            errorMessage = `System audio capture failed: ${systemError.message}. Using microphone only.`;
          }
          
          this.showError(errorMessage);
          
          // Show browser-specific help
          this.showBrowserSpecificHelp();
        }
      }

      // Create Audio Context with proper sample rate
      this.audioContext = new AudioContext({ 
        sampleRate: 48000 // Use native sample rate, we'll downsample in worklet
      });
      
      // Load and setup AudioWorklet
      await this.setupAudioWorklet();
      
      // Create source nodes
      let microphoneSource: MediaStreamAudioSourceNode | null = null;
      if (this.microphoneStream) {
        microphoneSource = this.audioContext.createMediaStreamSource(this.microphoneStream);
      }
      let systemSource: MediaStreamAudioSourceNode | null = null;
      
      // Create a mixer to combine audio sources
      this.mixerNode = this.audioContext.createGain();
      this.mixerNode.gain.value = 1.0;
      
      // Connect microphone if available
      if (microphoneSource) {
        microphoneSource.connect(this.mixerNode);
        console.log('Microphone connected to mixer');
      }
      
      // Connect system audio if available
      if (this.systemStream) {
        systemSource = this.audioContext.createMediaStreamSource(this.systemStream);
        systemSource.connect(this.mixerNode);
        console.log('System audio connected to mixer');
      }
      
      // Ensure we have at least one audio source
      if (!microphoneSource && !systemSource) {
        throw new Error('No audio sources available');
      }
      
      // Connect to AudioWorklet or ScriptProcessor
      this.mixerNode.connect(this.audioWorkletNode!);
      // DO NOT connect to destination to avoid hearing yourself
      // this.audioWorkletNode!.connect(this.audioContext.destination);
      
      // Store the first available source for cleanup
      this.sourceNode = microphoneSource || systemSource;
      
      // Reset audio buffers and counter
      this.audioBuffer = [];
      this.chunkCounter = 0;
      
      // Start MediaRecorder for fallback/debugging (only if we have microphone)
      if (this.microphoneStream) {
        this.startMediaRecorderFallback();
      }
      
      // Update audio source info
      let audioSourceDesc = '';
      
      if (this.microphoneStream && this.systemStream) {
        const micDevice = this.availableMicDevices.find(d => d.deviceId === micDeviceId);
        const micName = micDevice?.label || 'Default microphone';
        audioSourceDesc = `${micName} + System Audio`;
      } else if (this.microphoneStream) {
        const micDevice = this.availableMicDevices.find(d => d.deviceId === micDeviceId);
        audioSourceDesc = micDevice?.label || 'Default microphone';
      } else if (this.systemStream) {
        audioSourceDesc = 'System Audio Only';
      }
      
      this.audioSourceInfo = audioSourceDesc;
      
      this.showSuccess(`Audio capture started: ${this.audioSourceInfo}`);
      
    } catch (error: any) {
      console.error('Error starting audio capture:', error);
      
      // Clean up any partially created resources
      this.cleanupAudioResources();
      
      // Provide specific error messages
      let errorMessage = 'Failed to start audio capture: ';
      
      if (error.message?.includes('NotAllowedError') || error.name === 'NotAllowedError') {
        errorMessage += 'Please allow microphone permission in your browser.';
      } else if (error.message?.includes('NotFoundError') || error.name === 'NotFoundError') {
        errorMessage += 'No microphone device found. Please check your audio setup.';
      } else if (error.message?.includes('AudioWorklet') || error.message?.includes('ScriptProcessor')) {
        errorMessage += 'Audio processing initialization failed. Please try refreshing the page.';
      } else {
        errorMessage += error.message || 'Unknown error occurred.';
      }
      
      this.showError(errorMessage);
      this.isRecording = false;
    }
  }

  private cleanupAudioResources(): void {
    try {
      if (this.audioWorkletNode) {
        this.audioWorkletNode.disconnect();
        this.audioWorkletNode = null;
      }
      
      if (this.mixerNode) {
        this.mixerNode.disconnect();
        this.mixerNode = null;
      }
      
      if (this.sourceNode) {
        this.sourceNode.disconnect();
        this.sourceNode = null;
      }
      
      if (this.audioContext) {
        this.audioContext.close();
        this.audioContext = null;
      }
      
      if (this.microphoneStream) {
        this.microphoneStream.getTracks().forEach(track => track.stop());
        this.microphoneStream = null;
      }
      
      if (this.systemStream) {
        this.systemStream.getTracks().forEach(track => track.stop());
        this.systemStream = null;
      }
      
      if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
        this.mediaRecorder.stop();
        this.mediaRecorder = null;
      }
      
      this.audioSourceInfo = '';
    } catch (cleanupError) {
      console.warn('Error during audio resource cleanup:', cleanupError);
    }
  }

  private async setupAudioWorklet(): Promise<void> {
    try {
      if (!this.audioContext) {
        throw new Error('AudioContext not initialized');
      }

      console.log('Loading AudioWorklet using audio-worklet-loader...');
      
      try {
        // Use the imported worklet URL from audio-worklet-loader
        await this.audioContext.audioWorklet.addModule(audioProcessorWorkletUrl);
        console.log('AudioWorklet loaded successfully from audio-worklet-loader');
        
        // Create AudioWorkletNode
        this.audioWorkletNode = new AudioWorkletNode(this.audioContext, 'audio-processor');
        
        // Listen for processed audio data
        this.audioWorkletNode.port.onmessage = (event) => {
          if (event.data.type === 'audioData') {
            this.handleAudioData(event.data.data);
          }
        };
        
        console.log('AudioWorklet setup completed successfully');
        
      } catch (workletError) {
        console.error('AudioWorklet loading failed:', workletError);
        throw workletError;
      }
      
    } catch (error) {
      console.error('Failed to setup AudioWorklet:', error);
      console.log('Falling back to ScriptProcessorNode (deprecated but functional)');
      
      // Fallback to ScriptProcessorNode when AudioWorklet fails
      this.setupScriptProcessorFallback();
    }
  }

  private setupScriptProcessorFallback(): void {
    try {
      if (!this.audioContext) {
        throw new Error('AudioContext not initialized for fallback');
      }

      console.log('Setting up ScriptProcessorNode fallback');
      
      // Create script processor node as fallback
      const bufferSize = 4096;
      const processorNode = this.audioContext.createScriptProcessor(bufferSize, 1, 1);
      
      // Process raw audio data
      processorNode.onaudioprocess = (event) => {
        if (this.currentSession && this.isRecording) {
          const inputBuffer = event.inputBuffer;
          const channelData = inputBuffer.getChannelData(0);
          
          // Simple downsampling for 16kHz (assuming 48kHz input)
          const downsampleRatio = this.audioContext!.sampleRate / 16000;
          const outputLength = Math.floor(channelData.length / downsampleRatio);
          const downsampledData = new Float32Array(outputLength);
          
          for (let i = 0; i < outputLength; i++) {
            const sourceIndex = Math.floor(i * downsampleRatio);
            downsampledData[i] = channelData[sourceIndex];
          }
          
          this.handleAudioData(downsampledData);
        }
      };
      
      // Store the processor node for connection and cleanup
      this.audioWorkletNode = processorNode as any; // Type assertion for compatibility
      
      console.log('ScriptProcessorNode fallback setup completed');
      
    } catch (error) {
      console.error('Failed to setup ScriptProcessorNode fallback:', error);
      throw new Error('Both AudioWorklet and ScriptProcessorNode setup failed');
    }
  }

  private handleAudioData(audioData: Float32Array): void {
    if (this.currentSession && this.isRecording) {
      // Store audio data for streaming
      this.audioBuffer.push(new Float32Array(audioData));
      
      // Store complete recording
      this.completeRawBuffer.push(new Float32Array(audioData));
      
      // Calculate total samples
      const totalSamples = this.audioBuffer.reduce((sum, chunk) => sum + chunk.length, 0);
      
      // Send audio chunk every ~5 seconds
      if (totalSamples >= this.CHUNK_DURATION_SAMPLES) {
        if (!this.isProcessingChunk) {
          this.isProcessingChunk = true;
          
          try {
            this.processRawAudioBuffer();
            this.audioBuffer = [];
          } catch (error) {
            console.error('Error in chunk processing:', error);
            this.audioBuffer = [];
          } finally {
            this.isProcessingChunk = false;
          }
        }
      }
      
      // Emergency safety: if buffer gets too large, force clear it
      if (totalSamples > this.CHUNK_DURATION_SAMPLES * 2) {
        console.warn('Audio buffer too large, forcing clear');
        this.audioBuffer = [];
      }
    }
  }

  private startMediaRecorderFallback(): void {
    try {
      if (!this.microphoneStream) return;
      
      this.mediaRecorder = new MediaRecorder(this.microphoneStream, {
        mimeType: 'audio/webm;codecs=opus'
      });

      this.audioChunks = [];

      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          this.audioChunks.push(event.data);
        }
      };

      this.mediaRecorder.start(5000); // Record in 5-second chunks
      console.log('MediaRecorder fallback started with 5-second intervals');
      
    } catch (error) {
      console.error('MediaRecorder fallback failed:', error);
    }
  }

  private processRawAudioBuffer(): void {
    if (!this.currentSession || this.audioBuffer.length === 0) return;

    try {
      // Calculate current buffer size
      const currentBufferSamples = this.audioBuffer.reduce((sum, chunk) => sum + chunk.length, 0);
      
      console.log(`=== CHUNK PROCESSING DEBUG ===`);
      console.log(`Processing audio buffer: ${(currentBufferSamples / 16000).toFixed(1)}s (${currentBufferSamples} samples, ${this.audioBuffer.length} chunks)`);
      
      // Combine all audio chunks into a single buffer
      const combinedAudioBuffer = new Float32Array(currentBufferSamples);
      
      let offset = 0;
      for (const chunk of this.audioBuffer) {
        combinedAudioBuffer.set(chunk, offset);
        offset += chunk.length;
      }
      
      // Convert Float32Array to Int16Array (16-bit PCM)
      const pcmData = new Int16Array(combinedAudioBuffer.length);
      for (let i = 0; i < combinedAudioBuffer.length; i++) {
        // Clamp to [-1, 1] and convert to 16-bit
        const sample = Math.max(-1, Math.min(1, combinedAudioBuffer[i]));
        pcmData[i] = sample * 0x7FFF;
      }
      
      // Convert to bytes
      const audioBytes = new Uint8Array(pcmData.buffer);
      
      console.log(`Final audio bytes: ${audioBytes.length} bytes`);
      console.log(`Expected for ${(currentBufferSamples / 16000).toFixed(1)}s: ${(currentBufferSamples * 2).toFixed(0)} bytes (16-bit PCM)`);
      
      // Convert to base64
      const base64Audio = this.arrayBufferToBase64(audioBytes);
      console.log(`Base64 conversion result: ${base64Audio.length} characters`);
      console.log(`Base64 sample: ${base64Audio.substring(0, 50)}...`);
      console.log(`=== END DEBUG ===`);
      
      // Send to server
      this.liveTranscriptionService.sendAudioChunk(
        this.currentSession.session_id, 
        base64Audio
      );
      
    } catch (error) {
      console.error('Error processing audio buffer:', error);
    }
  }

  private arrayBufferToBase64(buffer: Uint8Array): string {
    try {
      console.log(`Converting ${buffer.length} bytes to base64...`);
      
      // For smaller buffers, use the direct method
      if (buffer.length < 50000) {
        console.log('Using direct conversion method');
        const binaryString = Array.from(buffer, byte => String.fromCharCode(byte)).join('');
        const result = btoa(binaryString);
        console.log(`Direct conversion completed: ${result.length} chars`);
        return result;
      }
      
      console.log('Using chunked conversion method');
      
      // For larger buffers, use a chunking approach
      let binary = '';
      const chunkSize = 32768; // 32KB chunks (safe for String.fromCharCode)
      const totalChunks = Math.ceil(buffer.length / chunkSize);
      console.log(`Processing ${totalChunks} chunks of ${chunkSize} bytes each`);
      
      for (let i = 0; i < buffer.length; i += chunkSize) {
        const chunk = buffer.slice(i, i + chunkSize);
        // Convert chunk to string character by character (safer than apply)
        let chunkString = '';
        for (let j = 0; j < chunk.length; j++) {
          chunkString += String.fromCharCode(chunk[j]);
        }
        binary += chunkString;
        
        if ((i / chunkSize + 1) % 10 === 0) {
          console.log(`Processed chunk ${i / chunkSize + 1}/${totalChunks}`);
        }
      }
      
      console.log(`Binary string length: ${binary.length}, encoding to base64...`);
      
      // Now encode the complete binary string as base64
      const result = btoa(binary);
      console.log(`Chunked conversion completed: ${result.length} chars`);
      return result;
      
    } catch (error) {
      console.error('Error converting to base64:', error);
      
      // Ultimate fallback: convert byte by byte
      try {
        console.log('Using byte-by-byte fallback conversion');
        let binary = '';
        for (let i = 0; i < buffer.length; i++) {
          binary += String.fromCharCode(buffer[i]);
        }
        const result = btoa(binary);
        console.log(`Fallback conversion completed: ${result.length} chars`);
        return result;
      } catch (finalError) {
        console.error('Final fallback base64 conversion failed:', finalError);
        throw new Error('Failed to convert audio to base64');
      }
    }
  }

  private createWavFile(audioData: Uint8Array, sampleRate: number, channels: number, bitsPerSample: number): Uint8Array {
    const byteRate = sampleRate * channels * bitsPerSample / 8;
    const blockAlign = channels * bitsPerSample / 8;
    const dataSize = audioData.length;
    const fileSize = 36 + dataSize;
    
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);
    
    // WAV header
    const writeString = (offset: number, string: string) => {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
      }
    };
    
    writeString(0, 'RIFF');
    view.setUint32(4, fileSize, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, channels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitsPerSample, true);
    writeString(36, 'data');
    view.setUint32(40, dataSize, true);
    
    // Audio data
    const audioView = new Uint8Array(buffer, 44);
    audioView.set(audioData);
    
    return new Uint8Array(buffer);
  }

  private downloadBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    
    URL.revokeObjectURL(url);
  }

  private stopAudioCapture(): void {
    // Accumulate audio from this recording session
    if (this.completeRawBuffer.length > 0) {
      this.accumulatedRawBuffer.push(...this.completeRawBuffer);
      console.log(`Accumulated raw audio chunks: ${this.accumulatedRawBuffer.length} total`);
    }
    
    if (this.audioChunks.length > 0) {
      this.accumulatedAudioChunks.push(...this.audioChunks);
      console.log(`Accumulated MediaRecorder chunks: ${this.accumulatedAudioChunks.length} total`);
    }
    
    // Stop AudioWorklet
    if (this.audioWorkletNode) {
      this.audioWorkletNode.disconnect();
      this.audioWorkletNode = null;
    }
    
    // Stop mixer and source nodes
    if (this.mixerNode) {
      this.mixerNode.disconnect();
      this.mixerNode = null;
    }
    
    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }
    
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
    
    // Stop MediaRecorder
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop();
    }
    this.mediaRecorder = null;
    
    // Stop audio streams
    if (this.microphoneStream) {
      this.microphoneStream.getTracks().forEach(track => track.stop());
      this.microphoneStream = null;
    }
    
    if (this.systemStream) {
      this.systemStream.getTracks().forEach(track => track.stop());
      this.systemStream = null;
    }
    
    // Clear current session buffers (but keep accumulated ones)
    this.audioChunks = [];
    this.audioBuffer = [];
    this.completeRawBuffer = [];
    this.isProcessingChunk = false;
    this.audioSourceInfo = '';
    
    this.showInfo(`Recording stopped. Total accumulated audio: ${this.accumulatedAudioChunks.length + this.accumulatedRawBuffer.length} chunks`);
  }

  // Status methods
  getStatusText(): string {
    if (!this.isConnected) return 'Disconnected';
    if (this.isProcessingSummary) return 'Processing Summary...';
    if (!this.currentSession) return 'No active session';
    if (this.isRecording) return 'Recording...';
    if (this.isPaused) return 'Paused';
    return 'Ready';
  }

  getStatusColor(): string {
    if (!this.isConnected) return 'warn';
    if (this.isProcessingSummary) return 'accent';
    if (!this.currentSession) return 'accent';
    if (this.isRecording) return 'primary';
    return 'primary';
  }

  // Helper methods for button states
  canCreateSession(): boolean {
    console.log('canCreateSession check:', {
      isConnected: this.isConnected,
      isCreatingSession: this.isCreatingSession,
      currentSession: this.currentSession,
      isProcessingSummary: this.isProcessingSummary,
      hasResumableSession: this.hasResumableSession
    });
    
    return this.isConnected && 
           !this.isCreatingSession && 
           !this.currentSession && 
           !this.isProcessingSummary &&
           !this.hasResumableSession; // Don't allow creating new session if resumable one exists
  }

  canStartRecording(): boolean {
    return !!this.currentSession && !this.isRecording && !this.isProcessingSummary;
  }

  canStopRecording(): boolean {
    return !!this.currentSession && this.isRecording && !this.isProcessingSummary;
  }

  canEndSession(): boolean {
    return !!this.currentSession && !this.isProcessingSummary;
  }

  getRecordingButtonText(): string {
    return this.isPaused ? 'Resume Recording' : 'Start Recording';
  }

  getEndSessionButtonText(): string {
    return this.isProcessingSummary ? 'Processing...' : 'End Session';
  }

  hasAccumulatedAudio(): boolean {
    return this.accumulatedAudioChunks.length > 0 || this.accumulatedRawBuffer.length > 0;
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

  private showInfo(message: string): void {
    this.snackBar.open(message, 'Close', {
      duration: 3000,
      panelClass: ['info-snackbar']
    });
  }

  private showAuthDialog(title: string, message: string): Promise<boolean> {
    const dialogRef = this.dialog.open(AuthDialogComponent, {
      width: '400px',
      panelClass: 'dark-dialog',
      data: { title, message }
    });

    return dialogRef.afterClosed().toPromise().then((result: boolean) => result || false);
  }

  trackByLine(index: number, line: string): number {
    return index;
  }

  extractTimestamp(line: string): string | null {
    const timestampMatch = line.match(/^\[(\d{2}:\d{2}:\d{2})\]/);
    return timestampMatch ? timestampMatch[1] : null;
  }

  removeTimestamp(line: string): string {
    return line.replace(/^\[\d{2}:\d{2}:\d{2}\]\s*/, '');
  }

  stopSession(): void {
    if (!this.currentSession || !this.isRecording) {
      return;
    }

    console.log('Stopping session:', this.currentSession.session_id);
    this.isRecording = false;
    
    // Stop audio capture first
    this.stopAudioCapture();
    
    // Stop the session on server
    this.liveTranscriptionService.stopSession(this.currentSession.session_id).subscribe({
      next: (response) => {
        if (response.success) {
          this.currentSession!.is_active = false;
          this.isPaused = true; // Mark as paused so user can resume later
          this.showSuccess('Recording stopped');
          console.log('Session stopped successfully');
        } else {
          this.showError(response.error || 'Failed to stop session');
        }
      },
      error: (error) => {
        console.error('Error stopping session:', error);
        if (error.status === 401) {
          this.showAuthDialog('Stop Recording', 'Admin authentication is required to stop recording.').then(authenticated => {
            if (authenticated) {
              this.stopSession();
            }
          });
        } else {
          this.showError('Failed to stop session');
        }
      }
    });
  }

  endSession(): void {
    if (!this.currentSession) {
      this.showError('No active session');
      return;
    }

    // Stop recording if it's in progress
    if (this.isRecording) {
      this.stopSession();
    }

    // Ask if user wants to generate summary
    const dialogRef = this.dialog.open(ConfirmationDialogComponent, {
      width: '400px',
      panelClass: 'dark-dialog',
      data: {
        title: 'End Session',
        message: 'Would you like to generate a summary and analysis of this session?',
        subMessage: 'This will process all recorded audio using our AI analysis.',
        confirmText: 'Generate Summary',
        cancelText: 'End'
      }
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result === true) {
        // User wants summary - process accumulated audio
        this.generateSessionSummary();
      } else {
        // End session without summary
        this.finalizeEndSession();
      }
    });
  }

  private async generateSessionSummary(): Promise<void> {
    if (!this.currentSession || !this.ownerId) {
      this.showError('No session or owner information available');
      this.finalizeEndSession();
      return;
    }

    this.isProcessingSummary = true;
    this.showInfo('Processing session audio for analysis...');

    console.log('Generating summary for session:', this.currentSession.session_id);

    try {
      // First, try to get the complete session audio (including persisted data)
      this.liveTranscriptionService.getSessionAudioForSummary(this.currentSession.session_id, this.ownerId).subscribe({
        next: (audioResponse) => {
          console.log('Audio summary response:', audioResponse);
          
          if (audioResponse.success && audioResponse.audio_file_path) {
            // Use server-side complete audio file
            console.log(`Using server-side audio file: ${audioResponse.audio_file_path} (${audioResponse.duration_seconds}s)`);
            this.processServerAudioFile(audioResponse.audio_file_path, audioResponse.duration_seconds || 0);
          } else {
            // Fallback to client-side accumulated audio
            console.log('No server-side audio available, using client-side accumulated audio');
            console.log('Accumulated raw buffer chunks:', this.accumulatedRawBuffer.length);
            console.log('Accumulated media recorder chunks:', this.accumulatedAudioChunks.length);
            this.processClientSideAudio();
          }
        },
        error: (error) => {
          console.error('Error getting server audio:', error);
          // Fallback to client-side accumulated audio
          this.processClientSideAudio();
        }
      });

    } catch (error) {
      this.isProcessingSummary = false;
      this.showError('Failed to prepare audio for analysis');
      this.finalizeEndSession();
    }
  }

  private processServerAudioFile(audioFilePath: string, duration: number): void {
    // Download the audio file from the server
    this.showInfo(`Downloading ${duration.toFixed(1)}s of complete session audio...`);
    
    // Create URL for downloading the audio file
    const audioUrl = `http://localhost:5000/api/sessions/${this.currentSession!.session_id}/audio-file?owner_id=${this.ownerId}`;
    
    // Download the audio file
    fetch(audioUrl)
      .then(response => {
        if (!response.ok) {
          throw new Error('Failed to download audio file');
        }
        return response.blob();
      })
      .then(blob => {
        // Create a File object from the blob
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const finalAudioFile = new File([blob], `session-${this.currentSession!.session_id}-complete.wav`, { type: 'audio/wav' });
        
        console.log(`Downloaded complete audio file: ${finalAudioFile.size} bytes`);
        
        // Use the meeting service to transcribe and analyze
        this.meetingService.transcribeAudio(finalAudioFile).subscribe({
          next: (response: TranscriptionResponse) => {
            this.isProcessingSummary = false;
            this.showSuccess('Session analysis completed!');
            
            // Save the summary to the session
            if (this.currentSession && this.ownerId && response.summary) {
              // Save complete meeting analysis
              const analysisData = {
                transcript: response.transcript,
                chapters: response.chapters,
                takeaways: response.takeaways,
                summary: response.summary,
                notes: response.notes,
                filename: finalAudioFile.name,
                originalTranscript: this.fullTranscript,
                session_id: this.currentSession.session_id
              };
              
              this.liveTranscriptionService.saveMeetingAnalysis(
                this.currentSession.session_id,
                analysisData,
                this.ownerId
              ).subscribe({
                next: (saveResponse) => {
                  if (saveResponse.success) {
                    console.log('Meeting analysis saved successfully');
                    
                    // Enable sharing so the session can be viewed in the transcript list
                    if (!this.isShared) {
                      this.liveTranscriptionService.enableSharing(this.currentSession!.session_id).subscribe({
                        next: (shareResponse) => {
                          if (shareResponse.success) {
                            console.log('Session sharing enabled for transcript list');
                            this.isShared = true;
                          }
                        },
                        error: (error) => {
                          console.error('Error enabling sharing:', error);
                        }
                      });
                    }
                  } else {
                    console.error('Failed to save meeting analysis:', saveResponse.error);
                  }
                },
                error: (error) => {
                  console.error('Error saving meeting analysis:', error);
                }
              });
            }
            
            // Store the analysis results in session storage for the meeting analyzer
            sessionStorage.setItem('live-session-analysis', JSON.stringify({
              sessionId: this.currentSession!.session_id,
              transcript: response.transcript,
              chapters: response.chapters,
              takeaways: response.takeaways,
              summary: response.summary,
              notes: response.notes,
              filename: finalAudioFile.name,
              originalTranscript: this.fullTranscript
            }));
            
            // Show success message then navigate after a brief delay
            this.showSuccess('Analysis complete! Switching to Meeting Analyzer...');
            setTimeout(() => {
              this.finalizeEndSession();
              this.switchToMeetingAnalyzer.emit();
            }, 1500);
          },
          error: (error) => {
            this.isProcessingSummary = false;
            if (error.status === 401) {
              this.showAuthDialog('Meeting Analysis', 'Admin authentication is required to analyze the meeting.').then(authenticated => {
                if (authenticated) {
                  // Retry the entire summary generation process
                  this.generateSessionSummary();
                } else {
                  this.finalizeEndSession();
                }
              });
            } else {
              this.showError('Failed to analyze session audio: ' + (error.error?.error || error.message));
              this.finalizeEndSession();
            }
          }
        });
      })
      .catch(error => {
        console.error('Error downloading audio file:', error);
        this.showError('Failed to download complete audio. Falling back to current session audio...');
        // Fall back to client-side audio
        this.processClientSideAudio();
      });
  }

  private processClientSideAudio(): void {
    if (this.accumulatedAudioChunks.length === 0 && this.accumulatedRawBuffer.length === 0) {
      this.showError('No audio recorded to analyze');
      this.finalizeEndSession();
      return;
    }

    try {
      // Create a combined audio file from all accumulated chunks
      let finalAudioFile: File;

      // Prioritize raw buffer as it contains mixed audio (microphone + system)
      // MediaRecorder chunks only contain microphone audio
      if (this.accumulatedRawBuffer.length > 0) {
        // Use raw audio buffer (contains mixed audio: microphone + system)
        console.log('Using raw audio buffer for summary (contains mixed audio)');
        const wavBlob = this.createWavBlobFromRawBuffer(this.accumulatedRawBuffer);
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        finalAudioFile = new File([wavBlob], `live-session-${timestamp}.wav`, { type: 'audio/wav' });
      } else if (this.accumulatedAudioChunks.length > 0) {
        // Fallback to MediaRecorder chunks (microphone only)
        console.log('Using MediaRecorder chunks for summary (microphone only)');
        const combinedBlob = new Blob(this.accumulatedAudioChunks, { type: 'audio/webm' });
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        finalAudioFile = new File([combinedBlob], `live-session-${timestamp}.webm`, { type: 'audio/webm' });
      } else {
        throw new Error('No audio data available');
      }

      // Use the meeting service to transcribe and analyze
      this.meetingService.transcribeAudio(finalAudioFile).subscribe({
        next: (response: TranscriptionResponse) => {
          this.isProcessingSummary = false;
          this.showSuccess('Session analysis completed!');
          
          // Save the summary to the session
          if (this.currentSession && this.ownerId && response.summary) {
            // Save complete meeting analysis
            const analysisData = {
              transcript: response.transcript,
              chapters: response.chapters,
              takeaways: response.takeaways,
              summary: response.summary,
              notes: response.notes,
              filename: finalAudioFile.name,
              originalTranscript: this.fullTranscript,
              session_id: this.currentSession.session_id
            };
            
            this.liveTranscriptionService.saveMeetingAnalysis(
              this.currentSession.session_id,
              analysisData,
              this.ownerId
            ).subscribe({
              next: (saveResponse) => {
                if (saveResponse.success) {
                  console.log('Meeting analysis saved successfully');
                  
                  // Enable sharing so the session can be viewed in the transcript list
                  if (!this.isShared) {
                    this.liveTranscriptionService.enableSharing(this.currentSession!.session_id).subscribe({
                      next: (shareResponse) => {
                        if (shareResponse.success) {
                          console.log('Session sharing enabled for transcript list');
                          this.isShared = true;
                        }
                      },
                      error: (error) => {
                        console.error('Error enabling sharing:', error);
                      }
                    });
                  }
                } else {
                  console.error('Failed to save meeting analysis:', saveResponse.error);
                }
              },
              error: (error) => {
                console.error('Error saving meeting analysis:', error);
              }
            });
          }
          
          // Store the analysis results in session storage for the meeting analyzer
          sessionStorage.setItem('live-session-analysis', JSON.stringify({
            sessionId: this.currentSession!.session_id,
            transcript: response.transcript,
            chapters: response.chapters,
            takeaways: response.takeaways,
            summary: response.summary,
            notes: response.notes,
            filename: finalAudioFile.name,
            originalTranscript: this.fullTranscript
          }));
          
          // Show success message then navigate after a brief delay
          this.showSuccess('Analysis complete! Switching to Meeting Analyzer...');
          setTimeout(() => {
            this.finalizeEndSession();
            this.switchToMeetingAnalyzer.emit();
          }, 1500);
        },
        error: (error) => {
          this.isProcessingSummary = false;
          this.showError('Failed to analyze session audio: ' + (error.error?.error || error.message));
          this.finalizeEndSession();
        }
      });

    } catch (error) {
      this.isProcessingSummary = false;
      this.showError('Failed to prepare audio for analysis');
      this.finalizeEndSession();
    }
  }

  private createWavBlobFromRawBuffer(rawBuffer: Float32Array[]): Blob {
    // Combine all raw audio data
    const totalLength = rawBuffer.reduce((sum, chunk) => sum + chunk.length, 0);
    const combinedBuffer = new Float32Array(totalLength);
    
    let offset = 0;
    for (const chunk of rawBuffer) {
      combinedBuffer.set(chunk, offset);
      offset += chunk.length;
    }
    
    // Convert Float32Array to Int16Array (16-bit PCM)
    const pcmData = new Int16Array(combinedBuffer.length);
    for (let i = 0; i < combinedBuffer.length; i++) {
      const sample = Math.max(-1, Math.min(1, combinedBuffer[i]));
      pcmData[i] = sample * 0x7FFF;
    }
    
    // Convert to bytes and create WAV file
    const audioBytes = new Uint8Array(pcmData.buffer);
    const wavData = this.createWavFile(audioBytes, 16000, 1, 16);
    
    return new Blob([wavData], { type: 'audio/wav' });
  }

  private finalizeEndSession(): void {
    if (!this.currentSession) return;

    console.log('Finalizing end session for:', this.currentSession.session_id);
    
    this.liveTranscriptionService.deleteSession(this.currentSession.session_id).subscribe({
      next: (response) => {
        console.log('Delete session response:', response);
        if (response.success) {
          // Leave session as owner
          if (this.ownerId) {
            this.liveTranscriptionService.leaveSession(this.currentSession!.session_id, this.ownerId);
          } else {
            this.liveTranscriptionService.leaveSession(this.currentSession!.session_id);
          }
          
          this.resetSession();
          this.showSuccess('Session ended successfully');
          this.sessionEnded.emit();
          
          // Force a connection check to ensure the UI updates properly
          setTimeout(() => {
            this.checkHealth();
            console.log('Post-session button states:', {
              canCreateSession: this.canCreateSession(),
              isConnected: this.isConnected,
              currentSession: this.currentSession
            });
          }, 500);
        } else {
          this.showError(response.error || 'Failed to end session');
          this.resetSession(); // Reset anyway to avoid stuck state
        }
      },
      error: (error) => {
        console.error('Error ending session:', error);
        if (error.status === 401) {
          this.showAuthDialog('End Session', 'Admin authentication is required to end the session.').then(authenticated => {
            if (authenticated) {
              this.finalizeEndSession();
            }
          });
        } else {
          this.showError('Failed to end session');
          this.resetSession(); // Reset anyway
          
          // Force a connection check even on error
          setTimeout(() => {
            this.checkHealth();
          }, 500);
        }
      }
    });
  }

  private resetSession(): void {
    console.log('Resetting session state...');
    this.currentSession = null;
    this.isRecording = false;
    this.isPaused = false;
    this.isCreatingSession = false; // Ensure this is reset
    this.isProcessingSummary = false;
    this.isProcessingChunk = false; // Reset processing flag
    this.transcriptLines = [];
    this.fullTranscript = '';
    this.accumulatedAudioChunks = [];
    this.accumulatedRawBuffer = [];
    this.audioChunks = [];
    this.audioBuffer = [];
    this.completeRawBuffer = [];
    
    // Force UI update by logging the state
    console.log('Reset complete - button states:', {
      canCreateSession: this.canCreateSession(),
      isConnected: this.isConnected,
      isCreatingSession: this.isCreatingSession,
      currentSession: this.currentSession,
      isProcessingSummary: this.isProcessingSummary
    });
  }

  downloadTranscript(): void {
    if (!this.fullTranscript) {
      this.showError('No transcript to download');
      return;
    }

    const element = document.createElement('a');
    const file = new Blob([this.fullTranscript], { type: 'text/plain' });
    element.href = URL.createObjectURL(file);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    element.download = `live-transcript-${timestamp}.txt`;
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
    
    this.showSuccess('Transcript downloaded successfully!');
  }

  clearTranscript(): void {
    this.transcriptLines = [];
    this.fullTranscript = '';
    this.showInfo('Transcript cleared');
  }

  private showBrowserSpecificHelp(): void {
    const userAgent = navigator.userAgent.toLowerCase();
    
    setTimeout(() => {
      if (userAgent.includes('chrome')) {
        this.showChromeAudioSetupDialog();
      } else if (userAgent.includes('edge')) {
        this.showInfo('Edge: System audio capture should work. Make sure to select "Share audio" when prompted.');
      } else if (userAgent.includes('firefox')) {
        this.showInfo('Firefox: Limited system audio support. Consider switching to Chrome or Edge for best experience.');
      } else if (userAgent.includes('safari')) {
        this.showInfo('Safari: System audio capture not supported. Please use Chrome or Edge.');
      } else {
        this.showInfo('For best system audio capture support, please use Chrome or Edge browsers.');
      }
    }, 2000);
  }

  private showChromeAudioSetupDialog(): void {
    const dialogRef = this.dialog.open(ConfirmationDialogComponent, {
      width: '500px',
      panelClass: 'dark-dialog',
      data: {
        title: 'Enable Chrome Audio Capture',
        message: 'Chrome requires experimental features to be enabled for system audio capture.',
        subMessage: `Steps to fix:
1. Open a new tab and go to: chrome://flags
2. Search for "Experimental Web Platform features"
3. Enable this flag
4. Restart Chrome
5. Try system audio capture again

This will enable full system audio capture functionality.`,
        confirmText: 'Open Chrome Flags',
        cancelText: 'Continue Anyway'
      }
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result === true) {
        // Open chrome://flags in a new tab
        window.open('chrome://flags/#enable-experimental-web-platform-features', '_blank');
      }
    });
  }

  private async captureDisplayAudio(audioOpts: MediaTrackConstraints): Promise<MediaStream | null> {
    // Helper to try capture with audio only, then fallback to audio+video
    try {
      const opts: DisplayMediaStreamOptions = {
        video: false,
        audio: audioOpts
      } as any;
      return await navigator.mediaDevices.getDisplayMedia(opts);
    } catch (err: any) {
      if (err && err.name === 'NotSupportedError') {
        try {
          console.warn('Audio-only capture not supported, retrying with video+audio...');
          const opts: DisplayMediaStreamOptions = {
            video: {
              cursor: 'never'
            },
            audio: audioOpts
          } as any;
          const stream = await navigator.mediaDevices.getDisplayMedia(opts);
          // Immediately stop video tracks to save resources
          stream.getVideoTracks().forEach(t => t.stop());
          return stream;
        } catch (err2) {
          throw err2; // propagate
        }
      }
      throw err;
    }
  }

  private showReconnectionPrompt(): void {
    if (!this.resumableSessionState) return;
    
    // Prevent showing multiple dialogs
    if (this.isReconnectionDialogOpen) {
      console.log('Reconnection dialog already open, skipping...');
      return;
    }
    
    this.isReconnectionDialogOpen = true;

    const dialogData = {
      title: 'Resume Previous Session?',
      message: `We found a previous session that was interrupted. Would you like to continue where you left off?`,
      subMessage: `Session created: ${new Date(this.resumableSessionState.created_at).toLocaleString()}\nResume count: ${this.resumableSessionState.resume_count}\nTranscript length: ${this.resumableSessionState.transcript.length} characters`,
      confirmText: 'Resume Session',
      cancelText: 'Start New Session'
    };

    const dialogRef = this.dialog.open(ConfirmationDialogComponent, {
      width: '450px',
      data: dialogData,
      disableClose: true // Prevent closing by clicking outside
    });

    dialogRef.afterClosed().subscribe(result => {
      this.isReconnectionDialogOpen = false; // Reset flag when dialog closes
      
      if (result) {
        this.resumeSession();
      } else {
        this.clearResumableSession();
      }
    });
  }

  private handleSessionResumed(data: {session_id: string, owner_id: string, session_state: SessionState}): void {
    console.log('Handling session resumed:', data);
    
    this.currentSession = {
      session_id: data.session_id,
      created_at: new Date(data.session_state.created_at),
      is_active: data.session_state.is_active,
      is_shared: data.session_state.is_shared,
      title: data.session_state.title,
      owner_id: data.owner_id
    };

    // Restore transcript if available
    if (data.session_state.transcript) {
      this.restoreTranscriptFromState(data.session_state.transcript);
    }

    this.isResumingSession = false;
    this.clearResumableSession();
    this.showSuccess(`Session ${data.session_id.substring(0, 8)}... resumed successfully!`);
    
    // Check sharing status
    this.checkSharingStatus();
  }

  clearResumableSession(): void {
    this.hasResumableSession = false;
    this.resumableSessionId = null;
    this.resumableSessionState = null;
    this.isReconnectionDialogOpen = false; // Reset dialog flag
  }

  resumeSession(): void {
    if (!this.resumableSessionId || !this.ownerId) {
      this.showError('Cannot resume session: missing session or owner information');
      return;
    }

    this.isResumingSession = true;

    this.liveTranscriptionService.resumeSession(this.resumableSessionId, this.ownerId).subscribe({
      next: (response) => {
        if (response.success && response.session_state) {
          // Join the session as owner
          this.liveTranscriptionService.joinSessionAsOwner(this.resumableSessionId!, this.ownerId!);
          
          // The actual session resumption will be handled by the session_resumed event
          console.log('Resume session API call successful');
        } else {
          this.isResumingSession = false;
          this.showError(response.error || 'Failed to resume session');
          this.clearResumableSession();
        }
      },
      error: (error) => {
        this.isResumingSession = false;
        console.error('Error resuming session:', error);
        this.showError('Failed to resume session: ' + (error.error?.error || error.message));
        this.clearResumableSession();
      }
    });
  }

  private restoreTranscriptFromState(transcript: string): void {
    if (!transcript) return;

    // Parse the transcript string back into lines
    const lines = transcript.split('\n').filter(line => line.trim());
    this.transcriptLines = lines;
    this.fullTranscript = transcript;
    
    console.log(`Restored ${lines.length} transcript lines from session state`);
    
    // Scroll to bottom after a short delay
    setTimeout(() => {
      this.scrollToBottom();
    }, 100);
  }
} 