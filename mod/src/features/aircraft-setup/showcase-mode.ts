// The setup panel's Showcase mode (panel.ts builds the parts and switches the modes): every part at its fixed place
// (showcase-layout.ts), the sim's title block holding its variant line, the bottom row's three buttons in whole pixels
// with the sim's Configure tile moved into its third slot (configure-tile.ts), and what that row needs, for the left
// column's width (index.ts).

import { setStyle, setVariable } from '../../core/dom.ts';
import { logError } from '../../core/log.ts';
import type { Scope } from '../../core/scope.ts';
import type { SimComponent } from '../../sim/components.ts';
import { ConfigureTile } from './configure-tile.ts';
import type { LiveryStrip, StripPlace } from './livery-strip.ts';
import { GAP } from './setup-layout.ts';
import { rowNeed, showcasePlaces, type ShowcasePlaces, type Span } from './showcase-layout.ts';
import type { VariantDropdown } from './variant-dropdown.ts';

/** The livery header, in layout units (a section header of core/theme.css): its height in whole pixels. */
const HEADER_HEIGHT = 36;
/** Layout passes (250 ms each) the bottom row may stay too narrow, the left column widening, before it is logged. */
const MISFIT_PASSES = 8;

/**
 * Transitional (the next task wires the new places): widths of the three buttons of the old bottom row in a row
 * `width` wide, each button its need (rounded up), the remainder shared equally in whole pixels, the last button taking
 * the rest; null when the needs do not fit.
 */
function actionWidths(width: number, gap: number, needs: readonly [number, number, number]): [number, number, number] | null {
  const wanted = needs.map((need) => Math.ceil(need));
  const remainder = width - 2 * gap - (wanted[0]! + wanted[1]! + wanted[2]!);
  if (remainder < 0) return null;
  const share = Math.floor(remainder / 3);
  return [wanted[0]! + share, wanted[1]! + share, wanted[2]! + remainder - 2 * share];
}

/** The panel's parts the Showcase mode places. */
export interface ShowcaseParts {
  root: HTMLElement;
  dropdownHost: HTMLElement;
  liveryHeader: HTMLElement;
  largeHost: HTMLElement;
  strip: LiveryStrip;
  tailRow: HTMLElement;
  actions: HTMLElement;
  /** Fuel and Identification, once created. */
  actionButtons: readonly SimComponent[];
  dropdown: VariantDropdown;
}

/** What the bottom row needs: its width and the left column's border around the panel, in pixels. */
export interface BottomRow {
  need: number;
  frame: number;
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

/** A part's place, in whole pixels from the panel's top (only written when it changes). */
function placeSpan(element: HTMLElement, span: Span): void {
  setStyle(element.style, 'top', `${span.top}px`);
  setStyle(element.style, 'height', `${span.height}px`);
}

export class ShowcaseMode {
  private readonly parts: ShowcaseParts;
  private readonly configure: ConfigureTile;
  /** What the three buttons need, measured for `key` (the unit and the three labels: a new language measures again). */
  private needs: { key: string; widths: [number, number, number]; row: BottomRow } | null = null;
  private needsMissed = false;
  private misfits = 0;
  /** The sim's variant line held at one line's height, and that height for a unit (holdTitleLines). */
  private heldSubtitle: HTMLElement | null = null;
  private line: { unit: number; height: number } | null = null;

  constructor(scope: Scope, parts: ShowcaseParts) {
    this.parts = parts;
    this.configure = new ConfigureTile(scope);
    scope.add(() => this.leave());
  }

  /**
   * The places for a panel from the statistics' top (`rect`) to the bottom of `details` (`Fleet_Details`); null while
   * the panel is smaller than its fixed parts (the screen animates): nothing is laid out then.
   */
  places(rect: DOMRect, details: HTMLElement, unit: number): ShowcasePlaces | null {
    const height = details.getBoundingClientRect().bottom - rect.top;
    const places = showcasePlaces(rect.width, height, Math.round(HEADER_HEIGHT * unit), unit, false);
    return places.grid.thumbHeight >= 1 ? places : null;
  }

