/*
 * PROJECT FILE TESTS
 * DESCRIPTION: Tests native project paths, cancellation, and safe same-folder renaming.
 * PROCESS: Tests (Node.js)
 */

// ---------- Imports and fixtures ----------

import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { registerHooks } from "node:module";

const handlers = new Map();
const window = { webContents: {} };
const event = { sender: window.webContents };
let saveChoice;
let openChoice;
let lastSaveOptions;
let removalFailurePath;
let caseConflictEntries;

// Load the real main module with only Electron dialogs and failure injection replaced.
globalThis.projectFileTestElectron = {
  app: { getPath: () => tmpdir() },
  dialog: {
    async showSaveDialog(_window, options) { lastSaveOptions = options; return saveChoice; },
    async showOpenDialog() { return openChoice; },
  },
  ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
};
globalThis.projectFileTestFs = {
  ...fs,
  async copyFile(oldPath, newPath, flags) {
    if (caseConflictEntries?.includes(basename(newPath))) {
      throw Object.assign(new Error("Destination exists."), { code: "EEXIST" });
    }
    return fs.copyFile(oldPath, newPath, flags);
  },
  async unlink(path) {
    if (path === removalFailurePath) throw Object.assign(new Error("File is locked."), { code: "EACCES" });
    return fs.unlink(path);
  },
  async readdir(path) { return caseConflictEntries ?? fs.readdir(path); },
};
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "electron") {
      return { shortCircuit: true, url: "data:text/javascript,export const {app,dialog,ipcMain}=globalThis.projectFileTestElectron;" };
    }
    if (specifier === "node:fs/promises" && context.parentURL.endsWith("/src/main/project-files.js")) {
      return { shortCircuit: true, url: "data:text/javascript,export const {copyFile,mkdir,readFile,readdir,realpath,rename,stat,unlink,writeFile}=globalThis.projectFileTestFs;" };
    }
    return nextResolve(specifier, context);
  },
});
const { registerProjectFileHandlers, resetProjectFileSession } = await import("../src/main/project-files.js");
hooks.deregister();
delete globalThis.projectFileTestElectron;
delete globalThis.projectFileTestFs;
registerProjectFileHandlers(() => window);

async function withProject(run) {
  const directory = await fs.mkdtemp(join(tmpdir(), "puck-project-naming-test-"));
  resetProjectFileSession();
  saveChoice = { canceled: false, filePath: join(directory, "Original.rskn") };
  removalFailurePath = null;
  caseConflictEntries = null;
  try {
    await run(directory);
  } finally {
    resetProjectFileSession();
    // Only the disposable directory created by this test is removed.
    await fs.rm(directory, { recursive: true, force: true });
  }
}

function save(text = "saved design", saveAs = false, name) {
  return handlers.get("project:save")(event, text, saveAs, name);
}

function renameProject(name) {
  return handlers.get("project:rename")(event, name);
}

// ---------- File operations ----------

test("first Save trusts the native filename and Cancel keeps the existing target", async () => {
  await withProject(async (directory) => {
    assert.equal(await save("initial", false, "Suggested name"), "Original.rskn");
    assert.ok(lastSaveOptions.defaultPath.endsWith("Suggested name.rskn"));
    saveChoice = { canceled: true };
    assert.equal(await save("cancelled", true, "Copy"), null);
    assert.equal(await fs.readFile(join(directory, "Original.rskn"), "utf8"), "initial");
    assert.equal(await save("ordinary save"), "Original.rskn");
    assert.equal(await fs.readFile(join(directory, "Original.rskn"), "utf8"), "ordinary save");
  });
});

test("renaming removes the old file and subsequent Save uses the renamed path", async () => {
  await withProject(async (directory) => {
    await save();
    assert.equal(await renameProject("  Renamed rink  "), "Renamed rink.rskn");
    await assert.rejects(fs.stat(join(directory, "Original.rskn")), { code: "ENOENT" });
    assert.equal(await fs.readFile(join(directory, "Renamed rink.rskn"), "utf8"), "saved design");
    assert.equal(await save("new design"), "Renamed rink.rskn");
    assert.equal(await fs.readFile(join(directory, "Renamed rink.rskn"), "utf8"), "new design");
    assert.equal(await renameProject("Renamed rink"), "Renamed rink.rskn");
  });
});

test("renaming refuses existing files and directories without changing the Save target", async () => {
  await withProject(async (directory) => {
    await save();
    await fs.writeFile(join(directory, "Other.rskn"), "other project");
    await assert.rejects(renameProject("Other"), /already exists/);
    assert.equal(await fs.readFile(join(directory, "Other.rskn"), "utf8"), "other project");
    await fs.mkdir(join(directory, "Folder.rskn"));
    await assert.rejects(renameProject("Folder"));
    assert.equal(await save("still original"), "Original.rskn");
    assert.equal(await fs.readFile(join(directory, "Original.rskn"), "utf8"), "still original");
  });
});

