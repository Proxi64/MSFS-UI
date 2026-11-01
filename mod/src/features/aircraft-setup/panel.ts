// The setup panel in the aircraft selection, in place of the statistics (left column). Made of the sim's own
// components; everything goes through the sim's configurator (`Game.Aircraft.Configurator`, sim/configurator.ts), which
// the sim already sets on the aircraft chosen in the list; no 3D preview loads. Two modes:
// - Gallery and List (the gallery shows the liveries: sim/selection-layout.ts): the variants as tiles (variants.ts), the
//   aircraft's statistics (statistics.ts), the editable tail number (tail-field.ts), Fuel and Identification; the room
//   shared by setup-layout.ts.
// - Showcase: every part at a fixed place whatever the aircraft (showcase-layout.ts): the variants in a dropdown
//   (variant-dropdown.ts), the current livery large (large-livery.ts), the grid of small liveries (livery-grid.ts), and
//   in two rows the sim's "Configure your aircraft" tile (configure-tile.ts) beside the tail number over Fuel and
//   Identification; no statistics. Laid out by showcase-mode.ts.

import { answerOrNull, answerWithin } from '../../core/async.ts';
import { el, setStyle, setVariable, toggleClass, uiUnit } from '../../core/dom.ts';
import { logError } from '../../core/log.ts';
import type { Scope } from '../../core/scope.ts';
import { PANEL_INPUT_GROUP } from '../../core/theme.ts';
import { revealPosition, type Rows } from '../../core/virtual-list.ts';
import { COMPONENTS, createComponent, type SimComponent } from '../../sim/components.ts';
import { chooseLivery, chooseLiveryWhileSending, chooseVariant, readConfigurator, setFavoriteLivery, syncConfigurator, type ConfiguratorState } from '../../sim/configurator.ts';
import { FAVORITE_LIVERIES_CHANGED } from '../../sim/favorites.ts';
import { TAIL_NUMBER, type Identification } from '../../sim/liveries.ts';
import { translate } from '../../sim/localization.ts';
import { isShown, type Manipulator } from '../../sim/screens.ts';
import { scrollBarWidth, type RealScroll } from '../../sim/real-scroll.ts';
import { LIVERIES_IN_GALLERY_CHANGED, liveriesInGallery, setSetupPanelShown } from '../../sim/selection-layout.ts';
import { ANSWER_TIMEOUT_MS, store, watch } from '../../sim/store.ts';
import { CONFIGURE_TILE } from './configure-tile.ts';
import { LargeLivery } from './large-livery.ts';
import { LiveryGrid } from './livery-grid.ts';
import { GAP, overflows, PADDING_TOP, rowCount, SCROLL_BAR_ROOM, statisticsRoom, VARIANT_HEIGHT, variantsHeight } from './setup-layout.ts';
import type { ShowcasePlaces } from './showcase-layout.ts';
import { ShowcaseMode, type BottomRow } from './showcase-mode.ts';
import { StatisticRows, type AircraftStatistic } from './statistics.ts';
import { TailNumberField } from './tail-field.ts';
import { VariantDropdown } from './variant-dropdown.ts';
import { VariantsList } from './variants.ts';

