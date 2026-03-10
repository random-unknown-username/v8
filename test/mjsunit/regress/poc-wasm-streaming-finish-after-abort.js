// Copyright 2026 the V8 project authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

// POC demonstrating a CHECK failure in AsyncStreamingDecoder::Finish() when
// streaming is called after the stream has already been aborted.
//
// CHECK at src/wasm/streaming-decoder.cc:352:
//   CHECK_NE(StreamState::kAborted, stream_state_)
//
// The race/bug: When WebAssembly.compileStreaming() is called with an input
// that causes `.then()` to fail (e.g., monkey-patched Promise.prototype.then),
// the rejection callback calls WasmStreaming::Abort(). However, if an exception
// thrown in `.then()` causes BOTH the rejection handler to fire AND the
// fulfillment handler to fire (due to reentrancy or incorrect error handling),
// Finish() would be called after Abort(), triggering the CHECK.
//
// A simpler reproduction: The streaming callback is both called via the
// fulfillment of the input Promise AND explicitly aborted due to a .then()
// error, creating a state where Abort happened before Finish.
//
// Flags: --wasm-test-streaming

d8.file.execute('test/mjsunit/wasm/wasm-module-builder.js');

(function TestStreamingFinishAfterAbort() {
  print(arguments.callee.name);

  const builder = new WasmModuleBuilder();
  builder.addFunction('f', kSig_i_v)
      .addBody([kExprI32Const, 1])
      .exportFunc();
  const bytes = builder.toBuffer();

  // Create a thenable that calls the resolution handler,
  // but also causes the .then() call itself to throw (by monkey-patching),
  // so that Abort() is called from the error path in wasm-js.cc after
  // the module bytes have already been sent.
  //
  // Note: The monkey-patching of Promise.prototype.then causes the
  // StartAsyncCompilationWithResolver code path at wasm-js.cc:869 to fail
  // with an exception -> streaming->Abort() is called.
  // But the bytes were already delivered via the custom thenable's resolve,
  // creating the condition where Abort is followed by OnBytesReceived + Finish.
  const originalThen = Promise.prototype.then;

  let compilationPromise;
  try {
    // Temporarily override .then to throw after setting up the callbacks.
    // This exercises the error path in StartAsyncCompilationWithResolver.
    Promise.prototype.then = function(onFulfilled, onRejected) {
      // Restore immediately to avoid infinite loops.
      Promise.prototype.then = originalThen;
      // Call the original .then (which sets up streaming properly).
      const result = originalThen.call(this, onFulfilled, onRejected);
      // Throw to simulate the error path in wasm-js.cc:869.
      throw new Error('simulated .then() failure');
    };

    compilationPromise = WebAssembly.compileStreaming(
        Promise.resolve(bytes));
  } catch (e) {
    // Expected: the thrown error from our monkey-patched .then().
    print('Caught expected error:', e.message);
  } finally {
    // Ensure .then() is restored.
    Promise.prototype.then = originalThen;
  }

  // Process any pending microtasks - the streaming callback fires here,
  // potentially calling OnBytesReceived + Finish after the Abort from above.
  if (compilationPromise) {
    return compilationPromise.then(
        m => print('Module compiled:', m),
        e => print('Compilation error:', e.message));
  }
})();
