// Applies a forced light/dark theme before Angular boots, to avoid a flash of the wrong theme.
try {
  var mode = localStorage.getItem('lcv-theme');
  if (mode === 'light' || mode === 'dark') document.documentElement.dataset.theme = mode;
} catch (e) {
  // Storage unavailable: the OS preference (prefers-color-scheme) applies.
}
