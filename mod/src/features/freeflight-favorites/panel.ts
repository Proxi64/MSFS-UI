// The Favorites block on Free Flight, under the sim's "Search location" field, as wide as the sim's aircraft button:
// a card like the sim's (background layers, header), its rows in the sim's scrolling list, each row the sim's
// horizontal tile (as the gallery's list view) with the mod's heart at its end. One row per favourite livery: a click
// loads the aircraft with it; the heart removes the favourite.

import { el, uiUnit } from '../../core/dom.ts';
import { iconToggle, type IconToggle } from '../../core/icon-toggle.ts';
import { logError } from '../../core/log.ts';
import type { Scope } from '../../core/scope.ts';
import { panel } from '../../core/theme.ts';
import { loadAircraft } from '../../sim/aircraft-loading.ts';
import { COMPONENTS, createComponent, type SimComponent } from '../../sim/components.ts';
import { FAVORITE_LIVERIES_CHANGED, loadFavoriteLiveries, saveFavoriteLiveries } from '../../sim/favorites.ts';
import { liveryDirectory, liveryKey, loadLiveryTails } from '../../sim/liveries.ts';
import { isShown, type Manipulator } from '../../sim/screens.ts';
import { store, translate, watch } from '../../sim/store.ts';
import { collectEntries, isCurrentEntry, orderEntries, withoutLivery, type FavoriteEntry } from './entries.ts';

/** The sim's horizontal marketplace tile: its hover handler reads `item.isOwned` (see the gallery). */
interface HorizontalTileManipulator {
  item?: { isOwned: boolean; isOwnedBySubscription: boolean; isFavorite: boolean };
}

/** The sim's scrolling list (see the gallery): it scrolls on the wheel and draws its scroll bar. */
interface RealScroll extends HTMLElement {
  readonly maxScroll: number;
  scrollToPosition(position: number): void;
  updateSizes?(): void;
}

/** A row on screen and its components once created. */
interface Row {
  entry: FavoriteEntry;
  host: HTMLElement;
  card: SimComponent | null;
  icon: IconToggle;
}

const AIRCRAFT_BUTTON = '[name="FreeFlight_AircraftButton"]';
const SEARCH = '[name="Search"]';
/** Layout units: gap under the search field, room kept at the bottom of the screen (the sim's buttons). */
const GAP = 12;
const BOTTOM_ROOM = 110;
/** Layout units: header, row and gap between rows, padding of the list (as in the CSS). */
const HEADER = 36;
const ROW = 77;
const ROW_GAP = 6;
const LIST_PADDING = 6;
/** The use is recorded 1.5 s after a change of aircraft (sim/aircraft-loading.ts): the block is redrawn after it. */
const REDRAW_AFTER_USE_MS = 1700;

const aircraft = store.Game.Aircraft;

export class FavoritesPanel {
  private readonly page: Manipulator;
  private readonly scope: Scope;
  private readonly root = panel('msfs-ui-fav');
  private readonly list = document.createElement('real-scroll') as RealScroll;
  private listItems: HTMLElement[] = [];
  private rows: Row[] = [];
  private rowScope: Scope | null = null;
  /** The entries drawn (ids), to rebuild the rows only when they change. */
  private rowKey: string | null = null;
  /** Order of the entries, kept from the first display of the screen (see orderEntries). */
  private order: string[] | null = null;
  private current = { variationId: '', livery: '' };
  private loading = false;
  /** Height of the search field when closed: higher, it shows its results. */
  private searchHeight = 0;

  constructor(page: Manipulator, scope: Scope) {
    this.page = page;
    this.scope = scope;
  }

  mount(): void {
    const scope = this.scope;
    const header = el('div', 'msfs-ui-header', this.root);
    el('span', 'msfs-ui-title', header).textContent = 'Favorites';
    this.list.setAttribute('direction', 'y');
    this.list.className = 'msfs-ui-fav__list';
    this.root.appendChild(this.list);
    scope.append(this.page.elt, this.root);
    this.layout();
    scope.interval(() => this.layout(), 250);

    watch<{ variationId: string; thumbnailPath: string } | null>(scope, aircraft.CurrentAircraft, (current) => {
      this.current = {
        variationId: current ? current.variationId : '',
        livery: current && current.thumbnailPath ? liveryKey(liveryDirectory(current.thumbnailPath)) : '',
      };
      this.render();
      scope.timeout(() => this.render(), REDRAW_AFTER_USE_MS);
    });
    scope.listen(document, FAVORITE_LIVERIES_CHANGED, () => this.render());
  }

