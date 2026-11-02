// Runs before Angular boots (no flash of the wrong theme or language).
document.documentElement.classList.add('js');

// Forced light/dark theme.
try {
  var mode = localStorage.getItem('lcv-theme');
  if (mode === 'light' || mode === 'dark') document.documentElement.dataset.theme = mode;
} catch (e) {
  // Storage unavailable: the OS preference (prefers-color-scheme) applies.
}

// Public pages exist in every language (English at the root, /fr/…, /pt-br/…). A visitor landing
// on an English page while preferring another language is sent to that version.
(function () {
  var path = location.pathname;
  if (!/^\/(thumbnail|changelog|legal|privacy|terms)?\/?$/.test(path)) return;
  // Same list and rules as src/app/core/languages.ts.
  var langs = 'en fr es pt-br pt-pt de it nl sv da nb fi et lv lt pl cs sk hu ro bg el hr sr sl uk ru tr ar he fa ja ko zh-cn zh-tw hi bn ur id ms th vi fil sw'.split(' ');
  var aliases = { no: 'nb', nn: 'nb', tl: 'fil', iw: 'he', in: 'id', bs: 'hr', me: 'sr', zsm: 'ms', pes: 'fa', prs: 'fa' };
  function languageFor(tag) {
    var parts = String(tag).toLowerCase().split(/[-_]/);
    var base = parts[0];
    if (base === 'zh') {
      if (parts.indexOf('hans') >= 0) return 'zh-cn';
      if (parts.indexOf('hant') >= 0) return 'zh-tw';
      return parts.indexOf('tw') > 0 || parts.indexOf('hk') > 0 || parts.indexOf('mo') > 0 ? 'zh-tw' : 'zh-cn';
    }
    if (base === 'pt') return parts.length > 1 && parts[1] !== 'br' ? 'pt-pt' : 'pt-br';
    var code = aliases[base] || base;
    return langs.indexOf(code) >= 0 ? code : null;
  }
  var lang = null;
  try {
    lang = localStorage.getItem('lcv-lang');
  } catch (e) {
    // ignore
  }
  if (langs.indexOf(lang) < 0) {
    lang = null;
    var browser = navigator.languages || [navigator.language];
    for (var i = 0; i < browser.length && !lang; i++) lang = languageFor(browser[i]);
  }
  if (lang && lang !== 'en') location.replace('/' + lang + (path === '/' ? '' : path.replace(/\/$/, '')) + location.search + location.hash);
})();
