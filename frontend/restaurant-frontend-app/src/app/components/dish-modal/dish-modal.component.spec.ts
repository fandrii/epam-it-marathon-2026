import { ComponentFixture, TestBed } from '@angular/core/testing';

import { DishModalComponent } from './dish-modal.component';

describe('DishModalComponent', () => {
  let component: DishModalComponent;
  let fixture: ComponentFixture<DishModalComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DishModalComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(DishModalComponent);
    component = fixture.componentInstance;
    component.dish = {
      id: 'dish-1',
      name: 'Test dish',
      imageUrl: 'dish.png',
      price: 10,
      state: 'Available',
      weight: '250g',
      dishType: 'Main',
      description: 'Test description',
      calories: '200',
      proteins: '10',
      carbohydrates: '20',
      fats: '5',
      vitamins: 'A',
    };
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
