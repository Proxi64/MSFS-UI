import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { setVariable } from '../src/core/dom.ts';

describe('setVariable', () => {
  it('writes a CSS variable only when its value changes', () => {
    const values = new Map<string, string>();
    let writes = 0;
    const style = {
      getPropertyValue: (name: string) => values.get(name) || '',
      setProperty: (name: string, value: string) => {
        writes++;
        values.set(name, value);
      },
    } as unknown as CSSStyleDeclaration;

    setVariable(style, '--tile-w', '322px');
    setVariable(style, '--tile-w', '322px');
    assert.equal(writes, 1, 'the same value is not written again');
    setVariable(style, '--tile-w', '321px');
    assert.equal(writes, 2);
    assert.equal(values.get('--tile-w'), '321px');
  });
});
