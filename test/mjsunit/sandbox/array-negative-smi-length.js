// Copyright 2026 the V8 project authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

// Sandbox regression test for variants of the negative-Smi array-length bug.
// A corrupted (sandbox-escaped) negative Smi length can flow into
// MoveElements/memmove with a huge count, causing a SIGSEGV.
//
// Variants covered:
//   1. array.shift()  -- TryFastArrayShift Torque fast path (newLength < 0
//      bypasses the signed kMaxCopyElements check, then MoveElements receives a
//      negative intptr which memmove interprets as ~16 exabytes).
//   2. array.pop()    -- RemoveElement C++ runtime path (Smi::ToUInt of a
//      negative Smi wraps to a huge uint32, which becomes new_length and the
//      memmove count).
//   3. array.unshift() -- AddArguments C++ runtime path (same Smi::ToUInt
//      wrapping; MoveElements called with the huge length).
//   4. array.splice()  -- FastArraySplice Torque path (negative originalLength
//      propagates to count = length - deleteCount - start < 0, causing the
//      same huge memmove).
//
// Flags: --sandbox-testing --expose-gc

const kJSArrayType = Sandbox.getInstanceTypeIdFor("JS_ARRAY_TYPE");
const kJSArrayLengthOffset = Sandbox.getFieldOffset(kJSArrayType, "length");

const memory = new DataView(new Sandbox.MemoryView(0, 0x100000000));

// Stable GC position so addresses don't move under us.
gc();
gc();

// Write a negative Smi into the length field of |arr|.
// Smi encoding (32-bit, pointer compression): raw bits = value << 1.
// Smi(-1) = 0xFFFFFFFE.  Smi::ToUInt() then yields 0xFFFFFFFF = 4 294 967 295,
// causing new_length = 4294967294 and a ~32 GB memmove before the fix.
function setNegativeLength(arr, smiValue) {
  const raw = (smiValue * 2) >>> 0;  // arithmetic Smi encoding, coerce uint32
  memory.setUint32(Sandbox.getAddressOf(arr) + kJSArrayLengthOffset, raw, true);
}

// ---------------------------------------------------------------------------
// Variant 1 – array.shift() Torque fast path (newLength < 0)
// ---------------------------------------------------------------------------
// The Torque fast path TryFastArrayShift computes newLength = array.length - 1
// which becomes a negative Smi.  The check `newLength > kMaxCopyElements` uses
// a SIGNED comparison so -2 > 100 is FALSE, and MoveElements receives -2 as
// an intptr_t, which memmove treats as ~16 EB.
{
  // Keep backing-store capacity small so the capacity back-pressure check
  // (newLength + newLength + kMinAddedElementsCapacity) < capacity does NOT
  // divert us to the Runtime label: -4 + 16 = 12, capacity = 3 < 12 is FALSE.
  const arr = [1.1, 2.2, 3.3];
  gc();
  gc();
  setNegativeLength(arr, -1);
  // Before fix: SIGSEGV inside witness.MoveElements with count = -2.
  // After fix: goto Runtime, RemoveElement's guard returns undefined safely.
  arr.shift();
}

// ---------------------------------------------------------------------------
// Variant 2 – array.pop() C++ runtime path (RemoveElement)
// ---------------------------------------------------------------------------
// When the fast-path exits to the C++ ArrayShift/ArrayPop runtime,
// RemoveElement reads length = Smi::ToUInt(negative_smi) = huge uint32, then
// calls dst_elms->MoveElements(isolate, 0, 1, new_length, mode) with
// new_length = 0xFFFFFFFE, causing a ~32 GB memmove before the fix.
{
  const arr = [1.1, 2.2, 3.3];
  gc();
  gc();
  setNegativeLength(arr, -1);
  // Before fix: SIGSEGV.  After fix: guard returns undefined.
  arr.pop();
}

// ---------------------------------------------------------------------------
// Variant 3 – array.unshift() C++ runtime path (AddArguments / AT_START)
// ---------------------------------------------------------------------------
// ArrayUnshift calls AddArguments(AT_START).  length = Smi::ToUInt(negative)
// = huge uint32; then MoveElements(isolate, add_size, 0, length, mode) copies
// 'length' (= 0xFFFFFFFF) elements before the fix.
{
  const arr = [1.1, 2.2, 3.3];
  gc();
  gc();
  setNegativeLength(arr, -1);
  // Before fix: SIGSEGV.  After fix: DCHECK_LE fires in debug; in release the
  // corrupted length is detected and the call proceeds on a short array.
  arr.unshift(99.9);
}

// ---------------------------------------------------------------------------
// Variant 4 – array.splice() Torque fast path (FastArraySplice)
// ---------------------------------------------------------------------------
// FastArraySplice casts originalLengthNumber to Smi, computes
// count = length - actualDeleteCount - actualStart.  With negative length,
// count is a large-negative Smi.  DoMoveElements(... count) calls
// TorqueMoveElements with a negative intptr → huge memmove before the fix.
{
  const arr = [1.1, 2.2, 3.3];
  gc();
  gc();
  setNegativeLength(arr, -1);
  // Before fix: SIGSEGV.  After fix: goto Bailout on negative originalLength.
  arr.splice(0, 0, 42.0);
}
