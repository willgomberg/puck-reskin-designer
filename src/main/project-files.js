/*
 * PROJECT FILES
 * DESCRIPTION: Opens, saves, and renames project files and tracks the current file path.
 * PROCESS: Main
 */

import { app, dialog, ipcMain } from "electron";
import { copyFile, mkdir, readFile, readdir, realpath, rename, stat, unlink, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { randomUUID } from "node:crypto";
import { basename, dirname, extname, join } from "node:path";
import { MAX_PROJECT_FILE_BYTES } from "../renderer/project-format.js";

let currentProjectPath = null;
let pendingOpenedProjectPath = null;

// ---------- Session and native confirmation ----------

export function resetProjectFileSession() {
  currentProjectPath = null;
  pendingOpenedProjectPath = null;
}

export function confirmDiscardChanges(window) {
  return dialog.showMessageBoxSync(window, {
    type: "warning",
    buttons: ["Keep editing", "Discard changes"],
    defaultId: 0,
    cancelId: 0,
    message: "Discard unsaved project changes?",
    detail: "Save your project first if you want to keep these changes.",
  }) === 1;
}

// ---------- Project file access ----------

function getProjectDirectory() {
  return join(app.getPath("documents"), "Puck Reskin Designer Projects");
}

// Stage the full file beside its destination before replacing the old file
async function writeProjectFile(filePath, text) {
  const temporaryPath = join(dirname(filePath), `.${basename(filePath)}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporaryPath, text, { encoding: "utf8", flag: "wx" });
    await rename(temporaryPath, filePath);
  } finally {
    await unlink(temporaryPath).catch((error) => {
      if (error.code !== "ENOENT") console.warn("Could not remove the temporary project file.", error);
    });
  }
}

async function openProjectFile(window) {
  pendingOpenedProjectPath = null;
  const projectDirectory = getProjectDirectory();
  await mkdir(projectDirectory, { recursive: true });
  const choice = await dialog.showOpenDialog(window, {
    defaultPath: projectDirectory,
    filters: [{ name: "Puck Reskin Designer projects", extensions: ["rskn", "json"] }],
    properties: ["openFile"],
  });
  if (choice.canceled) return null;

  const filePath = choice.filePaths[0];
  if ((await stat(filePath)).size > MAX_PROJECT_FILE_BYTES) {
    throw new Error("Project files cannot exceed 100 MiB.");
  }
  const text = await readFile(filePath, "utf8");
  // Only a successfully loaded project may become Save's target
  pendingOpenedProjectPath = filePath;
  return { text, fileName: basename(filePath) };
}

async function saveProjectFile(window, text, saveAs, projectName) {
  let filePath = currentProjectPath;
  if (!filePath || saveAs) {
    const projectDirectory = getProjectDirectory();
    if (!filePath) await mkdir(projectDirectory, { recursive: true });
    const choice = await dialog.showSaveDialog(window, {
      defaultPath: join(filePath ? dirname(filePath) : projectDirectory, `${projectName}.rskn`),
      filters: [{ name: "Puck Reskin Designer projects", extensions: ["rskn"] }],
    });
    if (choice.canceled) return null;
    filePath = choice.filePath;
  }

  await writeProjectFile(filePath, text);
  currentProjectPath = filePath;
  // Open may be waiting for this Save to finish before loading its selected file
  return basename(filePath);
}

async function renameProjectFile(projectName) {
  if (!currentProjectPath) throw new Error("Save the project before renaming it.");
  const oldPath = currentProjectPath;
  const fileName = `${projectName}${extname(oldPath)}`;
  const newPath = join(dirname(oldPath), fileName);
  if (newPath === oldPath) return fileName;

  // Only use a case-only rename when no distinct entry has the requested spelling
  if (fileName.toLowerCase() === basename(oldPath).toLowerCase() &&
      !(await readdir(dirname(oldPath))).includes(fileName)) {
    await rename(oldPath, newPath);
  } else {
    // Copy exclusively before removing the old file so another project cannot be overwritten
    try {
      await copyFile(oldPath, newPath, constants.COPYFILE_EXCL);
    } catch (error) {
      if (error.code === "EEXIST") throw new Error(`A file named "${fileName}" already exists in this folder.`);
      throw error;
    }
    try {
      await unlink(oldPath);
    } catch (error) {
      await unlink(newPath).catch((cleanupError) => {
        console.warn("Could not remove the incomplete renamed project copy.", cleanupError);
      });
      throw error;
    }
  }
  currentProjectPath = newPath;
  return fileName;
}

function validateProjectName(projectName) {
  if (typeof projectName !== "string" || !projectName.trim() || projectName.length > 80 ||
      /[<>:"/\\|?*\u0000-\u001f]/.test(projectName) || /\.$/.test(projectName.trim()) ||
      /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(projectName.trim())) {
    throw new Error("Enter a valid project name of up to 80 characters for Windows and macOS.");
  }
  return projectName.trim();
}

// ---------- IPC registration ----------

export function registerProjectFileHandlers(getEditorWindow) {
  function getWindow(event) {
    const window = getEditorWindow();
    if (!window || event.sender !== window.webContents) {
      throw new Error("Only the editor window can access project files.");
    }
    return window;
  }

  ipcMain.handle("project:reset-session", (event) => {
    getWindow(event);
    resetProjectFileSession();
  });
  ipcMain.handle("project:open", (event) => openProjectFile(getWindow(event)));
  ipcMain.handle("project:opened-is-current", async (event) => {
    getWindow(event);
    if (!currentProjectPath || !pendingOpenedProjectPath) return false;
    return await realpath(currentProjectPath) === await realpath(pendingOpenedProjectPath);
  });
  ipcMain.handle("project:confirm-open", (event) => {
    getWindow(event);
    if (!pendingOpenedProjectPath) throw new Error("No opened project is ready to save.");
    currentProjectPath = pendingOpenedProjectPath;
    pendingOpenedProjectPath = null;
  });
  ipcMain.handle("project:save", (event, text, saveAs = false, projectName = "Untitled project") => {
    const window = getWindow(event);
    if (typeof text !== "string" || typeof saveAs !== "boolean") {
      throw new Error("The project could not be saved from this window.");
    }
    return saveProjectFile(window, text, saveAs, validateProjectName(projectName));
  });
  ipcMain.handle("project:rename", (event, projectName) => {
    getWindow(event);
    return renameProjectFile(validateProjectName(projectName));
  });
}
