// A text kept on its line: too long, its font is reduced to fit, never cut and never wrapped (tested for the scale by
// test/text-fit.test.ts). The engine shows no ellipsis.

import { setStyle } from './dom.ts';

/** The scale of a text `text` pixels wide at its size on a line `line` pixels wide, in hundredths, rounded down; 1 when it fits or there is nothing to measure. */
export function fitScale(text: number, line: number): number {
  if (!(text > 0) || !(line > 0) || text <= line) return 1;
  return Math.floor((line / text) * 100) / 100;
}

/**
 * The next font size to try, in pixels, for a text drawn at `current` (0: its own size, not changed yet) that the scale
 * would bring to `scaled`. The engine draws whole pixel sizes (measured on 1.9.21: 15.5, 15.62 and 16 pixels draw the
 * same 543 pixels, 15 pixels 507): a size that rounds to the one drawn already would change nothing, so one pixel less.
 */
export function nextFontSize(current: number, scaled: number): number {
  return current > 0 && Math.round(scaled) === Math.round(current) ? Math.round(current) - 1 : scaled;
}

/** The width of a text on one line, in pixels, whatever its element's box: a range over the element's content. */
function textWidth(element: Element): number {
  const range = document.createRange();
  range.selectNodeContents(element);
  return range.getBoundingClientRect().width;
}

/** How many times a reduced text is measured again: a font's widths do not scale evenly (409 pixels for the 405 asked, a scale of 0.91 at 26 pixels, measured on 1.9.21). */
const FIT_ROUNDS = 4;
/** Texts kept per fitter, the oldest dropped first: a few lines per aircraft, for every aircraft and a change of size or two. */
const FIT_CACHE = 600;

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
    // A line without width yet (laid out at the next pass): nothing measured, nothing kept.
    if (!(width > 0)) return;
    const text = measured.textContent || '';
    const key = `${size}|${width}|${weight}|${text}`;
    let fontSize = this.fitted.get(key);
    if (fontSize === undefined) {
      setStyle(line.style, 'fontSize', original);
      const natural = text ? textWidth(measured) : 0;
      // Hidden, it measures nothing: asked again at the next pass.
      if (!(natural > 0)) return;
      const reduced = this.reduced(line, measured, natural, width, size);
      // A measure without width (the font not ready, the line hidden meanwhile): the line at its own size, asked again next time.
      if (reduced === null) {
        setStyle(line.style, 'fontSize', original);
        return;
      }
      fontSize = reduced;
      this.fitted.set(key, fontSize);
      if (this.fitted.size > FIT_CACHE) this.fitted.delete(this.fitted.keys().next().value as string);
    }
    setStyle(line.style, 'fontSize', fontSize > 0 ? `${fontSize.toFixed(2)}px` : original);
  }

  /** The line at its own font size again. */
  reset(line: HTMLElement): void {
    const original = this.originals.get(line);
    if (original !== undefined) setStyle(line.style, 'fontSize', original);
  }

  /** The font size that brings a text `natural` pixels wide at `size` onto its line; 0 when it fits at its own; null when a measure has no width. */
  private reduced(line: HTMLElement, measured: Element, natural: number, width: number, size: number): number | null {
    let fontSize = 0;
    let textAt = natural;
    for (let round = 0; round < FIT_ROUNDS && textAt > width; round++) {
      fontSize = nextFontSize(fontSize, (fontSize || size) * fitScale(textAt, width));
      setStyle(line.style, 'fontSize', `${fontSize.toFixed(2)}px`);
      textAt = textWidth(measured);
      if (!(textAt > 0)) return null;
    }
    return fontSize;
  }
}
