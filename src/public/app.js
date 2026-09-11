// Replaces the inline handlers that Content-Security-Policy blocks.
// Event delegation on document, driven by data attributes.

// --- Theme toggle -----------------------------------------------------------
// theme.js has already applied any stored preference before paint. This only
// handles switching and keeps the button label in sync.

const THEME_KEY = 'theme';

function currentTheme() {
  const explicit = document.documentElement.dataset.theme;
  if (explicit === 'light' || explicit === 'dark') return explicit;
  // No explicit choice: whatever the OS is currently asking for.
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function paintToggle(button) {
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  button.textContent = next === 'dark' ? '☾' : '☀';
  button.setAttribute('aria-label', `Switch to ${next} theme`);
  button.setAttribute('title', `Switch to ${next} theme`);
}

document.addEventListener('click', (event) => {
  const button = event.target.closest('[data-theme-toggle]');
  if (!button) return;

  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch {
    // Storage unavailable: the switch still applies for this page view.
  }
  paintToggle(button);
});

// Label the button on load. app.js is deferred, so the DOM is ready here.
const themeToggle = document.querySelector('[data-theme-toggle]');
if (themeToggle) paintToggle(themeToggle);

// Follow the OS if the user has never made an explicit choice.
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (!document.documentElement.dataset.theme && themeToggle) paintToggle(themeToggle);
});

// --- Forms and copy buttons -------------------------------------------------

document.addEventListener('submit', (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  const message = form.dataset.confirm;
  if (message && !window.confirm(message)) {
    event.preventDefault();
  }
});

document.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-copy-target]');
  if (!button) return;

  const source = document.getElementById(button.dataset.copyTarget);
  if (!source) return;

  // navigator.clipboard requires a secure context. localhost qualifies; plain http on a
  // LAN address does not - hence the fallback rather than an unhandled rejection.
  try {
    await navigator.clipboard.writeText(source.textContent ?? '');
    button.textContent = 'Copied';
  } catch {
    button.textContent = 'Copy unavailable - select manually';
    return;
  }
  setTimeout(() => {
    button.textContent = 'Copy';
  }, 1500);
});
