// The mouse wheel counted in steps (tested by test/wheel-steps.test.ts): the Showcase view's columns, whatever else moves
// one step per notch.

/** The wheel delta of one step: a mouse wheel's notch (deltaY 100, deltaMode 0, measured on 1.9.21, 2026-10-30). */
export const WHEEL_NOTCH = 100;

/**
 * The wheel's travel in whole steps: the events' deltas add up (a touchpad or a free-spinning wheel gives many small
 * ones) and every WHEEL_NOTCH of them is one step (one per notch); a change of direction starts again from nothing.
 */
export class WheelSteps {
  private rest = 0;

  /** The whole steps this event adds (negative toward the start); a delta in lines or pages (`deltaMode` not 0) is one notch. */
  add(delta: number, deltaMode: number): number {
    if (!delta) return 0;
    const pixels = deltaMode === 0 ? delta : Math.sign(delta) * WHEEL_NOTCH;
    if (this.rest !== 0 && Math.sign(this.rest) !== Math.sign(pixels)) this.rest = 0;
    this.rest += pixels;
    const steps = this.rest > 0 ? Math.floor(this.rest / WHEEL_NOTCH) : Math.ceil(this.rest / WHEEL_NOTCH);
    if (steps === 0) return 0;
    this.rest -= steps * WHEEL_NOTCH;
    return steps;
  }

  /** Forgets the travel short of a step. */
  reset(): void {
    this.rest = 0;
  }
}
