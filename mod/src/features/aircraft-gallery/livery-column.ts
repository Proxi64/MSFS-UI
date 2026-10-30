// Sizes and texts of the gallery's layout, above all the livery column of the side by side layout, without the sim
// (tested by test/aircraft-gallery.test.ts). The gallery is cut in two columns: the aircraft on the left, the liveries
// of the current aircraft on the right, two large tiles per row; the bar is cut the same way (gallery.ts).

import { pickRegistration, registrationFromName } from '../../sim/registration.ts';

/** Proportions of the sim's livery thumbnails (720 × 344): the tile's image is never cut. */
const THUMBNAIL_RATIO = 344 / 720;

/** Tiles per row of the side by side layout: the aircraft on the left, the liveries on the right. */
export const AIRCRAFT_COLUMNS = 3;
export const LIVERY_COLUMNS = 2;

/**
 * The gallery's width cut in two columns `gap` apart, in whole pixels, so that an aircraft tile (AIRCRAFT_COLUMNS per
 * row, `margin` on each side, as in the gallery) and a livery tile (LIVERY_COLUMNS per row, two margins between them)
 * get the same width; each column keeps `room` on the right for its scroll bar.
 */
export function splitColumns(width: number, gap: number, room: number, margin: number): { left: number; right: number } {
  const tile = (width - gap - 2 * room - 2 * margin * AIRCRAFT_COLUMNS - 2 * margin * (LIVERY_COLUMNS - 1)) / (AIRCRAFT_COLUMNS + LIVERY_COLUMNS);
  const left = Math.round(AIRCRAFT_COLUMNS * (tile + 2 * margin) + room);
  return { left, right: width - gap - left };
}

/**
 * Whether the bar's count shows only the number of tiles shown (not "shown / total"): when the full count would leave
 * the search narrower than `minSearch`. `room` is the search's width and the count's together, as now: the search
 * takes what the count leaves, so the sum does not change with the count's text (no swing between the two forms).
 */
export function shortCount(room: number, fullCount: number, minSearch: number): boolean {
  return room - fullCount < minSearch;
}

/**
 * The width of the gallery's List rows, in whole pixels: the list's width less the room kept on the right and the
 * scroll bar's width, whether the list scrolls or not, so that the rows keep one width (a short list, the Hidden view,
 * would otherwise give them the bar's width too).
 */
export function aircraftRowWidth(list: number, room: number, bar: number): number {
  return Math.floor(list - room - bar);
}

/**
 * A livery tile, two per row in a column `column` wide that keeps `room` on the right for the scroll bar, `gap` between
 * the tiles: its width, the height of its image (the thumbnails' ratio) and its whole height with the text banner.
 */
export function liveryTileSize(column: number, room: number, gap: number, banner: number): { width: number; imageHeight: number; height: number } {
  const width = Math.floor((column - room - gap) / 2);
  const imageHeight = Math.round(width * THUMBNAIL_RATIO);
  return { width, imageHeight, height: imageHeight + Math.round(banner) };
}

/** Sizes of the livery column, in pixels: room kept for the scroll bar, gap between two tiles, text banner, List row and its gap. */
export interface LiverySizes {
  room: number;
  gap: number;
  banner: number;
  rowStep: number;
}

/**
 * The livery column's tiles (`count` of them; `rows`: the List view) in a column `column` wide over a list
 * `listHeight` high. When they fit at the full width (`full`), they fill it to its right edge, as the header: no room
 * kept for a bar that does not show. Otherwise the bar (`bar` wide) and its room are kept. Decided on the full width
 * only (core/virtual-list.ts: narrower tiles are shorter and would make the list fit again). `gap`: the space between
 * the two tiles of a row, in whole pixels, so that the second one ends on the edge (the odd pixel goes to it).
 */
export function liveryFit(column: number, bar: number, sizes: LiverySizes, count: number, rows: boolean, listHeight: number): { full: boolean; tile: { width: number; imageHeight: number; height: number }; gap: number } {
  const fullTile = liveryTileSize(column, 0, sizes.gap, sizes.banner);
  const height = rows ? count * sizes.rowStep : Math.ceil(count / LIVERY_COLUMNS) * (fullTile.height + sizes.gap);
  const full = height <= listHeight + 0.5;
  const space = full ? column : column - bar - sizes.room;
  const tile = full ? fullTile : liveryTileSize(column - bar, sizes.room, sizes.gap, sizes.banner);
  return { full, tile, gap: Math.round(space - 2 * tile.width) };
}

/**
 * Where the bar of the aircraft column starts and ends, in pixels from the list's left edge: on the tiles (the first
 * one's left, the last one's of a row right: `columns` tiles `width` wide, `margin` on each side) or on the rows
 * (`rowWidth` wide, from the edge), not over the scroll bar.
 */
export function aircraftBarEdges(view: string, tile: { columns: number; width: number }, margin: number, rowWidth: number): { left: number; right: number } {
  if (view !== 'gallery') return { left: 0, right: rowWidth };
  return { left: Math.round(margin), right: Math.round(tile.columns * (tile.width + 2 * margin) - margin) };
}

/**
 * The tail number of a livery as the mod would apply it (features/tail-number.ts): the one chosen for it, the
 * `atc_id` of its livery.cfg, a registration in its name; '' when none fits the field.
 */
export function liveryTail(chosen: string | undefined, atcId: string | null, title: string, maxLength: number): string {
  const pick = pickRegistration(
    [
      { source: 'chosen for this livery', value: chosen },
      { source: "the livery's atc_id", value: atcId },
      { source: "the livery's name", value: registrationFromName(title) },
    ],
    maxLength,
  );
  return pick ? pick.registration : '';
}

/**
 * Class of the gallery's list for a view: written whole at every rebuild of the list, so it carries the side by side
 * flag too (the List rows' two lines depend on it; dropped until the next layout pass, they would flicker).
 */
export function galleryBodyClass(view: string, sideBySide: boolean): string {
  return `msfs-ui-gal__body is-${view}${sideBySide ? ' is-side-by-side' : ''}`;
}