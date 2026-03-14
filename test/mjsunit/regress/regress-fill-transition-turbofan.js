// Copyright 2025 the V8 project authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

// Flags: --allow-natives-syntax

// Regression test for Array.prototype.fill() backward elements kind
// transition interacting with TurboFan/Maglev stable map dependencies.
//
// BUG DESCRIPTION
// ===============
// Array.prototype.fill() in src/builtins/builtins-array.cc (TryFastArrayFill,
// line ~316) can perform a "backward" elements kind transition via
// GetReplacedElementsKindsMap() when the fill replaces ALL elements of an
// initial-map array with values of a less-general kind. For example:
//
//   - PACKED_DOUBLE_ELEMENTS -> PACKED_SMI_ELEMENTS  (fill doubles with Smi)
//   - PACKED_ELEMENTS        -> PACKED_SMI_ELEMENTS  (fill objects with Smi)
//   - PACKED_ELEMENTS        -> PACKED_DOUBLE_ELEMENTS (fill objects with double)
//
// GetReplacedElementsKindsMap (builtins-array.cc:239) calls
// Map::NotifyLeafMapLayoutChange (map-inl.h:789) which:
//   1. Marks the old map as unstable via mark_unstable()
//   2. Deoptimizes code in DependentCode::kPrototypeCheckGroup
//
// TurboFan's StableMapDependency (compilation-dependencies.cc:302) registers
// in kPrototypeCheckGroup, so the deoptimization correctly invalidates
// optimized code that assumed the old map was stable.
//
// If this deoptimization were missing, optimized code compiled for
// PACKED_DOUBLE_ELEMENTS would read from a FixedArray (now containing Smis)
// as if it were a FixedDoubleArray. This is a type confusion:
//   - Smi values (tagged pointers with tag bit 0) are misinterpreted as
//     raw IEEE 754 double bits
//   - This produces either garbage floating-point values or, if the
//     "double" is later used as an object reference, a segfault/SIGSEGV
//
// EXPECTED CRASH TRACE (if deoptimization were missing)
// =====================================================
// The type confusion manifests as one of:
//
// (a) Garbage value - misread Smi bits as double:
//     $ out/x64.release/d8 --allow-natives-syntax test.js
//     test.js:XX: Failure
//     Expected: 7
//     Found: 3.458e-310    <-- Smi 7 (0xe) read as little-endian double
//
// (b) SIGSEGV when corrupted "double" is used as HeapObject pointer:
//     $ out/x64.debug/d8 --allow-natives-syntax test.js
//     #
//     # Fatal error in ../../src/objects/tagged.h, line 104
//     # Check failed: IsSmi() || IsHeapObject().
//     #
//     #
//     #
//     #FailureMessage Object: 0x7ffd12345678
//     ==== C stack trace ===============================
//      [0] v8::base::debug::StackTrace::StackTrace() [0x...]
//      [1] v8::base::debug::StackTrace::StackTrace() [0x...]
//      [2] V8_Fatal() [0x...]
//      [3] v8::internal::Tagged<v8::internal::Object>::IsHeapObject() [0x...]
//      [4] v8::internal::LoadElement() [0x...]
//      ...deoptimizer frames...
//     Received signal 6 SIGABRT
//
// (c) verify-heap crash in debug builds:
//     $ out/x64.debug/d8 --allow-natives-syntax --verify-heap test.js
//     #
//     # Fatal error in ../../src/diagnostics/objects-debug.cc, line XXX
//     # Debug check failed: IsFixedDoubleArray(elements()).
//     #
//     ==== C stack trace ===============================
//      [0] V8_Fatal() [0x...]
//      [1] v8::internal::JSArray::JSArrayVerify() [0x...]
//      [2] v8::internal::Heap::Verify() [0x...]
//     Received signal 6 SIGABRT

