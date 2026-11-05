import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { Subject, of, throwError } from 'rxjs';

import { Order } from '@app/models/orders/order.model';
import { PreOrdersService } from '@app/services/pre-orders/pre-orders.service';
import { ToastService } from '@app/services/toast/toast.service';

import { CartComponent } from './cart.component';

describe('CartComponent', () => {
  let component: CartComponent;
  let fixture: ComponentFixture<CartComponent>;

  let preOrdersServiceMock: jasmine.SpyObj<PreOrdersService>;
  let routerMock: jasmine.SpyObj<Router>;
  let toastMock: jasmine.SpyObj<ToastService>;

  const createOrder = (status = 0): Order => ({
    orderId: 'order-1',
    reservationId: 'reservation-1',
    reservationAddress: 'Test restaurant, Table 1',
    reservationTime: '2026-09-07T12:15:00Z',
    status,
    orderItems: [
      {
        dish: {
          id: 'dish-1',
          name: 'Test dish',
          price: 10,
        } as Order['orderItems'][number]['dish'],
        quantity: 2,
        state: 0,
      },
    ],
  });

  beforeEach(async () => {
    preOrdersServiceMock = jasmine.createSpyObj<PreOrdersService>(
      'PreOrdersService',
      [
        'getPreOrders',
        'cancelPreOrderByReservationId',
        'unsubmitPreOrderByReservationId',
        'submitPreOrderByReservationId',
        'editPreOrderByReservationId',
      ],
    );
    routerMock = jasmine.createSpyObj<Router>('Router', ['navigate']);
    toastMock = jasmine.createSpyObj<ToastService>('ToastService', [
      'error',
      'success',
      'info',
    ]);

    preOrdersServiceMock.getPreOrders.and.returnValue(of([]));
    preOrdersServiceMock.cancelPreOrderByReservationId.and.returnValue(of({}));
    preOrdersServiceMock.unsubmitPreOrderByReservationId.and.returnValue(of({}));
    preOrdersServiceMock.submitPreOrderByReservationId.and.returnValue(of({}));
    preOrdersServiceMock.editPreOrderByReservationId.and.returnValue(of({}));
    routerMock.navigate.and.resolveTo(true);

    await TestBed.configureTestingModule({
      imports: [CartComponent],
      providers: [
        { provide: PreOrdersService, useValue: preOrdersServiceMock },
        { provide: Router, useValue: routerMock },
        { provide: ToastService, useValue: toastMock },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(CartComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should emit closeCartEvent when closeCart is called', () => {
    spyOn(component.closeCartEvent, 'emit');

    component.closeCart();

    expect(component.closeCartEvent.emit).toHaveBeenCalled();
  });

  it('should return submitted orders with statuses 1 and 3', () => {
    component.orders.set([
      { ...createOrder(), status: 1 },
      { ...createOrder(), orderId: 'cancelled', status: 2 },
      { ...createOrder(), orderId: 'submitted', status: 3 },
      { ...createOrder(), orderId: 'active', status: 0 },
    ]);

    expect(component.submittedOrders().map((order) => order.status)).toEqual([
      1,
      3,
    ]);
  });

  it('should keep submitted orders out of the active cart', () => {
    component.orders.set([
      { ...createOrder(), status: 3 },
      { ...createOrder(), orderId: 'active', status: 0 },
    ]);

    expect(component.unsubmittedOrders().map((order) => order.orderId)).toEqual([
      'active',
    ]);
  });

  it('should navigate to reservations when goToReservations is called', () => {
    component.goToReservations();

    expect(routerMock.navigate).toHaveBeenCalledWith(['/reservations']);
  });

  it('should reopen the menu with the existing reservation context', () => {
    spyOn(component.closeCartEvent, 'emit');
    component.orders.set([createOrder()]);

    component.addDishToOrder('order-1');

    expect(component.closeCartEvent.emit).toHaveBeenCalled();
    expect(routerMock.navigate).toHaveBeenCalledWith(['/menu'], {
      queryParams: {
        preOrder: true,
        reservationId: 'reservation-1',
        reservationLabel: 'Test restaurant, Table 1',
      },
    });
  });

  it('should update quantity and total from the new order data', () => {
    component.orders.set([createOrder()]);

    component.updateDishQuantity('order-1', 'dish-1', 3);

    const updatedOrder = preOrdersServiceMock.editPreOrderByReservationId
      .calls.mostRecent()
      .args[1];
    expect(updatedOrder.orderItems[0].quantity).toBe(3);
    expect(updatedOrder.orderItems[0].dish.price * updatedOrder.orderItems[0].quantity)
      .toBe(30);
    expect(preOrdersServiceMock.editPreOrderByReservationId).toHaveBeenCalledWith(
      'reservation-1',
      updatedOrder,
    );
  });

  it('should remove a dish and preserve an empty order for the service to clear', () => {
    component.orders.set([createOrder()]);

    component.removeDishFromOrder('order-1', 'dish-1');

    expect(
      preOrdersServiceMock.editPreOrderByReservationId.calls.mostRecent().args[1]
        .orderItems,
    ).toEqual([]);
  });

  it('should move an order to history after successful submission', () => {
    component.orders.set([createOrder()]);

    component.submitOrder('order-1');

    expect(component.unsubmittedOrders()).toEqual([]);
    expect(component.submittedOrders().map((order) => order.orderId)).toEqual([
      'order-1',
    ]);
    expect(component.submitOrderId()).toBe('order-1');
  });

  it('should retain the cart and not show confirmation when submission fails', () => {
    const error = new Error('request failed');
    spyOn(console, 'error');
    preOrdersServiceMock.submitPreOrderByReservationId.and.returnValue(
      throwError(() => error),
    );
    component.orders.set([createOrder()]);

    component.submitOrder('order-1');

    expect(component.unsubmittedOrders().length).toBe(1);
    expect(component.submitOrderId()).toBeNull();
    expect(toastMock.error).toHaveBeenCalled();
  });

  it('should ignore duplicate submissions while a request is pending', () => {
    const request = new Subject<object>();
    preOrdersServiceMock.submitPreOrderByReservationId.and.returnValue(
      request,
    );
    component.orders.set([createOrder()]);

    component.submitOrder('order-1');
    component.submitOrder('order-1');

    expect(
      preOrdersServiceMock.submitPreOrderByReservationId,
    ).toHaveBeenCalledTimes(1);
    expect(component.isOrderBusy('order-1')).toBeTrue();

    request.next({});
    request.complete();

    expect(component.isOrderBusy('order-1')).toBeFalse();
  });

  it('should preserve cart contents and allow retry after an edit fails', () => {
    spyOn(console, 'error');
    preOrdersServiceMock.editPreOrderByReservationId.and.returnValue(
      throwError(() => new Error('request failed')),
    );
    const order = createOrder();
    component.orders.set([order]);

    component.updateDishQuantity('order-1', 'dish-1', 5);

    expect(component.orders()[0]).toEqual(order);
    expect(component.isOrderBusy('order-1')).toBeFalse();
    expect(toastMock.error).toHaveBeenCalled();
  });
});
