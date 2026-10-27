// What the aircraft selection shows, shared by its two features, each flag set by one and read by the other at each
// layout pass (250 ms), so there is no order between them at start-up:
// - the gallery shows the liveries (side by side layout): the setup panel drops its own thumbnails meanwhile;
// - the setup panel is shown: the gallery no longer sends its hovers to the sim (the header of the left column would
//   show the hovered aircraft over the selected one's variants, and the sim would load statistics the panel hides).

let liveriesShown = false;
let panelShown = false;

/** The gallery shows the liveries of the current aircraft (true), or no longer does. */
export function setLiveriesInGallery(shown: boolean): void {
  liveriesShown = shown;
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
