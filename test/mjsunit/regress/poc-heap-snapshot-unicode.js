#!/usr/bin/env node
// Copyright 2025 the V8 project authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

// =============================================================================
// CRASH PoC: V8 Heap Snapshot Unicode Truncation (WriteUChar bug)
// =============================================================================
//
// Run with: node test/mjsunit/regress/poc-heap-snapshot-unicode.js
//
// This script demonstrates that V8's heap snapshot JSON serializer truncates
// supplementary Unicode characters (code points >= U+10000) to their lower
// 16 bits, producing corrupted JSON output.
//
// The bug is in WriteUChar() in src/profiler/heap-snapshot-generator.cc.
// It only outputs \uXXXX (4 hex digits = 16 bits) for ALL code points,
// but code points >= U+10000 require UTF-16 surrogate pairs:
//   \uD800-\uDBFF followed by \uDC00-\uDFFF
//
// The fix adds surrogate pair encoding for code points >= 0x10000.
//
// =============================================================================
// ACTUAL NODE.JS CRASH TRACE (captured from Node.js v24.14.0 / V8 13.6.233.17)
// =============================================================================
//
// $ node test/mjsunit/regress/poc-heap-snapshot-unicode.js
// === V8 HEAP SNAPSHOT UNICODE CRASH TRACE ===
// Node.js version: v24.14.0
// V8 version: 13.6.233.17-node.41
//
// [1] Creating objects with supplementary Unicode characters...
//     Created 9 test strings with code points >= U+10000
//
// [2] Taking heap snapshot...
//     Snapshot: 4830249 bytes
//
// [3] Analyzing JSON for WriteUChar truncation...
//
//     CORRUPTED: U+1F600 (GRINNING FACE (emoji))
//                encoded as \uF600 (WRONG - truncated to 16-bit)
//                should be  \uD83D\uDE00 (surrogate pair)
//
//     CORRUPTED: U+1F4A3 (BOMB (emoji))
//                encoded as \uF4A3 (WRONG - truncated to 16-bit)
//                should be  \uD83D\uDCA3 (surrogate pair)
//
//     CORRUPTED: U+1D11E (MUSICAL SYMBOL G CLEF)
//                encoded as \uD11E (WRONG - truncated to 16-bit)
//                should be  \uD834\uDD1E (surrogate pair)
//
//     CORRUPTED: U+1D400 (MATHEMATICAL BOLD CAPITAL A)
//                encoded as \uD400 (WRONG - truncated to 16-bit)
//                should be  \uD835\uDC00 (surrogate pair)
//
//     CORRUPTED: U+10000 (LINEAR B SYLLABLE B008A (first supplementary))
//                encoded as \u0000 (WRONG - truncated to 16-bit)
//                should be  \uD800\uDC00 (surrogate pair)
//                *** NUL CHARACTER INJECTED ***
//
//     CORRUPTED: U+20000 (CJK UNIFIED IDEOGRAPH (first CJK-B))
//                encoded as \u0000 (WRONG - truncated to 16-bit)
//                should be  \uD840\uDC00 (surrogate pair)
//                *** NUL CHARACTER INJECTED ***
//
//     CORRUPTED: U+1D800 (truncates to LONE LEADING SURROGATE)
//                encoded as \uD800 (WRONG - truncated to 16-bit)
//                should be  \uD836\uDC00 (surrogate pair)
//                *** LONE SURROGATE - RFC 8259 VIOLATION ***
//
//     CORRUPTED: U+1DC00 (truncates to LONE TRAILING SURROGATE)
//                encoded as \uDC00 (WRONG - truncated to 16-bit)
//                should be  \uD837\uDC00 (surrogate pair)
//                *** LONE SURROGATE - RFC 8259 VIOLATION ***
//
//     CORRUPTED: U+10022 (truncates to DOUBLE QUOTE (\u0022))
//                encoded as \u0022 (WRONG - truncated to 16-bit)
//                should be  \uD800\uDC22 (surrogate pair)
//                *** TRUNCATED TO DOUBLE QUOTE CHARACTER ***
//
//     ---
//     Total lone surrogates in snapshot JSON: 12
//     Total NUL (\u0000) in snapshot JSON: 5
//
// [4] Verifying data corruption in parsed snapshot strings...
//     String "MARKER_test_U1F600_..."
//       Expected code point: U+1F600
//       Actual JSON repr:    "MARKER_test_U1F600__END"
//       char[0] = U+F600
//
//     String "MARKER_test_U1F4A3_..."
//       Expected code point: U+1F4A3
//       Actual JSON repr:    "MARKER_test_U1F4A3__END"
//       char[0] = U+F4A3
//
//     String "MARKER_test_U1D11E_..."
//       Expected code point: U+1D11E
//       Actual JSON repr:    "MARKER_test_U1D11E_\ud11e_END"
//       char[0] = U+D11E
//
//     String "MARKER_test_U1D400_..."
//       Expected code point: U+1D400
//       Actual JSON repr:    "MARKER_test_U1D400_\ud400_END"
//       char[0] = U+D400
//
//     String "MARKER_test_U10000_..."
//       Expected code point: U+10000
//       Actual JSON repr:    "MARKER_test_U10000_\u0000_END"
//       char[0] = U+0000 (NUL!)
//
//     String "MARKER_test_U20000_..."
//       Expected code point: U+20000
//       Actual JSON repr:    "MARKER_test_U20000_\u0000_END"
//       char[0] = U+0000 (NUL!)
//
//     String "MARKER_test_U1D800_..."
//       Expected code point: U+1D800
//       Actual JSON repr:    "MARKER_test_U1D800_\ud800_END"
//       char[0] = U+D800 (SURROGATE!)
//
//     String "MARKER_test_U1DC00_..."
//       Expected code point: U+1DC00
//       Actual JSON repr:    "MARKER_test_U1DC00_\udc00_END"
//       char[0] = U+DC00 (SURROGATE!)
//
//     String "MARKER_test_U10022_..."
//       Expected code point: U+10022
//       Actual JSON repr:    "MARKER_test_U10022_\"_END"
//       char[0] = U+0022
//
//
// === CRASH: HEAP SNAPSHOT CONTAINS CORRUPTED UNICODE ===
// === 9 code points truncated, 9 strings corrupted, 12 lone surrogates, 5 NUL injections ===
//
// Root cause: WriteUChar() in src/profiler/heap-snapshot-generator.cc
// only outputs \uXXXX (16-bit) for code points that need
// \uXXXX\uXXXX surrogate pairs (code points >= U+10000).
//
// Security impact:
//   - Heap snapshots contain corrupted string data
//   - U+10000/U+20000 -> \u0000: NUL injection into JSON strings
//   - U+1D800 -> \uD800: lone surrogate violates RFC 8259
//   - U+10022 -> \u0022: truncates to quote character
//   - Chrome DevTools heap profiler shows garbled text
//   - Downstream JSON tools may crash on malformed surrogates
//
// (exit code 1)
// =============================================================================

