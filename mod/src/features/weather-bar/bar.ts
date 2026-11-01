// The weather and time bar on Free Flight, under the sim's Flight Conditions widget, made of the sim's own components
// (src/sim/components.ts): the times of day (time-section.ts), the weather presets (presets-section.ts), the METAR
// (metar-section.ts), traffic and multiplayer (conditions-section.ts). The bar follows the sim's model, remembers the
// last choice, and lays Free Flight's right column out, with the sim's cards behind tabs (right-column.ts).

import { answerOrNull, answerWithin } from '../../core/async.ts';
import { el, uiUnit } from '../../core/dom.ts';
import { log, logError } from '../../core/log.ts';
import type { Scope } from '../../core/scope.ts';
import { loadData, saveData } from '../../core/storage.ts';
import { PANEL_INPUT_GROUP } from '../../core/theme.ts';
import type { Settings } from '../../generated/catalog.ts';
import { createComponent } from '../../sim/components.ts';
import { isOnScreen, isShown, type Manipulator } from '../../sim/screens.ts';
import { FLIGHT_CONDITIONS_WIDGET, GROUP_GAP } from '../../sim/freeflight-layout.ts';
import { translate } from '../../sim/localization.ts';
import { store, watch, type TimeInfo } from '../../sim/store.ts';
import { GAP } from './bar-layout.ts';
import { CONDITION_GROUPS, ConditionsSection } from './conditions-section.ts';
import { MetarSection } from './metar-section.ts';
import { memoryFrom, type Memory } from './memory.ts';
import type { FlightConditions, FlightLocation } from './model.ts';
import { PresetsSection } from './presets-section.ts';
import { RightColumn } from './right-column.ts';
import { createSection, type MakeComponent, type Section } from './section.ts';
import { TimeSection } from './time-section.ts';

const MEMORY_KEY = 'WEATHER_BAR';
/** Longest wait for a request of the restore. */
const WEATHER_TIMEOUT_MS = 4000;
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

export class WeatherBar {
  private readonly page: Manipulator;
  private readonly scope: Scope;
  private readonly settings: Settings['weatherBar'];
  private readonly panel = el('div', 'msfs-ui-panel msfs-ui-wx');
  private readonly column: RightColumn;
  private readonly times: TimeSection;
  private readonly presets: PresetsSection;
  private readonly metar: MetarSection | null;
  private readonly traffic: ConditionsSection | null;
  /** The last choice is tried once per display of the screen, until it has been applied once in the session. */
  private restoreTried = false;

  constructor(page: Manipulator, scope: Scope, settings: Settings['weatherBar']) {
    this.page = page;
    this.scope = scope;
    this.settings = settings;
    this.column = new RightColumn(page, scope, () => this.layout());
    this.times = new TimeSection(scope, { chosen: (mode) => this.save({ time: mode }) });
    this.presets = new PresetsSection(scope, { chosen: (preset) => this.save({ weather: preset.index, weatherTitle: preset.title }) });
    this.metar = settings.metar ? new MetarSection(scope) : null;
    this.traffic = settings.traffic ? new ConditionsSection(scope, { chosen: (group, id) => this.save(group === 'airtraffic' ? { airtraffic: id } : { multiplayer: id }) }) : null;
  }

  async mount(): Promise<void> {
    await this.presets.load();
    if (this.scope.disposed) return;
    const pending = this.build();
    this.scope.append(this.page.elt, this.panel);
    this.scope.append(this.page.elt, this.column.tabs);
    this.scope.add(() => this.column.releaseCard());
    // The model is followed at once, so that clicks and the restore never act on default values; the components
    // load in parallel and each one is drawn from the model as soon as it is ready.
    this.watchModel();
    this.layout();
    this.scope.interval(() => this.layout(), 250);
    await Promise.all(pending);
  }