test("case-only naming updates the actual directory entry", async () => {
  await withProject(async (directory) => {
    await save();
    assert.equal(await renameProject("original"), "original.rskn");
    assert.deepEqual(await fs.readdir(directory), ["original.rskn"]);
    assert.equal(await save("updated"), "original.rskn");
  });
});

test("a distinct destination entry on case-sensitive folders is a conflict", async () => {
  await withProject(async () => {
    await save();
    // Simulate case-sensitive entries even when this test runs on Windows.
    caseConflictEntries = ["Original.rskn", "original.rskn"];
    await assert.rejects(renameProject("original"), /already exists/);
    assert.equal(await save(), "Original.rskn");
  });
});

test("failed old-file removal rolls back the copy and preserves the old Save target", async () => {
  await withProject(async (directory) => {
    await save();
    removalFailurePath = join(directory, "Original.rskn");
    await assert.rejects(renameProject("Renamed"), /File is locked/);
    assert.deepEqual(await fs.readdir(directory), ["Original.rskn"]);
    assert.equal(await fs.readFile(removalFailurePath, "utf8"), "saved design");
    removalFailurePath = null;
    assert.equal(await save("after failure"), "Original.rskn");
  });
});

test("opened legacy projects preserve their extension when renamed", async () => {
  await withProject(async (directory) => {
    const path = join(directory, "Legacy.json");
    await fs.writeFile(path, "legacy design");
    openChoice = { canceled: false, filePaths: [path] };
    assert.equal((await handlers.get("project:open")(event)).fileName, "Legacy.json");
    handlers.get("project:confirm-open")(event);
    assert.equal(await renameProject("Legacy renamed"), "Legacy renamed.json");
    assert.equal(await save("updated legacy"), "Legacy renamed.json");
  });
});

test("rename validates its sender, session, and portable filename", async () => {
  await withProject(async () => {
    await assert.rejects(renameProject("No file"), /Save the project/);
    assert.throws(() => handlers.get("project:rename")({ sender: {} }, "Other"), /Only the editor/);
    await save();
    for (const name of [null, " ", "../other", "other\\file", "CON", "nul.txt", "rink.", "x".repeat(81)]) {
      assert.throws(() => renameProject(name), /valid project name/);
    }
    assert.equal(await save(), "Original.rskn");
  });
});

// ---------- New / Open sessions ----------

test("New clears both file targets and the next Save cannot overwrite the former project", async () => {
  await withProject(async (directory) => {
    await save("original design");
    const otherPath = join(directory, "Other.rskn");
    await fs.writeFile(otherPath, "other design");
    openChoice = { canceled: false, filePaths: [otherPath] };
    await handlers.get("project:open")(event);
    assert.throws(() => handlers.get("project:reset-session")({ sender: {} }), /Only the editor/);
    handlers.get("project:reset-session")(event);
    assert.throws(() => handlers.get("project:confirm-open")(event), /No opened project/);
    saveChoice = { canceled: false, filePath: join(directory, "New.rskn") };
    assert.equal(await save("new design", false, "New"), "New.rskn");
    assert.equal(await fs.readFile(join(directory, "Original.rskn"), "utf8"), "original design");
    assert.equal(await fs.readFile(otherPath, "utf8"), "other design");
  });
});

test("saving during Open preserves the pending file and writes to the current project", async () => {
  await withProject(async (directory) => {
    await save("old original");
    const otherPath = join(directory, "Other.rskn");
    await fs.writeFile(otherPath, "other design");
    openChoice = { canceled: false, filePaths: [otherPath] };
    await handlers.get("project:open")(event);
    assert.equal(await handlers.get("project:opened-is-current")(event), false);
    assert.equal(await save("saved original"), "Original.rskn");
    handlers.get("project:confirm-open")(event);
    assert.equal(await save("edited other"), "Other.rskn");
    assert.equal(await fs.readFile(join(directory, "Original.rskn"), "utf8"), "saved original");
    assert.equal(await fs.readFile(otherPath, "utf8"), "edited other");
  });
});

test("Open identifies the current file so the renderer can use its just-saved snapshot", async () => {
  await withProject(async (directory) => {
    await save();
    openChoice = { canceled: false, filePaths: [join(directory, "Original.rskn")] };
    await handlers.get("project:open")(event);
    assert.equal(await handlers.get("project:opened-is-current")(event), true);
  });
});

test("Open detects when an initial Save overwrites the file selected for opening", async () => {
  await withProject(async (directory) => {
    const selectedPath = join(directory, "Selected.rskn");
    await fs.writeFile(selectedPath, "earlier design");
    openChoice = { canceled: false, filePaths: [selectedPath] };
    await handlers.get("project:open")(event);
    assert.equal(await handlers.get("project:opened-is-current")(event), false);
    saveChoice = { canceled: false, filePath: selectedPath };
    await save("latest design", true, "Selected");
    assert.equal(await handlers.get("project:opened-is-current")(event), true);
  });
});
