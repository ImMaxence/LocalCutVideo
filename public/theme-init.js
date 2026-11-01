// Runs before Angular boots (no flash of the wrong theme or language).
document.documentElement.classList.add('js');

// Forced light/dark theme.
try {
  var mode = localStorage.getItem('lcv-theme');
  if (mode === 'light' || mode === 'dark') document.documentElement.dataset.theme = mode;
} catch (e) {
  // Storage unavailable: the OS preference (prefers-color-scheme) applies.
}

// Public pages exist in every language (English at the root, /fr/…, /es/…). A visitor landing
// on an English page while preferring another language is sent to that version.
(function () {
  var path = location.pathname;
  if (!/^\/(thumbnail|changelog|legal|privacy|terms)?\/?$/.test(path)) return;
  var langs = ['en', 'fr', 'es', 'it', 'de'];
  var lang = null;
  try {
    lang = localStorage.getItem('lcv-lang');
  } catch (e) {
    // ignore
  }
  if (langs.indexOf(lang) < 0) {
    var browser = navigator.languages || [navigator.language];
    for (var i = 0; i < browser.length && !lang; i++) {
      var code = String(browser[i]).slice(0, 2).toLowerCase();
      if (langs.indexOf(code) >= 0) lang = code;
    }
  }
  if (lang && lang !== 'en') location.replace('/' + lang + (path === '/' ? '' : path.replace(/\/$/, '')) + location.search + location.hash);
})();
