// Fade website: language, live price from Stripe, and the subscribe form (→ Stripe Checkout).
const T = {
  tr: {
    navFeatures: 'Özellikler', navPricing: 'Fiyat', navFaq: 'SSS', tryDemo: 'Demoyu dene', subscribe: 'Abone ol',
    heroA: 'Her kesik,', heroB: 'kayıtta.',
    lead: 'Randevu defteri, gün kazancı, veresiye, otomatik WhatsApp hatırlatmaları ve sesle çalışan bir AI asistan. Berberin telefonunda, tek ekranda.',
    featuresTitle: 'Dükkânı yürüten her şey, cebinde.',
    f1t: 'AI asistan', f1: '“Yarın 3’te Ahmet sakal”, “100 dolar kazandım, 300 dolar kira ödedim” de; asistan doğru yere yazsın. “Geçen ay ne kadar kazandık?” diye sor, veritabanından cevaplasın.',
    f2t: 'Randevu defteri', f2: 'Gün listesi, kasada ve beklenen tutar, tek dokunuşla tamamlandı ya da gelmedi. Aynı koltuğa çift randevu imkânsız.',
    f3t: 'Otomatik hatırlatma', f3: 'Bir gün önce 18.00’de ve randevudan 2 saat önce WhatsApp/SMS. Gelmeyen müşteri azalır; izin vermeyen müşteriye hiç mesaj gitmez.',
    f4t: 'Defter ve özet', f4: 'Gelir, gider, net; gün, hafta, ay. Karışık bir notu bile ayrı kayıtlara böler. Rakamları her zaman veritabanı hesaplar.',
    f5t: 'Veresiye', f5: 'Kimin ne kadar borcu var, tek bakışta. Borç yaz, ödeme al, kapat.',
    f6t: 'Canlı destek', f6: 'Uygulamanın içinden bize yaz; ekibimiz aynı sohbetten cevaplasın. Türkçe, English, Español.',
    stepsTitle: 'Üç adımda dükkânın açık.',
    s1: 'Aşağıdan abone ol; ödeme Stripe’ın güvenli sayfasında.', s2: 'Uygulama linkin ve erişim anahtarın e-postana gelsin.', s3: 'Linke dokun, şifreni belirle, ilk randevuyu sesle gir.',
    planName: 'Fade Pro', perMonth: '/ ay', perYear: '/ yıl',
    p1: 'Sınırsız randevu, müşteri ve defter kaydı', p2: 'AI asistan (sesle ve yazıyla)', p3: 'Otomatik WhatsApp/SMS hatırlatmaları', p4: 'Canlı destek, verini istediğin an dışa aktar', p5: 'İstediğin zaman iptal',
    formTitle: 'Dükkânını aç', formSub: 'Bilgilerini gir, ödemeyi tamamla; uygulama linkin e-postana düşsün.',
    shopName: 'Dükkân adı', ownerName: 'Adın soyadın', email: 'E-posta', country: 'Ülke', terms: 'Abonelik ve gizlilik koşullarını kabul ediyorum.',
    pay: 'Ödemeye geç', paying: 'Ödeme sayfası açılıyor…', secure: '🔒 Kart bilgilerin Stripe’ta işlenir, bize hiç ulaşmaz.',
    faqTitle: 'Sık sorulanlar',
    q1: 'Kart bilgilerim güvende mi?', a1: 'Ödeme Stripe’ın sayfasında alınır; kart bilgin Fade’e hiç gelmez.',
    q2: 'İptal edebilir miyim?', a2: 'Evet, istediğin an uygulamadaki “Aboneliği yönet” bağlantısından. Dönem sonuna kadar kullanmaya devam edersin.',
    q3: 'Verilerim ne olur?', a3: 'Veriler yalnızca senin dükkânına aittir; istediğin an dışa aktarabilirsin. İptalden 90 gün sonra kalıcı olarak silinir.',
    q4: 'Hangi dillerde çalışıyor?', a4: 'Uygulama, asistan ve müşteri mesajları Türkçe, İngilizce ve İspanyolca.',
    q5: 'E-posta gelmedi?', a5: 'Gereksiz (spam) klasörüne bak. Yine yoksa uygulamadaki canlı destekten ya da bu sayfadaki demodan bize yaz; yeni anahtar gönderelim.',
    soon: 'Çok yakında', apply: 'Başvur', applying: 'Gönderiliyor…', applied: 'Başvurun alındı! Ekibimiz seninle iletişime geçecek; onaylanınca uygulama linkin ve erişim anahtarın e-postana gelecek.', applySub: 'Bilgilerini bırak; başvurun onaylanınca uygulama linkin e-postana düşsün.', footer: 'Berberin defteri · Türkçe · English · Español', priceHint: 'Fade Pro: {price} {interval} · istediğin zaman iptal',
    okTitle: 'Ödemen alındı.', okBody: 'Dükkânın kuruluyor. Birkaç dakika içinde e-postana uygulama linkin ve erişim anahtarın gelecek.', okSpam: 'Göremezsen gereksiz (spam) klasörüne bak.', okBack: 'Ana sayfaya dön',
    errRequired: 'Lütfen tüm alanları doldur ve koşulları kabul et.', errEmail: 'Bu e-posta ile zaten bir dükkân var. Uygulamadan giriş yap.', errClosed: 'Abonelikler çok yakında açılıyor. O zamana kadar demoyu deneyebilirsin.', errGeneric: 'Bir şey ters gitti, tekrar dene.',
  },
  en: {
    navFeatures: 'Features', navPricing: 'Pricing', navFaq: 'FAQ', tryDemo: 'Try the demo', subscribe: 'Subscribe',
    heroA: 'Every cut,', heroB: 'counted.',
    lead: 'Appointment book, day takings, client tabs, automatic WhatsApp reminders and a voice AI assistant. On the barber’s phone, one screen.',
    featuresTitle: 'Everything that runs the shop, in your pocket.',
    f1t: 'AI assistant', f1: 'Say “tomorrow at 3 John haircut” or “made 100, paid 300 rent” and it files it. Ask “how much did we make last month?” and it answers from your books.',
    f2t: 'Appointment book', f2: 'Day list, takings so far and expected, done or no-show in one tap. Double booking a chair is impossible.',
    f3t: 'Automatic reminders', f3: 'WhatsApp/SMS the evening before and two hours ahead. Fewer no-shows; clients without consent never get a message.',
    f4t: 'Books and summary', f4: 'Income, expenses, net by day, week and month. Even a messy note becomes separate entries. The database does the math.',
    f5t: 'Client tabs', f5: 'Who owes what at a glance. Add to a tab, take payment, close it.',
    f6t: 'Live support', f6: 'Write to us from inside the app; our team answers in the same thread. Türkçe, English, Español.',
    stepsTitle: 'Your shop is open in three steps.',
    s1: 'Subscribe below; payment happens on Stripe’s secure page.', s2: 'Your app link and access key arrive by e-mail.', s3: 'Tap the link, choose a password, book the first client by voice.',
    planName: 'Fade Pro', perMonth: '/ month', perYear: '/ year',
    p1: 'Unlimited appointments, clients and entries', p2: 'AI assistant (voice and text)', p3: 'Automatic WhatsApp/SMS reminders', p4: 'Live support, export your data any time', p5: 'Cancel any time',
    formTitle: 'Open your shop', formSub: 'Enter your details, complete the payment, and your app link lands in your inbox.',
    shopName: 'Shop name', ownerName: 'Your name', email: 'E-mail', country: 'Country', terms: 'I accept the subscription terms and privacy policy.',
    pay: 'Continue to payment', paying: 'Opening checkout…', secure: '🔒 Card details are handled by Stripe and never reach us.',
    faqTitle: 'Questions',
    q1: 'Is my card safe?', a1: 'Payment is taken on Stripe’s page; your card never reaches Fade.',
    q2: 'Can I cancel?', a2: 'Yes, any time from “Manage subscription” in the app. You keep access until the end of the period.',
    q3: 'What about my data?', a3: 'Your data belongs to your shop only; export it any time. It is deleted 90 days after cancelling.',
    q4: 'Which languages?', a4: 'The app, the assistant and client messages work in Turkish, English and Spanish.',
    q5: 'No e-mail?', a5: 'Check your spam folder. Still nothing? Write to us and we’ll send a new key.',
    soon: 'Coming soon', apply: 'Apply', applying: 'Sending…', applied: 'Application received! Our team will get in touch; once approved, your app link and access key arrive by e-mail.', applySub: 'Leave your details; once approved, your app link lands in your inbox.', footer: 'The barber’s book · Türkçe · English · Español', priceHint: 'Fade Pro: {price} {interval} · cancel any time',
    okTitle: 'Payment received.', okBody: 'Your shop is being set up. Your app link and access key will reach your inbox in a few minutes.', okSpam: 'Can’t see it? Check your spam folder.', okBack: 'Back to the home page',
    errRequired: 'Please fill in every field and accept the terms.', errEmail: 'A shop already exists for this e-mail. Sign in from the app.', errClosed: 'Subscriptions open very soon. Try the demo meanwhile.', errGeneric: 'Something went wrong, please try again.',
  },
};
T.es = {
  ...T.en,
  navFeatures: 'Funciones', navPricing: 'Precio', navFaq: 'Preguntas', tryDemo: 'Probar la demo', subscribe: 'Suscribirse',
  heroA: 'Cada corte,', heroB: 'contado.',
  lead: 'Agenda, caja del día, fiados, recordatorios automáticos por WhatsApp y un asistente de IA por voz. En el teléfono del barbero, en una pantalla.',
  featuresTitle: 'Todo lo que mueve la barbería, en tu bolsillo.',
  f1t: 'Asistente de IA', f1: 'Di “mañana a las 3 Pedro corte” o “gané 100 y pagué 300 de alquiler” y lo anota. Pregunta “¿cuánto ganamos el mes pasado?” y responde con tus cuentas.',
  f2t: 'Agenda', f2: 'Lista del día, caja y previsto, hecha o no vino con un toque. Imposible reservar dos veces la misma silla.',
  f3t: 'Recordatorios automáticos', f3: 'WhatsApp/SMS la tarde anterior y dos horas antes. Menos ausencias; sin consentimiento no se envía nada.',
  f4t: 'Cuentas y resumen', f4: 'Ingresos, gastos y neto por día, semana y mes. Hasta una nota desordenada se separa en asientos. Las cuentas las hace la base de datos.',
  f5t: 'Fiados', f5: 'Quién debe cuánto, de un vistazo. Fía, cobra, cierra.',
  f6t: 'Soporte en vivo', f6: 'Escríbenos desde la app; nuestro equipo responde en el mismo chat.',
  stepsTitle: 'Tu barbería abierta en tres pasos.',
  s1: 'Suscríbete abajo; el pago es en la página segura de Stripe.', s2: 'El enlace de la app y tu clave llegan por correo.', s3: 'Toca el enlace, elige tu contraseña y reserva al primer cliente por voz.',
  perMonth: '/ mes', perYear: '/ año',
  p1: 'Citas, clientes y asientos ilimitados', p2: 'Asistente de IA (voz y texto)', p3: 'Recordatorios automáticos por WhatsApp/SMS', p4: 'Soporte en vivo, exporta tus datos cuando quieras', p5: 'Cancela cuando quieras',
  formTitle: 'Abre tu barbería', formSub: 'Completa tus datos y el pago; el enlace de la app llega a tu correo.',
  shopName: 'Nombre de la barbería', ownerName: 'Tu nombre', email: 'Correo', country: 'País', terms: 'Acepto las condiciones de suscripción y privacidad.',
  pay: 'Ir al pago', paying: 'Abriendo el pago…', secure: '🔒 Los datos de tu tarjeta los procesa Stripe; nunca nos llegan.',
  faqTitle: 'Preguntas frecuentes',
  q1: '¿Mi tarjeta está segura?', a1: 'El pago se hace en la página de Stripe; tu tarjeta nunca llega a Fade.',
  q2: '¿Puedo cancelar?', a2: 'Sí, cuando quieras desde “Gestionar suscripción” en la app.',
  q3: '¿Y mis datos?', a3: 'Son solo de tu barbería; expórtalos cuando quieras. Se borran 90 días después de cancelar.',
  q4: '¿En qué idiomas?', a4: 'La app, el asistente y los mensajes a clientes funcionan en turco, inglés y español.',
  q5: '¿No llegó el correo?', a5: 'Revisa la carpeta de spam. Si no está, escríbenos y te enviamos una clave nueva.',
  soon: 'Muy pronto', apply: 'Solicitar', applying: 'Enviando…', applied: '¡Solicitud recibida! Nuestro equipo te contactará; al aprobarla, el enlace de la app y tu clave llegarán a tu correo.', applySub: 'Deja tus datos; cuando aprobemos tu solicitud, el enlace de la app llegará a tu correo.', footer: 'La libreta del barbero · Türkçe · English · Español', priceHint: 'Fade Pro: {price} {interval} · cancela cuando quieras',
  okTitle: 'Pago recibido.', okBody: 'Estamos preparando tu barbería. En unos minutos te llegarán el enlace de la app y tu clave de acceso.', okSpam: '¿No lo ves? Revisa el spam.', okBack: 'Volver al inicio',
  errRequired: 'Completa todos los campos y acepta las condiciones.', errEmail: 'Ya existe una barbería con este correo. Entra desde la app.', errClosed: 'Las suscripciones abren muy pronto. Mientras, prueba la demo.', errGeneric: 'Algo salió mal, inténtalo de nuevo.',
};

