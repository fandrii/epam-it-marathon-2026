import { ComponentFixture, TestBed } from '@angular/core/testing';
import { PlaceOrderWaiterComponent } from './place-order-waiter.component';
import { API_BASE_URL } from '@app/shared/config/api-base-url.token';
import { AuthenticationService } from '@app/auth/services/authentication.service';
import { of } from 'rxjs';

describe('PlaceOrderWaiterComponent', () => {
  let component: PlaceOrderWaiterComponent;
  let fixture: ComponentFixture<PlaceOrderWaiterComponent>;

  beforeEach(async () => {
    const authenticationService = jasmine.createSpyObj<AuthenticationService>(
      'AuthenticationService',
      ['getUser', 'getUserNameById$']
    );
    authenticationService.getUser.and.returnValue({
      id: 'waiter-1',
      firstName: 'Test',
      lastName: 'Waiter',
      email: 'waiter@example.test',
      role: 'Waiter',
    });
    authenticationService.getUserNameById$.and.returnValue(of('Test Customer'));

    await TestBed.configureTestingModule({
      providers: [
        { provide: API_BASE_URL, useValue: 'https://test.api' },
        { provide: AuthenticationService, useValue: authenticationService },
      ],
      imports: [PlaceOrderWaiterComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(PlaceOrderWaiterComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
