import { ComponentFixture, TestBed } from '@angular/core/testing';

import { TranscriptListComponent } from './transcript-list.component';

describe('TranscriptListComponent', () => {
  let component: TranscriptListComponent;
  let fixture: ComponentFixture<TranscriptListComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TranscriptListComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(TranscriptListComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
