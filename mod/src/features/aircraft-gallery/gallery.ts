// The aircraft gallery and list in the aircraft selection, in place of the sim's grid (right block): search (name,
// publisher, variant), favourites (an aircraft with a favourite livery, first), hidden aircraft (the eye in each aircraft
// tile's corner; the Hidden filter shows them), three views of the same tiles (Gallery, a compact List, and Showcase:
// the layout of the sim's own grid, two rows of large tiles scrolling horizontally), the sim's sort orders. Made of the
// sim's components: the bar (gallery-bar.ts), the list of tiles (gallery-cells.ts), the Showcase view's whole columns
// (default-columns.ts). The sim's category tabs stay active: the list read (`Game.Aircraft.AircraftList`) is already
// filtered by category; the search and the favourites filter on top.
// A click sends the page the `tileClick` event of the sim's tiles, a hover `tileHover`: the selection and the header
// of the left column go through the sim's own logic.

import { answerWithin } from '../../core/async.ts';
import { el, setStyle, setVariable, uiUnit } from '../../core/dom.ts';
import { logError } from '../../core/log.ts';
import type { Scope } from '../../core/scope.ts';
import { PANEL_INPUT_GROUP } from '../../core/theme.ts';
import { layoutWidth } from '../../core/virtual-list.ts';
import { loadData, saveData } from '../../core/storage.ts';
import { loadAircraft } from '../../sim/aircraft-loading.ts';
import { FAVORITE_LIVERIES_CHANGED, loadFavoriteLiveries, saveFavoriteLiveries, type FavoriteLivery } from '../../sim/favorites.ts';
import { HIDDEN_AIRCRAFT_CHANGED, isHidden, loadHidden, saveHidden, withHidden, type HiddenAircraft } from '../../sim/hidden.ts';
import { liveryDirectory, liveryKey } from '../../sim/liveries.ts';
import { isShown, type Manipulator } from '../../sim/screens.ts';
import { scrollBarWidth } from '../../sim/real-scroll.ts';
import { setLiveriesInGallery, setupPanelShown } from '../../sim/selection-layout.ts';
import { translate } from '../../sim/localization.ts';
import { ANSWER_TIMEOUT_MS, readArray, store, watch } from '../../sim/store.ts';
import { DefaultColumns } from './default-columns.ts';
import { columnOf, defaultGrid } from './default-grid.ts';
import { GalleryBar, type SortView } from './gallery-bar.ts';
import { axisOf, GalleryCells, type View } from './gallery-cells.ts';
import { LiveryColumn, type ColumnRect } from './liveries.ts';
import { galleryMemoryFrom, type GalleryMemory } from './memory.ts';
import { AIRCRAFT_COLUMNS, aircraftEdges, aircraftRowWidth, aircraftTileSize, galleryBodyClass, lastColumnSpan, splitColumns } from './livery-column.ts';
import {
  accumulateKept,
  emptyMessage,
  favoriteAircraftIds,
  favoritesFirst,
  keptAircraftIds,
  normalize,
  readFilter,
  sortTiles,
  toggleFilter,
  visibleTiles,
  type AircraftItem,
  type LocalSort,
} from './tiles.ts';

/**
 * The sorts offered, in this order. Name and Studio are made by the mod on the tiles (the sim offers neither); Max Range is the sim's (`SetAircraftSortingOption`, "!" prefix for the reverse order), offered
 * when the sim has it: it reorders `AircraftList`, which the gallery and the sim's grid both read.
 */
interface SortChoice {
  id: string;
  label: () => string;
  local?: LocalSort;
  sim?: string;
}
const SORTS: SortChoice[] = [
  // The displayed name (manufacturer and model), in natural order.
  { id: 'name', label: () => translate('TT:MENU.NAME'), local: 'name' },
  // The user's word for the publisher (the sim's key says "Creator").
  { id: 'studio', label: () => 'Studio', local: 'studio' },
  { id: 'maxRange', label: () => translate('TT:MENU.ACPROPUI_MAX_RANGE'), sim: 'TT:MENU.ACPROPUI_MAX_RANGE' },
];