const params = new URLSearchParams(location.search);
let lang = params.get('lang') || localStorage.getItem('fade.siteLang') || (navigator.language || 'en').slice(0, 2);
if (!T[lang]) lang = 'en';
const t = (k) => T[lang][k] ?? T.en[k] ?? k;
let plan = null;

function apply() {
  document.documentElement.lang = lang;
  document.querySelectorAll('[data-i18n]').forEach((el) => (el.textContent = t(el.dataset.i18n)));
  document.querySelectorAll('.langs button').forEach((b) => b.classList.toggle('on', b.dataset.lang === lang));
  renderPrice();
  renderMode();
}

// Payments off: the form is an application the team approves; payments on: it goes to Stripe Checkout.
const applying = () => plan && plan.enabled === false;

function renderMode() {
  const btn = document.getElementById('submit');
  if (btn && !btn.disabled) btn.textContent = t(applying() ? 'apply' : 'pay');
  const sub = document.querySelector('[data-i18n="formSub"]');
  if (sub && applying()) sub.textContent = t('applySub');
  const secure = document.querySelector('.secure');
  if (secure) secure.style.display = applying() ? 'none' : '';
}

function renderPrice() {
  const priceEl = document.getElementById('price');
  if (!priceEl || !plan) return;
  if (!plan.amount_cents) {
    // Stripe not connected yet: no made-up price.
    priceEl.textContent = t('soon');
    document.getElementById('interval').textContent = '';
    return;
  }
  const locale = lang === 'tr' ? 'tr-TR' : lang === 'es' ? 'es-ES' : 'en-US';
  const whole = plan.amount_cents % 100 === 0;
  const price = new Intl.NumberFormat(locale, { style: 'currency', currency: plan.currency, maximumFractionDigits: whole ? 0 : 2 }).format(plan.amount_cents / 100);
  const interval = t(plan.interval === 'year' ? 'perYear' : 'perMonth');
  priceEl.textContent = price;
  document.getElementById('interval').textContent = interval;
  const hint = document.getElementById('price-hint');
  if (hint) hint.textContent = t('priceHint').replace('{price}', price).replace('{interval}', interval);
}

