import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ReservationConfirmedComponent } from './reservation-confirmed.component';

describe('ReservationConfirmedComponent', () => {
  let component: ReservationConfirmedComponent;
  let fixture: ComponentFixture<ReservationConfirmedComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ReservationConfirmedComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(ReservationConfirmedComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('reservation', {
      id: 'reservation-1',
      tableId: 'table-1',
      customerId: 'customer-1',
      startTime: new Date('2026-11-04T18:00:00Z'),
      endTime: new Date('2026-11-04T19:00:00Z'),
      guestCount: 2,
      status: 0,
      locationAddress: 'Test location',
      tableCapacity: 4,
      waiterId: 'waiter-1',
    });
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
