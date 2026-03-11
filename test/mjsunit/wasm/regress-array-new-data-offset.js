// Copyright 2026 the V8 project authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

// Flags: --allow-natives-syntax

// Regression test for a missing segment_source.offset() in
// ConstantExpressionInterface::ArrayNewSegment.
//
// Bug: The constant-expression code path computed the source pointer as:
//   source = wire_bytes() + offset
// instead of:
//   source = wire_bytes() + segment_source.offset() + offset
//
// This reads from the wrong location in the module binary (from byte
// position `offset` in the full module, instead of byte position `offset`
// within the specific data segment).
//
// The runtime path (Runtime_WasmArrayNewSegment in runtime-wasm.cc) has
// the correct computation:
//   source = wire_bytes() + segment_source.offset() + offset
//
// Currently, array.new_data is blocked in constant expressions by
// NON_CONST_ONLY (tracked by TODO(14034)). This test validates the
// function-body path. When the feature is enabled in constant expressions,
// uncomment the global-initializer variant below.

d8.file.execute("test/mjsunit/wasm/wasm-module-builder.js");

(function TestArrayNewDataSegmentOffset() {
  print(arguments.callee.name);

  let builder = new WasmModuleBuilder();
  let array_type_index = builder.addArray(kWasmI32, true);

  // Data segment with known i32 values (little-endian):
  //   [0xAA000000, 0xBB000000, 0xCC000000]
  let data_segment = builder.addPassiveDataSegment([
    0xAA, 0x00, 0x00, 0x00,  // 170
    0xBB, 0x00, 0x00, 0x00,  // 187
    0xCC, 0x00, 0x00, 0x00,  // 204
  ]);

  // Uses Runtime_WasmArrayNewSegment (correct path).
  builder.addFunction("init_from_data", kSig_i_iii)
    .addBody([
      kExprLocalGet, 0,
      kExprLocalGet, 1,
      kGCPrefix, kExprArrayNewData, array_type_index, data_segment,
      kExprLocalGet, 2,
      kGCPrefix, kExprArrayGet, array_type_index])
    .exportFunc();

  let instance = builder.instantiate();
  let init = instance.exports.init_from_data;

  // Validate correct data is read from the segment.
  assertEquals(0xAA, init(0, 3, 0));
  assertEquals(0xBB, init(0, 3, 1));
  assertEquals(0xCC, init(0, 3, 2));

  // With a non-zero offset into the segment.
  assertEquals(0xBB, init(4, 2, 0));
  assertEquals(0xCC, init(4, 2, 1));

  // TODO(14034): Enable when array.new_data is allowed in constant
  // expressions. The bug in ConstantExpressionInterface::ArrayNewSegment
  // would cause wrong values to be read here.
  //
  // let builder2 = new WasmModuleBuilder();
  // let arr_type = builder2.addArray(kWasmI32, true);
  // let seg = builder2.addPassiveDataSegment([
  //   0xAA, 0x00, 0x00, 0x00,
  //   0xBB, 0x00, 0x00, 0x00,
  // ]);
  // let g = builder2.addGlobal(
  //   wasmRefType(arr_type), false, false,
  //   [...wasmI32Const(0), ...wasmI32Const(2),
  //    kGCPrefix, kExprArrayNewData, arr_type, seg]);
  // builder2.addFunction("get", kSig_i_i)
  //   .addBody([
  //     kExprGlobalGet, g.index,
  //     kExprLocalGet, 0,
  //     kGCPrefix, kExprArrayGet, arr_type])
  //   .exportFunc();
  // let inst2 = builder2.instantiate();
  // assertEquals(0xAA, inst2.exports.get(0));
  // assertEquals(0xBB, inst2.exports.get(1));
})();
