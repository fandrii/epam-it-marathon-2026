import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { BehaviorSubject, Subject, of, throwError } from 'rxjs';

import {
  GroupSessionsSnapshot,
  GuestSessionsService,
} from '@app/services/guest-sessions/guest-sessions.service';
import { GroupPreOrderSummaryComponent } from './group-pre-order-summary.component';

describe('GroupPreOrderSummaryComponent', () => {
  let fixture: ComponentFixture<GroupPreOrderSummaryComponent>;
  let service: jasmine.SpyObj<GuestSessionsService>;
  let routeParams: BehaviorSubject<ReturnType<typeof convertToParamMap>>;

  const snapshot: GroupSessionsSnapshot = {
    participants: [
      {
        id: 'owner-session',
        type: 'Owner',
        name: 'Owner',
        items: [
          { dish: { id: 'owner-dish', name: 'Owner Dish', price: 99 }, quantity: 1 },
        ],
        total: 99,
        isSubmitted: true,
      },
      {
        id: 'guest-1',
        type: 'Guest',
        name: 'Alex Guest',
        items: [
          { dish: { id: 'dish-1', name: 'Pasta', price: 5.25 }, quantity: 2 },
        ],
        total: 10.5,
        isSubmitted: true,
      },
    ],
    total: 109.5,
  };

  beforeEach(async () => {
    routeParams = new BehaviorSubject(convertToParamMap({ reservationId: 'reservation-1' }));
    service = jasmine.createSpyObj<GuestSessionsService>(
      'GuestSessionsService',
      ['getOwnerGuestSessionInfo', 'getGroupSessions', 'deleteGuestSession']
    );
    service.getOwnerGuestSessionInfo.and.returnValue(
      of({ guestSessionId: 'owner-session', groupReservationId: 'group-1' })
    );
    service.getGroupSessions.and.returnValue(of(snapshot));
    service.deleteGuestSession.and.returnValue(of({ participants: [], total: 99 }));

    await TestBed.configureTestingModule({
      imports: [GroupPreOrderSummaryComponent],
      providers: [
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { paramMap: routeParams.asObservable() } },
        { provide: GuestSessionsService, useValue: service },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(GroupPreOrderSummaryComponent);
    fixture.detectChanges();
  });

  it('shows guest dishes, prices, quantities, line totals, subtotals and submission status', () => {
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Alex Guest');
    expect(text).toContain('Pasta');
    expect(text).toContain('$5.25');
    expect(text).toContain('2');
    expect(text).toContain('$10.50');
    expect(text).toContain('Submitted');
    expect(text).toContain('Guest subtotal:');
    expect(text).toContain('Grand total for guests');
    expect(text).not.toContain('Owner Dish');
    expect(text).not.toContain('$99.00');
    expect(componentGuestTotal(fixture.componentInstance)).toBe(10.5);
  });

  it('requires confirmation and immediately applies the deletion response snapshot', () => {
    const guest = fixture.componentInstance.guests()[0];
    fixture.componentInstance.requestDelete(guest);
    fixture.detectChanges();

    expect(service.deleteGuestSession).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('[role="dialog"]')).not.toBeNull();

    fixture.nativeElement
      .querySelector('.dialog-actions button:last-child')
      .click();
    fixture.detectChanges();

    expect(service.deleteGuestSession).toHaveBeenCalledWith('group-1', 'guest-1');
    expect(fixture.componentInstance.guests()).toEqual([]);
    expect(fixture.nativeElement.textContent).toContain('$0.00');
    expect(fixture.nativeElement.querySelector('[role="dialog"]')).toBeNull();
  });

  it('prevents overlapping refreshes and ignores an earlier response after deletion', () => {
    const pendingRead = new Subject<GroupSessionsSnapshot>();
    const guest = fixture.componentInstance.guests()[0];
    service.getGroupSessions.and.returnValue(pendingRead.asObservable());
    routeParams.next(convertToParamMap({ reservationId: 'reservation-2' }));
    fixture.detectChanges();

    expect(service.getGroupSessions).toHaveBeenCalledTimes(2);
    fixture.componentInstance.refreshSnapshot();
    expect(service.getGroupSessions).toHaveBeenCalledTimes(2);

    fixture.componentInstance.requestDelete(guest);
    fixture.componentInstance.confirmDelete();
    fixture.detectChanges();

    expect(fixture.componentInstance.guests()).toEqual([]);
    pendingRead.next(snapshot);
    expect(fixture.componentInstance.guests()).toEqual([]);
  });

  it('polls for updates every 10 seconds', fakeAsync(() => {
    fixture.destroy();
    service.getGroupSessions.calls.reset();
    fixture = TestBed.createComponent(GroupPreOrderSummaryComponent);
    fixture.detectChanges();

    expect(service.getGroupSessions).toHaveBeenCalledTimes(1);
    tick(9_999);
    expect(service.getGroupSessions).toHaveBeenCalledTimes(1);
    tick(1);
    expect(service.getGroupSessions).toHaveBeenCalledTimes(2);
    tick(10_000);
    expect(service.getGroupSessions).toHaveBeenCalledTimes(3);
  }));

  it('shows the empty state and computes a guest-only zero total', () => {
    service.getGroupSessions.and.returnValue(of({ participants: [], total: 99 }));
    fixture.componentInstance.refreshSnapshot();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain(
      'No guest participants have joined this group yet.'
    );
    expect(fixture.nativeElement.textContent).toContain('$0.00');
  });

  it('shows a useful error when the Owner is not authorized', () => {
    service.getGroupSessions.and.returnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 403,
            error: { message: 'Only the reservation owner may access this group.' },
          })
      )
    );
    fixture.componentInstance.refreshSnapshot();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain(
      'Only the reservation owner may access this group.'
    );
  });

  function componentGuestTotal(component: GroupPreOrderSummaryComponent): number {
    return component.guestTotal();
  }
});
