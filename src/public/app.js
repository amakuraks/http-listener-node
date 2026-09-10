// Replaces the inline handlers that Content-Security-Policy blocks.
// Event delegation on document, driven by data attributes.

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
