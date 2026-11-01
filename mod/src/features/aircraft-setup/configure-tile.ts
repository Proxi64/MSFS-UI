// The sim's "Configure your aircraft" tile on the Showcase panel's bottom row (panel.ts): moved into the row's third
// slot and reduced to its height (aircraft-setup.css, `msfs-ui-setup-configure`: the watermark hidden, the key and the
// label laid out as on the sim's small buttons). Its click and its key (F) stay the sim's. Its place is written on the
// tile itself; its own styles come back when the panel leaves Showcase or unloads.

import { setStyle } from '../../core/dom.ts';
import type { Scope } from '../../core/scope.ts';

/** The tile in `Fleet_Details`, and the class that reduces it (aircraft-setup.css). */
export const CONFIGURE_TILE = '[name="TileButton_Watermark_Small_Cockpit"]';
const PLACED = 'msfs-ui-setup-configure';
const PLACE = ['left', 'top', 'right', 'bottom', 'width', 'height'] as const;

/** A box in pixels, in the window. */
export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

export class ConfigureTile {
  private tile: HTMLElement | null = null;
  private readonly originals = new Map<string, string>();

  constructor(scope: Scope) {
    scope.add(() => this.restore());
  }

  /** Whether `tile` is the one placed: its reduced look applies. */
  isPlaced(tile: HTMLElement): boolean {
    return this.tile === tile;
  }

  /** Puts `tile` at `box`, in whole pixels from the block that holds it (the sim's `ButtonBlock`). */
  place(tile: HTMLElement, box: Box): void {
    if (tile !== this.tile) {
      this.restore();
      this.tile = tile;
      for (const property of PLACE) this.originals.set(property, tile.style.getPropertyValue(property));
    }
    tile.classList.add(PLACED);
    const block = tile.parentElement;
    if (!block) return;
    const origin = block.getBoundingClientRect();
    const style = tile.style;
    setStyle(style, 'left', `${Math.round(box.left - origin.left)}px`);
    setStyle(style, 'top', `${Math.round(box.top - origin.top)}px`);
    setStyle(style, 'width', `${box.width}px`);
    setStyle(style, 'height', `${box.height}px`);
    setStyle(style, 'right', 'auto');
    setStyle(style, 'bottom', 'auto');
  }

  /** The tile's own place and look, back. */
  restore(): void {
    const tile = this.tile;
    if (!tile) return;
    this.tile = null;
    tile.classList.remove(PLACED);
    this.originals.forEach((value, property) => {
      if (value) tile.style.setProperty(property, value);
      else tile.style.removeProperty(property);
    });
    this.originals.clear();
  }

  /**
   * The width the placed tile needs to show its label whole, in pixels: its width less its label's, plus the label's
   * own width on one line (a probe in the label takes its font); 0 when the label is not found.
   */
  need(): number {
    const tile = this.tile;
    const title = tile ? tile.querySelector<HTMLElement>('[name="TextBlock"] > [name="Title"]') : null;
    if (!tile || !title) return 0;
    const probe = document.createElement('span');
    probe.style.whiteSpace = 'nowrap';
    probe.textContent = title.textContent;
    title.appendChild(probe);
    const natural = probe.getBoundingClientRect().width;
    title.removeChild(probe);
    return tile.getBoundingClientRect().width - title.getBoundingClientRect().width + natural;
  }
}
