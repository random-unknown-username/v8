// Copyright 2026 the V8 project authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

// POC demonstrating the DCHECK inside WasmDispatchTable::Grow() at
// src/wasm/wasm-objects.cc:
//
//   DCHECK_EQ(instance->dispatch_tables()->get(table_index), *old_table);
//   DCHECK_EQ(instance->dispatch_table0(), *old_table);   // if table_index == 0
//
// When a WASM function table grows and needs a larger dispatch table
// (new_length > old_capacity), WasmDispatchTable::Grow() allocates a new
// WasmDispatchTable and updates all instances that use the old table.
//
// The DCHECKs assert that each instance still has the old dispatch table
// in its dispatch_tables array and dispatch_table0 field at the point of
// the update.
//
// This POC exercises the path with many instances sharing an imported table,
// forcing the table to grow and iterating the uses WeakFixedArray.
// It also exercises the weak-reference clearing path (IsCleared entries).
//
// Flags: --expose-gc

d8.file.execute('test/mjsunit/wasm/wasm-module-builder.js');

(function TestDispatchTableGrowWithManyInstances() {
  print(arguments.callee.name);

  // Build a module with an exported/imported function table.
  const builderExporter = new WasmModuleBuilder();
  const tableIdx = builderExporter.addTable(kWasmAnyFunc, 2, 20);
  builderExporter.addExportOfKind('table', kExternalTable, tableIdx);
  builderExporter.addFunction('f', kSig_i_v)
      .addBody([kExprI32Const, 42])
      .exportFunc();
  const exporterInst = builderExporter.instantiate();
  const sharedTable = exporterInst.exports.table;

  // Build an importer module that imports the table and uses call_indirect.
  const builderImporter = new WasmModuleBuilder();
  const importedTableIdx = builderImporter.addImportedTable(
      'env', 'table', 2, 20, kWasmAnyFunc);
  const sigIdx = builderImporter.addType(kSig_i_v);
  builderImporter.addFunction('call_f', kSig_i_i)
      .addBody([
        kExprLocalGet, 0,
        kExprCallIndirect, sigIdx, importedTableIdx,
      ])
      .exportFunc();

  const importerModule = new WebAssembly.Module(builderImporter.toBuffer());

  // Create many instances all importing the same table.
  // This registers each instance in the table's protected_uses WeakFixedArray.
  const instances = [];
  for (let i = 0; i < 10; i++) {
    instances.push(new WebAssembly.Instance(importerModule,
        {env: {table: sharedTable}}));
  }

  // Set table entry 0 to the exported function.
  sharedTable.set(0, exporterInst.exports.f);

  // All instances can call through the table.
  for (const inst of instances) {
    assertEquals(42, inst.exports.call_f(0));
  }

  // Null out some instances so they become GC candidates.
  // Their weak entries in protected_uses will be cleared by GC.
  for (let i = 0; i < instances.length; i += 3) {
    instances[i] = null;
  }
  gc();

  // Now grow the table past its initial capacity.
  // This triggers WasmDispatchTable::Grow() which allocates a new dispatch
  // table and iterates protected_uses (now with some IsCleared entries).
  // The DCHECK asserts that live instances still have *old_table.
  sharedTable.grow(8, null);

  // Remaining live instances should still work correctly.
  for (const inst of instances) {
    if (inst !== null) {
      assertEquals(42, inst.exports.call_f(0));
    }
  }
})();