const MEMORY_KEY = 'AIRCRAFT_GALLERY';
/**
 * Around the tiles, in layout units (aircraft-gallery.css): TILE_SIDE on each side of a tile, TILE_GAP under each row;
 * the side by side layout's two columns TILE_GAP apart.
 */
const TILE_SIDE = 6;
const TILE_GAP = 12;
/** Room left on the right of the tiles for the sim's scroll bar, in layout units. */
const SCROLL_BAR_ROOM = 24;
/** The sim's scroll bar until the list's own is measured: 10 pixels at 1440 lines (measured on 1.9.21), in layout units. */
const SCROLL_BAR_WIDTH = 7.5;
/**
 * Room under the Showcase view's two rows for the sim's horizontal scroll bar, in layout units: its 8 units and the gap
 * above it (the sim's own grid keeps 24 units under its tiles; measured on 1.9.21, 2026-10-30).
 */
const GRID_SCROLL_ROOM = 24;
/**
 * Lowest height given to the Showcase view's two rows, in layout units. It guards `defaultGrid`'s column loop, which
 * would add columns down to 1-pixel tiles on a tiny height; it is not a rule of the design.
 */
const MIN_GRID_HEIGHT = 2 * (75 + 75) + 24;
/** The bar above the tiles, in layout units: its height and the gap under it (aircraft-gallery.css). */
const BAR_HEIGHT = 36;
const BAR_GAP = 12;
const RELOAD_DELAY_MS = 100;
const CONTENT = '[name="PlaneSelection_Content"]';
const RIGHT_BLOCK = '[name="PlaneSelection_Content"] > [name="RightBlock"]';

const aircraft = store.Game.Aircraft;

export class Gallery {
  private readonly page: Manipulator;
  private readonly scope: Scope;
  /** The liveries of the current aircraft, on the right half in Gallery and List (liveries.ts); made by mount(), after the bar and the body. */
  private liveryColumn!: LiveryColumn;
  private readonly root = el('div', 'msfs-ui-root msfs-ui-gal');
  private readonly bar: GalleryBar;
  private readonly body = el('div', 'msfs-ui-gal__body');
  private readonly cells: GalleryCells;
  private readonly columns: DefaultColumns;

  /** The sorts available: SORTS, without the sim's ones it does not offer. */
  private sorts: SortChoice[] = SORTS.filter((sort) => !sort.sim);
  /**
   * The sim's own order: the first of its sort options, not reversed, as its own (disabled) sort dropdown starts.
   * The gallery puts it back when it closes if it sent another one.
   */
  private defaultSimSort = 'TT:MENU.NAME';
  /** The option last sent to `SetAircraftSortingOption`, if any. */
  private sentSimSort: string | null = null;

  private items: AircraftItem[] = [];
  /** Favourite liveries (their hearts: setup panel, livery column, Favorites tiles): an aircraft that has some is a favourite. */
  private favoriteLiveries: FavoriteLivery[] = loadFavoriteLiveries();
  /**
   * The favourite aircraft put first (`aircraftId`), as they were when the order was set: kept while the screen stays,
   * so that a heart clicked does not move the tiles; set again on a new sort, search or filter (resetOrder).
   */
  private favoriteIds: number[] | null = null;
  /** The hidden aircraft shown veiled since the order was set (the union of keptAircraftIds at each drawing): one stays even when its last favourite livery goes. */
  private keptIds: number[] = [];
  /** The aircraft hidden by the user (their eye): out of the gallery, unless kept veiled for their favourite liveries. */
  private hidden: HiddenAircraft[] = loadHidden();
  /** The aircraft under the mouse (`aircraftId`), whose name the left column's header shows; null: the selected one. */
  private hoveredId: number | null = null;
  private readonly memory: GalleryMemory = galleryMemoryFrom(loadData<unknown>(MEMORY_KEY, null));
  /** Current aircraft (variant and livery, as `liveryKey`): selection of the livery tiles. */
  private current = { variationId: '', livery: '' };
  private loading = false;
  private reloadTimer: ReturnType<typeof setTimeout> | undefined;
  private reloadNumber = 0;

  /**
   * Width of the list's scroll bar, the widest seen (0 until it first shows), in layout units: a change of resolution
   * in the session changes its pixels (10 at 1440 lines, 20 at 2160).
   */
  private barUnits = 0;

