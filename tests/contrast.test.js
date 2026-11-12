/*
 * Contrast check. Reads the real colour tokens out of css/style.css and measures WCAG 2.2 contrast
 * ratios for the pairs the site actually uses. Run: node tests/contrast.test.js
 * Disabled controls are exempt from WCAG contrast rules; they are reported but not asserted.
 */
const fs = require('fs');
const path = require('path');
const css = fs.readFileSync(path.join(__dirname, '..', 'css', 'style.css'), 'utf8');

const token = name => {
  const m = css.match(new RegExp('--' + name + ':\\s*(#[0-9a-fA-F]{6})'));
  if (!m) throw new Error('Token not found: --' + name);
  return m[1];
};
const lum = hex => {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(c => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

// [label, foreground token, background token, minimum ratio]
const pairs = [
  ['Body text on page', 'color-text', 'color-background', 4.5],
  ['Body text on surface', 'color-text', 'color-surface', 4.5],
  ['Body text on raised surface', 'color-text', 'color-surface-raised', 4.5],
  ['Muted text on page', 'color-text-muted', 'color-background', 4.5],
  ['Muted text on surface', 'color-text-muted', 'color-surface', 4.5],
  ['Muted text on raised surface', 'color-text-muted', 'color-surface-raised', 4.5],
  ['Accent text and marks on page', 'color-accent', 'color-background', 4.5],
  ['Accent text on surface', 'color-accent', 'color-surface', 4.5],
  ['Primary button label on accent', 'color-on-accent', 'color-accent', 4.5],
  ['Selected domain tag (page colour on text colour)', 'color-background', 'color-text', 4.5],
  ['Success text on page', 'color-success', 'color-background', 4.5],
  ['Success text on surface', 'color-success', 'color-surface', 4.5],
  ['Warning text on page', 'color-warning', 'color-background', 4.5],
  ['Warning text on surface', 'color-warning', 'color-surface', 4.5],
  ['Error text on page', 'color-error', 'color-background', 4.5],
  ['Error text on surface', 'color-error', 'color-surface', 4.5],
  ['Error text on raised surface', 'color-error', 'color-surface-raised', 4.5],
  ['Control border on page (non-text 3:1)', 'color-border-strong', 'color-background', 3],
  ['Control border on surface (non-text 3:1)', 'color-border-strong', 'color-surface', 3],
  ['Control border on raised surface (non-text 3:1)', 'color-border-strong', 'color-surface-raised', 3],
  ['Focus ring on page (non-text 3:1)', 'color-focus', 'color-background', 3],
  ['Focus ring on surface (non-text 3:1)', 'color-focus', 'color-surface', 3]
];

let failed = 0;
for (const [label, fg, bg, min] of pairs) {
  const r = ratio(token(fg), token(bg));
  const ok = r >= min;
  if (!ok) failed++;
  console.log((ok ? 'PASS ' : 'FAIL ') + r.toFixed(2).padStart(5) + ':1 (need ' + min + ')  ' + label);
}
console.log('INFO ' + ratio(token('color-disabled-text'), token('color-disabled-bg')).toFixed(2) + ':1  disabled text (exempt from WCAG contrast)');
console.log(failed ? '\n' + failed + ' pair(s) below target' : '\nAll ' + pairs.length + ' pairs meet WCAG 2.2 AA');
process.exit(failed ? 1 : 0);
