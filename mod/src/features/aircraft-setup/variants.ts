// The setup panel's variants (panel.ts): the sim's tiles in the sim's scrolling list, as many per row as let the
// widest name show whole (setup-layout.ts), the selected one revealed once the list is rebuilt.

import { el, uiUnit } from '../../core/dom.ts';
import { logError } from '../../core/log.ts';
import type { Scope } from '../../core/scope.ts';
import { COMPONENTS, createComponent, type SimComponent } from '../../sim/components.ts';
import type { ConfiguratorItem } from '../../sim/configurator.ts';
import { translate } from '../../sim/localization.ts';
import { createRealScroll, removeFromList } from '../../sim/real-scroll.ts';
import { GAP, variantsPerRow } from './setup-layout.ts';

/** Selection corner of the compact tiles (core/theme.css), kept clear of the title. */
const CORNER_UNITS = 30;

export interface VariantsEvents {
  /** A variant not selected yet was clicked. */
  choose(id: string): void;
  /** The tiles changed (rebuilt, or measured): the panel lays its lists out again. */
  relayout(): void;
}

export class VariantsList {
  readonly list = createRealScroll('y', 'msfs-ui-setup__variants');
  private readonly scope: Scope;
  private readonly events: VariantsEvents;
  /** Components by id, built for one set of ids. */
  private items: ConfiguratorItem[] = [];
  private key = '';
  private tilesScope: Scope | null = null;
  private hosts: HTMLElement[] = [];
  private readonly tiles = new Map<string, SimComponent>();
  /** Tiles per row and tile width of the current layout. */
  private arranged = '';
  /** Width a tile needs to show the widest name whole, in pixels (0 until the tiles are measured). */
  private needed = 0;
  /** The tiles were rebuilt: the list scrolls to the selected one once laid out. */
  private reveal = false;

  constructor(scope: Scope, events: VariantsEvents) {
    this.scope = scope;
    this.events = events;
  }

  get count(): number {
    return this.items.length;
  }

  render(items: ConfiguratorItem[]): void {
    this.items = items;
    const key = items.map((item) => item.id).join('|');
    if (key !== this.key) {
      this.key = key;
      if (this.tilesScope) this.tilesScope.dispose();
      const scope = (this.tilesScope = this.scope.child());
      this.tiles.clear();
      removeFromList(this.hosts);
      this.hosts = [];
      this.arranged = '';
      this.needed = 0;
      this.reveal = true;
      items.forEach((item) => {
        const host = el('div', 'msfs-ui-setup__variant msfs-ui-compact-tile');
        this.list.appendChild(host);
        this.hosts.push(host);
        createComponent(scope, COMPONENTS.tileButton, host, { Title: translate(item.title) }).then(
          (tile) => {
            // A component of a list rebuilt since (another aircraft) is dropped with its scope.
            if (scope.disposed) return;
            this.tiles.set(item.id, tile);
            tile.onClick(scope, () => this.choose(item.id));
            this.update();
            if (this.measure()) this.events.relayout();
          },
          (error: unknown) => logError('a variant tile could not be created', error),
        );
      });
      this.events.relayout();
    }
    this.update();
  }

  /**
   * Lays the tiles out `perRow` per row in a list `row` pixels wide, in whole pixels (the engine rounds computed widths
   * down): the last tile of a full row takes the rest and ends at the list's edge; a row that is not full keeps the
   * same widths, so its tiles stay aligned on the columns above.
   */
  arrange(perRow: number, row: number): void {
    const gap = GAP * uiUnit();
    const width = row > 0 ? Math.floor((row - gap * (perRow - 1)) / perRow) : 0;
    const key = `${perRow}/${width}/${this.hosts.length}`;
    if (key === this.arranged) return;
    this.arranged = key;
    this.hosts.forEach((host, at) => {
      const last = at % perRow === perRow - 1;
      if (width <= 0) host.style.width = `calc((100% - var(--u) * ${GAP * (perRow - 1)}) / ${perRow})`;
      else host.style.width = last ? `calc(100% - ${width * (perRow - 1)}px - var(--u) * ${GAP * (perRow - 1)})` : `${width}px`;
      host.style.marginRight = last ? '0' : '';
    });
  }

  /** Tiles per row in a list `width` wide: up to three until the tiles are measured. */
  perRow(width: number, gap: number): number {
    const count = this.items.length;
    return this.needed > 0 ? variantsPerRow(count, width, this.needed, gap) : Math.min(3, Math.max(1, count));
  }

  /**
   * The width a tile needs to show the widest name whole, room for the selection corner included: the engine shows
   * no ellipsis, a long name would be cut. Measured once every tile exists, and when the panel's width changes
   * (panel.ts). True when measured; nothing is measured while the list is hidden (Showcase, or the panel hidden): its
   * names would measure 0.
   */
  measure(): boolean {
    if (this.items.length === 0 || this.tiles.size < this.items.length) return false;
    if (!(this.list.getBoundingClientRect().width > 0)) return false;
    const unit = uiUnit();
    // The text's own width: a probe inside each title takes its font. Every probe is added before any is measured, so
    // the engine lays the page out once, not once per variant (it now runs at each change of the column's width).
    const probes: { title: HTMLElement; probe: HTMLElement; content: HTMLElement }[] = [];
    this.tiles.forEach((tile) => {
      const title = tile.element.querySelector<HTMLElement>('[name="Title"]');
      const content = tile.element.querySelector<HTMLElement>('[name="Content"]');
      if (!title || !content) return;
      const probe = el('span', '', title);
      probe.style.whiteSpace = 'nowrap';
      probe.textContent = title.textContent;
      probes.push({ title, probe, content });
    });
    let widest = 0;
    let padding = 0;
    for (const { probe, content } of probes) {
      const style = window.getComputedStyle(content);
      padding = Math.max(padding, parseFloat(style.paddingLeft) + parseFloat(style.paddingRight));
      widest = Math.max(widest, probe.getBoundingClientRect().width);
    }
    for (const { title, probe } of probes) title.removeChild(probe);
    this.needed = widest + padding + CORNER_UNITS * unit;
    return true;
  }

  /**
   * The index of the selected variant to scroll to, once after the tiles were rebuilt and every one exists; -1 when
   * there is none (nothing rebuilt, tiles still coming, or no variant selected).
   */
  takeReveal(): number {
    if (!this.reveal || this.items.length === 0 || this.tiles.size !== this.items.length) return -1;
    this.reveal = false;
    return this.items.findIndex((item) => item.isSelected);
  }

  private update(): void {
    for (const item of this.items) {
      const tile = this.tiles.get(item.id);
      if (!tile) continue;
      tile.select(item.isSelected);
      tile.disable(item.isDisabled);
    }
  }

  private choose(id: string): void {
    const item = this.items.filter((candidate) => candidate.id === id)[0];
    if (!item || item.isSelected) return;
    this.events.choose(id);
  }
}
