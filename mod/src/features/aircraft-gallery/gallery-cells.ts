// The gallery's list (gallery.ts): the sim's scrolling list, made for the axis of the view, with a host per tile
// (Showcase: a column host per two tiles, column-major as the sim's grid). Only the tiles near the visible part get the
// sim's components, from a pool of slots (sim/component-pool.ts): the aircraft tiles of Gallery and Showcase share one,
// the List rows another.

import { el, toggleClass } from '../../core/dom.ts';
import { iconToggle, type IconToggle } from '../../core/icon-toggle.ts';
import { EYE_SLASH_SVG } from '../../core/icons.ts';
import { logError } from '../../core/log.ts';
import type { Scope } from '../../core/scope.ts';
import { TextFitter } from '../../core/text-fit.ts';
import { aircraftNames, sameName } from '../../sim/aircraft-names.ts';
import { PooledCells, type PoolSlot } from '../../sim/component-pool.ts';
import { COMPONENTS, createComponent, markOwned, TILE_EVENTS, type SimComponent } from '../../sim/components.ts';
import type { FavoriteLivery } from '../../sim/favorites.ts';
import { translate } from '../../sim/localization.ts';
import { createRealScroll, type RealScroll } from '../../sim/real-scroll.ts';
import { columnOf } from './default-grid.ts';
import type { AircraftItem, Tile } from './tiles.ts';

/** The views (the Showcase view was once stored as `stock`: memory.ts). */
export type View = 'gallery' | 'list' | 'showcase';
/** The axis a view's list scrolls along: Showcase horizontally, the others vertically. */
export type Axis = 'x' | 'y';
/** The component a cell shows: an aircraft tile (Gallery, Showcase) or a row (List). */
type CellKind = 'tile' | 'row';

/** The tile's own text block: the tile holds another Banner and Text for a disabled aircraft (`DisabledAircraft`). */
const BANNER_TEXT = '[name="Content"] > [name="Banner"] > [name="Text"]';
/** The lines of an aircraft tile's own text block, fitted in Showcase; its font (`--fontSizeXS`) and side margins, in layout units. */
const BANNER_LINES = ['[name="AircraftName"]', '[name="Subtitle"]', '[name="Distance"]', '.msfs-ui-gal__studio'].map((line) => `${BANNER_TEXT} > ${line}`).join(', ');
const BANNER_FONT_UNITS = 18;
const BANNER_SIDE_UNITS = 6;

/** The axis a view scrolls along: Showcase horizontally, as the sim's grid; Gallery and List vertically. */
export function axisOf(view: View): Axis {
  return view === 'showcase' ? 'x' : 'y';
}

function kindOf(view: View): CellKind {
  return view === 'list' ? 'row' : 'tile';
}

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
 * aircraft) next to the heart of the Favorites tiles, the veil of a hidden aircraft kept for its favourite liveries (a
 * dark layer with a large slashed eye over the thumbnail, a marker only), and the studio's line of Showcase (the tile
 * has three lines of its own).
 */
interface SlotExtras {
  eye: IconToggle;
  veil: HTMLElement;
  studio: HTMLElement;
}

/** What the cells read from the gallery. */
export interface CellsContext {
  view(): View;
  /** Current aircraft (variant and livery, as `liveryKey`): selection of the livery tiles. */
  current(): { variationId: string; livery: string };
  /** Whether the aircraft is hidden (its eye). */
  isHidden(item: AircraftItem): boolean;
  /** The class of the list's element for a view (livery-column.ts). */
  bodyClass(view: View): string;
  /** A list was made for `axis`: what goes with it is disposed with `scope`. */
  listMade(scope: Scope, list: RealScroll, axis: Axis): void;
}

/** What a tile does, through the gallery. */
export interface CellActions {
  select(item: AircraftItem): void;
  selectLivery(item: AircraftItem, livery: FavoriteLivery): void;
  toggleHidden(item: AircraftItem): void;
  removeFavoriteLivery(livery: FavoriteLivery): void;
  hover(item: AircraftItem | null): void;
}

