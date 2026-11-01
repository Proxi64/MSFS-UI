// The setup panel's Showcase mode (panel.ts builds the parts and switches the modes): every part at its fixed place
// (showcase-layout.ts), and the bottom block in two columns: the sim's Configure tile on the left (configure-tile.ts), the
// tail number over Fuel and Identification on the right, as wide as their labels need; and what that block needs, for the
// left column's width (index.ts).

import { setStyle, setVariable, toggleClass, uiUnit } from '../../core/dom.ts';
import { logError } from '../../core/log.ts';
import type { Scope } from '../../core/scope.ts';
import type { SimComponent } from '../../sim/components.ts';
import { ConfigureTile } from './configure-tile.ts';
import type { LiveryGrid } from './livery-grid.ts';
import { GAP } from './setup-layout.ts';
import { bottomColumns, panelHasRoom, rowNeed, sharedColumns, showcasePlaces, type BottomNeeds, type ShowcasePlaces, type Span } from './showcase-layout.ts';
import type { VariantDropdown } from './variant-dropdown.ts';

/** The variant and livery headers, in layout units (a section header of core/theme.css): their height in whole pixels. */
const HEADER_HEIGHT = 36;
/** The tail number's field, in layout units: the sim's longest values with the field's own paddings. */
const TAIL_FIELD_UNITS = 120;
/** Layout passes (250 ms each) the bottom block may stay too narrow, the left column widening, before it is logged. */
const MISFIT_PASSES = 8;
/**
 * Layout passes the labels may stay unmeasured before it is logged: the sim gives its tile a size after the rest of the
 * screen (measured on 1.9.21: 1.2 s after the panel showed; 2.9 to 3.9 s after the screen on a slow entry).
 */
const UNMEASURED_PASSES = 40;

/** The panel's parts the Showcase mode places. */
export interface ShowcaseParts {
  root: HTMLElement;
  variantRow: HTMLElement;
  liveryHeader: HTMLElement;
  largeHost: HTMLElement;
  grid: LiveryGrid;
  tailRow: HTMLElement;
  /** The tail number's title. */
  tailTitle: HTMLElement;
  actions: HTMLElement;
  /** Fuel and Identification, once created. */
  actionButtons: readonly SimComponent[];
  dropdown: VariantDropdown;
}

/** What the bottom block needs: its width and the left column's border around the panel, in pixels. */
export interface BottomRow {
  need: number;
  frame: number;
}

/** What the bottom block needed when last measured whole (the tile included), for `unit` and the labels of `key`. */
export interface MeasuredBottom {
  unit: number;
  key: string;
  parts: BottomNeeds;
  row: BottomRow;
}

/**
 * The last whole measure, kept by index.ts across the screen's activations: at the next entry at the same unit, the block
 * and the left column take their widths from the first pass, instead of moving once the sim gives its tile a size (1.2
 * to 3.9 s after; measured on 1.9.21, 2026-11-01).
 */
export interface BottomMemory {
  last: MeasuredBottom | null;
}

/** A small text button of the sim: its label (the marquee's content, on one line), or null. */
function buttonLabel(button: SimComponent): { label: HTMLElement; text: HTMLElement } | null {
  const label = button.element.querySelector<HTMLElement>('[name="Content"] > [name="Text"]');
  const text = label ? label.querySelector<HTMLElement>('.marquee__content') : null;
  return label && text ? { label, text } : null;
}

/** The width a small text button needs to show its label whole, in pixels: its width less its label's, plus the text's. */
function textButtonNeed(button: SimComponent): number {
  const parts = buttonLabel(button);
  if (!parts) return 0;
  return button.element.getBoundingClientRect().width - parts.label.getBoundingClientRect().width + parts.text.getBoundingClientRect().width;
}

/** The width a section header needs to show its title whole, in pixels: the title (it does not shrink: aircraft-setup.css) and the header's paddings. */
function headerNeed(header: HTMLElement): number {
  const title = header.querySelector<HTMLElement>('.msfs-ui-title');
  if (!title) return 0;
  const style = window.getComputedStyle(header);
  return title.getBoundingClientRect().width + parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
}

/** A part's place, in whole pixels from the panel's top (only written when it changes). */
function placeSpan(element: HTMLElement, span: Span): void {
  setStyle(element.style, 'top', `${span.top}px`);
  setStyle(element.style, 'height', `${span.height}px`);
}

export class ShowcaseMode {
  private readonly parts: ShowcaseParts;
  private readonly configure: ConfigureTile;
  /**
   * What the bottom block needs, measured for `key` (the unit and its labels: a new language measures again); `row`
   * null and `key` empty while the tile has no size yet (the right column's needs are known: its labels show whole).
   */
  private needs: { key: string; parts: BottomNeeds; row: BottomRow | null } | null = null;
  private readonly memory: BottomMemory;
  private unmeasured = 0;
  private misfits = 0;

  /** `memory`: the last whole measure of an earlier entry, taken while the unit is the same, and kept up to date. */
  constructor(scope: Scope, parts: ShowcaseParts, memory: BottomMemory) {
    this.parts = parts;
    this.memory = memory;
    this.configure = new ConfigureTile(scope);
    const last = memory.last;
    if (last && last.unit === uiUnit()) this.needs = { key: last.key, parts: last.parts, row: last.row };
    scope.add(() => this.leave());
  }

