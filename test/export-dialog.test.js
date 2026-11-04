/*
 * EXPORT DIALOG TESTS
 * DESCRIPTION: Tests export controls and competing game-folder requests.
 * PROCESS: Tests (Node.js)
 */

// ---------- Imports and fixtures ----------

import test from "node:test";
import assert from "node:assert/strict";

let moduleId = 0;

function createPendingRequest() {
  let resolve;
  let reject;
  const promise = new Promise((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

// Only the dialog controls used by these interactions need a DOM stand-in
async function withExportDialog(actions, run) {
  const elements = new Map();
  function getElement(selector) {
    if (!elements.has(selector)) {
      const listeners = new Map();
      elements.set(selector, {
        value: "", checked: false, open: false, hidden: false,
        dataset: {},
        addEventListener: (type, listener) => listeners.set(type, listener),
        replaceChildren() {},
        append() {},
        focus() { this.wasFocused = true; },
        showModal() { this.open = true; },
        close() { this.open = false; this.fire("close"); },
        fire(type, target = this) {
          return listeners.get(type)?.({ target, preventDefault() {} });
        },
      });
    }
    return elements.get(selector);
  }

  const previousDocument = globalThis.document;
  globalThis.document = {
    querySelector: getElement,
    createElement: () => ({ value: "", textContent: "" }),
  };
  try {
    const dialog = await import(`../src/renderer/ui/export-dialog.js?test=${++moduleId}`);
    dialog.connectExportDialog(actions);
    await run(dialog, (id) => getElement(`#${id}`));
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
}

function packState(gameFolder) {
  return { gameFolder, packs: [], defaultFolderName: null };
}

// ---------- Tests ----------

test("a manual folder choice wins over an earlier automatic lookup", async () => {
  const automatic = createPendingRequest();
  await withExportDialog({
    loadPacks: () => automatic.promise,
    setGameFolder: async (path) => packState(path),
  }, async (dialog, control) => {
    const opening = dialog.openExportDialog();
    control("export-location-input").value = "manual/Puck";
    await control("export-location-use").fire("click");
    automatic.resolve(packState("automatic/Puck"));
    await opening;
    assert.equal(control("export-location-input").value, "manual/Puck");
    assert.equal(control("export-location-status").textContent, "✓ Puck folder found. No need to touch this field.");
    assert.equal(control("png-export-form").inert, false);
  });
});

test("a late automatic failure does not replace a confirmed manual choice", async () => {
  const automatic = createPendingRequest();
  await withExportDialog({
    loadPacks: () => automatic.promise,
    setGameFolder: async (path) => packState(path),
  }, async (dialog, control) => {
    const opening = dialog.openExportDialog();
    control("export-location-input").value = "manual/Puck";
    await control("export-location-use").fire("click");
    automatic.reject(new Error("Old lookup failed"));
    await opening;
    assert.equal(control("export-dialog-error").hidden, true);
    assert.equal(control("export-location-status").textContent, "✓ Puck folder found. No need to touch this field.");
  });
});

test("confirmed folders collapse, while changed paths keep guidance and validation", async () => {
  await withExportDialog({
    loadPacks: async () => packState("original/Puck"),
    setGameFolder: async (path) => packState(path),
  }, async (dialog, control) => {
    await dialog.openExportDialog();
    assert.equal(control("export-location-controls").hidden, true);
    assert.equal(control("export-location-status").dataset.type, "success");
    control("export-location-change").fire("click");
    assert.equal(control("export-location-controls").hidden, false);
    assert.equal(control("export-location-input").wasFocused, true);
    control("export-location-input").value = "another/Puck";
    control("png-export-form").fire("input", control("export-location-input"));
    assert.equal(control("export-location-help").hidden, false);
    assert.equal(control("export-location-status").dataset.type, "");
    assert.equal(control("export-dialog-submit").disabled, true);
    await control("export-location-use").fire("click");
    assert.equal(control("export-location-controls").hidden, true);
    assert.equal(control("export-dialog-submit").disabled, false);
  });
});

test("missing folders and failed discovery expose folder controls and help", async () => {
  for (const loadPacks of [
    async () => packState(""),
    async () => { throw new Error("Discovery failed"); },
  ]) {
    await withExportDialog({ loadPacks }, async (dialog, control) => {
      await dialog.openExportDialog();
      assert.equal(control("export-location-controls").hidden, false);
      assert.equal(control("export-location-help").hidden, false);
      assert.equal(control("export-location-change").hidden, true);
      assert.equal(control("export-dialog-submit").disabled, true);
    });
  }
});

test("pack fields follow existing defaults and preserve values when switching", async () => {
  for (const defaultFolderName of [null, "my-pack"]) {
    await withExportDialog({
      loadPacks: async () => ({
        gameFolder: "original/Puck",
        packs: [{ folderName: "my-pack", name: "My pack", valid: true }],
        defaultFolderName,
      }),
    }, async (dialog, control) => {
      await dialog.openExportDialog();
      assert.equal(control("export-pack-select").hidden, !defaultFolderName);
      // DOM stand-in does not implement native radio-group exclusivity
      control("export-new-pack-radio").checked = true;
      control("export-existing-pack-radio").checked = false;
      control("export-pack-name").value = "New pack";
      control("export-pack-select").value = "my-pack";
      control("png-export-form").fire("change");
      assert.equal(control("export-pack-select").hidden, true);
      assert.equal(control("export-pack-name-label").hidden, false);
      control("export-new-pack-radio").checked = false;
      control("export-existing-pack-radio").checked = true;
      control("png-export-form").fire("change");
      assert.equal(control("export-pack-select").hidden, false);
      assert.equal(control("export-pack-name").hidden, true);
      assert.equal(control("export-pack-name-label").hidden, true);
      assert.equal(control("export-pack-name").value, "New pack");
      assert.equal(control("export-pack-select").value, "my-pack");
    });
  }
});

test("typing a path prevents an automatic result from replacing the input", async () => {
  const automatic = createPendingRequest();
  await withExportDialog({ loadPacks: () => automatic.promise }, async (dialog, control) => {
    const opening = dialog.openExportDialog();
    const input = control("export-location-input");
    input.value = "my/Puck";
    control("png-export-form").fire("input", input);
    automatic.resolve(packState("automatic/Puck"));
    await opening;
    assert.equal(input.value, "my/Puck");
    assert.equal(control("export-dialog-submit").disabled, true);
    assert.equal(control("export-rink-name").wasFocused, undefined);
  });
});

test("closing and reopening ignores the previous dialog's lookup", async () => {
  const first = createPendingRequest();
  const second = createPendingRequest();
  let lookupCount = 0;
  await withExportDialog({
    loadPacks: () => (++lookupCount === 1 ? first.promise : second.promise),
  }, async (dialog, control) => {
    const firstOpening = dialog.openExportDialog();
    control("png-export-dialog").close();
    const secondOpening = dialog.openExportDialog();
    second.resolve(packState("new/Puck"));
    await secondOpening;
    first.resolve(packState("old/Puck"));
    await firstOpening;
    assert.equal(control("export-location-input").value, "new/Puck");
  });
});

test("manual lookups block overlapping requests and release controls after failure", async () => {
  const manual = createPendingRequest();
  let requestCount = 0;
  await withExportDialog({
    loadPacks: async () => packState("original/Puck"),
    setGameFolder: () => { requestCount += 1; return manual.promise; },
  }, async (dialog, control) => {
    await dialog.openExportDialog();
    const choosing = control("export-location-use").fire("click");
    await control("export-location-use").fire("click");
    assert.equal(requestCount, 1);
    assert.equal(control("png-export-form").inert, true);
    assert.equal(control("export-dialog-submit").disabled, true);
    manual.reject(new Error("Invalid folder"));
    await choosing;
    assert.equal(control("png-export-form").inert, false);
    assert.equal(control("export-dialog-error").textContent, "Invalid folder");
  });
});
