// Copyright 2026 the V8 project authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.
//
// POC: Reader::ReadVector<T> checks element count instead of byte count
//
// BUG: src/wasm/wasm-serialization.cc
//   template <typename T>
//   base::Vector<const T> ReadVector(size_t size) {
//     DCHECK_GE(current_size(), size);             // <-- WRONG
//     base::Vector<const uint8_t> bytes{pos_, size * sizeof(T)};
//     pos_ += size * sizeof(T);
//     ...
//   }
//
// The DCHECK checks that `current_size() >= size` (element count), but the
// actual read consumes `size * sizeof(T)` bytes. For any T where sizeof(T) > 1,
// the DCHECK passes even when there are insufficient bytes in the buffer,
// and the subsequent read advances `pos_` by `size * sizeof(T)` bytes beyond
// the valid buffer range.
//
// CORRECT DCHECK should be:
//   DCHECK_GE(current_size(), size * sizeof(T));
//
// CURRENT STATE: All existing callers use T = uint8_t (sizeof = 1), so the
// bug is latent and not currently exploitable. However, if a new caller is
// added using T = uint32_t or larger, it would immediately allow out-of-bounds
// reads from serialized WASM data without triggering the DCHECK in debug builds.
//
// EXAMPLE OF FUTURE VULNERABILITY:
//   If someone adds: reader->ReadVector<uint32_t>(n)
//   - DCHECK checks: current_size() >= n          (passes if n bytes available)
//   - Actual read:   pos_ += n * 4                (reads 4n bytes, needs 4n)
//   - OOB for:       current_size() in [n, 4n-1]
//
// HOW TO TRIGGER THE DCHECK AS-IS (once a new caller with T != uint8_t is added):
//   Craft WASM serialized bytes where the buffer is truncated after the
//   header fields but before the full payload expected by a ReadVector<T> call.
//   Deserialize via: new WebAssembly.Module(WebAssembly.Module.serialize(mod))
//   with replaced bytes, or via the --compilation-cache flag.
//
// REPRODUCTION:
//   This is a latent bug; the DCHECK fires only with non-uint8_t callers.
//   The fix is a one-line change in wasm-serialization.cc.

d8.file.execute('test/mjsunit/wasm/wasm-module-builder.js');

const builder = new WasmModuleBuilder();
builder.addImport('imports', 'fn', makeSig([], [kWasmI32]));
builder.addFunction('main', kSig_i_v)
  .addBody([kExprCallFunction, 0])
  .exportFunc();

const bytes = builder.toBuffer();
const mod = new WebAssembly.Module(bytes);

// Serialize the module to show the code path that exercises ReadVector<T>.
// In debug builds, if ReadVector<T> with T != uint8_t is ever called,
// the DCHECK_GE(current_size(), size) would incorrectly pass even with
// insufficient bytes.
if (typeof WebAssembly.Module.serialize === 'function') {
  const serialized = WebAssembly.Module.serialize(mod);
  print(`Serialized ${serialized.byteLength} bytes.`);
  print('ReadVector<T> DCHECK bug: DCHECK_GE(current_size(), size) should be');
  print('DCHECK_GE(current_size(), size * sizeof(T)) in wasm-serialization.cc');
}