const RELOAD_DELAY_MS = 80;
/** A row of the statistics, in layout units (the sim's rows: 48 pixels at 1440 lines). */
const STATISTIC_HEIGHT = 36;
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
  /** Run at the start of each layout pass (the left column's width: index.ts). */
  private readonly beforeLayout: () => void;
  private readonly root = el('div', 'msfs-ui-root msfs-ui-setup');
  // Gallery and List.
  private readonly variants: VariantsList;
  private readonly statistics: StatisticRows;
  // Showcase.
  private readonly variantRow = el('div', 'msfs-ui-header msfs-ui-setup__variant-row');
  private readonly liveryHeader = el('div', 'msfs-ui-header msfs-ui-setup__livery-header');
  private readonly largeHost = el('div', 'msfs-ui-setup__large');
  private readonly gridHost = el('div', 'msfs-ui-setup__grid');
  private readonly dropdown: VariantDropdown;
  private readonly grid: LiveryGrid;
  private readonly large: LargeLivery;
  private readonly showcase: ShowcaseMode;
  // Both.
  private readonly tail: TailNumberField;
  private readonly tailRow = el('div', 'msfs-ui-setup__tail');
  private readonly tailTitle = el('div', 'msfs-ui-header msfs-ui-setup__tail-title');
  private readonly actions = el('div', 'msfs-ui-setup__actions');
  /** Fuel and Identification, once created. */
  private readonly actionButtons: SimComponent[] = [];
  /** Heights last given to the variants list, in pixels: its scrolling element is told when they change. */
  private listHeights = '';
  /** Width of the panel at the last measure of the variants (0: measured at the next Gallery or List pass). */
  private fittedWidth = 0;
  /** The panel's places were last written by the Showcase layout (false: by Gallery and List's, or not yet). */
  private showcaseLaidOut = false;

  /** The configurator as last read: the choices are made on it. */
  private state: ConfiguratorState = { variants: [], liveries: [], details: null, variationTitle: '' };

  private reloadTimer: ReturnType<typeof setTimeout> | undefined;
  /** Number of the last reload: an older one that finishes later is ignored. */
  private reloadNumber = 0;

  constructor(page: Manipulator, scope: Scope, beforeLayout: () => void) {
    this.page = page;
    this.scope = scope;
    this.beforeLayout = beforeLayout;
    const chooseVariantNow = (id: string) => this.chooseVariant(id);
    this.variants = new VariantsList(scope, { choose: chooseVariantNow, relayout: () => this.layout() });
    this.statistics = new StatisticRows(scope);
    this.dropdown = new VariantDropdown(scope, this.variantRow, chooseVariantNow);
    const favorite = (id: string, on: boolean) => setFavoriteLivery(this.state, id, on);
    this.grid = new LiveryGrid(scope, this.gridHost, {
      choose: (id) => this.large.choose(id),
      favorite,
      hover: (id) => this.large.hover(id),
    });
    this.large = new LargeLivery(scope, this.largeHost, {
      // Back to the livery the sim is leaving, before it reports the one sent: the state read still lists it as selected.
      choose: (send) =>
        (send.overSent ? chooseLiveryWhileSending : chooseLivery)(this.state, send.id).then(
          (done) => {
            if (!done) this.scheduleReload();
            return done;
          },
          (error: unknown) => {
            this.scheduleReload();
            throw error;
          },
        ),
      favorite,
      shown: (id) => this.grid.select(id),
    });
    this.showcase = new ShowcaseMode(scope, {
      root: this.root,
      variantRow: this.variantRow,
      liveryHeader: this.liveryHeader,
      largeHost: this.largeHost,
      grid: this.grid,
      tailRow: this.tailRow,
      tailTitle: this.tailTitle,
      actions: this.actions,
      actionButtons: this.actionButtons,
      dropdown: this.dropdown,
    });
    this.tail = new TailNumberField(scope, () => this.selectedLivery());
  }

  /** What the Showcase bottom block needs, once measured: the left column is never narrower (index.ts). */
  bottomRow(): BottomRow | null {
    return this.showcase.bottomRow();
  }

  mount(): void {
    const scope = this.scope;
    // As the sim's panels: the mouse does not go through the panel (core/theme.ts).
    this.root.setAttribute('data-input-group', PANEL_INPUT_GROUP);
    const tailHost = this.build();
    // Hidden until a layout pass places it.
    this.root.style.display = 'none';
    scope.append(this.page.elt, this.root);
    scope.add(() => this.restoreStatistics());
    scope.add(() => setSetupPanelShown(false));
    // The first pass once the gallery has mounted (it mounts right after this feature): its flag then tells the mode
    // (sim/selection-layout.ts), so the panel does not take its Showcase form for one pass on entering Gallery or List.
    scope.timeout(() => this.layout(), 0);
    scope.interval(() => this.layout(), 250);
    // Another view of the gallery: the other form at once, as the gallery redraws at once (not at the next pass).
    scope.listen(document, LIVERIES_IN_GALLERY_CHANGED, () => this.layout());
    this.tail.mount(tailHost);

    // The sim releases its configurator when leaving the screen and sets it only on a click on a tile or on
    // "Configure"; a livery chosen on a released configurator makes the current aircraft invalid.
    syncConfigurator().catch((error: unknown) => logError('the configurator could not be set', error));
    const reload = () => this.scheduleReload();
    watch(scope, configurator.Details, reload);
    // Another aircraft: the variants list closes at once, before the configurator reports the new variants.
    watch(scope, aircraft.CurrentAircraft, () => {
      this.dropdown.close();
      reload();
    });
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
    this.root.appendChild(this.variantRow);
    el('span', 'msfs-ui-title', this.liveryHeader).textContent = translate('TT:GENERIC.LIVERY');
    this.liveryHeader.appendChild(this.large.name);
    this.root.appendChild(this.liveryHeader);
    this.root.appendChild(this.largeHost);
    this.root.appendChild(this.gridHost);
    this.root.appendChild(this.statistics.element);

    // Two blocks over the two buttons under them: the title over Fuel and Payload, the field over Identification.
    this.root.appendChild(this.tailRow);
    this.tailRow.appendChild(this.tailTitle);
    el('span', 'msfs-ui-title', this.tailTitle).textContent = translate(TAIL_NUMBER);
    const tailHost = el('div', 'msfs-ui-setup__field', this.tailRow);

    this.root.appendChild(this.actions);
    for (const [label, flow] of [
      ['TT:GENERIC.FUEL_PAYLOAD', FLOW.fuel],
      ['TT:GENERIC.IDENTIFICATION', FLOW.identification],
    ] as const) {
      const host = el('div', 'msfs-ui-setup__action', this.actions);
      createComponent(this.scope, COMPONENTS.textButtonSmall, host, { Text: translate(label) }).then(
        (button) => {
          this.actionButtons.push(button);
          button.onClick(this.scope, () => launchFlow(flow));
        },
        (error: unknown) => logError('a button of the setup panel could not be created', error),
      );
    }
    return tailHost;
  }

  /** In place of the statistics (`Fleet_Details` › `Scroll`), which are hidden. */
  private layout(): void {
    this.beforeLayout();
    const details = this.page.elt.querySelector<HTMLElement>(STATISTICS);
    const statistics = details && details.querySelector<HTMLElement>('[name="Scroll"]');
    if (!isShown(details) || !statistics) {
      this.hide();
      this.showcase.leave();
      this.showcaseLaidOut = false;
      // Measured again once shown: the tiles may have changed meanwhile.
      this.fittedWidth = 0;
      return;
    }
    const unit = uiUnit();
    const tile = liveriesInGallery() ? null : details.querySelector<HTMLElement>(CONFIGURE_TILE);
    // Before measuring: the statistics' top follows the title block's height.
    this.showcase.holdTitleLines(tile ? details : null, unit);
    const origin = this.page.elt.getBoundingClientRect();
    const rect = statistics.getBoundingClientRect();
    // Showcase: nothing is written while the grid gets less than one row (the screen animates). The panel
    // keeps its Showcase places meanwhile, or stays hidden when it has none (it would show its Gallery and List form).
    let places: ShowcasePlaces | null = null;
    if (tile) {
      places = this.showcase.places(rect, details, unit);
      if (!places) {
        if (!this.showcaseLaidOut) this.hide();
        return;
      }
    }

    if (statistics.style.visibility !== 'hidden') statistics.style.visibility = 'hidden';
    const style = this.root.style;
    style.display = '';
    setSetupPanelShown(true);
    toggleClass(this.root, 'is-showcase', !!places);
    setStyle(style, 'left', `${rect.left - origin.left}px`);
    setStyle(style, 'top', `${rect.top - origin.top}px`);
    setStyle(style, 'width', `${rect.width}px`);
    if (tile && places) {
      this.showcase.layout(rect, places, tile, details.parentElement, unit);
      this.showcaseLaidOut = true;
      // The variants list is hidden in Showcase (aircraft-setup.css): measured again at the next Gallery or List pass,
      // whose column may have the same width while the aircraft changed meanwhile.
      this.fittedWidth = 0;
      return;
    }
    this.showcase.leave();
    this.showcaseLaidOut = false;
    setStyle(style, 'height', `${rect.height}px`);
    if (Math.round(rect.width) !== this.fittedWidth) {
      this.fittedWidth = Math.round(rect.width);
      this.variants.measure();
    }
    this.layoutVariants(rect.width, rect.height, unit);
  }

  /**
   * Gallery and List: the variants take the room the fixed parts leave (setup-layout.ts), and scroll when they need
   * more: the bar then takes its own width beside the tiles, and the tiles leave room before it. Whether the list
   * scrolls is decided on the full width, so that the narrower layout it then takes cannot make it fit again (the panel
   * would swing between the two at every pass).
   */
  private layoutVariants(width: number, height: number, unit: number): void {
    const full = width;
    const gap = GAP * unit;
    // Fuel and Identification in whole pixels, the second taking the rest (aircraft-setup.css).
    const actionGap = Math.round(gap);
    setVariable(this.root.style, '--action-gap', `${actionGap}px`);
    setVariable(this.root.style, '--action-w', `${Math.floor((Math.round(width) - actionGap) / 2)}px`);
    // The panel's padding at the top, and the gap under the list and the tail number.
    let room = height - PADDING_TOP * unit - 2 * gap;
    for (const part of [this.tailRow, this.actions]) room -= part.getBoundingClientRect().height;

    const variantRows = (perRow: number): Rows => ({ count: rowCount(this.variants.count, perRow), step: (VARIANT_HEIGHT + GAP) * unit });
    let perRow = this.variants.perRow(full, gap);
    let variants = variantRows(perRow);
    // The statistics take their room only when the variants still have all they need at full width (never a scrolling
    // list for them, never a swing between the two).
    const statsRoom = statisticsRoom({ count: this.statistics.count, row: STATISTIC_HEIGHT, unit, gap }, room, variants.count * variants.step);
    toggleClass(this.root, 'has-statistics', statsRoom > 0);
    room -= statsRoom;
    let high = variantsHeight(room, variants);
    const scrolls = overflows(variants, high);
    // The class first: it shows the bar's container that the narrow width measures (aircraft-setup.css hides it while
    // the list fits; measured after, a list starting to scroll got its tiles a pass late, 10 pixels too wide at 1440
    // lines).
    toggleClass(this.variants.list, 'is-scrolling', scrolls);
    const listWidth = scrolls ? full - scrollBarWidth(this.variants.list) - SCROLL_BAR_ROOM * unit : full;
    if (scrolls) {
      perRow = this.variants.perRow(listWidth, gap);
      variants = variantRows(perRow);
      high = variantsHeight(room, variants);
    }

    this.variants.arrange(perRow, listWidth);
    // Each row counts the gap under it; the list's own margin is the gap under the last one: a list that does not
    // scroll ends on its last tile (measured at 1440 lines: 16 pixels under it, the other blocks 8).
    this.variants.list.style.height = `${scrolls ? high : Math.max(0, high - Math.round(gap))}px`;
    const heights = `${high}/${Math.round(room - high)}`;
    if (heights !== this.listHeights) {
      this.listHeights = heights;
      this.updateSizes();
    }

    const selected = this.variants.takeReveal();
    if (scrolls && selected >= 0) {
      this.updateSizes();
      this.variants.list.scrollToPosition(revealPosition(Math.floor(selected / perRow), variants, high));
    }
  }

  private hide(): void {
    this.root.style.display = 'none';
    setSetupPanelShown(false);
  }

  /** The sim's list measures its content again (after a change of height or of content). */
  private updateSizes(): void {
    const list: RealScroll = this.variants.list;
    if (list.updateSizes) list.updateSizes();
  }

  private restoreStatistics(): void {
    const statistics = this.page.elt.querySelector<HTMLElement>(`${STATISTICS} [name="Scroll"]`);
    if (statistics) statistics.style.visibility = '';
  }

  // ----- Data -----

  /** The livery the configurator is on (the tail number belongs to it). */
  private selectedLivery(): string | null {
    const selected = this.state.liveries.filter((livery) => livery.isSelected)[0];
    return selected ? selected.id : null;
  }

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
    this.dropdown.render(state.variants);
    this.large.render(state.liveries, state.details ? state.details.variationId : '');
    this.grid.render(this.large.items);
    // A failed read of the statistics shows none, and never stops the identification's refresh (the tail number).
    const current = (await answerOrNull(aircraft.CurrentAircraft(), ANSWER_TIMEOUT_MS, 'the statistics of the aircraft could not be read')) as {
      details?: AircraftStatistic[];
    } | null;
    if (this.scope.disposed || number !== this.reloadNumber) return;
    this.statistics.render(current && Array.isArray(current.details) ? current.details.filter((statistic) => !!statistic && !!statistic.name) : []);
    await answerWithin(aircraft.UpdateCurrentAircraftIdentification.request(), ANSWER_TIMEOUT_MS, 'the update of the tail number');
  }

  /**
   * A variant chosen drops a livery step not sent yet (it belongs to the variant left); one the configurator ignored
   * (not on the current aircraft) makes the panel read it again.
   */
  private chooseVariant(id: string): void {
    this.large.dropStep();
    chooseVariant(this.state, id)
      .then((done) => (done ? undefined : this.scheduleReload()))
      .catch((error: unknown) => logError('the variant could not be chosen', error));
  }
}
