import { Resend } from 'resend';

export interface Mail {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface Mailer {
  send(mail: Mail): Promise<void>;
}

/** Resend in production. */
export function resendMailer(apiKey: string, from: string): Mailer {
  const resend = new Resend(apiKey);
  return {
    async send(mail) {
      const { error } = await resend.emails.send({ from, to: mail.to, subject: mail.subject, html: mail.html, text: mail.text });
      if (error) throw new Error(`resend: ${error.name}: ${error.message}`);
    },
  };
}

/** Without RESEND_API_KEY (local development) the e-mail is printed instead of sent. */
export function consoleMailer(log: (s: string) => void = console.log): Mailer {
  return {
    async send(mail) {
      log(`\n[mail] to: ${mail.to}\n[mail] subject: ${mail.subject}\n${mail.text}\n`);
    },
  };
}

type L = 'tr' | 'en' | 'es';

const COPY: Record<L, { subject: string; hello: string; ready: string; readyTrial: string; step1: string; step2: string; button: string; keyLabel: string; expires: string; help: string }> = {
  tr: {
    subject: 'Monacount hazır: {shop} için giriş anahtarın',
    hello: 'Merhaba {name},',
    ready: 'Aboneliğin başladı ve {shop} Monacount’ta hazır. Defterin, bağlantıların, Röntgen’in ve AI asistanın Mona seni bekliyor.',
    readyTrial: 'Başvurun onaylandı: {shop} Monacount’ta hazır ve {days} günlük deneme sürün başladı. Defterin, bağlantıların, Röntgen’in ve AI asistanın Mona seni bekliyor.',
    step1: 'Aşağıdaki düğmeye bas; anahtarın otomatik dolar.',
    step2: 'Kendine bir şifre belirle. Hepsi bu: dükkânın açık.',
    button: 'Monacount’u aç',
    keyLabel: 'Erişim anahtarın',
    expires: 'Anahtar tek kullanımlıktır ve 14 gün geçerlidir. Bu e-postayı kimseyle paylaşma.',
    help: 'Bir sorun olursa uygulamadaki Ayarlar > Bize yaz’dan bize ulaş.',
  },
  en: {
    subject: 'Monacount is ready: your access key for {shop}',
    hello: 'Hi {name},',
    ready: 'Your subscription is active and {shop} is ready on Monacount. Your books, connections, X-ray and Mona, your AI assistant, are waiting.',
    readyTrial: 'You’re approved: {shop} is ready on Monacount and your {days}-day trial has started. Your books, connections, X-ray and Mona, your AI assistant, are waiting.',
    step1: 'Tap the button below; your key is filled in for you.',
    step2: 'Choose a password. That’s it: your shop is open.',
    button: 'Open Monacount',
    keyLabel: 'Your access key',
    expires: 'The key works once and expires in 14 days. Don’t share this e-mail.',
    help: 'If anything goes wrong, reach us from Settings > Tell us in the app.',
  },
  es: {
    subject: 'Monacount está listo: tu clave de acceso para {shop}',
    hello: 'Hola {name}:',
    ready: 'Tu suscripción está activa y {shop} ya está en Monacount. Tus libros, tus conexiones, la radiografía y Mona, tu asistente de IA, te esperan.',
    readyTrial: 'Tu solicitud fue aprobada: {shop} ya está en Monacount y empezó tu prueba de {days} días. Tus libros, tus conexiones, la radiografía y Mona, tu asistente de IA, te esperan.',
    step1: 'Pulsa el botón de abajo; tu clave se rellena sola.',
    step2: 'Elige una contraseña. Listo: tu barbería está abierta.',
    button: 'Abrir Monacount',
    keyLabel: 'Tu clave de acceso',
    expires: 'La clave sirve una sola vez y caduca en 14 días. No compartas este correo.',
    help: 'Si algo falla, escríbenos desde Ajustes > Escríbenos en la app.',
  },
};

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** The welcome e-mail with the app link and the one-time access key. */
export function welcomeEmail(p: { to: string; name: string; shop: string; key: string; appUrl: string; lang: L; trialDays?: number }): Mail {
  const c = COPY[p.lang] ?? COPY.en;
  const fill = (s: string) => s.replace('{name}', p.name.split(' ')[0]).replace('{shop}', p.shop).replace('{days}', String(p.trialDays ?? ''));
  const ready = p.trialDays ? c.readyTrial : c.ready;
  const link = `${p.appUrl.replace(/\/$/, '')}/#key=${encodeURIComponent(p.key)}`;
  const text = [fill(c.hello), '', fill(ready), '', `1. ${c.step1}`, `2. ${c.step2}`, '', `${c.button}: ${link}`, `${c.keyLabel}: ${p.key}`, '', c.expires, c.help].join('\n');
  const html = `<!doctype html><html><body style="margin:0;background:#f4efe4;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#1d1a15">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#fffdf8;border:1px solid #e2d9c7;border-radius:20px;overflow:hidden">
<tr><td style="height:8px;background:repeating-linear-gradient(-45deg,#b8322a 0 10px,#f4efe4 10px 16px,#2c4f7c 16px 26px,#f4efe4 26px 32px)"></td></tr>
<tr><td style="padding:28px 28px 8px"><div style="font-family:Georgia,serif;font-size:26px;font-weight:700;color:#a8741c">Monacount</div></td></tr>
<tr><td style="padding:8px 28px 0;font-size:16px;line-height:1.55">
<p style="margin:0 0 12px">${esc(fill(c.hello))}</p>
<p style="margin:0 0 18px">${esc(fill(ready))}</p>
<ol style="margin:0 0 22px;padding-left:20px"><li style="margin-bottom:6px">${esc(c.step1)}</li><li>${esc(c.step2)}</li></ol>
<p style="margin:0 0 22px"><a href="${esc(link)}" style="display:inline-block;background:#1d1a15;color:#f4efe4;text-decoration:none;font-weight:600;padding:14px 26px;border-radius:14px">${esc(c.button)}</a></p>
<p style="margin:0 0 6px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#8f877a">${esc(c.keyLabel)}</p>
<p style="margin:0 0 22px;font-family:Menlo,Consolas,monospace;font-size:20px;font-weight:700;letter-spacing:.06em">${esc(p.key)}</p>
<p style="margin:0 0 6px;font-size:13px;color:#5d564b">${esc(c.expires)}</p>
<p style="margin:0 0 28px;font-size:13px;color:#5d564b">${esc(c.help)}</p>
</td></tr></table></td></tr></table></body></html>`;
  return { to: p.to, subject: fill(c.subject), html, text };
}
