// The mod's own icon buttons: a bookmark with a star (favourite livery) and a slashed eye (hidden aircraft). Plain
// elements with an inline SVG in `currentColor`, not the sim's components (the owner's choice, CLAUDE.md); the CSS
// colours them (`.msfs-ui-icon`, aircraft-gallery.css and the other features' CSS).

import { button, toggleClass } from './dom.ts';
import { BOOKMARK_FULL_SVG, BOOKMARK_SVG, EYE_SLASH_SVG } from './icons.ts';
import type { Scope } from './scope.ts';

export type IconKind = 'favorite' | 'hidden';

export interface IconToggle {
  readonly element: HTMLElement;
  /** Shows the state (class `is-on`, and the full bookmark for a favourite); does not call `onToggle`. */
  set(checked: boolean): void;
}

function markup(kind: IconKind, checked: boolean): string {
  if (kind === 'hidden') return EYE_SLASH_SVG;
  return checked ? BOOKMARK_FULL_SVG : BOOKMARK_SVG;
}

/**
 * An icon button in `parent`, removed with `scope`. A click asks for the opposite state (`onToggle`) and does not reach
 * the tile under the icon. Its children need `pointer-events: none` (CSS): a click on one does not bubble up.
 */
export function iconToggle(scope: Scope, parent: Element, kind: IconKind, onToggle: (checked: boolean) => void): IconToggle {
  let checked = false;
  let drawn = '';
  const element = button(`msfs-ui-icon msfs-ui-icon--${kind}`, parent, () => onToggle(!checked));
  scope.add(() => {
    if (element.parentNode) element.parentNode.removeChild(element);
  });
  scope.listen(element, 'click', (event) => event.stopPropagation());
  const draw = () => {
    const svg = markup(kind, checked);
    if (svg !== drawn) {
      drawn = svg;
      element.innerHTML = svg;
    }
    toggleClass(element, 'is-on', checked);
  };
  draw();
  return {
    element,
    set(value: boolean): void {
      checked = value;
      draw();
    },
  };
}
