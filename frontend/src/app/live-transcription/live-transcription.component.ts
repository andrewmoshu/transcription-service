import { Component, OnInit, OnDestroy, Inject, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatTabsModule } from '@angular/material/tabs';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatCardModule } from '@angular/material/card';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatDividerModule } from '@angular/material/divider';
import { MatChipsModule } from '@angular/material/chips';
import { MatDialogModule, MatDialog, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Subscription } from 'rxjs';
import { 
  LiveTranscriptionService, 
  LiveSession, 
  TranscriptUpdate 
} from '../services/live-transcription.service';
import { MeetingService, TranscriptionResponse } from '../services/meeting.service';

// Confirmation dialog component
@Component({
  selector: 'app-confirmation-dialog',
  standalone: true,
  imports: [CommonModule, MatDialogModule, MatButtonModule],
  template: `
    <h2 mat-dialog-title>{{data.title}}</h2>
    <mat-dialog-content>
      <p>{{data.message}}</p>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button (click)="onCancel()">{{data.cancelText}}</button>
      <button mat-flat-button color="primary" (click)="onConfirm()">{{data.confirmText}}</button>
    </mat-dialog-actions>
  `
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
}

// Add confirmation dialog component interface
interface ConfirmationDialogData {
  title: string;
  message: string;
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
    MatTooltipModule
  ],
  templateUrl: './live-transcription.component.html',
  styleUrls: ['./live-transcription.component.css']
})
export class LiveTranscriptionComponent implements OnInit, OnDestroy {
  // Session management
  currentSession: LiveSession | null = null;
  isConnected = false;
  isCreatingSession = false;
  isRecording = false;
  isPaused = false; // Track if we're between recording sessions
  isShared = false;
  shareUrl = '';
  
  // Transcript data
  transcriptLines: string[] = [];
  fullTranscript = '';
  
  // Subscriptions
  private subscriptions: Subscription[] = [];
  
  // Audio capture methods
  private audioContext: AudioContext | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private audioStream: MediaStream | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private processorNode: ScriptProcessorNode | null = null;
  audioChunks: Blob[] = []; // Keep for MediaRecorder fallback
  private chunkCounter = 0;
  private audioBuffer: Float32Array[] = [];
  private completeRawBuffer: Float32Array[] = []; // Store complete recording
  private accumulatedAudioChunks: Blob[] = []; // Accumulate audio across sessions
  private accumulatedRawBuffer: Float32Array[] = []; // Accumulate raw audio across sessions
  private bufferSize = 4096;
  
  // Chunk configuration
  private readonly CHUNK_DURATION_SAMPLES = 240000; // 15 seconds at 16kHz
  
  // Processing state
  isProcessingSummary = false;
  isProcessingChunk = false;

  @Output() sessionEnded = new EventEmitter<void>();
  @Output() switchToMeetingAnalyzer = new EventEmitter<void>();

  constructor(
    private liveTranscriptionService: LiveTranscriptionService,
    private meetingService: MeetingService,
    private snackBar: MatSnackBar,
    private dialog: MatDialog
  ) {}

  ngOnInit(): void {
    this.setupSubscriptions();
    this.checkHealth();
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach(sub => sub.unsubscribe());
    if (this.currentSession) {
      this.stopSession();
    }
    this.liveTranscriptionService.disconnect();
  }

