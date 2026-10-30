// The aircraft gallery and list in the aircraft selection, in place of the sim's grid (right block): search (name,
// publisher, variant), favourites (an aircraft with a favourite livery, first), gallery or compact list, the sim's sort orders, and a button back to the
// sim's own grid. Made of the sim's components. The sim's category tabs stay active: the list read
// (`Game.Aircraft.AircraftList`) is already filtered by category; the search and the favourites filter on top.
// A click sends the page the `tileClick` event of the sim's tiles, a hover `tileHover`: the selection and the header
// of the left column go through the sim's own logic.

import { el, setVariable, toggleClass, uiUnit } from '../../core/dom.ts';
import { iconToggle } from '../../core/icon-toggle.ts';
import { logError } from '../../core/log.ts';
import type { Scope } from '../../core/scope.ts';
import { cellAction, layoutWidth } from '../../core/virtual-list.ts';
import { loadData, saveData } from '../../core/storage.ts';
import type { Settings } from '../../generated/catalog.ts';
import { loadAircraft } from '../../sim/aircraft-loading.ts';
import { ComponentPool, type PoolSlot } from '../../sim/component-pool.ts';
import { COMPONENTS, createComponent, type ComponentGuid, type SimComponent } from '../../sim/components.ts';
import { FAVORITE_LIVERIES_CHANGED, loadFavoriteLiveries, saveFavoriteLiveries, type FavoriteLivery } from '../../sim/favorites.ts';
import { liveryDirectory, liveryKey } from '../../sim/liveries.ts';
import { isShown, type Manipulator } from '../../sim/screens.ts';
import { scrollBarWidth, type RealScroll } from '../../sim/real-scroll.ts';
import { setLiveriesInGallery, setupPanelShown } from '../../sim/selection-layout.ts';
import { readArray, store, translate, watch } from '../../sim/store.ts';
import { createTextField, type TextField } from '../../sim/text-field.ts';
import { LiveryColumn, type ColumnRect } from './liveries.ts';
import { AIRCRAFT_COLUMNS, galleryBodyClass, splitColumns } from './livery-column.ts';
import { favoriteAircraftIds, favoritesFirst, sortTiles, visibleTiles, type AircraftItem, type LocalSort, type Tile } from './tiles.ts';

type View = 'gallery' | 'list' | 'stock';
type Layout = Settings['aircraftGallery']['layout'];

interface GalleryMemory {
  view: View;
  favoritesOnly: boolean;
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

/** The sim's dropdown (DropdownManipulator): items are `{ title, selectedCallback }`. */
interface DropdownItem {
  title: string;
  subtitle: string;
  coma: string;
  selectedCallback: (item: DropdownItem) => void;
}
interface DropdownManipulator {
  setData(items: DropdownItem[], current?: DropdownItem): void;
  /** Title shown without a current item (the template has a placeholder text). */
  setEmptyTitle(title: string): void;
}

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
const RELOAD_DELAY_MS = 100;
/** View tabs (the sim has no keys for Gallery and Default). */
const VIEWS: { view: View; label: string }[] = [
  { view: 'gallery', label: 'Gallery' },
  { view: 'list', label: translate('TT:GENERIC.LIST') },
  { view: 'stock', label: 'Default' },
];
const CONTENT = '[name="PlaneSelection_Content"]';
const RIGHT_BLOCK = '[name="PlaneSelection_Content"] > [name="RightBlock"]';

const aircraft = store.Game.Aircraft;

export class Gallery {
  private readonly page: Manipulator;
  private readonly scope: Scope;
  /** The layout chosen in the app (option `layout`). */
  private readonly layoutChoice: Layout;
  /** Side by side layout: the liveries of the current aircraft on the right half (liveries.ts). */
  private liveryColumn: LiveryColumn | null = null;
  private readonly root = el('div', 'msfs-ui-gal');
  private readonly bar = el('div', 'msfs-ui-gal__bar');
  private readonly count = el('span', 'msfs-ui-gal__count');
  private readonly body = el('div', 'msfs-ui-gal__body');
  /** The sim's scrolling list, in the body: it holds the tiles (or the empty message). */
  private readonly list = document.createElement('real-scroll') as RealScroll;
  /** What is in the list now: the tiles' hosts or the empty message. */
  private listItems: HTMLElement[] = [];

