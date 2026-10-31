// The current aircraft's statistics in the setup panel (panel.ts; the owner's wish, 2026-10-30: the room under the
// variants put to use), in the sim's own rows, above the tail number; the panel shows them only when its lists keep
// all the room they need.

import { el } from '../../core/dom.ts';
import { logError } from '../../core/log.ts';
import type { Scope } from '../../core/scope.ts';
import { COMPONENTS, createComponent, type SimComponent } from '../../sim/components.ts';
import { removeFromList } from '../../sim/real-scroll.ts';

/** One statistic of the current aircraft (`CurrentAircraft().details`), as the sim's Statistics block shows it. */
export interface AircraftStatistic {
  name: string;
  valueStr: string;
  unit: string;
  /** `ICON`: the value is an icon (`html`, a `coui://` file), as the landing surface. */
  type: string;
  html: string;
  /** 1: the sim's arrow beside the value. */
  quality: number;
}

/** The sim's row of its Statistics block (FleetDetailsListitemManipulator): it writes the title and the value with its unit. */
interface StatisticRowManipulator {
  setData(statistic: AircraftStatistic): void;
}

export class StatisticRows {
  readonly element = el('div', 'msfs-ui-setup__stats');
  private readonly rowsHost = el('div', 'msfs-ui-setup__stats-rows', this.element);
  private readonly scope: Scope;
  private statistics: AircraftStatistic[] = [];
  private rows: { host: HTMLElement; row: SimComponent | null }[] = [];
  private rowsScope: Scope | null = null;

  constructor(scope: Scope) {
    this.scope = scope;
  }

  get count(): number {
    return this.statistics.length;
  }

  /**
   * The rows of the sim's Statistics block (its Fleet_Details_Listitem), one per statistic: built again when their
   * number changes, otherwise given the new values. The sim writes each title and value (with the unit of the
   * player's settings); its rows alternate dark and light, the first dark.
   */
  render(statistics: AircraftStatistic[]): void {
    this.statistics = statistics;
    if (statistics.length !== this.rows.length) {
      if (this.rowsScope) this.rowsScope.dispose();
      removeFromList(this.rows.map((entry) => entry.host));
      const scope = (this.rowsScope = this.scope.child());
      this.rows = statistics.map(() => ({ host: el('div', 'msfs-ui-setup__stat', this.rowsHost), row: null }));
      this.rows.forEach((entry, at) => {
        createComponent(scope, COMPONENTS.statisticRow, entry.host).then(
          (row) => {
            if (scope.disposed) return;
            entry.row = row;
            this.fill(row, at);
          },
          (error: unknown) => logError('a statistic of the setup panel could not be created', error),
        );
      });
      return;
    }
    this.rows.forEach((entry, at) => {
      if (entry.row) this.fill(entry.row, at);
    });
  }

  private fill(row: SimComponent, at: number): void {
    const statistic = this.statistics[at];
    const manipulator = row.manipulator<StatisticRowManipulator>();
    if (!statistic || !manipulator) return;
    manipulator.setData(statistic);
    row.updateVisual({ dark: at % 2 === 0, arrow: statistic.quality === 1, icon: statistic.type === 'ICON' });
  }
}