  constructor(page: Manipulator, scope: Scope) {
    this.page = page;
    this.scope = scope;
    this.bar = new GalleryBar(
      scope,
      { view: () => this.memory.view, filter: () => readFilter(this.memory), sort: () => this.sortView() },
      {
        search: () => {
          this.resetOrder();
          this.render();
          this.scrollToTop();
        },
        filter: (clicked) => this.setFilter(clicked),
        reverse: () => this.reverseSort(),
        view: (view) => this.setView(view),
        sort: (id) => this.chooseSort(id),
      },
    );
    this.cells = new GalleryCells(
      scope,
      this.root,
      this.body,
      {
        view: () => this.memory.view,
        current: () => this.current,
        hidden: () => this.hidden,
        bodyClass: (view) => this.bodyClass(view),
        listMade: (listScope, list, axis) => {
          if (axis === 'x') this.columns.keep(listScope, list);
        },
      },
      {
        select: (item) => this.select(item),
        selectLivery: (item, livery) => this.selectLivery(item, livery),
        toggleHidden: (item) => this.toggleHidden(item),
        removeFavoriteLivery: (livery) => this.removeFavoriteLivery(livery),
        hover: (item) => this.hover(item),
      },
    );
    this.columns = new DefaultColumns(this.cells, this.body);
  }

  mount(): void {
    const scope = this.scope;
    this.build();
    // The gaps between the tiles must not let the mouse through to the scene (core/theme.ts).
    this.body.setAttribute('data-input-group', PANEL_INPUT_GROUP);
    scope.append(this.page.elt, this.root);
    this.liveryColumn = new LiveryColumn(scope, this.root);
    // The setup panel shows its thumbnails again when the column goes.
    scope.add(() => setLiveriesInGallery(false));
    // The sim's grid, hidden while the gallery shows, kept a stale selection: it is refreshed, then shown again.
    scope.add(() => {
      this.refreshStockGrid();
      this.showStockGrid(true);
    });
    // Every change to the sim is undone: the sim's list gets its own order back.
    scope.add(() => {
      if (this.sentSimSort !== null && this.sentSimSort !== this.defaultSimSort) this.sendSimSort(this.defaultSimSort);
    });
    this.layout();
    scope.interval(() => {
      this.layout();
      this.cells.materialize();
    }, 250);

    const reload = () => this.scheduleReload();
    watch(scope, aircraft.AircraftList, reload);
    // Another category tab is another list: its favourites are put first again.
    watch(scope, aircraft.FilteredCategory, () => {
      this.resetOrder();
      reload();
    });
    watch(scope, aircraft.CurrentAircraft, reload);
    scope.add(() => clearTimeout(this.reloadTimer));
    // Heart of a livery (setup panel, livery column, a Favorites tile): the Favorites tiles may change.
    scope.listen(document, FAVORITE_LIVERIES_CHANGED, () => {
      this.favoriteLiveries = loadFavoriteLiveries();
      if (this.items.length > 0) this.render();
    });
    // An eye clicked: the aircraft leaves (or comes back); the list keeps its scroll, the next tiles close the gap.
    scope.listen(document, HIDDEN_AIRCRAFT_CHANGED, () => {
      this.hidden = loadHidden();
      if (this.items.length > 0) this.render();
    });
    // Sort: the sim's options decide which of its sorts are offered, then the remembered sort is applied (the sim's
    // list reloads, the gallery follows). A remembered sort that is no longer offered is forgotten.
    aircraft.GetAircraftSortingOptions.request('').then(
      (options: unknown) => {
        if (scope.disposed) return;
        const offered = Array.isArray(options) ? (options as string[]) : [];
        if (typeof offered[0] === 'string' && offered[0]) this.defaultSimSort = offered[0];
        this.sorts = SORTS.filter((sort) => !sort.sim || offered.indexOf(sort.sim) >= 0);
        if (this.memory.sort && !this.sortChoice()) this.memory.sort = null;
        this.applySort();
        this.bar.renderSort();
        this.render();
      },
      (error: unknown) => logError('the sort options could not be read', error),
    );
  }

  // ----- Construction -----

  private build(): void {
    this.root.appendChild(this.bar.element);
    this.bar.build();
    this.root.appendChild(this.body);
    this.cells.makeList(axisOf(this.memory.view));
  }