'use strict';

const v8 = require('v8');
const fs = require('fs');
const path = require('path');

// === Test strings with supplementary Unicode characters ===

// Each entry: [codePoint, truncatedHex, correctSurrogatePair, description]
const TEST_CASES = [
  [0x1F600, 'F600', 'D83D\\uDE00', 'GRINNING FACE (emoji)'],
  [0x1F4A3, 'F4A3', 'D83D\\uDCA3', 'BOMB (emoji)'],
  [0x1D11E, 'D11E', 'D834\\uDD1E', 'MUSICAL SYMBOL G CLEF'],
  [0x1D400, 'D400', 'D835\\uDC00', 'MATHEMATICAL BOLD CAPITAL A'],
  [0x10000, '0000', 'D800\\uDC00', 'LINEAR B SYLLABLE B008A (first supplementary)'],
  [0x20000, '0000', 'D840\\uDC00', 'CJK UNIFIED IDEOGRAPH (first CJK-B)'],
  [0x1D800, 'D800', 'D836\\uDC00', 'truncates to LONE LEADING SURROGATE'],
  [0x1DC00, 'DC00', 'D837\\uDC00', 'truncates to LONE TRAILING SURROGATE'],
  [0x10022, '0022', 'D800\\uDC22', 'truncates to DOUBLE QUOTE (\\u0022)'],
];

