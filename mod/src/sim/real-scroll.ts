// The sim's scrolling list (`<real-scroll direction="y">`, as in its own cards): it scrolls on the wheel and draws its
// scroll bar; children appended to it go into its content (mod/README.md). Verified on sim 1.9.18.

export interface RealScroll extends HTMLElement {
  readonly currentScroll: number;
  readonly maxScroll: number;
  scrollToPosition(position: number): void;
  updateSizes?(): void;
}

/**
 * Width of the list's scroll bar, beside its content: 0 while the content fits, its own width (10 pixels at 1440
 * lines) once the list scrolls, from the next frame.
 */
export function scrollBarWidth(list: HTMLElement): number {
  const bar = list.querySelector('.scroll__bar-container');
  return bar ? bar.getBoundingClientRect().width : 0;
}