  private watchModel(): void {
    const scope = this.scope;
    const metar = this.metar;
    const traffic = this.traffic;
    watch<number>(scope, gameFlight.weatherIndex, (index) => {
      this.presets.show(index);
      if (metar) metar.schedule();
    });
    if (metar) {
      watch<boolean>(scope, gameFlight.isLiveWeather, (live) => metar.setLiveWeather(!!live));
      scope.add(() => metar.cancel());
    }
    if (traffic) {
      watch<FlightConditions>(scope, flight.FlightConditions, (conditions) => traffic.show(conditions));
      // The sim publishes the flight conditions only after this request (as its own panel does).
      flight.UpdateFlightConditions.request('').catch((error: unknown) => logError('the flight conditions could not be requested', error));
    }
    watch<TimeInfo>(scope, gameFlight.timeData, (time) => this.times.setTime(time));
    watch<boolean>(scope, gameFlight.isUsingLiveTimeBuffer, (value) => this.times.setLiveBuffer(!!value));
    watch<number>(scope, gameFlight.liveTimeOffset, (value) => this.times.setLiveOffset(value || 0));
    watch<FlightLocation>(scope, gameFlight.departure, (departure) => this.onDepartureChanged(departure));
    watch<boolean>(scope, store.Elements.FlightConditions.InteractionBlocked, (blocked) => {
      if (blocked) this.panel.classList.add('is-blocked');
      else this.panel.classList.remove('is-blocked');
    });
  }

  private onDepartureChanged(departure: FlightLocation): void {
    const location = departure && departure.worldLocation;
    if (this.metar) this.metar.setDeparture((departure && departure.id) || 0, (location && location.iCAO) || '');
    this.times.setDeparture((location && location.dms) || '');
  }

  // ----- Construction -----

