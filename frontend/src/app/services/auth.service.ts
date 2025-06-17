import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, BehaviorSubject } from 'rxjs';
import { tap } from 'rxjs/operators';

export interface AuthResponse {
  success: boolean;
  authenticated: boolean;
  message: string;
}

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private apiUrl = 'http://localhost:5000/api';
  private readonly STORAGE_KEY = 'admin_password';
  
  private isAuthenticated$ = new BehaviorSubject<boolean>(false);
  private adminPassword: string | null = null;

  constructor(private http: HttpClient) {
    // Load password from localStorage on init
    this.loadStoredPassword();
  }

  private loadStoredPassword(): void {
    const storedPassword = localStorage.getItem(this.STORAGE_KEY);
    if (storedPassword) {
      this.adminPassword = storedPassword;
      // Verify the stored password is still valid
      this.checkAuth(storedPassword).subscribe(
        response => {
          if (!response.authenticated) {
            // Password is no longer valid, clear it
            this.clearPassword();
          }
        }
      );
    }
  }

  checkAuth(password: string): Observable<AuthResponse> {
    return this.http.post<AuthResponse>(`${this.apiUrl}/auth/check`, { password })
      .pipe(
        tap(response => {
          if (response.authenticated) {
            this.adminPassword = password;
            this.isAuthenticated$.next(true);
            // Store password in localStorage (consider security implications)
            localStorage.setItem(this.STORAGE_KEY, password);
          }
        })
      );
  }

  getAdminPassword(): string | null {
    return this.adminPassword;
  }

  setAdminPassword(password: string): void {
    this.adminPassword = password;
    this.isAuthenticated$.next(true);
    localStorage.setItem(this.STORAGE_KEY, password);
  }

  clearPassword(): void {
    this.adminPassword = null;
    this.isAuthenticated$.next(false);
    localStorage.removeItem(this.STORAGE_KEY);
  }

  isAuthenticated(): Observable<boolean> {
    return this.isAuthenticated$.asObservable();
  }

  isCurrentlyAuthenticated(): boolean {
    return this.adminPassword !== null;
  }

  // Helper method to add password to request body
  addPasswordToBody(body: any): any {
    if (this.adminPassword) {
      return { ...body, password: this.adminPassword };
    }
    return body;
  }

  // Helper method to add password to headers
  getAuthHeaders(): { [header: string]: string } {
    const headers: { [header: string]: string } = {};
    if (this.adminPassword) {
      headers['X-Admin-Password'] = this.adminPassword;
    }
    return headers;
  }
} 