  /**
   * Under the search field, as wide as the aircraft button; hidden while the search shows its results, and without
   * favourites (the owner's choice, 2026-10-30: no block taking room for nothing).
   */
  private layout(): void {
    const button = this.page.elt.querySelector(AIRCRAFT_BUTTON);
    const search = this.page.elt.querySelector(SEARCH);
    if (this.rows.length === 0 || !isShown(button) || !isShown(search)) {
      this.root.style.display = 'none';
      return;
    }
    const searchRect = search.getBoundingClientRect();
    if (!this.searchHeight || searchRect.height < this.searchHeight) this.searchHeight = searchRect.height;
    if (searchRect.height > this.searchHeight * 1.5) {
      this.root.style.display = 'none';
      return;
    }
    const unit = uiUnit();
    const origin = this.page.elt.getBoundingClientRect();
    const rect = button.getBoundingClientRect();
    const top = Math.round(searchRect.bottom - origin.top + GAP * unit);
    const available = Math.floor(origin.height - BOTTOM_ROOM * unit - top);
    // As high as its rows, up to the room left: the sim's list then scrolls.
    const rows = this.rows.length;
    const content = rows * ROW + (rows - 1) * ROW_GAP;
    const wanted = Math.ceil((HEADER + 2 * LIST_PADDING + content) * unit);
    const style = this.root.style;
    style.display = available > HEADER * unit ? '' : 'none';
    style.left = `${Math.round(rect.left - origin.left)}px`;
    style.top = `${top}px`;
    style.width = `${Math.round(rect.width)}px`;
    style.height = `${Math.max(0, Math.min(wanted, available))}px`;
    // Room for the scroll bar only when the list scrolls.
    if (this.list.maxScroll > 0) this.root.classList.add('is-scrolling');
    else this.root.classList.remove('is-scrolling');
  }

  private render(): void {
    if (this.scope.disposed) return;
    const ordered = orderEntries(collectEntries(loadFavoriteLiveries()), this.order);
    this.order = ordered.order;
    const entries = ordered.entries;
    const key = entries.map((entry) => entry.id).join(',');
    if (key === this.rowKey) {
      // Same rows: texts and state refreshed in place (livery used, tail number, selection).
      this.rows.forEach((row, at) => {
        row.entry = entries[at]!;
        this.fillRow(row);
      });
      return;
    }
    this.rowKey = key;
    this.clearRows();
    const scope = (this.rowScope = this.scope.child());
    for (const entry of entries) this.createRow(entry, scope);
    this.layout();
    if (this.list.updateSizes) this.list.updateSizes();
    this.list.scrollToPosition(0);
  }

  private clearRows(): void {
    if (this.rowScope) this.rowScope.dispose();
    this.rowScope = null;
    this.rows = [];
    for (const item of this.listItems) {
      if (item.parentNode) item.parentNode.removeChild(item);
    }
    this.listItems = [];
  }

  private createRow(entry: FavoriteEntry, scope: Scope): void {
    // marquee__trigger: hovering the row scrolls its texts that are too long, as on the sim's own tiles (the engine
    // shows no ellipsis).
    const host = el('div', 'msfs-ui-fav__row marquee__trigger');
    this.list.appendChild(host);
    this.listItems.push(host);
    const cardHost = el('div', 'msfs-ui-fav__card', host);
    const iconHost = el('div', 'msfs-ui-fav__icon', host);
    // Every row is a favourite: the heart is full, and a click removes the favourite.
    const icon = iconToggle(scope, iconHost, 'favorite', (checked) => (checked ? undefined : this.remove(row.entry)));
    icon.set(true);
    const row: Row = { entry, host, card: null, icon };
    this.rows.push(row);
    createComponent(scope, COMPONENTS.horizontalTile, cardHost).then(
      (card) => {
        if (scope.disposed) return;
        row.card = card;
        // Inside the card: the pointer on the icon keeps the row hovered.
        card.element.appendChild(iconHost);
        const horizontal = card.manipulator<HorizontalTileManipulator>();
        if (horizontal) horizontal.item = { isOwned: true, isOwnedBySubscription: false, isFavorite: false };
        card.onClick(scope, () => this.load(row.entry));
        this.fillRow(row);
      },
      (error: unknown) => logError('a favourite could not be shown', error),
    );
  }

  /**
   * Texts, image and selection of a row: the name in the tile's bold Title, then "variant · livery · tail
   * number" in its light Creator line.
   */
  private fillRow(row: Row): void {
    const { entry, card } = row;
    if (card) {
      const tail = loadLiveryTails()[liveryKey(entry.livery.dir)];
      const details = [entry.variation ? translate(entry.variation) : '', translate(entry.livery.title), tail || ''];
      card.set('Image', entry.image);
      card.set('Title', entry.name);
      card.set('Creator', details.filter((part) => !!part.trim()).map((part) => part.trim()).join(' · '));
      card.select(isCurrentEntry(entry, this.current));
    }
  }

  /** Loads the variant, then the row's livery; the block is dimmed meanwhile. */
  private load(entry: FavoriteEntry): void {
    if (this.loading) return;
    this.loading = true;
    this.root.classList.add('is-loading');
    loadAircraft(entry.variationId, { livery: entry.livery, usedAt: 0 })
      .catch((error: unknown) => logError(`${entry.name} could not be loaded`, error))
      .then(() => {
        this.loading = false;
        this.root.classList.remove('is-loading');
        this.render();
      });
  }

  /** The heart clicked: the favourite livery is removed (its change event redraws the block). */
  private remove(entry: FavoriteEntry): void {
    saveFavoriteLiveries(withoutLivery(loadFavoriteLiveries(), entry));
  }
}
