// What the weather bar shares Free Flight's right column with (bar.ts lays the column out): the sim's cards drawn where
// the bar is (an airport's runways, a traffic aircraft), behind tabs, and the sim's "Search location" field, moved
// under the column's last block (the owner's wish, 2026-10-30). Everything of the sim is put back with the scope.

import { el, setVariable, toggleClass } from '../../core/dom.ts';
import type { Scope } from '../../core/scope.ts';
import { loadData, saveData } from '../../core/storage.ts';
import { addPanelLayers } from '../../core/theme.ts';
import { COMPONENTS, type SimComponent } from '../../sim/components.ts';
import { translate } from '../../sim/localization.ts';
import { isOnScreen, type Manipulator } from '../../sim/screens.ts';
import type { MakeComponent } from './section.ts';

/**
 * Tab shown when a card of the sim shares the column: the bar, or the card (`airport` stands for the runway card and
 * for the traffic card; the value is stored as it is).
 */
export type Tab = 'weather' | 'airport';

/** Last tab chosen (kept even without `remember`: a display preference). */
const TAB_KEY = 'WEATHER_BAR_TAB';
/** Height of the tab row, in layout units (as the tabs of the sim's runway card). */
export const TAB_ROW = 36;
/** Cards of the sim drawn where the bar is, and the label of their tab. */
const SIM_CARDS: { selector: string; tab: string }[] = [
  { selector: '[name="FreeFlight_Runways"]', tab: 'TT:GENERIC.AIRPORT' },
  { selector: '[name="FreeFlight_Traffic"]', tab: 'TT:GENERIC.TRAFFIC' },
];
/** The block of the sim's search field and its class, placed and sized in weather-bar.css. */
const SEARCH_BLOCK = '[name="Searchblock"]';
const SEARCH_CLASS = 'msfs-ui-wx-search';

/** A card of the sim on the screen, and the label of its tab. */
export interface SimCard {
  element: HTMLElement;
  tab: string;
}

/** Where the search field goes: a place (pixels in the page), hidden, or its own place under the aircraft button. */
export type SearchPlace = { top: number; left: number; width: number } | 'hidden' | 'home';

export class RightColumn {
  readonly tabs = el('div', 'msfs-ui-panel msfs-ui-wx-tabs');
  private readonly page: Manipulator;
  private readonly scope: Scope;
  /** A tab was chosen: the bar lays the column out again. */
  private readonly relayout: () => void;
  private readonly tabButtons = new Map<Tab, SimComponent>();
  private tab: Tab = loadData<Tab>(TAB_KEY, 'weather') === 'airport' ? 'airport' : 'weather';
  /** The sim card moved under the tabs: its original style, its position without our margin, the window size then. */
  private heldCard: { element: HTMLElement; marginTop: string; visibility: string; naturalTop: number; size: string } | null = null;
  /** The block of the sim's search field the bar places, and whether its release with the scope is registered. */
  private searchBlock: HTMLElement | null = null;
  private searchReleased = false;

  constructor(page: Manipulator, scope: Scope, relayout: () => void) {
    this.page = page;
    this.scope = scope;
    this.relayout = relayout;
  }

  build(component: MakeComponent): void {
    addPanelLayers(this.tabs);
    this.tabs.style.display = 'none';
    this.tabs.style.height = `calc(var(--u) * ${TAB_ROW})`;
    for (const tab of ['weather', 'airport'] as Tab[]) {
      const host = el('div', 'msfs-ui-wx-tabs__tab', this.tabs);
      component(COMPONENTS.textTab, host, { Text: tab === 'weather' ? 'Weather' : translate(SIM_CARDS[0]!.tab) }, (created) => {
        this.tabButtons.set(tab, created);
        created.onClick(this.scope, () => this.chooseTab(tab));
      });
    }
  }

  renderTabs(): void {
    this.tabButtons.forEach((button, tab) => button.select(tab === this.tab));
  }

  /** The sim's card on the screen, if any. */
  visibleCard(): SimCard | null {
    for (const sim of SIM_CARDS) {
      const element = this.page.elt.querySelector<HTMLElement>(sim.selector);
      if (isOnScreen(element)) return { element, tab: sim.tab };
    }
    return null;
  }

