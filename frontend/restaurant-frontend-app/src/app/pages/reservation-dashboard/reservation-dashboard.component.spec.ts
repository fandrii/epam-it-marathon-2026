import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ReservationDashboardComponent } from './reservation-dashboard.component';
import { API_BASE_URL } from '@app/shared/config/api-base-url.token';
import { provideRouter } from '@angular/router';
import { AuthenticationService } from '@app/auth/services/authentication.service';
import { of, throwError } from 'rxjs';
import {
  Reservation,
  ReservationCustomer,
  ReservationStatus,
  ReservationStatusCustomer,
} from '@app/models/reservations/reservation.model';
import { ReservationService } from '@app/services/reservation/reservation.service';
import { GuestInviteService } from '@app/services/reservation/guest-invite.service';
import { ToastService } from '@app/services/toast/toast.service';
import { PreOrdersService } from '@app/services/pre-orders/pre-orders.service';
import { Roles } from '@app/shared/constants/roles';

describe('ReservationDashboardComponent', () => {
  let component: ReservationDashboardComponent;
  let fixture: ComponentFixture<ReservationDashboardComponent>;
  let reservationService: jasmine.SpyObj<ReservationService>;
  let preOrdersService: jasmine.SpyObj<PreOrdersService>;
  let authenticationService: jasmine.SpyObj<AuthenticationService>;

  const baseReservation: ReservationCustomer = {
    id: 'reservation-1',
    tableId: 'table-1',
    startTime: new Date('2026-11-06T18:00:00Z'),
    endTime: new Date('2026-11-06T20:00:00Z'),
    guestCount: 1,
    status: ReservationStatusCustomer.Reserved,
    restaurantName: 'Green & Tasty',
    locationAddress: 'Test location',
    customerId: 'customer-1',
    waiterId: 'waiter-1',
  };

  beforeEach(async () => {
    reservationService = jasmine.createSpyObj<ReservationService>('ReservationService', [
      'editReservation$',
      'getReservationsForUser$',
      'getReservationFeedback',
    ]);
    reservationService.getReservationsForUser$.and.returnValue(of([]));
    reservationService.getReservationFeedback.and.returnValue(of(null));
    preOrdersService = jasmine.createSpyObj<PreOrdersService>('PreOrdersService', ['getPreOrders']);
    preOrdersService.getPreOrders.and.returnValue(of([]));
    authenticationService = jasmine.createSpyObj<AuthenticationService>(
      'AuthenticationService',
      ['getToken', 'getUser'],
      { user$: of(null) }
    );
    authenticationService.getToken.and.returnValue(undefined);
    authenticationService.getUser.and.returnValue(null);

    await TestBed.configureTestingModule({
      providers: [
        { provide: API_BASE_URL, useValue: 'https://test.api' },
        provideRouter([]),
        { provide: ReservationService, useValue: reservationService },
        { provide: PreOrdersService, useValue: preOrdersService },
        {
          provide: GuestInviteService,
          useValue: { getInviteToken$: () => of({ token: 'existing-group-token' }) },
        },
        { provide: ToastService, useValue: { success: () => undefined, error: () => undefined } },
        { provide: AuthenticationService, useValue: authenticationService },
      ],
      imports: [ReservationDashboardComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(ReservationDashboardComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('loads feedback only for reservations where feedback can exist', () => {
    const makeReservation = (id: string, status: ReservationStatus): Reservation => ({
      id,
      tableId: 'table-1',
      customerId: 'customer-1',
      startTime: new Date('2026-11-06T18:00:00Z'),
      endTime: new Date('2026-11-06T20:00:00Z'),
      guestCount: 1,
      status,
      locationAddress: 'Test location',
      tableCapacity: 1,
      waiterId: 'waiter-1',
    });
    const reservations: Reservation[] = [
      makeReservation('reserved', ReservationStatus.Reserved),
      makeReservation('cancelled', ReservationStatus.Cancelled),
      makeReservation('in-progress', ReservationStatus.InProggress),
      makeReservation('finished', ReservationStatus.Finished),
    ];
    reservationService.getReservationsForUser$.and.returnValue(of(reservations));
    authenticationService.getToken.and.returnValue('access-token');
    authenticationService.getUser.and.returnValue({
      id: 'customer-1',
      firstName: 'Test',
      lastName: 'Customer',
      email: 'customer@example.com',
      role: Roles.CUSTOMER,
    });

    component.ngOnInit();

    expect(reservationService.getReservationFeedback).toHaveBeenCalledTimes(2);
    expect(reservationService.getReservationFeedback).toHaveBeenCalledWith('in-progress');
    expect(reservationService.getReservationFeedback).toHaveBeenCalledWith('finished');
    expect(reservationService.getReservationFeedback).not.toHaveBeenCalledWith('reserved');
    expect(reservationService.getReservationFeedback).not.toHaveBeenCalledWith('cancelled');
  });

  it('opens and closes the group pre-order modal for a selected reservation', () => {
    component.openGroupPreOrder('reservation-1');
    expect(component.groupPreOrderReservationId()).toBe('reservation-1');

    component.closeGroupPreOrder();
    expect(component.groupPreOrderReservationId()).toBeNull();
  });

  it('shows updated group capacity and preserves the existing invitation after a successful edit', () => {
    const existingPreOrder = {
      orderId: 'order-1',
      reservationAddress: 'Test location',
      reservationTime: '2026-11-06T18:00:00Z',
      reservationId: baseReservation.id,
      orderItems: [],
      status: 1,
    };
    component.selectedReservation.set({
      ...baseReservation,
      guestCount: 2,
      hasGroupReservation: true,
      guestInviteLinkAvailable: true,
      preOrder: existingPreOrder,
      preOrders: [existingPreOrder],
    });
    reservationService.editReservation$.and.returnValue(
      of({
        ...baseReservation,
          customerId: 'customer-1',
          tableCapacity: 4,
          guestCount: 4,
        status: ReservationStatus.Reserved,
        hasGroupReservation: true,
        guestInviteLinkAvailable: true,
      })
    );

    component.onSubmitEditReservation(
      { start: '2026-11-06T18:00:00Z', end: '2026-11-06T20:00:00Z' },
      4
    );
    fixture.detectChanges();

    expect(component.showEditReservationConfirmed()).toBeTrue();
    expect(component.selectedReservationAsReservation()?.guestCount).toBe(4);
    expect(component.selectedReservationAsReservation()?.hasGroupReservation).toBeTrue();
    expect(component.selectedReservationAsReservation()?.guestInviteLinkAvailable).toBeTrue();
    expect(component.selectedReservation()?.preOrder).toEqual(existingPreOrder);
    expect(component.selectedReservation()?.preOrders).toEqual([existingPreOrder]);
    expect(fixture.nativeElement.textContent).toContain('4 people');
    const inviteInput = fixture.nativeElement.querySelector(
      '#reservation-confirmed-invite-link'
    ) as HTMLInputElement | null;
    expect(inviteInput?.value).toBe(`${window.location.origin}/join/existing-group-token`);
  });

  it('shows an invitation after a regular reservation is converted to a group', () => {
    component.selectedReservation.set(baseReservation);
    reservationService.editReservation$.and.returnValue(
      of({
        ...baseReservation,
        customerId: 'customer-1',
        tableCapacity: 4,
        guestCount: 3,
        status: ReservationStatus.Reserved,
        hasGroupReservation: true,
        guestInviteLinkAvailable: true,
      })
    );

    component.onSubmitEditReservation(
      { start: '2026-11-06T18:00:00Z', end: '2026-11-06T20:00:00Z' },
      3
    );
    fixture.detectChanges();

    expect(component.selectedReservationAsReservation()?.guestCount).toBe(3);
    expect(component.selectedReservationAsReservation()?.hasGroupReservation).toBeTrue();
    const inviteInput = fixture.nativeElement.querySelector(
      '#reservation-confirmed-invite-link'
    ) as HTMLInputElement | null;
    expect(inviteInput?.value).toContain('/join/existing-group-token');
  });

  it('does not show a success confirmation when editing fails', () => {
    component.selectedReservation.set(baseReservation);
    reservationService.editReservation$.and.returnValue(
      throwError(() => new Error('edit failed'))
    );
    spyOn(console, 'error');

    component.onSubmitEditReservation(
      { start: '2026-11-06T18:00:00Z', end: '2026-11-06T20:00:00Z' },
      3
    );

    expect(component.showEditReservationConfirmed()).toBeFalse();
    expect(component.selectedReservation()).toEqual(baseReservation);
  });
});
