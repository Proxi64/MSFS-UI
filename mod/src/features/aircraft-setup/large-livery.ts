// The Showcase panel's current livery, large (panel.ts): the sim's livery button as wide as the panel, the sim's arrow
// button on each side for the previous and the next livery (in the panel's order: favourites first,
// sim/livery-order.ts), its position and its heart over it; the wheel over it steps too. A step shows its livery at
// once and reaches the configurator after a short quiet time (livery-stepper.ts), so quick steps send one choice.

import { debounced } from '../../core/async.ts';
import { el, toggleClass } from '../../core/dom.ts';
import { iconToggle, type IconToggle } from '../../core/icon-toggle.ts';
import { logError } from '../../core/log.ts';
import type { Scope } from '../../core/scope.ts';
import { WheelSteps } from '../../core/wheel-steps.ts';
import type { ConfiguratorLivery } from '../../sim/aircraft-loading.ts';
import { COMPONENTS, createComponent, type SimComponent } from '../../sim/components.ts';
import { isFavoriteLivery, loadFavoriteLiveries, type FavoriteLivery } from '../../sim/favorites.ts';
import { liveryFolder } from '../../sim/liveries.ts';
import { orderLiveries, type LiveryOrder } from '../../sim/livery-order.ts';
import { translate } from '../../sim/localization.ts';
import { LiveryStepper } from './livery-stepper.ts';

/** Quiet time after the last step before the livery shown is sent to the configurator. */
export const LIVERY_SETTLE_MS = 300;
/** The sim's arrow, as on its own livery block (Reno_SetupLiveryBlock): pointing right, turned for the left one. */
const ARROW_ICON = 'coui://html_UI/VFS/components/shared/resources/Icons/General/ArrowFull.svg';

/** The sim's livery button (ImageButtonLiveryManipulator). */
interface LiveryButtonManipulator {
  setData(image: string, callback: () => void): void;
}

export interface LargeLiveryEvents {
  /** Sends a livery to the configurator; false when it was ignored (the livery shown goes back to the sim's). */
  choose(id: string): Promise<boolean>;
  /** The heart was clicked. */
  favorite(id: string, on: boolean): void;
}

export class LargeLivery {
  readonly stepper = new LiveryStepper();
  /** For the livery header: the name of the livery shown. */
  readonly name = el('span', 'msfs-ui-value msfs-ui-setup__value');
  private readonly scope: Scope;
  private readonly host: HTMLElement;
  private readonly events: LargeLiveryEvents;
  private readonly position = el('span', 'msfs-ui-title msfs-ui-setup__position');
  /** The heart; a livery without a folder cannot be a favourite and shows none. */
  private readonly iconHost = el('div', 'msfs-ui-setup__icon');
  private readonly heart: IconToggle;
  private readonly arrows = new Map<-1 | 1, SimComponent>();
  private button: SimComponent | null = null;
  /** The liveries in the panel's order, and that order (kept while the variant stays). */
  private liveries: ConfiguratorLivery[] = [];
  private order: LiveryOrder | null = null;
  private favorites: FavoriteLivery[] = [];
  private image = '';
  private readonly wheel = new WheelSteps();
  private readonly settle = debounced(() => this.send(), LIVERY_SETTLE_MS);
  /** Number of the last livery sent: only its answer may give the livery shown back to the sim's. */
  private sends = 0;

