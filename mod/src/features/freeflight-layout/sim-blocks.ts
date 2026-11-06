// The sim's blocks of Free Flight, moved by rewriting their inline styles. The sim places each one from the screen's
// centre: `left: calc(var(--h-anchor) + calc(var(--unscaledScreenHeight) * Npx / 1080))` with `--h-anchor: 50%`, and
// N = ±940 for the edges of its frame, 1880 units wide (measured 2026-11-06 on 1.9.21; compat.json, "Free Flight
// frame"). Every property written is put back as it was when the scope is disposed.

import type { Scope } from '../../core/scope.ts';

/** The offset of a block's `left` from the screen's centre, in layout units, as the sim writes it. */
const OFFSET = /^calc\(var\(--h-anchor\) \+ calc\(var\(--unscaledScreenHeight\) \* (-?[\d.]+)px \/ 1080\)\)$/;
/** The half width of the sim's frame, in layout units. */
const FRAME_HALF = 940;

/** −1 for a `left` on the frame's left edge, 1 on its right edge, 0 otherwise. */
export function frameEdge(left: string): -1 | 0 | 1 {
  const match = OFFSET.exec(left.trim());
  if (!match) return 0;
  const units = parseFloat(match[1]!);
  return units === -FRAME_HALF ? -1 : units === FRAME_HALF ? 1 : 0;
}

/** One block of the sim whose inline style the mod rewrites. */
export class SimBlock {
  readonly element: HTMLElement;
  /** Each property's value before the first write ('' when it had none). */
  private readonly originals = new Map<string, string>();

  constructor(element: HTMLElement, scope: Scope) {
    this.element = element;
    scope.add(() => this.restore());
  }

  /** Sets a property (or a custom property such as `--h-anchor`) only when its value changes. */
  set(property: string, value: string): void {
    const style = this.element.style;
    const current = style.getPropertyValue(property);
    if (!this.originals.has(property)) this.originals.set(property, current);
    if (current !== value) style.setProperty(property, value);
  }

  private restore(): void {
    const style = this.element.style;
    this.originals.forEach((value, property) => {
      if (value) style.setProperty(property, value);
      else style.removeProperty(property);
    });
    this.originals.clear();
  }
}
