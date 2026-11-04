import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FeedbackQrModalComponent } from './feedback-qr-modal.component';
import { API_BASE_URL } from '@app/shared/config/api-base-url.token';
import { FeedbackQrService } from '@app/services/reservation/feedback-qr.service';
import { EMPTY } from 'rxjs';

describe('FeedbackQrModalComponent', () => {
  let component: FeedbackQrModalComponent;
  let fixture: ComponentFixture<FeedbackQrModalComponent>;

  beforeEach(async () => {
    const feedbackQrService = jasmine.createSpyObj<FeedbackQrService>(
      'FeedbackQrService',
      ['getAnonymousFeedbackToken', 'generateFeedbackUrl']
    );
    feedbackQrService.getAnonymousFeedbackToken.and.returnValue(EMPTY);

    await TestBed.configureTestingModule({
      providers: [
        { provide: API_BASE_URL, useValue: 'https://test.api' },
        { provide: FeedbackQrService, useValue: feedbackQrService },
      ],
      imports: [FeedbackQrModalComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(FeedbackQrModalComponent);
    component = fixture.componentInstance;
    component.reservationId = 'reservation-1';
    component.locationId = 'location-1';
    component.waiterName = 'Test Waiter';
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
