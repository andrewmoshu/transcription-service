import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { MeetingAnalyzerComponent } from './meeting-analyzer/meeting-analyzer.component';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, MeetingAnalyzerComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css'
})
export class AppComponent {
  title = 'Meeting Analyzer';
}
