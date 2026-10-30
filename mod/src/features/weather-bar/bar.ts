// The weather and time bar on Free Flight, under the sim's Flight Conditions widget, made of the sim's own components
// (src/sim/components.ts): icon buttons for the weather presets, choice tiles for the times of day, traffic and
// multiplayer, tabs and the flight category of the METAR.

import { withTimeout } from '../../core/async.ts';
import { el, setVariable, toggleClass, uiUnit } from '../../core/dom.ts';
import { log, logError } from '../../core/log.ts';
import type { Scope } from '../../core/scope.ts';
import { loadData, saveData } from '../../core/storage.ts';
import { addPanelLayers, GROUP_GAP, GROUP_GAP_ATTRIBUTE } from '../../core/theme.ts';
import type { Settings } from '../../generated/catalog.ts';
import {
  COMPONENTS,
  createComponent,
  DROPDOWN_EDGE,
  DROPDOWN_ITEM,
  DROPDOWN_PADDING,
  type ComponentGuid,
  type DropdownItem,
  type DropdownManipulator,
  type SimComponent,
} from '../../sim/components.ts';
import type { RealScroll } from '../../sim/real-scroll.ts';
import { isOnScreen, isShown, type Manipulator } from '../../sim/screens.ts';
import { readArray, store, translate, watch, type StoreNode } from '../../sim/store.ts';
import type { FlightConditions, FlightConfigurationButton, FlightLocation, TimeInfo, WeatherInfo, WeatherPreset } from './model.ts';
import { isSimPreset, rememberedPreset } from './presets.ts';
import { currentTimeMode, departureSeconds, liveOffsetFor, TIME_MODES, type SentTime, type TimeMode } from './time-of-day.ts';
import { flightRules, weatherSummary } from './weather-text.ts';

type ConditionGroup = 'airtraffic' | 'multiplayer';
/**
 * Tab shown when a card of the sim shares the column: the bar, or the card (`airport` stands for the runway card and
 * for the traffic card; the value is stored as it is).
 */
type Tab = 'weather' | 'airport';

/** The last choice, remembered when `remember` is on (mod/README.md, Data stored in the sim). */
interface Memory {
  weather: number | null;
  /** Title of the weather preset, which finds it again when the indexes move (presets.ts, rememberedPreset). */
  weatherTitle?: string | null;
  time: TimeMode | null;
  /** Id of the button chosen (`AIRTRAFFICAI`…), per group. */
  airtraffic?: string | null;
  multiplayer?: string | null;
}

const MEMORY_KEY = 'WEATHER_BAR';
/** Last tab chosen (kept even without `remember`: a display preference). */
const TAB_KEY = 'WEATHER_BAR_TAB';
/** Height of the tab row, in layout units (as the tabs of the sim's runway card), and the gap under it. */
const TAB_ROW = 36;
const GAP = 6;
/**
 * The block of the sim's "Search location" field, moved under the bar (the owner's wish, 2026-10-30), its class, placed
 * and sized in weather-bar.css, and the sim's map buttons, the bottom of the room it may take.
 */
const SEARCH_BLOCK = '[name="Searchblock"]';
const SEARCH_CLASS = 'msfs-ui-wx-search';
const MAP_BUTTONS = '[name="Worldmap_Filters"]';
/** Height of the search field, in layout units (as in weather-bar.css: the times of day's). */
const SEARCH_HEIGHT = 36;
/** The live weather preset (its title in the sim's list), and the cells of the preset grid per row (as in the CSS). */
const LIVE_PRESET = 'TT:MENU.WEATHERTYPE_0DYNAMIC';
const PRESETS_PER_ROW = 6;
/**
 * The presets added by other packages, in the sim's dropdown under the grid (the owner's choice, 2026-10-30): its list
 * (sizes in sim/components.ts) opens downwards when at least LIST_LEAST items fit there (sizePresetList).
 */
const LIST_LEAST = 3;
/** Longest wait for a weather request; past it, the line says so. */
const WEATHER_TIMEOUT_MS = 4000;
/** Close changes (departure, preset, live mode) are grouped into one weather request. */
const METAR_DEBOUNCE_MS = 300;
const TIME_LABELS: Record<TimeMode, string> = { now: 'Now', dawn: 'Dawn', day: 'Day', dusk: 'Dusk', night: 'Night' };

/**
 * Groups of the flight-condition buttons, with the translation keys of their labels: those of the sim's panel
 * (Flight_Conditions_General.uxml). Their final precision in brackets ("AI (Experimental)", "Off (Group Only)") is
 * removed: it does not fit in a third of the bar.
 */
