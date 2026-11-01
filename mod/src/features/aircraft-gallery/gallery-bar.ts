// The gallery's bar (gallery.ts), made of the sim's components: the search, the count, the Hidden and Favorites
// filters, the sort and its direction, the view tabs. On one line; side by side, cut over the two columns; in the
// Showcase view, over the grid's columns.

import { el, setStyle, toggleClass } from '../../core/dom.ts';
import { HEART_SVG, EYE_SLASH_SVG } from '../../core/icons.ts';
import { logError } from '../../core/log.ts';
import type { Scope } from '../../core/scope.ts';
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
import { translate } from '../../sim/localization.ts';
import { createTextField, type TextField } from '../../sim/text-field.ts';
import { barColumns, shareTabs, type DefaultGrid } from './default-grid.ts';
import type { View } from './gallery-cells.ts';
import { shortCount } from './livery-column.ts';
import type { GalleryFilter } from './tiles.ts';

const SORT_ICON = 'coui://html_UI/VFS/components/shared/resources/Icons/General/Sort.svg';
/** Narrowest search before the count drops its total, in layout units (its placeholder's first words stay readable). */
const MIN_SEARCH = 240;
/** View tabs (the sim has no keys for Gallery and Showcase), each with its class: its width in the CSS (TAB_UNITS). */
const VIEWS: { view: View; label: string }[] = [
  { view: 'gallery', label: 'Gallery' },
  { view: 'list', label: translate('TT:GENERIC.LIST') },
  { view: 'showcase', label: 'Showcase' },
];

/** The sorts as the dropdown shows them: the choices offered, the one chosen (-1: none), the sort remembered. */
export interface SortView {
  choices: { id: string; label: string }[];
  current: number;
  sort: { reversed: boolean } | null;
}

/** What the bar shows, read from the gallery whenever it draws. */
export interface BarModel {
  view(): View;
  filter(): GalleryFilter;
  sort(): SortView;
}

/** What the bar's controls do, through the gallery. */
export interface BarEvents {
  search(): void;
  filter(clicked: 'favorites' | 'hidden'): void;
  reverse(): void;
  view(view: View): void;
  sort(id: string): void;
}

/**
 * The bar cut over the side by side layout's two columns, in pixels from the gallery's left edge: its first part over
 * the aircraft tiles, Hidden and Favorites over their last column, its second part over the livery column.
 */
export interface BarSplit {
  start: { left: number; right: number };
  filters: { left: number; right: number; gap: number };
  end: { left: number; width: number };
}

export class GalleryBar {
  readonly element = el('div', 'msfs-ui-gal__bar');
  /**
   * The bar's two parts: search, count, Hidden and Favorites; then the sort, its direction and the views. Side by
   * side, each stands above its column (layout); otherwise they make one line.
   */
  private readonly start = el('div', 'msfs-ui-gal__bar-part msfs-ui-gal__bar-start', this.element);
  private readonly end = el('div', 'msfs-ui-gal__bar-part msfs-ui-gal__bar-end', this.element);
  /** The search's host, first in the bar: it takes what the other controls leave (its width decides the count's form). */
  private readonly searchHost = el('div', 'msfs-ui-gal__control msfs-ui-gal__search', this.start);
  /** The count, "shown / total": the total goes when the search would be too narrow (layout). */
  private readonly count = el('span', 'msfs-ui-gal__count');
  private readonly countShown = el('span', '', this.count);
  private readonly countTotal = el('span', 'msfs-ui-gal__count-total', this.count);
  /** Width of the count's total, last measured in the line (fitCount). */
  private countTotalWidth = 0;
  private readonly scope: Scope;
  private readonly model: BarModel;
  private readonly events: BarEvents;
  private search: TextField | null = null;
  private favoritesButton: SimComponent | null = null;
  private hiddenButton: SimComponent | null = null;
  private reverseButton: SimComponent | null = null;
  private sortDropdown: SimComponent | null = null;
  private readonly viewTabs = new Map<View, SimComponent>();

  constructor(scope: Scope, model: BarModel, events: BarEvents) {
    this.scope = scope;
    this.model = model;
    this.events = events;
  }

