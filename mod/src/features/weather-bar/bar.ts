// The weather and time bar on Free Flight, under the sim's Flight Conditions widget, made of the sim's own components
// (src/sim/components.ts): icon buttons for the weather presets, choice tiles for the times of day, traffic and
// multiplayer, tabs and the flight category of the METAR.

import { withTimeout } from '../../core/async.ts';
import { el, uiUnit } from '../../core/dom.ts';
import { log, logError } from '../../core/log.ts';
import type { Scope } from '../../core/scope.ts';
import { loadData, saveData } from '../../core/storage.ts';
import { addPanelLayers } from '../../core/theme.ts';
import type { Settings } from '../../generated/catalog.ts';
import { COMPONENTS, createComponent, type ComponentGuid, type SimComponent } from '../../sim/components.ts';
import { isOnScreen, isShown, type Manipulator } from '../../sim/screens.ts';
import { readArray, store, translate, watch, type StoreNode } from '../../sim/store.ts';
import type { FlightConditions, FlightConfigurationButton, FlightLocation, TimeInfo, WeatherInfo, WeatherPreset } from './model.ts';
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
/** Gap between the sim's widget and the bar, in layout units. */
const WIDGET_GAP = 10;
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
/** The map buttons (info, layers, filters) under the column, and the EFB button under them. */
const MAP_BUTTONS = '[name="Worldmap_Filters"]';
const EFB_BUTTON = '[name="TextButton_Large_EFB"]';

const flight = store.Game.CurrentFlight;
const gameFlight = flight.GameFlight;

declare global {
  interface Window {
    /** The last choice is applied once per sim session, not at every reload of the mod. */
    __msfsUiWeatherRestored?: boolean;
  }
}