const CONDITION_GROUPS: { group: ConditionGroup; title: string; labels: Record<string, string> }[] = [
  {
    group: 'airtraffic',
    title: 'TT:WEATHER.AIR_TRAFFIC_TITLE',
    labels: { AIRTRAFFICLIVE: 'TT:GENERIC.LIVE', AIRTRAFFICAI: 'TT:MENU.FLIGHTCONDITION.AI', AIRTRAFFICOFF: 'TT:MENU.WEATHERLAYER_OFF' },
  },
  {
    group: 'multiplayer',
    title: 'TT:WEATHER.MULTIPLAYER_TITLE',
    labels: { MULTIPLAYERLIVE: 'TT:GENERIC.LIVE', MULTIPLAYERALL: 'TT:MENU.FLIGHTCONDITION.ALL_PLAYERS', MULTIPLAYEROFF: 'TT:MENU.FLIGHTCONDITION.MULTIPLAYER_OFF' },
  },
];

/** Cards of the sim drawn where the bar is, and the label of their tab. */
const SIM_CARDS: { selector: string; tab: string }[] = [
  { selector: '[name="FreeFlight_Runways"]', tab: 'TT:GENERIC.AIRPORT' },
  { selector: '[name="FreeFlight_Traffic"]', tab: 'TT:GENERIC.TRAFFIC' },
];
const WIDGET = '[name="Flight_Conditions_History_Widget"]';
/** The panels the map buttons open (legend, map layers, map display): the sim draws them where the bar is. */
const MAP_PANELS = ['[name="Worldmap_Filters_Legend"]', '[name="Worldmap_Filters_Layers"]', '[name="Worldmap_Filters_Display"]'];

const flight = store.Game.CurrentFlight;
const gameFlight = flight.GameFlight;

declare global {
  interface Window {
    /** The last choice is applied once per sim session, not at every reload of the mod: set once it has been applied. */
    __msfsUiWeatherRestored?: boolean;
  }
}

/** A translated label without its final precision in brackets. */
function shortLabel(key: string): string {
  return translate(key).replace(/\s*\([^)]*\)\s*$/, '');
}

/** `promise`, or a rejection naming `what` when the sim does not answer within WEATHER_TIMEOUT_MS. */
function within<T>(promise: Promise<T>, what: string): Promise<T> {
  return withTimeout(promise, WEATHER_TIMEOUT_MS, `${what}: no answer after ${WEATHER_TIMEOUT_MS} ms`);
}

/** The value, or null if the promise rejects or does not settle within `ms`; the failure is logged as `what`. */
function answerOrNull<T>(promise: Promise<T>, ms: number, what: string): Promise<T | null> {
  return withTimeout(promise, ms, `no answer after ${ms} ms`).catch((error: unknown) => {
    logError(what, error);
    return null;
  });
}

interface Section {
  section: HTMLElement;
  value: HTMLElement;
  body: HTMLElement;
}

export class WeatherBar {
  private readonly page: Manipulator;
  private readonly scope: Scope;
  private readonly settings: Settings['weatherBar'];
  private readonly panel = el('div', 'msfs-ui-panel msfs-ui-wx');
  private readonly tabs = el('div', 'msfs-ui-panel msfs-ui-wx-tabs');

  private presets: WeatherPreset[] = [];
  private readonly presetButtons = new Map<number, SimComponent>();
  /** The hosts of the preset grid: first cell and number of cells of each (laid out by `layoutPresets`). */
  private readonly presetCells: { host: HTMLElement; start: number; span: number }[] = [];
  /**
   * The dropdown of the added presets (none without them), its items by preset index, the index it shows (-1: its
   * title, no added preset chosen; null: not drawn yet).
   */
  private presetList: SimComponent | null = null;
  private readonly presetItems = new Map<number, DropdownItem>();
  private presetListShown: number | null = null;
  /** The block of the sim's search field the bar places, and whether its release with the scope is registered. */
  private searchBlock: HTMLElement | null = null;
  private searchReleased = false;
  private readonly timeButtons = new Map<TimeMode, SimComponent>();
  private readonly conditionButtons = new Map<string, SimComponent>();
  private readonly tabButtons = new Map<Tab, SimComponent>();
  private rulesBadge: SimComponent | null = null;

  private weatherName: HTMLElement | null = null;
  private metar: { section: HTMLElement; icao: HTMLElement; rules: HTMLElement; real: HTMLElement; simulated: HTMLElement } | null = null;

  private weatherIndex = -1;
  private time: TimeInfo | null = null;
  /** The time mode the bar applied; null when the time was changed elsewhere. */
  private timeMode: TimeMode | null = null;
  private lastSent: SentTime | null = null;
  private liveBuffer = false;
  private liveOffset = 0;
  private departureDms = '';
  private departureId = 0;
  private departureIcao = '';
  private liveWeather = false;
  private metarTimer: ReturnType<typeof setTimeout> | undefined;
  /** Number of the last weather request: an older answer is ignored. */
  private metarRequest = 0;
  private conditions: FlightConditions | null = null;
  /** The last choice is tried once per display of the screen, until it has been applied once in the session. */
  private restoreTried = false;
  private tab: Tab = loadData<Tab>(TAB_KEY, 'weather') === 'airport' ? 'airport' : 'weather';
  /** The sim card moved under the tabs: its original style, its position without our margin, the window size then. */
  private heldCard: { element: HTMLElement; marginTop: string; visibility: string; naturalTop: number; size: string } | null = null;

