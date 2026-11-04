/*
 * INSPECTOR TESTS
 * DESCRIPTION: Tests the shared unapplied-preview confirmation dialog.
 * PROCESS: Tests (Node.js)
 */

// ---------- Imports ----------

import test from "node:test";
import assert from "node:assert/strict";

// ---------- Tests ----------

test("the shared preview dialog offers apply, discard, and Back for each operation", async () => {
  const elements = new Map();
  const control = (selector) => {
    if (!elements.has(selector)) {
      elements.set(selector, {
        textContent: "", returnValue: "", open: false,
        addEventListener(_type, listener) { this.onClose = listener; },
        showModal() { this.open = true; },
        focus() { this.focused = true; },
        close(value = "") {
          this.open = false;
          this.returnValue = value;
          this.onClose();
        },
      });
    }
    return elements.get(selector);
  };
  const previousDocument = globalThis.document;
  globalThis.document = { querySelector: control, querySelectorAll: () => [] };
  try {
    const inspector = await import("../src/renderer/ui/inspector.js");
    for (const operation of ["save", "export", "continue"]) {
      for (const choice of ["apply", "discard", "back", ""]) {
        const result = inspector.confirmAppearancePreview(operation);
        const title = operation.charAt(0).toUpperCase() + operation.slice(1);
        const expectedTitle = operation === "continue"
          ? "Continue with unapplied change?"
          : `${title} unapplied change?`;
        assert.equal(control("#appearance-preview-title").textContent, expectedTitle);
        assert.equal(control("#preview-back-button").focused, true);
        for (const action of ["apply", "discard"]) {
          const label = `${action.charAt(0).toUpperCase() + action.slice(1)} & ${operation}`;
          assert.equal(control(`#preview-${action}-button`).textContent, label);
        }
        control("#appearance-preview-dialog").close(choice);
        assert.equal(await result, choice || "back");
      }
    }
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});
