/*
 * DESKTOP APPLICATION
 * DESCRIPTION: Main entry point. Creates the editor window and registers native services.
 * PROCESS: Main
 */

import { app, BrowserWindow, session, shell } from "electron";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { registerPngExportHandlers } from "./png-export.js";
import { registerWelcomePreferenceHandlers } from "./welcome-preferences.js";
import {
  confirmDiscardChanges,
  registerProjectFileHandlers,
  resetProjectFileSession,
} from "./project-files.js";
import {
  createApplicationMenu,
  registerApplicationMenuIpc,
  setUndoRedoAvailability,
} from "./application-menu.js";

const desktopDirectory = dirname(fileURLToPath(import.meta.url));
const rendererEntryPath = join(desktopDirectory, "..", "..", "dist", "index.html");
const preloadPath = join(desktopDirectory, "..", "preload.js");
let editorWindow = null;

app.enableSandbox();

// ---------- Desktop window ----------

async function createEditorWindow() {
  resetProjectFileSession();
  editorWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    // Keep the content above the 900px stacked-layout breakpoint
    minWidth: 960,
    minHeight: 600,
    show: false,
    backgroundColor: "#10141b",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      preload: preloadPath,
    },
  });

  createApplicationMenu(editorWindow);
  // Keep Escape available to renderer dialogs and rename controls too
  editorWindow.webContents.on("before-input-event", (_event, input) => {
    if (input.type === "keyDown" && input.key === "Escape" && editorWindow.isFullScreen()) {
      editorWindow.setFullScreen(false);
    }
  });
  // Renderer compares the design to its saved snapshot, including Undo
  editorWindow.webContents.on("will-prevent-unload", (event) => {
    if (confirmDiscardChanges(editorWindow)) event.preventDefault();
  });
  editorWindow.on("closed", () => {
    editorWindow = null;
    resetProjectFileSession();
    setUndoRedoAvailability(false, false);
  });
  editorWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url === "https://steamcommunity.com/workshop/filedetails/?id=3497550964") {
      shell.openExternal(url).catch((error) => {
        console.error("Could not open the Reskin Loader Workshop page.", error);
      });
    }
    return { action: "deny" };
  });
  editorWindow.webContents.on("will-navigate", (event) => {
    event.preventDefault();
  });
  // Reload starts an untitled editor, so clear the previous Save target
  editorWindow.webContents.on("did-navigate", () => {
    resetProjectFileSession();
  });
  await editorWindow.loadFile(rendererEntryPath);
  editorWindow.show();
}

// ---------- Application lifecycle ----------

app.whenReady()
  .then(async () => {
    registerProjectFileHandlers(() => editorWindow);
    registerApplicationMenuIpc(() => editorWindow);
    registerPngExportHandlers(() => editorWindow);
    registerWelcomePreferenceHandlers(() => editorWindow);
    session.defaultSession.setPermissionRequestHandler(
      (_webContents, _permission, respond) => respond(false),
    );

    await createEditorWindow();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createEditorWindow().catch((error) => {
          console.error("Could not reopen the editor window.", error);
        });
      }
    });
  })
  .catch((error) => {
    console.error("Could not start the desktop application.", error);
    app.quit();
  });

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
