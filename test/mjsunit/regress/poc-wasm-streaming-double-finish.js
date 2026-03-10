// Copyright 2026 the V8 project authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

// POC demonstrating the CHECK failure at streaming-decoder.cc:351:
//   CHECK_NE(StreamState::kFinished, stream_state_)
//
// This fires when AsyncStreamingDecoder::Finish() is called twice on the
// same streaming decoder instance. The bug was tracked at crbug.com/462888125.
//
// The scenario: WebAssembly.compileStreaming() is passed a thenable whose
// Promise.prototype.then is monkey-patched to call the fulfillment handler
// twice. V8's WasmStreamingCallbackForTesting (the fulfillment handler) calls
// streaming->OnBytesReceived() + streaming->Finish() on each invocation.
// The second call to Finish() hits CHECK_NE(StreamState::kFinished, stream_state_).
//
// To trigger:
//   out/x64.debug/d8 \
//     --wasm-test-streaming \
//     test/mjsunit/regress/poc-wasm-streaming-double-finish.js
//
// Flags: --wasm-test-streaming

d8.file.execute('test/mjsunit/wasm/wasm-module-builder.js');

(function TestStreamingDoubleFinish() {
  print(arguments.callee.name);

  const builder = new WasmModuleBuilder();
  builder.addFunction('f', kSig_i_v)
      .addBody([kExprI32Const, 42])
      .exportFunc();
  const bytes = builder.toBuffer();

  const originalThen = Promise.prototype.then;

  // Override Promise.prototype.then to call the fulfillment handler twice.
  // The first call is normal. The second call triggers CHECK_NE(kFinished).
  Promise.prototype.then = function(onFulfilled, onRejected) {
    // Restore immediately to prevent infinite loops from Promise internals.
    Promise.prototype.then = originalThen;

    // Schedule the callback twice.
    return originalThen.call(this, function(value) {
      // First call: normal compile path -> OnBytesReceived + Finish
      if (typeof onFulfilled === 'function') {
        onFulfilled(value);
        // Second call: stream_state_ is now kFinished.
        // Calling the streaming callback again calls Finish() again.
        // CHECK_NE(StreamState::kFinished, stream_state_) fires.
        onFulfilled(value);
      }
    }, onRejected);
  };

  const p = WebAssembly.compileStreaming(Promise.resolve(bytes));

  // Restore in case we get here (shouldn't in practice, CHECK kills the process).
  Promise.prototype.then = originalThen;

  assertPromiseResult(p.then(
      m => { assertInstanceof(m, WebAssembly.Module); print('OK'); },
      e => { print('Error:', e); }
  ));
})();
