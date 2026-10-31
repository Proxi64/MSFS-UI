// The weather bar's air traffic and multiplayer (bar.ts): the buttons of the sim's Flight Conditions panel as the sim's
// tiles, one section per group.

import { el } from '../../core/dom.ts';
import type { Scope } from '../../core/scope.ts';
import { COMPONENTS, type SimComponent } from '../../sim/components.ts';
import { translate } from '../../sim/localization.ts';
import { store } from '../../sim/store.ts';
import type { FlightConditions, FlightConfigurationButton } from './model.ts';
import { run, shortLabel, type MakeComponent, type Section } from './section.ts';

export type ConditionGroup = 'airtraffic' | 'multiplayer';

/**
 * Groups of the flight-condition buttons, with the translation keys of their labels: those of the sim's panel
 * (Flight_Conditions_General.uxml). Their final precision in brackets ("AI (Experimental)", "Off (Group Only)") is
 * removed: it does not fit in a third of the bar.
 */
export const CONDITION_GROUPS: { group: ConditionGroup; title: string; labels: Record<string, string> }[] = [
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

const flight = store.Game.CurrentFlight;

export interface ConditionEvents {
  /** A button was clicked and applied. */
  chosen(group: ConditionGroup, id: string): void;
}

export class ConditionsSection {
  private readonly scope: Scope;
  private readonly events: ConditionEvents;
  private readonly buttons = new Map<string, SimComponent>();
  private conditions: FlightConditions | null = null;

  constructor(scope: Scope, events: ConditionEvents) {
    this.scope = scope;
    this.events = events;
  }

  /** One section per group, titled as in the sim's Flight Conditions panel ("Air traffic", "Multiplayer"). */
  build(section: (title: string) => Section, component: MakeComponent): void {
    for (const { group, title, labels } of CONDITION_GROUPS) {
      const buttons = el('div', 'msfs-ui-wx__row', section(translate(title)).body);
      for (const id of Object.keys(labels)) {
        const host = el('div', 'msfs-ui-wx__choice msfs-ui-compact-tile', buttons);
        component(COMPONENTS.tileButton, host, { Title: shortLabel(labels[id]!) }, (created) => {
          this.buttons.set(id, created);
          created.onClick(this.scope, () => run('the flight condition could not be changed', this.choose(group, id)));
        });
      }
    }
  }

  show(conditions: FlightConditions): void {
    this.conditions = conditions;
    this.render();
  }

  /** The conditions read at once by the restore of the last choice. */
  adopt(conditions: FlightConditions): void {
    this.conditions = conditions;
  }

  render(): void {
    const conditions = this.conditions;
    for (const { group } of CONDITION_GROUPS) {
      const buttons: FlightConfigurationButton[] = (conditions && conditions[group]) || [];
      for (const button of buttons) {
        const component = this.buttons.get(button.id);
        if (!component) continue;
        component.select(!!button.selected);
        component.disable(!!button.disabled);
      }
    }
  }

  button(group: ConditionGroup, id: string): FlightConfigurationButton | undefined {
    const buttons = (this.conditions && this.conditions[group]) || [];
    return buttons.find((button) => button.id === id);
  }

  private async choose(group: ConditionGroup, id: string): Promise<void> {
    const current = this.button(group, id);
    if (!current || current.disabled || current.selected) return;
    await flight.SetFlightConditionConfiguration.request(id);
    this.events.chosen(group, id);
  }
}
