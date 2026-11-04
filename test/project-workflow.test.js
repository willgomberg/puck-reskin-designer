/*
 * PROJECT WORKFLOW TESTS
 * DESCRIPTION: Tests the real app coordinator with real editor data and mocked UI/native boundaries.
 * PROCESS: Tests (Node.js)
 */

// ---------- Imports and fixtures ----------

import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { rinkLayerDefinitions } from "../src/renderer/layer-definitions.js";
import { createProjectFileData } from "../src/renderer/project-format.js";

let moduleId = 0;
const flush = () => new Promise((resolve) => setImmediate(resolve));
const noop = () => {};

async function withEditor(run, desktop = true, welcomeOptions = {}) {
  const controls = new Map();
  const callbacks = {};
  const fixture = {
    choice: "back", previewChoice: "back", nameChoice: "Original", warnings: [], previews: [],
    writes: [], namingCount: 0, namingPrefills: [], resetCount: 0, cameraResets: 0, downloads: 0,
    showWelcome: false, welcomeOpen: false, welcomeShownCount: 0, ...welcomeOptions,
  };
  function control(selector) {
    if (!controls.has(selector)) {
      const element = new EventTarget();
      Object.assign(element, {
        disabled: false, value: "", files: [], textContent: "", dataset: {},
        classList: { toggle: noop }, setAttribute: noop, replaceChildren: noop, remove: noop,
        click() { this.dispatchEvent(new Event("click")); },
      });
      controls.set(selector, element);
    }
    return controls.get(selector);
  }
  const document = new EventTarget();
  document.querySelector = control;
  document.body = { append: noop };
  document.createElement = () => ({ click() { fixture.downloads += 1; }, remove: noop });
  const window = new EventTarget();
  if (desktop) {
    window.desktopAPI = {
      onUndoRedoRequested: (fn) => { callbacks.undo = fn; },
      onNewProjectRequested: (fn) => { callbacks.new = fn; },
      onOpenRequested: (fn) => { callbacks.open = fn; },
      onSaveRequested: (fn) => { callbacks.save = fn; },
      onCheckForUpdatesRequested: noop, onExportPngRequested: (fn) => { callbacks.export = fn; },
      setUndoRedoAvailability: noop,
      async shouldShowWelcome() {
        if (fixture.welcomeReadError) throw new Error("Read failed");
        return fixture.showWelcome;
      },
      async markWelcomeShown() {
        fixture.welcomeShownCount += 1;
        if (fixture.welcomeWriteError) throw new Error("Write failed");
      },
      async saveProjectFile(text, saveAs, name) {
        if (fixture.saveWait) await fixture.saveWait;
        if (fixture.saveError) throw new Error("Write failed");
        if (fixture.cancelNativeSave) return null;
        fixture.nativeName = saveAs || !fixture.nativeName ? `${name}.rskn` : fixture.nativeName;
        fixture.writes.push({ fileName: fixture.nativeName, project: JSON.parse(text) });
        return fixture.nativeName;
      },
      async openProjectFile() {
        if (fixture.cancelOpen) return null;
        fixture.pendingName = fixture.sameFile ? fixture.nativeName : "Incoming.rskn";
        return { text: fixture.invalidFile ? "bad JSON" : JSON.stringify(fixture.incoming),
          fileName: fixture.pendingName };
      },
      async isOpenedProjectCurrent() { return fixture.nativeName === fixture.pendingName; },
      async confirmOpenedProject() { fixture.nativeName = fixture.pendingName; },
      async resetProjectFileSession() {
        if (fixture.resetError) throw new Error("Reset failed");
        fixture.nativeName = null;
        fixture.pendingName = null;
        fixture.resetCount += 1;
      },
      async renameProjectFile(name) { fixture.nativeName = `${name}.rskn`; return fixture.nativeName; },
    };
  }
  const originals = {};
  for (const layer of Object.values(rinkLayerDefinitions)) {
    for (const element of layer.elements) {
      originals[element.key] = { fill: { kind: "solid", color: "#FFFFFF" }, opacity: 1,
        visibility: "visible", stroke: { hasStroke: false, settings: {} } };
    }
  }
  fixture.modules = {
    "./svg-operations.js": {
      parseSvgText: () => ({}),
      prepareSvgForPreview: noop, inspectSvgElements: () => ({ originalAppearanceByElementKey: originals }),
      updateSvgEditorAction: noop, updateSvgPreviewViewBox: noop, createPngBlobForExport: noop,
    },
    "./graphic-overlay.js": {
      validateStoredGraphicOverlay: async () => {},
      prepareGraphicOverlay: () => new Promise((resolve) => { fixture.finishImport = resolve; }),
    },
    "./ui/save-dialog.js": {
      connectSaveDialog: (options) => { callbacks.naming = options; },
      isSaveDialogOpen: () => false, isProjectReplacementDialogOpen: () => false,
      updateProjectName: (name) => { fixture.title = name; },
      openSaveDialog: async (name) => {
        fixture.namingCount += 1;
        fixture.namingPrefills.push(name);
        return fixture.nameChoice;
      },
      confirmProjectReplacementDialog: async (...args) => { fixture.warnings.push(args); return fixture.choice; },
    },
    "./ui/inspector.js": {
      connectInspectorEvents: (options) => { callbacks.inspector = options; },
      confirmAppearancePreview: async (operation) => { fixture.previews.push(operation); return fixture.previewChoice; },
      getChosenRinkAppearanceUpdates: () => fixture.settings,
      isAppearancePreviewDialogOpen: () => false, updateAppearancePreviewIndicator: noop,
      showPropertiesTab: () => { fixture.propertiesShown = true; }, updateInspector: noop,
      getChosenGraphicOverlaySettings: noop, getChosenPresetType: noop, validatePresetColors: noop,
    },
    "./ui/layer-browser.js": {
      connectLayerBrowserEvents: (options) => { callbacks.layers = options; },
      buildLayerBrowser: noop, updateChangedLayerRows: noop, updateGraphicOverlayRow: noop,
      updateLayerGroup: noop, openGraphicOverlayFilePicker: noop,
    },
    "./ui/preview-viewport.js": {
      connectPreviewViewportEvents: noop, setPreviewViewportTarget: () => { fixture.cameraResets += 1; },
    },
    "./ui/export-dialog.js": { connectExportDialog: noop, isExportDialogOpen: () => false, openExportDialog: noop },
    "./ui/update-dialog.js": { connectUpdateDialog: noop, isUpdateDialogOpen: () => false, openUpdateDialog: noop },
    "./ui/welcome-dialog.js": {
      isWelcomeDialogOpen: () => fixture.welcomeOpen,
      openWelcomeDialog: () => {
        fixture.welcomeEditorReady = !!callbacks.inspector.getEditorState();
        fixture.welcomeOpen = true;
      },
    },
  };
  const previous = { document: globalThis.document, window: globalThis.window, fetch: globalThis.fetch };
  globalThis.document = document;
  globalThis.window = window;
  globalThis.fetch = async () => ({ ok: true, text: async () => "template" });
  globalThis.projectWorkflowFixture = fixture;
  const id = ++moduleId;
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      if (context.parentURL?.includes("/src/renderer/app.js")) {
        let source;
        if (specifier.endsWith(".css")) source = "export {};";
        else if (specifier.endsWith("?url")) source = 'export default "template";';
        else if (fixture.modules[specifier]) {
          source = `export const {${Object.keys(fixture.modules[specifier]).join(",")}} = globalThis.projectWorkflowFixture.modules[${JSON.stringify(specifier)}];`;
        }
        if (source) return { shortCircuit: true, url: `data:text/javascript,${encodeURIComponent(source)}#${id}` };
      }
      return nextResolve(specifier, context);
    },
  });
  try {
    await import(`../src/renderer/app.js?test=${id}`);
    hooks.deregister();
    await flush();
    fixture.state = () => callbacks.inspector.getEditorState();
    fixture.incoming = createProjectFileData(fixture.state());
    fixture.incoming.layers.ice.elements.iceAll.appearance.fill.color = "#112233";
    fixture.callbacks = callbacks;
    fixture.control = control;
    fixture.edit = async (color, apply = false) => {
      await callbacks.layers.onSelectionChange("ice", null, { replace: true });
      fixture.settings = { fill: { kind: "solid", color } };
      callbacks.inspector.onRinkPreview();
      if (apply) callbacks.inspector.onApply();
    };
    fixture.save = async () => {
      if (desktop) return callbacks.save(false);
      control("#save-button").click();
      await flush();
    };
    fixture.replace = async (operation) => {
      if (desktop) return callbacks[operation]();
      if (operation === "new") control("#new-project-button").click();
      else control("#project-file-input").dispatchEvent(new Event("change"));
      await flush();
    };
    if (!desktop) {
      control("#project-file-input").files = [{ name: "Incoming.rskn", size: 100,
        text: async () => JSON.stringify(fixture.incoming) }];
    }
    await run(fixture);
  } finally {
    hooks.deregister();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
    delete globalThis.projectWorkflowFixture;
  }
}