document.querySelectorAll('.langs button').forEach((b) =>
  b.addEventListener('click', () => {
    lang = b.dataset.lang;
    localStorage.setItem('fade.siteLang', lang);
    apply();
  }),
);

fetch('/api/billing/plan')
  .then((r) => (r.ok ? r.json() : null))
  .then((p) => {
    plan = p;
    renderPrice();
    renderMode();
  })
  .catch(() => {});

const form = document.getElementById('signup-form');
if (form) {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const guess = { 'Europe/Istanbul': 'TR', 'America/Mexico_City': 'MX', 'Europe/Madrid': 'ES', 'Europe/London': 'GB', 'Europe/Berlin': 'DE' }[tz] || (tz.startsWith('America/') ? 'US' : 'TR');
  form.country.value = guess;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = document.getElementById('form-error');
    const btn = document.getElementById('submit');
    err.textContent = '';
    if (!form.checkValidity()) return void (err.textContent = t('errRequired'));
    btn.disabled = true;
    btn.textContent = t(applying() ? 'applying' : 'paying');
    try {
      const res = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          shop_name: form.shop_name.value,
          owner_name: form.owner_name.value,
          email: form.email.value,
          country: form.country.value,
          timezone: tz,
          language: lang,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok && body.url) return void (location.href = body.url);
      if (res.ok && body.applied) {
        form.innerHTML = `<p class="applied">✓ ${t('applied')}</p>`;
        return;
      }
      const code = body?.error?.code;
      err.textContent = code === 'EMAIL_TAKEN' ? t('errEmail') : code === 'BILLING_DISABLED' ? t('errClosed') : code === 'VALIDATION_ERROR' ? t('errRequired') : t('errGeneric');
    } catch {
      err.textContent = t('errGeneric');
    }
    btn.disabled = false;
    btn.textContent = t(applying() ? 'apply' : 'pay');
  });
}

apply();
