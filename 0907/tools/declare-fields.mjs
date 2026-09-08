/**
 * Third and last part of the one-shot port (slice → seam → declare).
 *
 * v1 was JavaScript, so its classes never declared their fields. This walks
 * each class body, collects every `this.x = ...` assignment, infers a type from
 * the right-hand side, and writes the declarations at the top of the class.
 *
 * The inference is deliberately shallow — literals, `new Foo()`, obvious
 * arrays. Anything it cannot read it declares as `unknown`, which makes tsc
 * point at exactly the fields that still need a human decision instead of
 * quietly spreading `any` through the codebase.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const targets = process.argv.slice(2);

/** Best-effort type for the right-hand side of an assignment. */
function inferType(rhs) {
  const e = rhs.trim().replace(/;.*$/, '').trim();
  if (/^-?[\d.]+(e-?\d+)?$/i.test(e)) return 'number';
  if (/^(true|false)$/.test(e)) return 'boolean';
  if (/^['"`]/.test(e)) return 'string';
  if (/^\[\s*\]$/.test(e)) return 'unknown[]';
  if (/^new THREE\.(\w+)/.test(e)) return `THREE.${e.match(/^new THREE\.(\w+)/)[1]}`;
  if (/^new (\w+)/.test(e)) return e.match(/^new (\w+)/)[1];
  if (/^null$/.test(e)) return 'unknown';
  if (/^document\.getElementById|^\$\(/.test(e)) return 'HTMLElement | null';
  if (/^-?[\d.]+\s*[*+\-/]/.test(e)) return 'number';
  if (/^Math\./.test(e)) return 'number';
  return 'unknown';
}

for (const rel of targets) {
  const p = resolve(root, rel);
  const lines = readFileSync(p, 'utf8').split('\n');
  const out = [];

  for (let i = 0; i < lines.length; i++) {
    out.push(lines[i]);
    const m = /^export class (\w+)|^class (\w+)/.exec(lines[i]);
    if (!m) continue;

    // Walk to the class's closing brace by brace depth.
    let depth = 0;
    let end = i;
    for (let j = i; j < lines.length; j++) {
      for (const ch of lines[j]) {
        if (ch === '{') depth++;
        else if (ch === '}') depth--;
      }
      if (depth === 0 && j > i) {
        end = j;
        break;
      }
    }

    // Collect every assignment to a field and keep the first one we can
    // actually read a type from — the constructor often initialises to `null`
    // and only a later method reveals what the field really holds.
    const fields = new Map();
    const note = (name, type) => {
      const prev = fields.get(name);
      if (prev === undefined || (prev === 'unknown' && type !== 'unknown')) {
        fields.set(name, type);
      }
    };
    for (let j = i; j < end; j++) {
      const body = lines[j];
      for (const a of body.matchAll(/this\.(\w+)\s*=\s*([^=][^;]*)/g)) note(a[1], inferType(a[2]));
      // `this.a=this.b=0` style chains declare both names.
      for (const a of body.matchAll(/this\.(\w+)\s*=\s*this\.\w+\s*=\s*([^=;]+)/g)) {
        note(a[1], inferType(a[2]));
      }
    }
    if (!fields.size) continue;

    const decls = [...fields]
      .map(([name, type]) => `  ${name}!: ${type};`)
      .join('\n');
    out.push(decls);
  }

  writeFileSync(p, out.join('\n'));
  console.log(`declared ${rel}`);
}
