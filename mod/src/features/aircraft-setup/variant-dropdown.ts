// The Showcase panel's variants (panel.ts): a row in the livery header's style holding the sim's dropdown. "Variant" on
// the left, the selected variant and the dropdown's arrow on the right; the dropdown fills the row, its own background
// transparent at rest so that the header's shows (aircraft-setup.css), so a click anywhere on the row opens the list.
// Opened, the list lies over the livery header and the large livery and ends on the large livery's bottom edge, whole
// items at rest (sim/dropdown-list.ts). With one variant the dropdown is Disabled and does not open. Open while another
// aircraft is chosen, it closes (close, panel.ts): it would list the previous aircraft's variants until the configurator
// reports the new ones (0.3 to 1.2 s, measured on 1.9.21; a real click elsewhere closes it too, the sim listening to the
// window's clicks).

import { el, setVariable, toggleClass } from '../../core/dom.ts';
import { logError } from '../../core/log.ts';
import type { Scope } from '../../core/scope.ts';
import { COMPONENTS, createComponent, type DropdownItem, type DropdownManipulator, type SimComponent } from '../../sim/components.ts';
import type { ConfiguratorItem } from '../../sim/configurator.ts';
import { DROPDOWN_METRICS, dropdownListSize, scrollDropdownTo } from '../../sim/dropdown-list.ts';
import { translate } from '../../sim/localization.ts';

/** The sim's own word for it (its Manufacture screens). */
const VARIANT_TITLE = 'TT:MANUFACTURE.BREADCRUMB.VARIATION';
/** Always this much after the word, in layout units, however long the variant's label. */
const TITLE_GAP = 12;

export class VariantDropdown {
  private readonly row: HTMLElement;
  private readonly title: HTMLElement;
  private readonly choose: (id: string) => void;
  private dropdown: SimComponent | null = null;
  private variants: ConfiguratorItem[] = [];
  /** What each variant reads (sim/aircraft-names.ts: variantLabels). */
  private labels: readonly string[] = [];
  /** The variants and the selected one last given to the dropdown: given again only when they change. */
  private drawn = '';

  /** `row`: the header element the panel places; the title and the dropdown go in it. */
  constructor(scope: Scope, row: HTMLElement, choose: (id: string) => void) {
    this.row = row;
    this.choose = choose;
    this.title = el('span', 'msfs-ui-title msfs-ui-setup__variant-title', row);
    this.title.textContent = translate(VARIANT_TITLE);
    const host = el('div', 'msfs-ui-setup__dropdown', row);
    createComponent(scope, COMPONENTS.dropdown, host).then(
      (dropdown) => {
        this.dropdown = dropdown;
        // Once the click has opened the list (the sim's handler runs first).
        dropdown.onClick(scope, () => scope.timeout(() => this.scrollList(), 0));
        this.draw();
      },
      (error: unknown) => logError('the variants dropdown could not be created', error),
    );
  }

  /** The list closed, when open. */
  close(): void {
    const manipulator = this.dropdown ? this.dropdown.manipulator<DropdownManipulator>() : null;
    if (manipulator) manipulator.hideDropdownList();
  }

  render(variants: ConfiguratorItem[], labels: readonly string[]): void {
    this.variants = variants;
    this.labels = labels;
    this.draw();
  }

  /**
   * At each layout pass: the selected variant's text starts one gap after the row's title (--msfs-ui-variants-left, in
   * whole pixels), and the list goes downwards, `below` layout units long (from the row's bottom to the large livery's): the
   * sim's own scroll for the items that do not fit, the room whole items leave in its top padding
   * (--msfs-ui-variants-top). It ends there whatever the number of variants (the owner's choice, over a list ending
   * anywhere): a short list keeps its items at the top and its room under them.
   */
  layout(below: number, unit: number): void {
    const dropdown = this.dropdown;
    if (!dropdown) return;
    const titleBox = this.title.getBoundingClientRect();
    const rowBox = this.row.getBoundingClientRect();
    setVariable(this.row.style, '--msfs-ui-variants-left', `${Math.ceil(titleBox.right - rowBox.left + TITLE_GAP * unit)}px`);
    const sized = dropdownListSize({ count: Math.max(1, this.variants.length), below, above: 0, unit }, DROPDOWN_METRICS, 1);
    // Half a pixel more, as dropdownListSize gives a list that scrolls: the engine rounds the height down.
    dropdown.set('List_Size', (sized.up ? sized.size : below + 0.5 / unit).toFixed(2));
    setVariable(this.row.style, '--msfs-ui-variants-top', `${Math.floor(sized.padding * unit)}px`);
  }

  private draw(): void {
    const dropdown = this.dropdown;
    const manipulator = dropdown ? dropdown.manipulator<DropdownManipulator>() : null;
    if (!dropdown || !manipulator) return;
    const key = this.variants.map((variant, at) => `${variant.isSelected ? '*' : ''}${variant.id}=${this.labels[at]}`).join('|');
    if (key !== this.drawn) {
      // Other variants, or another selected: an open list closes (a choice in it has already closed it).
      if (this.drawn) this.close();
      this.drawn = key;
      const items = this.variants.map(
        (variant, at): DropdownItem => ({
          title: translate(this.labels[at] || variant.title),
          subtitle: '',
          coma: '',
          selectedCallback: () => {
            if (!variant.isSelected) this.choose(variant.id);
          },
        }),
      );
      manipulator.setData(items, items[this.selectedIndex()]);
    }
    const single = this.variants.length <= 1;
    dropdown.disable(single);
    toggleClass(this.row, 'is-single', single);
  }

  private selectedIndex(): number {
    return this.variants.findIndex((variant) => variant.isSelected);
  }

  /** Opened, the list shows the selected variant at its top, or its first items (scrollDropdownTo). */
  private scrollList(): void {
    if (this.dropdown) scrollDropdownTo(this.dropdown.element, this.selectedIndex());
  }
}
