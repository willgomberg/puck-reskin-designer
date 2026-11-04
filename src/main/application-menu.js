/*
 * APPLICATION MENU
 * DESCRIPTION: Builds the native menu and connects editor commands.
 * PROCESS: Main
 */

import { app, ipcMain, Menu, shell } from "electron";
import { createUpdateChecker, RELEASE_REPOSITORY } from "./update-check.js";

// ---------- Native menu ----------

export function createApplicationMenu(window) {
  function requestOpen() {
    if (!window.isDestroyed()) {
      window.webContents.send("project:open-requested");
    }
  }

  function requestSave(saveAs) {
    if (!window.isDestroyed()) {
      window.webContents.send("project:save-requested", saveAs);
    }
  }

  function requestExportPng() {
    if (!window.isDestroyed()) {
      window.webContents.send("export:png-requested");
    }
  }

  const undoItem = {
    id: "editor-undo",
    label: "Undo",
    accelerator: "CommandOrControl+Z",
    enabled: false,
    click: () => {
      if (!window.isDestroyed()) window.webContents.send("editor:undo-redo", "undo");
    },
  };
  const redoItem = {
    id: "editor-redo",
    label: "Redo",
    accelerator: "CommandOrControl+Y",
    enabled: false,
    click: () => {
      if (!window.isDestroyed()) window.webContents.send("editor:undo-redo", "redo");
    },
  };

  const template = [
    ...(process.platform === "darwin" ? [{ role: "appMenu" }] : []),
    {
      label: "File",
      submenu: [
        {
          label: "New Project",
          accelerator: "CommandOrControl+N",
          click: () => {
            if (!window.isDestroyed()) window.webContents.send("project:new-requested");
          },
        },
        {
          label: "Open...",
          accelerator: "CommandOrControl+O",
          click: requestOpen,
        },
        { type: "separator" },
        {
          label: "Save",
          accelerator: "CommandOrControl+S",
          click: () => requestSave(false),
        },
        {
          label: "Save As...",
          accelerator: "CommandOrControl+Shift+S",
          click: () => requestSave(true),
        },
        { type: "separator" },
        { label: "Export as PNG", click: requestExportPng },
        ...(process.platform === "darwin" ? [] : [
          { type: "separator" },
          { role: "quit" },
        ]),
      ],
    },
    {
      label: "Edit",
      submenu: [
        undoItem,
        redoItem,
        // The below shortcuts work but are hidden from menu, as they do not operate in a way specific to the program
        { role: "cut", visible: false },
        { role: "copy", visible: false },
        { role: "paste", visible: false },
        { role: "selectAll", visible: false },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      role: "help",
      submenu: [
        {
          label: "Learn More / Get Help",
          click: () => shell.openExternal(`https://github.com/${RELEASE_REPOSITORY}`),
        },
        {
          label: "Check for Updates…",
          click: () => {
            if (!window.isDestroyed()) window.webContents.send("update:check-requested");
          },
        },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

export function setUndoRedoAvailability(undo, redo) {
  const menu = Menu.getApplicationMenu();
  if (!menu) return;

  menu.getMenuItemById("editor-undo").enabled = undo;
  menu.getMenuItemById("editor-redo").enabled = redo;
}

// ---------- IPC registration ----------

// Register once at startup so reopening a window does not add another listener
export function registerApplicationMenuIpc(getEditorWindow) {
  const updateChecker = createUpdateChecker(app.getVersion(), {
    openExternal: (url) => shell.openExternal(url),
  });
  function validateUpdateSender(event) {
    const window = getEditorWindow();
    if (!window || window.isDestroyed() || event.sender !== window.webContents ||
        event.senderFrame !== window.webContents.mainFrame) {
      throw new Error("Only the editor window can check for updates.");
    }
  }
  ipcMain.handle("update:check", (event) => {
    validateUpdateSender(event);
    return updateChecker.check();
  });
  ipcMain.handle("update:open-release", async (event) => {
    validateUpdateSender(event);
    try {
      await updateChecker.openReleasePage();
      return { status: "opened" };
    } catch (error) {
      return { status: "error", message: error.message };
    }
  });

  ipcMain.on("editor:undo-redo-availability", (event, availability) => {
    const editorWindow = getEditorWindow();
    if (
      !editorWindow ||
      event.sender !== editorWindow.webContents ||
      typeof availability?.undo !== "boolean" ||
      typeof availability?.redo !== "boolean"
    ) {
      return;
    }

    setUndoRedoAvailability(availability.undo, availability.redo);
  });
}
