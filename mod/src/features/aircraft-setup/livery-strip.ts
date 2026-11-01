// The Showcase panel's strip of small liveries, under the large one (panel.ts): the sim's livery buttons in the sim's
// horizontal scrolling list, in rows filling the strip's height, column-major (showcase-layout.ts: stripCell), in the
// large livery's order (favourites first), a heart on each. Only the thumbnails near the visible part get components,
// from a pool (sim/component-pool.ts): an aircraft may have hundreds of liveries. A click chooses the livery as the
// large one's steps do (large-livery.ts); the livery the large one shows is outlined (Selected) and brought into view
// when it changes.

import { el, setStyle, setVariable, toggleClass } from '../../core/dom.ts';
import { iconToggle } from '../../core/icon-toggle.ts';
import { logError } from '../../core/log.ts';
import type { Scope } from '../../core/scope.ts';
import type { ConfiguratorLivery } from '../../sim/aircraft-loading.ts';
import { PooledCells, type PoolMargins, type PoolSlot } from '../../sim/component-pool.ts';
import { COMPONENTS, createComponent, type SimComponent } from '../../sim/components.ts';
import { isFavoriteLivery, loadFavoriteLiveries, type FavoriteLivery } from '../../sim/favorites.ts';
import { liveryFolder } from '../../sim/liveries.ts';
import { createRealScroll, removeFromList } from '../../sim/real-scroll.ts';
import { GAP } from './setup-layout.ts';
import { STRIP_BAR_UNITS, stripCell, stripReveal, type ShowcasePlaces } from './showcase-layout.ts';

/**
 * How near the visible part the thumbnails get components, in layout units: closer than the gallery's (its tiles are
 * larger), so that a long strip keeps at most 27 alive at 1440 lines (9 columns of 3) where the gallery's margins would
 * keep about 40; still more than a wheel step ahead (the sim's: 187 pixels at 1440 lines, measured on 1.9.21).
 */
const STRIP_MARGINS: PoolMargins = { create: 150, keep: 250 };

/** The sim's livery button (ImageButtonLiveryManipulator). */
interface LiveryButtonManipulator {
  setData(image: string, callback: () => void): void;
}

/** A small livery: its host keeps its place in the strip, its slot and button are there while it is near the view. */
interface Cell {
  livery: ConfiguratorLivery;
  host: HTMLElement;
  slot: PoolSlot<Cell> | null;
  card: SimComponent | null;
}

export interface LiveryStripEvents {
  /** An available livery was clicked. */
  choose(id: string): void;
  /** A heart was clicked. */
  favorite(id: string, on: boolean): void;
  /** The livery under the pointer (null: none), for the header. */
  hover(id: string | null): void;
}

export class LiveryStrip {
  private readonly scope: Scope;
  private readonly host: HTMLElement;
  private readonly events: LiveryStripEvents;
  private readonly list = createRealScroll('x', 'msfs-ui-setup__strip-list');
  private readonly pooled: PooledCells<Cell>;
  private cells: Cell[] = [];
  /** The column hosts in the list, `rows` cells each. */
  private columns: HTMLElement[] = [];
  private cellScope: Scope | null = null;
  /** What the cells were built for: the ids in order and the rows. */
  private key = '';
  private liveries: readonly ConfiguratorLivery[] = [];
  private favorites: FavoriteLivery[] = [];
  /** The strip as last laid out (null until then). */
  private place: ShowcasePlaces['strip'] | null = null;
  private gap = 0;
  /** Sizes last given to the cells: the list measures its content again when they change. */
  private sizes = '';
  /** The livery the large one shows, outlined; brought into view once laid out (`revealWanted`). */
  private selectedId: string | null = null;
  private revealWanted = false;
  /** The image each slot's button shows: the sim's button is given a new one only when it changes. */
  private readonly images = new WeakMap<PoolSlot<Cell>, string>();

  constructor(scope: Scope, host: HTMLElement, events: LiveryStripEvents) {
    this.scope = scope;
    this.host = host;
    this.events = events;
    host.appendChild(this.list);
    this.pooled = new PooledCells<Cell>(scope, host, {
      kind: () => 'livery',
      maker: () => ({ cardClass: 'msfs-ui-setup__strip-button', iconClass: 'msfs-ui-setup__strip-icon', create: (slot, slotScope) => this.createSlot(slot, slotScope) }),
      assigned: (cell) => this.update(cell),
      margins: STRIP_MARGINS,
    });
    // The sim's list scrolls itself (wheel, scroll bar): the thumbnails coming into view get their components.
    scope.listen(this.list, 'ui-scroll', () => this.materialize());
  }

  /** The liveries in the large livery's order. */
  render(liveries: readonly ConfiguratorLivery[]): void {
    this.liveries = liveries;
    this.favorites = loadFavoriteLiveries();
    this.build();
    for (const cell of this.cells) this.update(cell);
    this.materialize();
  }

  /** The livery the large one shows (null: none): outlined, and brought into view when it changes. */
  select(id: string | null): void {
    if (id === this.selectedId) return;
    this.selectedId = id;
    for (const cell of this.cells) this.update(cell);
    this.revealWanted = true;
    this.reveal();
  }

