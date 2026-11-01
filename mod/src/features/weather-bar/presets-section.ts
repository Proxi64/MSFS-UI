// The weather bar's presets (bar.ts): the sim's presets in a grid of its icon buttons (Live on two cells, in a tile),
// the presets added by other packages in the sim's dropdown under it (the owner's choice, 2026-10-30), the name of the
// preset in the header.

import { answerWithin } from '../../core/async.ts';
import { el, toggleClass } from '../../core/dom.ts';
import { logError } from '../../core/log.ts';
import type { Scope } from '../../core/scope.ts';
import {
  COMPONENTS,
  type DropdownItem,
  type DropdownManipulator,
  type SimComponent,
} from '../../sim/components.ts';
import { DROPDOWN_EDGE, DROPDOWN_METRICS, dropdownListToward, scrollDropdownTo } from '../../sim/dropdown-list.ts';
import { GROUP_GAP } from '../../sim/freeflight-layout.ts';
import { translate } from '../../sim/localization.ts';
import { ANSWER_TIMEOUT_MS, readArray, store } from '../../sim/store.ts';
import { GAP, presetCellSizes, type PresetCell } from './bar-layout.ts';
import type { WeatherPreset } from './model.ts';
import { isSimPreset, rememberedPreset } from './presets.ts';
import { run, shortLabel, type MakeComponent, type Section } from './section.ts';

/** The live weather preset (its title in the sim's list), and the cells of the preset grid per row (as in the CSS). */
const LIVE_PRESET = 'TT:MENU.WEATHERTYPE_0DYNAMIC';
const PRESETS_PER_ROW = 6;
/**
 * The presets added by other packages, in the sim's dropdown under the grid: its list (sizes in sim/dropdown-list.ts)
 * opens downwards when at least LIST_LEAST items fit there (sizeList), never less than LIST_GAP_LEAST units above the
 * map's buttons and scale.
 */
const LIST_LEAST = 3;
const LIST_GAP_LEAST = 6;
/**
 * Free Flight's map buttons (legend, layers, display) at the bottom right, the map's scale left of them (under the
 * presets' list), the EFB button under them (measured 2026-11-01, 1.9.21). Direct children: the map layers' panel has
 * scale blocks of its own, the Flight Conditions widget and the bottom buttons a `Buttons` each.
 */
const MAP_BUTTONS = '[name="Worldmap_Filters"] > [name="Buttons"]';
const MAP_SCALE = '[name="Worldmap_Filters"] > [name="ScaleBlock"]';
const EFB_BUTTON = '[name="EFB"]';

export interface PresetEvents {
  /** A preset was clicked and applied. */
  chosen(preset: WeatherPreset): void;
}

export class PresetsSection {
  private readonly scope: Scope;
  private readonly events: PresetEvents;
  private presets: WeatherPreset[] = [];
  private readonly buttons = new Map<number, SimComponent>();
  /** The hosts of the preset grid: first cell and number of cells of each (laid out by `layout`). */
  private readonly cells: (PresetCell & { host: HTMLElement })[] = [];
  /**
   * The dropdown of the added presets (none without them), its items by preset index, the index it shows (-1: its
   * title, no added preset chosen; null: not drawn yet).
   */
  private list: SimComponent | null = null;
  private readonly items = new Map<number, DropdownItem>();
  private listShown: number | null = null;
  private name: HTMLElement | null = null;
  private index = -1;

  constructor(scope: Scope, events: PresetEvents) {
    this.scope = scope;
    this.events = events;
  }

  /** Reads the sim's presets (those enabled), before `build`; none when the sim does not give them (the bar shows the rest). */
  async load(): Promise<void> {
    const presets = await readArray<WeatherPreset>(store.Game.Weather.FlightConditions.PresetList, 'the weather presets').catch((error: unknown) => {
      logError('the weather presets could not be read', error);
      return [];
    });
    this.presets = presets.filter((preset) => preset && preset.enabled);
  }

  build(weather: Section, component: MakeComponent): void {
    this.name = weather.value;
    const grid = el('div', 'msfs-ui-wx__grid', weather.body);
    let cell = 0;
    // The sim's presets in the grid; the added ones (often hundreds, without their icons) in the dropdown under it.
    for (const preset of this.presets.filter(isSimPreset)) {
      // Live: the tile of the traffic buttons, "Live" written on it, two cells wide (the owner's choice, 2026-10-30).
      const live = preset.title === LIVE_PRESET;
      const span = live ? 2 : 1;
      const host = el('div', live ? 'msfs-ui-wx__icon msfs-ui-compact-tile' : 'msfs-ui-wx__icon', grid);
      this.cells.push({ host, start: cell, span });
      cell += span;
      this.scope.listen(host, 'mouseenter', () => {
        if (this.name) this.name.textContent = translate(preset.title);
      });
      this.scope.listen(host, 'mouseleave', () => this.render());
      const onReady = (created: SimComponent) => {
        this.buttons.set(preset.index, created);
        created.onClick(this.scope, () => run('the weather could not be changed', this.choose(preset)));
      };
      if (live) component(COMPONENTS.tileButton, host, { Title: shortLabel('TT:GENERIC.LIVE') }, onReady);
      else component(COMPONENTS.iconButtonSquared, host, { Icon: preset.iconUrl }, onReady);
    }
    const added = this.presets.filter((preset) => !isSimPreset(preset));
    if (added.length > 0) {
      for (const preset of added) {
        this.items.set(preset.index, {
          title: preset.title,
          subtitle: '',
          coma: '',
          selectedCallback: () => run('the weather could not be changed', this.choose(preset)),
        });
      }
      const host = el('div', 'msfs-ui-wx__presets', weather.body);
      component(COMPONENTS.dropdown, host, {}, (created) => {
        this.list = created;
        const manipulator = created.manipulator<DropdownManipulator>();
        if (manipulator) manipulator.setEmptyTitle(translate('TT:MENU.FLIGHTCONDITION.PRESETS'));
        // Once the click has opened the list (the sim's handler runs first).
        created.onClick(this.scope, () => this.scope.timeout(() => this.scrollList(), 0));
      });
    }
  }

