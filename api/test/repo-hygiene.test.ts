import { describe, expect, it } from 'vitest';
import { execSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..', '..');

function files(dir: string, out: string[] = []) {
  for (const f of readdirSync(dir)) {
    if (['node_modules', 'dist', '.data', '.git'].includes(f)) continue;
    const p = join(dir, f);
    if (statSync(p).isDirectory()) files(p, out);
    else out.push(p);
  }
  return out;
}

describe('repo hygiene', () => {
  it('.env.example has keys but no values for secrets', () => {
    const env = readFileSync(join(root, '.env.example'), 'utf8');
    for (const k of ['JWT_SECRET', 'SERVICE_API_KEY', 'ADMIN_API_KEY', 'PARSE_SERVICE_KEY', 'AI_API_KEY', 'POSTGRES_PASSWORD']) {
      const line = env.split('\n').find((l) => l.startsWith(`${k}=`));
      expect(line, k).toBe(`${k}=`);
    }
  });
  it('no secrets or .env files are committed', () => {
    // What matters is what git would publish: a local .env with a real key is fine as long as it is ignored.
    const tracked = execSync('git ls-files', { cwd: root }).toString().split('\n').filter(Boolean);
    expect(tracked.filter((f) => /(^|\/)\.env$/.test(f))).toEqual([]);
    const all = tracked.map((f) => join(root, f));
    const suspicious = /(sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----|ghp_[A-Za-z0-9]{30,})/;
    for (const f of all.filter((f) => /\.(ts|tsx|js|json|yml|yaml|md|env|example|conf)$/.test(f))) {
      expect(suspicious.test(readFileSync(f, 'utf8')), f).toBe(false);
    }
  });
});
