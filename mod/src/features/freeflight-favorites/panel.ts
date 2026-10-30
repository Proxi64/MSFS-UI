// The Favorites block on Free Flight, under the sim's aircraft button (or its "Search location" field while that one
// is still under it), as wide as the button:
// a card like the sim's (background layers, no header), its rows in the sim's scrolling list, each row the sim's
// horizontal tile (as the gallery's list view) with the mod's heart at its end. One row per favourite livery: a click
// loads the aircraft with it; the heart removes the favourite.

import { el, uiUnit } from '../../core/dom.ts';
import { iconToggle, type IconToggle } from '../../core/icon-toggle.ts';
import { logError } from '../../core/log.ts';
import type { Scope } from '../../core/scope.ts';
import { GROUP_GAP, GROUP_GAP_ATTRIBUTE, panel } from '../../core/theme.ts';
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
/** Layout units: room kept at the bottom of the screen (the sim's buttons). The gap above the block: see GROUP_GAP. */
const BOTTOM_ROOM = 110;
/** Layout units: row and gap between rows (as in the CSS); no header (the owner's choice, 2026-10-30). */
const ROW = 77;
const ROW_GAP = 6;
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
  /** Height of the search field when closed, in layout units: higher, it shows its results. */
  private searchHeight = 0;

  constructor(page: Manipulator, scope: Scope) {
    this.page = page;
    this.scope = scope;
  }

  mount(): void {
    const scope = this.scope;
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
   * Under the aircraft button, as wide as it; hidden while a search field under it shows its results, and without
   * favourites (the owner's choice, 2026-10-30: no block taking room for nothing).
   */
  private layout(): void {
    const button = this.page.elt.querySelector(AIRCRAFT_BUTTON);
    if (this.rows.length === 0 || !isShown(button)) {
      this.root.style.display = 'none';
      return;
    }
    const rect = button.getBoundingClientRect();
    const unit = uiUnit();
    // Under the aircraft button (the weather bar moves the search field to the right column: the owner's wish,
    // 2026-10-30), or under the search field while it is still there, under the button (the weather bar turned off).
    const search = this.page.elt.querySelector(SEARCH);
    const searchRect = isShown(search) ? search.getBoundingClientRect() : null;
    const under = searchRect && searchRect.left < rect.right && searchRect.right > rect.left && searchRect.top >= rect.bottom ? searchRect : null;
    if (under) {
      // In layout units: a change of resolution in the session (window, full screen) changes the pixels, not the units
      // (measured 2026-10-30: from 1080 to 2160 lines, the closed search was twice the remembered height, the block hidden).
      const searchHigh = under.height / unit;
      if (!this.searchHeight || searchHigh < this.searchHeight) this.searchHeight = searchHigh;
      if (searchHigh > this.searchHeight * 1.5) {
        this.root.style.display = 'none';
        return;
      }
    }
    const origin = this.page.elt.getBoundingClientRect();
    // Under the search field, the sim's own gap above it; otherwise the weather bar's gap when it runs (it fills its
    // column), so that both columns match.
    const shared = Number(this.page.elt.getAttribute(GROUP_GAP_ATTRIBUTE));
    const gap = under ? under.top - rect.bottom : shared > 0 ? shared : Math.floor(GROUP_GAP * unit);
    const top = Math.round((under ? under.bottom : rect.bottom) - origin.top + gap);
    const available = Math.floor(origin.height - BOTTOM_ROOM * unit - top);
    // As high as its rows, up to the whole rows that fit in the room left: the sim's list then scrolls, and the block
    // still ends on the edge of a row (the owner's choice, 2026-10-30: a cut row showed under the last one). In whole
    // pixels as the engine lays them out (each height rounded down; measured 2026-10-30: in exact units the block ended
    // 8 units below its last row with four rows).
    const px = (units: number) => Math.floor(units * unit);
    const step = px(ROW) + px(ROW_GAP);
    const shown = Math.min(this.rows.length, Math.floor((available + px(ROW_GAP)) / step));
    const style = this.root.style;
    style.display = shown > 0 ? '' : 'none';
    style.left = `${Math.round(rect.left - origin.left)}px`;
    style.top = `${top}px`;
    style.width = `${Math.round(rect.width)}px`;
    style.height = `${Math.max(0, shown * step - px(ROW_GAP))}px`;
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
