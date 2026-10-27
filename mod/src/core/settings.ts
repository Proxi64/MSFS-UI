// Validation of the settings read from config.js against the feature catalogue (see Contracts in docs/development.md). The app already
// normalises what it writes (MsfsUi.Core SettingsNormalizer, same rules): anything adjusted here means the file was
// edited by hand or does not match this mod, so every adjustment is reported.

/** Settings format version written by the app (MsfsUi.Core ConfigScript.SchemaVersion). */
export const CONFIG_SCHEMA_VERSION = 1;

/** A boolean, a number, or the id of one of a choice option's choices. */
export type OptionValue = boolean | number | string;

export interface BooleanOptionSpec {
  readonly id: string;
  readonly type: 'boolean';
  readonly default: boolean;
}

export interface NumberOptionSpec {
  readonly id: string;
  readonly type: 'number';
  readonly default: number;
  readonly min: number;
  readonly max: number;
  readonly step?: number;
}

export interface ChoiceOptionSpec {
  readonly id: string;
  readonly type: 'choice';
  readonly default: string;
  /** The ids of the choices, in display order. */
  readonly choices: readonly string[];
}

export type OptionSpec = BooleanOptionSpec | NumberOptionSpec | ChoiceOptionSpec;

/** What the mod needs to know of a catalogue feature (generated from features.json). */
export interface FeatureSpec {
  readonly id: string;
  readonly enabledByDefault: boolean;
  readonly options: readonly OptionSpec[];
}

/** Per feature id: `enabled` and every option, all present and valid. */
export type SettingsValues = Record<string, Record<string, OptionValue>>;

export interface ResolvedSettings {
  readonly values: SettingsValues;
  /** What was wrong in the input, for the log. Empty when it was valid. */
  readonly problems: string[];
  /** The input was unusable as a whole: every value is a default. */
  readonly allDefaults: boolean;
}

/** Every feature with its defaults. */
export function defaultSettings(catalog: readonly FeatureSpec[]): SettingsValues {
  const values: SettingsValues = {};
  for (const feature of catalog) {
    const entry: Record<string, OptionValue> = { enabled: feature.enabledByDefault };
    for (const option of feature.options) entry[option.id] = option.default;
    values[feature.id] = entry;
  }
  return values;
}

/**
 * Checks `raw` (the default export of config.js) against the catalogue. A structurally wrong input (not an object,
 * another schema version, no feature table) gives the defaults; otherwise each wrong or missing value takes its
 * default, each number is brought into its range and onto its step grid, and a choice must be one of its ids, so the
 * mod never starts half-configured.
 */
export function resolveSettings(raw: unknown, catalog: readonly FeatureSpec[]): ResolvedSettings {
  const fallback = (problem: string): ResolvedSettings => ({ values: defaultSettings(catalog), problems: [problem], allDefaults: true });
  if (!isRecord(raw)) return fallback('the settings are not an object');
  if (raw.schemaVersion !== CONFIG_SCHEMA_VERSION) {
    return fallback(`schema version ${JSON.stringify(raw.schemaVersion)} instead of ${CONFIG_SCHEMA_VERSION}`);
  }
  const features = raw.features;
  if (!isRecord(features)) return fallback('no feature table');

  const problems: string[] = [];
  const known = new Set(catalog.map((feature) => feature.id));
  for (const id of Object.keys(features)) if (!known.has(id)) problems.push(`unknown feature "${id}" ignored`);

  const values: SettingsValues = {};
  for (const feature of catalog) {
    const stored = features[feature.id];
    if (!isRecord(stored)) {
      problems.push(`feature "${feature.id}" missing: defaults used`);
      values[feature.id] = defaultSettings([feature])[feature.id]!;
      continue;
    }
    const entry: Record<string, OptionValue> = {};
    if (typeof stored.enabled === 'boolean') entry.enabled = stored.enabled;
    else {
      problems.push(`"${feature.id}.enabled" is not a boolean: default used`);
      entry.enabled = feature.enabledByDefault;
    }
    const optionIds = new Set(feature.options.map((option) => option.id));
    for (const id of Object.keys(stored)) {
      if (id !== 'enabled' && !optionIds.has(id)) problems.push(`unknown option "${feature.id}.${id}" ignored`);
    }
    for (const option of feature.options) entry[option.id] = resolveOption(feature.id, option, stored[option.id], problems);
    values[feature.id] = entry;
  }
  return { values, problems, allDefaults: false };
}

function resolveOption(featureId: string, option: OptionSpec, value: unknown, problems: string[]): OptionValue {
  const name = `"${featureId}.${option.id}"`;
  if (value === undefined) {
    problems.push(`${name} missing: default used`);
    return option.default;
  }
  if (option.type === 'boolean') {
    if (typeof value === 'boolean') return value;
    problems.push(`${name} is not a boolean: default used`);
    return option.default;
  }
  if (option.type === 'choice') {
    if (typeof value === 'string' && option.choices.indexOf(value) >= 0) return value;
    problems.push(`${name} is not one of its choices: default used`);
    return option.default;
  }
  if (typeof value !== 'number' || !isFinite(value)) {
    problems.push(`${name} is not a number: default used`);
    return option.default;
  }
  const constrained = constrain(option, value);
  if (constrained !== value) problems.push(`${name} adjusted from ${value} to ${constrained} (range or step)`);
  return constrained;
}

/**
 * Clamps a number to the option's range and snaps it to its step grid, counted from the minimum. When the range is
 * not a whole number of steps, the highest value is the last grid point below the maximum. Same result as
 * MsfsUi.Core SettingsNormalizer.Constrain.
 */
export function constrain(option: NumberOptionSpec, value: number): number {
  const { min, max, step } = option;
  if (step === undefined) return Math.min(max, Math.max(min, value));
  const lastStep = Math.floor((max - min) / step + 1e-9);
  // Math.round rounds halves up; the index is clamped to 0 or more, so this matches .NET's AwayFromZero.
  const index = Math.min(lastStep, Math.max(0, Math.round((value - min) / step)));
  return Number((min + index * step).toFixed(10));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
