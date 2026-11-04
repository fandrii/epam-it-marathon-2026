import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpContext, HttpHeaders } from '@angular/common/http';
import { defer, Observable, throwError } from 'rxjs';
import { AuthenticationService } from '@app/auth/services/authentication.service';
import { SKIP_ERROR_TOAST } from '@app/auth/skip-error-toast.context';
import { API_BASE_URL } from '@app/shared/config/api-base-url.token';

export interface CreateGuestSessionRequest {
    groupReservationId: string;
    guestName: string;
}

export interface CreateGuestSessionResponse {
    SessionId: string;
    SessionToken: string;
}

export interface GuestMenuDish {
    id: string;
    name: string;
    description: string;
    price: number;
    weight?: string;
    calories?: string;
    proteins?: string;
    fats?: string;
    carbohydrates?: string;
    vitamins?: string;
    imageUrl?: string | null;
    state: string;        // "Available" | "On Stop"
    selectable: boolean;  // true/false
}

export type GuestMenuCategoryKey = string;

export interface GuestMenuResponse {
    dishes: Record<GuestMenuCategoryKey, GuestMenuDish[]>;
}

export interface OwnerGuestSessionInfo {
    guestSessionId: string;
    groupReservationId: string;
}

export interface GroupSessionDish {
    id: string;
    name: string;
    price: number;
}

export interface GroupSessionItem {
    dish: GroupSessionDish;
    quantity: number;
}

export interface GroupSessionParticipant {
    id: string | null;
    type: 'Owner' | 'Guest';
    name: string;
    items: GroupSessionItem[];
    total: number;
    isSubmitted: boolean;
}

export interface GroupSessionsSnapshot {
    participants: GroupSessionParticipant[];
    total: number;
}

@Injectable({ providedIn: 'root' })
export class GuestSessionsService {
    private readonly baseUrl = inject(API_BASE_URL);
    private readonly http = inject(HttpClient);
    private readonly authenticationService = inject(AuthenticationService);

    getOwnerGuestSessionInfo(reservationId: string): Observable<OwnerGuestSessionInfo> {
        return this.ownerRequest((headers, context) =>
            this.http.get<OwnerGuestSessionInfo>(
                `${this.baseUrl}/reservations/${encodeURIComponent(reservationId)}/guest-session-id`,
                { headers, context }
            )
        );
    }

    getGroupSessions(groupReservationId: string): Observable<GroupSessionsSnapshot> {
        return this.ownerRequest((headers, context) =>
            this.http.get<GroupSessionsSnapshot>(
                `${this.baseUrl}/guest/groups/${encodeURIComponent(groupReservationId)}/sessions`,
                { headers, context }
            )
        );
    }

    deleteGuestSession(
        groupReservationId: string,
        guestSessionId: string
    ): Observable<GroupSessionsSnapshot> {
        return this.ownerRequest((headers, context) =>
            this.http.delete<GroupSessionsSnapshot>(
                `${this.baseUrl}/guest/groups/${encodeURIComponent(groupReservationId)}/sessions/${encodeURIComponent(guestSessionId)}`,
                { headers, context }
            )
        );
    }

    createSession(body: CreateGuestSessionRequest) {
        return this.http.post<CreateGuestSessionResponse>(`${this.baseUrl}/guest/sessions`, body);
    }

    getMenu(guestSessionId: string, sessionToken: string) {
        return this.http.get<GuestMenuResponse>(
            `${this.baseUrl}/guest/sessions/${guestSessionId}/menu`,
            { headers: this.authHeaders(sessionToken) }
        );
    }

    addDish(guestSessionId: string, sessionToken: string, dishId: string, quantity: number) {
        return this.http.post(
            `${this.baseUrl}/guest/sessions/${guestSessionId}/dishes`,
            { dishId, quantity },
            { headers: this.authHeaders(sessionToken) }
        );
    }

    removeDish(guestSessionId: string, sessionToken: string, dishId: string, quantity: number) {
        return this.http.request(
            'delete',
            `${this.baseUrl}/guest/sessions/${guestSessionId}/dishes`,
            { body: { dishId, quantity }, headers: this.authHeaders(sessionToken) }
        );
    }

    submit(guestSessionId: string, sessionToken: string) {
        return this.http.post(
            `${this.baseUrl}/guest/sessions/${guestSessionId}/submit`,
            {},
            { headers: this.authHeaders(sessionToken) }
        );
    }

    private ownerRequest<T>(
        request: (headers: HttpHeaders, context: HttpContext) => Observable<T>
    ): Observable<T> {
        return defer(() => {
            const idToken = this.authenticationService.getTokens()?.idToken;
            if (!idToken) {
                return throwError(() => new Error('An active Owner sign-in is required.'));
            }

            const headers = new HttpHeaders({ Authorization: `Bearer ${idToken}` });
            const context = new HttpContext().set(SKIP_ERROR_TOAST, true);
            return request(headers, context);
        });
    }

    private authHeaders(token: string) {
        return new HttpHeaders({ Authorization: `Bearer ${token}` });
    }
}