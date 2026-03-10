// Copyright 2026 the V8 project authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

// POC demonstrating DCHECK(!native_module->lazy_compile_frozen()) in
// src/wasm/module-compiler.cc:CompileLazy().
//
// When --wasm-lazy-compilation is enabled, WASM functions are compiled
// on first call (JIT). The %FreezeWasmLazyCompilation() runtime function
// sets a flag (lazy_compile_frozen_) that disallows further lazy compilations.
//
// If a function that has NOT been compiled yet is called after the freeze,
// CompileLazy() will DCHECK, because the freeze asserts that no new lazy
// compilations should happen. This path is reachable from JavaScript via
// --allow-natives-syntax.
//
// To trigger:
//   out/x64.debug/d8 \
//     --wasm-lazy-compilation \
//     --allow-natives-syntax \
//     test/mjsunit/regress/poc-wasm-lazy-compile-frozen-dcheck.js
//
// Expected: DCHECK(!native_module->lazy_compile_frozen()) fails in
// src/wasm/module-compiler.cc (line 1148).
//
// Flags: --wasm-lazy-compilation --allow-natives-syntax

d8.file.execute('test/mjsunit/wasm/wasm-module-builder.js');

(function TestLazyCompileFrozenDcheck() {
  print(arguments.callee.name);

  const builder = new WasmModuleBuilder();

  // func0: This function WILL be called before freeze (compiles eagerly via lazy).
  builder.addFunction('compiled_before_freeze', kSig_i_v)
      .addBody([kExprI32Const, 42])
      .exportFunc();

  // func1: This function will NOT be called before freeze, so it remains
  // uncompiled (lazy). Calling it after freeze triggers the DCHECK.
  builder.addFunction('not_yet_compiled', kSig_i_v)
      .addBody([kExprI32Const, 99])
      .exportFunc();

  const instance = builder.instantiate();

  // Call func0 now so it gets lazy-compiled.
  assertEquals(42, instance.exports.compiled_before_freeze());

  // Confirm func1 has NOT been compiled yet.
  assertTrue(%IsUncompiledWasmFunction(instance.exports.not_yet_compiled));

  // Freeze lazy compilation on the instance. No further compilations allowed.
  %FreezeWasmLazyCompilation(instance);

  // Now call func1 which is NOT compiled. This must trigger lazy compilation
  // but lazy compilation is frozen => DCHECK fires.
  // In debug builds this crashes with:
  //   DCHECK(!native_module->lazy_compile_frozen())
  // at src/wasm/module-compiler.cc:1148.
  const result = instance.exports.not_yet_compiled();
  assertEquals(99, result);
})();
