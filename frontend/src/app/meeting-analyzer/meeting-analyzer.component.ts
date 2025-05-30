import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatTabsModule } from '@angular/material/tabs';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatCardModule } from '@angular/material/card';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatMenuModule } from '@angular/material/menu';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { MeetingService, Chapter, TranscriptionResponse } from '../services/meeting.service';
import { marked } from 'marked';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

@Component({
  selector: 'app-meeting-analyzer',
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
    MatExpansionModule,
    MatSnackBarModule,
    MatMenuModule
  ],
  templateUrl: './meeting-analyzer.component.html',
  styleUrls: ['./meeting-analyzer.component.css']
})
export class MeetingAnalyzerComponent implements OnInit {
  // File upload
  selectedFile: File | null = null;
  isDragging = false;
  
  // Processing state
  isProcessing = false;
  sessionId: string | null = null;
  filename: string = '';
  processedTime: Date = new Date();
  duration: string = '00:31'; // Default duration, you can calculate this from audio
  
  // Content data
  transcript: string = '';
  chapters: Chapter[] = [];
  takeaways: string = '';
  summary: string = '';
  notes: string = '';
  
  // Sanitized HTML content
  takeawaysHtml: SafeHtml = '';
  summaryHtml: SafeHtml = '';
  notesHtml: SafeHtml = '';
  
  // Search
  searchTerm: string = '';
  filteredChapters: Chapter[] = [];
  
  // Chat
  chatMessages: ChatMessage[] = [];
  newMessage: string = '';
  isSendingMessage = false;
  
  // Tab management
  selectedTabIndex = 0;

  constructor(
    private meetingService: MeetingService,
    private snackBar: MatSnackBar,
    private sanitizer: DomSanitizer
  ) {
    // Configure marked options
    marked.setOptions({
      breaks: true,
      gfm: true
    });
  }

  ngOnInit(): void {
    // Check API health
    this.meetingService.checkHealth().subscribe({
      next: (response) => {
        console.log('API is healthy:', response);
      },
      error: (error) => {
        this.showError('Backend API is not available. Please ensure the Flask server is running.');
      }
    });
  }

  onFileSelected(event: any): void {
    const file = event.target.files[0];
    if (file) {
      this.handleFile(file);
    }
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragging = true;
  }

  onDragLeave(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragging = false;
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragging = false;

    const files = event.dataTransfer?.files;
    if (files && files.length > 0) {
      this.handleFile(files[0]);
    }
  }

  private handleFile(file: File): void {
    const supportedTypes = [
      'audio/mpeg', 'audio/wav', 'audio/mp4', 'audio/x-m4a',
      'audio/flac', 'audio/aac', 'audio/ogg', 'audio/opus', 'audio/webm'
    ];

    if (!supportedTypes.includes(file.type) && !file.name.match(/\.(mp3|wav|m4a|flac|aac|ogg|opus|webm)$/i)) {
      this.showError('Please select a valid audio file (MP3, WAV, M4A, FLAC, AAC, OGG, OPUS, or WEBM)');
      return;
    }

    this.selectedFile = file;
    this.filename = file.name;

    // Extract audio duration
    const audio = document.createElement('audio');
    audio.preload = 'metadata';
    audio.onloadedmetadata = () => {
      if (audio.duration && !isNaN(audio.duration)) {
        this.duration = this.formatDuration(audio.duration);
      } else {
        this.duration = '';
      }
    };
    audio.onerror = () => {
      this.duration = '';
    };
    audio.src = URL.createObjectURL(file);
  }