  /** Favorites or Hidden clicked, in any view: that filter on and the other off, or off again; a new list starts from its start. */
  private setFilter(clicked: 'favorites' | 'hidden'): void {
    const filter = toggleFilter(readFilter(this.memory), clicked);
    this.memory.favoritesOnly = filter === 'favorites';
    this.memory.hiddenOnly = filter === 'hidden';
    this.saveMemory();
    this.resetOrder();
    this.render();
    this.scrollToTop();
  }

  /** Another view: the same tiles in its layout, the selected one in view. */
  private setView(view: View): void {
    this.memory.view = view;
    this.saveMemory();
    this.render();
    this.scrollToSelected();
  }

  // ----- Sort -----
  // The sort is the sim's (`SetAircraftSortingOption`, "!" prefix for the reverse order): it reorders `AircraftList`,
  // which the gallery and the sim's grid both read.

  /** The remembered sort, when it is offered (0.3.0 stored the sim's option keys: they are still read). */
  private sortChoice(): SortChoice | undefined {
    const sort = this.memory.sort;
    if (sort && sort.option === 'TT:MENU.NAME') sort.option = 'name';
    return sort ? this.sorts.filter((choice) => choice.id === sort.option || choice.sim === sort.option)[0] : undefined;
  }

  /** The sorts as the bar's dropdown shows them. */
  private sortView(): SortView {
    const choices = this.sorts.map((choice) => ({ id: choice.id, label: choice.label() }));
    const choice = this.sortChoice();
    return { choices, current: choice ? this.sorts.indexOf(choice) : -1, sort: this.memory.sort || null };
  }

  /**
   * The sim's sorts are applied to its list; the mod's are applied when the tiles are drawn (render), and the sim's
   * list goes back to its own order so that it is not left on another sort (the sim's grid shows it again once the mod
   * unloads).
   */
  private applySort(): void {
    const sort = this.memory.sort;
    const choice = this.sortChoice();
    if (!sort || !choice) return;
    this.sendSimSort(choice.sim ? `${sort.reversed ? '!' : ''}${choice.sim}` : this.defaultSimSort);
  }

  private sendSimSort(option: string): void {
    this.sentSimSort = option;
    aircraft.SetAircraftSortingOption.request(option).catch((error: unknown) => logError('the aircraft could not be sorted', error));
  }

  private chooseSort(option: string): void {
    this.memory.sort = { option, reversed: this.memory.sort ? this.memory.sort.reversed : false };
    this.sortChanged();
  }

  /** The sort's direction button: the other direction, when a sort is chosen. */
  private reverseSort(): void {
    if (!this.memory.sort) return;
    this.memory.sort.reversed = !this.memory.sort.reversed;
    this.sortChanged();
  }

  private sortChanged(): void {
    this.saveMemory();
    this.resetOrder();
    this.applySort();
    this.bar.renderSort();
    this.render();
    this.scrollToTop();
  }

  /** The favourites put first are taken again at the next drawing (a new sort, search or filter). */
  private resetOrder(): void {
    this.favoriteIds = null;
    this.keptIds = [];
  }

  /** A new order starts from its first aircraft. */
  private scrollToTop(): void {
    this.cells.scrollTo(0);
  }

  /** The sim's grid redraws its tiles (their selection): it kept the one it had when the gallery covered it. */
  private refreshStockGrid(): void {
    const content = this.page.elt.querySelector(CONTENT) as (HTMLElement & { manipulator?: { updateAircraftList?: () => void } }) | null;
    if (content && content.manipulator && content.manipulator.updateAircraftList) content.manipulator.updateAircraftList();
  }

  // ----- Layout -----

