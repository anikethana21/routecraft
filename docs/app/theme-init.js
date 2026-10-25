/* Apply the saved theme before the app renders to avoid a flash of light.
 * This lives in an external file because extension pages forbid inline JS. */
(function () {
  try {
    var stored = localStorage.getItem('routecraft.theme');
    if (stored === null) {
      stored = localStorage.getItem('oneswagger.theme');
      if (stored !== null) localStorage.setItem('routecraft.theme', stored);
    }
    var theme = stored || 'system';
    try {
      var parsed = JSON.parse(stored);
      if (typeof parsed === 'string') theme = parsed;
    } catch (error) {
      /* the current format stores a bare string */
    }
    var dark =
      theme === 'dark' ||
      (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  } catch (error) {
    document.documentElement.dataset.theme = 'light';
  }
})();