export class GalleryCells {
  private readonly scope: Scope;
  private readonly body: HTMLElement;
  private readonly context: CellsContext;
  private readonly actions: CellActions;
  /**
   * The sim's scrolling list, in the body: it holds the tiles (or the empty message). Made for one axis (makeList):
   * Showcase scrolls along x, Gallery and List along y; another axis makes another list.
   */
  private scroll!: RealScroll;
  private scrollAxis: Axis = 'y';
  /** The list's own listener and its place in the body, disposed when the list is replaced. */
  private listScope: Scope | null = null;
  /** What is in the list now: the tiles' hosts (Gallery, List), their column hosts (Showcase) or the empty message. */
  private listItems: HTMLElement[] = [];
  /** The eye and veil of each slot of the pool, made with the slot (createSlot). */
  private readonly slotExtras = new WeakMap<PoolSlot<Cell>, SlotExtras>();
  private readonly pooled: PooledCells<Cell>;
  /** The tiles on screen, their scope (disposed when the list changes) and what they were built for. */
  private cells: Cell[] = [];
  private cellScope: Scope | null = null;
  private key = '';
  /** The message shown instead of tiles, if any. */
  private empty = '';
  private readonly fitter = new TextFitter();
  /** The Showcase tiles' line width and unit at the last layout pass (fitBanners); null before the first. */
  private bannerFit: { width: number; unit: number } | null = null;

  /** `parking`: where the pool keeps its free slots (the gallery's root). */
  constructor(scope: Scope, parking: HTMLElement, body: HTMLElement, context: CellsContext, actions: CellActions) {
    this.scope = scope;
    this.body = body;
    this.context = context;
    this.actions = actions;
    this.pooled = new PooledCells<Cell>(scope, parking, {
      kind: () => kindOf(context.view()),
      maker: (kind) => ({
        cardClass: 'msfs-ui-gal__card',
        iconClass: 'msfs-ui-gal__icon',
        create: (slot, slotScope) => this.createSlot(slot, slotScope, kind as CellKind),
      }),
      assigned: (cell) => {
        if (!cell.card) return;
        this.fill(cell, kindOf(context.view()));
        this.update(cell);
      },
    });
  }

  get list(): RealScroll {
    return this.scroll;
  }

  get axis(): Axis {
    return this.scrollAxis;
  }

  /** The tiles on screen (none while the list shows its empty message). */
  get count(): number {
    return this.cells.length;
  }

  /**
   * The sim's scrolling list for `axis`, in the body (`<real-scroll direction="x">` scrolls as the vertical one,
   * measured on 1.9.21, 2026-10-30). The previous list goes with its content: the pool's slots are parked first
   * (clear), so they survive it.
   */
  makeList(axis: Axis): void {
    if (this.listScope) this.listScope.dispose();
    const scope = (this.listScope = this.scope.child());
    const list = createRealScroll(axis, 'msfs-ui-gal__list');
    scope.append(this.body, list);
    // The sim's list scrolls itself (wheel, scroll bar): the tiles coming into view get their components.
    scope.listen(list, 'ui-scroll', () => this.materialize());
    this.scroll = list;
    this.scrollAxis = axis;
    this.context.listMade(scope, list, axis);
  }

  /** A view along another axis: the tiles parked, a new list for it. */
  remake(axis: Axis): void {
    this.clear();
    this.key = '';
    this.empty = '';
    this.makeList(axis);
  }

  /**
   * The tiles of `view`, or the `empty` message: the same set refreshed in place (texts, images and state), another
   * one built again at the same scroll position.
   */
  draw(view: View, tiles: Tile[], empty: string): void {
    const key = `${view}|${tiles.map((tile) => `${tile.item.variationId}:${tile.livery ? tile.livery.dir : ''}`).join(',')}`;
    if (key === this.key && empty === this.empty) {
      this.cells.forEach((cell, at) => {
        cell.tile = tiles[at]!;
        this.fill(cell, kindOf(view));
        this.update(cell);
      });
      return;
    }
    this.key = key;
    this.empty = empty;
    const scroll = this.scroll.currentScroll || 0;
    this.clear();
    const grid = view === 'showcase';
    this.body.className = this.context.bodyClass(view);
    if (empty) {
      const message = el('div', 'msfs-ui-gal__empty');
      message.textContent = empty;
      this.scroll.appendChild(message);
      this.listItems.push(message);
      return;
    }
    const scope = (this.cellScope = this.scope.child());
    let column: HTMLElement | null = null;
    for (let at = 0; at < tiles.length; at++) {
      const tile = tiles[at]!;
      // marquee__trigger: hovering the tile scrolls its texts that are too long, as on the sim's own tiles.
      const host = el('div', `${view === 'list' ? 'msfs-ui-gal__row msfs-ui-row-tile' : 'msfs-ui-gal__tile'} marquee__trigger`);
      if (grid) {
        // Two tiles per column, the first on top: a new column for every first one.
        if (columnOf(at).row === 0 || !column) {
          column = el('div', 'msfs-ui-gal__column', this.scroll);
          this.listItems.push(column);
        }
        column.appendChild(host);
      } else {
        this.scroll.appendChild(host);
        this.listItems.push(host);
      }
      const cell: Cell = { tile, host, slot: null, card: null };
      scope.listen(host, 'mouseenter', () => this.actions.hover(cell.tile.item));
      scope.listen(host, 'mouseleave', () => this.actions.hover(null));
      this.cells.push(cell);
    }
    this.scrollTo(scroll);
  }

