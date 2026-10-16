import { describe, expect, it } from 'vitest';
import { evalSet, runLocal, score } from '../src/eval-lib';

// The assistant's training set, run against the offline engine. `npm run ai:eval` runs it against DeepSeek.
describe('assistant eval set (local engine)', () => {
  for (const c of evalSet.cases) {
    it(`[${c.lang}] ${c.text}`, () => {
      expect(score(runLocal(c.text, c.lang), c.expect)).toEqual([]);
    });
  }
});
