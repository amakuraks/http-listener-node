import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Static asset checks - no server or database needed.
const css = readFileSync('src/public/style.css', 'utf8');
const themeJs = readFileSync('src/public/theme.js', 'utf8');
const appJs = readFileSync('src/public/app.js', 'utf8');
const head = readFileSync('src/views/partials/head.ejs', 'utf8');

/** Pull the `--token: value;` pairs out of one declaration block. */
function tokensIn(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [, name, value] of block.matchAll(/--([a-z-]+):\s*([^;]+);/g)) {
    out[name] = value.trim();
  }
  return out;
}

/**
 * Return the declaration block for a selector. Palette blocks contain no nested
 * braces, so a non-greedy match to the first `}` is sufficient. A selector may
 * appear more than once (the dark palette and its color-scheme pin), so the
 * block carrying custom properties is the one wanted.
 */
function paletteBlock(selectorPattern: RegExp): string {
  const matches = [...css.matchAll(new RegExp(selectorPattern.source + '\\s*\\{([^}]*)\\}', 'g'))];
  const withTokens = matches.map((m) => m[1] ?? '').filter((b) => b.includes('--'));
  assert.equal(withTokens.length, 1, `expected exactly one palette block for ${selectorPattern}`);
  return withTokens[0] as string;
}

const LIGHT = /:root(?![\w:[-])/; // `:root {`, not `:root:not(...)` or `:root[...]`
const DARK_MEDIA = /:root:not\(\[data-theme='light'\]\)/;
const DARK_EXPLICIT = /:root\[data-theme='dark'\]/;

test('the two dark palettes are identical', () => {
  // CSS cannot share a declaration block between a media query and a plain
  // selector, so the dark values exist twice. Editing one and forgetting the
  // other would make the toggle and the OS preference disagree.
  const media = tokensIn(paletteBlock(DARK_MEDIA));
  const explicit = tokensIn(paletteBlock(DARK_EXPLICIT));

  assert.ok(Object.keys(media).length >= 16, 'expected a full dark palette');
  assert.deepEqual(explicit, media, 'dark palettes have drifted apart');
});

test('every light token has a dark counterpart', () => {
  const light = tokensIn(paletteBlock(LIGHT));
  const dark = tokensIn(paletteBlock(DARK_MEDIA));
  const missing = Object.keys(light).filter((t) => !(t in dark));
  assert.deepEqual(missing, [], `tokens with no dark value: ${missing.join(', ')}`);
});

test('no hard-coded colour escapes the palette blocks', () => {
  // A literal hex outside the palettes would stay light-themed in dark mode.
  const withoutPalettes = css
    .replace(/:root[^{]*\{[^}]*\}/g, '')
    .replace(/@media[^{]*\{[\s\S]*?\n\}/g, '');
  const strays = [...withoutPalettes.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0]);
  assert.deepEqual(strays, [], `hard-coded colours: ${strays.join(', ')}`);
});

test('theme.js is loaded without defer so it runs before first paint', () => {
  const tag = head.match(/<script[^>]*theme\.js[^>]*>/);
  assert.ok(tag, 'theme.js must be referenced in <head>');
  assert.ok(!/\bdefer\b|\basync\b/.test(tag[0]), 'defer/async would reintroduce a theme flash');
  assert.ok(
    head.indexOf('theme.js') < head.indexOf('</head>'),
    'theme.js must be inside <head>',
  );
});

test('theme scripts stay Content-Security-Policy compatible', () => {
  // script-src 'self' with no unsafe-inline: no inline handlers, no inline script.
  assert.ok(!/\son(click|change|load)=/i.test(head), 'inline handler in head.ejs');
  assert.ok(/data-theme-toggle/.test(head), 'toggle button should be wired by data attribute');
  assert.ok(/localStorage/.test(themeJs) && /try\s*\{/.test(themeJs), 'storage access must be guarded');
  assert.ok(/try\s*\{/.test(appJs), 'storage writes must be guarded');
});
