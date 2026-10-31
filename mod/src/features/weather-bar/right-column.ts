// What the weather bar shares Free Flight's right column with (bar.ts lays the column out): the sim's cards drawn where
// the bar is (an airport's runways, a traffic aircraft), behind tabs always shown, so that a card appearing moves
// nothing (the owner's wish, 2026-10-31). Everything of the sim is put back with the scope.

import { el, toggleClass } from '../../core/dom.ts';
import type { Scope } from '../../core/scope.ts';
import { loadData, saveData } from '../../core/storage.ts';
import { addPanelLayers } from '../../core/theme.ts';
import { COMPONENTS, type SimComponent } from '../../sim/components.ts';
import { translate } from '../../sim/localization.ts';
import { isOnScreen, type Manipulator } from '../../sim/screens.ts';
import type { MakeComponent } from './section.ts';

/**
 * Tab shown: the bar, or the sim's card (`airport` stands for the runway card and for the traffic card; the value is
 * stored as it is).
 */
export type Tab = 'weather' | 'airport';

/** Last tab chosen (kept even without `remember`: a display preference). */
const TAB_KEY = 'WEATHER_BAR_TAB';
/** Height of the tab row, in layout units (as the tabs of the sim's runway card). */
const TAB_ROW = 36;
/** Cards of the sim drawn where the bar is, and the label of their tab; the first one names it without a card. */
const SIM_CARDS: { selector: string; tab: string }[] = [
  { selector: '[name="FreeFlight_Runways"]', tab: 'TT:GENERIC.AIRPORT' },
  { selector: '[name="FreeFlight_Traffic"]', tab: 'TT:GENERIC.TRAFFIC' },
];

/** A card of the sim on the screen, and the label of its tab. */
export interface SimCard {
  element: HTMLElement;
  tab: string;
}

export class RightColumn {
  readonly tabs = el('div', 'msfs-ui-panel msfs-ui-wx-tabs');
  private readonly page: Manipulator;
  private readonly scope: Scope;
  /** A tab was chosen: the bar lays the column out again. */
  private readonly relayout: () => void;
  private readonly tabButtons = new Map<Tab, SimComponent>();
  /** The host of the card's tab, dimmed without a card. */
  private cardTabHost: HTMLElement | null = null;
  private tab: Tab = loadData<Tab>(TAB_KEY, 'weather') === 'airport' ? 'airport' : 'weather';
  /** A card of the sim is on the screen: the card's tab can be chosen. */
  private hasCard = false;
  /** The sim card moved under the tabs: its original style, its position without our margin, the window size then. */
  private heldCard: { element: HTMLElement; marginTop: string; visibility: string; naturalTop: number; size: string } | null = null;

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
      if (tab === 'airport') this.cardTabHost = host;
      component(COMPONENTS.textTab, host, { Text: tab === 'weather' ? 'Weather' : translate(SIM_CARDS[0]!.tab) }, (created) => {
        this.tabButtons.set(tab, created);
        created.onClick(this.scope, () => this.chooseTab(tab));
      });
    }
  }

  /** The tab shown is selected: without a card, Weather, the card's tab kept as the choice for the next card. */
  renderTabs(): void {
    const shown = this.shownTab();
    this.tabButtons.forEach((button, tab) => button.select(tab === shown));
  }

  /** The sim's card on the screen, if any. */
  visibleCard(): SimCard | null {
    for (const sim of SIM_CARDS) {
      const element = this.page.elt.querySelector<HTMLElement>(sim.selector);
      if (isOnScreen(element)) return { element, tab: sim.tab };
    }
    return null;
  }

  /**
   * The tab shown with the card given to the last `showTabs`. Without both tabs (a component that failed to load), the
   * card keeps the place: it cannot be hidden for good.
   */
  shownTab(): Tab {
    return !this.hasCard ? 'weather' : this.tabButtons.size === 2 ? this.tab : 'airport';
  }

  /** The column without the bar (a map panel fills it): no tabs, the card in its own place. */
  hide(): void {
    this.tabs.style.display = 'none';
    this.releaseCard();
  }

  /**
   * The tabs at a place (`top` in pixels in the page): the second one named after `card`, dimmed and inactive without
   * one (the sim's TextTab has no Disabled state). Returns the tab row's height in pixels.
   */
  showTabs(card: SimCard | null, place: { left: string; width: string; top: number }): number {
    const cardButton = this.tabButtons.get('airport');
    if (cardButton) cardButton.set('Text', translate(card ? card.tab : SIM_CARDS[0]!.tab));
    if (this.cardTabHost) toggleClass(this.cardTabHost, 'is-inactive', !card);
    if (this.hasCard !== !!card) {
      this.hasCard = !!card;
      this.renderTabs();
    }
    const tabs = this.tabs.style;
    tabs.display = '';
    tabs.left = place.left;
    tabs.width = place.width;
    tabs.top = `${place.top}px`;
    return this.tabs.getBoundingClientRect().height;
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

  private chooseTab(tab: Tab): void {
    // Without a card, its tab is inactive (weather-bar.css takes the pointer away from it as well).
    if (tab === 'airport' && !this.hasCard) return;
    this.tab = tab;
    saveData(TAB_KEY, tab);
    this.renderTabs();
    this.relayout();
  }
}
