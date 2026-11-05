import { CurrencyPipe } from '@angular/common';
import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  OnDestroy,
  ElementRef,
  ViewChild,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription, finalize, timer } from 'rxjs';

import { Order } from '@app/models/orders/order.model';
import { PreOrdersService } from '@app/services/pre-orders/pre-orders.service';
import {
  GroupSessionItem,
  GroupSessionParticipant,
  GroupSessionsSnapshot,
  GuestSessionsService,
} from '@app/services/guest-sessions/guest-sessions.service';
import { getServerErrorMessage } from '@app/shared/helpers/http-error-helpers';
import { DishImageFallbackDirective } from '@app/shared/directives/dish-image-fallback.directive';

@Component({
  selector: 'app-group-pre-order-summary',
  standalone: true,
  imports: [CurrencyPipe, DishImageFallbackDirective],
  templateUrl: './group-pre-order-summary.component.html',
  styleUrl: './group-pre-order-summary.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GroupPreOrderSummaryComponent implements OnInit, AfterViewInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly guestSessionsService = inject(GuestSessionsService);
  private readonly preOrdersService = inject(PreOrdersService);
  private readonly destroyRef = inject(DestroyRef);

  @ViewChild('summaryDialog') private summaryDialog?: ElementRef<HTMLElement>;
  readonly reservationIdForModal = input<string | null>(null);
  readonly showOwnerOnly = input(false);
  readonly closed = output<void>();
  readonly snapshot = signal<GroupSessionsSnapshot | null>(null);
  readonly ownerOrders = signal<Order[]>([]);
  readonly ownerOrdersLoaded = signal(false);
  readonly reservationId = signal<string | null>(null);
  readonly groupReservationId = signal<string | null>(null);
  readonly isLoading = signal(true);
  readonly isRefreshing = signal(false);
  readonly errorMessage = signal('');
  readonly deleteConfirmation = signal<GroupSessionParticipant | null>(null);
  readonly deleteError = signal('');
  readonly isDeleting = signal(false);

  readonly guests = computed(() => {
    const participants = this.snapshot()?.participants ?? [];
    return this.showOwnerOnly()
      ? participants.filter((participant) => participant.type === 'Owner')
      : participants.filter((participant) => participant.type === 'Guest');
  });
  readonly guestTotal = computed(() => {
    const cents = this.guests().reduce(
      (sum, participant) => sum + Math.round(participant.total * 100),
      0
    );
    return cents / 100;
  });
  readonly ownerOrdersTotal = computed(() => {
    const cents = this.ownerOrders().reduce(
      (sum, order) => sum + Math.round(this.ownerOrderTotal(order) * 100),
      0
    );
    return cents / 100;
  });
  readonly modalTitle = computed(() => (this.showOwnerOnly() ? 'Owner Pre-Order' : 'Group Pre-Order'));
  readonly modalSubtitle = computed(() =>
    this.showOwnerOnly()
      ? 'The owner order and total'
      : 'Guest orders and individual totals'
  );

  private contextVersion = 0;
  private snapshotGeneration = 0;
  private snapshotRequestInFlight = false;
  private ownerRequest?: Subscription;
  private snapshotRequest?: Subscription;
  private deleteRequest?: Subscription;
  private previousBodyOverflow = '';
  private deleteTrigger?: HTMLElement;

  ngOnInit(): void {
    this.previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const reservationId = this.reservationIdForModal();
    if (reservationId) {
      this.openReservation(reservationId);
    } else {
      this.route.paramMap
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe((params) => this.openReservation(params.get('reservationId')));
    }

    timer(10_000, 10_000)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.refreshSnapshot());
  }

  ngAfterViewInit(): void {
    this.focusInitialElement();
  }

  ngOnDestroy(): void {
    document.body.style.overflow = this.previousBodyOverflow;
  }

  close(): void {
    const reservationId = this.reservationId();
    if (this.reservationIdForModal()) {
      this.closed.emit();
      if (reservationId) {
        setTimeout(() => this.restoreTriggerFocus(reservationId));
      }
      return;
    }

    void this.router.navigate(['/reservations']).then((navigated) => {
      if (navigated && reservationId) {
        setTimeout(() => this.restoreTriggerFocus(reservationId));
      }
    });
  }

  onBackdropClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      this.close();
    }
  }

  onDocumentKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      if (this.deleteConfirmation()) {
        this.cancelDelete();
      } else {
        this.close();
      }
      return;
    }

    if (event.key === 'Tab') {
      this.trapFocus(event);
    }
  }

  refreshSnapshot(): void {
    if (this.showOwnerOnly()) {
      this.refreshOwnerOrders();
      return;
    }

    const groupReservationId = this.groupReservationId();
    if (!groupReservationId || this.snapshotRequestInFlight || this.isDeleting()) {
      return;
    }

    const contextVersion = this.contextVersion;
    const generation = ++this.snapshotGeneration;
    this.snapshotRequestInFlight = true;
    this.isRefreshing.set(true);
    this.isLoading.set(this.snapshot() === null);

    this.snapshotRequest = this.guestSessionsService
      .getGroupSessions(groupReservationId)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => {
          if (generation === this.snapshotGeneration) {
            this.snapshotRequestInFlight = false;
            this.isRefreshing.set(false);
            this.snapshotRequest = undefined;
          }
        })
      )
      .subscribe({
        next: (snapshot) => {
          if (contextVersion !== this.contextVersion || generation !== this.snapshotGeneration) {
            return;
          }

          this.snapshot.set(snapshot);
          this.errorMessage.set('');
          this.isLoading.set(false);
        },
        error: (error: unknown) => {
          if (contextVersion !== this.contextVersion || generation !== this.snapshotGeneration) {
            return;
          }

          this.errorMessage.set(this.describeError(error, 'Unable to load the group pre-order.'));
          this.isLoading.set(false);
        },
      });
  }

  retryLoad(): void {
    this.errorMessage.set('');
    if (this.showOwnerOnly() && this.reservationId()) {
      this.refreshOwnerOrders();
      return;
    }

    if (this.groupReservationId()) {
      this.refreshSnapshot();
      return;
    }

    this.openReservation(this.reservationId());
  }

  requestDelete(participant: GroupSessionParticipant): void {
    if (!participant.id || this.isDeleting()) {
      return;
    }

    this.deleteTrigger =
      document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    this.deleteError.set('');
    this.deleteConfirmation.set(participant);
    setTimeout(() => this.focusInitialElement());
  }

  cancelDelete(): void {
    if (!this.isDeleting()) {
      this.deleteConfirmation.set(null);
      this.deleteError.set('');
      setTimeout(() => this.deleteTrigger?.focus());
    }
  }

  confirmDelete(): void {
    const participant = this.deleteConfirmation();
    const groupReservationId = this.groupReservationId();
    if (!participant?.id || !groupReservationId || this.isDeleting()) {
      return;
    }

    const contextVersion = this.contextVersion;
    this.cancelSnapshotRequest();
    this.deleteError.set('');
    this.isDeleting.set(true);

    this.deleteRequest = this.guestSessionsService
      .deleteGuestSession(groupReservationId, participant.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (snapshot) => {
          if (contextVersion !== this.contextVersion) {
            return;
          }

          this.snapshot.set(snapshot);
          this.errorMessage.set('');
          this.deleteConfirmation.set(null);
          this.isDeleting.set(false);
          this.deleteTrigger = undefined;
          setTimeout(() => this.focusInitialElement());
        },
        error: (error: unknown) => {
          if (contextVersion !== this.contextVersion) {
            return;
          }

          this.deleteError.set(this.describeError(error, 'Unable to delete this guest session.'));
          this.isDeleting.set(false);
        },
      });
  }

  lineTotal(item: GroupSessionItem): number {
    return Math.round(item.dish.price * item.quantity * 100) / 100;
  }

  ownerLineTotal(item: Order['orderItems'][number]): number {
    return Math.round(item.dish.price * item.quantity * 100) / 100;
  }

  ownerOrderTotal(order: Order): number {
    return order.orderItems
      .filter((item) => item.state !== 2)
      .reduce((sum, item) => sum + this.ownerLineTotal(item), 0);
  }

  ownerOrderStatus(status: number): string {
    switch (status) {
      case 0:
        return 'Created';
      case 1:
        return 'Submitted';
      case 2:
        return 'Cancelled';
      case 3:
        return 'Submitted by customer';
      default:
        return 'Unknown';
    }
  }

  private openReservation(reservationId: string | null): void {
    const contextVersion = ++this.contextVersion;
    this.reservationId.set(reservationId);
    this.ownerRequest?.unsubscribe();
    this.deleteRequest?.unsubscribe();
    this.cancelSnapshotRequest();
    this.snapshot.set(null);
    this.ownerOrders.set([]);
    this.ownerOrdersLoaded.set(false);
    this.groupReservationId.set(null);
    this.deleteConfirmation.set(null);
    this.deleteError.set('');
    this.errorMessage.set('');
    this.isLoading.set(true);
    this.isDeleting.set(false);

    if (!reservationId) {
      this.errorMessage.set('Reservation ID is missing.');
      this.isLoading.set(false);
      return;
    }

    if (this.showOwnerOnly()) {
      this.refreshOwnerOrders();
      return;
    }

    this.ownerRequest = this.guestSessionsService
      .getOwnerGuestSessionInfo(reservationId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (info) => {
          if (contextVersion !== this.contextVersion) {
            return;
          }

          this.groupReservationId.set(info.groupReservationId);
          this.refreshSnapshot();
        },
        error: (error: unknown) => {
          if (contextVersion !== this.contextVersion) {
            return;
          }

          this.errorMessage.set(
            this.describeError(error, 'Unable to load this group reservation.')
          );
          this.isLoading.set(false);
        },
      });
  }

  private refreshOwnerOrders(): void {
    const reservationId = this.reservationId();
    if (!reservationId || this.snapshotRequestInFlight || this.isDeleting()) {
      return;
    }

    const contextVersion = this.contextVersion;
    const generation = ++this.snapshotGeneration;
    this.snapshotRequestInFlight = true;
    this.isRefreshing.set(true);
    this.isLoading.set(!this.ownerOrdersLoaded());

    this.ownerRequest = this.preOrdersService
      .getPreOrders()
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => {
          if (generation === this.snapshotGeneration) {
            this.snapshotRequestInFlight = false;
            this.isRefreshing.set(false);
            this.isLoading.set(false);
            this.ownerRequest = undefined;
          }
        })
      )
      .subscribe({
        next: (orders) => {
          if (contextVersion !== this.contextVersion || generation !== this.snapshotGeneration) {
            return;
          }

          this.ownerOrders.set(
            orders.filter(
              (order) =>
                order.reservationId === reservationId &&
                (order.status === 1 || order.status === 3)
            )
          );
          this.ownerOrdersLoaded.set(true);
          this.errorMessage.set('');
        },
        error: (error: unknown) => {
          if (contextVersion !== this.contextVersion || generation !== this.snapshotGeneration) {
            return;
          }

          this.errorMessage.set(this.describeError(error, 'Unable to load the owner pre-order.'));
        },
      });
  }

  private cancelSnapshotRequest(): void {
    this.snapshotGeneration++;
    this.snapshotRequestInFlight = false;
    this.isRefreshing.set(false);
    const request = this.snapshotRequest;
    this.snapshotRequest = undefined;
    request?.unsubscribe();
  }

  private describeError(error: unknown, fallback: string): string {
    if (error instanceof HttpErrorResponse) {
      return getServerErrorMessage(error) || fallback;
    }

    if (error instanceof Error) {
      return error.message || fallback;
    }

    return fallback;
  }

  private focusInitialElement(): void {
    const dialog = this.summaryDialog?.nativeElement;
    const activeDialog = this.deleteConfirmation()
      ? dialog?.querySelector<HTMLElement>('.delete-confirmation')
      : dialog;
    const target =
      activeDialog?.querySelector<HTMLElement>('.dialog-initial-focus') ?? activeDialog;
    target?.focus();
  }

  private trapFocus(event: KeyboardEvent): void {
    const dialog = this.summaryDialog?.nativeElement;
    const activeDialog = this.deleteConfirmation()
      ? dialog?.querySelector<HTMLElement>('.delete-confirmation')
      : dialog;
    if (!activeDialog) {
      return;
    }

    const focusableElements = Array.from(
      activeDialog.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
    ).filter((element) => element.getClientRects().length > 0);

    if (focusableElements.length === 0) {
      event.preventDefault();
      activeDialog.focus();
      return;
    }

    const first = focusableElements[0];
    const last = focusableElements[focusableElements.length - 1];
    if (
      event.shiftKey &&
      (document.activeElement === first || !activeDialog.contains(document.activeElement))
    ) {
      event.preventDefault();
      last.focus();
    } else if (
      !event.shiftKey &&
      (document.activeElement === last || !activeDialog.contains(document.activeElement))
    ) {
      event.preventDefault();
      first.focus();
    }
  }

  private restoreTriggerFocus(reservationId: string): void {
    const trigger = Array.from(
      document.querySelectorAll<HTMLButtonElement>('[data-group-pre-order-trigger]')
    ).find((button) => button.dataset['groupPreOrderTrigger'] === reservationId);
    trigger?.focus();
  }
}
