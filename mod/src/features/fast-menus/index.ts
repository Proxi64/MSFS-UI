// Fast menus: shortens the menu's scripted animations and removes the fade of images.
//
// Timelines (`UITimeline`) take their durations in ms, in their configuration and in each animation added;
// transitions (`UITransition`) in seconds, in the options of `getTransitionStr`. Everything is multiplied by
// 1 / speed, except looping animations (loading indicators…), which keep their pace. On unload the patches are
// removed; a timeline already built keeps the timings it was given until its screen is built again, and a new
// version of the mod scales from the original values (see timing.ts).

import { UITimeline, UITransition, type TimelineAnimationOptions, type TimelineEvent } from '/Global/engine_ui.bundle.js';
import { log } from '../../core/log.ts';
import { injectStyle } from '../../core/runtime.ts';
import type { Scope } from '../../core/scope.ts';
import type { Settings } from '../../generated/catalog.ts';
import { EVENT_KEYS, isLooping, prepareTimeline, scaled, scaledAnimation, TRANSITION_KEYS } from './timing.ts';

/** The sim's rule: `img.img-fade.img-fade--enabled { transition: opacity ease-in-out 0.5s }` (cross-fade element). */
const NO_IMAGE_FADE = 'img.img-fade.img-fade--enabled { transition: none !important; }';

export function fastMenus(settings: Settings['fastMenus'], scope: Scope): void {
  // Also at speed 1: timelines shortened by a previous version of the mod get their original timings back.
  speedUpAnimations(1 / settings.speed, scope);
  if (settings.instantImages) injectStyle(NO_IMAGE_FADE, scope);
  log(`fast menus: animations ×${settings.speed}, images ${settings.instantImages ? 'without' : 'with'} fade`);
}

function speedUpAnimations(factor: number, scope: Scope): void {
  scope.patch(UITimeline.prototype, 'add', (add) =>
    function (this: UITimeline, ...animations: TimelineAnimationOptions[]): boolean {
      const original = prepareTimeline(this, factor);
      return add.apply(this, animations.map((animation) => scaledAnimation(animation, original, factor)));
    },
  );

  scope.patch(UITimeline.prototype, 'addEvent', (addEvent) =>
    function (this: UITimeline, ...events: TimelineEvent[]): void {
      const original = prepareTimeline(this, factor);
      return addEvent.apply(this, isLooping(original) ? events : events.map((event) => scaled(event, EVENT_KEYS, factor)));
    },
  );

  scope.patch(UITransition.prototype, 'getTransitionStr', (getTransitionStr) =>
    function (this: UITransition, transition, options): string {
      return getTransitionStr.call(this, transition, scaled(options, TRANSITION_KEYS, factor));
    },
  );
}
