// Icons drawn by the mod (the sim's own icons are loaded with `loadSvg`). Line icons in `currentColor`, so that the CSS
// colours them with `color` (white; dark on a hovered white row). Drawn on a 24 x 24 grid, 1.7 wide round strokes.

const OPEN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">';
/** A heart, its point at the bottom, as the sim's own heart of 1.x (the users preferred it to the bookmark of 2.0.0, 2026-10-30). */
const HEART = 'M12 20.3C7.2 16.4 3.6 13.3 3.6 9.3c0-2.6 2-4.6 4.5-4.6 1.6 0 3 .8 3.9 2.1.9-1.3 2.3-2.1 3.9-2.1 2.5 0 4.5 2 4.5 4.6 0 4-3.6 7.1-8.4 11z';

/** An empty heart: not a favourite. */
export const HEART_SVG = `${OPEN}<path d="${HEART}"/></svg>`;

/** A full heart: a favourite. */
export const HEART_FULL_SVG = `${OPEN}<path d="${HEART}" fill="currentColor"/></svg>`;

/** Slashed eye: an aircraft hidden (or to hide). */
export const EYE_SLASH_SVG =
  `${OPEN}<path d="M2.5 12c2.2-3.9 5.6-6 9.5-6s7.3 2.1 9.5 6c-2.2 3.9-5.6 6-9.5 6s-7.3-2.1-9.5-6z"/>` +
  '<circle cx="12" cy="12" r="3.2"/><line x1="4.5" y1="19.5" x2="19.5" y2="4.5"/></svg>';