const iceColor = (fixture) => fixture.state().layers.ice.elements[0].appearance.fill.color;

// ---------- First-launch welcome ----------

test("first-launch tips wait for the editor and block project actions until dismissed", async () => {
  await withEditor(async (fixture) => {
    assert.equal(fixture.welcomeEditorReady, true);
    assert.equal(fixture.welcomeOpen, true);
    assert.equal(fixture.welcomeShownCount, 1);
    assert.equal(await fixture.save(), false);
    await fixture.replace("new");
    await fixture.replace("open");
    await fixture.callbacks.export();
    assert.equal(fixture.resetCount, 0);
    assert.equal(fixture.namingCount, 0);
    assert.equal(fixture.title, "Untitled project");
    fixture.welcomeOpen = false;
    await fixture.replace("new");
    assert.equal(fixture.resetCount, 1);
    assert.equal(fixture.welcomeShownCount, 1);
    assert.equal(fixture.welcomeOpen, false);
  }, true, { showWelcome: true });
});

test("returning users and browser previews do not show or mark the welcome dialog", async () => {
  for (const desktop of [true, false]) {
    await withEditor(async (fixture) => {
      assert.equal(fixture.welcomeOpen, false);
      assert.equal(fixture.welcomeShownCount, 0);
      assert.ok(fixture.state());
    }, desktop);
  }
});

