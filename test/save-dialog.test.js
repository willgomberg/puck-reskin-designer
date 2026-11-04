/*
 * PROJECT SAVE DIALOG TESTS
 * DESCRIPTION: Tests project naming and the combined New / Open confirmation dialog.
 * PROCESS: Tests (Node.js)
 */

// ---------- Imports and fixtures ----------

import test from "node:test";
import assert from "node:assert/strict";

let moduleId = 0;
async function withDialog(run, canRename = true) {
  const controls = new Map();
  const requests = { hasFile: false, firstSaves: 0, renames: [] };
  function control(selector) {
    if (!controls.has(selector)) {
      const element = new EventTarget();
      Object.assign(element, {
        value: "Untitled project", textContent: "Untitled project", open: false, returnValue: "",
        hidden: selector === "#project-rename-form",
        setCustomValidity(message) { this.validationMessage = message; },
        reportValidity() { return !this.validationMessage; },
        setAttribute(name, value) { this[name] = value; },
        contains(element) {
          return this === element || (selector === "#project-name-controls" &&
            ["#project-name-edit", "#project-rename-form", "#project-rename-input",
              "#project-rename-confirm", "#project-rename-cancel"].some((key) => controls.get(key) === element));
        },
        showModal() { this.open = true; },
        focus() { this.focused = true; },
        select() { this.selected = true; },
        close(value) {
          if (value !== undefined) this.returnValue = value;
          this.open = false;
          this.dispatchEvent(new Event("close"));
        },
      });
      controls.set(selector, element);
    }
    return controls.get(selector);
  }
  const previousDocument = globalThis.document;
  const document = new EventTarget();
  document.querySelector = control;
  globalThis.document = document;
  try {
    const dialog = await import(`../src/renderer/ui/save-dialog.js?test=${++moduleId}`);
    dialog.connectSaveDialog({
      onEditName: () => {
        if (control("#project-name-edit").disabled) return false;
        if (requests.hasFile) return true;
        requests.firstSaves += 1;
        return false;
      },
      onRename: (name) => requests.renames.push(name),
      canRename,
    });
    await run(dialog, control, requests, document);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
}

// ---------- Dialog interactions ----------

test("first-save dialog selects the name and returns a trimmed name on Save", async () => {
  await withDialog(async (dialog, control) => {
    const result = dialog.openSaveDialog();
    const input = control("#save-project-name");
    assert.equal(dialog.isSaveDialogOpen(), true);
    assert.equal(input.focused && input.selected, true);
    input.value = "  My rink  ";
    control("#project-save-form").dispatchEvent(new Event("submit", { cancelable: true }));
    assert.equal(await result, "My rink");
    assert.equal(dialog.isSaveDialogOpen(), false);
  });
});

test("Cancel and Escape return no name, including after an earlier successful submit", async () => {
  await withDialog(async (dialog, control) => {
    let result = dialog.openSaveDialog();
    control("#project-save-form").dispatchEvent(new Event("submit", { cancelable: true }));
    assert.equal(await result, "Untitled project");

    result = dialog.openSaveDialog();
    control("#save-dialog-cancel").dispatchEvent(new Event("click"));
    assert.equal(await result, null);

    result = dialog.openSaveDialog();
    control("#project-save-dialog").close();
    assert.equal(await result, null);
  });
});

test("Save As prefills the current name and returns its replacement", async () => {
  await withDialog(async (dialog, control) => {
    const result = dialog.openSaveDialog("Existing rink");
    const input = control("#save-project-name");
    assert.equal(input.value, "Existing rink");
    assert.equal(input.selected, true);
    input.value = "Rink copy";
    control("#project-save-form").dispatchEvent(new Event("submit", { cancelable: true }));
    assert.equal(await result, "Rink copy");
  });
});

test("invalid filenames stay in the dialog and can be corrected", async () => {
  await withDialog(async (dialog, control) => {
    const result = dialog.openSaveDialog();
    const input = control("#save-project-name");
    for (const name of ["   ", "../rink", "rink\\name", "rink:name", "CON", "nul.txt", "rink.", "x".repeat(81)]) {
      input.value = name;
      input.dispatchEvent(new Event("input"));
      control("#project-save-form").dispatchEvent(new Event("submit", { cancelable: true }));
      assert.equal(dialog.isSaveDialogOpen(), true);
      assert.ok(input.validationMessage);
    }
    input.value = "My rink";
    input.dispatchEvent(new Event("input"));
    assert.equal(input.validationMessage, "");
    control("#project-save-form").dispatchEvent(new Event("submit", { cancelable: true }));
    assert.equal(await result, "My rink");
  });
});

// ---------- Inline renaming ----------

test("the pencil requests normal first Save and only edits names with an existing file", async () => {
  await withDialog(async (dialog, control, requests) => {
    dialog.updateProjectName("Untitled project", false, false);
    const pencil = control("#project-name-edit");
    pencil.dispatchEvent(new Event("click"));
    assert.equal(requests.firstSaves, 0);
    dialog.updateProjectName("Untitled project", false, true);
    pencil.dispatchEvent(new Event("click"));
    assert.equal(requests.firstSaves, 1);
    assert.equal(control("#project-rename-form").hidden, true);
    requests.hasFile = true;
    dialog.updateProjectName("Untitled project", true, true);
    pencil.dispatchEvent(new Event("click"));
    assert.equal(control("#project-rename-form").hidden, false);
    assert.equal(control("#project-rename-input").value, "Untitled project");
    assert.equal(control("#project-rename-input").focused && control("#project-rename-input").selected, true);
    assert.equal(control("#project-rename-confirm").textContent, "Rename");
  });
});

test("Rename validates a trimmed draft and waits for the actual filename before changing the title", async () => {
  await withDialog(async (dialog, control, requests) => {
    requests.hasFile = true;
    dialog.updateProjectName("Original", true, true);
    control("#project-name-edit").dispatchEvent(new Event("click"));
    const input = control("#project-rename-input");
    const form = control("#project-rename-form");
    input.value = "../unsafe";
    form.dispatchEvent(new Event("submit", { cancelable: true }));
    assert.ok(input.validationMessage);
    assert.equal(form.hidden, false);
    input.value = "  New name  ";
    input.dispatchEvent(new Event("input"));
    form.dispatchEvent(new Event("submit", { cancelable: true }));
    assert.deepEqual(requests.renames, ["New name"]);
    assert.equal(control("#project-name").textContent, "Original");
    assert.equal(form.hidden, true);
    dialog.updateProjectName("New name", true, true);
    assert.equal(control("#project-name").textContent, "New name");
  });
});

test("Escape, click-away, unchanged names, and other file operations discard rename drafts", async () => {
  await withDialog(async (dialog, control, requests, document) => {
    requests.hasFile = true;
    dialog.updateProjectName("Original", true, true);
    const pencil = control("#project-name-edit");
    const form = control("#project-rename-form");
    pencil.dispatchEvent(new Event("click"));
    control("#project-rename-input").value = "Cancelled draft";
    form.dispatchEvent(Object.assign(new Event("keydown", { cancelable: true }), { key: "Escape" }));
    assert.equal(form.hidden, true);
    pencil.dispatchEvent(new Event("click"));
    assert.equal(control("#project-rename-input").value, "Original");
    control("#project-rename-cancel").dispatchEvent(new Event("click"));
    assert.equal(form.hidden, true);
    pencil.dispatchEvent(new Event("click"));
    document.dispatchEvent(new Event("pointerdown"));
    assert.equal(form.hidden, true);
    pencil.dispatchEvent(new Event("click"));
    form.dispatchEvent(new Event("submit", { cancelable: true }));
    assert.deepEqual(requests.renames, []);
    pencil.dispatchEvent(new Event("click"));
    dialog.updateProjectName("Original", true, false);
    assert.equal(form.hidden, true);
    assert.equal(pencil.disabled, true);
  });
});

test("browser previews label the existing-file action as Save copy", async () => {
  await withDialog(async (_dialog, control) => {
    assert.equal(control("#project-rename-confirm").textContent, "Save copy…");
  }, false);
});

// ---------- Project replacement confirmation ----------

test("New and Open offer one warning with relevant wording and a safe Back default", async () => {
  await withDialog(async (dialog, control) => {
    for (const operation of ["new", "open"]) {
      for (const [unsaved, preview] of [[true, false], [false, true], [true, true]]) {
        for (const choice of ["save", "discard", "back", ""]) {
          const result = dialog.confirmProjectReplacementDialog(operation, unsaved, preview);
          assert.equal(dialog.isProjectReplacementDialogOpen(), true);
          assert.equal(control("#project-replacement-title").textContent,
            operation === "new" ? "Start a new project?" : "Open another project?");
          const changes = control("#project-replacement-description").textContent;
          assert.equal(changes.includes("unsaved changes"), unsaved);
          assert.equal(changes.includes("not applied") || changes.includes("unapplied edit"), preview);
          assert.equal(changes.includes("Saving also applies the preview."), preview);
          assert.equal(control("#project-replacement-back").focused, true);
          control("#project-replacement-dialog").close(choice);
          assert.equal(await result, choice || "back");
          assert.equal(dialog.isProjectReplacementDialogOpen(), false);
        }
      }
    }
  });
});
