import { Component, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogRef, MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { AuthService } from '../services/auth.service';

export interface AuthDialogData {
  title: string;
  message: string;
}

@Component({
  selector: 'app-auth-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule
  ],
  templateUrl: './auth-dialog.component.html',
  styleUrls: ['./auth-dialog.component.css']
})
export class AuthDialogComponent {
  password: string = '';
  errorMessage: string = '';
  isLoading: boolean = false;

  constructor(
    public dialogRef: MatDialogRef<AuthDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: AuthDialogData,
    private authService: AuthService
  ) {}

  onSubmit(): void {
    if (!this.password) {
      this.errorMessage = 'Please enter a password';
      return;
    }

    this.isLoading = true;
    this.errorMessage = '';

    this.authService.checkAuth(this.password).subscribe({
      next: (response) => {
        if (response.authenticated) {
          this.dialogRef.close(true);
        } else {
          this.errorMessage = 'Invalid password';
          this.isLoading = false;
        }
      },
      error: (error) => {
        this.errorMessage = 'Authentication failed. Please try again.';
        this.isLoading = false;
      }
    });
  }

  onCancel(): void {
    this.dialogRef.close(false);
  }
} 