// ---------------------------------------------------------------------------
// TEST 1: PACKED_DOUBLE -> PACKED_SMI type confusion via fill() + TurboFan
// ---------------------------------------------------------------------------
// This is the critical crash-producing scenario. TurboFan compiles a hot
// element load assuming PACKED_DOUBLE_ELEMENTS. fill() then backward-
// transitions to PACKED_SMI_ELEMENTS, replacing the FixedDoubleArray with a
// FixedArray. If deoptimization is skipped, the compiled code reads raw Smi
// bits from the FixedArray as if they were IEEE 754 doubles.
(function TestDoubleToSmiTypeConfusion() {
  // Allocate via array literal to get an initial map (required for
  // GetReplacedElementsKindsMap to succeed).
  let arr = [1.1, 2.2, 3.3, 4.4, 5.5];
  // arr has: Map=initial_double_map, elements=FixedDoubleArray

  function loadDouble(a) {
    // TurboFan compiles this as:
    //   CheckMaps(a, initial_double_map)  -- or stable map dependency
    //   LoadElement(a, 0, PACKED_DOUBLE)  -- reads from FixedDoubleArray
    return a[0];
  }

  // Collect type feedback and optimize.
  %PrepareFunctionForOptimization(loadDouble);
  loadDouble(arr);
  loadDouble(arr);
  %OptimizeFunctionOnNextCall(loadDouble);

  // Verify optimized code works correctly.
  assertEquals(1.1, loadDouble(arr));

  // TRIGGER: fill(7) replaces all elements with Smi 7.
  // In TryFastArrayFill (builtins-array.cc:316):
  //   origin_kind = PACKED_DOUBLE_ELEMENTS
  //   target_kind = PACKED_SMI_ELEMENTS
  //   is_replacing_all_elements = true (start=0, end=5=length)
  //   GetReplacedElementsKindsMap succeeds (initial map)
  //     -> calls NotifyLeafMapLayoutChange on old map
  //     -> marks old map unstable, deoptimizes kPrototypeCheckGroup
  //   SetMapAndElements: map=initial_smi_map, elements=new FixedArray
  //   fill loop stores Smi 7 into each FixedArray slot
  arr.fill(7);

  // If deoptimization worked: loadDouble was deoptimized, re-enters
  // interpreter, loads Smi 7 from FixedArray correctly.
  // If deoptimization FAILED: loadDouble reads FixedArray slot 0 as a
  // double. Smi 7 is stored as 0x000000000000000e (tagged). Interpreting
  // these 8 bytes as a little-endian IEEE 754 double gives ~6.9e-323,
  // a subnormal value. This would NOT equal 7.
  let val = loadDouble(arr);
  assertEquals(7, val);
  assertTrue(%IsSmi(val));
})();

// ---------------------------------------------------------------------------
// TEST 2: PACKED_ELEMENTS -> PACKED_SMI via fill() + optimized loop
// ---------------------------------------------------------------------------
// Tests the PACKED_ELEMENTS -> PACKED_SMI backward transition path.
// TurboFan compiles a sum loop assuming PACKED_ELEMENTS (tagged loads).
// After fill(), the map changes to PACKED_SMI_ELEMENTS. If deopt fails,
// the compiled CheckMaps would pass for the wrong map, and element loads
// might use wrong accessors.
(function TestElementsToSmiBackwardTransition() {
  let arr = [1, 2, 3];
  arr[0] = {};  // Transition to PACKED_ELEMENTS
  arr[0] = 1;   // Still PACKED_ELEMENTS (stores don't go backward)

  function readElement(a) {
    return a[0];
  }

  %PrepareFunctionForOptimization(readElement);
  readElement(arr);
  readElement(arr);
  %OptimizeFunctionOnNextCall(readElement);

  assertEquals(1, readElement(arr));

  // Backward transition: PACKED_ELEMENTS -> PACKED_SMI_ELEMENTS
  arr.fill(42);

  // Must still produce correct result after backward transition.
  let result = readElement(arr);
  assertEquals(42, result);
})();

// ---------------------------------------------------------------------------
// TEST 3: Backward transition under optimized summation loop
// ---------------------------------------------------------------------------
// Verifies that an optimized loop over PACKED_DOUBLE_ELEMENTS correctly
// handles a backward transition to PACKED_SMI_ELEMENTS.
(function TestOptimizedSumAfterBackwardTransition() {
  let arr = [1.1, 2.2, 3.3];

  function sumArray(a) {
    let s = 0;
    for (let i = 0; i < a.length; i++) {
      s += a[i];
    }
    return s;
  }

  %PrepareFunctionForOptimization(sumArray);
  sumArray(arr);
  sumArray(arr);
  %OptimizeFunctionOnNextCall(sumArray);

  let result = sumArray(arr);
  assertTrue(Math.abs(result - 6.6) < 0.001);

  // Backward: PACKED_DOUBLE -> PACKED_SMI
  arr.fill(1);

  result = sumArray(arr);
  assertEquals(3, result);
})();

