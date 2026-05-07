# WebAssembly Security Audit Findings

## Methodology
Deep source-code review of the V8 WebAssembly subsystem, focusing on:
- `src/wasm/turboshaft-graph-interface.cc` (Turboshaft compiler)
- `src/wasm/baseline/liftoff-compiler.cc` (Liftoff baseline compiler)
- `src/builtins/wasm.tq` (Torque builtins)
- `src/runtime/runtime-wasm.cc` (Runtime functions)
- `src/wasm/wasm-external-refs.cc` (C++ wrappers)
- `src/wasm/constant-expression-interface.cc` (Constant expression evaluator)
- `src/compiler/turboshaft/wasm-lowering-reducer.h` (Wasm lowering)

## Areas Investigated

### 1. Array bounds checking (array.copy, array.fill, array.get, array.set)
- Turboshaft `BoundsCheckArrayWithLength` correctly checks both overflow and OOB
- Liftoff `ArrayFill` bounds check correctly detects overflow via separate comparison
- `array_copy_wrapper` overlap detection is correct
- `array_fill_wrapper` CHECK_GE(bytes_to_set, 8) is safe because callers ensure length >= 16

### 2. Memory base caching across memory.grow
- Instance cache correctly tracks `memory_can_move_` and reloads on grow
- For non-zero memories (multi-memory), loads use `TaggedBase()` which is invalidated by calls
- `MemSize` for non-zero memories correctly uses `NotLoadEliminable()`

### 3. Integer overflow in size calculations
- `WasmAllocateArray` bounds length against `MaxLength` before multiplication
- `MaxLength` is designed so that `length * element_size` fits in ~2^30
- `MemCopyBoundsCheck` uses bitwise AND of all conditions, safe against underflow

### 4. GC safety in runtime functions
- `Runtime_WasmArrayCopy` uses `DisallowGarbageCollection`
- `EncodeWtf8` uses `DisallowGarbageCollection` scope around raw pointer access
- `String::Flatten` is called before entering no-GC scope

### 5. Constant expression interface
- Indices (segment, global, function) are validated by the decoder before reaching
  the constant-expression-interface, so DCHECKs are defense-in-depth, not the primary check

### 6. String view WTF-8 operations
- `AlignWtf8PositionForward` correctly returns `length` for out-of-bounds positions
- `WasmStringViewWtf8Advance` arithmetic is safe due to bounded clamped positions

## Conclusion
No reliably exploitable vulnerability was confirmed through this source code review.
V8's wasm implementation has robust bounds checking, proper GC safety patterns,
and careful integer arithmetic throughout the reviewed code paths.
