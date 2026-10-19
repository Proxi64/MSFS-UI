import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { atcIdFromCfg, liveryNameFromCfg, pickRegistration, registrationFromName, sanitizeRegistration } from '../src/sim/registration.ts';

const CFG = [
  '[VERSION]',
  'major = 1',
  '',
  '[GENERAL]',
  'name = "Apex Corso Red" ; shown in the menu',
  '',
  '[FLTSIM.0]',
  'title = "SF50 Apex Corso"',
  'atc_id = "N561AJ" ; registration',
  'atc_airline = ""',
].join('\r\n');

describe('livery.cfg', () => {
  it('reads atc_id, quoted or not, without the comment', () => {
    assert.equal(atcIdFromCfg(CFG), 'N561AJ');
    assert.equal(atcIdFromCfg('[FLTSIM.0]\natc_id=F-GKXA\n'), 'F-GKXA');
    assert.equal(atcIdFromCfg('  ATC_ID = "HB-JVA"'), 'HB-JVA', 'keys are not case-sensitive');
  });

  it('gives null for an empty or missing atc_id', () => {
    assert.equal(atcIdFromCfg('[FLTSIM.0]\natc_id = ""\n'), null);
    assert.equal(atcIdFromCfg('[FLTSIM.0]\natc_id_color = "0xffffff"\n'), null);
    assert.equal(atcIdFromCfg(''), null);
  });

  it('reads the name of the [GENERAL] section only', () => {
    assert.equal(liveryNameFromCfg(CFG), 'Apex Corso Red');
    assert.equal(liveryNameFromCfg('[FLTSIM.0]\nname = "Not this"\n[GENERAL]\nname = "TT:LIVERY.NAME"\n'), 'TT:LIVERY.NAME');
    assert.equal(liveryNameFromCfg('[FLTSIM.0]\nname = "Not this"\n'), null);
    assert.equal(liveryNameFromCfg('[GENERAL]\nname = ""\n'), null);
  });
});

describe('registrationFromName', () => {
  const cases: [string, string | null][] = [
    ['Air France F-GKXA', 'F-GKXA'],
    ['Swiss HB-JVA (2024)', 'HB-JVA'],
    ['Air Malta 9H-ABC', '9H-ABC'],
    ['N561AJ Apex', 'N561AJ'],
    ['JAL JA123A', 'JA123A'],
    ['Korean HL7700', 'HL7700'],
    ['Air China B-1234', 'B-1234'],
    ['Airbus A-350 house colours', null],
    ['f-gkxa in lower case', null],
    ['Plain white', null],
    ['N0ABC (no leading zero)', null],
  ];
  for (const [name, expected] of cases) {
    it(`"${name}" → ${expected}`, () => assert.equal(registrationFromName(name), expected));
  }
});

describe('sanitizeRegistration', () => {
  it('keeps letters, digits and hyphens, in upper case', () => {
    assert.equal(sanitizeRegistration(' f-gkxa ', 9), 'F-GKXA');
    assert.equal(sanitizeRegistration('N 561_AJ!', 9), 'N561AJ');
  });

  it('refuses an empty or too long value; 0 means no limit', () => {
    assert.equal(sanitizeRegistration('***', 9), null);
    assert.equal(sanitizeRegistration('ABCDEFGHIJ', 9), null);
    assert.equal(sanitizeRegistration('ABCDEFGHIJ', 0), 'ABCDEFGHIJ');
  });
});

describe('pickRegistration', () => {
  const candidates = (saved: string | null, atcId: string | null, fromName: string | null, base: string) => [
    { source: 'saved', value: saved },
    { source: 'atc_id', value: atcId },
    { source: 'name', value: fromName },
    { source: 'default', value: base },
  ];

  it('takes the candidates in order', () => {
    assert.deepEqual(pickRegistration(candidates('F-ABCD', 'N561AJ', 'F-GKXA', 'ASXGS'), 9), { registration: 'F-ABCD', source: 'saved' });
    assert.deepEqual(pickRegistration(candidates(null, 'N561AJ', 'F-GKXA', 'ASXGS'), 9), { registration: 'N561AJ', source: 'atc_id' });
    assert.deepEqual(pickRegistration(candidates(null, null, 'F-GKXA', 'ASXGS'), 9), { registration: 'F-GKXA', source: 'name' });
    assert.deepEqual(pickRegistration(candidates(null, null, null, 'ASXGS'), 9), { registration: 'ASXGS', source: 'default' });
  });

  it('skips a candidate the field does not accept, down to the default', () => {
    assert.deepEqual(pickRegistration(candidates(null, 'ABCDEFGHIJK', null, 'ASXGS'), 9), { registration: 'ASXGS', source: 'default' });
    assert.deepEqual(pickRegistration(candidates('***', null, null, 'asxgs'), 9), { registration: 'ASXGS', source: 'default' });
  });

  it('gives null when nothing fits', () => {
    assert.equal(pickRegistration(candidates(null, null, null, ''), 9), null);
  });
});
