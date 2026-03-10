// Copyright 2026 the V8 project authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

// POC for the double-remove bug in WasmEngine::RemoveCompileJob()
// tracked at crbug.com/466449860.
//
// When a context is discarded while an async compile job is still running,
// the job may already have been removed from the job map by the completion
// callback before DeleteCompileJobsOnContext() attempts to remove it again,
// leading to a CHECK_NE failure:
//
//   CHECK_NE(async_compile_jobs_.end(), item);  // in RemoveCompileJob()
//
// Steps to reproduce the race:
//   1. Start an async WebAssembly.compile() on a module (many functions).
//   2. Concurrently force a GC that collects the context that owns the Promise.
//   3. The compile job may finish and call RemoveCompileJob() just before
//      DeleteCompileJobsOnContext() also tries to remove the same job.
//
// This test exercises the race window by:
//   - Running many parallel async compilations.
//   - Triggering GC while they are in-flight so the holding context can be
//     collected, causing DeleteCompileJobsOnContext to race with finish.
//
// Flags: --wasm-async-compilation --expose-gc

d8.file.execute("test/mjsunit/wasm/wasm-module-builder.js");

function buildLargeModule() {
  const builder = new WasmModuleBuilder();
  builder.addMemory(1, 10);
  // Add many functions to make compilation take longer, widening the race
  // window between DeleteCompileJobsOnContext and the job's own completion.
  for (let i = 0; i < 50; i++) {
    builder.addFunction('f' + i, kSig_i_i)
        .addBody([
          kExprLocalGet, 0,
          kExprI32Const, i & 0x7f,
          kExprI32Add,
        ])
        .exportFunc();
  }
  return builder.toBuffer();
}

const moduleBytes = buildLargeModule();

// Start many async compilations concurrently so that some are still in-flight
// when we force GC below.
const promises = [];
for (let round = 0; round < 5; round++) {
  for (let i = 0; i < 10; i++) {
    promises.push(WebAssembly.compile(moduleBytes));
  }
  // Interleave GC to attempt to collect the context and trigger
  // DeleteCompileJobsOnContext while jobs are running.
  gc();
}

// Await all promises to ensure we don't silently swallow failures.
assertPromiseResult(Promise.allSettled(promises).then(results => {
  for (const r of results) {
    if (r.status === 'fulfilled') {
      assertInstanceof(r.value, WebAssembly.Module);
    }
    // Rejections (e.g. OOM) are acceptable; crashes/CHECKs are not.
  }
}));
