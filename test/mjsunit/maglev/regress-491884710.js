// Copyright 2026 the V8 project authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.
//
// Flags: --maglev --allow-natives-syntax --maglev-untagged-phis --verify-heap

const kNonSmiInt32 = 0x40000000;

function foo(init, switch_to_non_smi, choose_loop_phi) {
  let loop_phi = init;
  for (let i = 0; i < 2; ++i) {
    if (switch_to_non_smi && i === 1) {
      loop_phi = kNonSmiInt32;
    } else {
      loop_phi += 1;
    }
  }

  // Keep Smi feedback on the optimized path during warmup.
  loop_phi += 0;

  let phi = choose_loop_phi ? loop_phi : 42;
  // This should not silently truncate non-Smi values.
  phi += 2;
  return phi;
}

%PrepareFunctionForOptimization(foo);
assertEquals(44, foo(5, false, false));
assertEquals(9, foo(5, false, true));

%OptimizeMaglevOnNextCall(foo);
assertEquals(44, foo(5, false, false));

// If the backedge Smi requirement is lost during phi untagging, this path can
// be miscompiled. It must safely produce an Int32 result.
assertEquals(kNonSmiInt32 + 2, foo(5, true, true));
