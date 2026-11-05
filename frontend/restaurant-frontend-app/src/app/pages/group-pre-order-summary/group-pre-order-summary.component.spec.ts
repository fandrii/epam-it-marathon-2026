import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { BehaviorSubject, Subject, of, throwError } from 'rxjs';

import {
  GroupSessionsSnapshot,
  GuestSessionsService,
} from '@app/services/guest-sessions/guest-sessions.service';
import { Order } from '@app/models/orders/order.model';
import { PreOrdersService } from '@app/services/pre-orders/pre-orders.service';
import { GroupPreOrderSummaryComponent } from './group-pre-order-summary.component';

describe('GroupPreOrderSummaryComponent', () => {
  let fixture: ComponentFixture<GroupPreOrderSummaryComponent>;
  let service: jasmine.SpyObj<GuestSessionsService>;
  let preOrdersService: jasmine.SpyObj<PreOrdersService>;
  let routeParams: BehaviorSubject<ReturnType<typeof convertToParamMap>>;

  const snapshot: GroupSessionsSnapshot = {
    participants: [
      {
        id: 'owner-session',
        type: 'Owner',
        name: 'Owner',
        items: [{ dish: { id: 'owner-dish', name: 'Owner Dish', price: 99 }, quantity: 1 }],
        total: 99,
        isSubmitted: true,
      },
      {
        id: 'guest-1',
        type: 'Guest',
        name: 'Alex Guest',
        items: [{ dish: { id: 'dish-1', name: 'Pasta', price: 5.25 }, quantity: 2 }],
        total: 10.5,
        isSubmitted: true,
      },
    ],
    total: 109.5,
  };

  beforeEach(async () => {
    routeParams = new BehaviorSubject(convertToParamMap({ reservationId: 'reservation-1' }));
    service = jasmine.createSpyObj<GuestSessionsService>('GuestSessionsService', [
      'getOwnerGuestSessionInfo',
      'getGroupSessions',
      'deleteGuestSession',
    ]);
    service.getOwnerGuestSessionInfo.and.returnValue(
      of({ guestSessionId: 'owner-session', groupReservationId: 'group-1' })
    );
    service.getGroupSessions.and.returnValue(of(snapshot));
    service.deleteGuestSession.and.returnValue(of({ participants: [], total: 99 }));
    preOrdersService = jasmine.createSpyObj<PreOrdersService>('PreOrdersService', [
      'getPreOrders',
    ]);
    preOrdersService.getPreOrders.and.returnValue(of([]));

    await TestBed.configureTestingModule({
      imports: [GroupPreOrderSummaryComponent],
      providers: [
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { paramMap: routeParams.asObservable() } },
        { provide: GuestSessionsService, useValue: service },
        { provide: PreOrdersService, useValue: preOrdersService },
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

  it('loads all submitted owner orders for the selected reservation from order history', () => {
    const createOrder = (
      orderId: string,
      reservationId: string,
      status: number,
      dishId: string,
      name: string,
      price: number,
      quantity: number
    ): Order => ({
      orderId,
      reservationId,
      status,
      reservationAddress: 'Test location',
      reservationTime: '2026-11-06T18:00:00Z',
      orderItems: [
        {
          dish: {
            id: dishId,
            name,
            imageUrl: `https://images.example.test/${dishId}.jpg`,
            price,
            state: 'Available',
            weight: '250g',
            dishType: 'MainCourse',
            description: '',
            calories: '0',
            proteins: '0',
            carbohydrates: '0',
            fats: '0',
            vitamins: '',
          },
          quantity,
          state: 0,
        },
      ],
    });
    preOrdersService.getPreOrders.and.returnValue(
      of([
        createOrder('order-1', 'reservation-1', 1, 'dish-1', 'Owner Pasta', 10, 2),
        createOrder('order-2', 'reservation-1', 3, 'dish-2', 'Owner Salad', 3, 2),
        createOrder('draft', 'reservation-1', 0, 'draft-dish', 'Draft Dish', 20, 1),
        createOrder('other-reservation', 'reservation-2', 1, 'other-dish', 'Other Dish', 50, 1),
      ])
    );
    service.getOwnerGuestSessionInfo.calls.reset();
    service.getGroupSessions.calls.reset();

    const ownerFixture = TestBed.createComponent(GroupPreOrderSummaryComponent);
    ownerFixture.componentRef.setInput('reservationIdForModal', 'reservation-1');
    ownerFixture.componentRef.setInput('showOwnerOnly', true);
    ownerFixture.detectChanges();

    const text = ownerFixture.nativeElement.textContent as string;
    const images = ownerFixture.nativeElement.querySelectorAll(
      '.owner-dish-image'
    ) as NodeListOf<HTMLImageElement>;
    expect(preOrdersService.getPreOrders).toHaveBeenCalledTimes(1);
    expect(service.getOwnerGuestSessionInfo).not.toHaveBeenCalled();
    expect(service.getGroupSessions).not.toHaveBeenCalled();
    expect(ownerFixture.componentInstance.ownerOrders().map((order) => order.orderId)).toEqual([
      'order-1',
      'order-2',
    ]);
    expect(text).toContain('Owner Pasta');
    expect(text).toContain('Owner Salad');
    expect(text).toContain('$20.00');
    expect(text).toContain('$6.00');
    expect(text).toContain('$26.00');
    expect(text).toContain('Submitted');
    expect(text).not.toContain('Draft Dish');
    expect(text).not.toContain('Other Dish');
    expect(images.length).toBe(2);
    expect(images[0].getAttribute('src')).toBe('https://images.example.test/dish-1.jpg');
    ownerFixture.destroy();
  });

  it('shows an empty state when no submitted owner orders belong to the reservation', () => {
    preOrdersService.getPreOrders.and.returnValue(
      of([
        {
          orderId: 'draft',
          reservationId: 'reservation-1',
          status: 0,
          reservationAddress: '',
          reservationTime: '',
          orderItems: [],
        },
      ])
    );

    const ownerFixture = TestBed.createComponent(GroupPreOrderSummaryComponent);
    ownerFixture.componentRef.setInput('reservationIdForModal', 'reservation-1');
    ownerFixture.componentRef.setInput('showOwnerOnly', true);
    ownerFixture.detectChanges();

    expect(ownerFixture.nativeElement.textContent).toContain(
      'No submitted owner pre-orders are associated with this reservation.'
    );
    expect(ownerFixture.nativeElement.textContent).toContain('$0.00');
    ownerFixture.destroy();
  });

  it('requires confirmation and immediately applies the deletion response snapshot', () => {
    const guest = fixture.componentInstance.guests()[0];
    fixture.componentInstance.requestDelete(guest);
    fixture.detectChanges();

    expect(service.deleteGuestSession).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('[role="dialog"]')).not.toBeNull();

    fixture.nativeElement.querySelector('.dialog-actions button:last-child').click();
    fixture.detectChanges();

    expect(service.deleteGuestSession).toHaveBeenCalledWith('group-1', 'guest-1');
    expect(fixture.componentInstance.guests()).toEqual([]);
    expect(fixture.nativeElement.textContent).toContain('$0.00');
    expect(fixture.nativeElement.querySelectorAll('[role="dialog"]').length).toBe(1);
  });

  it('renders the summary as an accessible modal and locks background scrolling', () => {
    const dialog = fixture.nativeElement.querySelector('[role="dialog"]') as HTMLElement;

    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-labelledby')).toBe('group-summary-title');
    expect(document.body.style.overflow).toBe('hidden');
  });

  it('closes on Escape and restores the previous body scroll style', () => {
    const router = TestBed.inject(Router);
    spyOn(router, 'navigate').and.returnValue(Promise.resolve(true));

    fixture.nativeElement
      .querySelector('.modal-backdrop')
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(router.navigate).toHaveBeenCalledWith(['/reservations']);
    fixture.destroy();
    expect(document.body.style.overflow).toBe('');
  });

  it('closes only when the backdrop itself is clicked', () => {
    const router = TestBed.inject(Router);
    spyOn(router, 'navigate').and.returnValue(Promise.resolve(true));
    const backdrop = fixture.nativeElement.querySelector('.modal-backdrop') as HTMLElement;
    const dialog = fixture.nativeElement.querySelector('.summary-dialog') as HTMLElement;

    dialog.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(router.navigate).not.toHaveBeenCalled();

    backdrop.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(router.navigate).toHaveBeenCalledWith(['/reservations']);
  });

  it('closes with the X button', () => {
    const router = TestBed.inject(Router);
    spyOn(router, 'navigate').and.returnValue(Promise.resolve(true));
    const closeButton = fixture.nativeElement.querySelector(
      '[aria-label="Close group pre-order"]'
    ) as HTMLButtonElement;

    closeButton.click();

    expect(router.navigate).toHaveBeenCalledWith(['/reservations']);
  });

  it('Escape dismisses guest deletion confirmation first and restores focus', fakeAsync(() => {
    const removeButton = fixture.nativeElement.querySelector(
      '.participant-header button'
    ) as HTMLButtonElement;
    removeButton.focus();
    fixture.componentInstance.requestDelete(fixture.componentInstance.guests()[0]);
    fixture.detectChanges();
    tick();

    expect(document.activeElement).toBe(
      fixture.nativeElement.querySelector('.delete-confirmation .dialog-initial-focus')
    );

    fixture.nativeElement
      .querySelector('.modal-backdrop')
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();
    tick();

    expect(fixture.componentInstance.deleteConfirmation()).toBeNull();
    expect(document.activeElement).toBe(removeButton);
  }));

  it('emits closed when used as a modal inside the reservation dashboard', () => {
    const modalFixture = TestBed.createComponent(GroupPreOrderSummaryComponent);
    modalFixture.componentRef.setInput('reservationIdForModal', 'reservation-1');
    const closed = jasmine.createSpy('closed');
    modalFixture.componentInstance.closed.subscribe(closed);
    modalFixture.detectChanges();

    modalFixture.componentInstance.close();

    expect(closed).toHaveBeenCalled();
    modalFixture.destroy();
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
