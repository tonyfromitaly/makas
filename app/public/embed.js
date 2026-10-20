/* Usta online booking: one line on the shop's website.
   <script src="https://<host>/book/embed.js" data-shop="<slug>" async></script>
   Optional: data-label="Book now", data-lang="en", data-inline="true" (the page in place, not a button). */
(function () {
  var s = document.currentScript;
  if (!s) return;
  var shop = s.getAttribute('data-shop');
  if (!shop || !/^[a-z0-9-]{3,40}$/i.test(shop)) return;
  var origin = new URL(s.src).origin;
  var lang = s.getAttribute('data-lang') || '';
  var url = origin + '/book/' + encodeURIComponent(shop) + (lang ? '?lang=' + encodeURIComponent(lang) : '');
  var label = s.getAttribute('data-label') || ({ tr: 'Randevu al', es: 'Pedir cita' }[(lang || navigator.language || '').slice(0, 2)] || 'Book now');

  function frame(style) {
    var f = document.createElement('iframe');
    f.src = url;
    f.title = label;
    f.loading = 'lazy';
    f.allow = 'clipboard-write';
    f.setAttribute('style', 'border:0;width:100%;' + style);
    return f;
  }

  if (s.getAttribute('data-inline') === 'true') {
    s.parentNode.insertBefore(frame('height:680px;max-width:560px;display:block;margin:0 auto;'), s);
    return;
  }

  var btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = label;
  btn.setAttribute(
    'style',
    'position:fixed;right:20px;bottom:20px;z-index:2147483000;padding:14px 20px;border:0;border-radius:2px;' +
      'background:#1d2433;color:#fbfbf8;font:700 15px/1 system-ui,sans-serif;letter-spacing:.04em;cursor:pointer;' +
      'box-shadow:0 10px 24px -10px rgba(0,0,0,.55);',
  );
  var overlay = null;
  function close() {
    if (overlay) overlay.remove();
    overlay = null;
    btn.focus();
  }
  btn.addEventListener('click', function () {
    if (overlay) return;
    overlay = document.createElement('div');
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', label);
    overlay.setAttribute('style', 'position:fixed;inset:0;z-index:2147483001;background:rgba(15,18,22,.55);display:flex;align-items:flex-end;justify-content:center;');
    var box = document.createElement('div');
    box.setAttribute('style', 'position:relative;width:100%;max-width:520px;height:min(760px,94vh);background:#c9cfd3;box-shadow:0 20px 60px rgba(0,0,0,.45);');
    var x = document.createElement('button');
    x.type = 'button';
    x.textContent = '×';
    x.setAttribute('aria-label', 'Close');
    x.setAttribute('style', 'position:absolute;top:-40px;right:8px;width:34px;height:34px;border:0;border-radius:50%;background:#fbfbf8;color:#1d2433;font:700 20px/1 system-ui;cursor:pointer;');
    x.addEventListener('click', close);
    box.appendChild(x);
    box.appendChild(frame('height:100%;'));
    overlay.appendChild(box);
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) close();
    });
    document.addEventListener('keydown', function esc(e) {
      if (e.key === 'Escape') {
        close();
        document.removeEventListener('keydown', esc);
      }
    });
    document.body.appendChild(overlay);
    x.focus();
  });
  (document.body || document.documentElement).appendChild(btn);
})();