  private search: TextField | null = null;
  private favoritesButton: SimComponent | null = null;
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
  /** Favourite liveries (their bookmarks: setup panel, livery column, Favorites tiles): an aircraft that has some is a favourite. */
  private favoriteLiveries: FavoriteLivery[] = loadFavoriteLiveries();
  /**
   * The favourite aircraft put first (`aircraftId`), as they were when the order was set: kept while the screen stays,
   * so that a bookmark clicked does not move the tiles; set again on a new sort, search or filter (resetOrder).
   */
  private favoriteIds: number[] | null = null;
  private readonly memory: GalleryMemory = loadData<GalleryMemory>(MEMORY_KEY, { view: 'gallery', favoritesOnly: false });
  /** Current aircraft (variant and livery, as `liveryKey`): selection of the livery tiles. */
  private current = { variationId: '', livery: '' };
  private loading = false;
  private reloadTimer: ReturnType<typeof setTimeout> | undefined;
  private reloadNumber = 0;

  /** Width of the list's scroll bar, the widest seen (0 until it first shows). */
  private barWidth = 0;
  /** The pool of slots of the current view, and its scope. */
  private pool: ComponentPool<Cell> | null = null;
  private poolView: View | null = null;
  private poolScope: Scope | null = null;
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
    scope.add(() => this.showStockGrid(true));
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
    // Bookmark of a livery (setup panel, livery column, a Favorites tile): the Favorites tiles may change.
    scope.listen(document, FAVORITE_LIVERIES_CHANGED, () => {
      this.favoriteLiveries = loadFavoriteLiveries();
      if (this.items.length > 0) this.render();
    });
    // The sim's list scrolls itself (wheel, scroll bar): the tiles coming into view get their components.
    scope.listen(this.list, 'ui-scroll', () => this.materialize());

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
    const component = (guid: ComponentGuid, className: string, attributes: Record<string, string>, onReady: (created: SimComponent) => void) => {
      const host = el('div', `msfs-ui-gal__control ${className}`, this.bar);
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

    const searchHost = el('div', 'msfs-ui-gal__control msfs-ui-gal__search', this.bar);
    createTextField(this.scope, searchHost, {
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
    this.bar.appendChild(this.count);

    component(COMPONENTS.textButtonSmall, 'msfs-ui-gal__favorites', { Text: 'Favorites' }, (button) => {
      this.favoritesButton = button;
      button.onClick(this.scope, () => {
        this.memory.favoritesOnly = !this.memory.favoritesOnly;
        this.saveMemory();
        this.resetOrder();
        this.render();
      });
    });
    component(COMPONENTS.dropdown, 'msfs-ui-gal__sort', {}, (dropdown) => {
      this.sortDropdown = dropdown;
      const manipulator = dropdown.manipulator<DropdownManipulator>();
      if (manipulator) manipulator.setEmptyTitle(translate('TT:GENERIC.SORT_BY'));
      this.renderSort();
    });
    component(COMPONENTS.iconButtonSquared, 'msfs-ui-gal__reverse', { Icon: SORT_ICON }, (button) => {
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
      component(COMPONENTS.textTab, 'msfs-ui-gal__view', { Text: label }, (tab) => {
        this.viewTabs.set(view, tab);
        tab.onClick(this.scope, () => this.setView(view));
      });
    }
    this.root.appendChild(this.body);
    this.list.setAttribute('direction', 'y');
    this.list.className = 'msfs-ui-gal__list';
    this.body.appendChild(this.list);
  }

  private setView(view: View): void {
    this.memory.view = view;
    this.saveMemory();
    // The sim's grid, hidden while choosing elsewhere, keeps a stale selection: it is refreshed.
    if (view === 'stock') this.refreshStockGrid();
    this.render();
    if (view !== 'stock') this.scrollToSelected();
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
   * list goes back to its own order so that it is not left on another sort (Default view).
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
      // The list's height, in layout units: items of 30 with 3 between them, 6 of padding above and below (measured).
      dropdown.set('List_Size', String(Math.max(1, items.length) * 33 + 9));
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
  }

  /** A new order starts from its first aircraft. */
  private scrollToTop(): void {
    this.scrollTo(0);
  }

  /** Scrolls the sim's list (its sizes are measured again first: the tiles may have just changed). */
  private scrollTo(position: number): void {
    if (this.list.updateSizes) this.list.updateSizes();
    this.list.scrollToPosition(Math.max(0, Math.min(position, this.list.maxScroll || 0)));
    this.materialize();
  }

  private refreshStockGrid(): void {
    const content = this.page.elt.querySelector(CONTENT) as (HTMLElement & { manipulator?: { updateAircraftList?: () => void } }) | null;
    if (content && content.manipulator && content.manipulator.updateAircraftList) content.manipulator.updateAircraftList();
  }

  // ----- Layout -----

  /**
   * On the sim's right block (`RightBlock`). In the Default view only the bar stays, on the line of the sim's
   * search (`Header`), on the right; its empty parts let the clicks through (pointer-events). Side by side: the list on
   * the left half, the livery column on the right half, 12 units apart.
   */
  private layout(): void {
    const right = this.page.elt.querySelector<HTMLElement>(RIGHT_BLOCK);
    if (!isShown(this.page.elt.querySelector(CONTENT)) || !right) {
      this.root.style.display = 'none';
      this.placeLiveries(null);
      return;
    }
    const stock = this.memory.view === 'stock';
    this.showStockGrid(stock);
    const origin = this.page.elt.getBoundingClientRect();
    const rect = right.getBoundingClientRect();
    const header = right.querySelector('[name="Header"]');
    const unit = uiUnit();
    const style = this.root.style;
    style.display = '';
    style.left = `${rect.left - origin.left}px`;
    style.width = `${rect.width}px`;
    style.top = `${rect.top - origin.top}px`;
    style.height = stock && header ? `${header.getBoundingClientRect().height}px` : `${rect.height}px`;
    // Side by side: three aircraft and two liveries per row, all of the same width (livery-column.ts).
    const gap = Math.round(12 * unit);
    const halves = this.liveryColumn && !stock ? splitColumns(Math.round(rect.width), gap, SCROLL_BAR_ROOM * unit, 6 * unit) : null;
    toggleClass(this.body, 'is-side-by-side', !!halves);
    this.body.style.width = halves ? `${halves.left}px` : '';
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
    this.barWidth = Math.max(this.barWidth, scrollBarWidth(this.list));
    const tiles = this.memory.view === 'gallery' ? this.cells.length : 0;
    const fit = layoutWidth(
      halves ? halves.left : Math.round(rect.width),
      this.barWidth,
      (listWidth) => {
        const tile = tileAt(listWidth);
        return Math.ceil(tiles / tile.columns) * (tile.height + 12 * unit);
      },
      this.list.getBoundingClientRect().height,
    );
    const tile = tileAt(fit.width);
    setVariable(style, '--tile-w', `${tile.width}px`);
    setVariable(style, '--tile-image-h', `${tile.image}px`);
    setVariable(style, '--tile-h', `${tile.height}px`);
    if (halves) {
      const top = Math.round(this.body.getBoundingClientRect().top - rect.top);
      this.placeLiveries({ left: halves.left + gap, top, width: halves.right, height: Math.round(rect.height) - top, list: this.memory.view === 'list' });
    } else {
      this.placeLiveries(null);
    }
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

  /** Views and Favorites; the sort dropdown is redrawn only when the sort changes (renderSort). */
  private renderBar(): void {
    const view = this.memory.view;
    this.viewTabs.forEach((tab, key) => tab.select(key === view));
    if (this.favoritesButton) this.favoritesButton.select(this.memory.favoritesOnly);
  }

  private render(): void {
    const view = this.memory.view;
    this.renderBar();
    if (view === 'stock') this.root.classList.add('is-stock');
    else this.root.classList.remove('is-stock');
    this.layout();
    if (view === 'stock') {
      this.count.textContent = '';
      this.clearCells();
      return;
    }

    const shown = visibleTiles({
      items: this.items,
      liveries: this.favoriteLiveries,
      favoritesOnly: this.memory.favoritesOnly,
      hiddenOnly: false,
      hidden: [],
      keepIds: [],
      search: this.search ? this.search.value : '',
      translate,
    });
    const choice = this.sortChoice();
    const sorted = choice && choice.local ? sortTiles(shown, choice.local, !!this.memory.sort && this.memory.sort.reversed) : shown;
    // Favourites always come first, whatever the sort (the sim's included), as they were when the order was set.
    if (this.favoriteIds === null && this.items.length > 0) this.favoriteIds = favoriteAircraftIds(this.items, this.favoriteLiveries);
    const tiles = favoritesFirst(sorted, this.favoriteIds || []);
    this.count.textContent = `${tiles.length} / ${this.items.length}`;
    const key = `${view}|${tiles.map((tile) => `${tile.item.variationId}:${tile.livery ? tile.livery.dir : ''}`).join(',')}`;
    const empty =
      tiles.length > 0
        ? ''
        : this.memory.favoritesOnly && this.favoriteLiveries.length === 0
          ? 'No favorites yet: click the bookmark on a livery.'
          : 'No aircraft matches.';
    if (key === this.cellKey && empty === this.cellEmpty) {
      // Same tiles: their texts, images and state are refreshed in place (the set of tiles is unchanged).
      this.cells.forEach((cell, at) => {
        cell.tile = tiles[at]!;
        this.fillCell(cell, view === 'gallery');
        this.updateCell(cell);
      });
      return;
    }
    this.cellKey = key;
    this.cellEmpty = empty;
    const scroll = this.list.currentScroll || 0;
    this.clearCells();
    this.body.className = galleryBodyClass(view, this.liveryColumn !== null);
    if (empty) {
      const message = el('div', 'msfs-ui-gal__empty');
      message.textContent = empty;
      this.list.appendChild(message);
      this.listItems.push(message);
      return;
    }
    const scope = (this.cellScope = this.scope.child());
    for (const tile of tiles) {
      // marquee__trigger: hovering the tile scrolls its texts that are too long, as on the sim's own tiles.
      const host = el('div', `${view === 'gallery' ? 'msfs-ui-gal__tile' : 'msfs-ui-gal__row'} marquee__trigger`);
      this.list.appendChild(host);
      this.listItems.push(host);
      const cell: Cell = { tile, host, slot: null, card: null };
      scope.listen(host, 'mouseenter', () => this.hover(cell.tile.item));
      scope.listen(host, 'mouseleave', () => this.hover(null));
      this.cells.push(cell);
    }
    this.scrollTo(scroll);
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
    if (this.memory.view === 'stock') this.cellKey = '';
  }

  /**
   * Keeps components only for the tiles near the visible part of the list, as the sim's own grid does: every tile alive
   * makes each change of layout slower (core/virtual-list.ts). The positions are all read before any change, so the
   * engine lays the page out once.
   */
  private materialize(): void {
    if (!this.cellScope || this.cells.length === 0) return;
    const body = this.list.getBoundingClientRect();
    if (body.height <= 0) return;
    const unit = uiUnit();
    const margins = { create: CREATE_MARGIN * unit, keep: KEEP_MARGIN * unit };
    const actions = this.cells.map((cell) => cellAction(cell.host.getBoundingClientRect(), cell.slot !== null, body, margins));
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
      this.fillCell(cell, this.memory.view === 'gallery');
      this.updateCell(cell);
    }
  }

  /** The cell's slot goes back to the pool's parking (the host keeps its place in the list). */
  private releaseCell(cell: Cell): void {
    if (cell.slot && this.pool) this.pool.release(cell.slot);
    cell.slot = null;
    cell.card = null;
  }

  /** The pool of the current view (aircraft tiles or list rows); another view makes a new one. */
  private slotPool(): ComponentPool<Cell> {
    const view = this.memory.view;
    if (!this.pool || this.poolView !== view) {
      if (this.poolScope) this.poolScope.dispose();
      const scope = (this.poolScope = this.scope.child());
      this.poolView = view;
      this.pool = new ComponentPool<Cell>(scope, this.root, (slot, slotScope) => this.createSlot(slot, slotScope, view === 'gallery'));
    }
    return this.pool;
  }

  /** A slot's components, made once; they show whatever cell holds the slot. */
  private createSlot(slot: PoolSlot<Cell>, scope: Scope, gallery: boolean): void {
    // The sim's tiles send tileClick / tileHover themselves, without data (the mod writes their texts itself): those
    // are stopped here, the mod sends its own with the aircraft (select, hover).
    for (const name of TILE_EVENTS) {
      scope.listen(slot.cardHost, name, (event) => {
        if ((event as CustomEvent).detail === undefined || (event as CustomEvent).detail === null) event.stopPropagation();
      });
    }
    // A Favorites tile's bookmark is full: a click removes the favourite livery the tile stands for.
    slot.icon = iconToggle(scope, slot.iconHost, 'favorite', () => {
      const cell = slot.item;
      if (cell && cell.slot === slot && cell.tile.livery) this.removeFavoriteLivery(cell.tile.livery);
    });
    slot.icon.set(true);
    createComponent(scope, gallery ? COMPONENTS.fleetTile : COMPONENTS.horizontalTile, slot.cardHost).then(
      (card) => {
        if (scope.disposed) return;
        slot.card = card;
        // The icon goes inside the card: the pointer on it keeps the card hovered (the sim does the same with its heart).
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

  /** Selection, availability and bookmark of a tile: only a favourite livery tile has one (it removes the favourite). */
  private updateCell(cell: Cell): void {
    const { item, livery } = cell.tile;
    if (cell.card) {
      const selected = livery ? livery.variationId === this.current.variationId && livery.dir === this.current.livery : item.isSelected;
      cell.card.select(selected);
      toggleClass(cell.host, 'is-selected', selected);
      cell.card.disable(!item.isUsable);
    }
    if (cell.slot) cell.slot.iconHost.style.display = livery ? '' : 'none';
    toggleClass(cell.host, 'is-without-icon', !livery);
  }

  /** Scrolls to the selected aircraft. */
  private scrollToSelected(): void {
    this.scope.timeout(() => {
      const selected = this.cells.filter((cell) => cell.tile.item.isSelected && !cell.tile.livery)[0];
      if (!selected) return;
      const body = this.list.getBoundingClientRect();
      const rect = selected.host.getBoundingClientRect();
      if (rect.top < body.top || rect.bottom > body.bottom) this.scrollTo(this.list.currentScroll + rect.top - body.top - 8 * uiUnit());
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
    if (setupPanelShown()) return;
    const content = this.page.elt.querySelector(CONTENT);
    if (content) content.dispatchEvent(new CustomEvent('tileHover', { detail: item, bubbles: true }));
  }


  private saveMemory(): void {
    saveData(MEMORY_KEY, this.memory);
  }
}
