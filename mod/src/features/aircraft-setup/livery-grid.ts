// The Showcase panel's grid of small liveries, under the large one (panel.ts): the sim's livery buttons in the sim's
// vertical scrolling list, three to a row, row-major (showcase-layout.ts: gridCell), in the large livery's order
// (favourites first), a heart on each. Two whole rows show, and the list rests on whole rows: never a cut thumbnail
// (sim/step-scroll.ts). Only the thumbnails near the visible part get components, from a pool (sim/component-pool.ts): an
// aircraft may have hundreds of liveries. A click chooses the livery as the large one's steps do (large-livery.ts); the
// livery the large one shows is outlined (Selected) and brought into view when it changes.

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
import { keepOnSteps } from '../../sim/step-scroll.ts';
import { GRID_COLUMNS, GRID_ROWS, gridCell, gridReveal, type GridPlace } from './showcase-layout.ts';

/**
 * How near the visible part the thumbnails get components, in layout units: closer than the gallery's (its tiles are
 * larger), so that a long grid keeps about 20 alive (6 or 7 rows of 3) where the gallery's margins would keep about 30;
 * still more than a wheel step ahead.
 */
const GRID_MARGINS: PoolMargins = { create: 150, keep: 250 };

/** The sim's livery button (ImageButtonLiveryManipulator). */
interface LiveryButtonManipulator {
  setData(image: string, callback: () => void): void;
}

/** A small livery: its host keeps its place in the grid, its slot and button are there while it is near the view. */
interface Cell {
  livery: ConfiguratorLivery;
  host: HTMLElement;
  slot: PoolSlot<Cell> | null;
  card: SimComponent | null;
}

export interface LiveryGridEvents {
  /** An available livery was clicked. */
  choose(id: string): void;
  /** A heart was clicked. */
  favorite(id: string, on: boolean): void;
  /** The livery under the pointer (null: none), for the header. */
  hover(id: string | null): void;
}

export class LiveryGrid {
  private readonly scope: Scope;
  private readonly host: HTMLElement;
  private readonly events: LiveryGridEvents;
  private readonly list = createRealScroll('y', 'msfs-ui-setup__grid-list');
  private readonly pooled: PooledCells<Cell>;
  private cells: Cell[] = [];
  /** The row hosts in the list, three cells each. */
  private rows: HTMLElement[] = [];
  private cellScope: Scope | null = null;
  /** The ids in order the cells were built for. */
  private key: string | null = null;
  private liveries: readonly ConfiguratorLivery[] = [];
  private favorites: FavoriteLivery[] = [];
  /** The grid as last laid out (null until then). */
  private place: GridPlace | null = null;
  /** Sizes last given to the cells: the list measures its content again when they change. */
  private sizes = '';
  /** The livery the large one shows, outlined; brought into view once laid out (`revealWanted`). */
  private selectedId: string | null = null;
  private revealWanted = false;
  /** The image each slot's button shows: the sim's button is given a new one only when it changes. */
  private readonly images = new WeakMap<PoolSlot<Cell>, string>();

  constructor(scope: Scope, host: HTMLElement, events: LiveryGridEvents) {
    this.scope = scope;
    this.host = host;
    this.events = events;
    host.appendChild(this.list);
    this.pooled = new PooledCells<Cell>(scope, host, {
      kind: () => 'livery',
      maker: () => ({ cardClass: 'msfs-ui-setup__grid-button', iconClass: 'msfs-ui-setup__grid-icon', create: (slot, slotScope) => this.createSlot(slot, slotScope) }),
      assigned: (cell) => this.update(cell),
      margins: GRID_MARGINS,
    });
    // The sim's list scrolls itself (wheel, scroll bar): the thumbnails coming into view get their components.
    scope.listen(this.list, 'ui-scroll', () => this.materialize());
    keepOnSteps(scope, {
      list: this.list,
      host,
      step: () => (this.place && this.place.scrolls ? this.place.rowStep : 0),
      max: () => {
        if (this.list.updateSizes) this.list.updateSizes();
        return this.maxScroll();
      },
      scrollTo: (position) => {
        this.list.scrollToPosition(position);
        this.materialize();
      },
    });
  }

