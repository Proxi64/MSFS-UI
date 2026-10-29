// The setup panel in the aircraft selection, in place of the statistics (left column): variant, liveries as
// thumbnails (with a heart: favourite liveries, shown first), editable tail number, shortcuts to Fuel and
// Identification. Made of the sim's own components. Everything goes through the sim's configurator
// (`Game.Aircraft.Configurator`), which the sim already sets on the aircraft chosen in the list; no 3D preview loads.

import { el, setVariable, toggleClass, uiUnit } from '../../core/dom.ts';
import { logError } from '../../core/log.ts';
import type { Scope } from '../../core/scope.ts';
import type { ConfiguratorLivery } from '../../sim/aircraft-loading.ts';
import { COMPONENTS, createComponent, type SimComponent } from '../../sim/components.ts';
import {
  chooseLivery,
  chooseVariant,
  readConfigurator,
  setFavoriteLivery,
  syncConfigurator,
  type ConfiguratorItem,
  type ConfiguratorState,
} from '../../sim/configurator.ts';
import { FAVORITE_LIVERIES_CHANGED, isFavoriteLivery, loadFavoriteLiveries } from '../../sim/favorites.ts';
import { liveryFolder, TAIL_NUMBER } from '../../sim/liveries.ts';
import { cleanTail } from '../../sim/registration.ts';
import { isShown, type Manipulator } from '../../sim/screens.ts';
import { scrollBarWidth, type RealScroll } from '../../sim/real-scroll.ts';
import { liveriesInGallery, setSetupPanelShown } from '../../sim/selection-layout.ts';
import { store, translate, watch } from '../../sim/store.ts';
import { createTextField, type TextField } from '../../sim/text-field.ts';
import { orderLiveries, type LiveryOrder } from './livery-order.ts';
import { overflows, revealPosition, rowCount, variantsHeight, variantsPerRow, type Rows } from './setup-layout.ts';

interface IdentificationField {
  dataName: string;
  value: string;
  allowedLength: number;
}

/** The sim's wishlist heart (IconButtonLightWishlistManipulator). */
interface WishlistManipulator {
  setData(checked: boolean, callback: (checked: boolean) => void): void;
}

/** The sim's livery button (ImageButtonLiveryManipulator). */
interface LiveryButtonManipulator {
  setData(image: string, callback: () => void): void;
}

/** A list of the panel in the sim's scrolling list; its children go into the list's content. */
function scrollList(className: string): RealScroll {
  const list = document.createElement('real-scroll') as RealScroll;
  list.setAttribute('direction', 'y');
  list.className = className;
  return list;
}

/** Empties a scrolling list child by child: the sim's list keeps its own structure (never `innerHTML`). */
function removeAll(hosts: readonly HTMLElement[]): void {
  for (const host of hosts) {
    if (host.parentNode) host.parentNode.removeChild(host);
  }
}

/** Length of the field when the sim does not give it. */
const DEFAULT_TAIL_LENGTH = 9;
const RELOAD_DELAY_MS = 80;
/** Livery thumbnails: three per row, in the proportions of the sim's thumbnails (about 2:1). */
const LIVERY_COLUMNS = 3;
const LIVERY_RATIO = 0.47;
/** Selection corner of the compact tiles (core/theme.css), kept clear of the title. */
const CORNER_UNITS = 30;
/** Layout units, as in aircraft-setup.css: height of a variant tile, gap between tiles, panel padding. */
const VARIANT_HEIGHT = 36;
const GAP = 6;
const PADDING = 6;
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

interface LiveryTile {
  button: SimComponent;
  heart: SimComponent | null;
  host: HTMLElement;
}

export class SetupPanel {
  private readonly page: Manipulator;
  private readonly scope: Scope;
  private readonly root = el('div', 'msfs-ui-setup');
  private readonly variantsList = scrollList('msfs-ui-setup__variants');
  private readonly liveryName = el('span', 'msfs-ui-value msfs-ui-setup__value');
  private readonly liveriesList = scrollList('msfs-ui-setup__liveries');
  /** The parts between and around the two lists (headers, tail number, buttons): the lists share the rest. */
  private fixedParts: HTMLElement[] = [];
  /** Heights last given to the lists, in pixels: their scrolling element is told when they change. */
  private listHeights = '';

