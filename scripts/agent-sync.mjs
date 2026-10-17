// core/agent/*.md are the source of the assistant's character and memory rules. The API and the
// in-browser demo can't read files at runtime, so this writes them into a TypeScript module.
// Run after editing SOUL.md or AGENT.md:  npm run agent:sync   (a test fails if you forget)
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (f) => readFileSync(`${root}core/agent/${f}`, 'utf8');
const section = (md, heading) => {
  const start = md.indexOf(`## ${heading}`);
  if (start < 0) throw new Error(`AGENT.md has no "## ${heading}" section`);
  const next = md.indexOf('\n## ', start + 3);
  return md.slice(start, next < 0 ? undefined : next).trim();
};
// The editing note at the top is for people, not for the model.
const body = (md) => md.replace(/^>.*\n/gm, '').replace(/\n{3,}/g, '\n\n').trim();

export function render() {
  const soul = body(read('SOUL.md'));
  const reflect = section(read('AGENT.md'), 'Hafıza güncelleme');
  return `// Generated from core/agent/SOUL.md and core/agent/AGENT.md by scripts/agent-sync.mjs. Do not edit.

/** The assistant's character, given to the model on every call. */
export const SOUL = ${JSON.stringify(soul)};

/** How the assistant updates its own long-term memory (AGENT.md → "Hafıza güncelleme"). */
export const REFLECT_RULES = ${JSON.stringify(reflect)};
`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(`${root}core/src/assistant/agent-files.ts`, render());
  console.log('core/src/assistant/agent-files.ts updated');
}