  private setupSubscriptions(): void {
    console.log('=== SETTING UP SUBSCRIPTIONS ===');
    
    // Connection status
    this.subscriptions.push(
      this.liveTranscriptionService.getConnectionStatus().subscribe(
        connected => {
          console.log('Connection status changed:', connected);
          this.isConnected = connected;
          if (connected) {
            this.showSuccess('Connected to live transcription server');
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
    if (this.isCreatingSession) return;
    
    this.isCreatingSession = true;
    this.showInfo('Creating new session...');
    
    this.liveTranscriptionService.createSession().subscribe({
      next: (response) => {
        if (response.success && response.session_id) {
          this.currentSession = {
            session_id: response.session_id,
            created_at: new Date(),
            is_active: false
          };
          
          // Join the session
          this.liveTranscriptionService.joinSession(response.session_id);
          
          // Reset sharing state
          this.isShared = false;
          this.shareUrl = '';
          
          // Check sharing status after a brief delay to ensure session is fully created
          setTimeout(() => this.checkSharingStatus(), 1000);
          
          this.showSuccess('Session created successfully!');
          console.log('Session created:', response.session_id);
        } else {
          this.showError(response.error || 'Failed to create session');
        }
        this.isCreatingSession = false;
      },
      error: (error) => {
        console.error('Error creating session:', error);
        this.showError('Failed to create session');
        this.isCreatingSession = false;
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
          this.showError('Failed to disable sharing');
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
          this.showError('Failed to enable sharing');
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

    this.liveTranscriptionService.startSession(this.currentSession.session_id).subscribe({
      next: (response) => {
        console.log('Start session response:', response);
        if (response.success) {
          const wasResuming = this.isPaused;
          this.isRecording = true;
          this.isPaused = false;
          this.showSuccess(wasResuming ? 'Recording resumed' : 'Live transcription started');
          console.log('Starting audio capture...');
          this.startAudioCapture();
          
          // Only request current transcript if this is NOT a resume
          // When resuming, we want to keep the existing transcript and just add new content
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
        this.showError('Failed to start session');
      }
    });
  }

  stopSession(): void {
    if (!this.currentSession) {
      this.showError('No active session');
      return;
    }

    if (!this.isRecording) {
      this.showError('No recording in progress');
      return;
    }

    console.log('=== STOP SESSION DEBUG ===');
    console.log('Session ID:', this.currentSession.session_id);
    console.log('Current transcript lines:', this.transcriptLines.length);

    this.isRecording = false;
    this.isPaused = true;
    this.stopAudioCapture();

    this.liveTranscriptionService.stopSession(this.currentSession.session_id).subscribe({
      next: (response) => {
        console.log('Stop session response:', response);
        if (response.success) {
          this.showSuccess('Recording paused. You can start recording again to continue.');
          
          // Request current transcript to ensure we have the latest
          console.log('Requesting current transcript after stop...');
          setTimeout(() => {
            this.liveTranscriptionService.requestCurrentTranscript(this.currentSession!.session_id);
          }, 500);
        }
      },
      error: (error) => {
        console.error('Error stopping session:', error);
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
      data: {
        title: 'End Session',
        message: 'Would you like to generate a summary and analysis of this session? This will process all recorded audio using our AI analysis.',
        confirmText: 'Generate Summary',
        cancelText: 'End Without Summary'
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
    if (this.accumulatedAudioChunks.length === 0 && this.accumulatedRawBuffer.length === 0) {
      this.showError('No audio recorded to analyze');
      this.finalizeEndSession();
      return;
    }

    this.isProcessingSummary = true;
    this.showInfo('Processing session audio for analysis...');

    try {
      // Create a combined audio file from all accumulated chunks
      let finalAudioFile: File;

      if (this.accumulatedAudioChunks.length > 0) {
        // Use MediaRecorder chunks
        const combinedBlob = new Blob(this.accumulatedAudioChunks, { type: 'audio/webm' });
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        finalAudioFile = new File([combinedBlob], `live-session-${timestamp}.webm`, { type: 'audio/webm' });
      } else if (this.accumulatedRawBuffer.length > 0) {
        // Use raw audio buffer
        const wavBlob = this.createWavBlobFromRawBuffer(this.accumulatedRawBuffer);
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        finalAudioFile = new File([wavBlob], `live-session-${timestamp}.wav`, { type: 'audio/wav' });
      } else {
        throw new Error('No audio data available');
      }

      // Use the meeting service to transcribe and analyze
      this.meetingService.transcribeAudio(finalAudioFile).subscribe({
        next: (response: TranscriptionResponse) => {
          this.isProcessingSummary = false;
          this.showSuccess('Session analysis completed!');
          
          // Store the analysis results in session storage for the meeting analyzer
          sessionStorage.setItem('live-session-analysis', JSON.stringify({
            sessionId: response.session_id,
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
          this.liveTranscriptionService.leaveSession(this.currentSession!.session_id);
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
        this.showError('Failed to end session');
        this.resetSession(); // Reset anyway
        
        // Force a connection check even on error
        setTimeout(() => {
          this.checkHealth();
        }, 500);
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

  private async startAudioCapture(): Promise<void> {
    try {
      // Get microphone access
      this.audioStream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true
        } 
      });
      
      // Create Audio Context
      this.audioContext = new AudioContext({ sampleRate: 16000 });
      
      // Create source node from stream
      this.sourceNode = this.audioContext.createMediaStreamSource(this.audioStream);
      
      // Create script processor node for raw audio data
      this.processorNode = this.audioContext.createScriptProcessor(this.bufferSize, 1, 1);
      
      // Reset audio buffers and counter
      this.audioBuffer = [];
      this.chunkCounter = 0;
      
      // Process raw audio data
      this.processorNode.onaudioprocess = (event) => {
        if (this.currentSession && this.isRecording) {
          const inputBuffer = event.inputBuffer;
          const channelData = inputBuffer.getChannelData(0);
          
          // Store audio data for streaming
          this.audioBuffer.push(new Float32Array(channelData));
          
          // Store complete recording
          this.completeRawBuffer.push(new Float32Array(channelData));
          
          // Safety check: prevent buffer from growing too large
          const totalSamples = this.audioBuffer.reduce((sum, chunk) => sum + chunk.length, 0);
          
          // Send audio chunk every ~15 seconds
          if (totalSamples >= this.CHUNK_DURATION_SAMPLES) {
            // Prevent recursive calls by temporarily disabling processing
            if (!this.isProcessingChunk) {
              this.isProcessingChunk = true;
              
              try {
                this.processRawAudioBuffer();
                
                // Reset main buffer but keep overlap
                this.audioBuffer = [];
              } catch (error) {
                console.error('Error in chunk processing:', error);
                this.audioBuffer = []; // Clear buffer to prevent infinite loop
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
      };
      
      // Connect the nodes
      this.sourceNode.connect(this.processorNode);
      this.processorNode.connect(this.audioContext.destination);
      
      // Also start MediaRecorder for fallback/debugging
      this.startMediaRecorderFallback();
      
      this.showSuccess('Audio capture started using Web Audio API');
      
    } catch (error) {
      console.error('Error accessing microphone:', error);
      this.showError('Failed to access microphone. Please check permissions.');
      this.isRecording = false;
    }
  }

  private startMediaRecorderFallback(): void {
    try {
      if (!this.audioStream) return;
      
      this.mediaRecorder = new MediaRecorder(this.audioStream, {
        mimeType: 'audio/webm;codecs=opus'
      });

      this.audioChunks = [];

      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          this.audioChunks.push(event.data);
        }
      };

      this.mediaRecorder.start(15000); // Record in 15-second chunks
      console.log('MediaRecorder fallback started with 15-second intervals');
      
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
      
      // For larger buffers, we need to use FileReader or similar approach
      // But since we can't use async here, let's try a different chunking approach
      // that maintains base64 integrity
      
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

  private saveCompleteRawRecording(): void {
    if (this.completeRawBuffer.length === 0) {
      console.log('No raw audio to save');
      return;
    }
    
    try {
      // Combine all raw audio data
      const totalLength = this.completeRawBuffer.reduce((sum, chunk) => sum + chunk.length, 0);
      const combinedBuffer = new Float32Array(totalLength);
      
      let offset = 0;
      for (const chunk of this.completeRawBuffer) {
        chunk.forEach((sample, index) => {
          combinedBuffer[offset + index] = sample;
        });
        offset += chunk.length;
      }
      
      // Convert Float32Array to Int16Array (16-bit PCM)
      const pcmData = new Int16Array(combinedBuffer.length);
      for (let i = 0; i < combinedBuffer.length; i++) {
        const sample = Math.max(-1, Math.min(1, combinedBuffer[i]));
        pcmData[i] = sample * 0x7FFF;
      }
      
      // Convert to bytes
      const audioBytes = new Uint8Array(pcmData.buffer);
      
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      
      // Save as raw PCM data
      const pcmFilename = `complete-raw-recording-${timestamp}.pcm`;
      const pcmBlob = new Blob([audioBytes], { type: 'application/octet-stream' });
      this.downloadBlob(pcmBlob, pcmFilename);
      
      // Also create a proper WAV file for testing
      const wavData = this.createWavFile(audioBytes, 16000, 1, 16);
      const wavFilename = `complete-raw-recording-${timestamp}.wav`;
      const wavBlob = new Blob([wavData], { type: 'audio/wav' });
      this.downloadBlob(wavBlob, wavFilename);
      
      const duration = (totalLength / 16000).toFixed(1);
      console.log(`Saved complete raw recording: ${pcmFilename}, ${wavFilename} (${audioBytes.length} bytes, ${duration}s)`);
      this.showSuccess(`Raw recording saved: ${wavFilename} (${duration}s)`);
      
    } catch (error) {
      console.error('Error saving complete raw recording:', error);
      this.showError('Failed to save raw recording');
    }
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

  private saveCompleteRecording(): void {
    if (this.audioChunks.length === 0) return;
    
    const completeBlob = new Blob(this.audioChunks, { type: 'audio/webm' });
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `complete-mediarecorder-${timestamp}.webm`;
    
    this.downloadBlob(completeBlob, filename);
    
    console.log(`Saved complete MediaRecorder recording: ${filename}, size: ${completeBlob.size} bytes, chunks: ${this.audioChunks.length}`);
    this.showSuccess(`Complete MediaRecorder recording saved: ${filename}`);
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
    
    // Stop Web Audio API
    if (this.processorNode) {
      this.processorNode.disconnect();
      this.processorNode = null;
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
    
    // Stop audio stream
    if (this.audioStream) {
      this.audioStream.getTracks().forEach(track => track.stop());
      this.audioStream = null;
    }
    
    // Clear current session buffers (but keep accumulated ones)
    this.audioChunks = [];
    this.audioBuffer = [];
    this.completeRawBuffer = [];
    this.isProcessingChunk = false; // Reset processing flag
    
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
    const result = this.isConnected && !this.isCreatingSession && !this.currentSession && !this.isProcessingSummary;
    if (!result) {
      console.log('canCreateSession false because:', {
        isConnected: this.isConnected,
        isCreatingSession: this.isCreatingSession,
        currentSession: this.currentSession,
        isProcessingSummary: this.isProcessingSummary
      });
    }
    return result;
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
} 