  constructor(page: Manipulator, scope: Scope, settings: Settings['weatherBar']) {
    this.page = page;
    this.scope = scope;
    this.settings = settings;
  }

  async mount(): Promise<void> {
    this.presets = (await readArray<WeatherPreset>(store.Game.Weather.FlightConditions.PresetList)).filter((preset) => preset && preset.enabled);
    if (this.scope.disposed) return;
    const pending = this.build();
    this.scope.append(this.page.elt, this.panel);
    this.scope.append(this.page.elt, this.tabs);
    this.scope.add(() => this.releaseCard());
    this.scope.add(() => this.page.elt.removeAttribute(GROUP_GAP_ATTRIBUTE));
    // The model is followed at once, so that clicks and the restore never act on default values; the components
    // load in parallel and each one is drawn from the model as soon as it is ready.
    this.watchModel();
    this.layout();
    this.scope.interval(() => this.layout(), 250);
    await Promise.all(pending);
  }

  private watchModel(): void {
    const scope = this.scope;
    watch<number>(scope, gameFlight.weatherIndex, (index) => {
      this.weatherIndex = index;
      this.renderWeather();
      this.scheduleMetar();
    });
    if (this.settings.metar) {
      watch<boolean>(scope, gameFlight.isLiveWeather, (live) => {
        this.liveWeather = !!live;
        this.scheduleMetar();
      });
      scope.add(() => clearTimeout(this.metarTimer));
    }
    if (this.settings.traffic) {
      watch<FlightConditions>(scope, flight.FlightConditions, (conditions) => {
        this.conditions = conditions;
        this.renderConditions();
      });
      // The sim publishes the flight conditions only after this request (as its own panel does).
      flight.UpdateFlightConditions.request('').catch((error: unknown) => logError('the flight conditions could not be requested', error));
    }
    watch<TimeInfo>(scope, gameFlight.timeData, (time) => {
      this.time = time;
      this.refreshTimeMode();
    });
    watch<boolean>(scope, gameFlight.isUsingLiveTimeBuffer, (value) => {
      this.liveBuffer = !!value;
      this.refreshTimeMode();
    });
    watch<number>(scope, gameFlight.liveTimeOffset, (value) => {
      this.liveOffset = value || 0;
      this.refreshTimeMode();
    });
    watch<FlightLocation>(scope, gameFlight.departure, (departure) => this.onDepartureChanged(departure));
    watch<boolean>(scope, store.Elements.FlightConditions.InteractionBlocked, (blocked) => {
      if (blocked) this.panel.classList.add('is-blocked');
      else this.panel.classList.remove('is-blocked');
    });
  }

  // ----- Construction -----

