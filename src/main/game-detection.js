/*
 * GAME DETECTION
 * DESCRIPTION: Finds and validates the Puck game folder.
 * PROCESS: Main
 */

import { execFile } from "node:child_process";
import { stat, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { promisify } from "node:util";

const runFile = promisify(execFile);
const PUCK_APP_ID = "2994020";

// ---------- Folder validation ----------

async function isDirectory(path) {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

async function isFile(path) {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

async function isPuckFolder(folder) {
  return (
    (await isFile(join(folder, "Puck.exe"))) ||
    (await isDirectory(join(folder, "Puck.app"))) ||
    (await isDirectory(join(folder, "Puck_Data")))
  );
}

// Accept either the Puck game folder or its reskinpacks subfolder
export async function validatePuckFolder(inputPath) {
  if (typeof inputPath !== "string" || !inputPath.trim()) return null;

  const chosenPath = resolve(inputPath.trim().replace(/^"|"$/g, ""));
  const gameFolder = basename(chosenPath).toLowerCase() === "reskinpacks"
    ? dirname(chosenPath)
    : chosenPath;
  return (await isPuckFolder(gameFolder)) ? gameFolder : null;
}

// ---------- Steam locations ----------

async function getWindowsSteamRoots() {
  const roots = [
    join(process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)", "Steam"),
    join(process.env.PROGRAMFILES || "C:\\Program Files", "Steam"),
  ];

  for (const [key, value] of [
    ["HKCU\\Software\\Valve\\Steam", "SteamPath"],
    ["HKLM\\SOFTWARE\\Valve\\Steam", "InstallPath"],
  ]) {
    try {
      const { stdout } = await runFile("reg", ["query", key, "/v", value], {
        windowsHide: true,
      });
      const match = stdout.match(new RegExp(`${value}\\s+REG_SZ\\s+([^\\r\\n]+)`, "i"));
      if (match) roots.unshift(match[1].trim());
    } catch {
      // Steam may be installed without this registry entry
    }
  }
  return roots;
}

async function getSteamLibraries(steamRoot) {
  const libraries = [steamRoot];
  try {
    const contents = await readFile(join(steamRoot, "steamapps", "libraryfolders.vdf"), "utf8");
    for (const match of contents.matchAll(/"path"\s+"([^"]+)"/gi)) {
      libraries.push(match[1].replace(/\\\\/g, "\\"));
    }
  } catch {
    // Without libraryfolders.vdf, still check the primary Steam library
  }
  return [...new Set(libraries.map((path) => resolve(path)))];
}

async function getGameFolderInLibrary(library) {
  let installDirectory = "Puck";
  try {
    const manifest = await readFile(
      join(library, "steamapps", `appmanifest_${PUCK_APP_ID}.acf`),
      "utf8",
    );
    const match = manifest.match(/"installdir"\s+"([^"]+)"/i);
    if (match && !/[\\/:]/.test(match[1]) && match[1] !== "." && match[1] !== "..") {
      installDirectory = match[1];
    }
  } catch {
    // The conventional Puck directory can still be checked below
  }

  return validatePuckFolder(join(library, "steamapps", "common", installDirectory));
}

// ---------- Game discovery ----------

export async function findPuckInSteamRoot(steamRoot) {
  for (const library of await getSteamLibraries(steamRoot)) {
    const gameFolder = await getGameFolderInLibrary(library);
    if (gameFolder) return gameFolder;
  }
  return null;
}

export async function findPuckFolder(rememberedPath = null) {
  if (rememberedPath) {
    const rememberedFolder = await validatePuckFolder(rememberedPath);
    if (rememberedFolder) return rememberedFolder;
  }

  const roots = process.platform === "darwin"
    ? [join(homedir(), "Library", "Application Support", "Steam")]
    : process.platform === "win32"
      ? await getWindowsSteamRoots()
      : [join(homedir(), ".steam", "steam"), join(homedir(), ".local", "share", "Steam")];

  for (const root of [...new Set(roots)]) {
    const gameFolder = await findPuckInSteamRoot(root);
    if (gameFolder) return gameFolder;
  }
  return null;
}