  /** Variants: components by id, built for one set of ids. */
  private variants: ConfiguratorItem[] = [];
  private variantKey = '';
  private variantScope: Scope | null = null;
  private variantHosts: HTMLElement[] = [];
  private readonly variantTiles = new Map<string, SimComponent>();
  /** Tiles per row and tile width of the current layout of the variants. */
  private variantsLayout = '';
  /** Width a variant tile needs to show the widest name whole, in pixels (0 until the tiles are measured). */
  private variantNeeded = 0;
  /** Width of the panel at the last measure of the variants. */
  private fittedWidth = 0;
  /** The variants were rebuilt: the list scrolls to the selected one once laid out. */
  private revealVariant = false;

  /** Liveries: components by id, built for one ordered set of ids. */
  private liveries: ConfiguratorLivery[] = [];
  private liveryKeyList = '';
  private liveryScope: Scope | null = null;
  private liveryHosts: HTMLElement[] = [];
  private readonly liveryTiles = new Map<string, LiveryTile>();
  private liveryOrder: LiveryOrder | null = null;
  private selectedLiveryTitle = '';

  /** The configurator as last read: the choices are made on it. */
  private state: ConfiguratorState = { variants: [], liveries: [], details: null, variationTitle: '' };

  private tail: TextField | null = null;
  private tailInfo: IdentificationField | null = null;
  private reloadTimer: ReturnType<typeof setTimeout> | undefined;
  /** Number of the last reload: an older one that finishes later is ignored. */
  private reloadNumber = 0;
  /**
   * The tail number being typed: the livery selected when the field took the keyboard (the value belongs to it)
   * and the value typed so far (kept here: the field may be gone when the screen closes during the edit).
   */
  private edit: { livery: string | null; value: string } | null = null;

  constructor(page: Manipulator, scope: Scope) {
    this.page = page;
    this.scope = scope;
  }

  mount(): void {
    const scope = this.scope;
    // As the sim's panels: the mouse does not go through the panel (core/theme.ts).
    this.root.setAttribute('data-input-group', 'inputLocker');
    const tailHost = this.build();
    scope.append(this.page.elt, this.root);
    scope.add(() => this.restoreStatistics());
    scope.add(() => setSetupPanelShown(false));
    this.layout();
    scope.interval(() => this.layout(), 250);

    // Leaving the screen while typing sends the value too (registered first: runs after the field is gone).
    scope.add(() => this.commitTail(false));
    createTextField(scope, tailHost, {
      plain: true,
      onEnter: () => (this.edit = { livery: this.selectedLiveryId(), value: this.tail ? this.tail.value : '' }),
      onChange: (value) => this.onTailTyped(value),
      onSubmit: () => this.commitTail(true),
      onLeave: () => this.commitTail(false),
    }).then(
      (field) => {
        this.tail = field;
        if (this.tailInfo) field.value = this.tailInfo.value;
      },
      (error: unknown) => logError('the tail number field could not be created', error),
    );

    // The sim releases its configurator when leaving the screen and sets it only on a click on a tile or on
    // "Configure"; a livery chosen on a released configurator makes the current aircraft invalid.
    syncConfigurator().catch((error: unknown) => logError('the configurator could not be set', error));
    const reload = () => this.scheduleReload();
    watch(scope, configurator.Details, reload);
    watch(scope, aircraft.CurrentAircraft, reload);
    watch<{ identificationInfos?: IdentificationField[] } | null>(scope, aircraft.CurrentIdentification, (identification) => this.onIdentification(identification));
    // A gallery heart unchecked also removes the aircraft's favourite liveries.
    scope.listen(document, FAVORITE_LIVERIES_CHANGED, reload);
    scope.add(() => clearTimeout(this.reloadTimer));
  }

