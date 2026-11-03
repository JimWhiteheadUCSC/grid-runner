'use strict';

// Wraps a single QuickJS sandbox running one loaded VFX program. Each
// instance owns its own QuickJSRuntime + context (a fresh sandbox per
// program); swapping programs means disposing one instance and loading
// another. See docs/VFX_API.md for the contract this enforces and
// prelude.js for the injected stdlib.

const fs = require('fs');
const path = require('path');
const { newQuickJSWASMModule, shouldInterruptAfterDeadline } = require('quickjs-emscripten');

const PRELUDE_SOURCE = fs.readFileSync(path.join(__dirname, 'prelude.js'), 'utf8');

const MEMORY_LIMIT_BYTES = 16 * 1024 * 1024;
// Generous multiple of the 20ms frame budget: this is a sandbox crash
// guard against runaway loops, not the frame-budget enforcement itself
// (this player doesn't enforce that budget). Widened from
// 4x on real Pi 4 hardware: QuickJS-as-WASM is considerably slower there
// than on a typical dev machine, and a pixel-mode effect computing all
// 4096 pixels per frame (plasma_bloom.js) tripped the old 80ms guard on
// a legitimately-just-slow frame, not a runaway loop — it killed the
// entire program on the first frame that ran long. Still bounded (a
// genuine infinite loop is caught well under a second), just no longer
// tuned to dev-machine timing alone.
const INTERRUPT_BUDGET_MS = 20 * 15;

// One shared WASM module for the process's lifetime, holding many
// short-lived QuickJSRuntime instances (one per loaded program) - not
// the package's own internal getQuickJS() singleton, deliberately: we
// need the ability to discard and rebuild this specific promise (see
// resetQuickJSModule below), which an opaque package-level singleton
// wouldn't let us do.
let quickjsModulePromise = null;
function loadQuickJS() {
  if (!quickjsModulePromise) quickjsModulePromise = newQuickJSWASMModule();
  return quickjsModulePromise;
}

// A runtime that exhausts memory can leave the *shared module's*
// underlying WASM linear memory permanently wedged, even after that
// runtime is disposed - WASM linear memory only grows, never shrinks.
// Observed for real: after one 90-minute single-effect run hit an
// allocation failure, every subsequent load in the same process failed
// with "memory access out of bounds" from newRuntime() itself, forever
// - not a script bug, the shared module was unusable. Call this to
// discard it; the next loadQuickJS() call builds a genuinely fresh
// module (a real WebAssembly instance with its own fresh linear
// memory), not a retry of the wedged one.
function resetQuickJSModule() {
  quickjsModulePromise = null;
}

class VfxRuntime {
  constructor(rt, context, frameFn, setInputFn, mode, meta) {
    this.rt = rt;
    this.context = context;
    this.frameFn = frameFn;
    this.setInputFn = setInputFn;
    this.mode = mode;
    this.meta = meta;
    this.disposed = false;
  }

  // Loads `source` (a full VFX program, frontmatter and all — the
  // frontmatter is a plain JS block comment, so QuickJS ignores it same
  // as any JS engine) into a fresh sandbox and runs its setup().
  static async load(source) {
    const quickjs = await loadQuickJS();

    let rt;
    let context;
    try {
      rt = quickjs.newRuntime();
      rt.setMemoryLimit(MEMORY_LIMIT_BYTES);
      context = rt.newContext();
    } catch (err) {
      // Failure here is the shared module itself, not this program's
      // source - see resetQuickJSModule's comment. Recover for next
      // time rather than dooming every future load in this process.
      resetQuickJSModule();
      throw err;
    }

    try {
      context.unwrapResult(context.evalCode(PRELUDE_SOURCE, 'prelude.js')).dispose();
      context.unwrapResult(context.evalCode(source, 'program.js')).dispose();

      const modeHandle = context.unwrapResult(
        context.evalCode(
          "__mode = (typeof render === 'function') ? 'buffer' : 'pixel'; __mode",
          'mode-detect.js'
        )
      );
      const mode = context.getString(modeHandle);
      modeHandle.dispose();

      const metaHandle = context.unwrapResult(
        context.evalCode("JSON.stringify(typeof meta !== 'undefined' ? meta : {})", 'meta.js')
      );
      const meta = JSON.parse(context.getString(metaHandle));
      metaHandle.dispose();

      const setupHandle = context.getProp(context.global, 'setup');
      if (context.typeof(setupHandle) === 'function') {
        context.unwrapResult(context.callFunction(setupHandle, context.undefined)).dispose();
      }
      setupHandle.dispose();

      const frameFn = context.getProp(context.global, '__vfxFrame');
      const setInputFn = context.getProp(context.global, '__vfxSetInput');

      return new VfxRuntime(rt, context, frameFn, setInputFn, mode, meta);
    } catch (err) {
      context.dispose();
      rt.dispose();
      throw err;
    }
  }

  // Runs one frame and returns a fresh Uint8Array of WIDTH*HEIGHT*3 bytes
  // (RGB, row-major). This is the single per-frame sandbox crossing:
  // one callFunction in, the framebuffer's ArrayBuffer read back out.
  renderFrame(t, dt) {
    if (this.disposed) throw new Error('VfxRuntime already disposed');

    this.rt.setInterruptHandler(shouldInterruptAfterDeadline(Date.now() + INTERRUPT_BUDGET_MS));

    const tHandle = this.context.newNumber(t);
    const dtHandle = this.context.newNumber(dt);
    let bufferHandle;
    try {
      bufferHandle = this.context.unwrapResult(
        this.context.callFunction(this.frameFn, this.context.undefined, tHandle, dtHandle)
      );
    } finally {
      tHandle.dispose();
      dtHandle.dispose();
    }

    const bufferLifetime = this.context.getArrayBuffer(bufferHandle);
    bufferHandle.dispose();
    const copy = new Uint8Array(bufferLifetime.value); // defensive copy, decoupled from VM memory
    // getArrayBuffer's Lifetime wraps a native _malloc'd buffer that only
    // this dispose() frees (see its disposer in quickjs-emscripten-core).
    // Missing this call was THE actual leak behind the OOM/wedged-module
    // saga: ~12KB (one framebuffer) leaked natively per frame, forever,
    // confirmed by an A/B RSS test - identical code with and without this
    // dispose() call showed linear growth vs. flat.
    bufferLifetime.dispose();
    return copy;
  }

  // Merges a patch into the sandbox's `input` object, one group at a time,
  // e.g. `setInput({ audio: { level: 0.5 } })`.
  setInput(patch) {
    if (this.disposed) throw new Error('VfxRuntime already disposed');
    const jsonHandle = this.context.newString(JSON.stringify(patch));
    try {
      this.context.unwrapResult(
        this.context.callFunction(this.setInputFn, this.context.undefined, jsonHandle)
      ).dispose();
    } finally {
      jsonHandle.dispose();
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.frameFn.dispose();
    this.setInputFn.dispose();
    this.context.dispose();
    this.rt.dispose();
  }
}

module.exports = { VfxRuntime };
