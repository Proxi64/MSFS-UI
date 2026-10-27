// Sizes and texts of the livery column of the side by side layout, without the sim (tested by
// test/aircraft-gallery.test.ts). The gallery is cut in two columns: the aircraft on the left, the liveries of the
// current aircraft on the right, two large tiles per row.

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
 * A livery tile, two per row in a column `column` wide that keeps `room` on the right for the scroll bar, `gap` between
 * the tiles: its width, the height of its image (the thumbnails' ratio) and its whole height with the text banner.
 */
export function liveryTileSize(column: number, room: number, gap: number, banner: number): { width: number; imageHeight: number; height: number } {
  const width = Math.floor((column - room - gap) / 2);
  const imageHeight = Math.round(width * THUMBNAIL_RATIO);
  return { width, imageHeight, height: imageHeight + Math.round(banner) };
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