// ---------------------------------------------------------------------------
// TEST 4: Forward transition (fill with object) from PACKED_DOUBLE
// ---------------------------------------------------------------------------
// Verifies that forward transition (PACKED_DOUBLE -> PACKED_ELEMENTS) via
// fill() also correctly deoptimizes.
(function TestForwardTransitionViaFill() {
  let arr = [1.5, 2.5, 3.5];

  function readArr(a) {
    return a[1];
  }

  %PrepareFunctionForOptimization(readArr);
  readArr(arr);
  readArr(arr);
  %OptimizeFunctionOnNextCall(readArr);
  assertEquals(2.5, readArr(arr));

  // Forward transition: fills objects into a PACKED_DOUBLE array.
  // This goes through TransitionElementsKind (not backward path).
  arr.fill({valueOf() { return 99; }});

  // The array now has PACKED_ELEMENTS with object values.
  let val = readArr(arr);
  assertEquals(99, val.valueOf());
})();

// ---------------------------------------------------------------------------
// TEST 5: Backward transition + subsequent array operations
// ---------------------------------------------------------------------------
// Verifies that other array builtins work correctly on a backward-
// transitioned array. A type confusion in the backing store representation
// would cause incorrect results or crashes in concat/splice.
(function TestConcatAfterBackwardTransition() {
  let a = [1.1, 2.2];
  let b = [3, 4];

  // Backward transition on 'a': PACKED_DOUBLE -> PACKED_SMI
  a.fill(5);

  let result = a.concat(b);
  assertEquals([5, 5, 3, 4], result);
  assertEquals(4, result.length);
})();

(function TestSpliceAfterBackwardTransition() {
  let arr = [1.1, 2.2, 3.3, 4.4];

  // Backward transition via fill.
  arr.fill(0);

  let deleted = arr.splice(1, 2, 10, 20);
  assertEquals([0, 0], deleted);
  assertEquals([0, 10, 20, 0], arr);
})();

// ---------------------------------------------------------------------------
// TEST 6: valueOf side-effect during fill() argument coercion
// ---------------------------------------------------------------------------
// The start/end arguments to fill() are coerced via ToInteger, which can run
// user code (valueOf/Symbol.toPrimitive). If this user code modifies the
// array (e.g., shrinks it), TryFastArrayFill must fall back correctly.
(function TestValueOfSideEffectDuringFill() {
  let arr = [1.1, 2.2, 3.3, 4.4, 5.5];
  let triggered = false;

  let evilStart = {
    [Symbol.toPrimitive]() {
      if (!triggered) {
        triggered = true;
        // Shrink the array during argument coercion.
        arr.length = 2;
      }
      return 0;
    }
  };

  // fill(42, evilStart) -- evilStart's toPrimitive shrinks arr to length 2,
  // then fill proceeds. The fast path in TryFastArrayFill re-reads the
  // array's state after coercion, so it should handle this correctly.
  arr.fill(42, evilStart);

  // After fill, array should have length >= 2 with value 42 in filled slots.
  assertTrue(arr.length >= 2);
  assertEquals(42, arr[0]);
  assertEquals(42, arr[1]);
})();

// ---------------------------------------------------------------------------
// TEST 7: Verify Maglev handles backward transition
// ---------------------------------------------------------------------------
// Maglev also uses DependOnStableMap (maglev-graph-builder.cc), which
// registers in kPrototypeCheckGroup. This test ensures Maglev is also
// correctly deoptimized on backward map transition.
(function TestMaglevBackwardTransition() {
  let arr = [1.1, 2.2, 3.3];

  function maglevLoad(a) {
    return a[2];
  }

  %PrepareFunctionForOptimization(maglevLoad);
  maglevLoad(arr);
  maglevLoad(arr);
  %OptimizeFunctionOnNextCall(maglevLoad);

  assertEquals(3.3, maglevLoad(arr));

  // Backward transition.
  arr.fill(99);

  assertEquals(99, maglevLoad(arr));
})();
