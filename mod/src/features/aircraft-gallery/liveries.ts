// The livery column of the side by side layout (gallery.ts): the liveries of the current aircraft as large tiles, two
// per row, with their name and tail number, favourites first; in the gallery's List view, as rows. Made of the sim's components (its aircraft tile,
// its scrolling list) and the mod's bookmark; the choices go through the configurator as in the setup panel (sim/configurator.ts).

import { el, setVariable, toggleClass, uiUnit } from '../../core/dom.ts';
import { iconToggle } from '../../core/icon-toggle.ts';
import { logError } from '../../core/log.ts';
import type { Scope } from '../../core/scope.ts';
import { cellAction } from '../../core/virtual-list.ts';
import type { ConfiguratorLivery } from '../../sim/aircraft-loading.ts';
import { ComponentPool, type PoolSlot } from '../../sim/component-pool.ts';
import { COMPONENTS, createComponent, type SimComponent } from '../../sim/components.ts';
import { chooseLivery, readConfigurator, setFavoriteLivery, syncConfigurator, type ConfiguratorState } from '../../sim/configurator.ts';
import { FAVORITE_LIVERIES_CHANGED, isFavoriteLivery, loadFavoriteLiveries, type FavoriteLivery } from '../../sim/favorites.ts';
import { liveryDirectory, liveryFolder, liveryKey, loadLiveryTails } from '../../sim/liveries.ts';
import { atcIdFromCfg } from '../../sim/registration.ts';
import { scrollBarWidth, type RealScroll } from '../../sim/real-scroll.ts';
import { store, translate, watch } from '../../sim/store.ts';
import { orderLiveries, type LiveryOrder } from '../aircraft-setup/livery-order.ts';
import { revealPosition } from '../aircraft-setup/setup-layout.ts';
import { LIVERY_COLUMNS, liveryFit, liveryTail } from './livery-column.ts';

/** The sim's horizontal marketplace tile (see the gallery's List view): an owned item makes its hover do nothing more. */
interface HorizontalTileManipulator {
  item?: { isOwned: boolean; isOwnedBySubscription: boolean; isFavorite: boolean };
}

/** A tile of the column: its host, and its components while near the visible part of the list (core/virtual-list.ts). */
interface Cell {
  livery: ConfiguratorLivery;
  host: HTMLElement;
  /** Its slot of the pool while near the view (sim/component-pool.ts). */
  slot: PoolSlot<Cell> | null;
  card: SimComponent | null;
}

/** Where the gallery puts the column, in pixels from its own top left corner. */
export interface ColumnRect {
  left: number;
  top: number;
  width: number;
  height: number;
  /** The gallery's List view: the liveries as rows too. */
  list: boolean;
}

/** Events of the sim's aircraft tile: they carry no data here, the page would take them for its own grid's. */
const TILE_EVENTS = ['tileClick', 'tileClickDisabled', 'tileHover'];
const RELOAD_DELAY_MS = 80;
/** Layout units: gap between the two tiles of a row and under each row; room for the scroll bar (as in the CSS). */
const GAP = 12;
const SCROLL_BAR_ROOM = 24;
/** Height of the tile's text banner: two lines of 21 units (name, tail number), 6 above and below. */
const BANNER_HEIGHT = 54;
/** A row of the List view and the gap under it, in layout units (as the gallery's rows, aircraft-gallery.css). */
const ROW_STEP = 77 + 6;
/** Components are created for the tiles within this distance of the visible part, and kept within the second, in layout units. */
const CREATE_MARGIN = 300;
const KEEP_MARGIN = 600;
/** Length of the sim's tail number field (`allowedLength` on sim 1.9.18). */
const TAIL_LENGTH = 9;

const aircraft = store.Game.Aircraft;

export class LiveryColumn {
  private readonly scope: Scope;
  private readonly root = el('div', 'msfs-ui-gal__liveries');
  private readonly name = el('span', 'msfs-ui-value msfs-ui-gal__livery-name');
  private readonly list = document.createElement('real-scroll') as RealScroll;

