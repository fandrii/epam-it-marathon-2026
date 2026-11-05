import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import {
  Reservation,
  ReservationStatus,
} from '@app/models/reservations/reservation.model';
import { GuestInviteService } from '@app/services/reservation/guest-invite.service';
import { ToastService } from '@app/services/toast/toast.service';
import { CustomButtonComponent } from '@app/shared/custom-components/custom-button/custom-button.component';

@Component({
  selector: 'app-reservation-confirmed',
  standalone: true,
  imports: [
    DatePipe,
    CustomButtonComponent,
  ],
  templateUrl: './reservation-confirmed.component.html',
  styleUrl: './reservation-confirmed.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.fade-out]': 'isFading()',
  },
})
export class ReservationConfirmedComponent implements OnInit {
  private readonly guestInviteService = inject(GuestInviteService);
  private readonly toastService = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  readonly reservation = input.required<Reservation>();
  readonly customClass = input('');

  readonly closed = output<void>();
  readonly editReservation = output<void>();
  readonly cancelReservation = output<void>();

  readonly isFading = signal(false);
  private readonly inviteToken = signal<string | null>(null);
  private readonly inviteLoading = signal(false);
  private readonly inviteFailed = signal(false);

  readonly showInviteField = computed(
    () =>
      this.reservation().guestCount >= 2 &&
      this.reservation().status === ReservationStatus.Reserved &&
      this.reservation().hasGroupReservation === true &&
      this.reservation().guestInviteLinkAvailable === true
  );
  readonly inviteLink = computed(() => {
    const token = this.inviteToken();
    return token ? `${window.location.origin}/join/${token}` : null;
  });
  readonly invitePlaceholder = computed(() => {
    if (this.inviteFailed()) {
      return 'Link is unavailable';
    }

    return this.inviteLoading() ? 'Loading link...' : 'Link will be available soon';
  });

  protected readonly ReservationStatus = ReservationStatus;

  ngOnInit(): void {
    if (!this.showInviteField()) {
      return;
    }

    this.inviteLoading.set(true);
    this.guestInviteService
      .getInviteToken$(this.reservation().id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ token }) => {
          this.inviteToken.set(token);
          this.inviteLoading.set(false);
        },
        error: () => {
          this.inviteLoading.set(false);
          this.inviteFailed.set(true);
          this.toastService.error('Could not load the invite link. Please try again later.');
        },
      });
  }

  async onCopyInviteLink(): Promise<void> {
    const link = this.inviteLink();
    if (!link) {
      return;
    }

    try {
      await navigator.clipboard.writeText(link);
      this.toastService.success('Share it with your friends.', 'Link copied!');
    } catch {
      this.toastService.error('Could not copy the link. Please copy it manually.');
    }
  }

  onClose(): void {
    if (this.isFading()) {
      return;
    }

    this.isFading.set(true);
    this.closed.emit();
  }

  onEdit(): void {
    this.editReservation.emit();
  }

  onCancel(): void {
    this.cancelReservation.emit();
  }

  onBackdropClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      this.onClose();
    }
  }
}
