// Sends a sample welcome e-mail through Resend to check RESEND_API_KEY and MAIL_FROM.
// Usage: npm run mail:check -- you@example.com
import { generateAccessKey } from '@makas/core';
import { env } from '../config';
import { resendMailer } from '../email';
import { welcomeEmail } from '../email';

const to = process.argv[2];
if (!env.resendApiKey) {
  console.log('RESEND_API_KEY boş. .env dosyasına Resend anahtarını yaz ve tekrar dene.');
  process.exit(1);
}
if (!to) {
  console.log('Kullanım: npm run mail:check -- adresin@ornek.com');
  process.exit(1);
}
try {
  await resendMailer(env.resendApiKey, env.mailFrom).send(
    welcomeEmail({ to, name: 'Halil Usta', shop: 'Berber Halil', key: generateAccessKey(), appUrl: `${env.publicUrl}/app/`, lang: 'tr' }),
  );
  console.log(`✓ Deneme e-postası gönderildi: ${to} (gönderen: ${env.mailFrom})`);
} catch (e) {
  console.error('✗ Gönderilemedi:', (e as Error).message);
  process.exit(1);
}
