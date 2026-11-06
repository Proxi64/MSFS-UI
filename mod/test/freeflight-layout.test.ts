import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { freeflightPlaces, type PlaceInput, type Places } from '../src/features/freeflight-layout/places.ts';
import { frameEdge } from '../src/features/freeflight-layout/sim-blocks.ts';
import { underSearchTop } from '../src/sim/freeflight-layout.ts';

describe('underSearchTop', () => {
  it('puts the favourites and Today a group gap, a search row and a section gap under the top row', () => {
    assert.equal(underSearchTop(373, 4 / 3), 373 + 32 + 40 + 8);
    assert.equal(underSearchTop(280, 1), 280 + 24 + 30 + 6);
  });
});

describe('frameEdge', () => {
  const left = (units: string) => `calc(var(--h-anchor) + calc(var(--unscaledScreenHeight) * ${units}px / 1080))`;

  it("reads a block on the frame's left edge", () => {
    assert.equal(frameEdge(left('-940')), -1);
  });

  it("reads a block on the frame's right edge, whatever the number's form", () => {
    assert.equal(frameEdge(left('940')), 1);
    assert.equal(frameEdge(left('940.0000')), 1);
  });

  it('leaves the other blocks', () => {
    assert.equal(frameEdge(left('446')), 0);
    assert.equal(frameEdge(''), 0);
    assert.equal(frameEdge('32px'), 0);
  });
});

/** The sim's blocks as drawn at `height` lines: the menu bar 50 units, the top row 190, EFB and Start flight 49.5. */
function input(width: number, height: number): PlaceInput {
  const unit = height / 1080;
  return {
    width,
    height,
    unit,
    menuHeight: Math.floor(50 * unit),
    mainHeight: Math.floor(190 * unit),
    efbHeight: Math.floor(49.5 * unit),
    flyHeight: Math.floor(49.5 * unit),
    filtersHeight: Math.floor(44 * unit),
  };
}

describe('freeflightPlaces', () => {
  it('puts the columns 24 units from the edges of a 3440 x 1440 screen', () => {
    const places = freeflightPlaces(input(3440, 1440));
    assert.equal(places.left, 32);
    assert.equal(places.right, 3408);
    assert.equal(places.columnWidth, 586);
    assert.equal(places.planInset, 586 + 32);
  });

  it('stacks the top rows 24 units apart from the screen top', () => {
    const places = freeflightPlaces(input(3440, 1440));
    assert.equal(places.menuTop, 32);
    assert.equal(places.mainTop, 32 + 66 + 32);
    assert.equal(places.searchTop, 32 + 66 + 32 + 253 + 32);
  });

  it('stacks Start flight, EFB and the map buttons 24 units apart from the screen bottom', () => {
    const places = freeflightPlaces(input(3440, 1440));
    assert.equal(places.buttonsBottom, 1440 - 32);
    assert.equal(places.buttonsHeight, 66 + 32 + 66);
    assert.equal(places.filtersBottom, 1440 - 32 - (66 + 32 + 66) - 32);
  });

  it("fits the map's panels between Search location's top and a group gap above the map buttons", () => {
    const places = freeflightPlaces(input(3440, 1440));
    assert.equal(places.panelsHeight, places.filtersBottom - 58 - 32 - places.searchTop);
  });

  it('puts the columns 24 units from the edges of a 16:9 screen', () => {
    const places = freeflightPlaces(input(1920, 1080));
    assert.equal(places.left, 24);
    assert.equal(places.right, 1896);
  });

  it('stops the layout at a 21:9 width and centres it on a 32:9 screen', () => {
    const places = freeflightPlaces(input(5120, 1440));
    assert.equal(places.left, 840 + 32);
    assert.equal(places.right, 840 + 3440 - 32);
  });

  it('keeps whole pixels and an even width between the edges on an odd screen width', () => {
    const places = freeflightPlaces(input(2161, 1164));
    assert.ok(Number.isInteger(places.left) && Number.isInteger(places.right));
    assert.equal((places.right - places.left) % 2, 0);
    assert.ok(Math.abs(places.left - (2161 - places.right)) <= 1);
  });

  it('gives whole pixels at every size', () => {
    for (const [width, height] of [[3440, 1440], [1920, 1080], [5120, 1440], [2161, 1164], [2560, 1080], [3840, 2160]] as const) {
      const places: Places = freeflightPlaces(input(width, height));
      for (const [key, value] of Object.entries(places)) assert.ok(Number.isInteger(value), `${width} x ${height}: ${key} = ${value}`);
    }
  });
});