  /**
   * On the sim's right block (`RightBlock`), hidden (its grid and search): the gallery covers it whole. Gallery and List:
   * the list on the left half, the livery column on the right half, 12 units apart. Showcase: the grid (layoutGrid).
   */
  private layout(): void {
    const right = this.page.elt.querySelector<HTMLElement>(RIGHT_BLOCK);
    if (!isShown(this.page.elt.querySelector(CONTENT)) || !right) {
      this.root.style.display = 'none';
      this.placeLiveries(null);
      return;
    }
    this.showStockGrid(false);
    const origin = this.page.elt.getBoundingClientRect();
    const rect = right.getBoundingClientRect();
    const unit = uiUnit();
    const style = this.root.style;
    style.display = '';
    style.left = `${rect.left - origin.left}px`;
    style.width = `${rect.width}px`;
    style.top = `${rect.top - origin.top}px`;
    style.height = `${rect.height}px`;
    if (this.memory.view === 'showcase') {
      this.layoutGrid(rect, unit);
      return;
    }
    // Side by side: three aircraft and two liveries per row, all of the same width (livery-column.ts).
    const gap = Math.round(TILE_GAP * unit);
    const halves = splitColumns(Math.round(rect.width), gap, SCROLL_BAR_ROOM * unit, TILE_SIDE * unit);
    setStyle(this.body.style, 'width', `${halves.left}px`);
    // Gallery tiles in whole pixels: --columns per row, 6 units on each side, in the list's width less the room kept
    // before the scroll bar, and less the bar's own width when the tiles do not fit without it (core/virtual-list.ts:
    // decided on the full width, so the bar cannot make the tiles swing between two sizes).
    const tileLayout = { room: SCROLL_BAR_ROOM * unit, unit, columns: AIRCRAFT_COLUMNS };
    const tileAt = (listWidth: number) => aircraftTileSize(listWidth, tileLayout);
    // The vertical list's bar only (a horizontal one, between two views, is as wide as the grid).
    if (this.cells.axis === 'y') this.barUnits = Math.max(this.barUnits, scrollBarWidth(this.cells.list) / unit);
    const barWidth = Math.round(this.barUnits * unit);
    // The tiles the Gallery view shows or would show (one per row of the List view): both views keep their edges.
    const tiles = this.cells.count;
    const fit = layoutWidth(
      halves.left,
      barWidth,
      (listWidth) => {
        const tile = tileAt(listWidth);
        return Math.ceil(tiles / tile.columns) * (tile.height + TILE_GAP * unit);
      },
      this.cells.list.getBoundingClientRect().height,
    );
    const tile = tileAt(fit.width);
    // List rows: one width whether the list scrolls or not (the bar's room kept; its width measured once it shows).
    const rowWidth = aircraftRowWidth(halves.left, SCROLL_BAR_ROOM * unit, barWidth || Math.round(SCROLL_BAR_WIDTH * unit));
    // The rows on the tiles' edges (the bar does not move between the two views).
    const edges = aircraftEdges(tile, TILE_SIDE * unit, rowWidth);
    setVariable(style, '--aircraft-row-x', `${edges.left}px`);
    setVariable(style, '--aircraft-row-w', `${edges.rowRight - edges.left}px`);
    setVariable(style, '--tile-w', `${tile.width}px`);
    setVariable(style, '--tile-image-h', `${tile.image}px`);
    setVariable(style, '--tile-h', `${tile.height}px`);
    // The bar's first part on the aircraft tiles' edges (Hidden and Favorites over the last column), its second on the
    // livery column.
    this.bar.placeWidth('');
    this.bar.layout({ start: edges, filters: lastColumnSpan(tile, TILE_SIDE * unit), end: { left: halves.left + gap, width: halves.right } }, unit);
    const top = Math.round(this.body.getBoundingClientRect().top - rect.top);
    this.placeLiveries({ left: halves.left + gap, top, width: halves.right, height: Math.round(rect.height) - top, list: this.memory.view === 'list' });
  }

