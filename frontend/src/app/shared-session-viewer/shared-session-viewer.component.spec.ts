import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { of } from 'rxjs';

import { SharedSessionViewerComponent } from './shared-session-viewer.component';
import { LiveTranscriptionService } from '../services/live-transcription.service';

describe('SharedSessionViewerComponent', () => {
  let component: SharedSessionViewerComponent;
  let fixture: ComponentFixture<SharedSessionViewerComponent>;
  let mockLiveTranscriptionService: jasmine.SpyObj<LiveTranscriptionService>;
  let mockRouter: jasmine.SpyObj<Router>;
  let mockSnackBar: jasmine.SpyObj<MatSnackBar>;

  beforeEach(async () => {
    const liveTranscriptionServiceSpy = jasmine.createSpyObj('LiveTranscriptionService', [
      'getSharedSessionInfo', 'getSharedSessionTranscript', 'joinSharedSession',
      'getConnectionStatus', 'getTranscriptUpdates', 'getCurrentTranscript',
      'getSharedSessionJoined', 'getErrors', 'leaveSession', 'disconnect'
    ]);
    const routerSpy = jasmine.createSpyObj('Router', ['navigate']);
    const snackBarSpy = jasmine.createSpyObj('MatSnackBar', ['open']);

    await TestBed.configureTestingModule({
      imports: [SharedSessionViewerComponent],
      providers: [
        { provide: LiveTranscriptionService, useValue: liveTranscriptionServiceSpy },
        { provide: Router, useValue: routerSpy },
        { provide: MatSnackBar, useValue: snackBarSpy },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              paramMap: {
                get: (key: string) => key === 'sessionId' ? 'test-session-id' : null
              }
            }
          }
        }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(SharedSessionViewerComponent);
    component = fixture.componentInstance;
    mockLiveTranscriptionService = TestBed.inject(LiveTranscriptionService) as jasmine.SpyObj<LiveTranscriptionService>;
    mockRouter = TestBed.inject(Router) as jasmine.SpyObj<Router>;
    mockSnackBar = TestBed.inject(MatSnackBar) as jasmine.SpyObj<MatSnackBar>;

    // Setup default mock returns
    mockLiveTranscriptionService.getConnectionStatus.and.returnValue(of(true));
    mockLiveTranscriptionService.getTranscriptUpdates.and.returnValue(of([]));
    mockLiveTranscriptionService.getCurrentTranscript.and.returnValue(of({ session_id: 'test', updates: [] }));
    mockLiveTranscriptionService.getSharedSessionJoined.and.returnValue(of({ session_id: 'test', session_info: { session_id: 'test', is_shared: true } }));
    mockLiveTranscriptionService.getErrors.and.returnValue(of(''));
    mockLiveTranscriptionService.getSharedSessionInfo.and.returnValue(of({ success: true, session_id: 'test', is_shared: true, title: 'Test Session' }));
    mockLiveTranscriptionService.getSharedSessionTranscript.and.returnValue(of({ success: true, session_id: 'test', transcript: 'Test transcript' }));
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should load shared session on init', () => {
    component.ngOnInit();
    expect(mockLiveTranscriptionService.getSharedSessionInfo).toHaveBeenCalledWith('test-session-id');
  });
}); 