  // ----- Construction -----

  /** The fixed parts; returns the host of the tail number field. */
  private build(): HTMLElement {
    const variantHeader = el('div', 'msfs-ui-header', this.root);
    el('span', 'msfs-ui-title', variantHeader).textContent = translate('TT:MANUFACTURE.BREADCRUMB.VARIATION');
    this.root.appendChild(this.variantsList);

    const liveryHeader = el('div', 'msfs-ui-header msfs-ui-setup__livery-header', this.root);
    el('span', 'msfs-ui-title', liveryHeader).textContent = translate('TT:GENERIC.LIVERY');
    liveryHeader.appendChild(this.liveryName);
    this.root.appendChild(this.liveriesList);

    const tailRow = el('div', 'msfs-ui-header msfs-ui-setup__tail', this.root);
    el('span', 'msfs-ui-title', tailRow).textContent = translate(TAIL_NUMBER);
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
    this.fixedParts = [variantHeader, liveryHeader, tailRow, actions];
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
      this.measureVariants();
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
    const full = width - 2 * PADDING * unit;
    const narrow = (list: RealScroll) => full - scrollBarWidth(list) - SCROLL_BAR_ROOM * unit;
    const gap = GAP * unit;
    // The panel's padding, and the gap under the two headers, the two lists and the tail number.
    // Side by side layout: the gallery shows the liveries (sim/selection-layout.ts), the panel only the variants.
    const withLiveries = !liveriesInGallery();
    toggleClass(this.root, 'is-without-liveries', !withLiveries);
    // The panel's padding, and the gap under the headers, the lists and the tail number (the hidden ones have none).
    let room = height - 2 * PADDING * unit - (withLiveries ? 5 : 3) * gap;
    for (const part of this.fixedParts) room -= part.getBoundingClientRect().height;

    const liveryRows = (thumbnail: { height: number }): Rows => ({ count: withLiveries ? rowCount(this.liveries.length, LIVERY_COLUMNS) : 0, step: thumbnail.height + gap });
    const variantRows = (perRow: number): Rows => ({ count: rowCount(this.variants.length, perRow), step: (VARIANT_HEIGHT + GAP) * unit });
    const wideThumbnail = this.thumbnailSize(full, unit);
    let perRow = this.variantsPerRow(full, gap);
    let variants = variantRows(perRow);
    let variantsHigh = variantsHeight(room, variants, liveryRows(wideThumbnail));
    const variantsScroll = overflows(variants, variantsHigh);
    const variantsWidth = variantsScroll ? narrow(this.variantsList) : full;
    if (variantsScroll) {
      perRow = this.variantsPerRow(variantsWidth, gap);
      variants = variantRows(perRow);
      variantsHigh = variantsHeight(room, variants, liveryRows(wideThumbnail));
    }
    const liveriesScroll = overflows(liveryRows(wideThumbnail), room - variantsHigh);
    const thumbnail = liveriesScroll ? this.thumbnailSize(narrow(this.liveriesList), unit) : wideThumbnail;

    this.arrangeVariants(perRow, variantsWidth);
    toggleClass(this.variantsList, 'is-scrolling', variantsScroll);
    toggleClass(this.liveriesList, 'is-scrolling', liveriesScroll);
    this.variantsList.style.height = `${variantsHigh}px`;
    // Whole pixels: the third thumbnail of a row takes the rest (aircraft-setup.css), so the row ends at the edge.
    setVariable(this.root.style, '--livery-w', `${thumbnail.width}px`);
    setVariable(this.root.style, '--livery-h', `${thumbnail.height}px`);
    const heights = `${variantsHigh}/${Math.round(room - variantsHigh)}/${thumbnail.height}`;
    if (heights !== this.listHeights) {
      this.listHeights = heights;
      this.updateSizes();
    }

    if (this.revealVariant && this.variants.length > 0 && this.variantTiles.size === this.variants.length) {
      this.revealVariant = false;
      const selected = this.variants.findIndex((item) => item.isSelected);
      if (variantsScroll && selected >= 0) {
        this.updateSizes();
        this.variantsList.scrollToPosition(revealPosition(Math.floor(selected / perRow), variants, variantsHigh));
      }
    }
  }

