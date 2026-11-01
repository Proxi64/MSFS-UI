// What the aircraft selection shows, shared by its two features, each flag set by one and read by the other at each
// layout pass (250 ms), so there is no order between them at start-up:
// - the gallery's view shows the liveries (Gallery and List; set from its mount to its end, whether the screen is shown
//   or not): the setup panel shows none meanwhile (its Gallery and List form; its Showcase form otherwise), and takes
//   its other form at once when it changes (LIVERIES_IN_GALLERY_CHANGED: a change of view);
// - the setup panel is shown: the gallery no longer sends its hovers to the sim (the header of the left column would
//   show the hovered aircraft over the selected one's variants, and the sim would load statistics the panel hides).

let liveriesShown = false;
let panelShown = false;

/** Sent on the document when liveriesInGallery changes. */
export const LIVERIES_IN_GALLERY_CHANGED = 'msfs-ui-liveries-in-gallery';

/** The gallery's view shows the liveries of the current aircraft (true), or not (Showcase, or no gallery). */
export function setLiveriesInGallery(shown: boolean): void {
  if (shown === liveriesShown) return;
  liveriesShown = shown;
  document.dispatchEvent(new CustomEvent(LIVERIES_IN_GALLERY_CHANGED));
}

/** Whether the gallery shows the liveries: the setup panel then shows none. */
export function liveriesInGallery(): boolean {
  return liveriesShown;
}

/** The setup panel covers the left column (true), or no longer does. */
export function setSetupPanelShown(shown: boolean): void {
  panelShown = shown;
}

/** Whether the setup panel covers the left column: the gallery then keeps its hovers to itself. */
export function setupPanelShown(): boolean {
  return panelShown;
}
