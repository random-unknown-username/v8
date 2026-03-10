// Copyright 2026 the V8 project authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

// POC demonstrating the non-atomic weak reference pattern in
// WasmMemoryObject::UpdateInstances() at src/wasm/wasm-objects.cc.
//
// When WasmMemoryObject::Grow() is called, it calls UpdateInstances() to
// propagate the new buffer pointer to all instances that share the memory.
// UpdateInstances() walks the instances WeakArrayList, reading each entry.
//
// The concern: there is a TOCTOU pattern (Time-Of-Check, Time-Of-Use) between
// the IsCleared() check and GetHeapObjectAssumeWeak() call on the weak
// reference. In practice DisallowGarbageCollection prevents this locally, but
// the pattern is worth exercising under GC pressure with many instances.
//
// Additionally: this exercises the UpdateInstances() path for correctness,
// ensuring all sharing instances have their cached memory pointer updated
// correctly after grow.  The backing_store DCHECK at wasm-objects.cc:1090
//   DCHECK_EQ(backing_store, memory_object->backing_store())
// can fire if the backing_store is stale after the grow.
//
// Flags: --expose-gc

d8.file.execute('test/mjsunit/wasm/wasm-module-builder.js');

(function TestMemoryGrowWithManyInstances() {
  print(arguments.callee.name);

  // Build a module that imports and uses the shared memory.
  const builder = new WasmModuleBuilder();
  const memImportIdx = builder.addImportedMemory('env', 'mem', 1, 100);
  builder.addFunction('get_size', kSig_i_v)
      .addBody([kExprMemorySize, memImportIdx])
      .exportFunc();
  builder.addFunction('grow_mem', kSig_i_i)
      .addBody([kExprLocalGet, 0, kExprMemoryGrow, memImportIdx])
      .exportFunc();

  const memory = new WebAssembly.Memory({initial: 1, maximum: 100});
  const moduleBytes = builder.toBuffer();
  const wasmModule = new WebAssembly.Module(moduleBytes);

  // Create many instances all sharing the same memory object.
  // This populates the WeakArrayList inside the WasmMemoryObject.
  const N = 20;
  const instances = [];
  for (let i = 0; i < N; i++) {
    instances.push(new WebAssembly.Instance(wasmModule, {env: {mem: memory}}));
  }

  // Verify initial size from every instance.
  for (const inst of instances) {
    assertEquals(1, inst.exports.get_size());
  }

  // Grow the memory via the JS API. This calls WasmMemoryObject::Grow()
  // which calls UpdateInstances(), walking the WeakArrayList of all N instances.
  assertEquals(1, memory.grow(1));

  // Force GC to clear some weak references in the instances list.
  // This exercises the IsCleared() path in UpdateInstances.
  gc();

  // Grow again via WASM bytecode (calls Runtime_WasmMemoryGrow).
  // The in-wasm grow also goes through UpdateInstances.
  for (let i = 0; i < 3; i++) {
    const result = instances[0].exports.grow_mem(1);
    assertTrue(result >= 0, `grow failed at iteration ${i}: ${result}`);
  }

  // Verify all instances (that are still live) see the correct size.
  const expectedSize = memory.buffer.byteLength / 65536;
  for (const inst of instances) {
    assertEquals(expectedSize, inst.exports.get_size());
  }
})();

(function TestMemoryGrowNullifyInstances() {
  print(arguments.callee.name);

  const builder = new WasmModuleBuilder();
  const memImportIdx = builder.addImportedMemory('env', 'mem', 1, 50);
  builder.addFunction('get_size', kSig_i_v)
      .addBody([kExprMemorySize, memImportIdx])
      .exportFunc();

  const memory = new WebAssembly.Memory({initial: 1, maximum: 50});
  const wasmModule = new WebAssembly.Module(builder.toBuffer());

  // Create instances, then null some out to create entries for GC to clear.
  let instances = [];
  for (let i = 0; i < 15; i++) {
    instances.push(new WebAssembly.Instance(wasmModule, {env: {mem: memory}}));
  }

  // Null out every other instance reference so they become GC candidates.
  for (let i = 0; i < instances.length; i += 2) {
    instances[i] = null;
  }

  // Force GC - this clears the nulled-out weak references in the memory's
  // instances WeakArrayList.
  gc();

  // Grow memory. UpdateInstances walks the list with some IsCleared entries.
  assertEquals(1, memory.grow(1));

  // Remaining live instances should see the new size.
  const expectedPages = memory.buffer.byteLength / 65536;
  for (const inst of instances) {
    if (inst !== null) {
      assertEquals(expectedPages, inst.exports.get_size());
    }
  }
})();
