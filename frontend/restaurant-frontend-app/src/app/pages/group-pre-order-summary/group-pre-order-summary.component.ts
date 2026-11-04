import { CurrencyPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Subscription, finalize, timer } from 'rxjs';

import {
  GroupSessionItem,
  GroupSessionParticipant,
  GroupSessionsSnapshot,
  GuestSessionsService,
} from '@app/services/guest-sessions/guest-sessions.service';
import { getServerErrorMessage } from '@app/shared/helpers/http-error-helpers';

@Component({
  selector: 'app-group-pre-order-summary',
  standalone: true,
  imports: [CurrencyPipe, RouterLink],
  templateUrl: './group-pre-order-summary.component.html',
  styleUrl: './group-pre-order-summary.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GroupPreOrderSummaryComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly guestSessionsService = inject(GuestSessionsService);
  private readonly destroyRef = inject(DestroyRef);

  readonly snapshot = signal<GroupSessionsSnapshot | null>(null);
  readonly reservationId = signal<string | null>(null);
  readonly groupReservationId = signal<string | null>(null);
  readonly isLoading = signal(true);
  readonly isRefreshing = signal(false);
  readonly errorMessage = signal('');
  readonly deleteConfirmation = signal<GroupSessionParticipant | null>(null);
  readonly deleteError = signal('');
  readonly isDeleting = signal(false);

  readonly guests = computed(
    () => this.snapshot()?.participants.filter((participant) => participant.type === 'Guest') ?? []
  );
  readonly guestTotal = computed(() => {
    const cents = this.guests().reduce(
      (sum, participant) => sum + Math.round(participant.total * 100),
      0
    );
    return cents / 100;
  });

  private contextVersion = 0;
  private snapshotGeneration = 0;
  private snapshotRequestInFlight = false;
  private ownerRequest?: Subscription;
  private snapshotRequest?: Subscription;
  private deleteRequest?: Subscription;

  ngOnInit(): void {
    this.route.paramMap
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((params) => this.openReservation(params.get('reservationId')));

    timer(10_000, 10_000)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.refreshSnapshot());
  }

  refreshSnapshot(): void {
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

    this.deleteError.set('');
    this.deleteConfirmation.set(participant);
  }

  cancelDelete(): void {
    if (!this.isDeleting()) {
      this.deleteConfirmation.set(null);
      this.deleteError.set('');
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

  private openReservation(reservationId: string | null): void {
    const contextVersion = ++this.contextVersion;
    this.reservationId.set(reservationId);
    this.ownerRequest?.unsubscribe();
    this.deleteRequest?.unsubscribe();
    this.cancelSnapshotRequest();
    this.snapshot.set(null);
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

          this.errorMessage.set(this.describeError(error, 'Unable to load this group reservation.'));
          this.isLoading.set(false);
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
}