  /** Builds the markup and starts creating the sim's components; returns their pending creations. */
  private build(): Promise<unknown>[] {
    const pending: Promise<unknown>[] = [];
    const component = (guid: ComponentGuid, host: HTMLElement, attributes: Record<string, string>, onReady: (created: SimComponent) => void) => {
      pending.push(
        createComponent(this.scope, guid, host, attributes).then(
          (created) => {
            if (this.scope.disposed) return;
            onReady(created);
            this.render();
          },
          (error: unknown) => logError(`a component of the weather bar could not be created (${guid})`, error),
        ),
      );
    };

    addPanelLayers(this.panel);
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

    // Times of day first, titled "Today" (the owner's choice, 2026-10-30): the sim's widget above shows the time.
    const row = el('div', 'msfs-ui-wx__row', this.section(translate('TT:WEATHER.TODAY')).body);
    for (const mode of TIME_MODES) {
      const host = el('div', 'msfs-ui-wx__choice msfs-ui-compact-tile', row);
      component(COMPONENTS.tileButton, host, { Title: TIME_LABELS[mode] }, (created) => {
        this.timeButtons.set(mode, created);
        created.onClick(this.scope, () => this.run('the time could not be changed', this.chooseTime(mode)));
      });
    }

    const weather = this.section('Weather');
    this.weatherName = weather.value;
    const grid = el('div', 'msfs-ui-wx__grid', weather.body);
    let cell = 0;
    // The sim's presets in the grid; the added ones (often hundreds, without their icons) in the dropdown under it.
    for (const preset of this.presets.filter(isSimPreset)) {
      // Live: the tile of the traffic buttons, "Live" written on it, two cells wide (the owner's choice, 2026-10-30).
      const live = preset.title === LIVE_PRESET;
      const span = live ? 2 : 1;
      const host = el('div', live ? 'msfs-ui-wx__icon msfs-ui-compact-tile' : 'msfs-ui-wx__icon', grid);
      this.presetCells.push({ host, start: cell, span });
      cell += span;
      this.scope.listen(host, 'mouseenter', () => {
        if (this.weatherName) this.weatherName.textContent = translate(preset.title);
      });
      this.scope.listen(host, 'mouseleave', () => this.renderWeather());
      const onReady = (created: SimComponent) => {
        this.presetButtons.set(preset.index, created);
        created.onClick(this.scope, () => this.run('the weather could not be changed', this.chooseWeather(preset)));
      };
      if (live) component(COMPONENTS.tileButton, host, { Title: shortLabel('TT:GENERIC.LIVE') }, onReady);
      else component(COMPONENTS.iconButtonSquared, host, { Icon: preset.iconUrl }, onReady);
    }
    const added = this.presets.filter((preset) => !isSimPreset(preset));
    if (added.length > 0) {
      for (const preset of added) {
        this.presetItems.set(preset.index, {
          title: preset.title,
          subtitle: '',
          coma: '',
          selectedCallback: () => this.run('the weather could not be changed', this.chooseWeather(preset)),
        });
      }
      const host = el('div', 'msfs-ui-wx__presets', weather.body);
      component(COMPONENTS.dropdown, host, {}, (created) => {
        this.presetList = created;
        const manipulator = created.manipulator<DropdownManipulator>();
        if (manipulator) manipulator.setEmptyTitle(translate('TT:MENU.FLIGHTCONDITION.PRESETS'));
        // Once the click has opened the list (the sim's handler runs first).
        created.onClick(this.scope, () => this.scope.timeout(() => this.scrollPresetList(), 0));
      });
    }

    if (this.settings.metar) {
      const metar = this.section('METAR');
      const icao = el('span', 'msfs-ui-wx__icao', metar.value);
      const rules = el('div', 'msfs-ui-wx__rules', metar.value);
      component(COMPONENTS.flightRules, rules, {}, (created) => (this.rulesBadge = created));
      this.metar = {
        section: metar.section,
        icao,
        rules,
        real: el('div', 'msfs-ui-wx__line', metar.body),
        simulated: el('div', 'msfs-ui-wx__line msfs-ui-wx__line--sim', metar.body),
      };
      metar.section.style.display = 'none';
    }

    if (this.settings.traffic) {
      // One section per group, titled as in the sim's Flight Conditions panel ("Air traffic", "Multiplayer").
      for (const { group, title, labels } of CONDITION_GROUPS) {
        const buttons = el('div', 'msfs-ui-wx__row', this.section(translate(title)).body);
        for (const id of Object.keys(labels)) {
          const host = el('div', 'msfs-ui-wx__choice msfs-ui-compact-tile', buttons);
          component(COMPONENTS.tileButton, host, { Title: shortLabel(labels[id]!) }, (created) => {
            this.conditionButtons.set(id, created);
            created.onClick(this.scope, () => this.run('the flight condition could not be changed', this.chooseCondition(group, id)));
          });
        }
      }
    }
    return pending;
  }

  /** A section: header (title on the left, value on the right) and body. */
  private section(title: string): Section {
    const section = el('div', 'msfs-ui-wx__section', this.panel);
    const header = el('div', 'msfs-ui-header', section);
    el('span', 'msfs-ui-title', header).textContent = title;
    const value = el('div', 'msfs-ui-value msfs-ui-wx__value', header);
    const body = el('div', 'msfs-ui-wx__body', section);
    return { section, value, body };
  }

  private run(what: string, action: Promise<void>): void {
    action.catch((error: unknown) => logError(what, error));
  }

  private render(): void {
    this.renderWeather();
    this.refreshTimeMode();
    this.renderConditions();
    this.tabButtons.forEach((button, tab) => button.select(tab === this.tab));
  }

  // ----- Layout -----

