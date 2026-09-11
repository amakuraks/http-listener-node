// Applies the stored theme BEFORE first paint, to avoid a flash of the wrong theme.
//
// The usual fix is an inline <script> in <head>, but the Content-Security-Policy here
// is script-src 'self' with no unsafe-inline. So this is a separate same-origin file
// loaded WITHOUT defer: it still blocks parsing until it runs, which is exactly the
// property we need, and it stays within the policy. Keep it tiny for that reason.
//
// With no stored preference the attribute is left unset and CSS falls back to
// prefers-color-scheme, so the OS setting still wins by default.
(function () {
  try {
    var stored = localStorage.getItem('theme');
    if (stored === 'light' || stored === 'dark') {
      document.documentElement.dataset.theme = stored;
    }
  } catch (e) {
    // localStorage can throw in private mode or with site data blocked.
    // Falling through leaves the OS preference in charge, which is a fine default.
  }
})();
