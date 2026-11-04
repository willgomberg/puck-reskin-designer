/*
 * WELCOME PREFERENCES
 * DESCRIPTION: Remembers whether the first-launch tips have been shown.
 * PROCESS: Main
 */

import { app, ipcMain } from "electron";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

// ---------- Preference access and IPC ----------

export function registerWelcomePreferenceHandlers(getEditorWindow) {
  const filePath = join(app.getPath("userData"), "welcome.json");
  let shown = false;

  function validateSender(event) {
    const window = getEditorWindow();
    if (!window || window.isDestroyed() || event.sender !== window.webContents ||
        event.senderFrame !== window.webContents.mainFrame) {
      throw new Error("Only the editor window can access welcome preferences.");
    }
  }

  ipcMain.handle("welcome:should-show", async (event) => {
    validateSender(event);
    if (shown) return false;
    try {
      shown = JSON.parse(await readFile(filePath, "utf8"))?.shown === true;
    } catch (error) {
      if (error.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
    }
    return !shown;
  });

  ipcMain.handle("welcome:mark-shown", async (event) => {
    validateSender(event);
    shown = true;
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, `${JSON.stringify({ shown: true }, null, 2)}\n`, "utf8");
  });
}
