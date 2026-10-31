// The registration of a livery: `atc_id` of its livery.cfg ([FLTSIM.N] section, MSFS 2024 SDK), otherwise a
// registration recognised in the livery's name. Pure functions.

/** The value of `atc_id` in the text of a livery.cfg, or null. */
export function atcIdFromCfg(cfg: string): string | null {
  const match = /^\s*atc_id\s*=\s*"?([^"\r\n;]*)"?/im.exec(cfg);
  const value = match ? match[1]!.trim() : '';
  return value || null;
}

/** The livery's name (`name` of the [GENERAL] section), or null. */
export function liveryNameFromCfg(cfg: string): string | null {
  const general = /^\s*\[general\]([\s\S]*?)(?=^\s*\[|$(?![\s\S]))/im.exec(cfg);
  const match = general && /^\s*name\s*=\s*"?([^"\r\n]*)"?/im.exec(general[1]!);
  return match ? match[1]!.trim() || null : null;
}

/**
 * Formats recognised in a name, case-sensitive to avoid false positives: prefix and letters (F-GKXA, HB-JVA,
 * 9H-ABC), US N-number (N561AJ), Japan (JA123A), Korea (HL7700), China (B-1234). "A-350" is not taken: letters
 * must follow the hyphen.
 */
const NAME_PATTERNS = [
  /\b([A-Z0-9]{1,2}-[A-Z]{3,4})\b/,
  /\b(B-[0-9]{4,5})\b/,
  /\b(N[1-9][0-9]{0,4}[A-Z]{0,2})\b/,
  /\b(JA[0-9]{3,4}[A-Z]?)\b/,
  /\b(HL[0-9]{4})\b/,
];

/** The first registration recognised in a livery's name, or null. */
export function registrationFromName(name: string): string | null {
  for (const pattern of NAME_PATTERNS) {
    const match = pattern.exec(name);
    if (match) return match[1]!;
  }
  return null;
}

/** `value` in upper case with only what the sim's field accepts: letters, digits and hyphens. */
function registrationCharacters(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9-]/g, '');
}

/** Brought to what the sim's field accepts (letters, digits, hyphen, upper case); null if empty or too long. */
export function sanitizeRegistration(value: string, maxLength: number): string | null {
  const clean = registrationCharacters(value);
  return clean && (maxLength <= 0 || clean.length <= maxLength) ? clean : null;
}

/** A possible tail number, and where it comes from (for the log). */
export interface TailCandidate {
  readonly source: string;
  readonly value: string | null | undefined;
}

/**
 * A livery's own tail numbers, in the order the mod applies them: the one chosen for the livery, the `atc_id` of its
 * livery.cfg, a registration recognised in its name (`name`, translated).
 */
export function liveryTailCandidates(livery: { chosen: string | undefined; atcId: string | null; name: string | null }): TailCandidate[] {
  return [
    { source: 'chosen for this livery', value: livery.chosen },
    { source: "the livery's atc_id", value: livery.atcId },
    { source: "the livery's name", value: livery.name ? registrationFromName(livery.name) : null },
  ];
}

/** The first candidate, in order, that the field accepts once sanitised; null if none does. */
export function pickRegistration(candidates: readonly TailCandidate[], maxLength: number): { registration: string; source: string } | null {
  for (const candidate of candidates) {
    const registration = candidate.value ? sanitizeRegistration(candidate.value, maxLength) : null;
    if (registration) return { registration, source: candidate.source };
  }
  return null;
}

/** A tail number being typed: letters, digits and hyphens in upper case, cut to the field's length. */
export function cleanTail(value: string, maxLength: number): string {
  return registrationCharacters(value).slice(0, maxLength);
}
