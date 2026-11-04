import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { AuthenticationService } from '@app/auth/services/authentication.service';
import { SKIP_ERROR_TOAST } from '@app/auth/skip-error-toast.context';
import { API_BASE_URL } from '@app/shared/config/api-base-url.token';
import { GuestSessionsService } from './guest-sessions.service';

describe('GuestSessionsService owner operations', () => {
  let service: GuestSessionsService;
  let httpMock: HttpTestingController;
  let authenticationService: jasmine.SpyObj<AuthenticationService>;

  beforeEach(() => {
    authenticationService = jasmine.createSpyObj<AuthenticationService>(
      'AuthenticationService',
      ['getTokens']
    );
    authenticationService.getTokens.and.returnValue({
      idToken: 'owner-id-token',
      accessToken: 'owner-access-token',
    });

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: API_BASE_URL, useValue: 'https://test.api' },
        { provide: AuthenticationService, useValue: authenticationService },
      ],
    });

    service = TestBed.inject(GuestSessionsService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('loads the owner group id and explicitly attaches the ID token', () => {
    let receivedGroupId: string | undefined;
    service.getOwnerGuestSessionInfo('reservation-1').subscribe((response) => {
      receivedGroupId = response.groupReservationId;
    });

    const request = httpMock.expectOne(
      'https://test.api/reservations/reservation-1/guest-session-id'
    );
    expect(request.request.headers.get('Authorization')).toBe('Bearer owner-id-token');
    expect(request.request.context.get(SKIP_ERROR_TOAST)).toBeTrue();
    request.flush({ guestSessionId: 'owner-session', groupReservationId: 'group-1' });

    expect(receivedGroupId).toBe('group-1');
  });

  it('uses the owner token for the group snapshot and deletion APIs', () => {
    service.getGroupSessions('group-1').subscribe();
    const snapshotRequest = httpMock.expectOne(
      'https://test.api/guest/groups/group-1/sessions'
    );
    expect(snapshotRequest.request.headers.get('Authorization')).toBe(
      'Bearer owner-id-token'
    );
    snapshotRequest.flush({ participants: [], total: 0 });

    service.deleteGuestSession('group-1', 'guest-1').subscribe();
    const deleteRequest = httpMock.expectOne(
      'https://test.api/guest/groups/group-1/sessions/guest-1'
    );
    expect(deleteRequest.request.method).toBe('DELETE');
    expect(deleteRequest.request.headers.get('Authorization')).toBe(
      'Bearer owner-id-token'
    );
    deleteRequest.flush({ participants: [], total: 0 });
  });

  it('does not make owner requests without an active ID token', () => {
    authenticationService.getTokens.and.returnValue(null);
    let receivedError: Error | undefined;
    service.getGroupSessions('group-1').subscribe({
      error: (error: Error) => (receivedError = error),
    });

    expect(httpMock.match(() => true).length).toBe(0);
    expect(receivedError?.message).toContain('Owner sign-in is required');
  });
});
