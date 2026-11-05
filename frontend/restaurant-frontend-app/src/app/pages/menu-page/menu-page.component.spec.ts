import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MenuPageComponent } from './menu-page.component';
import { API_BASE_URL } from '@app/shared/config/api-base-url.token';
import { ActivatedRoute } from '@angular/router';
import { provideRouter } from '@angular/router';
import { DishesService } from '@app/services/dishes/dishes.service';
import { PreOrdersService } from '@app/services/pre-orders/pre-orders.service';
import { ToastService } from '@app/services/toast/toast.service';
import { DishListResponse } from '@app/models/dishes/dish-list-response.model';
import { Order } from '@app/models/orders/order.model';
import { BehaviorSubject, of, Subject } from 'rxjs';

describe('MenuPageComponent', () => {
  let component: MenuPageComponent;
  let fixture: ComponentFixture<MenuPageComponent>;
  let preOrdersService: jasmine.SpyObj<PreOrdersService>;
  let dishesService: jasmine.SpyObj<DishesService>;
  let routeQueryParams: BehaviorSubject<Record<string, string>>;

  beforeEach(async () => {
    routeQueryParams = new BehaviorSubject<Record<string, string>>({});
    dishesService = jasmine.createSpyObj<DishesService>('DishesService', ['getDishes']);
    dishesService.getDishes.and.returnValue(of([]));
    preOrdersService = jasmine.createSpyObj<PreOrdersService>(
      'PreOrdersService',
      ['addDishToPreOrderByReservationId'],
    );
    const toastService = jasmine.createSpyObj<ToastService>(
      'ToastService',
      ['error', 'success', 'info'],
    );

    await TestBed.configureTestingModule({
      providers: [
        { provide: API_BASE_URL, useValue: 'https://test.api' },
        { provide: PreOrdersService, useValue: preOrdersService },
        { provide: ToastService, useValue: toastService },
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: { queryParams: routeQueryParams.asObservable() },
        },
      ],
      imports: [MenuPageComponent],
    })
      .overrideComponent(MenuPageComponent, {
        set: { providers: [{ provide: DishesService, useValue: dishesService }] },
      })
      .compileComponents();

    fixture = TestBed.createComponent(MenuPageComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should prevent overlapping add-dish requests', () => {
    const request = new Subject<object>();
    preOrdersService.addDishToPreOrderByReservationId.and.returnValue(request);
    component.isPreOrderEnabled = true;
    component.preOrderReservationId = 'reservation-1';
    const dish = {
      id: 'dish-1',
      name: 'Test dish',
      price: 10,
    } as DishListResponse;

    component.addDishToCart(dish);
    component.addDishToCart(dish);

    expect(
      preOrdersService.addDishToPreOrderByReservationId,
    ).toHaveBeenCalledTimes(1);
    expect(component.isAddingDish()).toBeTrue();

    request.next({});
    request.complete();

    expect(component.isAddingDish()).toBeFalse();
  });

  it('shows a select-dishes action and adds a dish to a single-person reservation order', () => {
    const dish: DishListResponse = {
      id: 'dish-1',
      name: 'Test dish',
      imageUrl: 'https://images.example.test/dish-1.jpg',
      price: 10,
      state: 'Available',
      weight: '250g',
      dishType: 'MainCourse',
      description: '',
      calories: '0',
      proteins: '0',
      carbohydrates: '0',
      fats: '0',
      vitamins: '',
    };
    dishesService.getDishes.and.returnValue(of([dish]));
    preOrdersService.addDishToPreOrderByReservationId.and.returnValue(of({} as Order));

    routeQueryParams.next({
      preOrder: 'true',
      reservationId: 'single-person-reservation',
    });
    fixture.detectChanges();

    const selectDishesLink = fixture.nativeElement.querySelector(
      'a[href="#pre-order-dishes"]'
    ) as HTMLAnchorElement | null;
    const addDishButton = Array.from(
      fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>
    ).find((button) =>
      button.textContent?.includes('Add to Pre-Order')
    ) as HTMLButtonElement | undefined;

    expect(component.isPreOrderEnabled).toBeTrue();
    expect(component.preOrderReservationId).toBe('single-person-reservation');
    expect(selectDishesLink?.textContent).toContain('Select Dishes');
    expect(addDishButton).toBeDefined();

    addDishButton?.click();

    expect(preOrdersService.addDishToPreOrderByReservationId).toHaveBeenCalledWith(
      'single-person-reservation',
      jasmine.objectContaining({
        id: dish.id,
        imageUrl: dish.imageUrl,
      }),
      1
    );
  });

  it('does not treat a false pre-order query parameter as enabled', () => {
    routeQueryParams.next({
      preOrder: 'false',
      reservationId: 'reservation-1',
    });
    fixture.detectChanges();

    expect(component.isPreOrderEnabled).toBeFalse();
    expect(fixture.nativeElement.querySelector('.pre-order-notice')).toBeNull();
  });
});
