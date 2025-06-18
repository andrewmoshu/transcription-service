import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterOutlet, Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { FormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatDialogModule, MatDialog } from '@angular/material/dialog';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatChipsModule } from '@angular/material/chips';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Subscription } from 'rxjs';

import { LiveTranscriptionComponent } from './live-transcription/live-transcription.component';
import { MeetingAnalyzerComponent } from './meeting-analyzer/meeting-analyzer.component';
import { TranscriptListComponent } from './transcript-list/transcript-list.component';
import { AuthService } from './services/auth.service';
import { AuthDialogComponent } from './auth-dialog/auth-dialog.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule, 
    RouterOutlet,
    MatIconModule, 
    MatButtonModule,
    FormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatDialogModule,
    MatProgressSpinnerModule,
    MatChipsModule,
    MatTooltipModule,
    LiveTranscriptionComponent, 
    MeetingAnalyzerComponent,
    TranscriptListComponent
  ],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css']
})
export class AppComponent implements OnInit, OnDestroy {
  title = 'Meeting Transcriber';
  selectedMode: string | null = null;
  cameFromLiveTranscription = false;
  cameFromTranscripts = false;
  isAuthenticated = false;
  private authSub?: Subscription;
  
  // Custom logo URL - set this to your logo path
  logoUrl: string = '/logo.svg'; // This will load from frontend/public/logo.svg

  constructor(
    private router: Router,
    private authService: AuthService,
    private dialog: MatDialog
  ) {
    // Subscribe to authentication status
    this.authSub = this.authService.isAuthenticated().subscribe(
      authenticated => this.isAuthenticated = authenticated
    );
  }

  ngOnInit() {
    // Check if we're on a shared route on app initialization
    console.log('App initialized, current route:', this.router.url);
  }

  isSharedRoute(): boolean {
    return this.router.url.startsWith('/shared/');
  }

  selectMode(mode: 'file' | 'live' | 'transcripts') {
    this.selectedMode = mode;
    this.cameFromLiveTranscription = false;
    this.cameFromTranscripts = false;
  }

  goBack() {
    if (this.cameFromTranscripts) {
      this.selectedMode = 'transcripts';
      this.cameFromTranscripts = false;
    } else {
      this.selectedMode = null;
      this.cameFromLiveTranscription = false;
      this.cameFromTranscripts = false;
    }
  }

  switchToMeetingAnalyzer() {
    this.selectedMode = 'file';
    this.cameFromLiveTranscription = true;
    this.cameFromTranscripts = false;
  }

  switchToMeetingAnalyzerFromTranscripts() {
    this.selectedMode = 'file';
    this.cameFromLiveTranscription = false;
    this.cameFromTranscripts = true;
  }

  returnToLiveTranscription() {
    this.selectedMode = 'live';
    this.cameFromLiveTranscription = false;
    this.cameFromTranscripts = false;
  }

  showAuthDialog(): void {
    const dialogRef = this.dialog.open(AuthDialogComponent, {
      width: '400px',
      panelClass: 'dark-dialog',
      data: { 
        title: 'Admin Authentication', 
        message: 'Enter the admin password to access administrative features.' 
      }
    });

    dialogRef.afterClosed().subscribe((authenticated: boolean) => {
      if (authenticated) {
        this.isAuthenticated = true;
      }
    });
  }

  logout(): void {
    this.authService.clearPassword();
    this.isAuthenticated = false;
  }

  ngOnDestroy() {
    this.authSub?.unsubscribe();
  }
}
