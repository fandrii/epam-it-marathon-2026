import {
  ComponentFixture,
  TestBed,
} from '@angular/core/testing';

import { Order } from '@app/models/orders/order.model';

import { NotSubmittedOrderComponent } from './not-submitted-order.component';

describe('NotSubmittedOrderComponent', () => {
  let component: NotSubmittedOrderComponent;
  let fixture: ComponentFixture<NotSubmittedOrderComponent>;

  const order = {
    orderId: 'order-1',
    status: 0,
    reservationId: 'res-1',
    reservationAddress: 'Test address',
    reservationTime: '2026-09-07T12:15:00Z',
    orderItems: [
      {
        quantity: 2,
        dish: {
          id: 'dish-1',
          price: 10,
        },
      },
    ],
  } as Order;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [NotSubmittedOrderComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(
      NotSubmittedOrderComponent,
    );

    component = fixture.componentInstance;

    fixture.componentRef.setInput('order', order);
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should emit submitted with the order ID', () => {
    spyOn(component.submitted, 'emit');

    component.submit();

    expect(
      component.submitted.emit,
    ).toHaveBeenCalledWith('order-1');
  });

  it('should calculate the total price', () => {
    expect(component.totalPrice()).toBe(20);
  });

  it('displays the dish image and falls back only after an image fails to load', () => {
    const imageOrder = {
      ...order,
      orderItems: [
        {
          ...order.orderItems[0],
          dish: {
            ...order.orderItems[0].dish,
            name: 'Test dish',
            imageUrl: 'https://images.example.test/dish-1.jpg',
          },
        },
      ],
    } as Order;
    fixture.componentRef.setInput('order', imageOrder);
    fixture.detectChanges();

    const image = fixture.nativeElement.querySelector('.dish-image') as HTMLImageElement;
    expect(image.getAttribute('src')).toBe('https://images.example.test/dish-1.jpg');

    image.dispatchEvent(new Event('error'));
    expect(image.getAttribute('src')).toBe('assets/img/dish.png');
  });

  it('uses the fallback image when a dish has no image URL', () => {
    const imageOrder = {
      ...order,
      orderItems: [
        {
          ...order.orderItems[0],
          dish: { ...order.orderItems[0].dish, imageUrl: '' },
        },
      ],
    } as Order;
    fixture.componentRef.setInput('order', imageOrder);
    fixture.detectChanges();

    const image = fixture.nativeElement.querySelector('.dish-image') as HTMLImageElement;
    expect(image.getAttribute('src')).toBe('assets/img/dish.png');
  });
});
