// The setup panel in the aircraft selection, in place of the statistics (left column): variant (variants.ts), liveries
// as thumbnails (livery-thumbnails.ts, with a heart: favourite liveries, shown first), the aircraft's statistics
// (statistics.ts), editable tail number (tail-field.ts), shortcuts to Fuel and Identification. Made of the sim's own
// components. Everything goes through the sim's configurator (`Game.Aircraft.Configurator`), which the sim already
// sets on the aircraft chosen in the list; no 3D preview loads. The panel places itself and shares its room between
// the lists (setup-layout.ts).

import { el, setVariable, toggleClass, uiUnit } from '../../core/dom.ts';
import { logError } from '../../core/log.ts';
import type { Scope } from '../../core/scope.ts';
import { PANEL_INPUT_GROUP } from '../../core/theme.ts';
import { revealPosition, type Rows } from '../../core/virtual-list.ts';
import { COMPONENTS, createComponent } from '../../sim/components.ts';
import { chooseLivery, chooseVariant, readConfigurator, setFavoriteLivery, syncConfigurator, type ConfiguratorState } from '../../sim/configurator.ts';
import { FAVORITE_LIVERIES_CHANGED } from '../../sim/favorites.ts';
import { TAIL_NUMBER, type Identification } from '../../sim/liveries.ts';
import { translate } from '../../sim/localization.ts';
import { isShown, type Manipulator } from '../../sim/screens.ts';
import { scrollBarWidth, type RealScroll } from '../../sim/real-scroll.ts';
import { liveriesInGallery, setSetupPanelShown } from '../../sim/selection-layout.ts';
import { store, watch } from '../../sim/store.ts';
import { LiveryThumbnails } from './livery-thumbnails.ts';
import {
  GAP,
  LIVERY_COLUMNS,
  overflows,
  PADDING_TOP,
  rowCount,
  statisticsRoom,
  thumbnailSize,
  VARIANT_HEIGHT,
  variantsHeight,
} from './setup-layout.ts';
import { StatisticRows, type AircraftStatistic } from './statistics.ts';
import { TailNumberField } from './tail-field.ts';
import { VariantsList } from './variants.ts';

const RELOAD_DELAY_MS = 80;
/** A row of the statistics, in layout units (the sim's rows: 48 pixels at 1440 lines). */
const STATISTIC_HEIGHT = 36;
/** Room left on the right of a list that scrolls, for the sim's scroll bar, in layout units. */
const SCROLL_BAR_ROOM = 24;
const FLOW = {
  fuel: 'GOTO_WORLDMAP_PLANECONFIGURATION_FUEL_XML',
  identification: 'GOTO_WORLDMAP_PLANECONFIGURATION_IDENTIFICATION_XML',
};
const STATISTICS = '[name="Fleet_Details"]';

const aircraft = store.Game.Aircraft;
const configurator = aircraft.Configurator;

/** Opens a screen of the sim by its navigation event (as its own tabs do). */
function launchFlow(event: string): void {
  engine.trigger('LAUNCH_FLOW_EVENT_TO_GLOBAL_FLOW_FROM_VIEW', event, '');
}

export class SetupPanel {
  private readonly page: Manipulator;
  private readonly scope: Scope;
  private readonly root = el('div', 'msfs-ui-root msfs-ui-setup');
  private readonly variants: VariantsList;
  private readonly liveries: LiveryThumbnails;
  private readonly statistics: StatisticRows;
  private readonly tail: TailNumberField;
  /** The parts between and around the two lists (headers, tail number, buttons): the lists share the rest. */
  private fixedParts: HTMLElement[] = [];
  /** Heights last given to the lists, in pixels: their scrolling element is told when they change. */
  private listHeights = '';
  /** Width of the panel at the last measure of the variants. */
  private fittedWidth = 0;

  /** The configurator as last read: the choices are made on it. */
  private state: ConfiguratorState = { variants: [], liveries: [], details: null, variationTitle: '' };

