import { Component, Inject } from '@angular/core';
import { MatDialogRef, MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatSelectModule } from '@angular/material/select';
import { MatRadioModule } from '@angular/material/radio';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';

export interface AudioSourceData {
  audioDevices: MediaDeviceInfo[];
}

export interface AudioSourceSelection {
  sourceType: 'microphone' | 'system' | 'both' | 'system-only';
  deviceId?: string;
}

@Component({
  selector: 'app-audio-source-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatDialogModule,
    MatButtonModule,
    MatSelectModule,
    MatRadioModule,
    MatFormFieldModule,
    MatIconModule
  ],
  template: `
    <div class="audio-source-dialog">
      <h2 mat-dialog-title>
        <mat-icon>settings_input_component</mat-icon>
        Select Audio Source
      </h2>
      
      <mat-dialog-content>
        <div class="audio-source-selection">
          <div class="source-options">
            <mat-radio-group [(ngModel)]="selectedSource" name="sourceType" class="source-radio-group">
              <mat-radio-button value="microphone" class="source-option">
                <div class="option-content">
                  <span class="option-icon">🎤</span>
                  <span class="option-text">Microphone Only</span>
                </div>
              </mat-radio-button>
              <mat-radio-button value="system-only" class="source-option">
                <div class="option-content">
                  <span class="option-icon">💻</span>
                  <span class="option-text">System Audio Only</span>
                  <span class="option-badge">No mic indicator</span>
                </div>
              </mat-radio-button>
              <mat-radio-button value="both" class="source-option">
                <div class="option-content">
                  <span class="option-icon">🎤💻</span>
                  <span class="option-text">Microphone + System Audio</span>
                </div>
              </mat-radio-button>
            </mat-radio-group>
          </div>

          <div class="device-selection" *ngIf="selectedSource === 'microphone' || selectedSource === 'both'">
            <mat-form-field appearance="outline" class="device-field">
              <mat-label>Select Microphone</mat-label>
              <mat-icon matPrefix>mic</mat-icon>
              <mat-select [(ngModel)]="selectedDeviceId">
                <mat-option *ngFor="let device of data.audioDevices" [value]="device.deviceId">
                  {{device.label || 'Unknown Device'}}
                </mat-option>
              </mat-select>
            </mat-form-field>
          </div>

          <div *ngIf="selectedSource === 'system-only' || selectedSource === 'both'" class="system-audio-info">
            <div class="info-header">
              <mat-icon>info</mat-icon>
              <span>System Audio Capture</span>
            </div>
            
            <div class="warning-section">
              <mat-icon class="warning-icon">warning</mat-icon>
              <p><strong>Requires Chrome experimental features!</strong></p>
            </div>
            
            <div class="setup-instructions">
              <h4>Chrome Setup Required:</h4>
              <ol>
                <li>Open a new tab and go to: <code>chrome://flags</code></li>
                <li>Search for "Experimental Web Platform features"</li>
                <li>Enable this flag</li>
                <li>Restart Chrome</li>
                <li>Try system audio capture again</li>
              </ol>
            </div>
            
            <div class="tip-section">
              <mat-icon>lightbulb</mat-icon>
              <p>Make sure to check "Share audio" when prompted to select a screen/window.</p>
            </div>
          </div>
        </div>
      </mat-dialog-content>

      <mat-dialog-actions>
        <button mat-button (click)="onCancel()" class="cancel-btn">
          <mat-icon>close</mat-icon>
          Cancel
        </button>
        <button mat-flat-button (click)="onConfirm()" [disabled]="!isValid()" class="confirm-btn">
          <mat-icon>play_arrow</mat-icon>
          Start Recording
        </button>
      </mat-dialog-actions>
    </div>
  `,
  styles: [`
    .audio-source-dialog {
      min-width: 480px;
      max-width: 600px;
      padding: 0;
    }

    .audio-source-dialog h2 {
      display: flex;
      align-items: center;
      gap: 12px;
      margin: 0;
      padding: 0;
      color: rgba(255, 255, 255, 0.95);
      font-weight: 400;
      font-size: 1.25rem;
    }

    .audio-source-dialog h2 mat-icon {
      color: #00b4d8;
      font-size: 24px;
      width: 24px;
      height: 24px;
    }

    .audio-source-selection {
      display: flex;
      flex-direction: column;
      gap: 24px;
      margin-top: 8px;
    }

    .source-options {
      background: rgba(255, 255, 255, 0.02);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 12px;
      padding: 16px;
    }

    .source-radio-group {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .source-option {
      padding: 12px 16px;
      border-radius: 8px;
      border: 1px solid rgba(255, 255, 255, 0.1);
      background: rgba(255, 255, 255, 0.02);
      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    }

    .source-option:hover {
      background: rgba(255, 255, 255, 0.05);
      border-color: rgba(255, 255, 255, 0.15);
    }

    .source-option.mat-mdc-radio-button.mat-mdc-radio-checked {
      background: rgba(0, 180, 216, 0.08);
      border-color: rgba(0, 180, 216, 0.3);
    }

    .option-content {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-left: 32px; /* Account for radio button */
    }

    .option-icon {
      font-size: 18px;
      min-width: 24px;
    }

    .option-text {
      font-weight: 400;
      color: rgba(255, 255, 255, 0.9);
    }

    .option-badge {
      background: rgba(76, 175, 80, 0.15);
      color: #4caf50;
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 0.75rem;
      font-weight: 500;
      margin-left: auto;
    }

    .device-selection {
      background: rgba(255, 255, 255, 0.02);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 12px;
      padding: 16px;
    }

    .device-field {
      width: 100%;
      margin-bottom: 0;
    }

    .device-field mat-icon {
      color: rgba(255, 255, 255, 0.5);
      margin-right: 8px;
    }

    .system-audio-info {
      background: rgba(255, 255, 255, 0.02);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 12px;
      padding: 20px;
      color: rgba(255, 255, 255, 0.9);
    }

    .info-header {
      display: flex;
      align-items: center;
      gap: 8px;
      font-weight: 500;
      color: rgba(255, 255, 255, 0.95);
      margin-bottom: 16px;
    }

    .info-header mat-icon {
      color: #00b4d8;
      font-size: 20px;
      width: 20px;
      height: 20px;
    }

    .warning-section {
      display: flex;
      align-items: center;
      gap: 8px;
      background: rgba(255, 152, 0, 0.1);
      border: 1px solid rgba(255, 152, 0, 0.2);
      border-radius: 8px;
      padding: 12px;
      margin-bottom: 16px;
    }

    .warning-icon {
      color: #ff9800;
      font-size: 18px;
      width: 18px;
      height: 18px;
      flex-shrink: 0;
    }

    .warning-section p {
      margin: 0;
      color: #ff9800;
      font-weight: 500;
    }

    .setup-instructions {
      margin-bottom: 16px;
    }

    .setup-instructions h4 {
      margin: 0 0 8px 0;
      color: rgba(255, 255, 255, 0.95);
      font-weight: 500;
      font-size: 0.9rem;
    }

    .setup-instructions ol {
      margin: 0;
      padding-left: 20px;
      color: rgba(255, 255, 255, 0.8);
    }

    .setup-instructions li {
      margin-bottom: 4px;
      font-size: 0.85rem;
    }

    .setup-instructions code {
      background: rgba(255, 255, 255, 0.1);
      padding: 2px 6px;
      border-radius: 4px;
      font-family: 'Courier New', monospace;
      color: #00b4d8;
      font-size: 0.8rem;
    }

    .tip-section {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      background: rgba(76, 175, 80, 0.1);
      border: 1px solid rgba(76, 175, 80, 0.2);
      border-radius: 8px;
      padding: 12px;
    }

    .tip-section mat-icon {
      color: #4caf50;
      font-size: 18px;
      width: 18px;
      height: 18px;
      flex-shrink: 0;
      margin-top: 2px;
    }

    .tip-section p {
      margin: 0;
      color: rgba(255, 255, 255, 0.8);
      font-size: 0.85rem;
      line-height: 1.4;
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

    .confirm-btn:hover:not(:disabled) {
      background: rgba(0, 180, 216, 0.15) !important;
      border-color: rgba(0, 180, 216, 0.4) !important;
    }

    .confirm-btn:disabled {
      background: rgba(255, 255, 255, 0.02) !important;
      border-color: rgba(255, 255, 255, 0.05) !important;
      color: rgba(255, 255, 255, 0.3) !important;
      cursor: not-allowed;
      opacity: 0.6;
    }

    /* Radio button overrides */
    ::ng-deep .source-option .mdc-radio {
      --mdc-radio-selected-focus-icon-color: #00b4d8;
      --mdc-radio-selected-hover-icon-color: #00b4d8;
      --mdc-radio-selected-icon-color: #00b4d8;
      --mdc-radio-selected-pressed-icon-color: #00b4d8;
      --mdc-radio-unselected-focus-icon-color: rgba(255, 255, 255, 0.5);
      --mdc-radio-unselected-hover-icon-color: rgba(255, 255, 255, 0.6);
      --mdc-radio-unselected-icon-color: rgba(255, 255, 255, 0.4);
      --mdc-radio-unselected-pressed-icon-color: rgba(255, 255, 255, 0.5);
    }
  `]
})
export class AudioSourceDialogComponent {
  selectedSource: 'microphone' | 'system' | 'both' | 'system-only' = 'system-only';
  selectedDeviceId?: string;

  constructor(
    public dialogRef: MatDialogRef<AudioSourceDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: AudioSourceData
  ) {
    // Select first device by default
    if (this.data.audioDevices.length > 0) {
      this.selectedDeviceId = this.data.audioDevices[0].deviceId;
    }
  }

  isValid(): boolean {
    if (this.selectedSource === 'microphone' || this.selectedSource === 'both') {
      return !!this.selectedDeviceId;
    }
    return true;
  }

  onCancel(): void {
    this.dialogRef.close();
  }

  onConfirm(): void {
    const result: AudioSourceSelection = {
      sourceType: this.selectedSource,
      deviceId: this.selectedDeviceId
    };
    this.dialogRef.close(result);
  }
} 