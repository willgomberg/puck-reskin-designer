/*
 * PNG EXPORT TESTS
 * DESCRIPTION: Tests standalone PNG saves, cancellation, and failed replacements.
 * PROCESS: Tests (Node.js)
 */

// ---------- Imports and fixtures ----------

import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const handlers = new Map();
const window = { webContents: {} };
const event = { sender: window.webContents };
let saveChoice;
let writeFailure;
let renameFailure;

// Load the real handler with only Electron dialogs and filesystem failures replaced
globalThis.pngExportTestElectron = {
  app: { getPath: () => tmpdir() },
  dialog: { async showSaveDialog() { return saveChoice; } },
  ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
};
globalThis.pngExportTestFs = {
  ...fs,
  async writeFile(path, bytes, options) {
    if (writeFailure) {
      await fs.writeFile(path, bytes.subarray(0, 12), options);
      throw Object.assign(new Error("Disk is full."), { code: "ENOSPC" });
    }
    return fs.writeFile(path, bytes, options);
  },
  async rename(oldPath, newPath) {
    if (renameFailure) {
      throw Object.assign(new Error("Destination is locked."), { code: "EPERM" });
    }
    return fs.rename(oldPath, newPath);
  },
};
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "electron") {
      return { shortCircuit: true, url: "data:text/javascript,export const {app,dialog,ipcMain}=globalThis.pngExportTestElectron;" };
    }
    if (specifier === "node:fs/promises" && context.parentURL.endsWith("/src/main/png-export.js")) {
      return { shortCircuit: true, url: "data:text/javascript,export const {mkdir,readFile,rename,unlink,writeFile}=globalThis.pngExportTestFs;" };
    }
    return nextResolve(specifier, context);
  },
});
const { registerPngExportHandlers } = await import("../src/main/png-export.js");
hooks.deregister();
delete globalThis.pngExportTestElectron;
delete globalThis.pngExportTestFs;
registerPngExportHandlers(() => window);

// The native handler checks the header; image encoding is tested in the renderer
const pngBytes = Buffer.alloc(32);
pngBytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
pngBytes.writeUInt32BE(13, 8);
pngBytes.write("IHDR", 12);
pngBytes.writeUInt32BE(8192, 16);
pngBytes.writeUInt32BE(4096, 20);

async function withDestination(run) {
  const temporaryDirectory = await fs.realpath(tmpdir());
  const directory = await fs.mkdtemp(join(temporaryDirectory, "puck-png-export-test-"));
  const filePath = join(directory, "Rink.png");
  saveChoice = { canceled: false, filePath };
  writeFailure = false;
  renameFailure = false;
  try {
    await run(directory, filePath);
  } finally {
    // Only the disposable directory created by this test is removed
    assert.equal(dirname(directory), temporaryDirectory);
    await fs.rm(directory, { recursive: true, force: true });
  }
}

function savePng() {
  return handlers.get("export:png")(event, pngBytes);
}

// ---------- Standalone PNG saves ----------

test("saves a new PNG and replaces an existing PNG without leaving temporary files", async () => {
  await withDestination(async (directory, filePath) => {
    assert.equal(await savePng(), "Rink.png");
    assert.deepEqual(await fs.readFile(filePath), pngBytes);
    await fs.writeFile(filePath, "previous PNG");
    assert.equal(await savePng(), "Rink.png");
    assert.deepEqual(await fs.readFile(filePath), pngBytes);
    assert.deepEqual(await fs.readdir(directory), ["Rink.png"]);
  });
});

test("canceling the save leaves the existing PNG alone", async () => {
  await withDestination(async (directory, filePath) => {
    await fs.writeFile(filePath, "previous PNG");
    saveChoice = { canceled: true };
    assert.equal(await savePng(), null);
    assert.equal(await fs.readFile(filePath, "utf8"), "previous PNG");
    assert.deepEqual(await fs.readdir(directory), ["Rink.png"]);
  });
});

test("a partial write failure preserves the previous PNG and removes the temporary file", async () => {
  await withDestination(async (directory, filePath) => {
    await fs.writeFile(filePath, "previous PNG");
    writeFailure = true;
    await assert.rejects(savePng(), { code: "ENOSPC" });
    assert.equal(await fs.readFile(filePath, "utf8"), "previous PNG");
    assert.deepEqual(await fs.readdir(directory), ["Rink.png"]);
  });
});

test("a rename failure preserves the previous PNG and removes the temporary file", async () => {
  await withDestination(async (directory, filePath) => {
    await fs.writeFile(filePath, "previous PNG");
    renameFailure = true;
    await assert.rejects(savePng(), { code: "EPERM" });
    assert.equal(await fs.readFile(filePath, "utf8"), "previous PNG");
    assert.deepEqual(await fs.readdir(directory), ["Rink.png"]);
  });
});