  /** The sim's preset now in force. */
  show(index: number): void {
    this.index = index;
    this.render();
  }

  /** The preset read at once by the restore of the last choice (the watch may not have answered yet). */
  adopt(index: number): void {
    this.index = index;
  }

  /** The preset remembered (presets.ts: by title when the indexes moved), if any. */
  remembered(index: number | null, title: string | null | undefined): WeatherPreset | undefined {
    return rememberedPreset(this.presets, index, title);
  }

  render(): void {
    this.buttons.forEach((button, index) => button.select(index === this.index));
    const preset = this.presets.find((candidate) => candidate.index === this.index);
    if (this.name) this.name.textContent = preset ? translate(preset.title) : '';
    // The dropdown shows the added preset chosen, else its title; its items are given again only when that changes.
    const list = this.list;
    const manipulator = list ? list.manipulator<DropdownManipulator>() : null;
    const item = this.items.get(this.index);
    const shown = item ? this.index : -1;
    if (manipulator && shown !== this.listShown) {
      this.listShown = shown;
      manipulator.setData(Array.from(this.items.values()), item);
    }
  }

  /**
   * The preset grid in whole pixels, `width` wide: PRESETS_PER_ROW cells per row, GAP units between them (rounded down,
   * as the engine does for the other gaps; bar-layout.ts).
   */
  layout(width: number, unit: number): void {
    const sizes = presetCellSizes(width, Math.floor(GAP * unit), PRESETS_PER_ROW, this.cells);
    this.cells.forEach(({ host }, at) => {
      const size = sizes[at]!;
      const style = host.style;
      style.width = `${size.width}px`;
      style.marginRight = `${size.marginRight}px`;
      style.marginTop = `${size.marginTop}px`;
    });
  }

  /**
   * The list of the added presets opens downwards, over what is under it, toward the map's buttons (the owner's
   * choice, 2026-11-01): its first item at the sim's own edge under the dropdown, whole items only, as many as leave
   * above the higher of the map buttons and the map's scale the gap nearest the one between the map buttons and the
   * EFB button (at least LIST_GAP_LEAST units; dropdownListToward), the sim's own scroll for the others. Without the
   * map buttons on the page, down to the bottom of the `panel`. With fewer than LIST_LEAST items there, it opens
   * upwards, to the top of the column (`columnTop`, in the window). Measured at each layout pass of `page`, written when
   * it changes.
   */
  sizeList(columnTop: number, unit: number, panel: HTMLElement, page: HTMLElement): void {
    const list = this.list;
    const host = list ? list.element.parentElement : null;
    if (!list || !host || panel.style.display === 'none') return;
    const box = host.getBoundingClientRect();
    const limit = mapLimit(page, unit) || { top: panel.getBoundingClientRect().bottom, gap: 0, least: 0 };
    const sized = dropdownListToward(
      { count: this.items.size, below: (limit.top - box.bottom) / unit, gap: limit.gap / unit, least: limit.least, above: (box.top - columnTop) / unit, unit },
      DROPDOWN_METRICS,
      LIST_LEAST,
    );
    toggleClass(host, 'is-up', sized.up);
    list.set('List_Size', sized.size.toFixed(2));
  }

  /** Opened, the list of the added presets shows its first items, or the chosen one at its top (scrollDropdownTo). */
  private scrollList(): void {
    if (this.list) scrollDropdownTo(this.list.element, Array.from(this.items.keys()).indexOf(this.index), DROPDOWN_EDGE);
  }

  private async choose(preset: WeatherPreset): Promise<void> {
    await answerWithin(store.Game.Weather.FlightConditions.SetWeatherPreset.request(String(preset.index)), ANSWER_TIMEOUT_MS, 'the change of weather');
    this.events.chosen(preset);
  }
}

/**
 * Where the presets' list stops on `page` (sizeList), in the window's pixels: the top of the higher of the map buttons
 * and the map's scale, the gap wanted above it (the map buttons' own gap to the EFB button under them, GROUP_GAP units
 * without it) and the least one (in units); null without the map buttons.
 */
function mapLimit(page: HTMLElement, unit: number): { top: number; gap: number; least: number } | null {
  const shown = (selector: string) => {
    const element = page.querySelector<HTMLElement>(selector);
    const box = element ? element.getBoundingClientRect() : null;
    return box && box.height > 0 ? box : null;
  };
  const buttons = shown(MAP_BUTTONS);
  if (!buttons) return null;
  const scale = shown(MAP_SCALE);
  const efb = shown(EFB_BUTTON);
  return {
    top: scale ? Math.min(buttons.top, scale.top) : buttons.top,
    gap: efb && efb.top > buttons.bottom ? efb.top - buttons.bottom : GROUP_GAP * unit,
    least: LIST_GAP_LEAST,
  };
}