  /**
   * The places for a panel from the title block's bottom, the statistics' top (`rect`), to the bottom of `details`
   * (`Fleet_Details`); null while it lacks the room for its parts (the screen animates): nothing is laid out then. Only
   * the grid's columns depend on the number of liveries.
   */
  places(rect: DOMRect, details: HTMLElement, unit: number): ShowcasePlaces | null {
    const height = details.getBoundingClientRect().bottom - rect.top;
    const places = showcasePlaces(rect.width, height, Math.round(HEADER_HEIGHT * unit), unit, this.parts.grid.count);
    return panelHasRoom(places) ? places : null;
  }

  /**
   * The parts at their places (`rect`: the panel's left, top and width in the window; `column`: the sim's left column).
   * The panel's own box ends above the bottom block, and the block's right column lies under it, outside the box: on the
   * left is the sim's Configure tile, which lies in the sim's column and would get no click under an element of the
   * panel, whatever its z-index (the column is a stacking context of its own; measured on 1.9.21).
   */
  layout(rect: DOMRect, places: ShowcasePlaces, tile: HTMLElement, column: HTMLElement | null, unit: number): void {
    const parts = this.parts;
    setStyle(parts.root.style, 'height', `${places.bottom.top}px`);
    placeSpan(parts.variantRow, places.variants);
    placeSpan(parts.liveryHeader, places.header);
    placeSpan(parts.largeHost, places.livery);
    toggleClass(parts.largeHost, 'is-cropped', places.cropped);
    parts.grid.layout(places.grid);

    // The tile and the right column in whole pixels, each label whole (showcase-layout.ts); until the labels are
    // measured, and while the left column widens to fit them (index.ts), the block is shared in halves.
    const width = Math.round(rect.width);
    const gap = Math.round(GAP * unit);
    if (this.configure.isPlaced(tile)) this.measureNeeds(tile, unit, gap, column ? column.getBoundingClientRect().width - rect.width : 0);
    const needs = this.needs ? this.needs.parts : null;
    const fitted = needs ? bottomColumns(width, gap, needs) : null;
    this.misfits = needs && !fitted ? this.misfits + 1 : 0;
    if (this.misfits === MISFIT_PASSES && needs) {
      logError(`the bottom block's labels do not fit in ${width} pixels (it needs ${rowNeed(needs, gap)})`);
    }
    const columns = fitted || sharedColumns(width, gap);
    const row = (places.bottom.height - gap) / 2;
    const right = columns.configure + gap;
    for (const [part, top] of [
      [parts.tailRow, places.bottom.top],
      [parts.actions, places.bottom.top + row + gap],
    ] as const) {
      placeSpan(part, { top, height: row });
      setStyle(part.style, 'left', `${right}px`);
      setStyle(part.style, 'width', `${columns.right}px`);
    }
    setVariable(parts.root.style, '--action-gap', `${gap}px`);
    setVariable(parts.root.style, '--action-w', `${columns.fuel}px`);
    setVariable(parts.root.style, '--tail-w', `${columns.tailTitle}px`);
    this.configure.place(tile, { left: rect.left, top: rect.top + places.bottom.top, width: columns.configure, height: places.bottom.height });

    // The variants' row: its list ends on the large livery's bottom edge.
    const variantsBottom = places.variants.top + places.variants.height;
    parts.dropdown.layout((places.livery.top + places.livery.height - variantsBottom) / unit, unit);
  }

  /** What the bottom block needs, once measured (index.ts widens the left column to it). */
  bottomRow(): BottomRow | null {
    return this.needs ? this.needs.row : null;
  }

  /** The panel leaves Showcase (or unloads): the sim's tile as it was, the panel's places cleared. */
  leave(): void {
    this.configure.restore();
    const parts = this.parts;
    for (const part of [parts.tailRow, parts.actions]) {
      for (const property of ['top', 'height', 'left', 'width'] as const) setStyle(part.style, property, '');
    }
  }

  /**
   * What the bottom block needs, measured again when the resolution or a label changes (reading the labels costs
   * nothing; the probe in the tile's label is only added then, once the tile has a size). `frame`: the left column's width less the panel's.
   */
  private measureNeeds(tile: HTMLElement, unit: number, gap: number, frame: number): void {
    const buttons = this.parts.actionButtons;
    const labels = buttons.map((button) => {
      const parts = buttonLabel(button);
      return parts ? parts.text.textContent : '';
    });
    const title = tile.querySelector<HTMLElement>('[name="TextBlock"] > [name="Title"]');
    const key = `${unit}|${labels.join('|')}|${title ? title.textContent : ''}|${this.parts.tailTitle.textContent}`;
    if ((this.needs && this.needs.key === key) || buttons.length < 2) return;
    const needs: BottomNeeds = {
      tail: headerNeed(this.parts.tailTitle),
      field: Math.ceil(TAIL_FIELD_UNITS * unit),
      fuel: textButtonNeed(buttons[0]!),
      identification: textButtonNeed(buttons[1]!),
      configure: this.configure.need(),
    };
    const tileMeasured = needs.configure > 0;
    if (needs.tail > 0 && needs.fuel > 0 && needs.identification > 0) {
      if (tileMeasured) {
        const row = { need: rowNeed(needs, gap), frame };
        this.needs = { key, parts: needs, row };
        this.memory.last = { unit, key, parts: needs, row };
        this.unmeasured = 0;
      } else if (!this.needs || !this.needs.row) {
        // Until the tile has a size, the right column's needs; a whole measure (an earlier entry's) stays meanwhile.
        this.needs = { key: '', parts: needs, row: null };
      }
    }
    if ((!tileMeasured || !this.needs) && ++this.unmeasured === UNMEASURED_PASSES) {
      logError(`the bottom block's labels could not be measured (${JSON.stringify(needs)})`);
    }
  }
}