  /** Builds the markup and starts creating the sim's components; returns their pending creations. */
  private build(): Promise<unknown>[] {
    const pending: Promise<unknown>[] = [];
    const component: MakeComponent = (guid, host, attributes, onReady) => {
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

    // Each section is a card of its own (section.ts): the panel only keeps the mouse, its gaps included.
    this.panel.setAttribute('data-input-group', PANEL_INPUT_GROUP);
    this.column.build(component);
    // Times of day first, titled "Today" (the owner's choice, 2026-10-30): the sim's widget above shows the time. The
    // METAR last (the owner's choice, 2026-10-31): it shows with a departure and moves nothing above it.
    this.times.build(this.section(translate('TT:WEATHER.TODAY')).body, component);
    this.presets.build(this.section('Weather'), component);
    if (this.traffic) this.traffic.build((title) => this.section(title), component);
    if (this.metar) this.metar.build(this.section('METAR'), component);
    return pending;
  }

  private section(title: string): Section {
    return createSection(this.panel, title);
  }

  private render(): void {
    this.presets.render();
    this.times.render();
    if (this.traffic) this.traffic.render();
    this.column.renderTabs();
  }

  // ----- Layout -----

  /**
   * Under the Flight Conditions widget, across its width; hidden when the widget is (another panel is open). Every
   * block at a place that does not depend on what the column shows (the owner's wish, 2026-10-31: they moved at each
   * selection): the tabs GROUP_GAP under the widget (where the sim draws its own cards, level with the search field
   * under the aircraft button), then GAP under them the bar, or the sim's card when an airport or a traffic aircraft is
   * selected and its tab chosen (right-column.ts); GAP between the sections. A panel of the map buttons (MAP_PANELS)
   * takes the place as in the sim: the bar and its tabs are hidden while it is open, the card back in its own place.
   */
  private layout(): void {
    const anchor = this.page.elt.querySelector(FLIGHT_CONDITIONS_WIDGET);
    if (!isShown(anchor) || MAP_PANELS.some((selector) => isOnScreen(this.page.elt.querySelector<HTMLElement>(selector)))) {
      this.panel.style.display = 'none';
      this.column.hide();
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
    const left = `${rect.left - origin.left}px`;
    const width = `${rect.width}px`;
    style.left = left;
    style.width = width;
    this.presets.layout(Math.floor(rect.width), unit);

    // Gaps in whole pixels, as the engine draws the others.
    const gap = Math.floor(GAP * unit);
    this.spaceSections(gap);
    const card = this.column.visibleCard();
    const tabsTop = rect.bottom - origin.top + Math.floor(GROUP_GAP * unit);
    const top = tabsTop + this.column.showTabs(card, { left, width, top: tabsTop }) + gap;
    const tab = this.column.shownTab();
    if (card) {
      this.column.holdCard(card.element, top + origin.top);
      card.element.style.visibility = tab === 'airport' ? '' : 'hidden';
    } else this.column.releaseCard();
    style.display = tab === 'weather' ? '' : 'none';
    style.top = `${top}px`;
    this.presets.sizeList(rect.top, unit, this.panel, this.page.elt);
  }

  /** `gap` pixels above every section but the first (a hidden one, the METAR, takes no room). */
  private spaceSections(gap: number): void {
    const sections = this.panel.querySelectorAll<HTMLElement>('.msfs-ui-wx__section');
    for (let at = 1; at < sections.length; at++) sections[at]!.style.marginTop = `${gap}px`;
  }

  // ----- Memory -----

  private save(change: Partial<Memory>): void {
    if (!this.settings.remember) return;
    saveData(MEMORY_KEY, Object.assign(memoryFrom(loadData<unknown>(MEMORY_KEY, null)), change));
  }

  /** Applies the last choice; false when the screen closed before (nothing was applied). Every wait is bounded. */
  private async restore(): Promise<boolean> {
    const memory = memoryFrom(loadData<unknown>(MEMORY_KEY, null));
    // Read now rather than taken from the watches, which may not have answered yet at the first display.
    const [time, liveBuffer, liveOffset, departure, weatherIndex] = await answerWithin(
      Promise.all([
        gameFlight.timeData() as Promise<TimeInfo>,
        gameFlight.isUsingLiveTimeBuffer() as Promise<boolean>,
        gameFlight.liveTimeOffset() as Promise<number>,
        gameFlight.departure() as Promise<FlightLocation>,
        gameFlight.weatherIndex() as Promise<number>,
      ]),
      WEATHER_TIMEOUT_MS,
      'the flight conditions',
    );
    if (this.scope.disposed) return false;
    this.times.adopt({
      time,
      liveBuffer: !!liveBuffer,
      liveOffset: liveOffset || 0,
      departureDms: (departure && departure.worldLocation && departure.worldLocation.dms) || '',
    });
    this.presets.adopt(weatherIndex);
    const weather = this.presets.remembered(memory.weather, memory.weatherTitle);
    if (weather && weather.index !== weatherIndex) {
      await answerWithin(store.Game.Weather.FlightConditions.SetWeatherPreset.request(String(weather.index)), WEATHER_TIMEOUT_MS, 'the weather preset');
    }
    if (memory.time) await answerWithin(this.times.apply(memory.time), WEATHER_TIMEOUT_MS, 'the time');
    const restored: string[] = [];
    const traffic = this.traffic;
    if (traffic) {
      // The conditions are read again: applying the weather may have changed them.
      await answerOrNull(flight.UpdateFlightConditions.request(''), WEATHER_TIMEOUT_MS, 'the flight conditions could not be requested');
      const conditions = await answerOrNull(flight.FlightConditions() as Promise<FlightConditions>, WEATHER_TIMEOUT_MS, 'the flight conditions could not be read');
      if (conditions) traffic.adopt(conditions);
      for (const { group } of CONDITION_GROUPS) {
        const id = memory[group];
        const target = id ? traffic.button(group, id) : undefined;
        if (!target || target.disabled || target.selected) continue;
        await answerWithin(flight.SetFlightConditionConfiguration.request(target.id), WEATHER_TIMEOUT_MS, `the flight condition ${target.id}`);
        restored.push(target.id);
      }
    }
    const weatherText = weather ? `${weather.index} ${translate(weather.title)}` : 'none';
    log(`weather bar: last choice applied (weather ${weatherText}, time ${memory.time}${restored.length > 0 ? `, ${restored.join(', ')}` : ''})`);
    return true;
  }
}
