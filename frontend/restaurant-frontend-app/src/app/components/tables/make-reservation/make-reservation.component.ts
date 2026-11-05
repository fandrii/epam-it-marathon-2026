import {
  Component,
  EventEmitter,
  Input,
  Output,
  ChangeDetectionStrategy,
  inject,
  signal,
  OnInit,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { CustomButtonComponent } from '@app/shared/custom-components/custom-button/custom-button.component';
import { CustomNumberComponent } from '@app/shared/custom-components/custom-number/custom-number.component';
import { CustomSelectComponent } from '@app/shared/custom-components/custom-select/custom-select.component';
import { Table } from '@app/models/tables/table.model';
import { TimeRange } from '@app/models/tables/time-range.model';
import { formatTime } from '@app/shared/helpers/date-helpers';
import { ToastService } from '@app/services/toast/toast.service';
import { GuestInviteService } from '@app/services/reservation/guest-invite.service';
@Component({
  selector: 'app-make-reservation',
  imports: [
    DatePipe,
    CustomButtonComponent,
    CustomNumberComponent,
    CustomSelectComponent,
  ],
  templateUrl: './make-reservation.component.html',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './make-reservation.component.scss',
})
export class MakeReservationComponent implements OnInit {
  @Input() title = 'Make a Reservation';
  @Input() locationName!: string;
  @Input() table!: Table;
  @Input() selectedTimeRange!: TimeRange;
  @Input() guests = 1;
  @Input() reservationId?: string | null;
  @Input() guestInviteLinkAvailable = false;

  private readonly toast = inject(ToastService);
  private readonly guestInviteService = inject(GuestInviteService);
  readonly inviteLink = signal<string | null>(null);
  readonly inviteLoading = signal(false);
  readonly inviteError = signal(false);

  @Output() closeModal = new EventEmitter<void>();
  @Output() makeReservation = new EventEmitter<{
    tableId: string;
    timeRange: TimeRange;
    guests: number;
  }>();

  ngOnInit(): void {
    if (this.selectedTimeRange) {
      this.onStartTimeChange(formatTime(this.selectedTimeRange.start));
    }

    if (this.title === 'Edit Reservation' && this.reservationId && this.guestInviteLinkAvailable && this.guests >= 2) {
      this.loadInviteLink();
    }
  }

  onMakeReservation() {
    this.makeReservation.emit({
      tableId: this.table.id,
      timeRange: this.selectedTimeRange,
      guests: this.guests,
    });
   this.toast.success('Reservation created successfully.', 'Success');
  }

  onClose() {
    this.closeModal.emit();
  }

  onGuestsChange(guests: number | undefined): void {
    if (guests === undefined) {
      return;
    }
    this.guests = guests;
  }
  startTimeOptions() {
    return this.table.timeRanges.map((range) => formatTime(range.start));
  }

  selectStartTime() {
    if (this.selectedTimeRange) {
      return formatTime(this.selectedTimeRange.start);
    }
    return '';
  }

  selectEndTime() {
    if (this.selectedTimeRange) {
      return formatTime(this.selectedTimeRange.end);
    }
    return '';
  }

  endTimeOptions() {
    return this.table.timeRanges.map((range) => formatTime(range.end));
  }

  onStartTimeChange(startTime: string) {
    this.selectedTimeRange =
      this.table.timeRanges.find((range) => formatTime(range.start) === startTime) ||
      this.selectedTimeRange;
  }

  onEndTimeChange(endTime: string) {
    this.selectedTimeRange =
      this.table.timeRanges.find((range) => formatTime(range.end) === endTime) ||
      this.selectedTimeRange;
  }

  loadInviteLink(): void {
    if (!this.reservationId || !this.guestInviteLinkAvailable) {
      return;
    }

    this.inviteLoading.set(true);
    this.inviteError.set(false);
    this.guestInviteService.getInviteToken$(this.reservationId).subscribe({
      next: ({ token }) => {
        this.inviteLink.set(token ? `${window.location.origin}/join/${token}` : null);
        this.inviteLoading.set(false);
      },
      error: () => {
        this.inviteError.set(true);
        this.inviteLink.set(null);
        this.inviteLoading.set(false);
      },
    });
  }

  async copyInviteLink(): Promise<void> {
    const link = this.inviteLink();
    if (!link) {
      return;
    }

    try {
      await navigator.clipboard.writeText(link);
      this.toast.success('Share it with your friends.', 'Link copied!');
    } catch {
      this.toast.error('Could not copy the link. Please copy it manually.');
    }
  }
}