  private reloadTimer: ReturnType<typeof setTimeout> | undefined;
  /** Number of the last reload: an older one that finishes later is ignored. */
  private reloadNumber = 0;

  constructor(page: Manipulator, scope: Scope) {
    this.page = page;
    this.scope = scope;
    const relayout = () => this.layout();
    this.variants = new VariantsList(scope, { choose: (id) => this.choose('variant', chooseVariant(this.state, id)), relayout });
    this.liveries = new LiveryThumbnails(scope, {
      choose: (id) => this.choose('livery', chooseLivery(this.state, id)),
      favorite: (id, on) => setFavoriteLivery(this.state, id, on),
      relayout,
    });
    this.statistics = new StatisticRows(scope);
    this.tail = new TailNumberField(scope, () => this.liveries.selectedId());
  }

  mount(): void {
    const scope = this.scope;
    // As the sim's panels: the mouse does not go through the panel (core/theme.ts).
    this.root.setAttribute('data-input-group', PANEL_INPUT_GROUP);
    const tailHost = this.build();
    scope.append(this.page.elt, this.root);
    scope.add(() => this.restoreStatistics());
    scope.add(() => setSetupPanelShown(false));
    this.layout();
    scope.interval(() => this.layout(), 250);
    this.tail.mount(tailHost);

    // The sim releases its configurator when leaving the screen and sets it only on a click on a tile or on
    // "Configure"; a livery chosen on a released configurator makes the current aircraft invalid.
    syncConfigurator().catch((error: unknown) => logError('the configurator could not be set', error));
    const reload = () => this.scheduleReload();
    watch(scope, configurator.Details, reload);
    watch(scope, aircraft.CurrentAircraft, reload);
    watch<Identification | null>(scope, aircraft.CurrentIdentification, (identification) => this.tail.setIdentification(identification));
    // A gallery heart removed also removes the aircraft's favourite liveries.
    scope.listen(document, FAVORITE_LIVERIES_CHANGED, reload);
    scope.add(() => clearTimeout(this.reloadTimer));
  }

  // ----- Construction -----

  /** The fixed parts; returns the host of the tail number field. */
  private build(): HTMLElement {
    // No header over the variants nor over the statistics (the owner's choice, 2026-10-30): their tiles and rows say it.
    this.root.appendChild(this.variants.list);

    const liveryHeader = el('div', 'msfs-ui-header msfs-ui-setup__livery-header', this.root);
    el('span', 'msfs-ui-title', liveryHeader).textContent = translate('TT:GENERIC.LIVERY');
    liveryHeader.appendChild(this.liveries.name);
    this.root.appendChild(this.liveries.list);

    this.root.appendChild(this.statistics.element);

    // Two blocks over the two buttons under them: the title over Fuel and Payload, the field over Identification.
    const tailRow = el('div', 'msfs-ui-setup__tail', this.root);
    const tailTitle = el('div', 'msfs-ui-header msfs-ui-setup__tail-title', tailRow);
    el('span', 'msfs-ui-title', tailTitle).textContent = translate(TAIL_NUMBER);
    const tailHost = el('div', 'msfs-ui-setup__field', tailRow);

    const actions = el('div', 'msfs-ui-setup__actions', this.root);
    for (const [label, flow] of [
      ['TT:GENERIC.FUEL_PAYLOAD', FLOW.fuel],
      ['TT:GENERIC.IDENTIFICATION', FLOW.identification],
    ] as const) {
      const host = el('div', 'msfs-ui-setup__action', actions);
      createComponent(this.scope, COMPONENTS.textButtonSmall, host, { Text: translate(label) }).then(
        (button) => button.onClick(this.scope, () => launchFlow(flow)),
        (error: unknown) => logError('a button of the setup panel could not be created', error),
      );
    }
    this.fixedParts = [liveryHeader, tailRow, actions];
    return tailHost;
  }