  /**
   * Keeps components only for the tiles near the visible part of the list, as the sim's own grid does: every tile alive
   * makes each change of layout slower (core/virtual-list.ts). Along the list's axis: Showcase's tiles come into view
   * from the sides.
   */
  materialize(): void {
    if (!this.cellScope || this.cells.length === 0) return;
    this.pooled.materialize(this.cells, this.scroll, this.scrollAxis);
  }

  /** At each layout pass of Showcase: each line of the tiles' banners, `tileWidth` pixels wide, on its line (a text too long reduced to fit). */
  fitBanners(tileWidth: number, unit: number): void {
    this.bannerFit = { width: tileWidth - 2 * Math.round(BANNER_SIDE_UNITS * unit), unit };
    for (const cell of this.cells) this.fitBanner(cell);
  }

  /** A Showcase tile's lines fitted at the last pass's width: also as soon as a tile gets its texts (scrolled into view), so that none shows unfitted until the next pass. */
  private fitBanner(cell: Cell): void {
    const fit = this.bannerFit;
    if (!cell.card || !fit) return;
    const lines = cell.card.element.querySelectorAll<HTMLElement>(BANNER_LINES);
    for (let at = 0; at < lines.length; at++) {
      const line = lines[at]!;
      // The brand in the name's bold style, the others as the sim's.
      const bold = line.getAttribute('name') === 'AircraftName' || line.getAttribute('name') === 'Subtitle';
      this.fitter.fit(line, fit.width, BANNER_FONT_UNITS * fit.unit, bold ? 'bold' : 'light', line.querySelector('.marquee__content') || line);
    }
  }

  /** Scrolls the sim's list along its axis (its sizes are measured again first: the tiles may have just changed). */
  scrollTo(position: number): void {
    if (this.scroll.updateSizes) this.scroll.updateSizes();
    this.scroll.scrollToPosition(Math.max(0, Math.min(position, this.scroll.maxScroll || 0)));
    this.materialize();
  }

  /** The selected aircraft's tile (not one of its liveries): its place in the list and its host; null when none shows. */
  selectedTile(): { at: number; host: HTMLElement } | null {
    const at = this.cells.map((cell) => cell.tile.item.isSelected && !cell.tile.livery).indexOf(true);
    const selected = this.cells[at];
    return selected ? { at, host: selected.host } : null;
  }

  private clear(): void {
    // The slots leave the hosts before these go: they wait in the pool's parking for the next list.
    this.pooled.releaseAll();
    if (this.cellScope) this.cellScope.dispose();
    this.cellScope = null;
    this.cells = [];
    for (const item of this.listItems) {
      if (item.parentNode) item.parentNode.removeChild(item);
    }
    this.listItems = [];
  }

