// Makes a new secret for the operator panel's 6-digit codes. Run it yourself; nothing is stored or sent.
//   npm run ops:totp -w api
// 1. Add the secret to an authenticator app (Google Authenticator, 1Password, Authy): "enter a setup key",
//    or open the otpauth link on the phone.
// 2. Put the same secret in Render → monacount-api → Environment as ADMIN_TOTP_SECRET and redeploy.
// From then on the panel asks for the admin key and the code from the app.
import { randomBytes } from 'node:crypto';

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

console.log(`\nADMIN_TOTP_SECRET=${secret}\n`);
console.log(`otpauth://totp/Monacount:operator?secret=${secret}&issuer=Monacount&digits=6&period=30\n`);
console.log('Keep it like a password: anyone with this secret and the admin key can open the panel.\n');
