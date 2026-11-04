import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { CardReservationComponent } from './card-reservation.component';
import { API_BASE_URL } from '@app/shared/config/api-base-url.token';
import { ReservationCustomer, ReservationStatusCustomer } from '@app/models/reservations/reservation.model';
import { Roles } from '@app/shared/constants/roles';

describe('CardReservationComponent', () => {
  let component: CardReservationComponent;
  let fixture: ComponentFixture<CardReservationComponent>;
  let navigate: jasmine.Spy;

  beforeEach(async () => {
    navigate = jasmine.createSpy('navigate');
    await TestBed.configureTestingModule({
      providers: [
        { provide: API_BASE_URL, useValue: 'https://test.api' },
        { provide: Router, useValue: { navigate } },
      ],
      imports: [CardReservationComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(CardReservationComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('r', makeReservation(true));
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('shows the group pre-order action only for group reservations', () => {
    expect(
      fixture.nativeElement.querySelector('button')?.textContent
    ).toContain('View Group Pre-Order');

    fixture.componentRef.setInput('r', makeReservation(false));
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).not.toContain('View Group Pre-Order');
  });

  it('navigates to the summary for the selected group reservation', () => {
    const buttons = Array.from(
      fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>
    );
    const button = buttons.find((element) =>
      (element.textContent ?? '').includes('View Group Pre-Order')
    );

    if (!button) {
      fail('View Group Pre-Order button was not rendered.');
      return;
    }

    button.click();
    expect(navigate).toHaveBeenCalledWith([
      '/reservations',
      'reservation-1',
      'group-pre-order',
    ]);
  });

  it('does not show the group pre-order action to non-customer roles', () => {
    fixture.componentRef.setInput('role', Roles.WAITER);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).not.toContain('View Group Pre-Order');
  });

  function makeReservation(hasGroupReservation: boolean): ReservationCustomer {
    return {
      id: 'reservation-1',
      tableId: 'table-1',
      startTime: new Date('2026-01-01T18:00:00Z'),
      endTime: new Date('2026-01-01T20:00:00Z'),
      guestCount: 3,
      status: ReservationStatusCustomer.Reserved,
      restaurantName: 'Green & Tasty',
      locationAddress: 'Test location',
      waiterId: 'waiter-1',
      hasGroupReservation,
    };
  }
});
