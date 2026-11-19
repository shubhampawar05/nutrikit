// Applies a theme picked with the header toggle before the page paints, so there is no flash of the
// other theme. A separate file because the Content-Security-Policy allows no inline scripts.
try {
  var t = localStorage.getItem('nk-theme');
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
} catch (e) { /* storage blocked: follow the system setting */ }
