// The Showcase panel's current livery, large (panel.ts): the sim's livery button as wide as the panel, the sim's arrow
// button on each side for the previous and the next livery (in the panel's order: favourites first,
// sim/livery-order.ts), its position and its heart over it; the wheel over it steps too. A step shows its livery at
// once and reaches the configurator after a short quiet time (livery-stepper.ts), so quick steps send one choice. A
// click in the strip of small liveries (livery-strip.ts) goes the same way, sent at once.

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
import { ANSWER_TIMEOUT_MS } from '../../sim/store.ts';
import { LiverySends, LiveryStepper, type LiverySend } from './livery-stepper.ts';

/** Quiet time after the last step before the livery shown is sent to the configurator. */
const LIVERY_SETTLE_MS = 300;
/** A livery taken by the configurator and still not reported by a reload after this time is abandoned. */
const SENT_REPORT_MS = 2 * ANSWER_TIMEOUT_MS;
/** The sim's arrow, as on its own livery block (Reno_SetupLiveryBlock): pointing right, turned for the left one. */
const ARROW_ICON = 'coui://html_UI/VFS/components/shared/resources/Icons/General/ArrowFull.svg';

/** The sim's livery button (ImageButtonLiveryManipulator). */
interface LiveryButtonManipulator {
  setData(image: string, callback: () => void): void;
}

export interface LargeLiveryEvents {
  /** Sends a livery to the configurator; false when it was ignored (the livery shown goes back to the sim's). */
  choose(send: LiverySend): Promise<boolean>;
  /** The heart was clicked. */
  favorite(id: string, on: boolean): void;
  /** The livery shown (at each draw, changed or not), or null. */
  shown(id: string | null): void;
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
  /** The livery under the pointer in the strip (null: none): the header names it. */
  private hovered: string | null = null;
  private readonly wheel = new WheelSteps();
  private readonly settle = debounced(() => this.send(), LIVERY_SETTLE_MS);
  private readonly sends = new LiverySends(this.stepper);
  /** Abandons the last livery taken if no reload reports it in time (one timer: only the last send counts). */
  private reportTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(scope: Scope, host: HTMLElement, events: LargeLiveryEvents) {
    this.scope = scope;
    this.host = host;
    this.events = events;
    scope.add(() => {
      this.settle.cancel();
      clearTimeout(this.reportTimer);
    });
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
    // The arrows and the wheel step through the available liveries only: an unavailable one is never sent.
    this.stepper.setLiveries(
      aircraft,
      ordered.items.filter((livery) => !livery.isDisabled || livery.isSelected).map((livery) => livery.id),
      selected ? selected.id : null,
    );
    if (this.stepper.pending() === null) this.settle.cancel();
    this.draw();
  }

  /** The liveries in the panel's order, as last rendered (the strip shows them in that order). */
  get items(): readonly ConfiguratorLivery[] {
    return this.liveries;
  }

  /** A livery chosen elsewhere (the strip): shown at once and sent without the quiet time. */
  choose(id: string): void {
    const shown = this.stepper.shown();
    if (this.stepper.choose(id) === shown) return;
    this.draw();
    this.settle.cancel();
    if (this.stepper.pending() !== null) this.send();
  }

  /** The livery under the pointer in the strip (null: none), named by the header instead of the one shown. */
  hover(id: string | null): void {
    this.hovered = id;
    this.draw();
  }

  /** Another variant was chosen: a step not sent yet is dropped. */
  dropStep(): void {
    this.settle.cancel();
    this.stepper.drop();
    this.draw();
  }

  private step(delta: number): void {
    const shown = this.stepper.shown();
    if (this.stepper.step(delta) === shown) return;
    this.draw();
    if (this.stepper.pending() === null) this.settle.cancel();
    else this.settle.call();
  }

  /**
   * The step waiting, to the configurator; the livery stays shown until the sim reports it (livery-stepper.ts), or
   * for `SENT_REPORT_MS` after the configurator took it: then the large livery, the strip's outline and the header
   * follow the configurator again.
   */
  private send(): void {
    const sent = this.sends.take();
    if (!sent) return;
    clearTimeout(this.reportTimer);
    const answer = (done: boolean) => {
      if (this.scope.disposed) return;
      if (this.sends.answered(sent.number, done)) this.draw();
      if (!done || !this.sends.isLast(sent.number)) return;
      clearTimeout(this.reportTimer);
      this.reportTimer = setTimeout(() => {
        if (!this.scope.disposed && this.sends.expired(sent.number)) this.draw();
      }, SENT_REPORT_MS);
    };
    this.events.choose(sent).then(answer, (error: unknown) => {
      logError('the livery could not be chosen', error);
      answer(false);
    });
  }

  private draw(): void {
    const id = this.stepper.shown();
    const livery = this.liveries.filter((candidate) => candidate.id === id)[0];
    const named = this.liveries.filter((candidate) => candidate.id === this.hovered)[0] || livery;
    this.name.textContent = named ? translate(named.title) : '';
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
    this.events.shown(id);
    const image = livery ? livery.imageUrl : '';
    const manipulator = this.button ? this.button.manipulator<LiveryButtonManipulator>() : null;
    if (manipulator && image !== this.image) {
      this.image = image;
      // A click on the livery sends a step still waiting at once.
      manipulator.setData(image, () => this.settle.flush());
    }
  }
}
