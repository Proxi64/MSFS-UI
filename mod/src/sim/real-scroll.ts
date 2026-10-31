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

/** A new scrolling list scrolling along `direction`; children appended to it go into its content. */
export function createRealScroll(direction: 'x' | 'y', className: string): RealScroll {
  const list = document.createElement('real-scroll') as RealScroll;
  list.setAttribute('direction', direction);
  list.className = className;
  return list;
}

/** Takes children out of a scrolling list one by one: the list keeps its own structure (never `innerHTML`). */
export function removeFromList(hosts: readonly HTMLElement[]): void {
  for (const host of hosts) {
    if (host.parentNode) host.parentNode.removeChild(host);
  }
}
