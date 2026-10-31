// The sim's translations of its `TT:…` keys (`g_localization` of the top page): the mod reuses them for its texts
// whenever the sim has one (the keys are listed in compat.json, "translations").

/** Translates a `TT:…` key with the sim's localisation (the key itself when unknown). */
export function translate(key: string): string {
  const top = window.top as unknown as { g_localization?: { Translate(key: string): string } } | null;
  const localization = top ? top.g_localization : undefined;
  return (localization && localization.Translate(key)) || key;
}
