// The setup panel's liveries (panel.ts): the sim's livery thumbnails in the sim's scrolling list, three per row, a
// heart on each (favourite liveries, shown first: sim/livery-order.ts), the name of the livery in the header.

import { el, toggleClass } from '../../core/dom.ts';
import { iconToggle, type IconToggle } from '../../core/icon-toggle.ts';
import { logError } from '../../core/log.ts';
import type { Scope } from '../../core/scope.ts';
import type { ConfiguratorLivery } from '../../sim/aircraft-loading.ts';
import { COMPONENTS, createComponent, type SimComponent } from '../../sim/components.ts';
import { isFavoriteLivery, loadFavoriteLiveries } from '../../sim/favorites.ts';
import { liveryFolder } from '../../sim/liveries.ts';
import { orderLiveries, type LiveryOrder } from '../../sim/livery-order.ts';
import { translate } from '../../sim/localization.ts';
import { createRealScroll, removeFromList } from '../../sim/real-scroll.ts';

/** The sim's livery button (ImageButtonLiveryManipulator). */
interface LiveryButtonManipulator {
  setData(image: string, callback: () => void): void;
}

interface LiveryTile {
  button: SimComponent;
  /** The favourite heart; a livery without a folder cannot be a favourite and has none. */
  icon: IconToggle | null;
  host: HTMLElement;
}

export interface LiveryEvents {
  /** An available livery not selected yet was clicked. */
  choose(id: string): void;
  /** A heart was clicked. */
  favorite(id: string, on: boolean): void;
  /** The thumbnails were rebuilt: the panel lays its lists out again. */
  relayout(): void;
}

export class LiveryThumbnails {
  readonly list = createRealScroll('y', 'msfs-ui-setup__liveries');
  /** For the header: the selected livery's name, or the one under the pointer. */
  readonly name = el('span', 'msfs-ui-value msfs-ui-setup__value');
  private readonly scope: Scope;
  private readonly events: LiveryEvents;
  /** Components by id, built for one ordered set of ids. */
  private items: ConfiguratorLivery[] = [];
  private key = '';
  private tilesScope: Scope | null = null;
  private hosts: HTMLElement[] = [];
  private readonly tiles = new Map<string, LiveryTile>();
  private order: LiveryOrder | null = null;
  private selectedTitle = '';

  constructor(scope: Scope, events: LiveryEvents) {
    this.scope = scope;
    this.events = events;
  }

  get count(): number {
    return this.items.length;
  }

  selectedId(): string | null {
    const selected = this.items.filter((livery) => livery.isSelected)[0];
    return selected ? selected.id : null;
  }

  render(items: ConfiguratorLivery[]): void {
    const favorites = loadFavoriteLiveries();
    const ordered = orderLiveries(items, (livery) => isFavoriteLivery(livery, favorites), this.order);
    this.order = ordered.order;
    this.items = ordered.items;
    const selected = items.filter((livery) => livery.isSelected)[0];
    this.selectedTitle = selected ? translate(selected.title) : '';
    this.name.textContent = this.selectedTitle;

    const key = ordered.items.map((livery) => livery.id).join('|');
    if (key !== this.key) {
      this.key = key;
      this.build(ordered.items);
      this.events.relayout();
      if (ordered.reordered) this.list.scrollToPosition(0);
    }
    this.updateAll(favorites);
  }

  private build(items: ConfiguratorLivery[]): void {
    if (this.tilesScope) this.tilesScope.dispose();
    const scope = (this.tilesScope = this.scope.child());
    this.tiles.clear();
    removeFromList(this.hosts);
    this.hosts = [];
    for (const livery of items) {
      const host = el('div', 'msfs-ui-setup__livery');
      this.list.appendChild(host);
      this.hosts.push(host);
      const buttonHost = el('div', 'msfs-ui-setup__thumbnail', host);
      const iconHost = liveryFolder(livery) ? el('div', 'msfs-ui-setup__icon', host) : null;
      // The change event redraws this panel (hearts) and the gallery; the order of the thumbnails stays.
      const icon = iconHost ? iconToggle(scope, iconHost, 'favorite', (checked) => this.events.favorite(livery.id, checked)) : null;
      scope.listen(host, 'mouseenter', () => (this.name.textContent = translate(livery.title)));
      scope.listen(host, 'mouseleave', () => (this.name.textContent = this.selectedTitle));
      createComponent(scope, COMPONENTS.liveryButton, buttonHost).then(
        (button) => {
          if (scope.disposed) return;
          const thumbnail = button.manipulator<LiveryButtonManipulator>();
          if (thumbnail) thumbnail.setData(livery.imageUrl, () => this.choose(livery.id));
          // Inside the thumbnail's component: the pointer on the icon keeps it hovered.
          if (iconHost) button.element.appendChild(iconHost);
          const tile = { button, icon, host };
          this.tiles.set(livery.id, tile);
          const current = this.items.filter((candidate) => candidate.id === livery.id)[0];
          if (current) this.update(current, tile, loadFavoriteLiveries());
        },
        (error: unknown) => logError('a livery thumbnail could not be created', error),
      );
    }
  }

  private updateAll(favorites: ReturnType<typeof loadFavoriteLiveries>): void {
    for (const livery of this.items) {
      const tile = this.tiles.get(livery.id);
      if (tile) this.update(livery, tile, favorites);
    }
  }

  /**
   * Selection, favourite heart and availability of one thumbnail. ImageButton_Livery has no Disabled state of its
   * own: an unavailable livery is dimmed by its host (aircraft-setup.css), and a click on it is ignored.
   */
  private update(livery: ConfiguratorLivery, tile: LiveryTile, favorites: ReturnType<typeof loadFavoriteLiveries>): void {
    tile.button.select(livery.isSelected);
    toggleClass(tile.host, 'is-disabled', !!livery.isDisabled);
    const favorite = isFavoriteLivery(livery, favorites);
    toggleClass(tile.host, 'is-favorite', favorite);
    if (tile.icon) tile.icon.set(favorite);
  }

  private choose(id: string): void {
    const livery = this.items.filter((candidate) => candidate.id === id)[0];
    if (!livery || livery.isSelected || livery.isDisabled) return;
    this.events.choose(id);
  }
}