  /**
   * The Showcase view on the right block `rect`: the bar on one line, then two rows of tiles (default-grid.ts) from 12
   * units under it down to the sim's scroll bar, whose bottom is the block's (the left panel's). The bar, the list and
   * its scroll bar are as wide as the grid's whole columns, from the block's left edge. No livery column. Written only
   * when a value changes (every 250 ms). A new column width keeps the first column in view in its place: the block
   * widens or narrows after a change of view (measured on 1.9.21, 2026-10-30: from List side by side, 1774 pixels wide
   * for about a second, then 1614), which would leave the list between two columns.
   */
  private layoutGrid(rect: DOMRect, unit: number): void {
    const height = Math.max(MIN_GRID_HEIGHT * unit, rect.height - (BAR_HEIGHT + BAR_GAP + GRID_SCROLL_ROOM) * unit);
    const grid = defaultGrid(Math.round(rect.width), Math.floor(height), unit);
    const previous = this.columns.setGrid(grid);
    const style = this.root.style;
    setVariable(style, '--grid-tile-w', `${grid.tileWidth}px`);
    setVariable(style, '--grid-tile-h', `${grid.tileHeight}px`);
    setVariable(style, '--grid-image-h', `${grid.imageHeight}px`);
    setVariable(style, '--grid-gap', `${grid.gap}px`);
    setStyle(this.body.style, 'width', `${grid.gridWidth}px`);
    this.bar.placeWidth(`${grid.gridWidth}px`);
    // Once the list has its new width: its last scroll position depends on it.
    if (previous && previous.tileWidth + previous.gap !== this.columns.step() && this.cells.axis === 'x') {
      this.columns.scrollToColumn(Math.round((this.cells.list.currentScroll || 0) / (previous.tileWidth + previous.gap)));
    }
    this.bar.layoutGrid(grid, unit);
    this.placeLiveries(null);
  }

  /** The livery column placed or hidden, and the setup panel told (it drops its thumbnails while the column shows). */
  private placeLiveries(rect: ColumnRect | null): void {
    this.liveryColumn.place(rect);
    setLiveriesInGallery(rect !== null);
  }

  private showStockGrid(show: boolean): void {
    const right = this.page.elt.querySelector<HTMLElement>(RIGHT_BLOCK);
    if (right && right.style.visibility !== (show ? '' : 'hidden')) right.style.visibility = show ? '' : 'hidden';
  }

  // ----- Data -----

  private scheduleReload(): void {
    clearTimeout(this.reloadTimer);
    this.reloadTimer = setTimeout(() => this.reload().catch((error: unknown) => logError('the gallery could not be updated', error)), RELOAD_DELAY_MS);
  }

  private async reload(): Promise<void> {
    const number = ++this.reloadNumber;
    const first = this.items.length === 0;
    const [items, current] = await Promise.all([
      readArray<AircraftItem>(aircraft.AircraftList, 'the aircraft list'),
      answerWithin(aircraft.CurrentAircraft() as Promise<{ variationId: string; thumbnailPath: string } | null>, ANSWER_TIMEOUT_MS, 'the current aircraft'),
    ]);
    if (this.scope.disposed || number !== this.reloadNumber) return;
    this.items = items.filter((item) => !!item);
    this.current = {
      variationId: current ? current.variationId : '',
      livery: current && current.thumbnailPath ? liveryKey(liveryDirectory(current.thumbnailPath)) : '',
    };
    this.render();
    if (first) this.scrollToSelected();
  }

  // ----- Rendering -----

  /**
   * The tiles of the current view: the same in the three views (tiles.ts), laid out by the view. Gallery and List: one
   * host per tile in the list; Showcase: one column host per two tiles (column-major, as the sim's grid), in a list that
   * scrolls along x (a change of axis replaces the list first, its tiles parked).
   */
  private render(): void {
    const view = this.memory.view;
    const axis = axisOf(view);
    if (axis !== this.cells.axis) {
      this.cells.remake(axis);
      // The body's class at once: the layout pass below measures the new list's scroll bar, which the grid's class
      // would stretch to the whole width (aircraft-gallery.css).
      this.body.className = this.bodyClass(view);
    }
    this.bar.render();
    this.layout();

    // Favourites always come first, whatever the sort (the sim's included), as they were when the order was set; a
    // hidden aircraft among them stays, veiled, until the order is set again, and one whose livery is given a heart since
    // shows at once, veiled, in its place (keptAircraftIds).
    if (this.favoriteIds === null && this.items.length > 0) this.favoriteIds = favoriteAircraftIds(this.items, this.favoriteLiveries);
    accumulateKept(this.keptIds, keptAircraftIds(this.favoriteIds, this.items, this.favoriteLiveries));
    const filter = readFilter(this.memory);
    const search = this.bar.searchValue();
    const shown = visibleTiles({
      items: this.items,
      liveries: this.favoriteLiveries,
      favoritesOnly: filter === 'favorites',
      hiddenOnly: filter === 'hidden',
      hidden: this.hidden,
      keepIds: this.keptIds,
      search,
      translate,
    });
    const choice = this.sortChoice();
    const sorted = choice && choice.local ? sortTiles(shown, choice.local, !!this.memory.sort && this.memory.sort.reversed) : shown;
    const tiles = favoritesFirst(sorted, this.favoriteIds || []);
    // The tiles shown (veiled ones included) out of the aircraft of the category tab.
    this.bar.setCount(String(tiles.length), ` / ${this.items.length}`);
    // The aircraft under the mouse has left (hidden, filtered out): the left column's header shows the selected one again.
    const hovered = this.hoveredId;
    if (hovered !== null && !tiles.some((tile) => tile.item.aircraftId === hovered)) this.hover(null);
    const empty =
      tiles.length > 0
        ? ''
        : emptyMessage(filter, { favorites: this.favoriteLiveries.length, hidden: this.hidden.length, searching: normalize(search) !== '' });
    this.cells.draw(view, tiles, empty);
  }

