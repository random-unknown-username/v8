// Copyright 2025 the V8 project authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

// Flags: --allow-natives-syntax

// Regression test for Array.prototype.fill() backward elements kind
// transition interacting with TurboFan's stable map dependency.
//
// Array.prototype.fill() can perform a "backward" elements kind transition
// (e.g., PACKED_ELEMENTS -> PACKED_SMI_ELEMENTS) when filling an object-kind
// array with Smi values. This must properly invalidate TurboFan's stable map
// dependencies to prevent type confusion in optimized code.

(function TestFillBackwardTransitionDeopt() {
  // Create an array that transitions to PACKED_ELEMENTS.
  let arr = [1, 2, 3];
  arr[0] = {};  // Transition to PACKED_ELEMENTS
  arr[0] = 1;   // Still PACKED_ELEMENTS (no backward transition here)

  function readElement(a) {
    // TurboFan will inline this and potentially rely on a stable map
    // for PACKED_ELEMENTS, eliminating CheckMaps.
    return a[0];
  }

  // Warm up with PACKED_ELEMENTS feedback.
  %PrepareFunctionForOptimization(readElement);
  readElement(arr);
  readElement(arr);
  %OptimizeFunctionOnNextCall(readElement);
  let result = readElement(arr);
  assertEquals(1, result);

  // Now fill with Smis - this triggers backward transition
  // PACKED_ELEMENTS -> PACKED_SMI_ELEMENTS.
  arr.fill(42);

  // The optimized code should either:
  // 1. Deoptimize due to map change (if stable map dependency was used), or
  // 2. Still work correctly via CheckMaps (if runtime check was used).
  // It must NOT read with wrong type assumptions.
  result = readElement(arr);
  assertEquals(42, result);
})();

(function TestFillBackwardTransitionWithDoubles() {
  // Create a PACKED_DOUBLE_ELEMENTS array.
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
  // Approximate check for doubles.
  assertTrue(Math.abs(result - 6.6) < 0.001);

  // Fill with Smi - backward transition PACKED_DOUBLE -> PACKED_SMI
  arr.fill(1);

  // Must still produce correct results after transition.
  result = sumArray(arr);
  assertEquals(3, result);
})();

(function TestFillIntoleranceOfTypeConfusion() {
  // This tests the critical path: TurboFan compiles code assuming
  // PACKED_DOUBLE_ELEMENTS, then fill() changes to PACKED_SMI_ELEMENTS.
  // A type confusion here would read Smi tag bits as double mantissa bits.
  let arr = [1.1, 2.2, 3.3, 4.4, 5.5];

  function getFirst(a) {
    return a[0];
  }

  %PrepareFunctionForOptimization(getFirst);
  getFirst(arr);
  getFirst(arr);
  %OptimizeFunctionOnNextCall(getFirst);

  assertEquals(1.1, getFirst(arr));

  // Backward transition via fill.
  arr.fill(7);

  // After backward transition, getFirst must return Smi 7, not garbage.
  // If type confusion occurred, this would return a corrupt double value
  // or crash when interpreting the Smi as a HeapObject pointer.
  let val = getFirst(arr);
  assertEquals(7, val);
  assertTrue(%IsSmi(val));
})();

(function TestFillCallbackInteraction() {
  // Test that valueOf in fill's argument doesn't cause issues when
  // combined with TurboFan optimization.
  let arr = [1.5, 2.5, 3.5];
  let callCount = 0;

  function readArr(a) {
    return a[1];
  }

  %PrepareFunctionForOptimization(readArr);
  readArr(arr);
  readArr(arr);
  %OptimizeFunctionOnNextCall(readArr);
  assertEquals(2.5, readArr(arr));

  // Fill with an object that has valueOf - this coercion happens before
  // the fill loop, but transitions the array to PACKED_ELEMENTS.
  arr.fill({valueOf() { callCount++; return 99; }});

  // The array now contains objects, not doubles.
  let val = readArr(arr);
  // The fill stores the object itself, not the valueOf result.
  assertEquals(99, val.valueOf());
})();

(function TestConcatAfterBackwardTransition() {
  // Test concat with arrays that underwent backward transition.
  let a = [1.1, 2.2];
  let b = [3, 4];

  // Backward transition on 'a'.
  a.fill(5);

  // Concat should handle the mixed/transitioned arrays correctly.
  let result = a.concat(b);
  assertEquals([5, 5, 3, 4], result);
  assertEquals(4, result.length);
})();

(function TestSpliceAfterBackwardTransition() {
  let arr = [1.1, 2.2, 3.3, 4.4];

  function spliceAndReturn(a) {
    return a.splice(1, 2, 10, 20);
  }

  %PrepareFunctionForOptimization(spliceAndReturn);
  // Use a fresh array each time for warmup.
  spliceAndReturn([1.1, 2.2, 3.3, 4.4]);
  spliceAndReturn([1.1, 2.2, 3.3, 4.4]);
  %OptimizeFunctionOnNextCall(spliceAndReturn);

  // Backward transition via fill.
  arr.fill(0);

  // Splice on the backward-transitioned array.
  let deleted = arr.splice(1, 2, 10, 20);
  assertEquals([0, 0], deleted);
  assertEquals([0, 10, 20, 0], arr);
})();