  /** How many liveries the grid shows: its columns' gaps and its bar depend on it (showcase-layout.ts: showcasePlaces). */
  get count(): number {
    return this.liveries.length;
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

  /** At each layout pass of the Showcase panel: the grid's host at its place, the thumbnails in whole pixels (only written when they change). */
  layout(place: GridPlace): void {
    const style = this.host.style;
    this.place = place;
    setStyle(style, 'top', `${place.top}px`);
    setStyle(style, 'height', `${place.height}px`);
    setVariable(style, '--grid-w', `${place.thumbWidth}px`);
    setVariable(style, '--grid-h', `${place.thumbHeight}px`);
    setVariable(style, '--grid-column-gap', `${place.columnGap}px`);
    setVariable(style, '--grid-last-gap', `${place.lastGap}px`);
    setVariable(style, '--grid-row-gap', `${place.rowStep - place.thumbHeight}px`);
    toggleClass(this.list, 'is-scrolling', place.scrolls);
    const sizes = `${place.thumbWidth}/${place.rowStep}/${place.columnGap}/${place.height}/${place.scrolls}`;
    if (sizes !== this.sizes) {
      this.sizes = sizes;
      if (this.list.updateSizes) this.list.updateSizes();
      // Other thumbnails: the shown livery's row moved.
      this.revealWanted = true;
    }
    this.reveal();
    this.materialize();
  }

  /** The cells again when the liveries change: row hosts of three cells, row-major. */
  private build(): void {
    const key = this.liveries.map((livery) => livery.id).join('|');
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
    removeFromList(this.rows);
    this.rows = [];
    this.cells = [];
    // A host taken away under the pointer sends no mouseleave.
    this.events.hover(null);
    const scope = (this.cellScope = this.scope.child());
    this.liveries.forEach((livery, at) => {
      const place = gridCell(at);
      if (place.column === 0) this.rows.push(el('div', 'msfs-ui-setup__grid-row', this.list));
      const host = el('div', 'msfs-ui-setup__grid-cell', this.rows[this.rows.length - 1]);
      toggleClass(host, 'is-second', place.column === GRID_COLUMNS - 2);
      toggleClass(host, 'is-last', place.column === GRID_COLUMNS - 1);
      const cell: Cell = { livery, host, slot: null, card: null };
      scope.listen(host, 'mouseenter', () => this.events.hover(cell.livery.id));
      scope.listen(host, 'mouseleave', () => this.events.hover(null));
      this.cells.push(cell);
    });
    this.list.scrollToPosition(0);
    this.revealWanted = true;
    if (this.list.updateSizes) this.list.updateSizes();
  }

  /** Components only for the thumbnails near the visible part of the grid (none while it is hidden). */
  private materialize(): void {
    if (!this.cellScope || this.cells.length === 0) return;
    this.pooled.materialize(this.cells, this.list, 'y');
  }

  /** The room the rows leave under the view, in whole rows (the grid's view is two rows). */
  private maxScroll(): number {
    const place = this.place;
    return place ? Math.max(0, this.rows.length - GRID_ROWS) * place.rowStep : 0;
  }

  /**
   * The selected livery's row in view on whole rows, once the grid is laid out (gridReveal); the thumbnails coming into
   * view get their components at once.
   */
  private reveal(): void {
    const place = this.place;
    if (!this.revealWanted || !place || this.cells.length === 0) return;
    if (!(this.list.getBoundingClientRect().height > 0)) return;
    this.revealWanted = false;
    const at = this.cells.findIndex((cell) => cell.livery.id === this.selectedId);
    if (at < 0) return;
    const position = gridReveal(gridCell(at).row, place.rowStep, this.list.currentScroll || 0, this.rows.length);
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
