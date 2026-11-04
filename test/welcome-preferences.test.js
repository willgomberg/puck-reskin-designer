/*
 * WELCOME PREFERENCE TESTS
 * DESCRIPTION: Tests first-launch persistence and access through the desktop bridge.
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
const window = { isDestroyed: () => false, webContents: { mainFrame: {} } };
const event = { sender: window.webContents, senderFrame: window.webContents.mainFrame };
let userData;

globalThis.welcomeTestElectron = {
  app: { getPath: (name) => { assert.equal(name, "userData"); return userData; } },
  ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
};
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "electron") {
      return { shortCircuit: true, url: "data:text/javascript,export const {app,ipcMain}=globalThis.welcomeTestElectron;" };
    }
    return nextResolve(specifier, context);
  },
});
const { registerWelcomePreferenceHandlers } = await import("../src/main/welcome-preferences.js");
hooks.deregister();
delete globalThis.welcomeTestElectron;

async function withPreferences(run) {
  const temporaryDirectory = await fs.realpath(tmpdir());
  const directory = await fs.mkdtemp(join(temporaryDirectory, "puck-welcome-test-"));
  userData = join(directory, "user-data");
  registerWelcomePreferenceHandlers(() => window);
  try {
    await run(join(userData, "welcome.json"));
  } finally {
    assert.equal(dirname(directory), temporaryDirectory);
    await fs.rm(directory, { recursive: true, force: true });
  }
}

const shouldShow = () => handlers.get("welcome:should-show")(event);
const markShown = () => handlers.get("welcome:mark-shown")(event);

// ---------- Persistence and sender validation ----------

test("first launch shows tips and marking shown persists across new app sessions", async () => {
  await withPreferences(async (filePath) => {
    assert.equal(await shouldShow(), true);
    await assert.rejects(fs.access(filePath), { code: "ENOENT" });
    await markShown();
    assert.deepEqual(JSON.parse(await fs.readFile(filePath, "utf8")), { shown: true });
    assert.equal(await shouldShow(), false);
    registerWelcomePreferenceHandlers(() => window);
    assert.equal(await shouldShow(), false);
  });
});

test("missing, malformed, or unconfirmed preferences show tips without changing the file", async () => {
  await withPreferences(async (filePath) => {
    await fs.mkdir(userData);
    for (const contents of ["not JSON", "null", "{}", '{"shown":false}', '{"shown":"true"}']) {
      await fs.writeFile(filePath, contents);
      registerWelcomePreferenceHandlers(() => window);
      assert.equal(await shouldShow(), true);
      assert.equal(await fs.readFile(filePath, "utf8"), contents);
    }
  });
});

test("only the current editor's main frame can read or change welcome preferences", async () => {
  await withPreferences(async (filePath) => {
    for (const request of [
      { sender: {}, senderFrame: event.senderFrame },
      { sender: event.sender, senderFrame: {} },
    ]) {
      for (const handler of handlers.values()) {
        await assert.rejects(handler(request), /Only the editor window/);
      }
    }
    for (const current of [null, { ...window, isDestroyed: () => true }]) {
      registerWelcomePreferenceHandlers(() => current);
      for (const handler of handlers.values()) {
        await assert.rejects(handler(event), /Only the editor window/);
      }
    }
    await assert.rejects(fs.access(filePath), { code: "ENOENT" });
  });
});
