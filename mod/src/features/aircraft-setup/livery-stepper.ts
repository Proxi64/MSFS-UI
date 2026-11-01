// Which livery the Showcase panel shows and which one waits to be sent to the sim's configurator, without the sim
// (tested by test/aircraft-setup.test.ts). A step shows its livery at once; the panel sends it after a short quiet
// time, and meanwhile reloads its state, which may still report the old livery. LiverySends numbers what is sent.

export class LiveryStepper {
  private aircraft = '';
  private ids: readonly string[] = [];
  private currentId: string | null = null;
  private pendingId: string | null = null;
  /** Sent to the configurator, not reported by the sim yet. */
  private sentId: string | null = null;

  /** A reload: the liveries in the panel's order (favourites first) and the configurator's current one. */
  setLiveries(aircraft: string, ids: readonly string[], currentId: string | null): void {
    const sameAircraft = aircraft === this.aircraft;
    this.aircraft = aircraft;
    this.ids = ids;
    this.currentId = currentId;
    if (!sameAircraft || this.sentId === currentId || (this.sentId !== null && !ids.includes(this.sentId))) {
      this.sentId = null;
    }
    if (!sameAircraft || (this.sentId === null && this.pendingId === currentId) || (this.pendingId !== null && !ids.includes(this.pendingId))) {
      this.pendingId = null;
    }
  }

  /** One step (-1, 1, or a wheel's whole steps), clamped to the ends; returns the id now shown, or null. */
  step(delta: number): string | null {
    if (this.ids.length === 0) return null;
    const from = this.shownIndex();
    const target = Math.min(this.ids.length - 1, Math.max(0, from + delta));
    if (target === from) return this.shown();
    return this.choose(this.ids[target]!);
  }

  /** A livery chosen directly (the strip), shown as a step would be; returns the id now shown (unchanged for one not listed). */
  choose(id: string): string | null {
    if (!this.ids.includes(id)) return this.shown();
    this.pendingId = id === (this.sentId ?? this.currentId) ? null : id;
    return id;
  }

  /** The id shown: the pending step's while one waits, else the sent one's until the sim reports it, else the configurator's. */
  shown(): string | null {
    if (this.ids.length === 0) return null;
    return this.base();
  }

  /** The step waiting to be sent (null: none); cleared by `sent()`. */
  pending(): string | null {
    return this.pendingId;
  }

  /** The pending step went to the configurator: it stays shown until a reload reports it (or `abandonSent()`). */
  sent(): void {
    if (this.pendingId !== null) this.sentId = this.pendingId;
    this.pendingId = null;
  }

  /** The configurator ignored the choice or it failed: show the configurator's livery again. */
  abandonSent(): void {
    this.sentId = null;
  }

  /** The step waiting is dropped, never sent (another variant was chosen meanwhile). */
  drop(): void {
    this.pendingId = null;
  }

  /** Index from 1 of the shown livery; null without liveries or when the shown one is not listed. */
  position(): { index: number; count: number } | null {
    const index = this.ids.indexOf(this.base() ?? '');
    return index < 0 ? null : { index: index + 1, count: this.ids.length };
  }

  canStep(direction: -1 | 1): boolean {
    if (this.ids.length === 0) return false;
    const target = this.shownIndex() + direction;
    return target >= 0 && target < this.ids.length;
  }

  private base(): string | null {
    return this.pendingId ?? this.sentId ?? this.currentId;
  }

  /** Index of the shown livery; 0 when it is not listed. */
  private shownIndex(): number {
    return Math.max(0, this.ids.indexOf(this.base() ?? ''));
  }
}

/**
 * The steps of a LiveryStepper sent to the configurator, numbered: only the last send's refusal gives the livery shown
 * back to the sim's; an older answer arriving late changes nothing (a newer step is shown, or on its way).
 */
export class LiverySends {
  private readonly stepper: LiveryStepper;
  private last = 0;

  constructor(stepper: LiveryStepper) {
    this.stepper = stepper;
  }

  /** The step waiting, marked sent: its id and its number, or null when none waits. */
  take(): { id: string; number: number } | null {
    const id = this.stepper.pending();
    if (id === null) return null;
    this.stepper.sent();
    return { id, number: ++this.last };
  }

  /** The configurator's answer to send `number` (`done`: taken); true when the livery shown changed. */
  answered(number: number, done: boolean): boolean {
    if (done || number !== this.last) return false;
    this.stepper.abandonSent();
    return true;
  }
}
