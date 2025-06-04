import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterOutlet, Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';

import { LiveTranscriptionComponent } from './live-transcription/live-transcription.component';
import { MeetingAnalyzerComponent } from './meeting-analyzer/meeting-analyzer.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule, 
    RouterOutlet,
    MatIconModule, 
    MatButtonModule,
    LiveTranscriptionComponent, 
    MeetingAnalyzerComponent
  ],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css']
})
export class AppComponent implements OnInit {
  title = 'Meeting Transcriber';
  selectedMode: 'file' | 'live' | null = null;
  cameFromLiveTranscription = false;

  constructor(private router: Router) {}

  ngOnInit() {
    // Check if we're on a shared route on app initialization
    console.log('App initialized, current route:', this.router.url);
  }

  isSharedRoute(): boolean {
    return this.router.url.startsWith('/shared/');
  }

  selectMode(mode: 'file' | 'live') {
    this.selectedMode = mode;
    this.cameFromLiveTranscription = false;
  }

  goBack() {
    this.selectedMode = null;
    this.cameFromLiveTranscription = false;
  }

  switchToMeetingAnalyzer() {
    this.selectedMode = 'file';
    this.cameFromLiveTranscription = true;
  }

  returnToLiveTranscription() {
    this.selectedMode = 'live';
    this.cameFromLiveTranscription = false;
  }
}