  /** The tab shown with `card`. Without both tabs (a component that failed to load), the card keeps the place: it cannot be hidden for good. */
  shownTab(card: SimCard | null): Tab {
    return !card ? 'weather' : this.tabButtons.size === 2 ? this.tab : 'airport';
  }

  /** The column without the bar (a map panel fills it): no tabs, the card in its own place, the search field hidden. */
  hide(): void {
    this.hideTabs();
    this.placeSearch('hidden');
  }

  /** No card: no tabs, the card in its own place. */
  hideTabs(): void {
    this.tabs.style.display = 'none';
    this.releaseCard();
  }

  /** The tabs at a place (`top` in pixels in the page), the second one named after `card`. */
  showTabs(card: SimCard, place: { left: string; width: string; top: number }): void {
    const cardButton = this.tabButtons.get('airport');
    if (cardButton) cardButton.set('Text', translate(card.tab));
    const tabs = this.tabs.style;
    tabs.display = '';
    tabs.left = place.left;
    tabs.width = place.width;
    tabs.top = `${place.top}px`;
  }

  /**
   * Moves the sim's card down so that it starts at `top` (window coordinate), by its top margin; its original style
   * is noted once and put back by `releaseCard`.
   */
  holdCard(card: HTMLElement, top: number): void {
    // The natural position is measured without our margin, once (and at each change of window size): measuring it
    // again from a rounded position makes the card oscillate.
    const size = `${window.innerWidth}x${window.innerHeight}`;
    let held = this.heldCard;
    if (!held || held.element !== card || held.size !== size) {
      if (held && held.element === card) card.style.marginTop = held.marginTop;
      else {
        this.releaseCard();
        held = null;
      }
      const marginTop = held ? held.marginTop : card.style.marginTop;
      const visibility = held ? held.visibility : card.style.visibility;
      this.heldCard = held = { element: card, marginTop, visibility, size, naturalTop: card.getBoundingClientRect().top };
    }
    const margin = Math.max(0, Math.round(top - held.naturalTop));
    if (Math.abs((parseFloat(card.style.marginTop) || 0) - margin) >= 1) card.style.marginTop = `${margin}px`;
  }

  releaseCard(): void {
    const held = this.heldCard;
    if (!held) return;
    this.heldCard = null;
    held.element.style.marginTop = held.marginTop;
    held.element.style.visibility = held.visibility;
  }

  /**
   * The sim's search field at a place (pixels in the page), hidden (a map panel fills the column, as the bar), or
   * `home`, in its own place under the aircraft button (no room left in the column; the favourites then go under it):
   * its block marked SEARCH_CLASS and given the place in variables (written only on change: weather-bar.css). The
   * sim's own place back with the scope.
   */
  placeSearch(where: SearchPlace): void {
    const block = this.page.elt.querySelector<HTMLElement>(SEARCH_BLOCK);
    if (!block) return;
    if (!this.searchReleased) {
      this.searchReleased = true;
      this.scope.add(() => this.unmarkSearch());
    }
    // Only that block (the sim may draw it again).
    if (block !== this.searchBlock) this.unmarkSearch();
    this.searchBlock = block;
    if (where === 'home') {
      this.unmarkSearch();
      return;
    }
    const style = block.style;
    if (where !== 'hidden') {
      setVariable(style, '--msfs-ui-search-top', `${Math.round(where.top)}px`);
      setVariable(style, '--msfs-ui-search-left', `${Math.round(where.left)}px`);
      setVariable(style, '--msfs-ui-search-width', `${Math.round(where.width)}px`);
    }
    if (!block.classList.contains(SEARCH_CLASS)) block.classList.add(SEARCH_CLASS);
    toggleClass(block, 'is-hidden', where === 'hidden');
  }

  /** The search field's block back as the sim made it: no class, no variable of the mod. */
  private unmarkSearch(): void {
    const block = this.searchBlock;
    if (!block || !block.classList.contains(SEARCH_CLASS)) return;
    block.classList.remove(SEARCH_CLASS, 'is-hidden');
    for (const name of ['--msfs-ui-search-top', '--msfs-ui-search-left', '--msfs-ui-search-width']) block.style.removeProperty(name);
  }

  private chooseTab(tab: Tab): void {
    this.tab = tab;
    saveData(TAB_KEY, tab);
    this.renderTabs();
    this.relayout();
  }
}