  private formatDuration(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = Math.round(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }

  processAudio(): void {
    if (!this.selectedFile) {
      this.showError('Please select an audio file first');
      return;
    }

    this.isProcessing = true;
    this.resetData();

    this.meetingService.transcribeAudio(this.selectedFile).subscribe({
      next: (response: TranscriptionResponse) => {
        this.handleTranscriptionSuccess(response);
      },
      error: (error) => {
        this.isProcessing = false;
        this.showError(error.error?.error || 'Failed to process audio file');
      }
    });
  }

  private handleTranscriptionSuccess(response: TranscriptionResponse): void {
    this.isProcessing = false;
    this.sessionId = response.session_id;
    this.transcript = response.transcript;
    this.chapters = response.chapters;
    this.filteredChapters = response.chapters;
    this.takeaways = response.takeaways;
    this.summary = response.summary;
    this.notes = response.notes;
    this.processedTime = new Date();
    
    // Convert markdown to HTML
    this.formatContent();
    
    this.showSuccess('Audio processed successfully!');
    this.selectedTabIndex = 0; // Switch to transcript tab
  }

  private formatContent(): void {
    // Convert markdown to HTML and sanitize
    if (this.summary) {
      const summaryHtml = marked.parse(this.summary) as string;
      this.summaryHtml = this.sanitizer.sanitize(1, summaryHtml) || '';
    }
    if (this.takeaways) {
      const takeawaysHtml = marked.parse(this.takeaways) as string;
      this.takeawaysHtml = this.sanitizer.sanitize(1, takeawaysHtml) || '';
    }
    if (this.notes) {
      const notesHtml = marked.parse(this.notes) as string;
      this.notesHtml = this.sanitizer.sanitize(1, notesHtml) || '';
    }
  }

  searchTranscript(): void {
    if (!this.sessionId) return;

    if (this.searchTerm.trim()) {
      this.meetingService.searchTranscript(this.sessionId, this.searchTerm).subscribe({
        next: (response) => {
          this.filteredChapters = response.chapters;
          if (response.total_found === 0) {
            this.showInfo(`No chapters found containing "${this.searchTerm}"`);
          }
        },
        error: (error) => {
          this.showError('Failed to search transcript');
        }
      });
    } else {
      this.filteredChapters = this.chapters;
    }
  }

  sendMessage(): void {
    if (!this.newMessage.trim() || !this.sessionId || this.isSendingMessage) {
      return;
    }

    const userMessage: ChatMessage = {
      role: 'user',
      content: this.newMessage,
      timestamp: new Date()
    };

    this.chatMessages.push(userMessage);
    const question = this.newMessage;
    this.newMessage = '';
    this.isSendingMessage = true;

    this.meetingService.sendChatMessage(this.sessionId, question).subscribe({
      next: (response) => {
        const assistantMessage: ChatMessage = {
          role: 'assistant',
          content: response.response,
          timestamp: new Date()
        };
        this.chatMessages.push(assistantMessage);
        this.isSendingMessage = false;
        
        // Scroll to bottom of chat
        setTimeout(() => {
          const messagesArea = document.querySelector('.messages-area');
          if (messagesArea) {
            messagesArea.scrollTop = messagesArea.scrollHeight;
          }
        }, 100);
      },
      error: (error) => {
        this.isSendingMessage = false;
        this.showError('Failed to send message');
      }
    });
  }

  formatTimestamp(line: string): SafeHtml {
    // Check if line starts with timestamp pattern [HH:MM:SS]
    const timestampRegex = /^\[(\d{2}:\d{2}:\d{2})\]/;
    const match = line.match(timestampRegex);
    
    if (match) {
      const formatted = line.replace(timestampRegex, '<span class="timestamp">$&</span>');
      return this.sanitizer.sanitize(1, formatted) || line;
    }
    return line;
  }

  highlightSearchTerm(text: string): SafeHtml {
    if (!this.searchTerm.trim()) {
      return text;
    }

    const regex = new RegExp(`(${this.escapeRegExp(this.searchTerm)})`, 'gi');
    const highlighted = text.replace(regex, '<mark>$1</mark>');
    return this.sanitizer.sanitize(1, highlighted) || text;
  }

  formatTranscriptLine(line: string): SafeHtml {
    // First format timestamps
    const timestampRegex = /^\[(\d{2}:\d{2}:\d{2})\]/;
    let formattedLine = line;
    
    if (timestampRegex.test(line)) {
      formattedLine = line.replace(timestampRegex, '<span class="timestamp">$&</span>');
    }
    
    // Then highlight search terms if present
    if (this.searchTerm.trim()) {
      const regex = new RegExp(`(${this.escapeRegExp(this.searchTerm)})`, 'gi');
      formattedLine = formattedLine.replace(regex, '<mark>$1</mark>');
    }
    
    return this.sanitizer.sanitize(1, formattedLine) || line;
  }

  formatTranscriptLineWithMarkdown(line: string): SafeHtml {
    // Parse markdown to HTML
    let html = marked.parseInline(line) as string;
    // Highlight timestamps
    html = html.replace(/^(\[\d{2}:\d{2}:\d{2}\])/, '<span class="timestamp">$1</span>');
    // Highlight search terms
    if (this.searchTerm.trim()) {
      const regex = new RegExp(`(${this.escapeRegExp(this.searchTerm)})`, 'gi');
      html = html.replace(regex, '<mark>$1</mark>');
    }
    return this.sanitizer.sanitize(1, html) || line;
  }

  private escapeRegExp(string: string): string {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  downloadTranscript(): void {
    if (!this.transcript) return;

    const element = document.createElement('a');
    const file = new Blob([this.transcript], { type: 'text/plain' });
    element.href = URL.createObjectURL(file);
    element.download = `${this.filename.replace(/\.[^/.]+$/, '')}_transcript.txt`;
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
    
    this.showSuccess('Transcript downloaded successfully!');
  }

  private resetData(): void {
    this.transcript = '';
    this.chapters = [];
    this.filteredChapters = [];
    this.takeaways = '';
    this.summary = '';
    this.notes = '';
    this.takeawaysHtml = '';
    this.summaryHtml = '';
    this.notesHtml = '';
    this.chatMessages = [];
    this.searchTerm = '';
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

  getFileSize(file: File): string {
    const bytes = file.size;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    if (bytes === 0) return '0 Bytes';
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
  }

  getProcessButtonText(): string {
    if (this.isProcessing) {
      return 'Processing...';
    }
    return this.selectedFile ? 'Start Analysis' : 'Select a file first';
  }
} 