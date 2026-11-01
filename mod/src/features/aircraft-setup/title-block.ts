// The sim's title block over the setup panel, on three lines at a fixed height in every view (the owner, 2026-11-01): the
// model large, the brand, the studio (sim/aircraft-names.ts). The sim wraps a long name on two lines, which moved all that
// is under it (38 pixels on the DHC-2 at 1440 lines), and it writes its own texts again at each change of aircraft: they
// are hidden, and the mod's lines stand in their place in the sim's font sizes (aircraft-setup.css). A line too long has
// its text reduced to fit. Everything comes back when the panel goes (`leave`, the scope).

import { el, setStyle } from '../../core/dom.ts';
import type { Scope } from '../../core/scope.ts';
import { TextFitter } from '../../core/text-fit.ts';
import { titleLines, type AircraftNameFields } from '../../sim/aircraft-names.ts';

/** The block's height, in layout units: the sim's paddings (24 and 12) and the three lines (32 and two of 24: aircraft-setup.css). */
const TITLE_UNITS = 116;
/** The sizes of the sim's lines, in layout units: its `--fontSizeS` and `--fontSizeXS` (cookedcomps, 1.9.21). */
const MODEL_FONT_UNITS = 24;
const LINE_FONT_UNITS = 18;
/** The class that hides the sim's lines. */
const HOLDING = 'msfs-ui-setup-title-host';

export class TitleBlock {
  private readonly box = el('div', 'msfs-ui-setup-title');
  private readonly model = el('div', 'msfs-ui-setup-title__model', this.box);
  private readonly brand = el('div', 'msfs-ui-setup-title__line', this.box);
  private readonly studio = el('div', 'msfs-ui-setup-title__line', this.box);
  private readonly fitter = new TextFitter();
  /** The sim's block while held, and its own height. */
  private header: HTMLElement | null = null;
  private original = '';
  /** The mod's lines have the aircraft's names: until then (or when the sim gives no aircraft) the sim's lines stay. */
  private named = false;

  constructor(scope: Scope) {
    scope.add(() => this.leave());
  }

  /** The aircraft's names; null (the sim gave no aircraft): the sim's own lines show again. */
  render(fields: AircraftNameFields | null): void {
    const lines = titleLines(fields || {});
    this.named = !!(lines.model || lines.brand);
    this.model.textContent = lines.model;
    this.brand.textContent = lines.brand;
    this.studio.textContent = lines.studio;
  }

  /** At each layout pass, before the panel measures what is under the block (its height is fixed here): the block held, its lines fitted. */
  place(header: HTMLElement, unit: number): void {
    if (!this.named) {
      this.leave();
      return;
    }
    if (header !== this.header) {
      this.leave();
      this.header = header;
      this.original = header.style.height;
      header.classList.add(HOLDING);
      header.appendChild(this.box);
    }
    setStyle(header.style, 'height', `${Math.round(TITLE_UNITS * unit)}px`);
    const width = this.box.getBoundingClientRect().width;
    this.fitter.fit(this.model, width, MODEL_FONT_UNITS * unit, 'model');
    this.fitter.fit(this.brand, width, LINE_FONT_UNITS * unit, 'line');
    this.fitter.fit(this.studio, width, LINE_FONT_UNITS * unit, 'line');
  }

  /** The sim's block as it was. */
  leave(): void {
    const header = this.header;
    if (!header) return;
    this.header = null;
    header.classList.remove(HOLDING);
    header.style.height = this.original;
    if (this.box.parentNode) this.box.parentNode.removeChild(this.box);
  }
}
