// The weather bar's METAR (bar.ts): the departure's real weather (`GetWeatherFromMetarAtLocation`) always and, when Live
// is off, also the simulated weather (`GetWeatherAtLocation`), the one of the flight: what the sim's airport card does.
// Its flight category in the sim's badge.

import { answerOrNull } from '../../core/async.ts';
import { el } from '../../core/dom.ts';
import type { Scope } from '../../core/scope.ts';
import { COMPONENTS, type SimComponent } from '../../sim/components.ts';
import { store, type StoreNode } from '../../sim/store.ts';
import type { WeatherInfo } from './model.ts';
import { run, type MakeComponent, type Section } from './section.ts';
import { flightRules, weatherSummary } from './weather-text.ts';

/** Longest wait for a weather request; past it, the line says so. */
const WEATHER_TIMEOUT_MS = 4000;
/** Close changes (departure, preset, live mode) are grouped into one weather request. */
const METAR_DEBOUNCE_MS = 300;

export class MetarSection {
  private readonly scope: Scope;
  private elements: { section: HTMLElement; icao: HTMLElement; rules: HTMLElement; real: HTMLElement; simulated: HTMLElement } | null = null;
  private rulesBadge: SimComponent | null = null;
  private departureId = 0;
  private departureIcao = '';
  private liveWeather = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  /** Number of the last weather request: an older answer is ignored. */
  private request = 0;

  constructor(scope: Scope) {
    this.scope = scope;
  }

  build(metar: Section, component: MakeComponent): void {
    metar.body.classList.add('msfs-ui-wx__body--text');
    const icao = el('span', 'msfs-ui-wx__icao', metar.value);
    const rules = el('div', 'msfs-ui-wx__rules', metar.value);
    component(COMPONENTS.flightRules, rules, {}, (created) => (this.rulesBadge = created));
    this.elements = {
      section: metar.section,
      icao,
      rules,
      real: el('div', 'msfs-ui-wx__line', metar.body),
      simulated: el('div', 'msfs-ui-wx__line msfs-ui-wx__line--sim', metar.body),
    };
    metar.section.style.display = 'none';
  }

  setLiveWeather(live: boolean): void {
    this.liveWeather = live;
    this.schedule();
  }

  setDeparture(id: number, icao: string): void {
    if (id === this.departureId) return;
    this.departureId = id;
    this.departureIcao = icao;
    this.schedule();
  }

  /**
   * Groups close changes (departure, preset, live mode) into one request. Any change also makes the request in
   * progress stale: its answer, even arriving during the wait, is ignored.
   */
  schedule(): void {
    if (!this.elements) return;
    this.request++;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => run('the METAR could not be read', this.refresh()), METAR_DEBOUNCE_MS);
  }

  /** No request left waiting (the screen closes). */
  cancel(): void {
    clearTimeout(this.timer);
  }

  private async refresh(): Promise<void> {
    const metar = this.elements;
    if (!metar) return;
    const request = ++this.request;
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
    if (request !== this.request || this.scope.disposed) return;

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
}
