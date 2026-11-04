import { ComponentFixture, TestBed } from '@angular/core/testing';
import { WaiterMakeReservationComponent } from './waiter-make-reservation.component';
import { API_BASE_URL } from '@app/shared/config/api-base-url.token';
import { LocationsService } from '@app/services/locations/locations.service';
import { AuthenticationService } from '@app/auth/services/authentication.service';
import { of } from 'rxjs';

describe('WaiterMakeReservationComponent', () => {
  let component: WaiterMakeReservationComponent;
  let fixture: ComponentFixture<WaiterMakeReservationComponent>;

  beforeEach(async () => {
    const locationsService = jasmine.createSpyObj<LocationsService>(
      'LocationsService',
      ['getLocations']
    );
    locationsService.getLocations.and.returnValue(of([]));

    await TestBed.configureTestingModule({
      providers: [
        { provide: API_BASE_URL, useValue: 'https://test.api' },
        { provide: LocationsService, useValue: locationsService },
        { provide: AuthenticationService, useValue: { getUser: () => null } },
      ],
      imports: [WaiterMakeReservationComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(WaiterMakeReservationComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
