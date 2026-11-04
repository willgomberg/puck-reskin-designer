/*
 * UPDATE DIALOG TESTS
 * DESCRIPTION: Tests progress, retry, dismissal, and explicit browser actions.
 * PROCESS: Tests (Node.js)
 */

// ---------- Imports and fixtures ----------

import test from "node:test";
import assert from "node:assert/strict";

let moduleId = 0;
async function withDialog(actions, run) {
  const elements = new Map();
  function control(id) {
    if (!elements.has(id)) {
      const listeners = new Map();
      elements.set(id, {
        dataset: {}, open: false,
        addEventListener: (type, listener) => listeners.set(type, listener),
        focus() { this.focused = true; },
        showModal() { this.open = true; },
        close() { this.open = false; },
        fire(type) { return listeners.get(type)?.(); },
      });
    }
    return elements.get(id);
  }
  const previousDocument = globalThis.document;
  globalThis.document = { querySelector: (selector) => control(selector.slice(1)) };
  try {
    const dialog = await import(`../src/renderer/ui/update-dialog.js?test=${++moduleId}`);
    dialog.connectUpdateDialog(actions);
    await run(dialog, control);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
}

// ---------- Dialog interactions ----------

test("checking is dismissible, prevents duplicate requests, and never reopens after close", async () => {
  let complete;
  let requests = 0;
  await withDialog({ check: () => { requests += 1; return new Promise((resolve) => { complete = resolve; }); } }, async (dialog, control) => {
    const checking = dialog.openUpdateDialog();
    assert.equal(dialog.isUpdateDialogOpen(), true);
    assert.match(control("update-message").textContent, /Checking GitHub/);
    assert.equal(control("update-close").focused, true);
    assert.equal(control("update-open-release").hidden, true);
    await dialog.openUpdateDialog();
    assert.equal(requests, 1);
    control("update-close").fire("click");
    complete({ status: "current", installedVersion: "0.1.0", availableVersion: "0.1.0" });
    await checking;
    assert.equal(dialog.isUpdateDialogOpen(), false);
  });
});

test("newer versions show both versions and open the browser only on explicit click", async () => {
  let opens = 0;
  await withDialog({
    check: async () => ({ status: "available", installedVersion: "0.1.0", availableVersion: "0.2.0" }),
    openReleasePage: async () => { opens += 1; return { status: "opened" }; },
  }, async (dialog, control) => {
    await dialog.openUpdateDialog();
    assert.equal(control("update-open-release").hidden, false);
    assert.match(control("update-versions").textContent, /Installed: 0.1.0 · Available: 0.2.0/);
    assert.equal(opens, 0);
    await control("update-open-release").fire("click");
    assert.equal(opens, 1);
  });
});

test("current result has no release-page action", async () => {
  await withDialog({ check: async () => ({ status: "current", installedVersion: "0.2.0", availableVersion: "0.1.0" }) }, async (dialog, control) => {
    await dialog.openUpdateDialog();
    assert.equal(control("update-message").textContent, "No newer release is available.");
    assert.equal(control("update-open-release").hidden, true);
  });
});

test("request errors show honest failure and Try Again recovers", async () => {
  for (const rejects of [false, true]) {
    let requests = 0;
    await withDialog({ check: async () => {
      if (++requests > 1) return { status: "current", installedVersion: "0.1.0", availableVersion: "0.1.0" };
      if (rejects) throw new Error("Bridge unavailable");
      return { status: "error", message: "Timed out" };
    } }, async (dialog, control) => {
      await dialog.openUpdateDialog();
      assert.equal(control("update-message").textContent, "Could not check for updates.");
      assert.equal(control("update-error").hidden, false);
      assert.equal(control("update-retry").hidden, false);
      await control("update-retry").fire("click");
      assert.equal(control("update-error").hidden, true);
      assert.equal(control("update-retry").hidden, true);
      assert.equal(control("update-message").textContent, "No newer release is available.");
    });
  }
});

test("failed browser action keeps the result and allows another click", async () => {
  let opens = 0;
  await withDialog({
    check: async () => ({ status: "available", installedVersion: "0.1.0", availableVersion: "0.2.0" }),
    openReleasePage: async () => ++opens === 1 ? { status: "error", message: "Could not open browser" } : { status: "opened" },
  }, async (dialog, control) => {
    await dialog.openUpdateDialog();
    await control("update-open-release").fire("click");
    assert.equal(control("update-error").textContent, "Could not open browser");
    assert.equal(control("update-open-release").disabled, false);
    await control("update-open-release").fire("click");
    assert.equal(control("update-error").hidden, true);
    assert.equal(dialog.isUpdateDialogOpen(), true);
  });
});
