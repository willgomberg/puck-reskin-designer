/*
 * DESKTOP PNG EXPORT
 * DESCRIPTION: Validates and saves rink PNGs and remembers export preferences.
 * PROCESS: Main
 */

import { app, dialog, ipcMain } from "electron";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { findPuckFolder, validatePuckFolder } from "./game-detection.js";
import { inspectRinkExport, listReskinPacks, writeRinkToPack } from "./reskin-pack.js";

let currentGameFolder = null;
let packExportInProgress = false;
let gameFolderRequestId = 0;

// ---------- Export preferences and pack state ----------

function getExportPreferencesPath() {
  return join(app.getPath("userData"), "rink-export", "preferences.json");
}

async function readExportPreferences() {
  try {
    const preferences = JSON.parse(await readFile(getExportPreferencesPath(), "utf8"));
    return preferences && typeof preferences === "object" ? preferences : {};
  } catch {
    return {};
  }
}

async function saveExportPreferences(changes) {
  const preferences = { ...await readExportPreferences(), ...changes };
  const filePath = getExportPreferencesPath();
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(preferences, null, 2)}\n`, "utf8");
}

async function getPackExportState(requestId = ++gameFolderRequestId) {
  const preferences = await readExportPreferences();
  const gameFolder = await findPuckFolder(currentGameFolder || preferences.gameFolder);
  // A newer lookup or manual choice makes this result outdated
  if (requestId !== gameFolderRequestId) return null;
  currentGameFolder = gameFolder;
  if (!gameFolder) return { gameFolder: null, packs: [], defaultFolderName: null };

  const packs = await listReskinPacks(gameFolder);
  if (requestId !== gameFolderRequestId) return null;
  const preferred = packs.find((pack) =>
    pack.valid && pack.appCreated && pack.folderName === preferences.lastPackFolder,
  );
  const recentAppPack = packs.find((pack) => pack.valid && pack.appCreated);
  return {
    gameFolder,
    packs,
    defaultFolderName: (preferred || recentAppPack)?.folderName || null,
  };
}

// ---------- PNG file access ----------

// Stage the full PNG beside its destination before replacing the old file
async function writePngFile(filePath, pngBytes) {
  const temporaryPath = join(dirname(filePath), `.${basename(filePath)}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporaryPath, pngBytes, { flag: "wx" });
    await rename(temporaryPath, filePath);
  } finally {
    await unlink(temporaryPath).catch((error) => {
      if (error.code !== "ENOENT") console.warn("Could not remove the temporary PNG file.", error);
    });
  }
}

// ---------- PNG validation and Electron actions ----------

export function registerPngExportHandlers(getEditorWindow) {
  function getWindow(event) {
    const window = getEditorWindow();
    if (!window || event.sender !== window.webContents) {
      throw new Error("Only the editor window can export a rink PNG.");
    }
    return window;
  }

  function validatePngRequest(event, pngBytes) {
    getWindow(event);
    if (!(pngBytes instanceof Uint8Array) || pngBytes.length < 24) {
      throw new Error("The rink PNG could not be saved from this window.");
    }

    // Check the PNG header and required rink size before writing renderer data
    const signature = [137, 80, 78, 71, 13, 10, 26, 10];
    const header = new DataView(pngBytes.buffer, pngBytes.byteOffset, pngBytes.byteLength);
    const isPng = signature.every((byte, index) => pngBytes[index] === byte);
    const hasIhdr =
      header.getUint32(8) === 13 &&
      pngBytes[12] === 73 && pngBytes[13] === 72 &&
      pngBytes[14] === 68 && pngBytes[15] === 82;
    if (
      !isPng || !hasIhdr ||
      header.getUint32(16) !== 8192 ||
      header.getUint32(20) !== 4096
    ) {
      throw new Error("The rink PNG does not have the required 8192 × 4096 dimensions.");
    }
  }

  ipcMain.handle("export:png", async (event, pngBytes) => {
    validatePngRequest(event, pngBytes);
    const choice = await dialog.showSaveDialog(getEditorWindow(), {
      defaultPath: join(app.getPath("documents"), "puck-rink-modified.png"),
      filters: [{ name: "PNG images", extensions: ["png"] }],
    });
    if (choice.canceled) return null;
    await writePngFile(choice.filePath, pngBytes);
    return basename(choice.filePath);
  });

  ipcMain.handle("export:pack-state", async (event) => {
    getWindow(event);
    return getPackExportState();
  });

  async function setGameFolder(event, chosenPath, requestId) {
    getWindow(event);
    requestId ??= ++gameFolderRequestId;
    const folder = await validatePuckFolder(chosenPath);
    if (requestId !== gameFolderRequestId) return null;
    if (!folder) {
      throw new Error("That folder does not appear to contain Puck. Choose the folder opened by Steam’s Browse local files.");
    }
    currentGameFolder = folder;
    try {
      await saveExportPreferences({ gameFolder: folder });
    } catch (error) {
      console.warn("Puck was found, but its location could not be remembered.", error);
    }
    if (requestId !== gameFolderRequestId) return null;
    return getPackExportState(requestId);
  }

  ipcMain.handle("export:set-game-folder", (event, chosenPath) => setGameFolder(event, chosenPath));

  ipcMain.handle("export:browse-game-folder", async (event) => {
    const window = getWindow(event);
    const requestId = ++gameFolderRequestId;
    const choice = await dialog.showOpenDialog(window, {
      defaultPath: currentGameFolder || app.getPath("documents"),
      properties: ["openDirectory"],
    });
    if (requestId !== gameFolderRequestId) return null;
    if (choice.canceled) return getPackExportState(requestId);
    return setGameFolder(event, choice.filePaths[0], requestId);
  });

  ipcMain.handle("export:inspect-pack", async (event, request) => {
    getWindow(event);
    if (!currentGameFolder) {
      throw new Error("Choose Puck’s game folder before exporting a reskin pack.");
    }
    return inspectRinkExport(currentGameFolder, request);
  });

  ipcMain.handle("export:pack-png", async (event, request, pngBytes) => {
    validatePngRequest(event, pngBytes);
    if (!currentGameFolder || !(await validatePuckFolder(currentGameFolder))) {
      throw new Error("Choose Puck’s game folder before exporting a reskin pack.");
    }
    if (packExportInProgress) throw new Error("A reskin pack export is already in progress.");

    packExportInProgress = true;
    try {
      const result = await writeRinkToPack(currentGameFolder, request, pngBytes);
      try {
        await saveExportPreferences({ gameFolder: currentGameFolder, lastPackFolder: result.folderName });
      } catch (error) {
        console.warn("The reskin exported, but its preferred pack could not be remembered.", error);
      }
      return result;
    } finally {
      packExportInProgress = false;
    }
  });
}
