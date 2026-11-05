import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { Reservation, ReservationStatus } from '@app/models/reservations/reservation.model';
import { GuestInviteService } from '@app/services/reservation/guest-invite.service';
import { ToastService } from '@app/services/toast/toast.service';

import { ReservationConfirmedComponent } from './reservation-confirmed.component';

describe('ReservationConfirmedComponent', () => {
  let component: ReservationConfirmedComponent;
  let fixture: ComponentFixture<ReservationConfirmedComponent>;
  let guestInviteService: jasmine.SpyObj<GuestInviteService>;
  let toastService: jasmine.SpyObj<ToastService>;

  const reservation: Reservation = {
    id: 'reservation-1',
    tableId: 'table-1',
    customerId: 'customer-1',
    startTime: new Date('2026-11-04T18:00:00Z'),
    endTime: new Date('2026-11-04T19:00:00Z'),
    guestCount: 2,
    status: ReservationStatus.Reserved,
    locationAddress: 'Test location',
    tableCapacity: 4,
    waiterId: 'waiter-1',
  };

  function render(value: Reservation): void {
    fixture.componentRef.setInput('reservation', value);
    fixture.detectChanges();
  }

  beforeEach(async () => {
    guestInviteService = jasmine.createSpyObj<GuestInviteService>('GuestInviteService', [
      'getInviteToken$',
    ]);
    guestInviteService.getInviteToken$.and.returnValue(of({ token: 'group-token' }));
    toastService = jasmine.createSpyObj<ToastService>('ToastService', ['success', 'error']);

    await TestBed.configureTestingModule({
      imports: [ReservationConfirmedComponent],
      providers: [
        { provide: GuestInviteService, useValue: guestInviteService },
        { provide: ToastService, useValue: toastService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ReservationConfirmedComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    render(reservation);
    expect(component).toBeTruthy();
  });

  it('loads the existing group invitation link when an eligible group reservation is confirmed', () => {
    render({
      ...reservation,
      guestCount: 4,
      hasGroupReservation: true,
      guestInviteLinkAvailable: true,
    });

    expect(guestInviteService.getInviteToken$).toHaveBeenCalledOnceWith(reservation.id);
    expect(component.showInviteField()).toBeTrue();
    const inviteInput = fixture.nativeElement.querySelector(
      '#reservation-confirmed-invite-link'
    ) as HTMLInputElement | null;
    expect(inviteInput?.value).toBe(`${window.location.origin}/join/group-token`);
    expect(fixture.nativeElement.textContent).toContain('4 people');
  });

  it('hides the invitation link for regular reservations', () => {
    render({
      ...reservation,
      guestCount: 4,
      hasGroupReservation: false,
      guestInviteLinkAvailable: false,
    });

    expect(guestInviteService.getInviteToken$).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('#reservation-confirmed-invite-link')).toBeNull();
  });

  it('copies the existing group invitation link', async () => {
    render({
      ...reservation,
      hasGroupReservation: true,
      guestInviteLinkAvailable: true,
    });
    const writeText = spyOn(navigator.clipboard, 'writeText').and.resolveTo();

    await component.onCopyInviteLink();

    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/join/group-token`);
    expect(toastService.success).toHaveBeenCalledWith('Share it with your friends.', 'Link copied!');
  });

  it('shows an error when the existing invitation link cannot be loaded', () => {
    guestInviteService.getInviteToken$.and.returnValue(throwError(() => new Error('failed')));
    render({
      ...reservation,
      hasGroupReservation: true,
      guestInviteLinkAvailable: true,
    });

    expect(toastService.error).toHaveBeenCalledWith(
      'Could not load the invite link. Please try again later.'
    );
    const copyButton = fixture.nativeElement.querySelector(
      'button[aria-label="Copy invite link"]'
    ) as HTMLButtonElement | null;
    expect(copyButton?.disabled).toBeTrue();
  });
});
