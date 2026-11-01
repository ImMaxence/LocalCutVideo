import { DestroyRef, Directive, ElementRef, afterNextRender, inject, input } from '@angular/core';

/**
 * Fades an element in the first time it scrolls into view. `appReveal` takes an optional
 * stagger index so items of a grid appear one after the other.
 */
@Directive({
  selector: '[appReveal]',
  host: { class: 'reveal', '[style.--reveal-delay]': 'appReveal() || 0' },
})
export class Reveal {
  readonly appReveal = input<number | ''>('');

  constructor() {
    const el = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    let observer: IntersectionObserver | undefined;
    afterNextRender(() => {
      observer = new IntersectionObserver(
        (entries) => {
          if (entries.some((e) => e.isIntersecting)) {
            el.classList.add('revealed');
            observer?.disconnect();
          }
        },
        { threshold: 0.12, rootMargin: '0px 0px -40px 0px' },
      );
      observer.observe(el);
    });
    inject(DestroyRef).onDestroy(() => observer?.disconnect());
  }
}
