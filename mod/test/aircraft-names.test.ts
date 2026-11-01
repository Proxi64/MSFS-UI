import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { aircraftNames, displayBrand, titleLines, variantLabels } from '../src/sim/aircraft-names.ts';

describe('displayBrand', () => {
  it('shows the company of "X, a Y company"', () => {
    assert.equal(displayBrand('Viking Air Limited, a De Havilland Canada company'), 'De Havilland Canada');
    assert.equal(displayBrand('Foo Ltd, an Acme Industries Company'), 'Acme Industries');
  });

  it('keeps any other brand, trimmed', () => {
    assert.equal(displayBrand('Textron Aviation'), 'Textron Aviation');
    assert.equal(displayBrand(' Pilatus '), 'Pilatus');
    assert.equal(displayBrand('Companhia Aeronáutica Paulista'), 'Companhia Aeronáutica Paulista');
    assert.equal(displayBrand('Acme, a company'), 'Acme, a company', 'no name between "a" and "company"');
    assert.equal(displayBrand(''), '');
  });
});

describe('aircraftNames', () => {
  it('takes the model and the brand of the sim', () => {
    assert.deepEqual(aircraftNames({ brandName: 'Pilatus', modelName: 'PC-6/B2-H4 Turbo Porter G950 Floats', displayName: 'Pilatus PC-6/B2-H4 Turbo Porter G950 Floats' }), {
      model: 'PC-6/B2-H4 Turbo Porter G950 Floats',
      brand: 'Pilatus',
    });
    assert.deepEqual(aircraftNames({ brandName: 'Viking Air Limited, a De Havilland Canada company', modelName: 'DHC-2', displayName: 'Viking Air Limited, a De Havilland Canada company DHC-2' }), {
      model: 'DHC-2',
      brand: 'De Havilland Canada',
    });
  });

  it('trims what the publishers leave around the names', () => {
    assert.deepEqual(aircraftNames({ brandName: 'Just Flight ', modelName: ' 146-200QC', displayName: 'Just Flight  146-200QC' }), { model: '146-200QC', brand: 'Just Flight' });
  });

  it('puts the display name on the first line when the model or the brand is empty', () => {
    assert.deepEqual(aircraftNames({ brandName: '', modelName: 'Spitfire', displayName: 'Spitfire' }), { model: 'Spitfire', brand: '' });
    assert.deepEqual(aircraftNames({ brandName: 'Acme', modelName: '', displayName: 'Acme One' }), { model: 'Acme One', brand: '' });
    assert.deepEqual(aircraftNames({ displayName: ' Old Add-on ' }), { model: 'Old Add-on', brand: '' });
    assert.deepEqual(aircraftNames({}), { model: '', brand: '' });
  });

  it('falls back on what there is without a display name', () => {
    assert.deepEqual(aircraftNames({ brandName: 'Acme', modelName: '' }), { model: 'Acme', brand: '' });
    assert.deepEqual(aircraftNames({ modelName: 'One' }), { model: 'One', brand: '' });
  });
});

describe('titleLines', () => {
  it('gives the model, the brand and the studio', () => {
    assert.deepEqual(titleLines({ brandName: 'Textron Aviation', modelName: 'Cessna Citation Longitude', displayName: 'x', creator: 'Working Title Simulations' }), {
      model: 'Cessna Citation Longitude',
      brand: 'Textron Aviation',
      studio: 'Working Title Simulations',
    });
  });

  it('has one line when the brand and the studio are the same', () => {
    assert.deepEqual(titleLines({ brandName: 'Just Flight', modelName: '146-200QC', creator: 'Just Flight ' }), { model: '146-200QC', brand: 'Just Flight', studio: '' });
    assert.deepEqual(titleLines({ brandName: 'JUST FLIGHT', modelName: '146-200QC', creator: 'just flight' }), { model: '146-200QC', brand: 'JUST FLIGHT', studio: '' });
  });

  it('moves the studio up when there is no brand line', () => {
    assert.deepEqual(titleLines({ displayName: 'Old Add-on', creator: 'Someone' }), { model: 'Old Add-on', brand: 'Someone', studio: '' });
    assert.deepEqual(titleLines({ displayName: 'Old Add-on' }), { model: 'Old Add-on', brand: '', studio: '' });
  });
});

describe('variantLabels', () => {
  const variants = (...titles: string[]) => titles.map((title) => ({ id: title, title }));

  it('shows the models when they differ across the variants', () => {
    const items = variants('146-200 QC Royal Air Force, 32 Squadron, ZE708 CMk3', '146-200 QC TNT', '146-200 QT Pacific');
    const models = new Map([
      [items[0]!.id, '146-200'],
      [items[1]!.id, '146-200QC'],
      [items[2]!.id, '146-200QT'],
    ]);
    assert.deepEqual(variantLabels(items, models), ['146-200', '146-200QC', '146-200QT']);
  });

  it('keeps the titles when the models are the same', () => {
    const items = variants('Standard', 'High Density');
    assert.deepEqual(
      variantLabels(
        items,
        new Map([
          ['Standard', 'A319'],
          ['High Density', 'A319 '],
        ]),
      ),
      ['Standard', 'High Density'],
    );
  });

  it('keeps the title of a variant whose model is not known', () => {
    const items = variants('One', 'Two', 'Three');
    assert.deepEqual(
      variantLabels(
        items,
        new Map([
          ['One', 'M1'],
          ['Two', 'M2'],
        ]),
      ),
      ['M1', 'M2', 'Three'],
    );
    assert.deepEqual(variantLabels(items, new Map()), ['One', 'Two', 'Three']);
  });

  it('keeps the title with one variant', () => {
    assert.deepEqual(variantLabels(variants('Only'), new Map([['Only', 'M1']])), ['Only']);
  });
});