test("welcome preference failures do not prevent using the editor", async (t) => {
  t.mock.method(console, "warn", () => {});
  for (const welcomeReadError of [true, false]) {
    await withEditor(async (fixture) => {
      assert.ok(fixture.state());
      assert.equal(fixture.welcomeOpen, !welcomeReadError);
      fixture.welcomeOpen = false;
      await fixture.save();
      assert.equal(fixture.writes.length, 1);
    }, true, { showWelcome: true, welcomeReadError, welcomeWriteError: true });
  }
});

// ---------- Replacement decisions ----------

test("New and Open use one decision for unsaved edits, previews, or both", async () => {
  for (const operation of ["new", "open"]) {
    for (const [unsaved, preview] of [[true, false], [false, true], [true, true]]) {
      for (const choice of ["back", "discard", "save"]) {
        await withEditor(async (fixture) => {
          await fixture.save();
          fixture.writes.length = 0;
          if (unsaved) await fixture.edit("#FF0000", true);
          if (preview) await fixture.edit("#00FF00");
          const before = fixture.state();
          fixture.choice = choice;
          await fixture.replace(operation);
          assert.deepEqual(fixture.warnings, [[operation, unsaved, preview]]);
          assert.deepEqual(fixture.previews, []);
          assert.equal(fixture.control(".workspace").inert, false);
          if (choice === "back") {
            assert.equal(fixture.state(), before);
            assert.equal(fixture.title, "Original");
            assert.equal(fixture.writes.length, 0);
            if (preview) {
              fixture.callbacks.inspector.onDiscardPreview();
              assert.equal(iceColor(fixture), unsaved ? "#FF0000" : "#FFFFFF");
            }
          } else {
            assert.notEqual(fixture.state(), before);
            assert.equal(iceColor(fixture), operation === "new" ? "#FFFFFF" : "#112233");
            assert.equal(fixture.title, operation === "new" ? "Untitled project" : "Incoming");
            assert.equal(fixture.control("#undo-button").disabled, true);
            assert.equal(fixture.writes.length, choice === "save" ? 1 : 0);
            if (choice === "save") {
              assert.equal(fixture.writes[0].fileName, "Original.rskn");
              assert.equal(fixture.writes[0].project.layers.ice.elements.iceAll.appearance.fill.color,
                preview ? "#00FF00" : "#FF0000");
            }
          }
        });
      }
    }
  }
});

test("canceled or failed Save & continue keeps the existing project and newly applied preview", async () => {
  for (const operation of ["new", "open"]) {
    for (const failure of ["name", "native", "write"]) {
      await withEditor(async (fixture) => {
        if (failure !== "name") await fixture.save();
        await fixture.edit("#00FF00");
        const before = fixture.state();
        fixture.choice = "save";
        fixture.nameChoice = failure === "name" ? null : "Original";
        fixture.cancelNativeSave = failure === "native";
        fixture.saveError = failure === "write";
        await fixture.replace(operation);
        assert.equal(fixture.state(), before);
        assert.equal(iceColor(fixture), "#00FF00");
        assert.equal(fixture.control("#undo-button").disabled, false);
        assert.equal(fixture.resetCount, 0);
        assert.equal(fixture.control(".workspace").inert, false);
        assert.deepEqual(fixture.previews, []);
      });
    }
  }
});

// ---------- File and editor sessions ----------

test("clean New resets the session, graphic, selection, history, and camera before the next first Save", async () => {
  await withEditor(async (fixture) => {
    await fixture.edit("#FF0000", true);
    fixture.state().graphicOverlay = { fileName: "logo.png", pngDataUrl: "image" };
    await fixture.save();
    await fixture.replace("new");
    assert.deepEqual(fixture.warnings, []);
    assert.equal(fixture.state().graphicOverlay, null);
    assert.equal(fixture.state().layers.ice.elements[0].isSelected, false);
    assert.equal(fixture.cameraResets, 2);
    assert.equal(fixture.propertiesShown, true);
    fixture.nameChoice = "Fresh";
    await fixture.save();
    assert.equal(fixture.namingCount, 2);
    assert.deepEqual(fixture.namingPrefills, ["", ""]);
    assert.equal(fixture.writes.at(-1).fileName, "Fresh.rskn");
  });
});