  /** In place of the statistics (`Fleet_Details` › `Scroll`), which are hidden. */
  private layout(): void {
    const details = this.page.elt.querySelector(STATISTICS);
    const statistics = details && details.querySelector<HTMLElement>('[name="Scroll"]');
    if (!isShown(details) || !statistics) {
      this.root.style.display = 'none';
      setSetupPanelShown(false);
      return;
    }
    if (statistics.style.visibility !== 'hidden') statistics.style.visibility = 'hidden';
    const origin = this.page.elt.getBoundingClientRect();
    const rect = statistics.getBoundingClientRect();
    const unit = uiUnit();
    const style = this.root.style;
    style.display = '';
    setSetupPanelShown(true);
    style.left = `${rect.left - origin.left}px`;
    style.top = `${rect.top - origin.top}px`;
    style.width = `${rect.width}px`;
    style.height = `${rect.height}px`;
    if (Math.round(rect.width) !== this.fittedWidth) {
      this.fittedWidth = Math.round(rect.width);
      this.variants.measure();
    }
    this.layoutLists(rect.width, rect.height, unit);
  }

  /**
   * Shares the room left by the fixed parts between the variants and the liveries (setup-layout.ts): a list that
   * needs more scrolls: its bar then takes its own width beside the content, and the content leaves room before it.
   * Whether a list scrolls is decided on the full width, so that the narrower layout it then takes cannot make it fit
   * again (the panel would swing between the two at every pass).
   */
  private layoutLists(width: number, height: number, unit: number): void {
    const full = width;
    const narrow = (list: RealScroll) => full - scrollBarWidth(list) - SCROLL_BAR_ROOM * unit;
    const gap = GAP * unit;
    // Fuel and Identification in whole pixels, the second taking the rest (aircraft-setup.css).
    const actionGap = Math.round(gap);
    setVariable(this.root.style, '--action-gap', `${actionGap}px`);
    setVariable(this.root.style, '--action-w', `${Math.floor((Math.round(width) - actionGap) / 2)}px`);
    // Side by side layout: the gallery shows the liveries (sim/selection-layout.ts), the panel only the variants.
    const withLiveries = !liveriesInGallery();
    toggleClass(this.root, 'is-without-liveries', !withLiveries);
    // The panel's padding at the top, and the gap under the lists, the livery header and the tail number (the hidden
    // ones have none).
    let room = height - PADDING_TOP * unit - (withLiveries ? 4 : 2) * gap;
    for (const part of this.fixedParts) room -= part.getBoundingClientRect().height;

    const liveryRows = (thumbnail: { height: number }): Rows => ({ count: withLiveries ? rowCount(this.liveries.count, LIVERY_COLUMNS) : 0, step: thumbnail.height + gap });
    const variantRows = (perRow: number): Rows => ({ count: rowCount(this.variants.count, perRow), step: (VARIANT_HEIGHT + GAP) * unit });
    const wideThumbnail = thumbnailSize(full, gap);
    let perRow = this.variants.perRow(full, gap);
    // The statistics take their room only when the lists still have all they need at full width (decided on the full
    // width and the lists' natural heights: never a scrolling list for them, never a swing between the two).
    const listsNeed = variantRows(perRow).count * variantRows(perRow).step + liveryRows(wideThumbnail).count * liveryRows(wideThumbnail).step;
    const statsRoom = statisticsRoom({ count: this.statistics.count, row: STATISTIC_HEIGHT, unit, gap }, room, listsNeed);
    toggleClass(this.root, 'has-statistics', statsRoom > 0);
    room -= statsRoom;
    let variants = variantRows(perRow);
    let variantsHigh = variantsHeight(room, variants, liveryRows(wideThumbnail));
    const variantsScroll = overflows(variants, variantsHigh);
    // The class first: it shows the bar's container that narrow() measures (aircraft-setup.css hides it while the list
    // fits; measured after, a list starting to scroll got its tiles a pass late, 10 pixels too wide at 1440 lines).
    toggleClass(this.variants.list, 'is-scrolling', variantsScroll);
    const variantsWidth = variantsScroll ? narrow(this.variants.list) : full;
    if (variantsScroll) {
      perRow = this.variants.perRow(variantsWidth, gap);
      variants = variantRows(perRow);
      variantsHigh = variantsHeight(room, variants, liveryRows(wideThumbnail));
    }
    const liveriesScroll = overflows(liveryRows(wideThumbnail), room - variantsHigh);
    toggleClass(this.liveries.list, 'is-scrolling', liveriesScroll);
    const thumbnail = liveriesScroll ? thumbnailSize(narrow(this.liveries.list), gap) : wideThumbnail;

    this.variants.arrange(perRow, variantsWidth);
    // Each row counts the gap under it; the list's own margin is the gap under the last one: a list that does not
    // scroll ends on its last tile (measured at 1440 lines: 16 pixels under it, the other blocks 8).
    this.variants.list.style.height = `${variantsScroll ? variantsHigh : Math.max(0, variantsHigh - Math.round(gap))}px`;
    // Whole pixels: the third thumbnail of a row takes the rest (aircraft-setup.css), so the row ends at the edge.
    setVariable(this.root.style, '--livery-w', `${thumbnail.width}px`);
    setVariable(this.root.style, '--livery-h', `${thumbnail.height}px`);
    const heights = `${variantsHigh}/${Math.round(room - variantsHigh)}/${thumbnail.height}`;
    if (heights !== this.listHeights) {
      this.listHeights = heights;
      this.updateSizes();
    }

    const selected = this.variants.takeReveal();
    if (variantsScroll && selected >= 0) {
      this.updateSizes();
      this.variants.list.scrollToPosition(revealPosition(Math.floor(selected / perRow), variants, variantsHigh));
    }
  }

