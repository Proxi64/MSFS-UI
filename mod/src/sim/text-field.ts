// A text field made of the sim's own Search_Input component: its manipulator handles the keyboard like the sim's
// search fields (the sim's shortcuts stay off while typing, the virtual keyboard works). Verified on sim 1.9.18:
// typed text arrives through `addChangeCallback`, entering and leaving through `addEnterCallback` /
// `addExitCallback`, Enter through `addSubmitCallback`; `setSearchValue` writes the field. The plain variant is
// the sim's `forceInput` visual flag (`State_Input`: no magnifier), which the element keeps.
// It replaces the 0.3.0 workaround (ENTER_INPUT_FIELD and an input bar), which a plain <input> needed.

import type { Scope } from '../core/scope.ts';
import { COMPONENTS, createComponent, type SimComponent } from './components.ts';

/** What the mod uses of the sim's SearchInputManipulator. */
interface SearchInputManipulator {
  searchValue: string;
  setSearchValue(value: string): void;
  addChangeCallback(callback: (event: Event) => void): void;
  addEnterCallback(callback: () => void): void;
  addExitCallback(callback: () => void): void;
  addSubmitCallback(callback: () => void): void;
  clearAllCallbacks?(): void;
}

export interface TextFieldOptions {
  /** Text shown while the field is empty. */
  placeholder?: string;
  /** A plain input (the sim's `State_Input`: no magnifier) rather than a search field. */
  plain?: boolean;
  /** Called when the field takes the keyboard. */
  onEnter?: () => void;
  /** Called on Enter. */
  onSubmit?: (value: string) => void;
  /** Called with the text at each change. */
  onChange?: (value: string) => void;
  /** Called when the field loses the keyboard. */
  onLeave?: (value: string) => void;
}

export class TextField {
  readonly component: SimComponent;
  private readonly field: SearchInputManipulator;
  private editing = false;

  constructor(component: SimComponent, field: SearchInputManipulator) {
    this.component = component;
    this.field = field;
  }

  get value(): string {
    return this.field.searchValue || '';
  }

  /** Writes the field, unless the user is typing in it. */
  set value(value: string) {
    if (!this.editing && this.field.searchValue !== value) this.field.setSearchValue(value);
  }

  /** The field has the keyboard. */
  get isEditing(): boolean {
    return this.editing;
  }

  /** Writes the field even while the user types (to correct the text being typed). */
  replace(value: string): void {
    if (this.field.searchValue !== value) this.field.setSearchValue(value);
  }

  /** @internal Wiring of the manipulator's callbacks. */
  wire(scope: Scope, options: TextFieldOptions): void {
    const field = this.field;
    field.addEnterCallback(() => {
      this.editing = true;
      if (!scope.disposed && options.onEnter) options.onEnter();
    });
    field.addSubmitCallback(() => {
      if (!scope.disposed && options.onSubmit) options.onSubmit(this.value);
    });
    field.addExitCallback(() => {
      this.editing = false;
      if (!scope.disposed && options.onLeave) options.onLeave(this.value);
    });
    field.addChangeCallback((event: Event) => {
      const target = event && (event.target as HTMLInputElement | null);
      const value = target && typeof target.value === 'string' ? target.value : this.value;
      if (!scope.disposed && options.onChange) options.onChange(value);
    });
    scope.add(() => {
      if (field.clearAllCallbacks) field.clearAllCallbacks();
    });
  }
}

/** Creates the sim's text field in `parent` (which gives its size); removed with `scope`. */
export async function createTextField(scope: Scope, parent: HTMLElement, options: TextFieldOptions = {}): Promise<TextField> {
  const component = await createComponent(scope, COMPONENTS.searchInput, parent, options.placeholder ? { Placeholder: options.placeholder } : undefined);
  const manipulator = component.manipulator<SearchInputManipulator>();
  if (!manipulator || typeof manipulator.addChangeCallback !== 'function') throw new Error('the sim text field has no SearchInputManipulator');
  if (options.plain) component.updateVisual({ forceInput: true });
  const field = new TextField(component, manipulator);
  field.wire(scope, options);
  return field;
}