// Create global objects so they appear in the heap snapshot
for (const [cp, , , desc] of TEST_CASES) {
  const key = 'test_U' + cp.toString(16).toUpperCase();
  globalThis[key] = 'MARKER_' + key + '_' + String.fromCodePoint(cp) + '_END';
}

// Force string interning
for (let i = 0; i < 100; i++) {
  JSON.stringify(Object.keys(globalThis).filter(k => k.startsWith('test_U')).map(k => globalThis[k]));
}

// === Take heap snapshot ===
console.log('=== V8 HEAP SNAPSHOT UNICODE CRASH TRACE ===');
console.log('Node.js version:', process.version);
console.log('V8 version:', process.versions.v8);
console.log('');

console.log('[1] Creating objects with supplementary Unicode characters...');
console.log('    Created', TEST_CASES.length, 'test strings with code points >= U+10000');
console.log('');

console.log('[2] Taking heap snapshot...');
const snapshotFile = path.join(require('os').tmpdir(), 'v8_unicode_crash_poc.heapsnapshot');
v8.writeHeapSnapshot(snapshotFile);
const raw = fs.readFileSync(snapshotFile, 'utf8');
console.log('    Snapshot:', raw.length, 'bytes');
console.log('');

// === Analyze corruption ===
console.log('[3] Analyzing JSON for WriteUChar truncation...');
console.log('');

let totalCorrupted = 0;
let totalLoneSurrogates = 0;
let totalNuls = 0;

for (const [cp, truncHex, correctPair, desc] of TEST_CASES) {
  const key = 'test_U' + cp.toString(16).toUpperCase();
  const marker = 'MARKER_' + key + '_';

  // Check for truncated encoding
  const truncPattern = '\\u' + truncHex;
  const correctLeadEsc = '\\u' + correctPair.substring(0, 4);

  // Search near the marker
  const markerIdx = raw.indexOf(marker);
  if (markerIdx < 0) continue;

  // Look at what follows the marker in the raw JSON
  const context = raw.substring(markerIdx, markerIdx + marker.length + 20);

  // Check if truncated encoding is present near the marker
  const hasTruncated = context.includes(truncPattern);
  // Check if correct surrogate pair is present
  const hasCorrect = context.includes(correctLeadEsc);

  if (hasTruncated && !hasCorrect) {
    totalCorrupted++;
    console.log('    CORRUPTED: U+' + cp.toString(16).toUpperCase(), '(' + desc + ')');
    console.log('               encoded as \\u' + truncHex, '(WRONG - truncated to 16-bit)');
    console.log('               should be  \\u' + correctPair, '(surrogate pair)');

    // Special cases
    if (truncHex === '0000') {
      totalNuls++;
      console.log('               *** NUL CHARACTER INJECTED ***');
    }
    if (parseInt(truncHex, 16) >= 0xD800 && parseInt(truncHex, 16) <= 0xDFFF) {
      totalLoneSurrogates++;
      console.log('               *** LONE SURROGATE - RFC 8259 VIOLATION ***');
    }
    if (truncHex === '0022') {
      console.log('               *** TRUNCATED TO DOUBLE QUOTE CHARACTER ***');
    }
    console.log('');
  } else if (hasCorrect) {
    console.log('    OK: U+' + cp.toString(16).toUpperCase(), '(' + desc + ') - correctly encoded');
  }
}