  /** The configurator as last read: the choices are made on it. */
  private state: ConfiguratorState = { variants: [], liveries: [], details: null, variationTitle: '' };
  private order: LiveryOrder | null = null;
  private cells: Cell[] = [];
  private cellScope: Scope | null = null;
  private cellKey = '';
  private selectedTitle = '';
  /** The `atc_id` of each livery.cfg read (null: none, or being read), by livery key. */
  private readonly atcIds = new Map<string, string | null>();
  private reloadTimer: ReturnType<typeof setTimeout> | undefined;
  private reloadNumber = 0;
  /** A new variant: the list scrolls to the selected livery once laid out. */
  private revealSelected = false;
  /** The pool of slots of the current view, and its scope. */
  private pool: ComponentPool<Cell> | null = null;
  private poolRows = false;
  private poolScope: Scope | null = null;
  /** Width of the list's scroll bar, the widest seen (0 until it first shows). */
  private barWidth = 0;
  /** Sizes last given to the tiles: the list measures its content again when they change. */
  private sizes = '';
  /** Rows (the gallery's List view) rather than tiles. */
  private rows = false;

  constructor(scope: Scope, parent: HTMLElement) {
    this.scope = scope;
    const header = el('div', 'msfs-ui-header msfs-ui-gal__livery-header', this.root);
    el('span', 'msfs-ui-title', header).textContent = translate('TT:GENERIC.LIVERY');
    header.appendChild(this.name);
    this.list.setAttribute('direction', 'y');
    this.list.className = 'msfs-ui-gal__livery-list';
    this.root.appendChild(this.list);
    // As the sim's panels: the mouse does not go through the column to the scene (core/theme.ts).
    this.root.setAttribute('data-input-group', 'inputLocker');
    this.root.style.display = 'none';
    scope.append(parent, this.root);

    // Without the setup panel the configurator may still be released (leaving the screen releases it).
    syncConfigurator().catch((error: unknown) => logError('the configurator could not be set', error));
    const reload = () => this.scheduleReload();
    watch(scope, aircraft.Configurator.Details, reload);
    watch(scope, aircraft.CurrentAircraft, reload);
    scope.listen(document, FAVORITE_LIVERIES_CHANGED, reload);
    scope.listen(this.list, 'ui-scroll', () => this.materialize());
    scope.add(() => clearTimeout(this.reloadTimer));
  }

  /** Places the column (called at each layout pass of the gallery), or hides it (null). */
  place(rect: ColumnRect | null): void {
    const style = this.root.style;
    if (!rect) {
      if (style.display !== 'none') style.display = 'none';
      return;
    }
    style.display = '';
    if (rect.list !== this.rows) {
      // Another view: the cells are made again, of the other component.
      this.rows = rect.list;
      this.cellKey = '';
      this.revealSelected = true;
      this.render();
    }
    style.left = `${rect.left}px`;
    style.top = `${rect.top}px`;
    style.width = `${rect.width}px`;
    style.height = `${rect.height}px`;
    // Two tiles per row, in whole pixels. Tiles or rows that fit without scrolling go to the column's right edge, as
    // its header; otherwise the scroll bar and its room are kept (liveryFit: decided on the full width).
    const unit = uiUnit();
    this.barWidth = Math.max(this.barWidth, scrollBarWidth(this.list));
    const sizes = { room: SCROLL_BAR_ROOM * unit, gap: GAP * unit, banner: BANNER_HEIGHT * unit, rowStep: ROW_STEP * unit };
    const fit = liveryFit(rect.width, this.barWidth, sizes, this.cells.length, this.rows, this.list.getBoundingClientRect().height);
    const tile = fit.tile;
    if (this.root.classList.contains('is-full-rows') !== fit.full) toggleClass(this.root, 'is-full-rows', fit.full);
    // Variables written only when they change: a write lays the page out again (core/dom.ts).
    setVariable(style, '--livery-gap', `${fit.gap}px`);
    setVariable(style, '--tile-w', `${tile.width}px`);
    setVariable(style, '--tile-image-h', `${tile.imageHeight}px`);
    setVariable(style, '--tile-h', `${tile.height}px`);
    const measured = `${tile.width}/${tile.height}/${rect.height}`;
    if (measured !== this.sizes) {
      this.sizes = measured;
      if (this.list.updateSizes) this.list.updateSizes();
    }
    this.reveal(this.rows ? ROW_STEP * unit : tile.height + GAP * unit);
    this.materialize();
  }

  // ----- Data -----

  private scheduleReload(): void {
    clearTimeout(this.reloadTimer);
    this.reloadTimer = setTimeout(() => this.reload().catch((error: unknown) => logError('the livery column could not be updated', error)), RELOAD_DELAY_MS);
  }

  private async reload(): Promise<void> {
    const number = ++this.reloadNumber;
    const state = await readConfigurator();
    if (this.scope.disposed || number !== this.reloadNumber) return;
    this.state = state;
    this.render();
  }

  // ----- Rendering -----

