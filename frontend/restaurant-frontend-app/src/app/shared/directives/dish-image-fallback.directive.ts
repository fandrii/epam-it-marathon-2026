import { Directive, ElementRef, HostListener, inject } from '@angular/core';

@Directive({
  selector: 'img[appDishImageFallback]',
  standalone: true,
})
export class DishImageFallbackDirective {
  private readonly image = inject(ElementRef<HTMLImageElement>);

  @HostListener('error')
  onImageError(): void {
    const image = this.image.nativeElement;
    if (image.dataset['fallbackApplied'] === 'true') {
      return;
    }

    image.dataset['fallbackApplied'] = 'true';
    image.src = 'assets/img/dish.png';
  }
}
