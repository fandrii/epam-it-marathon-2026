import { TestBed } from '@angular/core/testing';
import { of, Subject } from 'rxjs';
import { GuestInvite } from '@app/models/reservations/guest-invite.model';
import { GuestInviteService } from '@app/services/reservation/guest-invite.service';
import { GuestSessionsService } from '@app/services/guest-sessions/guest-sessions.service';
import { GuestPreorderStore } from './guest-preorder.store';

describe('GuestPreorderStore', () => {
    it('does not create another session while joining or after restoring an existing session', async () => {
        const sessionResponse = new Subject<{ SessionId: string; SessionToken: string }>();
        const inviteService = jasmine.createSpyObj<GuestInviteService>('GuestInviteService', ['getInvite$']);
        const sessionsService = jasmine.createSpyObj<GuestSessionsService>(
            'GuestSessionsService',
            ['createSession', 'getMenu'],
        );
        sessionsService.createSession.and.returnValue(sessionResponse.asObservable());
        sessionsService.getMenu.and.returnValue(of({ dishes: {} }));

        TestBed.configureTestingModule({
            providers: [
                GuestPreorderStore,
                { provide: GuestInviteService, useValue: inviteService },
                { provide: GuestSessionsService, useValue: sessionsService },
            ],
        });

        const store = TestBed.inject(GuestPreorderStore);
        const invite: GuestInvite = {
            GroupReservationId: 'group-1',
            LocationId: 'location-1',
            RestaurantName: 'Restaurant',
            LocationAddress: 'Address',
            StartTime: '',
            EndTime: '',
            MaxGuestCount: 3,
            TableNumber: 1,
            InviterName: 'Owner',
        };
        store.invite.set(invite);

        const firstJoin = store.join('Guest');
        await store.join('Guest');
        expect(sessionsService.createSession).toHaveBeenCalledTimes(1);

        sessionResponse.next({ SessionId: 'session-1', SessionToken: 'token-1' });
        sessionResponse.complete();
        await firstJoin;

        await store.join('Guest');
        expect(sessionsService.createSession).toHaveBeenCalledTimes(1);
    });
});