  private render(): void {
    const favorites = loadFavoriteLiveries();
    const ordered = orderLiveries(this.state.liveries, (livery) => isFavoriteLivery(livery, favorites), this.order);
    this.order = ordered.order;
    const selected = this.state.liveries.filter((livery) => livery.isSelected)[0];
    this.selectedTitle = selected ? translate(selected.title) : '';
    this.name.textContent = this.selectedTitle;

    const key = ordered.items.map((livery) => livery.id).join('|');
    if (key !== this.cellKey) {
      this.cellKey = key;
      this.build(ordered.items);
      if (ordered.reordered) {
        this.list.scrollToPosition(0);
        this.revealSelected = true;
      }
    } else {
      // Same tiles: selection, availability and bookmarks refreshed in place.
      this.cells.forEach((cell, at) => (cell.livery = ordered.items[at]!));
    }
    const tails = loadLiveryTails();
    for (const cell of this.cells) this.update(cell, favorites, tails);
    this.materialize();
  }

  private build(items: ConfiguratorLivery[]): void {
    // The slots leave the hosts before these go: they wait in the pool's parking for the next list.
    if (this.pool) this.pool.releaseAll();
    if (this.cellScope) this.cellScope.dispose();
    const scope = (this.cellScope = this.scope.child());
    // The sim's list keeps its own structure: its content is emptied child by child.
    for (const cell of this.cells) {
      if (cell.host.parentNode) cell.host.parentNode.removeChild(cell.host);
    }
    this.cells = items.map((livery) => {
      // marquee__trigger: hovering the tile scrolls its texts that are too long, as on the sim's own tiles.
      const host = el('div', this.rows ? 'msfs-ui-gal__row msfs-ui-gal__livery-row marquee__trigger' : 'msfs-ui-gal__tile msfs-ui-gal__livery marquee__trigger');
      this.list.appendChild(host);
      const cell: Cell = { livery, host, slot: null, card: null };
      scope.listen(host, 'mouseenter', () => (this.name.textContent = translate(cell.livery.title)));
      scope.listen(host, 'mouseleave', () => (this.name.textContent = this.selectedTitle));
      return cell;
    });
    if (this.list.updateSizes) this.list.updateSizes();
  }

  /**
   * Keeps components only for the tiles near the visible part of the list (some aircraft have 100 liveries; every tile
   * alive makes each change of layout slower, core/virtual-list.ts). Positions read before any change.
   */
  private materialize(): void {
    if (!this.cellScope || this.cells.length === 0 || this.root.style.display === 'none') return;
    const view = this.list.getBoundingClientRect();
    if (view.height <= 0) return;
    const unit = uiUnit();
    const margins = { create: CREATE_MARGIN * unit, keep: KEEP_MARGIN * unit };
    const actions = this.cells.map((cell) => cellAction(cell.host.getBoundingClientRect(), cell.slot !== null, view, margins));
    this.cells.forEach((cell, at) => {
      if (actions[at] === 'create') this.assign(cell);
      else if (actions[at] === 'destroy') this.release(cell);
    });
  }

  /** The cell gets a slot of the pool (a parked one first) and shows its livery. */
  private assign(cell: Cell): void {
    const slot = this.slotPool().acquire(cell.host, cell);
    cell.slot = slot;
    cell.card = slot.card;
    if (slot.card) this.update(cell, loadFavoriteLiveries(), loadLiveryTails());
    this.readAtcId(cell.livery);
  }

  /** The cell's slot goes back to the pool's parking (the host keeps its place in the list). */
  private release(cell: Cell): void {
    if (cell.slot && this.pool) this.pool.release(cell.slot);
    cell.slot = null;
    cell.card = null;
  }

  /** The pool of the current view (tiles or rows); the other view makes a new one. */
  private slotPool(): ComponentPool<Cell> {
    if (!this.pool || this.poolRows !== this.rows) {
      if (this.poolScope) this.poolScope.dispose();
      const scope = (this.poolScope = this.scope.child());
      const rows = (this.poolRows = this.rows);
      this.pool = new ComponentPool<Cell>(scope, this.root, (slot, slotScope) => this.createSlot(slot, slotScope, rows));
    }
    return this.pool;
  }

