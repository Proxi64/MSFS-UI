// Free Flight on every screen width (the owner, 2026-11-06, after a user's report on a 34-inch screen): the sim keeps
// Free Flight in a frame 1880 units wide at the screen's centre; the columns go to the screen's edges instead (up to
// a 21:9 width), Departure / Arrival stretches between them, and the gaps follow one rule (places.ts). The mod's own
// panels follow, anchored on the sim's blocks. Everything is put back when the screen closes or the mod unloads.

import { uiUnit } from '../../core/dom.ts';
import { log } from '../../core/log.ts';
import type { Scope } from '../../core/scope.ts';
import type { Settings } from '../../generated/catalog.ts';
import { FLIGHT_CONDITIONS_WIDGET } from '../../sim/freeflight-layout.ts';
import { isShown, onScreenActive, SCREENS, type Manipulator } from '../../sim/screens.ts';
import { freeflightPlaces, type Places } from './places.ts';
import { frameEdge, SimBlock } from './sim-blocks.ts';

/** How often the places are checked: the sim animates and resizes its screens without notice. */
const LAYOUT_MS = 250;

export function freeflightLayout(_settings: Settings['freeflightLayout'], scope: Scope): void {
  const hooked = onScreenActive(SCREENS.freeFlight, scope, (page, screen) => new WideLayout(page, screen).mount());
  if (!hooked) throw new Error('the Free Flight screen is missing');
  log("Free Flight laid out to the screen's edges");
}

class WideLayout {
  private readonly page: Manipulator;
  private readonly scope: Scope;
  /** The blocks the sim puts on its frame's left (−1) or right (1) edge, read from their style when first seen. */
  private readonly edges = new Map<HTMLElement, { block: SimBlock; edge: -1 | 0 | 1 }>();
  private readonly named = new Map<string, SimBlock>();

  constructor(page: Manipulator, scope: Scope) {
    this.page = page;
    this.scope = scope;
  }

  mount(): void {
    this.layout();
    this.scope.interval(() => this.layout(), LAYOUT_MS);
  }

  private layout(): void {
    const root = this.page.elt;
    if (!isShown(root.querySelector(FLIGHT_CONDITIONS_WIDGET))) return;
    const main = childNamed(root, 'MainBlock');
    if (!main) return;
    const origin = root.getBoundingClientRect();
    const height = (selector: string, within: ParentNode = root) => {
      const element = within.querySelector(selector);
      return element ? Math.round(element.getBoundingClientRect().height) : 0;
    };
    const places = freeflightPlaces({
      width: Math.round(origin.width),
      height: Math.round(origin.height),
      unit: uiUnit(),
      menuHeight: height('[name="MenuBarPage"] [name="MenuBar"]', document),
      mainHeight: Math.round(main.getBoundingClientRect().height),
      efbHeight: height('[name="Buttons"] > [name="EFB"]'),
      flyHeight: height('[name="Buttons"] > [name="Fly"]'),
    });
    this.placeEdges(places);
    this.placeTopRow(main, places);
  }

  /** Every block on the frame's edge to the layout's edge, whatever it is (the sim's cards appear later). */
  private placeEdges(places: Places): void {
    const children = this.page.elt.children;
    for (let at = 0; at < children.length; at++) {
      const element = children[at] as HTMLElement;
      let entry = this.edges.get(element);
      if (!entry) {
        const style = element.style;
        const edge = style.getPropertyValue('--h-anchor').trim() === '50%' ? frameEdge(style.left) : 0;
        entry = { block: new SimBlock(element, this.scope), edge };
        this.edges.set(element, entry);
      }
      if (entry.edge === 0) continue;
      entry.block.set('--h-anchor', '0%');
      entry.block.set('left', `${entry.edge < 0 ? places.left : places.right}px`);
    }
  }

  /** The top row as wide as the layout, Departure / Arrival a group gap from each column. */
  private placeTopRow(main: HTMLElement, places: Places): void {
    const width = places.right - places.left;
    const row = this.block('MainBlock', main);
    row.set('--h-anchor', '0%');
    row.set('left', `${(places.left + places.right) / 2}px`);
    row.set('width', `${width}px`);
    const plan = this.child(main, 'FreeFlight_Plan');
    if (plan) {
      plan.set('left', `${places.planInset}px`);
      plan.set('right', `${places.planInset}px`);
    }
    const weather = this.child(main, 'WeatherBlock');
    if (weather) weather.set('left', `${width - places.columnWidth}px`);
  }

  private child(parent: HTMLElement, name: string): SimBlock | null {
    const element = childNamed(parent, name);
    return element ? this.block(name, element) : null;
  }

  private block(name: string, element: HTMLElement): SimBlock {
    let block = this.named.get(name);
    if (!block || block.element !== element) {
      block = new SimBlock(element, this.scope);
      this.named.set(name, block);
    }
    return block;
  }
}

/** The direct child of `parent` with that name. */
function childNamed(parent: Element, name: string): HTMLElement | null {
  for (let at = 0; at < parent.children.length; at++) {
    const child = parent.children[at] as HTMLElement;
    if (child.getAttribute('name') === name) return child;
  }
  return null;
}
