// The setup panel's tail number (panel.ts): the sim's text field, cleaned as it is typed, sent to the sim's
// identification when the field is left or on Enter.

import { logError } from '../../core/log.ts';
import type { Scope } from '../../core/scope.ts';
import { TAIL_NUMBER, tailLength, tailNumberField, type Identification, type IdentificationField } from '../../sim/liveries.ts';
import { cleanTail } from '../../sim/registration.ts';
import { store } from '../../sim/store.ts';
import { createTextField, type TextField } from '../../sim/text-field.ts';

const aircraft = store.Game.Aircraft;

export class TailNumberField {
  private readonly scope: Scope;
  /** The livery selected now: a value typed belongs to the livery selected when the field took the keyboard. */
  private readonly selectedLivery: () => string | null;
  private field: TextField | null = null;
  private info: IdentificationField | null = null;
  /**
   * The tail number being typed: the livery selected when the field took the keyboard (the value belongs to it)
   * and the value typed so far (kept here: the field may be gone when the screen closes during the edit).
   */
  private edit: { livery: string | null; value: string } | null = null;

  constructor(scope: Scope, selectedLivery: () => string | null) {
    this.scope = scope;
    this.selectedLivery = selectedLivery;
  }

  mount(host: HTMLElement): void {
    // Leaving the screen while typing sends the value too (registered first: runs after the field is gone).
    this.scope.add(() => this.commit());
    createTextField(this.scope, host, {
      plain: true,
      onEnter: () => (this.edit = { livery: this.selectedLivery(), value: this.field ? this.field.value : '' }),
      onChange: (value) => this.onTyped(value),
      onSubmit: () => this.commitAndKeepEditing(),
      onLeave: () => this.commit(),
    }).then(
      (field) => {
        this.field = field;
        if (this.info) field.value = this.info.value;
      },
      (error: unknown) => logError('the tail number field could not be created', error),
    );
  }

  setIdentification(identification: Identification | null): void {
    this.info = tailNumberField(identification) || null;
    if (this.field) this.field.value = this.info ? this.info.value : '';
  }

  /** The value is cleaned as it is typed. */
  private onTyped(value: string): void {
    const clean = cleanTail(value, tailLength(this.info));
    if (clean !== value && this.field) this.field.replace(clean);
    if (this.edit) this.edit.value = clean;
  }

  /** The field left, or the screen closed: the value typed is sent and the edit ends. */
  private commit(): void {
    const edit = this.edit;
    if (!edit) return;
    this.edit = null;
    this.send(edit);
  }

  /** Enter: the value typed is sent; the field keeps the keyboard, so a later change is sent too. */
  private commitAndKeepEditing(): void {
    const edit = this.edit;
    if (!edit) return;
    this.edit = { livery: edit.livery, value: edit.value };
    this.send(edit);
  }

  /**
   * Sends the tail number of an edit, when the field is left or on Enter, not while typing: each value sent is kept for
   * the livery (tail-number.ts), so partial values would be kept too. A value typed for a livery that is no longer
   * selected is dropped.
   */
  private send(edit: { livery: string | null; value: string }): void {
    if (!this.info) return;
    const value = cleanTail(edit.value, tailLength(this.info));
    if (edit.livery !== this.selectedLivery()) {
      if (this.field && !this.scope.disposed) this.field.value = this.info.value;
      return;
    }
    if (!value || value === this.info.value) return;
    aircraft.SetCurrentAircraftIdentification.request(`${TAIL_NUMBER}%%${value}`).catch((error: unknown) => logError('the tail number could not be set', error));
  }
}