  /**
   * Under the Flight Conditions widget, across its width; hidden when the widget is (another panel is open). When an
   * airport or a traffic aircraft is selected, the sim shows its card (SIM_CARDS) in the same place, and the column
   * cannot hold both: tabs appear under the widget (Weather, and Airport or Traffic), the card is moved down by as
   * much, and only the element of the chosen tab is visible. A panel of the map buttons (MAP_PANELS) takes the place
   * as in the sim: the bar and its tabs are hidden while it is open, the card back in its own place.
   */
  private layout(): void {
    const anchor = this.page.elt.querySelector(WIDGET);
    if (!isShown(anchor) || MAP_PANELS.some((selector) => isOnScreen(this.page.elt.querySelector<HTMLElement>(selector)))) {
      this.panel.style.display = 'none';
      this.tabs.style.display = 'none';
      this.releaseCard();
      this.placeSearch('hidden');
      return;
    }
    // At start-up the sim activates Free Flight behind the scenes, then resets the flight conditions: the last choice
    // is applied once the bar is really on the screen.
    // A failure (or the screen closed meanwhile) leaves it to the next display of the screen.
    if (this.settings.remember && !window.__msfsUiWeatherRestored && !this.restoreTried) {
      this.restoreTried = true;
      this.restore().then(
        (applied) => {
          if (applied) window.__msfsUiWeatherRestored = true;
        },
        (error: unknown) => logError('the last choice of the weather bar could not be applied (tried again at the next display)', error),
      );
    }
    const origin = this.page.elt.getBoundingClientRect();
    const rect = anchor.getBoundingClientRect();
    const unit = uiUnit();
    const style = this.panel.style;
    style.display = '';
    style.left = `${rect.left - origin.left}px`;
    style.width = `${rect.width}px`;
    this.layoutPresets(Math.floor(rect.width), unit);

    let card: HTMLElement | null = null;
    let cardTab = '';
    for (const sim of SIM_CARDS) {
      const element = this.page.elt.querySelector<HTMLElement>(sim.selector);
      if (isOnScreen(element)) {
        card = element;
        cardTab = sim.tab;
        break;
      }
    }
    // Without both tabs (a component that failed to load), the sim's card keeps the place: it cannot be hidden for good.
    const tab: Tab = !card ? 'weather' : this.tabButtons.size === 2 ? this.tab : 'airport';

    // The same gap under the widget, between the blocks, above and under the search field (the owner's wish,
    // 2026-10-30), given to the page's other column.
    const gap = this.groupGap(rect.bottom, unit, card, tab);
    this.spaceSections(gap);
    if (this.page.elt.getAttribute(GROUP_GAP_ATTRIBUTE) !== String(gap)) this.page.elt.setAttribute(GROUP_GAP_ATTRIBUTE, String(gap));
    let top = rect.bottom - origin.top + gap;
    const left = rect.left - origin.left;
    // The search field under the last block of the column (the bar or the sim's card) when it fits above the map
    // buttons with at least GAP under it; otherwise back in the sim's own place, under the aircraft button.
    const searchUnder = (bottom: number) => {
      const buttons = this.page.elt.querySelector(MAP_BUTTONS);
      const limit = isShown(buttons) ? buttons.getBoundingClientRect().top - origin.top - Math.floor(GAP * unit) : origin.height;
      const searchTop = bottom + gap;
      this.placeSearch(searchTop + Math.floor(SEARCH_HEIGHT * unit) <= limit ? { top: searchTop, left, width: rect.width } : 'home');
    };
    const panelBottom = () => top + this.panel.getBoundingClientRect().height;

    if (!card) {
      this.tabs.style.display = 'none';
      this.releaseCard();
      style.top = `${top}px`;
      searchUnder(panelBottom());
      this.sizePresetList(rect.top, unit);
      return;
    }
    const cardButton = this.tabButtons.get('airport');
    if (cardButton) cardButton.set('Text', translate(cardTab));

    // Tabs under the widget, then the sim's card (moved down) or the bar, depending on the tab.
    const tabs = this.tabs.style;
    tabs.display = '';
    tabs.left = style.left;
    tabs.width = style.width;
    tabs.top = `${top}px`;
    top += (TAB_ROW + GAP) * unit;
    this.holdCard(card, top + origin.top);
    card.style.visibility = tab === 'airport' ? '' : 'hidden';
    style.display = tab === 'weather' ? '' : 'none';
    style.top = `${top}px`;
    searchUnder(tab === 'weather' ? panelBottom() : card.getBoundingClientRect().bottom - origin.top);
    this.sizePresetList(rect.top, unit);
  }

  /**
   * Opened, the list of the added presets shows its first items, or the chosen one at its top: the sim kept the
   * position of an earlier opening, in the middle of an item after a change of resolution (measured 2026-10-30). The
   * position is a whole number of items, by the items' spacing on the screen, so that they stay whole.
   */
  private scrollPresetList(): void {
    const list = this.presetList ? this.presetList.element.querySelector<HTMLElement>('[name="List"]') : null;
    const scroll = list ? list.querySelector<RealScroll>('real-scroll') : null;
    if (!list || !scroll || window.getComputedStyle(list).display === 'none') return;
    const tops = Array.prototype.slice
      .call(list.querySelectorAll('virtual-list-wrapper'))
      .map((slot: HTMLElement) => slot.getBoundingClientRect())
      .filter((box: DOMRect) => box.height > 0)
      .map((box: DOMRect) => box.top)
      .sort((a: number, b: number) => a - b);
    const step = tops.length > 1 ? tops[1]! - tops[0]! : DROPDOWN_ITEM * uiUnit();
    const chosen = Array.from(this.presetItems.keys()).indexOf(this.weatherIndex);
    scroll.scrollToPosition(Math.min(scroll.maxScroll, Math.max(0, chosen) * step));
  }