test("reopening the same file after Save & continue uses the just-saved design", async () => {
  await withEditor(async (fixture) => {
    await fixture.save();
    await fixture.edit("#00FF00");
    fixture.sameFile = true;
    fixture.choice = "save";
    await fixture.replace("open");
    assert.equal(fixture.title, "Original");
    assert.equal(iceColor(fixture), "#00FF00");
  });
});

test("invalid files and canceled native Open do not prompt or replace the current preview", async () => {
  for (const failure of ["invalidFile", "cancelOpen"]) {
    await withEditor(async (fixture) => {
      await fixture.edit("#00FF00");
      const before = fixture.state();
      fixture[failure] = true;
      await fixture.replace("open");
      assert.equal(fixture.state(), before);
      assert.deepEqual(fixture.warnings, []);
      fixture.callbacks.inspector.onApply();
      assert.equal(iceColor(fixture), "#00FF00");
    });
  }
});

test("selection, Save, rename, and export keep their operation-specific preview warning", async () => {
  await withEditor(async (fixture) => {
    await fixture.save();
    await fixture.edit("#00FF00");
    await fixture.callbacks.layers.onSelectionChange("blueLines", null);
    assert.deepEqual(fixture.previews, ["continue"]);
    await fixture.save();
    assert.deepEqual(fixture.previews, ["continue", "save"]);
    fixture.previewChoice = "apply";
    await fixture.callbacks.naming.onRename("Renamed");
    assert.deepEqual(fixture.previews, ["continue", "save", "save"]);
    assert.equal(fixture.title, "Renamed");
    assert.equal(iceColor(fixture), "#00FF00");
    await fixture.edit("#445566");
    fixture.previewChoice = "back";
    await fixture.callbacks.export();
    assert.deepEqual(fixture.previews, ["continue", "save", "save", "export"]);
    assert.deepEqual(fixture.warnings, []);
  });
});

test("a failed native New reset leaves the current design and preview intact", async () => {
  await withEditor(async (fixture) => {
    await fixture.save();
    await fixture.edit("#00FF00");
    const before = fixture.state();
    fixture.choice = "discard";
    fixture.resetError = true;
    await fixture.replace("new");
    assert.equal(fixture.state(), before);
    assert.equal(fixture.title, "Original");
    assert.equal(fixture.nativeName, "Original.rskn");
    fixture.callbacks.inspector.onApply();
    assert.equal(iceColor(fixture), "#00FF00");
  });
});

test("a late import during Save & continue keeps the current project instead of dropping new changes", async () => {
  await withEditor(async (fixture) => {
    await fixture.save();
    const importing = fixture.callbacks.layers.onGraphicFileChosen({ name: "logo.png" });
    await flush();
    await fixture.edit("#00FF00");
    fixture.choice = "save";
    let finishSave;
    fixture.saveWait = new Promise((resolve) => { finishSave = resolve; });
    const replacing = fixture.replace("new");
    await flush();
    assert.equal(fixture.control(".workspace").inert, true);
    fixture.finishImport({ fileName: "logo.png", pngDataUrl: "image" });
    await importing;
    finishSave();
    await replacing;
    assert.equal(fixture.title, "Original");
    assert.equal(fixture.resetCount, 0);
    assert.ok(fixture.state().graphicOverlay);
    assert.match(fixture.control("#status-message").textContent, /changed while saving/);
  });
});

test("New ignores a late graphic import from the former project", async () => {
  await withEditor(async (fixture) => {
    const importing = fixture.callbacks.layers.onGraphicFileChosen({ name: "logo.png" });
    await flush();
    await fixture.replace("new");
    fixture.finishImport({ fileName: "logo.png", pngDataUrl: "image" });
    await importing;
    assert.equal(fixture.state().graphicOverlay, null);
  });
});

test("browser New and Open use the same warning and saving starts a download", async () => {
  await withEditor(async (fixture) => {
    assert.equal(fixture.control("#new-project-button").hidden, false);
    await fixture.edit("#00FF00");
    fixture.choice = "save";
    await fixture.replace("open");
    assert.equal(fixture.downloads, 1);
    assert.deepEqual(fixture.warnings, [["open", false, true]]);
    assert.equal(fixture.title, "Incoming");
    await fixture.replace("new");
    assert.equal(fixture.title, "Untitled project");
    assert.equal(iceColor(fixture), "#FFFFFF");
  }, false);
});