  /** The body's class for a view: Showcase is the grid (`is-grid`), never side by side. */
  private bodyClass(view: View): string {
    return galleryBodyClass(view === 'showcase' ? 'grid' : view);
  }

  /**
   * Scrolls to the selected aircraft when it is not wholly in view. Showcase: its column first in view, on a whole
   * column (or the last scroll position, when the list ends before); elsewhere a little above its row.
   */
  private scrollToSelected(): void {
    this.scope.timeout(() => {
      const selected = this.cells.selectedTile();
      if (!selected) return;
      const list = this.cells.list;
      const body = list.getBoundingClientRect();
      const rect = selected.host.getBoundingClientRect();
      if (this.cells.axis === 'x') {
        if (rect.left < body.left || rect.right > body.right) this.columns.scrollToColumn(columnOf(selected.at).column);
      } else if (rect.top < body.top || rect.bottom > body.bottom) {
        this.cells.scrollTo(list.currentScroll + rect.top - body.top - 8 * uiUnit());
      }
      this.cells.materialize();
    }, 50);
  }

  // ----- Actions -----

  /** As a click on a tile of the sim: the page does `SetAircraftForConfigurator`. */
  private select(item: AircraftItem): void {
    if (!item.isUsable) return;
    this.page.elt.dispatchEvent(new CustomEvent('tileClick', { detail: item, bubbles: true }));
  }

  /** Favourite livery tile: the aircraft, its variant and this livery (same loading as Free Flight). */
  private selectLivery(item: AircraftItem, livery: FavoriteLivery): void {
    if (!item.isUsable || this.loading) return;
    this.loading = true;
    loadAircraft(livery.variationId, { dir: livery.dir, title: livery.title, image: livery.image })
      .catch((error: unknown) => logError(`${item.displayName} could not be loaded`, error))
      .then(() => {
        this.loading = false;
      });
  }

  /**
   * An aircraft's eye: hidden, or back when it was. Only the mod's list changes: the selected aircraft stays the sim's
   * (nothing goes to the configurator). The gallery redraws on the event of the hidden aircraft.
   */
  private toggleHidden(item: AircraftItem): void {
    const next = withHidden(this.hidden, item, !isHidden(this.hidden, item));
    if (next) saveHidden(next);
  }

  /** The setup panel and the gallery redraw on the event of the favourite liveries. */
  private removeFavoriteLivery(livery: FavoriteLivery): void {
    saveFavoriteLiveries(this.favoriteLiveries.filter((candidate) => candidate !== livery));
  }

  /**
   * As a hover on a tile of the sim: the header of the left column shows this aircraft. Not while the setup panel
   * covers that column: it shows the selected aircraft (the configurator's), whose name the header keeps; and the sim
   * would load, at every tile passing under the mouse while scrolling, statistics that the panel hides.
   */
  private hover(item: AircraftItem | null): void {
    this.hoveredId = item ? item.aircraftId : null;
    if (setupPanelShown()) return;
    const content = this.page.elt.querySelector(CONTENT);
    if (content) content.dispatchEvent(new CustomEvent('tileHover', { detail: item, bubbles: true }));
  }

  private saveMemory(): void {
    saveData(MEMORY_KEY, this.memory);
  }
}
