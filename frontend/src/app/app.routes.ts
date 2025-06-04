import { Routes } from '@angular/router';
import { SharedSessionViewerComponent } from './shared-session-viewer/shared-session-viewer.component';

export const routes: Routes = [
  { path: 'shared/:sessionId', component: SharedSessionViewerComponent },
  { path: '', redirectTo: '/', pathMatch: 'full' }
];