  /** A slot's components, made once; they show whatever cell holds the slot. */
  private createSlot(slot: PoolSlot<Cell>, scope: Scope, rows: boolean): void {
    for (const name of TILE_EVENTS) scope.listen(slot.cardHost, name, (event) => event.stopPropagation());
    // The change event redraws this column, the setup panel and the gallery.
    slot.icon = iconToggle(scope, slot.iconHost, 'favorite', (checked) => {
      const cell = slot.item;
      if (cell && cell.slot === slot) setFavoriteLivery(this.state, cell.livery.id, checked);
    });
    createComponent(scope, rows ? COMPONENTS.horizontalTile : COMPONENTS.fleetTile, slot.cardHost).then(
      (card) => {
        if (scope.disposed) return;
        slot.card = card;
        // The icon goes inside the card: the pointer on it keeps the card hovered (the sim does the same with its heart).
        card.element.appendChild(slot.iconHost);
        if (this.pool) this.pool.markReady(slot);
        if (rows) {
          const horizontal = card.manipulator<HorizontalTileManipulator>();
          if (horizontal) horizontal.item = { isOwned: true, isOwnedBySubscription: false, isFavorite: false };
        } else {
          card.set('Distance', '');
        }
        card.onClick(scope, () => {
          const cell = slot.item;
          if (cell && cell.slot === slot) this.choose(cell.livery.id);
        });
        const cell = slot.item;
        if (cell && cell.slot === slot) {
          cell.card = card;
          this.update(cell, loadFavoriteLiveries(), loadLiveryTails());
        }
      },
      (error: unknown) => logError('a livery tile could not be created', error),
    );
  }

  /** Selection, availability, tail number and bookmark of a tile. */
  private update(cell: Cell, favorites: readonly FavoriteLivery[], tails: Record<string, string>): void {
    const { livery, card } = cell;
    // A livery without a folder or a thumbnail cannot be a favourite: no bookmark.
    if (cell.slot) cell.slot.iconHost.style.display = liveryFolder(livery) ? '' : 'none';
    if (card) {
      card.set(this.rows ? 'Image' : 'AircraftImage', livery.imageUrl);
      card.set(this.rows ? 'Title' : 'AircraftName', translate(livery.title));
      card.select(livery.isSelected);
      toggleClass(cell.host, 'is-selected', livery.isSelected);
      card.disable(!!livery.isDisabled);
      card.set(this.rows ? 'Creator' : 'Subtitle', this.tail(livery, tails));
    }
    if (cell.slot && cell.slot.icon) cell.slot.icon.set(isFavoriteLivery(livery, favorites));
  }

  // ----- Tail numbers -----

  private keyOf(livery: ConfiguratorLivery): string {
    return liveryKey(liveryFolder(livery));
  }

  private tail(livery: ConfiguratorLivery, tails: Record<string, string>): string {
    const key = this.keyOf(livery);
    const atcId = this.atcIds.get(key);
    return liveryTail(tails[key], atcId === undefined ? null : atcId, translate(livery.title), TAIL_LENGTH);
  }

  /** Reads the `atc_id` of a livery's livery.cfg once; its tile shows it when it comes. */
  private readAtcId(livery: ConfiguratorLivery): void {
    if (!livery.imageUrl) return;
    const key = this.keyOf(livery);
    if (this.atcIds.has(key)) return;
    this.atcIds.set(key, null);
    fetch(`${liveryDirectory(livery.imageUrl)}/livery.cfg`)
      .then(
        (response) => (response.ok ? response.text() : ''),
        () => '',
      )
      .then((cfg) => {
        const atcId = atcIdFromCfg(cfg);
        if (this.scope.disposed || !atcId) return;
        this.atcIds.set(key, atcId);
        const favorites = loadFavoriteLiveries();
        const tails = loadLiveryTails();
        for (const cell of this.cells) {
          if (this.keyOf(cell.livery) === key) this.update(cell, favorites, tails);
        }
      })
      .catch((error: unknown) => logError('a livery.cfg could not be read', error));
  }

  // ----- Actions -----

  /** A choice the configurator ignored (not on the current aircraft): the column reads it again. */
  private choose(id: string): void {
    chooseLivery(this.state, id).then(
      (done) => (done ? undefined : this.scheduleReload()),
      (error: unknown) => logError('the livery could not be chosen', error),
    );
  }

  /** Once the tiles of a new variant are laid out: the selected livery in view, centred when the list scrolls. */
  private reveal(step: number): void {
    if (!this.revealSelected || this.cells.length === 0) return;
    const height = this.list.getBoundingClientRect().height;
    if (height <= 0) return;
    this.revealSelected = false;
    const at = this.cells.findIndex((cell) => cell.livery.isSelected);
    if (at < 0) return;
    if (this.list.updateSizes) this.list.updateSizes();
    const perRow = this.rows ? 1 : LIVERY_COLUMNS;
    this.list.scrollToPosition(revealPosition(Math.floor(at / perRow), { count: Math.ceil(this.cells.length / perRow), step }, height));
  }
}
