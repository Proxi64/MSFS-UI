// Small UI building blocks suited to Coherent GT (see CLAUDE.md, "Findings for building a UI").

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, parent?: Element): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (parent) parent.appendChild(element);
  return element;
}

/** Input group of a clickable element: without one, Coherent only sends hover events, no button events. */
export const BUTTON_INPUT_GROUP = 'generic-button';

/**
 * A clickable element. Its children need `pointer-events: none` (in the feature's CSS): a click on a child does not
 * bubble up to the button.
 */
export function button(className: string, parent: Element, onClick: () => void): HTMLDivElement {
  const element = el('div', className, parent);
  element.setAttribute('data-input-group', BUTTON_INPUT_GROUP);
  element.addEventListener('click', onClick);
  return element;
}

/** Sets a class when `on` is true and removes it otherwise. */
export function toggleClass(element: Element, className: string, on: boolean): void {
  if (on) element.classList.add(className);
  else element.classList.remove(className);
}

const svgCache = new Map<string, Promise<string>>();

/**
 * The sim's SVG icons have no colour of their own (black in an `<img>`): their markup is inserted into the page
 * instead, to colour them with `fill`. Titles are removed so they do not show as tooltips.
 */
export function loadSvg(url: string): Promise<string> {
  let svg = svgCache.get(url);
  if (!svg) {
    svg = fetch(url)
      .then((response) => response.text())
      .then((text) => {
        // Coherent's fetch of coui:// files gives no reliable HTTP status: the content tells a missing icon.
        if (text.indexOf('<svg') < 0) throw new Error(`${url} is not an SVG icon`);
        return text.replace(/<title>[\s\S]*?<\/title>/g, '');
      });
    svgCache.set(url, svg);
    // A failed load is not cached: the next call tries again.
    svg.catch(() => svgCache.delete(url));
  }
  return svg;
}

/**
 * Layout unit in pixels: 1/1080 of the sim's `--unscaledScreenHeight`, the unit of the sim's own mock-ups (the window
 * height when the variable is missing).
 */
export function uiUnit(): number {
  const height = parseFloat(window.getComputedStyle(document.documentElement).getPropertyValue('--unscaledScreenHeight'));
  return (height > 0 ? height : window.innerHeight) / 1080;
}