  build(): void {
    const component = (part: HTMLElement, guid: ComponentGuid, className: string, attributes: Record<string, string>, onReady: (created: SimComponent) => void) => {
      const host = el('div', `msfs-ui-gal__control ${className}`, part);
      createComponent(this.scope, guid, host, attributes).then(
        (created) => {
          if (this.scope.disposed) return;
          onReady(created);
          this.render();
        },
        (error: unknown) => logError(`a control of the gallery could not be created (${guid})`, error),
      );
      return host;
    };

    createTextField(this.scope, this.searchHost, {
      placeholder: 'Search: name, manufacturer, variant',
      onChange: () => this.events.search(),
    }).then(
      (field) => (this.search = field),
      (error: unknown) => logError('the gallery search could not be created', error),
    );
    this.start.appendChild(this.count);

    // Hidden and Favorites, each with the mod's icon before its text; never both on.
    component(this.start, COMPONENTS.textButtonSmall, 'msfs-ui-gal__filter msfs-ui-gal__hidden', { Text: 'Hidden' }, (button) => {
      this.hiddenButton = button;
      labelIcon(button, EYE_SLASH_SVG);
      button.onClick(this.scope, () => this.events.filter('hidden'));
    });
    component(this.start, COMPONENTS.textButtonSmall, 'msfs-ui-gal__filter msfs-ui-gal__favorites', { Text: 'Favorites' }, (button) => {
      this.favoritesButton = button;
      labelIcon(button, HEART_SVG);
      button.onClick(this.scope, () => this.events.filter('favorites'));
    });
    component(this.end, COMPONENTS.dropdown, 'msfs-ui-gal__sort', {}, (dropdown) => {
      this.sortDropdown = dropdown;
      const manipulator = dropdown.manipulator<DropdownManipulator>();
      if (manipulator) manipulator.setEmptyTitle(translate('TT:GENERIC.SORT_BY'));
      this.renderSort();
    });
    component(this.end, COMPONENTS.iconButtonSquared, 'msfs-ui-gal__reverse', { Icon: SORT_ICON }, (button) => {
      this.reverseButton = button;
      button.onClick(this.scope, () => this.events.reverse());
    });
    for (const { view, label } of VIEWS) {
      component(this.end, COMPONENTS.textTab, `msfs-ui-gal__view msfs-ui-gal__view--${view}`, { Text: label }, (tab) => {
        this.viewTabs.set(view, tab);
        tab.onClick(this.scope, () => this.events.view(view));
      });
    }
  }

  /** The text searched ('' until the field exists). */
  searchValue(): string {
    return this.search ? this.search.value : '';
  }

  /** Views, Hidden and Favorites; the sort dropdown is redrawn only when the sort changes (renderSort). */
  render(): void {
    const view = this.model.view();
    const filter = this.model.filter();
    this.viewTabs.forEach((tab, key) => tab.select(key === view));
    if (this.hiddenButton) this.hiddenButton.select(filter === 'hidden');
    if (this.favoritesButton) this.favoritesButton.select(filter === 'favorites');
  }

  renderSort(): void {
    const sorts = this.model.sort();
    const dropdown = this.sortDropdown;
    if (dropdown) {
      const manipulator = dropdown.manipulator<DropdownManipulator>();
      const items: DropdownItem[] = sorts.choices.map((choice) => ({
        title: choice.label,
        subtitle: '',
        coma: '',
        selectedCallback: () => this.events.sort(choice.id),
      }));
      const current = sorts.current >= 0 ? items[sorts.current] : undefined;
      if (manipulator) manipulator.setData(items, current);
      // The list's height, in layout units (sim/components.ts).
      dropdown.set('List_Size', String(Math.max(1, items.length) * DROPDOWN_ITEM + DROPDOWN_PADDING));
    }
    if (this.reverseButton) {
      this.reverseButton.select(!!sorts.sort && sorts.sort.reversed);
      this.reverseButton.disable(!sorts.sort);
    }
  }

  /** The count's two texts, written only when they change. */
  setCount(shown: string, total: string): void {
    if (this.countShown.textContent !== shown) this.countShown.textContent = shown;
    if (this.countTotal.textContent !== total) this.countTotal.textContent = total;
  }

  /** The whole bar's width, in pixels ('': its CSS). */
  placeWidth(width: string): void {
    setStyle(this.element.style, 'width', width);
  }

