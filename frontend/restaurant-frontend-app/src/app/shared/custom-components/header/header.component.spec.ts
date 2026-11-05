import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { provideRouter } from '@angular/router';

import { HeaderComponent } from './header.component';
import { API_BASE_URL } from '@app/shared/config/api-base-url.token';
import { AuthenticationService } from '@app/auth/services/authentication.service';
import { NotificationsService } from '@app/services/notifications/notifications.service';
import { PreOrdersService } from '@app/services/pre-orders/pre-orders.service';
import { ToastService } from '@app/services/toast/toast.service';
import { Roles } from '@app/shared/constants/roles';

describe('HeaderComponent', () => {
  let component: HeaderComponent;
  let fixture: ComponentFixture<HeaderComponent>;

  let authMock: jasmine.SpyObj<AuthenticationService>;
  let notificationsMock: jasmine.SpyObj<NotificationsService>;
  let preOrdersMock: jasmine.SpyObj<PreOrdersService>;

  beforeEach(async () => {
    authMock = jasmine.createSpyObj<AuthenticationService>(
      'AuthenticationService',
      ['signOut'],
    {
      user$: of(null),
      isAuthorised$: of(false),
    },
  );
  
  notificationsMock = jasmine.createSpyObj<NotificationsService>(
    'NotificationsService',
    ['loadNotifications', 'markAsRead'],
  );

  notificationsMock.loadNotifications.and.returnValue(of([]));
  notificationsMock.markAsRead.and.returnValue(of(void 0));
  preOrdersMock = jasmine.createSpyObj<PreOrdersService>(
    'PreOrdersService',
    [
      'getPreOrders',
      'cancelPreOrderByReservationId',
      'unsubmitPreOrderByReservationId',
      'submitPreOrderByReservationId',
      'editPreOrderByReservationId',
    ],
  );
  preOrdersMock.getPreOrders.and.returnValue(of([]));
  const toastMock = jasmine.createSpyObj<ToastService>(
    'ToastService',
    ['error', 'success', 'info'],
  );

  await TestBed.configureTestingModule({
    providers: [
      { provide: API_BASE_URL, useValue: 'https://test.api' },
      { provide: AuthenticationService, useValue: authMock },
      { provide: NotificationsService, useValue: notificationsMock },
      { provide: PreOrdersService, useValue: preOrdersMock },
      { provide: ToastService, useValue: toastMock },
      provideRouter([]),
    ],
    imports: [HeaderComponent],
  }).compileComponents();

  fixture = TestBed.createComponent(HeaderComponent);
  component = fixture.componentInstance;
  fixture.detectChanges();
});

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should render only one cart when the cart is open', () => {
    component.user.set({
      id: 'customer-1',
      firstName: 'Test',
      lastName: 'Customer',
      email: 'test@example.com',
      role: Roles.CUSTOMER,
    });
    component.showCart.set(true);
    fixture.detectChanges();

    expect(
      fixture.nativeElement.querySelectorAll('app-cart').length,
    ).toBe(1);
    expect(preOrdersMock.getPreOrders).toHaveBeenCalledTimes(1);
  });
});