  constructor(scope: Scope, host: HTMLElement, events: LargeLiveryEvents) {
    this.scope = scope;
    this.host = host;
    this.events = events;
    scope.add(() => this.settle.cancel());
    this.heart = iconToggle(scope, this.iconHost, 'favorite', (on) => {
      const id = this.stepper.shown();
      if (id) events.favorite(id, on);
    });
    const overlays: HTMLElement[] = [];
    for (const direction of [-1, 1] as const) {
      const arrowHost = el('div', `msfs-ui-setup__arrow msfs-ui-setup__arrow--${direction < 0 ? 'previous' : 'next'}`);
      overlays.push(arrowHost);
      // A click on an arrow does not reach the livery button around it.
      scope.listen(arrowHost, 'click', (event) => event.stopPropagation());
      createComponent(scope, COMPONENTS.iconButtonSquared, arrowHost, { Icon: ARROW_ICON }).then(
        (arrow) => {
          if (direction < 0) arrow.element.style.setProperty('--rotation', '180deg');
          this.arrows.set(direction, arrow);
          arrow.onClick(scope, () => this.step(direction));
          this.draw();
        },
        (error: unknown) => logError('a livery arrow could not be created', error),
      );
    }
    overlays.push(this.position, this.iconHost);
    const buttonHost = el('div', 'msfs-ui-setup__large-button', host);
    createComponent(scope, COMPONENTS.liveryButton, buttonHost).then(
      (button) => {
        this.button = button;
        // Inside the livery's component: the pointer on the arrows, the position or the heart keeps it hovered.
        for (const overlay of overlays) button.element.appendChild(overlay);
        this.draw();
      },
      (error: unknown) => logError('the large livery could not be created', error),
    );
    scope.listen(
      host,
      'wheel',
      (event) => {
        event.preventDefault();
        event.stopPropagation();
        const steps = this.wheel.add(event.deltaY || event.deltaX, event.deltaMode);
        if (steps) this.step(steps);
      },
      true,
    );
  }

  /** The configurator's liveries and its aircraft (`aircraft`: its identity; another one drops a step not sent yet). */
  render(liveries: ConfiguratorLivery[], aircraft: string): void {
    const favorites = (this.favorites = loadFavoriteLiveries());
    const ordered = orderLiveries(liveries, (livery) => isFavoriteLivery(livery, favorites), this.order);
    this.order = ordered.order;
    this.liveries = ordered.items;
    const selected = liveries.filter((livery) => livery.isSelected)[0];
    this.stepper.setLiveries(
      aircraft,
      ordered.items.map((livery) => livery.id),
      selected ? selected.id : null,
    );
    if (this.stepper.pending() === null) this.settle.cancel();
    this.draw();
  }

  private step(delta: number): void {
    const shown = this.stepper.shown();
    if (this.stepper.step(delta) === shown) return;
    this.draw();
    if (this.stepper.pending() === null) this.settle.cancel();
    else this.settle.call();
  }

  /** The step waiting, to the configurator; the livery stays shown until the sim reports it (livery-stepper.ts). */
  private send(): void {
    const id = this.stepper.pending();
    if (id === null) return;
    this.stepper.sent();
    const number = ++this.sends;
    const abandon = () => {
      if (number !== this.sends || this.scope.disposed) return;
      this.stepper.abandonSent();
      this.draw();
    };
    this.events.choose(id).then(
      (done) => {
        if (!done) abandon();
      },
      (error: unknown) => {
        logError('the livery could not be chosen', error);
        abandon();
      },
    );
  }

  private draw(): void {
    const id = this.stepper.shown();
    const livery = this.liveries.filter((candidate) => candidate.id === id)[0];
    this.name.textContent = livery ? translate(livery.title) : '';
    const position = this.stepper.position();
    this.position.textContent = position ? `${position.index} / ${position.count}` : '';
    toggleClass(this.host, 'is-empty', !livery);
    // ImageButton_Livery has no Disabled state of its own: an unavailable livery is dimmed (aircraft-setup.css).
    toggleClass(this.host, 'is-disabled', !!livery && !!livery.isDisabled);
    const favorite = !!livery && isFavoriteLivery(livery, this.favorites);
    toggleClass(this.host, 'is-favorite', favorite);
    toggleClass(this.host, 'has-heart', !!livery && !!liveryFolder(livery));
    this.heart.set(favorite);
    this.arrows.forEach((arrow, direction) => arrow.disable(!this.stepper.canStep(direction)));
    const image = livery ? livery.imageUrl : '';
    const manipulator = this.button ? this.button.manipulator<LiveryButtonManipulator>() : null;
    if (manipulator && image !== this.image) {
      this.image = image;
      // A click on the livery sends a step still waiting at once.
      manipulator.setData(image, () => this.settle.flush());
    }
  }
}