// Count all lone surrogates in the entire snapshot
const allLoneSurrogates = (raw.match(/\\u[Dd][89AaBb][0-9A-Fa-f]{2}(?!\\u[Dd][CcDdEeFf][0-9A-Fa-f]{2})/g) || []).length;
const allNuls = (raw.match(/\\u0000/g) || []).length;

console.log('    ---');
console.log('    Total lone surrogates in snapshot JSON:', allLoneSurrogates);
console.log('    Total NUL (\\u0000) in snapshot JSON:', allNuls);
console.log('');

// === Verify data corruption in parsed strings ===
console.log('[4] Verifying data corruption in parsed snapshot strings...');

const snapshot = JSON.parse(raw);
const strings = snapshot.strings || [];
let corruptedStrings = 0;

for (const [cp, , , desc] of TEST_CASES) {
  const key = 'test_U' + cp.toString(16).toUpperCase();
  const marker = 'MARKER_' + key + '_';

  for (const s of strings) {
    if (typeof s !== 'string' || !s.startsWith(marker)) continue;

    const hasCorrectChar = [...s].some(c => c.codePointAt(0) === cp);
    if (!hasCorrectChar) {
      corruptedStrings++;
      const actual = JSON.stringify(s);
      console.log('    String "' + marker + '..."');
      console.log('      Expected code point: U+' + cp.toString(16).toUpperCase());
      console.log('      Actual JSON repr:    ' + actual.substring(0, 80) + (actual.length > 80 ? '...' : ''));

      // Show what character was actually stored
      const endIdx = s.indexOf('_END');
      if (endIdx > 0) {
        const charSection = s.substring(marker.length, endIdx);
        for (let i = 0; i < charSection.length; i++) {
          console.log('      char[' + i + '] = U+' +
            charSection.charCodeAt(i).toString(16).toUpperCase().padStart(4, '0') +
            (charSection.charCodeAt(i) >= 0xD800 && charSection.charCodeAt(i) <= 0xDFFF ? ' (SURROGATE!)' : '') +
            (charSection.charCodeAt(i) === 0 ? ' (NUL!)' : ''));
        }
      }
      console.log('');
    }
    break;
  }
}

// === Final verdict ===
console.log('');
if (totalCorrupted > 0 || corruptedStrings > 0) {
  console.log('=== CRASH: HEAP SNAPSHOT CONTAINS CORRUPTED UNICODE ===');
  console.log('=== ' + totalCorrupted + ' code points truncated, ' +
    corruptedStrings + ' strings corrupted, ' +
    allLoneSurrogates + ' lone surrogates, ' +
    allNuls + ' NUL injections ===');
  console.log('');
  console.log('Root cause: WriteUChar() in src/profiler/heap-snapshot-generator.cc');
  console.log('only outputs \\uXXXX (16-bit) for code points that need');
  console.log('\\uXXXX\\uXXXX surrogate pairs (code points >= U+10000).');
  console.log('');
  console.log('Security impact:');
  console.log('  - Heap snapshots contain corrupted string data');
  console.log('  - U+10000/U+20000 -> \\u0000: NUL injection into JSON strings');
  console.log('  - U+1D800 -> \\uD800: lone surrogate violates RFC 8259');
  console.log('  - U+10022 -> \\u0022: truncates to quote character');
  console.log('  - Chrome DevTools heap profiler shows garbled text');
  console.log('  - Downstream JSON tools may crash on malformed surrogates');

  // Cleanup
  try { fs.unlinkSync(snapshotFile); } catch (e) { /* ignore */ }
  process.exit(1);
} else {
  console.log('=== PASS: All supplementary Unicode characters correctly encoded ===');
  console.log('(The WriteUChar fix is applied in this V8 build)');

  // Cleanup
  try { fs.unlinkSync(snapshotFile); } catch (e) { /* ignore */ }
  process.exit(0);
}
