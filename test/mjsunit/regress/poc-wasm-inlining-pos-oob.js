// Copyright 2026 the V8 project authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.
//
// POC: GetInliningPosition reads past end of inlining_positions buffer
//
// BUG: src/wasm/wasm-code-manager.cc
//   std::tuple<int, bool, SourcePosition> WasmCode::GetInliningPosition(
//       int inlining_id) const {
//     const size_t elem_size = sizeof(int) + sizeof(bool) + sizeof(SourcePosition);
//     const uint8_t* start = inlining_positions().begin() + elem_size * inlining_id;
//     DCHECK_LE(start, inlining_positions().end());  // <-- WRONG: only checks start, not start+elem_size
//     std::memcpy(&std::get<0>(result), start, sizeof std::get<0>(result));  // OOB if start == end
//     ...
//
// The DCHECK should be:
//   DCHECK_LE(start + elem_size, inlining_positions().end());
//
// The existing check only verifies that `start <= end`, but does NOT verify
// that `elem_size` more bytes are available from `start`. If `inlining_id`
// equals exactly the number of inlining entries (one-past-end), then
// `start == end`, the DCHECK passes, but the subsequent memcpy() reads
// `elem_size` bytes of garbage beyond the allocated buffer.
//
// TRIGGER CONDITIONS:
//   Requires WASM code where the source positions table contains an inlining_id
//   equal to the total number of inlined function entries (one-past-end).
//   This can happen with crafted serialized WASM code:
//
//   1. Compile and serialize a WASM module that has inlined functions.
//   2. Modify the serialized bytes so a source position entry references
//      inlining_id = N (where N = number of inlined functions).
//   3. Deserialize the module and trigger stack trace generation for
//      an inlined call (e.g., throw inside an inlined function).
//
// IMPACT:
//   - In debug builds: the DCHECK_LE(start, end) passes (because start == end)
//     but memcpy reads sizeof(int) + sizeof(bool) + sizeof(SourcePosition)
//     bytes beyond the buffer. Subsequent DCHECKs may fire due to garbage data.
//   - In release builds: silent out-of-bounds read; garbage source position
//     data can cause incorrect stack traces or further memory corruption.
//
// NOTE: This POC documents the bug and explains the trigger condition.
// A full exploit requires crafting serialized WASM bytes (see wasm-serialization.cc).

d8.file.execute('test/mjsunit/wasm/wasm-module-builder.js');

// Build a module that will be inlined when compiled with TurboFan.
// The inlining POC is demonstrated by the structural bug, not by a live crash,
// because the compiler normally enforces inlining_id < num_inlined_entries.
const builder = new WasmModuleBuilder();

const callee = builder.addFunction('callee', kSig_i_v).addBody([
  kExprI32Const, 42,
]);

const caller = builder.addFunction('caller', kSig_i_v)
  .addBody([kExprCallFunction, callee.index])
  .exportFunc();

const bytes = builder.toBuffer();
const mod = new WebAssembly.Module(bytes);
const inst = new WebAssembly.Instance(mod, {});

// Trigger tier-up (TurboFan compilation with inlining).
// With --wasm-inlining enabled (default), 'callee' will be inlined into 'caller'.
// The resulting WasmCode will have inlining_positions for the inlined callee.
%WasmTierUpFunction(inst, caller.index);

// At this point, WasmCode::GetInliningPosition(0) correctly reads inlining entry 0.
// GetInliningPosition(1) would be the one-past-end OOB read.
// The DCHECK_LE(start, end) passes for GetInliningPosition(1) (start == end),
// but the memcpy reads beyond the buffer.
print("Module compiled. See GetInliningPosition DCHECK_LE bug in wasm-code-manager.cc");
