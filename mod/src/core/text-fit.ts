// A text kept on its line: too long, its font is reduced to fit, never cut and never wrapped (tested for the scale by
// test/text-fit.test.ts). The engine shows no ellipsis.

import { setStyle } from './dom.ts';

/** The scale of a text `text` pixels wide at its size on a line `line` pixels wide, in hundredths, rounded down; 1 when it fits or there is nothing to measure. */
export function fitScale(text: number, line: number): number {
  if (!(text > 0) || !(line > 0) || text <= line) return 1;
  return Math.floor((line / text) * 100) / 100;
}

/** The width of a text on one line, in pixels, whatever its element's box: a range over the element's content. */
function textWidth(element: Element): number {
  const range = document.createRange();
  range.selectNodeContents(element);
  return range.getBoundingClientRect().width;
}

/** How many times a reduced text is measured again: a font's widths do not scale evenly (409 pixels for the 405 asked, a scale of 0.91 at 26 pixels, measured on 1.9.21). */
const FIT_ROUNDS = 4;

/**
 * Fits texts to their lines. A text is measured once for its font and its line, so that a layout pass only writes:
 * measuring lays the page out.
 */
export class TextFitter {
  /** The font size each text takes on its line, in pixels; 0: its line's own. */
  private readonly fitted = new Map<string, number>();
  /** Each line's own font size: the sim's lines have theirs in their style. */
  private readonly originals = new WeakMap<HTMLElement, string>();

  /**
   * `line`, whose own font size is `size` pixels, on one line `width` pixels wide; `measured`: the element holding the
   * text, when it is not `line` itself (the sim's text-marquee has no `textContent` of its own: its `.marquee__content`).
   * `weight`: lines of the same text in other weights are measured apart.
   */
  fit(line: HTMLElement, width: number, size: number, weight: string, measured: Element = line): void {
    let original = this.originals.get(line);
    if (original === undefined) {
      original = line.style.fontSize;
      this.originals.set(line, original);
    }
    const text = measured.textContent || '';
    const key = `${size}|${width}|${weight}|${text}`;
    let fontSize = this.fitted.get(key);
    if (fontSize === undefined) {
      setStyle(line.style, 'fontSize', original);
      const natural = text ? textWidth(measured) : 0;
      // Hidden, it measures nothing: asked again at the next pass.
      if (!(natural > 0)) return;
      fontSize = this.reduced(line, measured, natural, width, size);
      this.fitted.set(key, fontSize);
    }
    setStyle(line.style, 'fontSize', fontSize > 0 ? `${fontSize.toFixed(2)}px` : original);
  }

  /** The line at its own font size again. */
  reset(line: HTMLElement): void {
    const original = this.originals.get(line);
    if (original !== undefined) setStyle(line.style, 'fontSize', original);
  }

  /** The font size that brings a text `natural` pixels wide at `size` onto its line; 0 when it fits at its own. */
  private reduced(line: HTMLElement, measured: Element, natural: number, width: number, size: number): number {
    let fontSize = 0;
    let textAt = natural;
    for (let round = 0; round < FIT_ROUNDS && textAt > width; round++) {
      fontSize = (fontSize || size) * fitScale(textAt, width);
      setStyle(line.style, 'fontSize', `${fontSize.toFixed(2)}px`);
      textAt = textWidth(measured);
    }
    return fontSize;
  }
}
