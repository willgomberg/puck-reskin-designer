/*
 * DESKTOP BRIDGE
 * DESCRIPTION: Exposes approved desktop actions to the editor.
 * PROCESS: Preload
 */

// ---------- Desktop bridge ----------

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktopAPI", {
  onUndoRedoRequested(callback) {
    ipcRenderer.on("editor:undo-redo", (_event, direction) => {
      if (direction === "undo" || direction === "redo") {
        callback(direction);
      }
    });
  },
  setUndoRedoAvailability(undo, redo) {
    ipcRenderer.send("editor:undo-redo-availability", { undo, redo });
  },
  onOpenRequested(callback) {
    ipcRenderer.on("project:open-requested", () => callback());
  },
  onNewProjectRequested(callback) {
    ipcRenderer.on("project:new-requested", () => callback());
  },
  onSaveRequested(callback) {
    ipcRenderer.on("project:save-requested", (_event, saveAs) => {
      if (typeof saveAs === "boolean") callback(saveAs);
    });
  },
  onExportPngRequested(callback) {
    ipcRenderer.on("export:png-requested", () => callback());
  },
  onCheckForUpdatesRequested(callback) {
    ipcRenderer.on("update:check-requested", () => callback());
  },
  checkForUpdates: () => ipcRenderer.invoke("update:check"),
  openUpdateReleasePage: () => ipcRenderer.invoke("update:open-release"),
  shouldShowWelcome: () => ipcRenderer.invoke("welcome:should-show"),
  markWelcomeShown: () => ipcRenderer.invoke("welcome:mark-shown"),
  openProjectFile: () => ipcRenderer.invoke("project:open"),
  isOpenedProjectCurrent: () => ipcRenderer.invoke("project:opened-is-current"),
  resetProjectFileSession: () => ipcRenderer.invoke("project:reset-session"),
  confirmOpenedProject: () => ipcRenderer.invoke("project:confirm-open"),
  saveProjectFile: (text, saveAs = false, projectName) =>
    ipcRenderer.invoke("project:save", text, saveAs, projectName),
  renameProjectFile: (projectName) => ipcRenderer.invoke("project:rename", projectName),
  savePngFile: (pngBytes) => ipcRenderer.invoke("export:png", pngBytes),
  getReskinPackState: () => ipcRenderer.invoke("export:pack-state"),
  browsePuckFolder: () => ipcRenderer.invoke("export:browse-game-folder"),
  setPuckFolder: (path) => ipcRenderer.invoke("export:set-game-folder", path),
  inspectReskinExport: (request) => ipcRenderer.invoke("export:inspect-pack", request),
  exportPngToPack: (request, pngBytes) =>
    ipcRenderer.invoke("export:pack-png", request, pngBytes),
});