  /** A livery thumbnail in a list `width` wide: three per row, 6 units apart, in whole pixels. */
  private thumbnailSize(width: number, unit: number): { width: number; height: number } {
    const thumbnail = (width - (LIVERY_COLUMNS - 1) * GAP * unit) / LIVERY_COLUMNS;
    return { width: Math.floor(thumbnail), height: Math.round(thumbnail * LIVERY_RATIO) };
  }

  /** The sim's lists measure their content again (after a change of height or of content). */
  private updateSizes(): void {
    for (const list of [this.variantsList, this.liveriesList]) {
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
    this.renderVariants(state.variants);
    this.renderLiveries(state.liveries);
    await aircraft.UpdateCurrentAircraftIdentification.request();
  }

  // ----- Variants -----

  private renderVariants(items: ConfiguratorItem[]): void {
    this.variants = items;
    const key = items.map((item) => item.id).join('|');
    if (key !== this.variantKey) {
      this.variantKey = key;
      if (this.variantScope) this.variantScope.dispose();
      const scope = (this.variantScope = this.scope.child());
      this.variantTiles.clear();
      removeAll(this.variantHosts);
      this.variantHosts = [];
      this.variantsLayout = '';
      this.variantNeeded = 0;
      this.revealVariant = true;
      items.forEach((item) => {
        const host = el('div', 'msfs-ui-setup__variant msfs-ui-compact-tile');
        this.variantsList.appendChild(host);
        this.variantHosts.push(host);
        createComponent(scope, COMPONENTS.tileButton, host, { Title: translate(item.title) }).then(
          (tile) => {
            // A component of a list rebuilt since (another aircraft) is dropped with its scope.
            if (scope.disposed) return;
            this.variantTiles.set(item.id, tile);
            tile.onClick(scope, () => this.chooseVariant(item.id));
            this.updateVariants();
            if (this.measureVariants()) this.layout();
          },
          (error: unknown) => logError('a variant tile could not be created', error),
        );
      });
      this.layout();
    }
    this.updateVariants();
  }

  /**
   * Lays the variant tiles out `perRow` per row in a list `row` pixels wide, in whole pixels (the engine rounds
   * computed widths down): the last tile of a full row takes the rest and ends at the list's edge; a row that is not
   * full keeps the same widths, so its tiles stay aligned on the columns above.
   */
  private arrangeVariants(perRow: number, row: number): void {
    const gap = GAP * uiUnit();
    const width = row > 0 ? Math.floor((row - gap * (perRow - 1)) / perRow) : 0;
    const key = `${perRow}/${width}/${this.variantHosts.length}`;
    if (key === this.variantsLayout) return;
    this.variantsLayout = key;
    this.variantHosts.forEach((host, at) => {
      const last = at % perRow === perRow - 1;
      if (width <= 0) host.style.width = `calc((100% - var(--u) * ${GAP * (perRow - 1)}) / ${perRow})`;
      else host.style.width = last ? `calc(100% - ${width * (perRow - 1)}px - var(--u) * ${GAP * (perRow - 1)})` : `${width}px`;
      host.style.marginRight = last ? '0' : '';
    });
  }

  /** Variant tiles per row in a list `width` wide: up to three until the tiles are measured. */
  private variantsPerRow(width: number, gap: number): number {
    const count = this.variants.length;
    return this.variantNeeded > 0 ? variantsPerRow(count, width, this.variantNeeded, gap) : Math.min(3, Math.max(1, count));
  }

  /**
   * The width a tile needs to show the widest name whole, room for the selection corner included: the engine shows
   * no ellipsis, a long name would be cut. Measured once every tile exists, and when the panel's width changes
   * (layout). True when measured.
   */
  private measureVariants(): boolean {
    if (this.variants.length === 0 || this.variantTiles.size < this.variants.length) return false;
    const unit = uiUnit();
    // The text's own width: a probe inside each title takes its font. Every probe is added before any is measured, so
    // the engine lays the page out once, not once per variant (it now runs at each change of the column's width).
    const probes: { title: HTMLElement; probe: HTMLElement; content: HTMLElement }[] = [];
    this.variantTiles.forEach((tile) => {
      const title = tile.element.querySelector<HTMLElement>('[name="Title"]');
      const content = tile.element.querySelector<HTMLElement>('[name="Content"]');
      if (!title || !content) return;
      const probe = el('span', '', title);
      probe.style.whiteSpace = 'nowrap';
      probe.textContent = title.textContent;
      probes.push({ title, probe, content });
    });
    let widest = 0;
    let padding = 0;
    for (const { probe, content } of probes) {
      const style = window.getComputedStyle(content);
      padding = Math.max(padding, parseFloat(style.paddingLeft) + parseFloat(style.paddingRight));
      widest = Math.max(widest, probe.getBoundingClientRect().width);
    }
    for (const { title, probe } of probes) title.removeChild(probe);
    this.variantNeeded = widest + padding + CORNER_UNITS * unit;
    return true;
  }

  private updateVariants(): void {
    for (const item of this.variants) {
      const tile = this.variantTiles.get(item.id);
      if (!tile) continue;
      tile.select(item.isSelected);
      tile.disable(item.isDisabled);
    }
  }

  /** A choice the configurator ignored (not on the current aircraft): the panel reads it again. */
  private chooseVariant(id: string): void {
    const item = this.variants.filter((candidate) => candidate.id === id)[0];
    if (!item || item.isSelected) return;
    chooseVariant(this.state, id)
      .then((done) => (done ? undefined : this.scheduleReload()))
      .catch((error: unknown) => logError('the variant could not be chosen', error));
  }

  // ----- Liveries -----

  private renderLiveries(items: ConfiguratorLivery[]): void {
    const favorites = loadFavoriteLiveries();
    const ordered = orderLiveries(items, (livery) => isFavoriteLivery(livery, favorites), this.liveryOrder);
    this.liveryOrder = ordered.order;
    this.liveries = ordered.items;
    const selected = items.filter((livery) => livery.isSelected)[0];
    this.selectedLiveryTitle = selected ? translate(selected.title) : '';
    this.liveryName.textContent = this.selectedLiveryTitle;

    const key = ordered.items.map((livery) => livery.id).join('|');
    if (key !== this.liveryKeyList) {
      this.liveryKeyList = key;
      this.buildLiveries(ordered.items);
      this.layout();
      if (ordered.reordered) this.liveriesList.scrollToPosition(0);
    }
    this.updateLiveries(favorites);
  }

  private buildLiveries(items: ConfiguratorLivery[]): void {
    if (this.liveryScope) this.liveryScope.dispose();
    const scope = (this.liveryScope = this.scope.child());
    this.liveryTiles.clear();
    removeAll(this.liveryHosts);
    this.liveryHosts = [];
    for (const livery of items) {
      const host = el('div', 'msfs-ui-setup__livery');
      this.liveriesList.appendChild(host);
      this.liveryHosts.push(host);
      const buttonHost = el('div', 'msfs-ui-setup__thumbnail', host);
      const heartHost = liveryFolder(livery) ? el('div', 'msfs-ui-setup__heart', host) : null;
      scope.listen(host, 'mouseenter', () => (this.liveryName.textContent = translate(livery.title)));
      scope.listen(host, 'mouseleave', () => (this.liveryName.textContent = this.selectedLiveryTitle));
      Promise.all([
        createComponent(scope, COMPONENTS.liveryButton, buttonHost),
        heartHost ? createComponent(scope, COMPONENTS.wishlistButton, heartHost) : Promise.resolve(null),
      ]).then(
        ([button, heart]) => {
          if (scope.disposed) return;
          const thumbnail = button.manipulator<LiveryButtonManipulator>();
          if (thumbnail) thumbnail.setData(livery.imageUrl, () => this.chooseLivery(livery.id));
          const tile = { button, heart, host };
          this.liveryTiles.set(livery.id, tile);
          const current = this.liveries.filter((candidate) => candidate.id === livery.id)[0];
          if (current) this.updateLivery(current, tile, loadFavoriteLiveries());
        },
        (error: unknown) => logError('a livery thumbnail could not be created', error),
      );
    }
  }

  private updateLiveries(favorites: ReturnType<typeof loadFavoriteLiveries>): void {
    for (const livery of this.liveries) {
      const tile = this.liveryTiles.get(livery.id);
      if (tile) this.updateLivery(livery, tile, favorites);
    }
  }

  /**
   * Selection, favourite heart and availability of one thumbnail. ImageButton_Livery has no Disabled state of its
   * own: an unavailable livery is dimmed by its host (aircraft-setup.css), and a click on it is ignored.
   */
  private updateLivery(livery: ConfiguratorLivery, tile: LiveryTile, favorites: ReturnType<typeof loadFavoriteLiveries>): void {
    tile.button.select(livery.isSelected);
    toggleClass(tile.host, 'is-disabled', !!livery.isDisabled);
    const favorite = isFavoriteLivery(livery, favorites);
    toggleClass(tile.host, 'is-favorite', favorite);
    const heart = tile.heart && tile.heart.manipulator<WishlistManipulator>();
    // The change event redraws this panel (hearts) and the gallery; the order of the thumbnails stays.
    if (heart) heart.setData(favorite, (checked) => setFavoriteLivery(this.state, livery.id, checked));
  }

  /** A choice the configurator ignored (not on the current aircraft): the panel reads it again. */
  private chooseLivery(id: string): void {
    const livery = this.liveries.filter((candidate) => candidate.id === id)[0];
    if (!livery || livery.isSelected || livery.isDisabled) return;
    chooseLivery(this.state, id)
      .then((done) => (done ? undefined : this.scheduleReload()))
      .catch((error: unknown) => logError('the livery could not be chosen', error));
  }

  // ----- Tail number -----

  private onIdentification(identification: { identificationInfos?: IdentificationField[] } | null): void {
    const fields = identification && identification.identificationInfos;
    this.tailInfo = (fields && fields.filter((field) => field.dataName === TAIL_NUMBER)[0]) || null;
    if (this.tail) this.tail.value = this.tailInfo ? this.tailInfo.value : '';
  }

  private maxTailLength(): number {
    return this.tailInfo && this.tailInfo.allowedLength > 0 ? this.tailInfo.allowedLength : DEFAULT_TAIL_LENGTH;
  }

  private selectedLiveryId(): string | null {
    const selected = this.liveries.filter((livery) => livery.isSelected)[0];
    return selected ? selected.id : null;
  }

  /** The value is cleaned as it is typed. */
  private onTailTyped(value: string): void {
    const clean = cleanTail(value, this.maxTailLength());
    if (clean !== value && this.tail) this.tail.replace(clean);
    if (this.edit) this.edit.value = clean;
  }

  /**
   * Sends the tail number when the field is left or on Enter, not while typing: each value sent is kept for the
   * livery (tail-number.ts), so partial values would be kept too. A value typed for a livery that is no longer
   * selected is dropped. `stillEditing` (Enter): the field keeps the keyboard, so a later change is sent too.
   */
  private commitTail(stillEditing: boolean): void {
    const edit = this.edit;
    if (!edit) return;
    this.edit = stillEditing ? { livery: edit.livery, value: edit.value } : null;
    if (!this.tailInfo) return;
    const value = cleanTail(edit.value, this.maxTailLength());
    if (edit.livery !== this.selectedLiveryId()) {
      if (this.tail && !this.scope.disposed) this.tail.value = this.tailInfo.value;
      return;
    }
    if (!value || value === this.tailInfo.value) return;
    aircraft.SetCurrentAircraftIdentification.request(`${TAIL_NUMBER}%%${value}`).catch((error: unknown) => logError('the tail number could not be set', error));
  }
}
