// Which livery the Showcase panel shows and which one waits to be sent to the sim's configurator, without the sim
// (tested by test/aircraft-setup.test.ts). A step shows its livery at once; the panel sends it after a short quiet
// time, and meanwhile reloads its state, which may still report the old livery.

export class LiveryStepper {
  private aircraft = '';
  private ids: readonly string[] = [];
  private currentId: string | null = null;
  private pendingId: string | null = null;

  /** A reload: the liveries in the panel's order (favourites first) and the configurator's current one. */
  setLiveries(aircraft: string, ids: readonly string[], currentId: string | null): void {
    const sameAircraft = aircraft === this.aircraft;
    this.aircraft = aircraft;
    this.ids = ids;
    this.currentId = currentId;
    if (!sameAircraft || this.pendingId === currentId || (this.pendingId !== null && !ids.includes(this.pendingId))) {
      this.pendingId = null;
    }
  }

  /** One step (-1, 1, or a wheel's whole steps), clamped to the ends; returns the id now shown, or null. */
  step(delta: number): string | null {
    if (this.ids.length === 0) return null;
    const from = this.shownIndex();
    const target = Math.min(this.ids.length - 1, Math.max(0, from + delta));
    if (target === from) return this.shown();
    const id = this.ids[target];
    this.pendingId = id === this.currentId ? null : id;
    return id;
  }

  /** The id shown: the pending step's while one waits, else the configurator's. */
  shown(): string | null {
    if (this.ids.length === 0) return null;
    return this.pendingId ?? this.currentId;
  }

  /** The step waiting to be sent (null: none); cleared by `sent()`. */
  pending(): string | null {
    return this.pendingId;
  }

  /** The pending step went to the configurator: it is the current livery until a reload says otherwise. */
  sent(): void {
    if (this.pendingId !== null) this.currentId = this.pendingId;
    this.pendingId = null;
  }

  /** Index from 1 of the shown livery (the first when the configurator's is not listed). */
  position(): { index: number; count: number } | null {
    if (this.ids.length === 0) return null;
    return { index: this.shownIndex() + 1, count: this.ids.length };
  }

  canStep(direction: -1 | 1): boolean {
    if (this.ids.length === 0) return false;
    const target = this.shownIndex() + direction;
    return target >= 0 && target < this.ids.length;
  }

  private shownIndex(): number {
    return Math.max(0, this.ids.indexOf(this.pendingId ?? this.currentId ?? ''));
  }
}