  /** The sim's lists measure their content again (after a change of height or of content). */
  private updateSizes(): void {
    for (const list of [this.variants.list, this.liveries.list]) {
      if (list.updateSizes) list.updateSizes();
    }
  }

  private restoreStatistics(): void {
    const statistics = this.page.elt.querySelector<HTMLElement>(`${STATISTICS} [name="Scroll"]`);
    if (statistics) statistics.style.visibility = '';
  }

  // ----- Data -----

  private scheduleReload(): void {
    clearTimeout(this.reloadTimer);
    this.reloadTimer = setTimeout(() => this.reload().catch((error: unknown) => logError('the setup panel could not be updated', error)), RELOAD_DELAY_MS);
  }

  private async reload(): Promise<void> {
    const number = ++this.reloadNumber;
    const state = await readConfigurator();
    if (this.scope.disposed || number !== this.reloadNumber) return;
    this.state = state;
    this.variants.render(state.variants);
    this.liveries.render(state.liveries);
    // A failed read of the statistics shows none, and never stops the identification's refresh (the tail number).
    const current = (await (aircraft.CurrentAircraft() as Promise<unknown>).catch((error: unknown) => {
      logError('the statistics of the aircraft could not be read', error);
      return null;
    })) as { details?: AircraftStatistic[] } | null;
    if (this.scope.disposed || number !== this.reloadNumber) return;
    this.statistics.render(current && Array.isArray(current.details) ? current.details.filter((statistic) => !!statistic && !!statistic.name) : []);
    await aircraft.UpdateCurrentAircraftIdentification.request();
  }

  /** A choice the configurator ignored (not on the current aircraft): the panel reads it again. */
  private choose(what: 'variant' | 'livery', choice: Promise<boolean>): void {
    choice.then((done) => (done ? undefined : this.scheduleReload())).catch((error: unknown) => logError(`the ${what} could not be chosen`, error));
  }
}
