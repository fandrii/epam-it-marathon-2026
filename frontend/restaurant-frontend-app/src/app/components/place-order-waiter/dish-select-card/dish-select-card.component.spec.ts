import { ComponentFixture, TestBed } from '@angular/core/testing';

import { DishSelectCardComponent } from './dish-select-card.component';

describe('DishSelectCardComponent', () => {
  let component: DishSelectCardComponent;
  let fixture: ComponentFixture<DishSelectCardComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DishSelectCardComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(DishSelectCardComponent);
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
