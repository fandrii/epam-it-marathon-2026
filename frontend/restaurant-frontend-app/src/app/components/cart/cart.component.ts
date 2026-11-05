import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  output,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { finalize, Observable } from 'rxjs';

import { Order } from '@app/models/orders/order.model';
import { PreOrdersService } from '@app/services/pre-orders/pre-orders.service';
import { ToastService } from '@app/services/toast/toast.service';

import { CancelOrderModalComponent } from './components/cancel-order-modal/cancel-order-modal.component';
import { NotSubmittedOrderComponent } from './components/not-submitted-order/not-submitted-order.component';
import { SubmitOrderModalComponent } from './components/submit-order-modal/submit-order-modal.component';
import { SubmittedOrderComponent } from './components/submitted-order/submitted-order.component';

@Component({
  selector: 'app-cart',
  standalone: true,
  imports: [
    SubmittedOrderComponent,
    NotSubmittedOrderComponent,
    CancelOrderModalComponent,
    SubmitOrderModalComponent,
  ],
  templateUrl: './cart.component.html',
  styleUrl: './cart.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CartComponent implements OnInit {
  private readonly preOrdersService =
    inject(PreOrdersService);

  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly toast = inject(ToastService);

  readonly closeCartEvent = output<void>();

  readonly orders = signal<Order[]>([]);
  readonly loadingOrders = signal(false);
  readonly loadError = signal<string | null>(null);
  readonly busyOrderIds = signal<ReadonlySet<string>>(new Set());

  readonly cancelOrderId = signal<string | null>(null);
  readonly submitOrderId = signal<string | null>(null);
  private loadRequestId = 0;

  readonly submittedOrders = computed(() =>
    this.orders().filter(
      (order) => order.status === 1 || order.status === 3,
    ),
  );

  readonly unsubmittedOrders = computed(() =>
    this.orders().filter((order) => order.status === 0),
  );

  readonly submittedOrder = computed(() => {
    const orderId = this.submitOrderId();

    if (!orderId) {
      return undefined;
    }

    return this.orders().find(
      (order) => order.orderId === orderId,
    );
  });

  ngOnInit(): void {
    this.loadOrders();
  }

  closeCart(): void {
    this.closeCartEvent.emit();
  }

  openCancelModal(orderId: string): void {
    this.cancelOrderId.set(orderId);
    this.submitOrderId.set(null);
  }

  closeCancelModal(): void {
    this.cancelOrderId.set(null);
  }

  closeSubmitModal(): void {
    this.submitOrderId.set(null);
  }

  editOrderModal(): void {
    const orderId = this.submitOrderId();

    if (!orderId) {
      console.error('No order selected for editing');
      return;
    }

    this.editOrder(orderId);
    this.closeSubmitModal();
  }

  goToReservations(): void {
    this.closeCart();
    void this.router.navigate(['/reservations']);
  }

  isOrderBusy(orderId: string): boolean {
    return this.busyOrderIds().has(orderId);
  }

  retryLoadOrders(): void {
    this.loadOrders();
  }

  cancelOrder(orderId: string): void {
    const order = this.findOrder(orderId);

    if (!order) {
      return;
    }

    this.runOrderOperation(
      orderId,
      'cancel',
      () =>
        this.preOrdersService.cancelPreOrderByReservationId(
          order.reservationId,
        ),
      () => {
          this.closeCancelModal();
          this.loadOrders();
      },
    );
  }

  editOrder(orderId: string): void {
    const order = this.findOrder(orderId);

    if (!order) {
      return;
    }

    this.runOrderOperation(
      orderId,
      'edit',
      () =>
        this.preOrdersService.unsubmitPreOrderByReservationId(
          order.reservationId,
        ),
      () => {
          this.loadOrders();
      },
    );
  }

  submitOrder(orderId: string): void {
    const order = this.findOrder(orderId);

    if (!order) {
      return;
    }

    this.runOrderOperation(
      orderId,
      'submit',
      () =>
        this.preOrdersService.submitPreOrderByReservationId(
          order.reservationId,
        ),
      () => {
          this.orders.update((orders) =>
            orders.map((item) =>
              item.orderId === orderId
                ? { ...item, status: 3 }
                : item,
            ),
          );
          this.submitOrderId.set(orderId);
      },
    );
  }

  addDishToOrder(orderId: string): void {
    const order = this.findOrder(orderId);

    if (!order) {
      return;
    }

    this.closeCart();
    void this.router.navigate(['/menu'], {
      queryParams: {
        preOrder: true,
        reservationId: order.reservationId,
        reservationLabel: order.reservationAddress,
      },
    });
  }

  updateDishQuantity(
    orderId: string,
    itemId: string,
    quantity: number,
  ): void {
    if (quantity <= 0) {
      return;
    }

    const originalOrder = this.findOrder(orderId);

    if (!originalOrder) {
      return;
    }

    const updatedOrder: Order = {
      ...originalOrder,
      orderItems: originalOrder.orderItems.map((item) =>
        item.dish.id === itemId
          ? {
            ...item,
            quantity,
          }
          : item,
      ),
    };

    this.runOrderOperation(
      orderId,
      'update',
      () =>
        this.preOrdersService.editPreOrderByReservationId(
          updatedOrder.reservationId,
          updatedOrder,
        ),
      () => {
          this.loadOrders();
      },
    );
  }

  removeDishFromOrder(
    orderId: string,
    itemId: string,
  ): void {
    const originalOrder = this.findOrder(orderId);

    if (!originalOrder) {
      return;
    }

    const updatedOrder: Order = {
      ...originalOrder,
      orderItems: originalOrder.orderItems.filter(
        (item) => item.dish.id !== itemId,
      ),
    };

    this.runOrderOperation(
      orderId,
      'update',
      () =>
        this.preOrdersService.editPreOrderByReservationId(
          updatedOrder.reservationId,
          updatedOrder,
        ),
      () => {
          this.loadOrders();
      },
    );
  }

  private findOrder(orderId: string): Order | undefined {
    const order = this.orders().find(
      (item) => item.orderId === orderId,
    );

    if (!order) {
      console.error(`Order with ID ${orderId} not found`);
    }

    return order;
  }

  private loadOrders(): void {
    const requestId = ++this.loadRequestId;
    this.loadingOrders.set(true);
    this.loadError.set(null);

    this.preOrdersService
      .getPreOrders()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (orders) => {
          if (requestId === this.loadRequestId) {
            this.orders.set(orders);
          }
        },
        error: (error) => {
          console.error('Error loading orders:', error);
          if (requestId === this.loadRequestId) {
            this.loadError.set(
              'Your orders could not be loaded. Please try again.',
            );
            this.loadingOrders.set(false);
          }
        },
        complete: () => {
          if (requestId === this.loadRequestId) {
            this.loadingOrders.set(false);
          }
        },
      });
  }

  private runOrderOperation(
    orderId: string,
    operation: string,
    request: () => Observable<unknown>,
    onSuccess: () => void,
  ): void {
    if (this.isOrderBusy(orderId)) {
      return;
    }

    this.setOrderBusy(orderId, true);
    request()
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.setOrderBusy(orderId, false)),
      )
      .subscribe({
        next: () => {
          onSuccess();
        },
        error: (error) => {
          console.error(`Error ${operation}ing order ${orderId}:`, error);
          const action = {
            cancel: 'canceled',
            edit: 'edited',
            submit: 'submitted',
            update: 'updated',
          }[operation] ?? operation;
          this.toast.error(
            `The order could not be ${action}. Please try again.`,
            'Error',
          );
        },
      });
  }

  private setOrderBusy(orderId: string, busy: boolean): void {
    this.busyOrderIds.update((current) => {
      const updated = new Set(current);
      if (busy) {
        updated.add(orderId);
      } else {
        updated.delete(orderId);
      }
      return updated;
    });
  }
}