  /**
   * The parts at their places (`rect`: the panel's left, top and width in the window; `column`: the sim's left column).
   * The panel's own box ends above the bottom row, and the row is only as wide as its first two buttons: its third slot
   * is the sim's Configure tile, which lies in the sim's column and would get no click under an element of the panel,
   * whatever its z-index (the column is a stacking context of its own; measured on 1.9.21).
   */
  layout(rect: DOMRect, places: ShowcasePlaces, tile: HTMLElement, column: HTMLElement | null, unit: number): void {
    const parts = this.parts;
    // Transitional rows: the bottom block's two rows stand for the old tail and buttons rows.
    const row = Math.round((places.bottom.height - Math.round(GAP * unit)) / 2);
    const tailRow: Span = { top: places.bottom.top, height: row };
    const actions: Span = { top: places.bottom.top + places.bottom.height - row, height: row };
    const strip: StripPlace = { top: places.grid.top, height: places.grid.thumbHeight, rows: 1, thumbWidth: places.grid.thumbWidth, thumbHeight: places.grid.thumbHeight };
    setStyle(parts.root.style, 'height', `${actions.top}px`);
    placeSpan(parts.dropdownHost, places.variants);
    placeSpan(parts.liveryHeader, places.header);
    placeSpan(parts.largeHost, places.livery);
    parts.strip.layout(strip, unit);
    placeSpan(parts.tailRow, tailRow);
    placeSpan(parts.actions, actions);

    // Fuel and Payload, Identification and Configure in whole pixels, each label whole (showcase-layout.ts); until the
    // labels are measured, and while the left column widens to fit them (index.ts), the row is shared in thirds.
    const width = Math.round(rect.width);
    const gap = Math.round(GAP * unit);
    if (this.configure.isPlaced(tile)) this.measureNeeds(tile, unit, gap, column ? column.getBoundingClientRect().width - rect.width : 0);
    const needs = this.needs ? this.needs.widths : null;
    let widths = needs ? actionWidths(width, gap, needs) : null;
    this.misfits = needs && !widths ? this.misfits + 1 : 0;
    if (this.misfits === MISFIT_PASSES && needs) {
      logError(`the bottom row's labels do not fit in ${width} pixels (they need ${needs.map(Math.ceil).join(', ')})`);
    }
    if (!widths) widths = actionWidths(width, gap, [0, 0, 0]) || [0, 0, 0];
    setVariable(parts.root.style, '--action-gap', `${gap}px`);
    setVariable(parts.root.style, '--action-w', `${widths[0]}px`);
    setStyle(parts.actions.style, 'width', `${widths[0] + gap + widths[1]}px`);
    this.configure.place(tile, {
      left: rect.left + widths[0] + gap + widths[1] + gap,
      top: rect.top + actions.top,
      width: widths[2],
      height: actions.height,
    });

    // The variants' list ends on the large livery's bottom edge.
    const variantsBottom = places.variants.top + places.variants.height;
    parts.dropdown.sizeList((places.livery.top + places.livery.height - variantsBottom) / unit, unit);
  }

  /** What the bottom row needs, once measured (index.ts widens the left column to it). */
  bottomRow(): BottomRow | null {
    return this.needs ? this.needs.row : null;
  }

  /**
   * Showcase (`details`; null: not): the sim's title block keeps the room of its third line, the variant, when it has
   * none (a legacy aircraft, such as the iFly 737 MAX: 130 pixels high instead of 158 at 1440 lines), so that the panel
   * under it keeps its place. The line is held at ONE line of the studio's font, measured once per resolution (a probe
   * in the studio's line), so a studio name on two lines does not change it.
   */
  holdTitleLines(details: HTMLElement | null, unit: number): void {
    const subtitle = details ? details.querySelector<HTMLElement>('[name="Header"] > [name="Subtitle"]') : null;
    const creator = details ? details.querySelector<HTMLElement>('[name="Header"] > [name="Creator"]') : null;
    const held = subtitle && creator ? subtitle : null;
    if (this.heldSubtitle && this.heldSubtitle !== held) setStyle(this.heldSubtitle.style, 'minHeight', '');
    this.heldSubtitle = held;
    if (!held || !creator) return;
    if (!this.line || this.line.unit !== unit) {
      const probe = document.createElement('span');
      probe.style.display = 'block';
      probe.style.whiteSpace = 'nowrap';
      probe.textContent = 'X';
      creator.appendChild(probe);
      const height = probe.getBoundingClientRect().height;
      creator.removeChild(probe);
      if (!(height > 0)) return;
      this.line = { unit, height };
    }
    setStyle(held.style, 'minHeight', `${this.line.height}px`);
  }

  /** The panel leaves Showcase (or unloads): the sim's tile and title block as they were, the panel's places cleared. */
  leave(): void {
    this.configure.restore();
    this.holdTitleLines(null, 0);
    const parts = this.parts;
    for (const part of [parts.tailRow, parts.actions]) {
      setStyle(part.style, 'top', '');
      setStyle(part.style, 'height', '');
    }
    setStyle(parts.actions.style, 'width', '');
  }

  /**
   * What the three buttons need, measured again when the resolution or a label changes (reading the labels costs
   * nothing; the probe in the tile's label is only added then). `frame`: the left column's width less the panel's.
   */
  private measureNeeds(tile: HTMLElement, unit: number, gap: number, frame: number): void {
    const buttons = this.parts.actionButtons;
    const labels = buttons.map((button) => {
      const parts = buttonLabel(button);
      return parts ? parts.text.textContent : '';
    });
    const title = tile.querySelector<HTMLElement>('[name="TextBlock"] > [name="Title"]');
    const key = `${unit}|${labels.join('|')}|${title ? title.textContent : ''}`;
    if ((this.needs && this.needs.key === key) || buttons.length < 2) return;
    const widths: [number, number, number] = [textButtonNeed(buttons[0]!), textButtonNeed(buttons[1]!), this.configure.need()];
    if (widths.every((need) => need > 0)) {
      this.needs = { key, widths, row: { need: rowNeed({ tail: 0, field: 0, fuel: widths[0], identification: widths[1], configure: widths[2] }, gap), frame } };
    } else if (!this.needsMissed) {
      this.needsMissed = true;
      logError(`the bottom row's labels could not be measured (${widths.map(Math.ceil).join(', ')})`);
    }
  }
}