/** A translated label without its final precision in brackets. */
function shortLabel(key: string): string {
  return translate(key).replace(/\s*\([^)]*\)\s*$/, '');
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
  private readonly timeButtons = new Map<TimeMode, SimComponent>();
  private readonly conditionButtons = new Map<string, SimComponent>();
  private readonly tabButtons = new Map<Tab, SimComponent>();
  private rulesBadge: SimComponent | null = null;

  private weatherName: HTMLElement | null = null;
  private timeValue: HTMLElement | null = null;
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
      if (this.timeValue) this.timeValue.textContent = time.localTime.valueStr;
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

    const weather = this.section('Weather');
    this.weatherName = weather.value;
    const grid = el('div', 'msfs-ui-wx__grid', weather.body);
    for (const preset of this.presets) {
      const host = el('div', 'msfs-ui-wx__icon', grid);
      this.scope.listen(host, 'mouseenter', () => {
        if (this.weatherName) this.weatherName.textContent = translate(preset.title);
      });
      this.scope.listen(host, 'mouseleave', () => this.renderWeather());
      component(COMPONENTS.iconButtonSquared, host, { Icon: preset.iconUrl }, (created) => {
        this.presetButtons.set(preset.index, created);
        created.onClick(this.scope, () => this.run('the weather could not be changed', this.chooseWeather(preset.index)));
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

    const time = this.section('Time');
    this.timeValue = time.value;
    const row = el('div', 'msfs-ui-wx__row', time.body);
    for (const mode of TIME_MODES) {
      const host = el('div', 'msfs-ui-wx__choice msfs-ui-compact-tile', row);
      component(COMPONENTS.tileButton, host, { Title: TIME_LABELS[mode] }, (created) => {
        this.timeButtons.set(mode, created);
        created.onClick(this.scope, () => this.run('the time could not be changed', this.chooseTime(mode)));
      });
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
   * much, and only the element of the chosen tab is visible.
   */
  private layout(): void {
    const anchor = this.page.elt.querySelector(WIDGET);
    if (!isShown(anchor)) {
      this.panel.style.display = 'none';
      this.tabs.style.display = 'none';
      this.releaseCard();
      return;
    }
    // At start-up the sim activates Free Flight behind the scenes, then resets the flight conditions: the last choice
    // is applied once the bar is really on the screen.
    if (this.settings.remember && !window.__msfsUiWeatherRestored) {
      window.__msfsUiWeatherRestored = true;
      this.run('the last choice of the weather bar could not be applied', this.restore());
    }
    const origin = this.page.elt.getBoundingClientRect();
    const rect = anchor.getBoundingClientRect();
    const unit = uiUnit();
    const style = this.panel.style;
    style.display = '';
    style.left = `${rect.left - origin.left}px`;
    style.width = `${rect.width}px`;
    let top = rect.bottom - origin.top + WIDGET_GAP * unit;

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
    if (!card) {
      this.tabs.style.display = 'none';
      this.releaseCard();
      style.top = `${top}px`;
      this.alignBottom(top + origin.top);
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
    // Without both tabs (a component that failed to load), the sim's card keeps the place: it cannot be hidden for good.
    const tab: Tab = this.tabButtons.size === 2 ? this.tab : 'airport';
    card.style.visibility = tab === 'airport' ? '' : 'hidden';
    style.display = tab === 'weather' ? '' : 'none';
    style.top = `${top}px`;
    this.alignBottom(top + origin.top);
  }

  /**
   * The panel ends above the map buttons with the same gap as between the map buttons and the EFB button, whatever
   * its content: its height is fixed and the sections share the free space (weather-bar.css). When the content does
   * not fit (another screen or interface scale), the panel takes its natural height. `top` is in window coordinates.
   */
  private alignBottom(top: number): void {
    const buttons = this.page.elt.querySelector(MAP_BUTTONS);
    const efb = this.page.elt.querySelector(EFB_BUTTON);
    let height = '';
    if (isShown(buttons) && isShown(efb)) {
      const below = buttons.getBoundingClientRect();
      const bottom = below.top - (efb.getBoundingClientRect().top - below.bottom);
      if (bottom > top && this.naturalHeight() <= bottom - top) height = `${Math.round(bottom - top)}px`;
    }
    if (this.panel.style.height !== height) this.panel.style.height = height;
  }

  /** Height of the content without the shared free space: headers plus the content of each section's body. */
  private naturalHeight(): number {
    let total = 0;
    const sections = this.panel.querySelectorAll<HTMLElement>('.msfs-ui-wx__section');
    for (let i = 0; i < sections.length; i++) {
      const section = sections[i]!;
      if (section.style.display === 'none') continue;
      const header = section.querySelector('.msfs-ui-header');
      const body = section.querySelector<HTMLElement>('.msfs-ui-wx__body');
      if (header) total += header.getBoundingClientRect().height;
      if (!body) continue;
      const style = window.getComputedStyle(body);
      total += parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
      for (let j = 0; j < body.children.length; j++) {
        const child = body.children[j] as HTMLElement;
        if (child.style.display === 'none') continue;
        const childStyle = window.getComputedStyle(child);
        total += child.getBoundingClientRect().height + parseFloat(childStyle.marginTop) + parseFloat(childStyle.marginBottom);
      }
    }
    return total;
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
  }

  private async chooseWeather(index: number): Promise<void> {
    await store.Game.Weather.FlightConditions.SetWeatherPreset.request(String(index));
    this.save({ weather: index });
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

  private async restore(): Promise<void> {
    const memory = loadData<Memory>(MEMORY_KEY, { weather: null, time: null });
    // Read now rather than taken from the watches, which may not have answered yet at the first display.
    const [time, liveBuffer, liveOffset, departure, weatherIndex] = await Promise.all([
      gameFlight.timeData() as Promise<TimeInfo>,
      gameFlight.isUsingLiveTimeBuffer() as Promise<boolean>,
      gameFlight.liveTimeOffset() as Promise<number>,
      gameFlight.departure() as Promise<FlightLocation>,
      gameFlight.weatherIndex() as Promise<number>,
    ]);
    if (this.scope.disposed) return;
    this.time = time;
    this.liveBuffer = !!liveBuffer;
    this.liveOffset = liveOffset || 0;
    this.departureDms = (departure && departure.worldLocation && departure.worldLocation.dms) || '';
    this.weatherIndex = weatherIndex;
    if (memory.weather !== null && memory.weather !== this.weatherIndex && this.presets.some((preset) => preset.index === memory.weather)) {
      await store.Game.Weather.FlightConditions.SetWeatherPreset.request(String(memory.weather));
    }
    if (memory.time) await this.applyTime(memory.time);
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
        await flight.SetFlightConditionConfiguration.request(target.id);
        restored.push(target.id);
      }
    }
    log(`weather bar: last choice applied (weather ${memory.weather}, time ${memory.time}${restored.length > 0 ? `, ${restored.join(', ')}` : ''})`);
  }
}

