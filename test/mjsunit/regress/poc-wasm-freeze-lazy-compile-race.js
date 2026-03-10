// Copyright 2026 the V8 project authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

// POC demonstrating a DATA RACE when FreezeWasmLazyCompilation is called
// on a NativeModule that is shared between two isolates (Web Workers).
//
// When two isolates share the same NativeModule (via WebAssembly.Module
// postMessage), and one isolate calls %FreezeWasmLazyCompilation() while
// the other is concurrently calling/compiling functions, there is an
// unsynchronized read/write on NativeModule::lazy_compile_frozen_.
//
// The race:
//   Isolate A: Calls %FreezeWasmLazyCompilation(instance)
//              -> Sets native_module->lazy_compile_frozen_ = true (non-atomic)
//   Isolate B: In worker thread, calls an uncompiled wasm function
//              -> CompileLazy() reads native_module->lazy_compile_frozen_ (non-atomic)
//              -> Data race! Could read a torn/stale value.
//              -> If the DCHECK fires: DCHECK(!native_module->lazy_compile_frozen())
//
// This is documented in test/mjsunit/mjsunit.status:
//   "The {FreezeWasmLazyCompilation} runtime function sets a flag in the
//    native module, which causes a data-race if the native module is shared
//    between isolates."
//
// To trigger:
//   out/x64.debug/d8 \
//     --wasm-lazy-compilation \
//     --allow-natives-syntax \
//     test/mjsunit/regress/poc-wasm-freeze-lazy-compile-race.js
//
// Flags: --wasm-lazy-compilation --allow-natives-syntax

d8.file.execute('test/mjsunit/wasm/wasm-module-builder.js');

// Build a module with many lazy-compiled functions.
// These functions are NOT called before being transferred, so they remain
// uncompiled (lazy) when the worker receives the module.
const builder = new WasmModuleBuilder();
for (let i = 0; i < 20; i++) {
  builder.addFunction('f' + i, kSig_i_v)
      .addBody([kExprI32Const, i])
      .exportFunc();
}
// Compile once (sync) to get a WebAssembly.Module that can be postMessage'd.
const wasmModule = new WebAssembly.Module(builder.toBuffer());

// Worker code: Instantiate the shared module and rapidly call all functions.
// This triggers lazy compilation of functions that haven't been called yet.
// If the main thread has frozen lazy compilation, DCHECK fires.
const workerCode = `
  onmessage = function({data: mod}) {
    const instance = new WebAssembly.Instance(mod);
    // Rapidly call all exported functions to trigger lazy compilation.
    for (let round = 0; round < 10; round++) {
      for (const fname of Object.keys(instance.exports)) {
        instance.exports[fname]();
      }
    }
    postMessage('done');
  };
`;

const worker = new Worker(workerCode, {type: 'string'});

// Send the module to the worker - NativeModule is shared between both isolates.
worker.postMessage(wasmModule);

// On main thread: instantiate and freeze lazy compilation while worker
// is concurrently compiling functions.
const instance = new WebAssembly.Instance(wasmModule);

// Small delay to let worker start compiling (racing window).
// Freeze the shared NativeModule - this sets lazy_compile_frozen_ without
// any synchronization with the worker's concurrent compilations.
%FreezeWasmLazyCompilation(instance);

// Optionally call some functions from main thread too (may trigger DCHECK).
try {
  for (const fname of Object.keys(instance.exports)) {
    instance.exports[fname]();
  }
} catch (e) {
  print('Exception from main thread:', e);
}

// Wait for worker to finish.
print(worker.getMessage());
worker.terminate();
