// Puts the theme on the page before it paints, so there is no flash of the other theme: the visitor's pick
// from the header toggle, else the system setting. A separate file because the Content-Security-Policy allows
// no inline scripts. Keep the key and colours in step with src/theme.ts (THEME_KEY, THEME_COLORS);
// src/theme.test.tsx checks that they match.
(function () {
  var KEY = 'nk-theme';
  var COLORS = { light: '#f7f2e8', dark: '#12110f' };
  var theme = null;
  try { theme = localStorage.getItem(KEY); } catch (e) { /* storage blocked: follow the system */ }
  if (theme !== 'light' && theme !== 'dark') {
    theme = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  document.documentElement.dataset.theme = theme;
  var metas = document.querySelectorAll('meta[name="theme-color"]');
  for (var i = 0; i < metas.length; i++) metas[i].setAttribute('content', COLORS[theme]);
})();