  /**
   * The list of the added presets (the owner's choice, 2026-10-30) opens downwards, exactly to the bottom of the
   * panel's last buttons (multiplayer's), inside the panel (lower, it would pass under the search field), the sim's own
   * scroll for the items that do not fit. Whole items at rest: the room they leave goes into the list's top padding
   * (--msfs-ui-presets-top). With fewer than LIST_LEAST items there (traffic sections turned off), it opens upwards,
   * to the top of the column (`columnTop`, in the window).
   */
  private sizePresetList(columnTop: number, unit: number): void {
    const list = this.presetList;
    const host = list ? list.element.parentElement : null;
    if (!list || !host || this.panel.style.display === 'none') return;
    const box = host.getBoundingClientRect();
    const below = (this.panel.getBoundingClientRect().bottom - box.bottom) / unit;
    const count = this.presetItems.size;
    const fitBelow = Math.floor((below - DROPDOWN_PADDING) / DROPDOWN_ITEM);
    const up = fitBelow < LIST_LEAST;
    toggleClass(host, 'is-up', up);
    let size: number;
    let padding = DROPDOWN_EDGE;
    if (up) {
      size = Math.max(1, Math.min(count, Math.floor(((box.top - columnTop) / unit - DROPDOWN_PADDING) / DROPDOWN_ITEM))) * DROPDOWN_ITEM + DROPDOWN_PADDING;
    } else if (count <= fitBelow) {
      size = count * DROPDOWN_ITEM + DROPDOWN_PADDING;
    } else {
      // Half a pixel more: the engine rounds the height down, the list must reach the buttons' edge.
      size = below + 0.5 / unit;
      padding += below - (fitBelow * DROPDOWN_ITEM + DROPDOWN_PADDING);
    }
    list.set('List_Size', size.toFixed(2));
    setVariable(host.style, '--msfs-ui-presets-top', `${Math.floor(padding * unit)}px`);
  }

  /**
   * The preset grid in whole pixels, `width` wide: PRESETS_PER_ROW cells per row, GAP units between them (rounded down,
   * as the engine does for the other gaps), the pixels left over given one each to the first cells of the rows. In
   * units, the engine rounded each cell down and the rows ended 5 pixels short (measured 2026-10-30).
   */
  private layoutPresets(width: number, unit: number): void {
    const gap = Math.floor(GAP * unit);
    const free = width - (PRESETS_PER_ROW - 1) * gap;
    const base = Math.floor(free / PRESETS_PER_ROW);
    const extra = free - base * PRESETS_PER_ROW;
    for (const { host, start, span } of this.presetCells) {
      const column = start % PRESETS_PER_ROW;
      let cells = (span - 1) * gap;
      for (let at = column; at < column + span; at++) cells += base + (at < extra ? 1 : 0);
      const style = host.style;
      style.width = `${cells}px`;
      style.marginRight = column + span >= PRESETS_PER_ROW ? '0px' : `${gap}px`;
      style.marginTop = start >= PRESETS_PER_ROW ? `${gap}px` : '0px';
    }
  }

  /**
   * In pixels, the gap between the groups of the column: its free room down to the map buttons shared evenly, under
   * the widget, between the blocks shown, above and under the search field (the owner's choice, 2026-10-30). Every
   * block shown counts: the tab row of a sim's card (with the GAP under it), the sections (the METAR when a departure
   * shows it) or, on the Airport tab, the card. A fuller column narrows the gap, down to GAP, rather than push the
   * search field out (code review of 2026-10-30: the METAR, not counted, hid it whenever a departure was set).
   */
  private groupGap(widgetBottom: number, unit: number, card: HTMLElement | null, tab: Tab): number {
    const buttons = this.page.elt.querySelector(MAP_BUTTONS);
    if (!isShown(buttons)) return Math.floor(GROUP_GAP * unit);
    let blocks = Math.floor(SEARCH_HEIGHT * unit);
    let gaps = 2;
    if (card) blocks += (TAB_ROW + GAP) * unit;
    if (card && tab === 'airport') {
      blocks += card.getBoundingClientRect().height;
      gaps++;
    } else {
      const sections = this.panel.querySelectorAll<HTMLElement>('.msfs-ui-wx__section');
      for (let at = 0; at < sections.length; at++) {
        const high = sections[at]!.getBoundingClientRect().height;
        if (high === 0) continue;
        blocks += high;
        gaps++;
      }
    }
    // Rounded to the nearest pixel: the gap under the search field differs from the others by a few pixels at most
    // (rounded down, the room left over all went there: 48 pixels under it, 43 between the others at 1440 lines).
    return Math.max(Math.floor(GAP * unit), Math.round((buttons.getBoundingClientRect().top - widgetBottom - blocks) / gaps));
  }

  /** `gap` pixels above every section but the first (a hidden one, the METAR, takes no room). */
  private spaceSections(gap: number): void {
    const sections = this.panel.querySelectorAll<HTMLElement>('.msfs-ui-wx__section');
    for (let at = 1; at < sections.length; at++) sections[at]!.style.marginTop = `${gap}px`;
  }

