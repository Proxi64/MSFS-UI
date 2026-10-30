// The aircraft gallery and list in the aircraft selection, in place of the sim's grid (right block): search (name,
// publisher, variant), favourites (an aircraft with a favourite livery, first), hidden aircraft (the eye in each aircraft
// tile's corner; the Hidden filter shows them), three views of the same tiles (Gallery, a compact List, and Default:
// the layout of the sim's own grid, two rows of large tiles scrolling horizontally), the sim's sort orders. Made of the
// sim's components. The sim's category tabs stay active: the list read
// (`Game.Aircraft.AircraftList`) is already filtered by category; the search and the favourites filter on top.
// A click sends the page the `tileClick` event of the sim's tiles, a hover `tileHover`: the selection and the header
// of the left column go through the sim's own logic.

import { debounced } from '../../core/async.ts';
import { el, setVariable, toggleClass, uiUnit } from '../../core/dom.ts';
import { iconToggle, type IconToggle } from '../../core/icon-toggle.ts';
import { HEART_SVG, EYE_SLASH_SVG } from '../../core/icons.ts';
import { logError } from '../../core/log.ts';
import type { Scope } from '../../core/scope.ts';
import { cellAction, layoutWidth, type Extent } from '../../core/virtual-list.ts';
import { loadData, saveData } from '../../core/storage.ts';
import type { Settings } from '../../generated/catalog.ts';
import { loadAircraft } from '../../sim/aircraft-loading.ts';
import { ComponentPool, type PoolSlot } from '../../sim/component-pool.ts';
import {
  COMPONENTS,
  createComponent,
  DROPDOWN_ITEM,
  DROPDOWN_PADDING,
  type ComponentGuid,
  type DropdownItem,
  type DropdownManipulator,
  type SimComponent,
} from '../../sim/components.ts';
import { FAVORITE_LIVERIES_CHANGED, loadFavoriteLiveries, saveFavoriteLiveries, type FavoriteLivery } from '../../sim/favorites.ts';
import { HIDDEN_AIRCRAFT_CHANGED, isHidden, loadHidden, saveHidden, withHidden, type HiddenAircraft } from '../../sim/hidden.ts';
import { liveryDirectory, liveryKey } from '../../sim/liveries.ts';
import { isShown, type Manipulator } from '../../sim/screens.ts';
import { scrollBarWidth, type RealScroll } from '../../sim/real-scroll.ts';
import { setLiveriesInGallery, setupPanelShown } from '../../sim/selection-layout.ts';
import { readArray, store, translate, watch } from '../../sim/store.ts';
import { createTextField, type TextField } from '../../sim/text-field.ts';
import { barColumns, columnOf, defaultGrid, settleColumn, WheelColumns, type DefaultGrid } from './default-grid.ts';
import { LiveryColumn, type ColumnRect } from './liveries.ts';
import { AIRCRAFT_COLUMNS, aircraftEdges, aircraftRowWidth, galleryBodyClass, lastColumnSpan, shortCount, splitColumns } from './livery-column.ts';
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
  type Tile,
} from './tiles.ts';

/** The views; `stock` is the Default view (its stored name, from when it showed the sim's own grid). */
type View = 'gallery' | 'list' | 'stock';
/** The axis a view's list scrolls along: Default horizontally, the others vertically. */
type Axis = 'x' | 'y';
type Layout = Settings['aircraftGallery']['layout'];

interface GalleryMemory {
  view: View;
  /** The Favorites filter; never together with `hiddenOnly` (readFilter). */
  favoritesOnly: boolean;
  /** The Hidden filter: only the hidden aircraft (absent before 2.0.0). */
  hiddenOnly?: boolean;
  /** Sort: the id of one of SORTS; absent: the sim's order, unchanged. */
  sort?: { option: string; reversed: boolean } | null;
}

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

/** The sim's horizontal marketplace tile (MarketplaceTileHorizontalManipulator). */
interface HorizontalTileManipulator {
  /**
   * The marketplace item shown. Its hover handler reads `isOwned`; an owned item makes it do nothing more (the mod
   * writes the tile's texts and image itself).
   */
  item?: { isOwned: boolean; isOwnedBySubscription: boolean; isFavorite: boolean };
}

/** Events of the sim's aircraft tiles, sent with their data by the mod; the tiles' own ones carry none. */
const TILE_EVENTS = ['tileClick', 'tileClickDisabled', 'tileHover'];

/** A tile on screen: its host, and its components while near the visible part of the list (core/virtual-list.ts). */
interface Cell {
  tile: Tile;
  host: HTMLElement;
  /** Its slot of the pool while near the view (sim/component-pool.ts). */
  slot: PoolSlot<Cell> | null;
  card: SimComponent | null;
}

/**
 * What a slot of the pool adds to its card for the aircraft tiles: the eye in the corner (hides or brings back the
 * aircraft) next to the heart of the Favorites tiles, and the veil of a hidden aircraft kept for its favourite
 * liveries (a dark layer with a large slashed eye over the thumbnail, a marker only).
 */
interface SlotExtras {
  eye: IconToggle;
  veil: HTMLElement;
}

const MEMORY_KEY = 'AIRCRAFT_GALLERY';
const SORT_ICON = 'coui://html_UI/VFS/components/shared/resources/Icons/General/Sort.svg';
/** Aimed width of a gallery tile, in layout units; the sim's aircraft tile is 360 × 250. */
const TILE_WIDTH = 330;
const TILE_RATIO = 250 / 360;
/** Share of the sim's tile given to its image: its template splits the height 1.4 (image) to 1.2 (text). */
const IMAGE_SHARE = 1.4 / 2.6;
/** Height of the tile's text banner for its three lines of text (21 units each) and 6 units above and below. */
const BANNER_HEIGHT = 75;
/** Components are created for the tiles within this distance of the visible part, and kept within the second, in layout units. */
const CREATE_MARGIN = 300;
const KEEP_MARGIN = 600;
/** Room left on the right of the tiles for the sim's scroll bar, in layout units. */
const SCROLL_BAR_ROOM = 24;
/** The sim's scroll bar until the list's own is measured: 10 pixels at 1440 lines (measured on 1.9.21), in layout units. */
const SCROLL_BAR_WIDTH = 7.5;
/**
 * Room under the Default view's two rows for the sim's horizontal scroll bar, in layout units: its 8 units and the gap
 * above it (the sim's own grid keeps 24 units under its tiles; measured on 1.9.21, 2026-10-30).
 */
