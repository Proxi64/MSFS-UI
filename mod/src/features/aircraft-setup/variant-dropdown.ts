// The Showcase panel's variants (panel.ts): the sim's dropdown, one row high, showing the selected variant. Opened, its
// list lies over the livery header and the large livery and ends on the large livery's bottom edge, whole items at
// rest (sim/dropdown-list.ts). With one variant it is Disabled and does not open. Open while another aircraft is chosen,
// it closes (close, panel.ts): it would list the previous aircraft's variants until the configurator reports the new
// ones (0.3 to 1.2 s, measured on 1.9.21; a real click elsewhere closes it too, the sim listening to the window's clicks).

import { setVariable } from '../../core/dom.ts';
import { logError } from '../../core/log.ts';
import type { Scope } from '../../core/scope.ts';
import { COMPONENTS, createComponent, type DropdownItem, type DropdownManipulator, type SimComponent } from '../../sim/components.ts';
import type { ConfiguratorItem } from '../../sim/configurator.ts';
import { DROPDOWN_METRICS, dropdownListSize, scrollDropdownTo } from '../../sim/dropdown-list.ts';
import { translate } from '../../sim/localization.ts';

export class VariantDropdown {
  private readonly host: HTMLElement;
  private readonly choose: (id: string) => void;
  private dropdown: SimComponent | null = null;
  private variants: ConfiguratorItem[] = [];
  /** The variants and the selected one last given to the dropdown: given again only when they change. */
  private drawn = '';

  constructor(scope: Scope, host: HTMLElement, choose: (id: string) => void) {
    this.host = host;
    this.choose = choose;
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

  render(variants: ConfiguratorItem[]): void {
    this.variants = variants;
    this.draw();
  }

  /**
   * The list downwards, `below` layout units long (from the dropdown's bottom to the large livery's): the sim's own
   * scroll for the items that do not fit, the room whole items leave in its top padding (--msfs-ui-variants-top). It
   * ends there whatever the number of variants (the owner's choice, over a list ending anywhere): a short list keeps
   * its items at the top and its room under them.
   */
  sizeList(below: number, unit: number): void {
    const dropdown = this.dropdown;
    if (!dropdown) return;
    const sized = dropdownListSize({ count: Math.max(1, this.variants.length), below, above: 0, unit }, DROPDOWN_METRICS, 1);
    // Half a pixel more, as dropdownListSize gives a list that scrolls: the engine rounds the height down.
    dropdown.set('List_Size', (sized.up ? sized.size : below + 0.5 / unit).toFixed(2));
    setVariable(this.host.style, '--msfs-ui-variants-top', `${Math.floor(sized.padding * unit)}px`);
  }

  private draw(): void {
    const dropdown = this.dropdown;
    const manipulator = dropdown ? dropdown.manipulator<DropdownManipulator>() : null;
    if (!dropdown || !manipulator) return;
    const key = this.variants.map((variant) => `${variant.isSelected ? '*' : ''}${variant.id}`).join('|');
    if (key !== this.drawn) {
      // Other variants, or another selected: an open list closes (a choice in it has already closed it).
      if (this.drawn) this.close();
      this.drawn = key;
      const items = this.variants.map(
        (variant): DropdownItem => ({
          title: translate(variant.title),
          subtitle: '',
          coma: '',
          selectedCallback: () => {
            if (!variant.isSelected) this.choose(variant.id);
          },
        }),
      );
      manipulator.setData(items, items[this.selectedIndex()]);
    }
    dropdown.disable(this.variants.length <= 1);
  }

  private selectedIndex(): number {
    return this.variants.findIndex((variant) => variant.isSelected);
  }

  /** Opened, the list shows the selected variant at its top, or its first items (scrollDropdownTo). */
  private scrollList(): void {
    if (this.dropdown) scrollDropdownTo(this.dropdown.element, this.selectedIndex());
  }
}
