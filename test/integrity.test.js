'use strict';

/**
 * Integrity: the v2.0.0 tree is NEVER modified.
 *
 * callx402 only require()s from
 * ~/workspace/products/x402-paid-api-starter-kit/v2.0.0. This test fails if
 * any file OR directory under that tree is newer than the marker file, which
 * was created before the test suite (and the implementation fixes) ran.
 */

const { test } = require('node:test');
const { needsV2Tree } = require('./helpers');
const fs = require('node:fs');
const path = require('node:path');

const V2_ROOT = path.resolve(__dirname, '..', '..', 'x402-paid-api-starter-kit', 'v2.0.0');
const MARKER = path.join(__dirname, '.v2-integrity-marker');

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    out.push(p);
    if (entry.isDirectory()) walk(p, out);
  }
  return out;
}

test('zero files changed under the v2.0.0 tree', needsV2Tree, (t) => {
  t.assert.ok(fs.existsSync(MARKER), 'integrity marker exists (created before the suite ran)');
  t.assert.ok(fs.existsSync(V2_ROOT), 'v2.0.0 tree exists');
  const markerMs = fs.statSync(MARKER).mtimeMs;
  const newer = [];
  for (const p of walk(V2_ROOT, [])) {
    let st;
    try {
      st = fs.statSync(p);
    } catch (_) {
      continue;
    }
    if (st.mtimeMs > markerMs) newer.push(p);
  }
  t.assert.deepStrictEqual(newer, [], 'no file or directory under v2.0.0 may be newer than the pre-suite marker');
});