const GRID_SCROLL_ROOM = 24;
/**
 * Lowest height given to the Default view's two rows, in layout units. It guards `defaultGrid`'s column loop, which
 * would add columns down to 1-pixel tiles on a tiny height; it is not a rule of the design.
 */
const MIN_GRID_HEIGHT = 2 * (75 + 75) + 24;
/** The bar above the tiles, in layout units: its height and the gap under it (aircraft-gallery.css). */
const BAR_HEIGHT = 36;
const BAR_GAP = 12;
/** Narrowest search before the count drops its total, in layout units (its placeholder's first words stay readable). */
const MIN_SEARCH = 240;
const RELOAD_DELAY_MS = 100;
/** Quiet time after the last scroll of the Default view before it settles on a whole column. */
const SETTLE_DELAY_MS = 150;
/** View tabs (the sim has no keys for Gallery and Default). */
const VIEWS: { view: View; label: string }[] = [
  { view: 'gallery', label: 'Gallery' },
  { view: 'list', label: translate('TT:GENERIC.LIST') },
  { view: 'stock', label: 'Default' },
];
const CONTENT = '[name="PlaneSelection_Content"]';
const RIGHT_BLOCK = '[name="PlaneSelection_Content"] > [name="RightBlock"]';

const aircraft = store.Game.Aircraft;

/**
 * No mouse button held during `event`. Coherent GT has no `buttons` (measured on 1.9.21, 2026-10-30): its `which`, as
 * in WebKit, is 0 when no button is down and the button's number plus one otherwise.
 */
function noButtonHeld(event: MouseEvent): boolean {
  const buttons = (event as { buttons?: unknown }).buttons;
  return typeof buttons === 'number' ? buttons === 0 : event.which === 0;
}

export class Gallery {
  private readonly page: Manipulator;
  private readonly scope: Scope;
  /** The layout chosen in the app (option `layout`). */
  private readonly layoutChoice: Layout;
  /** Side by side layout: the liveries of the current aircraft on the right half (liveries.ts). */
  private liveryColumn: LiveryColumn | null = null;
  private readonly root = el('div', 'msfs-ui-gal');
  private readonly bar = el('div', 'msfs-ui-gal__bar');
  /**
   * The bar's two parts: search, count, Hidden and Favorites; then the sort, its direction and the views. Side by
   * side, each stands above its column (layoutBar); otherwise they make one line.
   */
  private readonly barStart = el('div', 'msfs-ui-gal__bar-part msfs-ui-gal__bar-start', this.bar);
  private readonly barEnd = el('div', 'msfs-ui-gal__bar-part msfs-ui-gal__bar-end', this.bar);
  /** The search's host, first in the bar: it takes what the other controls leave (its width decides the count's form). */
  private readonly searchHost = el('div', 'msfs-ui-gal__control msfs-ui-gal__search', this.barStart);
  /** The count, "shown / total": the total goes when the search would be too narrow (layoutBar). */
  private readonly count = el('span', 'msfs-ui-gal__count');
  private readonly countShown = el('span', '', this.count);
  private readonly countTotal = el('span', 'msfs-ui-gal__count-total', this.count);
  /** Width of the count's total, last measured in the line (layoutBar). */
  private countTotalWidth = 0;
  private readonly body = el('div', 'msfs-ui-gal__body');
  /**
   * The sim's scrolling list, in the body: it holds the tiles (or the empty message). Made for one axis (makeList):
   * Default scrolls along x, Gallery and List along y; another axis makes another list.
   */
  private list!: RealScroll;
  private listAxis: Axis = 'y';
  /** The list's own listener and its place in the body, disposed when the list is replaced. */
  private listScope: Scope | null = null;
  /** What is in the list now: the tiles' hosts (Gallery, List), their column hosts (Default) or the empty message. */
  private listItems: HTMLElement[] = [];

  private search: TextField | null = null;
  private favoritesButton: SimComponent | null = null;
  private hiddenButton: SimComponent | null = null;
  private reverseButton: SimComponent | null = null;
  private sortDropdown: SimComponent | null = null;
  /** The sorts available: SORTS, without the sim's ones it does not offer. */
  private sorts: SortChoice[] = SORTS.filter((sort) => !sort.sim);
  /**
   * The sim's own order: the first of its sort options, not reversed, as its own (disabled) sort dropdown starts.
   * The gallery puts it back when it closes if it sent another one.
   */
  private defaultSimSort = 'TT:MENU.NAME';
  /** The option last sent to `SetAircraftSortingOption`, if any. */
  private sentSimSort: string | null = null;
  private readonly viewTabs = new Map<View, SimComponent>();

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
  /** The eye and veil of each slot of the pool, made with the slot (createSlot). */
  private readonly slotExtras = new WeakMap<PoolSlot<Cell>, SlotExtras>();
  private readonly memory: GalleryMemory = loadMemory();
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
  /**
   * The pool of slots of the current kind of component, and its scope: aircraft tiles (Gallery and Default share it)
   * or List rows.
   */
  private pool: ComponentPool<Cell> | null = null;
  private poolKind: 'tile' | 'row' | null = null;
  private poolScope: Scope | null = null;
  /** The Default view's grid, as last laid out (null until then): its column step places the selected tile. */
  private grid: DefaultGrid | null = null;
  /** The tiles on screen, their scope (disposed when the list changes) and what they were built for. */
  private cells: Cell[] = [];
  private cellScope: Scope | null = null;
  private cellKey = '';
  /** The message shown instead of tiles, if any. */
  private cellEmpty = '';

  constructor(page: Manipulator, scope: Scope, layout: Layout) {
    this.page = page;
    this.scope = scope;
    this.layoutChoice = layout;
  }