  /**
   * The sim's search field at a place (pixels in the page), hidden (a map panel fills the column, as the bar), or
   * `home`, in its own place under the aircraft button (no room left in the column; the favourites then go under it):
   * its block marked SEARCH_CLASS and given the place in variables (written only on change: weather-bar.css). The
   * sim's own place back with the scope.
   */
  private placeSearch(where: { top: number; left: number; width: number } | 'hidden' | 'home'): void {
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

  /**
   * Moves the sim's card down so that it starts at `top` (window coordinate), by its top margin; its original style
   * is noted once and put back by `releaseCard`.
   */
  private holdCard(card: HTMLElement, top: number): void {
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

  private releaseCard(): void {
    const held = this.heldCard;
    if (!held) return;
    this.heldCard = null;
    held.element.style.marginTop = held.marginTop;
    held.element.style.visibility = held.visibility;
  }

  private chooseTab(tab: Tab): void {
    this.tab = tab;
    saveData(TAB_KEY, tab);
    this.tabButtons.forEach((button, key) => button.select(key === tab));
    this.layout();
  }

  // ----- Weather -----

  private renderWeather(): void {
    this.presetButtons.forEach((button, index) => button.select(index === this.weatherIndex));
    const preset = this.presets.find((candidate) => candidate.index === this.weatherIndex);
    if (this.weatherName) this.weatherName.textContent = preset ? translate(preset.title) : '';
    // The dropdown shows the added preset chosen, else its title; its items are given again only when that changes.
    const list = this.presetList;
    const manipulator = list ? list.manipulator<DropdownManipulator>() : null;
    const item = this.presetItems.get(this.weatherIndex);
    const shown = item ? this.weatherIndex : -1;
    if (manipulator && shown !== this.presetListShown) {
      this.presetListShown = shown;
      manipulator.setData(Array.from(this.presetItems.values()), item);
    }
  }

  private async chooseWeather(preset: WeatherPreset): Promise<void> {
    await store.Game.Weather.FlightConditions.SetWeatherPreset.request(String(preset.index));
    this.save({ weather: preset.index, weatherTitle: preset.title });
  }

  // ----- Time -----

  private refreshTimeMode(): void {
    if (!this.time) return;
    this.timeMode = currentTimeMode(this.timeMode, this.lastSent, this.time, this.liveBuffer, this.liveOffset, Date.now());
    this.timeButtons.forEach((button, mode) => button.select(mode === this.timeMode));
  }

  private onDepartureChanged(departure: FlightLocation): void {
    const location = departure && departure.worldLocation;
    const id = (departure && departure.id) || 0;
    if (id !== this.departureId) {
      this.departureId = id;
      this.departureIcao = (location && location.iCAO) || '';
      this.scheduleMetar();
    }
    const dms = (location && location.dms) || '';
    if (dms === this.departureDms) return;
    this.departureDms = dms;
    // Dawn, day… depend on the place: computed again for the new departure.
    if (this.timeMode && this.timeMode !== 'now') this.run('the time could not be changed', this.applyTime(this.timeMode));
  }

  private async chooseTime(mode: TimeMode): Promise<void> {
    await this.applyTime(mode);
    this.save({ time: mode });
  }

  private async applyTime(mode: TimeMode): Promise<void> {
    const time = this.time || ((await gameFlight.timeData()) as TimeInfo);
    if (mode === 'now') {
      this.lastSent = null;
      this.timeMode = 'now';
      if (this.liveBuffer) await flight.SetLiveOffset.request('0');
      else await flight.ResetToSystemTime.request('true');
      return;
    }
    const target = departureSeconds(mode, time, this.departureDms);
    this.timeMode = mode;
    if (this.liveBuffer) {
      const offset = liveOffsetFor(target, time);
      this.lastSent = { kind: 'offset', value: offset, at: Date.now() };
      await flight.SetLiveOffset.request(String(offset));
    } else {
      this.lastSent = { kind: 'time', value: target, at: Date.now() };
      await flight.SetDepartureTime.request(String(target));
    }
  }

  // ----- METAR -----
  // Real weather (`GetWeatherFromMetarAtLocation`) always; when Live is off, also the simulated weather
  // (`GetWeatherAtLocation`), the one of the flight. That is what the sim's airport card does.

  /**
   * Groups close changes (departure, preset, live mode) into one request. Any change also makes the request in
   * progress stale: its answer, even arriving during the wait, is ignored.
   */
  private scheduleMetar(): void {
    if (!this.metar) return;
    this.metarRequest++;
    clearTimeout(this.metarTimer);
    this.metarTimer = setTimeout(() => this.run('the METAR could not be read', this.refreshMetar()), METAR_DEBOUNCE_MS);
  }

  private async refreshMetar(): Promise<void> {
    const metar = this.metar;
    if (!metar) return;
    const request = ++this.metarRequest;
    const id = this.departureId;
    const icao = this.departureIcao;
    if (!id) {
      metar.section.style.display = 'none';
      return;
    }
    const weather = store.Game.Weather;
    // A failed request counts as no answer: the section then says "No METAR" for this departure.
    const ask = (node: StoreNode, what: string) =>
      answerOrNull(node.request(String(id)) as Promise<WeatherInfo>, WEATHER_TIMEOUT_MS, `the ${what} of ${icao || id} could not be read`);
    const answers = await Promise.all([ask(weather.GetWeatherFromMetarAtLocation, 'METAR'), this.liveWeather ? Promise.resolve(null) : ask(weather.GetWeatherAtLocation, 'simulated weather')]);
    const real = answers[0];
    const simulated = answers[1];
    if (request !== this.metarRequest || this.scope.disposed) return;

    const rules = real ? flightRules(real) : null;
    metar.icao.textContent = icao;
    metar.rules.style.display = rules && this.rulesBadge ? '' : 'none';
    if (rules && this.rulesBadge) {
      this.rulesBadge.set('Status', rules);
      this.rulesBadge.set('StatusColor', String(this.rulesBadge.value(`Color_${rules}`)));
    }
    metar.real.textContent = real ? weatherSummary(real) || 'No data' : 'No METAR';
    metar.simulated.textContent = simulated ? `Sim · ${weatherSummary(simulated)}` : '';
    metar.simulated.style.display = simulated ? '' : 'none';
    metar.section.style.display = '';
  }

  // ----- Traffic and multiplayer -----

  private renderConditions(): void {
    const conditions = this.conditions;
    for (const { group } of CONDITION_GROUPS) {
      const buttons: FlightConfigurationButton[] = (conditions && conditions[group]) || [];
      for (const button of buttons) {
        const component = this.conditionButtons.get(button.id);
        if (!component) continue;
        component.select(!!button.selected);
        component.disable(!!button.disabled);
      }
    }
  }

  private conditionButton(group: ConditionGroup, id: string): FlightConfigurationButton | undefined {
    const buttons = (this.conditions && this.conditions[group]) || [];
    return buttons.find((button) => button.id === id);
  }

  private async chooseCondition(group: ConditionGroup, id: string): Promise<void> {
    const current = this.conditionButton(group, id);
    if (!current || current.disabled || current.selected) return;
    await flight.SetFlightConditionConfiguration.request(id);
    this.save(group === 'airtraffic' ? { airtraffic: id } : { multiplayer: id });
  }

  // ----- Memory -----

  private save(change: Partial<Memory>): void {
    if (!this.settings.remember) return;
    saveData(MEMORY_KEY, Object.assign(loadData<Memory>(MEMORY_KEY, { weather: null, time: null }), change));
  }

  /** Applies the last choice; false when the screen closed before (nothing was applied). Every wait is bounded. */
  private async restore(): Promise<boolean> {
    const memory = loadData<Memory>(MEMORY_KEY, { weather: null, time: null });
    // Read now rather than taken from the watches, which may not have answered yet at the first display.
    const [time, liveBuffer, liveOffset, departure, weatherIndex] = await within(
      Promise.all([
        gameFlight.timeData() as Promise<TimeInfo>,
        gameFlight.isUsingLiveTimeBuffer() as Promise<boolean>,
        gameFlight.liveTimeOffset() as Promise<number>,
        gameFlight.departure() as Promise<FlightLocation>,
        gameFlight.weatherIndex() as Promise<number>,
      ]),
      'the flight conditions',
    );
    if (this.scope.disposed) return false;
    this.time = time;
    this.liveBuffer = !!liveBuffer;
    this.liveOffset = liveOffset || 0;
    this.departureDms = (departure && departure.worldLocation && departure.worldLocation.dms) || '';
    this.weatherIndex = weatherIndex;
    const weather = rememberedPreset(this.presets, memory.weather, memory.weatherTitle);
    if (weather && weather.index !== this.weatherIndex) {
      await within(store.Game.Weather.FlightConditions.SetWeatherPreset.request(String(weather.index)), 'the weather preset');
    }
    if (memory.time) await within(this.applyTime(memory.time), 'the time');
    const restored: string[] = [];
    if (this.settings.traffic) {
      // The conditions are read again: applying the weather may have changed them.
      await answerOrNull(flight.UpdateFlightConditions.request(''), WEATHER_TIMEOUT_MS, 'the flight conditions could not be requested');
      const conditions = await answerOrNull(flight.FlightConditions() as Promise<FlightConditions>, WEATHER_TIMEOUT_MS, 'the flight conditions could not be read');
      if (conditions) this.conditions = conditions;
      for (const { group } of CONDITION_GROUPS) {
        const id = memory[group];
        const target = id ? this.conditionButton(group, id) : undefined;
        if (!target || target.disabled || target.selected) continue;
        await within(flight.SetFlightConditionConfiguration.request(target.id), `the flight condition ${target.id}`);
        restored.push(target.id);
      }
    }
    const weatherText = weather ? `${weather.index} ${translate(weather.title)}` : 'none';
    log(`weather bar: last choice applied (weather ${weatherText}, time ${memory.time}${restored.length > 0 ? `, ${restored.join(', ')}` : ''})`);
    return true;
  }
}

