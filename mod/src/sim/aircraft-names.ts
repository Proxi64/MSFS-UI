// The names of an aircraft as the mod shows them, without the sim (tested by test/aircraft-names.test.ts). The sim's
// display name is always its brand and its model (checked on 149 aircraft, sim 1.9.21: longest model 35 characters, 2
// empty brands, 1 empty model): the mod shows them on lines of their own, so that a long name never wraps.

/** What the sim's aircraft (`CurrentAircraft`, `AircraftList`) says of its names; add-ons may leave any of them out. */
export interface AircraftNameFields {
  brandName?: string;
  modelName?: string;
  displayName?: string;
  creator?: string;
}

export interface AircraftNames {
  /** The model, or the display name when the model or the brand is empty. */
  model: string;
  /** '' when the model's line holds the display name. */
  brand: string;
}

/** The title block's three lines; `studio` is '' when the brand's line says it (or there is none). */
export interface TitleLines extends AircraftNames {
  studio: string;
}

/** A variant of the configurator, as far as its label goes. */
export interface VariantTitle {
  id: string;
  title: string;
}

const clean = (text: string | undefined): string => (text || '').trim();

/** "X, a Y company" reads Y ("Viking Air Limited, a De Havilland Canada company" is De Havilland Canada). */
export function displayBrand(brand: string): string {
  const name = clean(brand);
  const company = /^.+,\s+an?\s+(\S.*?)\s+company$/i.exec(name);
  return company ? company[1]! : name;
}

/** The model and the brand of an aircraft; without one of them, the display name alone on the model's line. */
export function aircraftNames(fields: AircraftNameFields): AircraftNames {
  const model = clean(fields.modelName);
  const brand = displayBrand(clean(fields.brandName));
  if (model && brand) return { model, brand };
  return { model: clean(fields.displayName) || model || brand, brand: '' };
}

/** The model, the brand and the studio; one line for the brand and the studio when they are the same. */
export function titleLines(fields: AircraftNameFields): TitleLines {
  const names = aircraftNames(fields);
  const studio = clean(fields.creator);
  if (!names.brand) return { ...names, brand: studio, studio: '' };
  return { ...names, studio: studio.toLowerCase() === names.brand.toLowerCase() ? '' : studio };
}

/**
 * The labels of the variants, in their order: the models (by variant id) when they differ across the variants (some
 * add-ons declare a livery as the variant's name: the Just Flight 146's read "146-200 QC Royal Air Force, 32 Squadron,
 * ZE708 CMk3", their models 146-200, 146-200QC, 146-200QT), else the variants' titles; a variant whose model is not
 * known keeps its title.
 */
export function variantLabels(variants: readonly VariantTitle[], models: ReadonlyMap<string, string>): string[] {
  const known = variants.map((variant) => clean(models.get(variant.id))).filter((model) => !!model);
  const differ = known.some((model) => model !== known[0]);
  return variants.map((variant) => (differ && clean(models.get(variant.id))) || variant.title);
}
