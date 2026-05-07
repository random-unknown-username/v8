// Copyright 2026 the V8 project authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

// Sandbox regression test for variants of the array shift negative-length
// integer overflow bug. When an attacker corrupts the length of a JSArray to
// a negative Smi value, calling array.shift() or array.unshift() would invoke
// MoveElements with a uint32_t length that, when implicitly cast to int inside
// CopyOrMoveRangeImpl, became negative, and was then passed as a size_t to
// MemMove, causing an approximately 32 GB out-of-bounds copy (SIGSEGV / sandbox bypass).
//
// The fix adds SBXCHECK_LE guards in RemoveElement (shift/pop) and
// AddArguments (unshift) to validate the array length before use, and changes
// the CopyOrMoveRangeImpl parameter type from int to uint32_t to eliminate the
// implicit signed/unsigned conversion.

// Flags: --sandbox-testing --expose-gc

if (!Sandbox) throw new Error('not in sandbox testing mode');

const kJSArrayType = Sandbox.getInstanceTypeIdFor('JS_ARRAY_TYPE');
const kJSArrayLengthOffset = Sandbox.getFieldOffset(kJSArrayType, 'length');

const memory = new DataView(new Sandbox.MemoryView(0, 0x100000000));

// Smi(-1) encoded as a 32-bit Smi: raw = (-1) << 1 = 0xFFFFFFFE.
// When decoded via Smi::ToUInt in RemoveElement/AddArguments this yields
// uint32_t(0xFFFFFFFF), a value far above Smi::kMaxValue.
const kNegativeSmiLength = 0xFFFFFFFE;

// ---- Variant 1: array.shift() with negative (corrupted) length ----
// Without fix: new_length = 0xFFFFFFFE, MoveElements(0xFFFFFFFE) -> MemMove
// of ~32 GB (SIGSEGV outside the sandbox).
// With fix: SBXCHECK_LE terminates the process safely before MoveElements.
{
  // Promote the array to old generation so that CanMoveObjectStart()
  // returns false, forcing the MoveElements path in RemoveElement.
  const arr = [1, 2, 3, 4, 5];
  gc();
  gc();
  const addr = Sandbox.getAddressOf(arr);
  memory.setUint32(addr + kJSArrayLengthOffset, kNegativeSmiLength, true);
  arr.shift();
}

// ---- Variant 2: array.unshift() with negative (corrupted) length ----
// In AddArguments, new_length = length + add_size overflows uint32_t to 0,
// so the existing backing store appears sufficient and MoveElements is called
// with the raw corrupted length (0xFFFFFFFF), causing the same crash.
// With fix: SBXCHECK_LE terminates the process safely.
{
  const arr = [1, 2, 3, 4, 5];
  gc();
  gc();
  const addr = Sandbox.getAddressOf(arr);
  memory.setUint32(addr + kJSArrayLengthOffset, kNegativeSmiLength, true);
  arr.unshift(42);
}