  /** A slot's components, made once; they show whatever cell holds the slot. */
  private createSlot(slot: PoolSlot<Cell>, scope: Scope, kind: CellKind): void {
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
      if (cell && cell.slot === slot && cell.tile.livery) this.actions.removeFavoriteLivery(cell.tile.livery);
    });
    slot.icon.set(true);
    // An aircraft tile's eye, in the same corner: a click hides the aircraft, or brings it back when it is hidden.
    const eye = iconToggle(scope, slot.iconHost, 'hidden', () => {
      const cell = slot.item;
      if (cell && cell.slot === slot && !cell.tile.livery) this.actions.toggleHidden(cell.tile.item);
    });
    const veil = el('div', 'msfs-ui-gal__veil');
    veil.innerHTML = EYE_SLASH_SVG;
    veil.style.display = 'none';
    const studio = el('div', 'msfs-ui-gal__studio');
    this.slotExtras.set(slot, { eye, veil, studio });
    createComponent(scope, kind === 'tile' ? COMPONENTS.fleetTile : COMPONENTS.horizontalTile, slot.cardHost).then(
      (card) => {
        if (scope.disposed) return;
        slot.card = card;
        // The veil and the icons go inside the card, the icons last (above the veil): the pointer on them keeps the
        // card hovered (the sim does the same with its WishlistBlock).
        card.element.appendChild(veil);
        card.element.appendChild(slot.iconHost);
        const text = card.element.querySelector(BANNER_TEXT);
        if (text && kind === 'tile') text.appendChild(studio);
        this.pooled.markReady(slot);
        if (kind === 'row') markOwned(card);
        card.onClick(scope, () => {
          const cell = slot.item;
          if (!cell || cell.slot !== slot) return;
          const { item, livery } = cell.tile;
          if (livery) this.actions.selectLivery(item, livery);
          else this.actions.select(item);
        });
        const cell = slot.item;
        if (cell && cell.slot === slot) {
          cell.card = card;
          this.fill(cell, kind);
          this.update(cell);
        }
      },
      (error: unknown) => logError('a gallery tile could not be created', error),
    );
  }

  /** Texts and image of a tile, as the sim's own aircraft tile writes them. */
  private fill(cell: Cell, kind: CellKind): void {
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
    if (kind === 'tile') {
      card.set('AircraftImage', image);
      const slot = cell.slot;
      const extras = slot ? this.slotExtras.get(slot) : undefined;
      if (extras) extras.studio.textContent = creator;
      if (this.context.view() === 'showcase') {
        // Four lines: the model, the brand, the variant (and livery), and on the banner's lowest line the studio.
        const names = aircraftNames(item);
        card.set('AircraftName', names.model);
        // The studio alone when it is the brand: the name once on the tile, as in the title (the owner, 2026-11-02).
        card.set('Subtitle', sameName(names.brand, creator) ? '' : names.brand);
        card.set('Distance', subtitle);
        cell.host.classList.remove('has-third-line');
        this.fitBanner(cell);
      } else {
        // Three lines: the name, the variant (and livery), the studio in the tile's third line (Distance, shown by the
        // CSS); the studio moves up when there is no variant.
        card.set('AircraftName', name);
        card.set('Subtitle', subtitle || creator);
        card.set('Distance', subtitle ? creator : '');
        if (subtitle && creator) cell.host.classList.add('has-third-line');
        else cell.host.classList.remove('has-third-line');
        // A slot may come from Showcase, its lines fitted there.
        const lines = card.element.querySelectorAll<HTMLElement>(BANNER_LINES);
        for (let at = 0; at < lines.length; at++) this.fitter.reset(lines[at]!);
      }
    } else {
      card.set('Image', image);
      card.set('Title', name);
      const parts = [creator].concat(details).filter((part) => !!part).map((part) => part.trim());
      // Two lines: the name, then "studio · variant (· livery)" (aircraft-gallery.css).
      card.set('Creator', parts.join(' · '));
    }
  }

  /**
   * Selection, availability, icon and veil of a tile. A favourite livery tile (Favorites) has the heart (it removes
   * the favourite); an aircraft tile has the eye, on when the aircraft is hidden. A hidden aircraft kept for its
   * favourite liveries is veiled, in both kinds of tile.
   */
  private update(cell: Cell): void {
    const { item, livery } = cell.tile;
    if (cell.card) {
      const current = this.context.current();
      const selected = livery ? livery.variationId === current.variationId && livery.dir === current.livery : item.isSelected;
      cell.card.select(selected);
      toggleClass(cell.host, 'is-selected', selected);
      cell.card.disable(!item.isUsable);
    }
    const slot = cell.slot;
    const extras = slot ? this.slotExtras.get(slot) : undefined;
    if (slot && slot.icon && extras) {
      slot.icon.element.style.display = livery ? '' : 'none';
      extras.eye.element.style.display = livery ? 'none' : '';
      extras.eye.set(this.context.isHidden(item));
      extras.veil.style.display = cell.tile.veiled ? '' : 'none';
    }
  }
}
