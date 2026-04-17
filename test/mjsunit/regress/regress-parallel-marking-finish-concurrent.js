// Copyright 2026 the V8 project authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

// Regression test for a bug where FinishConcurrentMarking() was not called in
// MarkLiveObjects() when concurrent marking was running but parallel marking
// was disabled. This caused a CHECK(heap_->concurrent_marking()->IsStopped())
// failure at the start of the serial marking phase.
//
// Flags: --no-parallel-marking --concurrent-marking

// Create enough heap pressure to trigger incremental marking and a full GC.
// The key is that concurrent marking starts during incremental marking, and
// when the atomic pause begins with --no-parallel-marking, FinishConcurrentMarking()
// must still be called before the serial marking phase.

var objs = [];
for (var i = 0; i < 100; i++) {
  var obj = {};
  for (var j = 0; j < 100; j++) {
    obj['prop' + j] = { value: i * 100 + j, data: new Array(10).fill(i) };
  }
  objs.push(obj);
}

// Create WeakMaps with ephemerons to exercise the ephemeron worklists,
// which is the primary path through MarkTransitiveClosureFixpoint.
var wm = new WeakMap();
for (var i = 0; i < 50; i++) {
  var key = objs[i];
  var val = objs[(i + 1) % 50];
  wm.set(key, val);
}

// Let go of some references to force GC to collect them.
objs = null;
