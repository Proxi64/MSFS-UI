// Icons drawn by the mod (the sim's own icons are loaded with `loadSvg`). Line icons in `currentColor`, so that the CSS
// colours them with `color` (white; dark on a hovered white row). Drawn on a 24 x 24 grid, 1.7 wide round strokes.

const OPEN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">';
const BOOKMARK = '<path d="M6.5 20.5V5.2c0-1.1.9-2 2-2h7c1.1 0 2 .9 2 2v5.3"/><path d="M6.5 20.5l4.6-3.4"/>';
const STAR = '16.6,13.9 17.4,15.7 19.3,15.8 17.8,17 18.3,18.9 16.6,17.9 14.9,18.9 15.4,17 13.9,15.8 15.8,15.7';
/** The same star as a path, its points in reverse order: wound against the disc, the hole shows under both fill rules. */
const STAR_PATH = 'M16.6 13.9L15.8 15.7L13.9 15.8L15.4 17L14.9 18.9L16.6 17.9L18.3 18.9L17.8 17L19.3 15.8L17.4 15.7z';

/** Bookmark with an empty star disc: not a favourite. */
export const BOOKMARK_SVG = `${OPEN}${BOOKMARK}<circle cx="16.6" cy="16.6" r="5.2"/><polygon points="${STAR}" fill="currentColor" stroke="none"/></svg>`;

/** Bookmark with a filled disc, the star cut out of it (even-odd), so that it shows the colour under it: a favourite. */
export const BOOKMARK_FULL_SVG =
  `${OPEN}${BOOKMARK}` +
  `<path d="M16.6 11a5.6 5.6 0 1 1 0 11.2a5.6 5.6 0 1 1 0-11.2z${STAR_PATH}" fill="currentColor" fill-rule="evenodd" stroke="none"/></svg>`;

/** Slashed eye: an aircraft hidden (or to hide). */
export const EYE_SLASH_SVG =
  `${OPEN}<path d="M2.5 12c2.2-3.9 5.6-6 9.5-6s7.3 2.1 9.5 6c-2.2 3.9-5.6 6-9.5 6s-7.3-2.1-9.5-6z"/>` +
  '<circle cx="12" cy="12" r="3.2"/><line x1="4.5" y1="19.5" x2="19.5" y2="4.5"/></svg>';