  /**
   * At each layout pass of the Showcase panel: the strip's host at its place, its scroll bar in the room under the rows
   * (`STRIP_BAR_UNITS`); the thumbnails in whole pixels (variables written only when they change).
   */
  layout(strip: ShowcasePlaces['strip'], unit: number): void {
    const style = this.host.style;
    setStyle(style, 'top', `${strip.top}px`);
    setStyle(style, 'height', `${strip.height + Math.ceil(STRIP_BAR_UNITS * unit)}px`);
    const rowsChanged = !this.place || this.place.rows !== strip.rows;
    this.place = strip;
    this.gap = Math.round(GAP * unit);
    setVariable(style, '--strip-w', `${strip.thumbWidth}px`);
    setVariable(style, '--strip-h', `${strip.thumbHeight}px`);
    setVariable(style, '--strip-gap', `${this.gap}px`);
    if (rowsChanged) this.render(this.liveries);
    const sizes = `${strip.thumbWidth}/${strip.thumbHeight}/${this.gap}/${strip.height}`;
    if (sizes !== this.sizes) {
      this.sizes = sizes;
      if (this.list.updateSizes) this.list.updateSizes();
    }
    this.reveal();
    this.materialize();
  }

  /** The cells again when the liveries or the rows change: column hosts of `rows` cells, column-major. */
  private build(): void {
    const rows = this.place ? this.place.rows : 0;
    const key = `${rows}|${this.liveries.map((livery) => livery.id).join('|')}`;
    if (key === this.key) {
      // Same cells: availability, hearts and selection refreshed in place.
      this.cells.forEach((cell, at) => (cell.livery = this.liveries[at]!));
      return;
    }
    this.key = key;
    // The slots leave the hosts before these go: they wait in the pool's parking for the next list.
    this.pooled.releaseAll();
    if (this.cellScope) this.cellScope.dispose();
    this.cellScope = null;
    removeFromList(this.columns);
    this.columns = [];
    this.cells = [];
    // A host taken away under the pointer sends no mouseleave.
    this.events.hover(null);
    if (!rows) return;
    const scope = (this.cellScope = this.scope.child());
    this.liveries.forEach((livery, at) => {
      if (stripCell(at, rows).row === 0) this.columns.push(el('div', 'msfs-ui-setup__strip-column', this.list));
      const host = el('div', 'msfs-ui-setup__strip-cell', this.columns[this.columns.length - 1]);
      const cell: Cell = { livery, host, slot: null, card: null };
      scope.listen(host, 'mouseenter', () => this.events.hover(cell.livery.id));
      scope.listen(host, 'mouseleave', () => this.events.hover(null));
      this.cells.push(cell);
    });
    this.list.scrollToPosition(0);
    this.revealWanted = true;
    if (this.list.updateSizes) this.list.updateSizes();
  }

  /** Components only for the thumbnails near the visible part of the strip (none while it is hidden). */
  private materialize(): void {
    if (!this.cellScope || this.cells.length === 0) return;
    this.pooled.materialize(this.cells, this.list, 'x');
  }

  /**
   * The selected livery's column whole in view, once the strip is laid out (stripReveal: on the edge it was beyond);
   * the thumbnails coming into view get their components at once.
   */
  private reveal(): void {
    const place = this.place;
    if (!this.revealWanted || !place || this.cells.length === 0) return;
    const view = this.list.getBoundingClientRect().width;
    if (view <= 0) return;
    this.revealWanted = false;
    const at = this.cells.findIndex((cell) => cell.livery.id === this.selectedId);
    if (at < 0) return;
    const columns = this.columns.length;
    const position = stripReveal(stripCell(at, place.rows).column, columns, place.thumbWidth, this.gap, view, this.list.currentScroll || 0);
    if (position === null) return;
    if (this.list.updateSizes) this.list.updateSizes();
    this.list.scrollToPosition(position);
    this.materialize();
  }

  /** A slot's components, made once; they show whatever cell holds the slot. */
  private createSlot(slot: PoolSlot<Cell>, scope: Scope): void {
    // The change event redraws the panel (hearts) and the gallery; the order of the thumbnails stays.
    slot.icon = iconToggle(scope, slot.iconHost, 'favorite', (checked) => {
      const cell = slot.item;
      if (cell && cell.slot === slot) this.events.favorite(cell.livery.id, checked);
    });
    createComponent(scope, COMPONENTS.liveryButton, slot.cardHost).then(
      (card) => {
        if (scope.disposed) return;
        slot.card = card;
        // Inside the button's component: the pointer on the heart keeps it hovered.
        card.element.appendChild(slot.iconHost);
        this.pooled.markReady(slot);
        const cell = slot.item;
        if (cell && cell.slot === slot) {
          cell.card = card;
          this.update(cell);
        }
      },
      (error: unknown) => logError('a small livery could not be created', error),
    );
  }

  /**
   * Image, outline, availability and heart of a thumbnail. ImageButton_Livery has no Disabled state of its own: an
   * unavailable livery is dimmed by its host (aircraft-setup.css), and a click on it is ignored.
   */
  private update(cell: Cell): void {
    const { livery, card, slot } = cell;
    const favorite = isFavoriteLivery(livery, this.favorites);
    toggleClass(cell.host, 'is-disabled', !!livery.isDisabled);
    toggleClass(cell.host, 'is-favorite', favorite);
    if (!slot) return;
    // A livery without a folder cannot be a favourite: no heart.
    slot.iconHost.style.display = liveryFolder(livery) ? '' : 'none';
    if (slot.icon) slot.icon.set(favorite);
    const manipulator = card ? card.manipulator<LiveryButtonManipulator>() : null;
    if (!card || !manipulator) return;
    card.select(livery.id === this.selectedId);
    if (this.images.get(slot) !== livery.imageUrl) {
      this.images.set(slot, livery.imageUrl);
      manipulator.setData(livery.imageUrl, () => {
        const current = slot.item;
        if (current && current.slot === slot && !current.livery.isDisabled) this.events.choose(current.livery.id);
      });
    }
  }
}
