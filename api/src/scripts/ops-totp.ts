// Makes a new secret for the operator panel's 6-digit codes and writes it to the repository's .env
// (git-ignored). It never prints the secret, so running it inside a chat or a shared terminal is safe.
//   npm run ops:totp -w api
// Then open .env, copy the ADMIN_TOTP_SECRET value and:
// 1. add it to an authenticator app (Google Authenticator, 1Password, Authy): "enter a setup key", time-based;
// 2. paste it in Render → monacount-api → Environment as ADMIN_TOTP_SECRET and redeploy.
// From then on the panel asks for the admin key and the code from the app.
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const bytes = randomBytes(20);
let bits = 0;
let value = 0;
let secret = '';
for (const b of bytes) {
  value = (value << 8) | b;
  bits += 8;
  while (bits >= 5) {
    secret += abc[(value >>> (bits - 5)) & 31];
    bits -= 5;
  }
}
if (bits > 0) secret += abc[(value << (5 - bits)) & 31];

const file = fileURLToPath(new URL('../../../.env', import.meta.url));
const lines = existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter((l) => !l.startsWith('ADMIN_TOTP_SECRET=')) : [];
while (lines.length && lines[lines.length - 1] === '') lines.pop();
writeFileSync(file, [...lines, `ADMIN_TOTP_SECRET=${secret}`, ''].join('\n'));

console.log(`\nA new ADMIN_TOTP_SECRET was written to ${file} (the secret is not shown here).`);
console.log('Open that file, copy the value after "ADMIN_TOTP_SECRET=", add it to your authenticator app and paste it in Render.');
console.log('Running this again replaces it; the old one stops working once Render has the new one.\n');