  /**
   * The bar's two parts, in pixels from the gallery's left edge. Side by side (`split`): the first from the first
   * aircraft tile's left edge to the last one's right edge (or the rows' edges), not over the scroll bar, Hidden and
   * Favorites over the last column of tiles (`filters`, placeFilters) and the search and count over the others; the
   * second above the livery column, from its left edge to its right one (the sort dropdown takes what the other
   * controls leave, aircraft-gallery.css). Otherwise one line. The count drops its total when the search would be too
   * narrow. Written only when a value changes (every 250 ms).
   */
  layout(split: BarSplit | null, unit: number): void {
    const bar = this.element;
    if (bar.classList.contains('is-split') !== !!split) toggleClass(bar, 'is-split', !!split);
    if (bar.classList.contains('is-columns')) toggleClass(bar, 'is-columns', false);
    // What the Showcase view's bar writes (layoutGrid) goes back to the CSS.
    const sort = bar.querySelector<HTMLElement>('.msfs-ui-gal__sort');
    if (sort) setStyle(sort.style, 'width', '');
    Array.prototype.forEach.call(bar.querySelectorAll('.msfs-ui-gal__view'), (tab: HTMLElement) => {
      setStyle(tab.style, 'marginLeft', '');
      setStyle(tab.style, 'width', '');
    });
    setStyle(this.start.style, 'marginLeft', split ? `${split.start.left}px` : '');
    setStyle(this.start.style, 'width', split ? `${split.start.right - split.start.left}px` : '');
    setStyle(this.end.style, 'marginLeft', split ? `${split.end.left - split.start.right}px` : '');
    setStyle(this.end.style, 'width', split ? `${split.end.width}px` : '');
    this.placeFilters(split ? { width: split.filters.right - split.filters.left, gap: split.filters.gap } : null, unit);
    this.fitCount(unit);
  }

  /**
   * The Showcase view's bar over the grid's columns (`barColumns`): the search and count over the first column,
   * Hidden, Favorites and the sort dropdown over the middle ones, the sort's direction and the view tabs over the last,
   * the grid's gap between the parts (aircraft-gallery.css, is-columns). The bar's two elements keep their controls:
   * the first (search, count, Hidden, Favorites) ends on Favorites, the second begins with the dropdown, whose width
   * takes it to the middle part's right edge; the tabs share what the direction leaves. Measured widths, written only
   * when they change. On one line when the columns are too few or too narrow.
   */
  layoutGrid(grid: DefaultGrid, unit: number): void {
    const bar = this.element;
    const spans = barColumns(grid, unit);
    const hidden = bar.querySelector<HTMLElement>('.msfs-ui-gal__hidden');
    const favorites = bar.querySelector<HTMLElement>('.msfs-ui-gal__favorites');
    const sort = bar.querySelector<HTMLElement>('.msfs-ui-gal__sort');
    if (!spans || !hidden || !favorites || !sort) {
      this.layout(null, unit);
      return;
    }
    if (bar.classList.contains('is-split')) toggleClass(bar, 'is-split', false);
    if (!bar.classList.contains('is-columns')) toggleClass(bar, 'is-columns', true);
    this.placeFilters(null, unit);
    // Hidden starts the middle part (the gap before it is its margin): the first element ends with Favorites.
    const filters = Math.round(favorites.getBoundingClientRect().right - hidden.getBoundingClientRect().left);
    const startWidth = spans.middle.left + filters;
    setStyle(this.start.style, 'marginLeft', '');
    setStyle(this.start.style, 'width', `${startWidth}px`);
    setStyle(this.end.style, 'marginLeft', '');
    setStyle(this.end.style, 'width', `${grid.gridWidth - startWidth}px`);
    const sortMargin = Math.round(sort.getBoundingClientRect().left - this.end.getBoundingClientRect().left);
    setStyle(sort.style, 'width', `${Math.max(0, spans.middle.right - startWidth - sortMargin)}px`);
    // The tabs in whole pixels after the direction, in the proportions of TAB_UNITS, the last one taking the rest.
    const reverse = bar.querySelector<HTMLElement>('.msfs-ui-gal__reverse');
    const tabs = Array.prototype.slice.call(bar.querySelectorAll('.msfs-ui-gal__view')) as HTMLElement[];
    if (reverse && tabs.length > 0) {
      const margin = Math.round(6 * unit);
      const room = Math.floor(bar.getBoundingClientRect().left + spans.last.right - reverse.getBoundingClientRect().right) - tabs.length * margin;
      const widths = shareTabs(room);
      tabs.forEach((tab, at) => {
        setStyle(tab.style, 'marginLeft', `${margin}px`);
        setStyle(tab.style, 'width', `${widths[at]}px`);
      });
    }
    this.fitCount(unit);
  }

  /**
   * Hidden and Favorites side by side in `width` pixels, `gap` pixels after the count (the tiles' gap): they end the
   * bar's first part, so the search and count fill the columns before. Halves of the width in whole pixels, Favorites
   * taking the rest; null: their CSS widths and margins.
   */
  private placeFilters(span: { width: number; gap: number } | null, unit: number): void {
    const hidden = this.element.querySelector<HTMLElement>('.msfs-ui-gal__hidden');
    const favorites = this.element.querySelector<HTMLElement>('.msfs-ui-gal__favorites');
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