  mount(): void {
    const scope = this.scope;
    this.build();
    // The gaps between the tiles must not let the mouse through to the scene (core/theme.ts).
    this.body.setAttribute('data-input-group', 'inputLocker');
    scope.append(this.page.elt, this.root);
    if (this.layoutChoice === 'sideBySide') {
      this.liveryColumn = new LiveryColumn(scope, this.root);
      // The setup panel shows its thumbnails again when the column goes.
      scope.add(() => setLiveriesInGallery(false));
    }
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
      this.materialize();
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
        this.renderSort();
        this.render();
      },
      (error: unknown) => logError('the sort options could not be read', error),
    );
  }

  // ----- Construction -----

  private build(): void {
    this.root.appendChild(this.bar);
    const component = (part: HTMLElement, guid: ComponentGuid, className: string, attributes: Record<string, string>, onReady: (created: SimComponent) => void) => {
      const host = el('div', `msfs-ui-gal__control ${className}`, part);
      createComponent(this.scope, guid, host, attributes).then(
        (created) => {
          if (this.scope.disposed) return;
          onReady(created);
          this.renderBar();
        },
        (error: unknown) => logError(`a control of the gallery could not be created (${guid})`, error),
      );
      return host;
    };

    createTextField(this.scope, this.searchHost, {
      placeholder: 'Search: name, manufacturer, variant',
      onChange: () => {
        this.resetOrder();
        this.render();
        this.scrollToTop();
      },
    }).then(
      (field) => (this.search = field),
      (error: unknown) => logError('the gallery search could not be created', error),
    );
    this.barStart.appendChild(this.count);

    // Hidden and Favorites, each with the mod's icon before its text; never both on.
    component(this.barStart, COMPONENTS.textButtonSmall, 'msfs-ui-gal__filter msfs-ui-gal__hidden', { Text: 'Hidden' }, (button) => {
      this.hiddenButton = button;
      labelIcon(button, EYE_SLASH_SVG);
      button.onClick(this.scope, () => this.setFilter('hidden'));
    });
    component(this.barStart, COMPONENTS.textButtonSmall, 'msfs-ui-gal__filter msfs-ui-gal__favorites', { Text: 'Favorites' }, (button) => {
      this.favoritesButton = button;
      labelIcon(button, HEART_SVG);
      button.onClick(this.scope, () => this.setFilter('favorites'));
    });
    component(this.barEnd, COMPONENTS.dropdown, 'msfs-ui-gal__sort', {}, (dropdown) => {
      this.sortDropdown = dropdown;
      const manipulator = dropdown.manipulator<DropdownManipulator>();
      if (manipulator) manipulator.setEmptyTitle(translate('TT:GENERIC.SORT_BY'));
      this.renderSort();
    });
    component(this.barEnd, COMPONENTS.iconButtonSquared, 'msfs-ui-gal__reverse', { Icon: SORT_ICON }, (button) => {
      this.reverseButton = button;
      button.onClick(this.scope, () => {
        if (!this.memory.sort) return;
        this.memory.sort.reversed = !this.memory.sort.reversed;
        this.saveMemory();
        this.resetOrder();
        this.applySort();
        this.renderSort();
        this.render();
        this.scrollToTop();
      });
    });
    for (const { view, label } of VIEWS) {
      component(this.barEnd, COMPONENTS.textTab, 'msfs-ui-gal__view', { Text: label }, (tab) => {
        this.viewTabs.set(view, tab);
        tab.onClick(this.scope, () => this.setView(view));
      });
    }
    this.root.appendChild(this.body);
    this.makeList(axisOf(this.memory.view));
  }

  /**
   * The sim's scrolling list for `axis`, in the body (`<real-scroll direction="x">` scrolls as the vertical one,
   * measured on 1.9.21, 2026-10-30). The previous list goes with its content: the pool's slots are parked first
   * (clearCells), so they survive it.
   */
  private makeList(axis: Axis): void {
    if (this.listScope) this.listScope.dispose();
    const scope = (this.listScope = this.scope.child());
    const list = document.createElement('real-scroll') as RealScroll;
    list.setAttribute('direction', axis);
    list.className = 'msfs-ui-gal__list';
    scope.append(this.body, list);
    // The sim's list scrolls itself (wheel, scroll bar): the tiles coming into view get their components.
    scope.listen(list, 'ui-scroll', () => this.materialize());
    this.list = list;
    this.listAxis = axis;
    if (axis === 'x') this.keepWholeColumns(scope, list);
  }

  /**
   * Default only: the list rests on whole columns. The wheel moves whole columns instead of the sim's own step (a third
   * of a column: 187 pixels of 548 at 1440 lines, measured on 1.9.21, 2026-10-30): one per notch of a mouse wheel, the
   * small deltas of a touchpad adding up (WheelColumns), each notch going on from the column the previous ones aimed at
   * while the list still moves. A scroll that ends between columns (the bar dragged) settles on the nearest one 150 ms
   * after the last `ui-scroll` or wheel event; while a mouse button that went down in the gallery is held, it waits for
   * the release: a `mouseup` on the window (where the sim's own drags end), or the first move that reports no button
   * held (a release the page never got).
   */
  private keepWholeColumns(scope: Scope, list: RealScroll): void {
    const wheel = new WheelColumns();
    /** The column the wheel aims at while the list moves; null once it settles (the next notch starts from where it is). */
    let target: number | null = null;
    let held = false;
    const settle = () => {
      wheel.reset();
      target = null;
      this.settle(list);
    };
    const quiet = debounced(() => {
      if (!held) settle();
    }, SETTLE_DELAY_MS);
    scope.add(quiet.cancel);
    const release = () => {
      if (!held) return;
      held = false;
      quiet.cancel();
      settle();
    };
    // The body is an input group: a press on the bar or a tile arrives here (capture: before the sim's list handles it).
    scope.listen(
      this.body,
      'mousedown',
      () => {
        held = true;
      },
      true,
    );
    scope.listen(window, 'mouseup', release, true);
    scope.listen(document, 'mousemove', (event) => {
      if (held && noButtonHeld(event)) release();
    });
    scope.listen(
      this.body,
      'wheel',
      (event) => {
        event.preventDefault();
        event.stopPropagation();
        quiet.call();
        const columns = wheel.add(event.deltaY || event.deltaX, event.deltaMode);
        const step = this.columnStep();
        if (!columns || !step) return;
        if (list.updateSizes) list.updateSizes();
        const max = list.maxScroll || 0;
        const from = target !== null ? target : Math.round(settleColumn(list.currentScroll || 0, step, max) / step);
        target = Math.max(0, Math.min(Math.ceil(max / step), from + columns));
        this.scrollToColumn(target);
      },
      true,
    );
    scope.listen(list, 'ui-scroll', quiet.call);
  }

  /** The list on the whole column nearest to where it is (or at its end), when it is not on one. */
  private settle(list: RealScroll): void {
    const step = this.columnStep();
    if (!step || this.list !== list) return;
    if (list.updateSizes) list.updateSizes();
    const at = list.currentScroll || 0;
    const to = settleColumn(at, step, list.maxScroll || 0);
    if (to !== at) this.scrollTo(to);
  }

  /** A column's step in the Default view: the tile's width and the gap, in pixels (0 before the grid is laid out). */
  private columnStep(): number {
    return this.grid ? this.grid.tileWidth + this.grid.gap : 0;
  }

  /** Scrolls the Default view to column `column` (the list's end when that is nearer), measuring its sizes again first. */
  private scrollToColumn(column: number): void {
    const step = this.columnStep();
    if (!step) return;
    if (this.list.updateSizes) this.list.updateSizes();
    this.scrollTo(settleColumn(Math.max(0, column) * step, step, this.list.maxScroll || 0));
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

  private renderSort(): void {
    const sort = this.memory.sort;
    const dropdown = this.sortDropdown;
    if (dropdown) {
      const manipulator = dropdown.manipulator<DropdownManipulator>();
      const items: DropdownItem[] = this.sorts.map((choice) => ({
        title: choice.label(),
        subtitle: '',
        coma: '',
        selectedCallback: () => this.chooseSort(choice.id),
      }));
      const choice = this.sortChoice();
      const current = choice ? items[this.sorts.indexOf(choice)] : undefined;
      if (manipulator) manipulator.setData(items, current);
      // The list's height, in layout units (sim/components.ts).
      dropdown.set('List_Size', String(Math.max(1, items.length) * DROPDOWN_ITEM + DROPDOWN_PADDING));
    }
    if (this.reverseButton) {
      this.reverseButton.select(!!sort && sort.reversed);
      this.reverseButton.disable(!sort);
    }
  }

  private chooseSort(option: string): void {
    this.memory.sort = { option, reversed: this.memory.sort ? this.memory.sort.reversed : false };
    this.saveMemory();
    this.resetOrder();
    this.applySort();
    this.renderSort();
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
    this.scrollTo(0);
  }

  /** Scrolls the sim's list along its axis (its sizes are measured again first: the tiles may have just changed). */
  private scrollTo(position: number): void {
    if (this.list.updateSizes) this.list.updateSizes();
    this.list.scrollToPosition(Math.max(0, Math.min(position, this.list.maxScroll || 0)));
    this.materialize();
  }

  /** The sim's grid redraws its tiles (their selection): it kept the one it had when the gallery covered it. */
  private refreshStockGrid(): void {
    const content = this.page.elt.querySelector(CONTENT) as (HTMLElement & { manipulator?: { updateAircraftList?: () => void } }) | null;
    if (content && content.manipulator && content.manipulator.updateAircraftList) content.manipulator.updateAircraftList();
  }

  // ----- Layout -----

  /**
   * On the sim's right block (`RightBlock`), hidden (its grid and search): the gallery covers it whole. Side by side:
   * the list on the left half, the livery column on the right half, 12 units apart. Default: the grid (layoutGrid).
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
    if (this.memory.view === 'stock') {
      this.layoutGrid(rect, unit);
      return;
    }
    // Side by side: three aircraft and two liveries per row, all of the same width (livery-column.ts).
    const gap = Math.round(12 * unit);
    const halves = this.liveryColumn ? splitColumns(Math.round(rect.width), gap, SCROLL_BAR_ROOM * unit, 6 * unit) : null;
    toggleClass(this.body, 'is-side-by-side', !!halves);
    setStyle(this.body.style, 'width', halves ? `${halves.left}px` : '');
    // Gallery tiles in whole pixels: --columns per row, 6 units on each side, in the list's width less the room kept
    // before the scroll bar, and less the bar's own width when the tiles do not fit without it (core/virtual-list.ts:
    // decided on the full width, so the bar cannot make the tiles swing between two sizes).
    const tileAt = (listWidth: number) => {
      const room = Math.floor(listWidth - SCROLL_BAR_ROOM * unit);
      const columns = halves ? AIRCRAFT_COLUMNS : Math.max(2, Math.floor(room / (TILE_WIDTH * unit)));
      const width = Math.floor(room / columns - 12 * unit);
      // The image keeps the sim's tile proportions; the text banner below only takes its three lines.
      const image = Math.round(width * TILE_RATIO * IMAGE_SHARE);
      return { columns, width, image, height: image + Math.round(BANNER_HEIGHT * unit) };
    };
    // The vertical list's bar only (a horizontal one, between two views, is as wide as the grid).
    if (this.listAxis === 'y') this.barUnits = Math.max(this.barUnits, scrollBarWidth(this.list) / unit);
    const barWidth = Math.round(this.barUnits * unit);
    // The tiles the Gallery view shows or would show (one per row of the List view): both views keep their edges.
    const tiles = this.cells.length;
    const fit = layoutWidth(
      halves ? halves.left : Math.round(rect.width),
      barWidth,
      (listWidth) => {
        const tile = tileAt(listWidth);
        return Math.ceil(tiles / tile.columns) * (tile.height + 12 * unit);
      },
      this.list.getBoundingClientRect().height,
    );
    const tile = tileAt(fit.width);
    // List rows: one width whether the list scrolls or not (the bar's room kept; its width measured once it shows).
    const rowWidth = aircraftRowWidth(halves ? halves.left : Math.round(rect.width), SCROLL_BAR_ROOM * unit, barWidth || Math.round(SCROLL_BAR_WIDTH * unit));
    // The rows on the tiles' edges (the bar does not move between the two views).
    const edges = aircraftEdges(tile, 6 * unit, rowWidth);
    setVariable(style, '--aircraft-row-x', `${edges.left}px`);
    setVariable(style, '--aircraft-row-w', `${edges.rowRight - edges.left}px`);
    setVariable(style, '--tile-w', `${tile.width}px`);
    setVariable(style, '--tile-image-h', `${tile.image}px`);
    setVariable(style, '--tile-h', `${tile.height}px`);
    // Classic: the bar on one line from the first tile's left edge to the last one's right edge, as the rows (measured on
    // 1.9.21, 2026-10-30 at 1920 x 1080: it ran from the list's edge over the scroll bar's room, 6 and 40 pixels off).
    setStyle(this.bar.style, 'marginLeft', halves ? '' : `${edges.left}px`);
    setStyle(this.bar.style, 'width', halves ? '' : `${edges.right - edges.left}px`);
    // Side by side, the bar's first part on the aircraft tiles' edges (Hidden and Favorites over the last column), its
    // second on the livery column.
    this.layoutBar(halves ? { start: edges, filters: lastColumnSpan(tile, 6 * unit), end: { left: halves.left + gap, width: halves.right } } : null, unit);
    if (halves) {
      const top = Math.round(this.body.getBoundingClientRect().top - rect.top);
      this.placeLiveries({ left: halves.left + gap, top, width: halves.right, height: Math.round(rect.height) - top, list: this.memory.view === 'list' });
    } else {
      this.placeLiveries(null);
    }
  }

  /**
   * The Default view on the right block `rect`: the bar on one line, then two rows of tiles (default-grid.ts) from 12
   * units under it down to the sim's scroll bar, whose bottom is the block's (the left panel's). The bar, the list and
   * its scroll bar are as wide as the grid's whole columns, from the block's left edge. No livery column. Written only
   * when a value changes (every 250 ms). A new column width keeps the first column in view in its place: the block
   * widens or narrows after a change of view (measured on 1.9.21, 2026-10-30: from List side by side, 1774 pixels wide
   * for about a second, then 1614), which would leave the list between two columns.
   */
  private layoutGrid(rect: DOMRect, unit: number): void {
    const height = Math.max(MIN_GRID_HEIGHT * unit, rect.height - (BAR_HEIGHT + BAR_GAP + GRID_SCROLL_ROOM) * unit);
    const previous = this.grid;
    const grid = (this.grid = defaultGrid(Math.round(rect.width), Math.floor(height), unit));
    const style = this.root.style;
    setVariable(style, '--grid-tile-w', `${grid.tileWidth}px`);
    setVariable(style, '--grid-tile-h', `${grid.tileHeight}px`);
    setVariable(style, '--grid-image-h', `${grid.imageHeight}px`);
    setVariable(style, '--grid-gap', `${grid.gap}px`);
    if (this.body.classList.contains('is-side-by-side')) toggleClass(this.body, 'is-side-by-side', false);
    setStyle(this.body.style, 'width', `${grid.gridWidth}px`);
    setStyle(this.bar.style, 'marginLeft', '');
    setStyle(this.bar.style, 'width', `${grid.gridWidth}px`);
    // Once the list has its new width: its last scroll position depends on it.
    if (previous && previous.tileWidth + previous.gap !== this.columnStep() && this.listAxis === 'x') {
      this.scrollToColumn(Math.round((this.list.currentScroll || 0) / (previous.tileWidth + previous.gap)));
    }
    this.layoutGridBar(grid, unit);
    this.placeLiveries(null);
  }

  /**
   * The Default view's bar over the grid's columns (`barColumns`): the search and count over the first column,
   * Hidden, Favorites and the sort dropdown over the middle ones, the sort's direction and the view tabs over the last,
   * the grid's gap between the parts (aircraft-gallery.css, is-columns). The bar's two elements keep their controls:
   * the first (search, count, Hidden, Favorites) ends on Favorites, the second begins with the dropdown, whose width
   * takes it to the middle part's right edge; the tabs share what the direction leaves. Measured widths, written only
   * when they change. On one line when the columns are too few or too narrow.
   */
  private layoutGridBar(grid: DefaultGrid, unit: number): void {
    const spans = barColumns(grid, unit);
    const hidden = this.bar.querySelector<HTMLElement>('.msfs-ui-gal__hidden');
    const favorites = this.bar.querySelector<HTMLElement>('.msfs-ui-gal__favorites');
    const sort = this.bar.querySelector<HTMLElement>('.msfs-ui-gal__sort');
    if (!spans || !hidden || !favorites || !sort) {
      this.layoutBar(null, unit);
      return;
    }
    if (this.bar.classList.contains('is-split')) toggleClass(this.bar, 'is-split', false);
    if (!this.bar.classList.contains('is-columns')) toggleClass(this.bar, 'is-columns', true);
    this.placeFilters(null, unit);
    // Hidden starts the middle part (the gap before it is its margin): the first element ends with Favorites.
    const filters = Math.round(favorites.getBoundingClientRect().right - hidden.getBoundingClientRect().left);
    const startWidth = spans.middle.left + filters;
    setStyle(this.barStart.style, 'marginLeft', '');
    setStyle(this.barStart.style, 'width', `${startWidth}px`);
    setStyle(this.barEnd.style, 'marginLeft', '');
    setStyle(this.barEnd.style, 'width', `${grid.gridWidth - startWidth}px`);
    const sortMargin = Math.round(sort.getBoundingClientRect().left - this.barEnd.getBoundingClientRect().left);
    setStyle(sort.style, 'width', `${Math.max(0, spans.middle.right - startWidth - sortMargin)}px`);
    // The tabs in whole pixels after the direction, the last one taking the rest: shared by the engine, they ended a
    // pixel past the last column (measured at 3440 x 1440, 2026-10-30).
    const reverse = this.bar.querySelector<HTMLElement>('.msfs-ui-gal__reverse');
    const tabs = Array.prototype.slice.call(this.bar.querySelectorAll('.msfs-ui-gal__view')) as HTMLElement[];
    if (reverse && tabs.length > 0) {
      const margin = Math.round(6 * unit);
      const room = Math.floor(this.bar.getBoundingClientRect().left + spans.last.right - reverse.getBoundingClientRect().right) - tabs.length * margin;
      const each = Math.floor(room / tabs.length);
      tabs.forEach((tab, at) => {
        setStyle(tab.style, 'marginLeft', `${margin}px`);
        setStyle(tab.style, 'width', `${at === tabs.length - 1 ? room - each * (tabs.length - 1) : each}px`);
      });
    }
    this.fitCount(unit);
  }

  /**
   * The bar's two parts, in pixels from the gallery's left edge. Side by side (`split`): the first from the first
   * aircraft tile's left edge to the last one's right edge (or the rows' edges), not over the scroll bar, Hidden and
   * Favorites over the last column of tiles (`filters`, placeFilters) and the search and count over the others; the
   * second above the livery column, from its left edge to its right one (the sort dropdown takes what the other
   * controls leave, aircraft-gallery.css). Otherwise one line. The count drops its total when the search would be too
   * narrow. Written only when a value changes (every 250 ms).
   */
  private layoutBar(
    split: { start: { left: number; right: number }; filters: { left: number; right: number; gap: number }; end: { left: number; width: number } } | null,
    unit: number,
  ): void {
    if (this.bar.classList.contains('is-split') !== !!split) toggleClass(this.bar, 'is-split', !!split);
    if (this.bar.classList.contains('is-columns')) toggleClass(this.bar, 'is-columns', false);
    // What the Default view's bar writes (layoutGridBar) goes back to the CSS.
    const sort = this.bar.querySelector<HTMLElement>('.msfs-ui-gal__sort');
    if (sort) setStyle(sort.style, 'width', '');
    Array.prototype.forEach.call(this.bar.querySelectorAll('.msfs-ui-gal__view'), (tab: HTMLElement) => {
      setStyle(tab.style, 'marginLeft', '');
      setStyle(tab.style, 'width', '');
    });
    setStyle(this.barStart.style, 'marginLeft', split ? `${split.start.left}px` : '');
    setStyle(this.barStart.style, 'width', split ? `${split.start.right - split.start.left}px` : '');
    setStyle(this.barEnd.style, 'marginLeft', split ? `${split.end.left - split.start.right}px` : '');
    setStyle(this.barEnd.style, 'width', split ? `${split.end.width}px` : '');
    this.placeFilters(split ? { width: split.filters.right - split.filters.left, gap: split.filters.gap } : null, unit);
    this.fitCount(unit);
  }

  /**
   * Hidden and Favorites side by side in `width` pixels, `gap` pixels after the count (the tiles' gap): they end the
   * bar's first part, so the search and count fill the columns before. Halves of the width in whole pixels, Favorites
   * taking the rest; null: their CSS widths and margins.
   */
  private placeFilters(span: { width: number; gap: number } | null, unit: number): void {
    const hidden = this.bar.querySelector<HTMLElement>('.msfs-ui-gal__hidden');
    const favorites = this.bar.querySelector<HTMLElement>('.msfs-ui-gal__favorites');
    if (!hidden || !favorites) return;
    const margin = Math.round(6 * unit);
    const half = span ? Math.floor((span.width - margin) / 2) : 0;
    setStyle(hidden.style, 'marginLeft', span ? `${span.gap}px` : '');
    setStyle(hidden.style, 'width', span ? `${half}px` : '');
    setStyle(favorites.style, 'marginLeft', span ? `${margin}px` : '');
    setStyle(favorites.style, 'width', span ? `${span.width - margin - half}px` : '');
  }

  /** The count drops its total when the search would be too narrow (written only when it changes). */
  private fitCount(unit: number): void {
    const shortNow = this.count.classList.contains('is-short');
    const room = this.searchHost.getBoundingClientRect().width + this.count.getBoundingClientRect().width;
    // The total's width as measured in the line: out of the flow its leading space collapses (6 pixels less), which
    // would make the count swing between its two forms at the edge.
    if (!shortNow) this.countTotalWidth = this.countTotal.getBoundingClientRect().width;
    const short = shortCount(room, this.countShown.getBoundingClientRect().width + this.countTotalWidth, MIN_SEARCH * unit);
    if (shortNow !== short) toggleClass(this.count, 'is-short', short);
  }

  /** The livery column placed or hidden, and the setup panel told (it drops its thumbnails while the column shows). */
  private placeLiveries(rect: ColumnRect | null): void {
    if (!this.liveryColumn) return;
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
      readArray<AircraftItem>(aircraft.AircraftList),
      aircraft.CurrentAircraft() as Promise<{ variationId: string; thumbnailPath: string } | null>,
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

  /** Views, Hidden and Favorites; the sort dropdown is redrawn only when the sort changes (renderSort). */
  private renderBar(): void {
    const view = this.memory.view;
    const filter = readFilter(this.memory);
    this.viewTabs.forEach((tab, key) => tab.select(key === view));
    if (this.hiddenButton) this.hiddenButton.select(filter === 'hidden');
    if (this.favoritesButton) this.favoritesButton.select(filter === 'favorites');
  }

  /**
   * The tiles of the current view: the same in the three views (tiles.ts), laid out by the view. Gallery and List: one
   * host per tile in the list; Default: one column host per two tiles (column-major, as the sim's grid), in a list that
   * scrolls along x (a change of axis replaces the list first, its tiles parked).
   */
  private render(): void {
    const view = this.memory.view;
    const axis = axisOf(view);
    if (axis !== this.listAxis) {
      this.clearCells();
      this.cellKey = '';
      this.cellEmpty = '';
      this.makeList(axis);
      // The body's class at once: the layout pass below measures the new list's scroll bar, which the grid's class
      // would stretch to the whole width (aircraft-gallery.css).
      this.body.className = this.bodyClass(view);
    }
    this.renderBar();
    this.layout();

    // Favourites always come first, whatever the sort (the sim's included), as they were when the order was set; a
    // hidden aircraft among them stays, veiled, until the order is set again, and one whose livery is given a heart since
    // shows at once, veiled, in its place (keptAircraftIds).
    if (this.favoriteIds === null && this.items.length > 0) this.favoriteIds = favoriteAircraftIds(this.items, this.favoriteLiveries);
    accumulateKept(this.keptIds, keptAircraftIds(this.favoriteIds, this.items, this.favoriteLiveries));
    const filter = readFilter(this.memory);
    const search = this.search ? this.search.value : '';
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
    this.setCount(String(tiles.length), ` / ${this.items.length}`);
    // The aircraft under the mouse has left (hidden, filtered out): the left column's header shows the selected one again.
    const hovered = this.hoveredId;
    if (hovered !== null && !tiles.some((tile) => tile.item.aircraftId === hovered)) this.hover(null);
    const key = `${view}|${tiles.map((tile) => `${tile.item.variationId}:${tile.livery ? tile.livery.dir : ''}`).join(',')}`;
    const empty =
      tiles.length > 0
        ? ''
        : emptyMessage(filter, { favorites: this.favoriteLiveries.length, hidden: this.hidden.length, searching: normalize(search) !== '' });
    if (key === this.cellKey && empty === this.cellEmpty) {
      // Same tiles: their texts, images and state are refreshed in place (the set of tiles is unchanged).
      this.cells.forEach((cell, at) => {
        cell.tile = tiles[at]!;
        this.fillCell(cell, view !== 'list');
        this.updateCell(cell);
      });
      return;
    }
    this.cellKey = key;
    this.cellEmpty = empty;
    const scroll = this.list.currentScroll || 0;
    this.clearCells();
    const grid = view === 'stock';
    this.body.className = this.bodyClass(view);
    if (empty) {
      const message = el('div', 'msfs-ui-gal__empty');
      message.textContent = empty;
      this.list.appendChild(message);
      this.listItems.push(message);
      return;
    }
    const scope = (this.cellScope = this.scope.child());
    let column: HTMLElement | null = null;
    for (let at = 0; at < tiles.length; at++) {
      const tile = tiles[at]!;
      // marquee__trigger: hovering the tile scrolls its texts that are too long, as on the sim's own tiles.
      const host = el('div', `${view === 'list' ? 'msfs-ui-gal__row' : 'msfs-ui-gal__tile'} marquee__trigger`);
      if (grid) {
        // Two tiles per column, the first on top: a new column for every first one.
        if (columnOf(at).row === 0 || !column) {
          column = el('div', 'msfs-ui-gal__column', this.list);
          this.listItems.push(column);
        }
        column.appendChild(host);
      } else {
        this.list.appendChild(host);
        this.listItems.push(host);
      }
      const cell: Cell = { tile, host, slot: null, card: null };
      scope.listen(host, 'mouseenter', () => this.hover(cell.tile.item));
      scope.listen(host, 'mouseleave', () => this.hover(null));
      this.cells.push(cell);
    }
    this.scrollTo(scroll);
  }

  /** The body's class for a view: Default is the grid (`is-grid`), never side by side. */
  private bodyClass(view: View): string {
    return view === 'stock' ? galleryBodyClass('grid', false) : galleryBodyClass(view, this.liveryColumn !== null);
  }

  private clearCells(): void {
    // The slots leave the hosts before these go: they wait in the pool's parking for the next list.
    if (this.pool) this.pool.releaseAll();
    if (this.cellScope) this.cellScope.dispose();
    this.cellScope = null;
    this.cells = [];
    for (const item of this.listItems) {
      if (item.parentNode) item.parentNode.removeChild(item);
    }
    this.listItems = [];
  }

  /**
   * Keeps components only for the tiles near the visible part of the list, as the sim's own grid does: every tile alive
   * makes each change of layout slower (core/virtual-list.ts). Along the list's axis: Default's tiles come into view
   * from the sides. The positions are all read before any change, so the engine lays the page out once.
   */
  private materialize(): void {
    if (!this.cellScope || this.cells.length === 0) return;
    const extent = this.listAxis === 'x' ? (rect: DOMRect): Extent => ({ top: rect.left, bottom: rect.right }) : (rect: DOMRect): Extent => rect;
    const body = extent(this.list.getBoundingClientRect());
    if (body.bottom - body.top <= 0) return;
    const unit = uiUnit();
    const margins = { create: CREATE_MARGIN * unit, keep: KEEP_MARGIN * unit };
    const actions = this.cells.map((cell) => cellAction(extent(cell.host.getBoundingClientRect()), cell.slot !== null, body, margins));
    this.cells.forEach((cell, at) => {
      if (actions[at] === 'create') this.assignCell(cell);
      else if (actions[at] === 'destroy') this.releaseCell(cell);
    });
  }

  /** The cell gets a slot of the pool (a parked one first) and shows its tile. */
  private assignCell(cell: Cell): void {
    const slot = this.slotPool().acquire(cell.host, cell);
    cell.slot = slot;
    cell.card = slot.card;
    if (slot.card) {
      this.fillCell(cell, this.memory.view !== 'list');
      this.updateCell(cell);
    }
  }

  /** The cell's slot goes back to the pool's parking (the host keeps its place in the list). */
  private releaseCell(cell: Cell): void {
    if (cell.slot && this.pool) this.pool.release(cell.slot);
    cell.slot = null;
    cell.card = null;
  }

  /**
   * The pool of the current kind of component: the aircraft tiles of Gallery and Default (one pool for both: their
   * slots move from one view to the other) or the List rows; another kind makes a new one.
   */
  private slotPool(): ComponentPool<Cell> {
    const kind = this.memory.view === 'list' ? 'row' : 'tile';
    if (!this.pool || this.poolKind !== kind) {
      if (this.poolScope) this.poolScope.dispose();
      const scope = (this.poolScope = this.scope.child());
      this.poolKind = kind;
      this.pool = new ComponentPool<Cell>(scope, this.root, (slot, slotScope) => this.createSlot(slot, slotScope, kind === 'tile'));
    }
    return this.pool;
  }

  /** A slot's components, made once; they show whatever cell holds the slot (`gallery`: an aircraft tile, else a row). */
  private createSlot(slot: PoolSlot<Cell>, scope: Scope, gallery: boolean): void {
    // The sim's tiles send tileClick / tileHover themselves, without data (the mod writes their texts itself): those
    // are stopped here, the mod sends its own with the aircraft (select, hover).
    for (const name of TILE_EVENTS) {
      scope.listen(slot.cardHost, name, (event) => {
        if ((event as CustomEvent).detail === undefined || (event as CustomEvent).detail === null) event.stopPropagation();
      });
    }
    // A Favorites tile's heart is full: a click removes the favourite livery the tile stands for.
    slot.icon = iconToggle(scope, slot.iconHost, 'favorite', () => {
      const cell = slot.item;
      if (cell && cell.slot === slot && cell.tile.livery) this.removeFavoriteLivery(cell.tile.livery);
    });
    slot.icon.set(true);
    // An aircraft tile's eye, in the same corner: a click hides the aircraft, or brings it back when it is hidden.
    const eye = iconToggle(scope, slot.iconHost, 'hidden', () => {
      const cell = slot.item;
      if (cell && cell.slot === slot && !cell.tile.livery) this.toggleHidden(cell.tile.item);
    });
    const veil = el('div', 'msfs-ui-gal__veil');
    veil.innerHTML = EYE_SLASH_SVG;
    veil.style.display = 'none';
    this.slotExtras.set(slot, { eye, veil });
    createComponent(scope, gallery ? COMPONENTS.fleetTile : COMPONENTS.horizontalTile, slot.cardHost).then(
      (card) => {
        if (scope.disposed) return;
        slot.card = card;
        // The veil and the icons go inside the card, the icons last (above the veil): the pointer on them keeps the
        // card hovered (the sim does the same with its WishlistBlock).
        card.element.appendChild(veil);
        card.element.appendChild(slot.iconHost);
        if (this.pool) this.pool.markReady(slot);
        if (!gallery) {
          const horizontal = card.manipulator<HorizontalTileManipulator>();
          if (horizontal) horizontal.item = { isOwned: true, isOwnedBySubscription: false, isFavorite: false };
        }
        card.onClick(scope, () => {
          const cell = slot.item;
          if (!cell || cell.slot !== slot) return;
          const { item, livery } = cell.tile;
          if (livery) this.selectLivery(item, livery);
          else this.select(item);
        });
        const cell = slot.item;
        if (cell && cell.slot === slot) {
          cell.card = card;
          this.fillCell(cell, gallery);
          this.updateCell(cell);
        }
      },
      (error: unknown) => logError('a gallery tile could not be created', error),
    );
  }

  /** Texts and image of a tile, as the sim's own aircraft tile writes them. */
  private fillCell(cell: Cell, gallery: boolean): void {
    const card = cell.card;
    if (!card) return;
    const { item, livery } = cell.tile;
    const details = livery
      ? [livery.variation ? translate(livery.variation) : '', translate(livery.title)]
      : [item.isModular ? translate(item.variation) : ''];
    const subtitle = details.filter((part) => !!part).join(' · ');
    const image = livery ? livery.image : item.thumbnailPath;
    // Some publishers' names end with a space, which would double the gap before the studio.
    const name = item.displayName.trim();
    const creator = item.creator.trim();
    if (gallery) {
      card.set('AircraftImage', image);
      // Three lines: the name, the variant (and livery), the studio in the tile's third line (Distance, shown by the
      // CSS); the studio moves up when there is no variant.
      card.set('AircraftName', name);
      card.set('Subtitle', subtitle || creator);
      card.set('Distance', subtitle ? creator : '');
      if (subtitle && creator) cell.host.classList.add('has-third-line');
      else cell.host.classList.remove('has-third-line');
    } else {
      card.set('Image', image);
      card.set('Title', name);
      const parts = [creator].concat(details).filter((part) => !!part).map((part) => part.trim());
      // One line: the name in bold, then "- studio - variant (- livery)" in the tile's light second text. Side by side
      // (a narrower list): two lines, the name, then "studio · variant (· livery)" (aircraft-gallery.css).
      card.set('Creator', this.liveryColumn ? parts.join(' · ') : parts.map((part) => `- ${part}`).join(' '));
    }
  }

  /**
   * Selection, availability, icon and veil of a tile. A favourite livery tile (Favorites) has the heart (it removes
   * the favourite); an aircraft tile has the eye, on when the aircraft is hidden. A hidden aircraft kept for its
   * favourite liveries is veiled, in both kinds of tile.
   */
  private updateCell(cell: Cell): void {
    const { item, livery } = cell.tile;
    if (cell.card) {
      const selected = livery ? livery.variationId === this.current.variationId && livery.dir === this.current.livery : item.isSelected;
      cell.card.select(selected);
      toggleClass(cell.host, 'is-selected', selected);
      cell.card.disable(!item.isUsable);
    }
    const slot = cell.slot;
    const extras = slot ? this.slotExtras.get(slot) : undefined;
    if (slot && slot.icon && extras) {
      slot.icon.element.style.display = livery ? '' : 'none';
      extras.eye.element.style.display = livery ? 'none' : '';
      extras.eye.set(isHidden(this.hidden, item));
      extras.veil.style.display = cell.tile.veiled ? '' : 'none';
    }
  }

  /**
   * Scrolls to the selected aircraft when it is not wholly in view. Default: its column first in view, on a whole
   * column (or the last scroll position, when the list ends before); elsewhere a little above its row.
   */
  private scrollToSelected(): void {
    this.scope.timeout(() => {
      const at = this.cells.map((cell) => cell.tile.item.isSelected && !cell.tile.livery).indexOf(true);
      const selected = this.cells[at];
      if (!selected) return;
      const body = this.list.getBoundingClientRect();
      const rect = selected.host.getBoundingClientRect();
      if (this.listAxis === 'x') {
        if (this.grid && (rect.left < body.left || rect.right > body.right)) this.scrollToColumn(columnOf(at).column);
      } else if (rect.top < body.top || rect.bottom > body.bottom) {
        this.scrollTo(this.list.currentScroll + rect.top - body.top - 8 * uiUnit());
      }
      this.materialize();
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
    loadAircraft(livery.variationId, { livery: { dir: livery.dir, title: livery.title, image: livery.image }, usedAt: 0 })
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

  /** The count's two texts, written only when they change. */
  private setCount(shown: string, total: string): void {
    if (this.countShown.textContent !== shown) this.countShown.textContent = shown;
    if (this.countTotal.textContent !== total) this.countTotal.textContent = total;
  }

  private saveMemory(): void {
    saveData(MEMORY_KEY, this.memory);
  }
}

/** The axis a view scrolls along: Default (`stock`) horizontally, as the sim's grid; Gallery and List vertically. */
function axisOf(view: View): Axis {
  return view === 'stock' ? 'x' : 'y';
}

/** The gallery's memory; the `lastView` of 2.0.1's development builds (a filter clicked in the sim's grid) is dropped. */
function loadMemory(): GalleryMemory {
  const memory = loadData<GalleryMemory & { lastView?: unknown }>(MEMORY_KEY, { view: 'gallery', favoritesOnly: false });
  delete memory.lastView;
  return memory;
}

/** Sets a style property only when its value changes. */
function setStyle(style: CSSStyleDeclaration, property: 'marginLeft' | 'width', value: string): void {
  if (style[property] !== value) style[property] = value;
}

/**
 * The mod's icon before the text of one of the sim's text buttons, in its content row (it takes the text's colour in
 * every state of the button). The row's own Text, not the one of the shortcut block it also holds.
 */
function labelIcon(button: SimComponent, svg: string): void {
  const content = button.element.querySelector('[name="Content"]');
  if (!content) return;
  const text = Array.prototype.filter.call(content.children, (child: Element) => child.getAttribute('name') === 'Text')[0] as Element | undefined;
  if (!text) return;
  const icon = el('span', 'msfs-ui-gal__label-icon');
  icon.innerHTML = svg;
  content.insertBefore(icon, text);
}
