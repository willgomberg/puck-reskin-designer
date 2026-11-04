/*
 * RESKIN PACKS
 * DESCRIPTION: Inspects local reskin packs and writes rink exports.
 * PROCESS: Main
 */

import { randomUUID } from "node:crypto";
import {
  lstat, mkdir, readFile, readdir, rename, unlink, writeFile,
} from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";

const APP_ID_PREFIX = "reskindesigner-";

// ---------- Filesystem helpers ----------

async function getEntry(path) {
  try {
    return await lstat(path);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function removeIfPresent(path) {
  if (!path) return;
  try {
    await unlink(path);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

async function discardTemporaryFile(path) {
  try {
    await removeIfPresent(path);
  } catch (error) {
    console.warn(`Could not remove temporary export file ${path}.`, error);
  }
}

// ---------- Names and paths ----------

function validateName(value, label) {
  const name = typeof value === "string" ? value.trim() : "";
  if (!name || name.length > 80 || !/^[\p{L}\p{N}][\p{L}\p{N} '_’\-]*$/u.test(name)) {
    throw new Error(`${label} must be 1–80 characters and use letters, numbers, spaces, apostrophes, hyphens, or underscores.`);
  }
  return name;
}

function slugify(name) {
  const slug = name.normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['’]/g, "-")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 70)
    .replace(/-+$/g, "");
  if (!slug) throw new Error("Use at least one English letter or number in the name so a safe filename can be made.");
  return slug;
}

function validateFolderName(folderName) {
  if (
    typeof folderName !== "string" || !folderName ||
    folderName === "." || folderName === ".." ||
    basename(folderName) !== folderName || /[\\/:]/.test(folderName)
  ) {
    throw new Error("Choose a reskin pack from the list.");
  }
  return folderName;
}

function isSafePngPath(path) {
  return typeof path === "string" &&
    path.toLowerCase().endsWith(".png") &&
    !path.includes("\\") &&
    path.split("/").every((part) =>
      part && part !== "." && part !== ".." && !/[<>:"|?*\x00-\x1f]/.test(part),
    );
}

function getPackRoot(gameFolder) {
  return join(gameFolder, "reskinpacks");
}

// ---------- Pack JSON reading ----------

function parsePack(text) {
  let pack;
  try {
    pack = JSON.parse(text);
  } catch {
    throw new Error("Its reskinpack.json is not valid JSON. Fix that file before adding a rink.");
  }
  if (
    !pack || Array.isArray(pack) || typeof pack !== "object" ||
    typeof pack.name !== "string" || !pack.name.trim() ||
    typeof pack["unique-id"] !== "string" || !pack["unique-id"].trim() ||
    typeof pack.version !== "string" || !pack.version.trim() ||
    pack["pack-format"] !== 1 || !Array.isArray(pack.reskins)
  ) {
    throw new Error("Its reskinpack.json does not have the supported pack format and reskins list.");
  }
  return pack;
}

async function readPack(folder) {
  try {
    const manifestPath = join(folder, "reskinpack.json");
    if ((await getEntry(manifestPath))?.isSymbolicLink()) {
      throw new Error("Its reskinpack.json is a file link and cannot be changed safely.");
    }
    const text = await readFile(manifestPath, "utf8");
    return { pack: parsePack(text), text };
  } catch (error) {
    if (error.code === "ENOENT") return { pack: null, text: null };
    throw error;
  }
}

// ---------- Pack list and target inspection ----------

export async function listReskinPacks(gameFolder) {
  const root = getPackRoot(gameFolder);
  let folders;
  try {
    folders = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }

  const packs = [];
  for (const folder of folders) {
    if (!folder.isDirectory()) continue;
    const folderPath = join(root, folder.name);
    const details = {
      folderName: folder.name,
      name: folder.name,
      appCreated: false,
      valid: true,
      missingManifest: false,
      modifiedAt: (await lstat(folderPath)).mtimeMs,
    };
    try {
      const { pack } = await readPack(folderPath);
      if (pack) {
        details.name = pack.name;
        details.appCreated = pack["unique-id"].startsWith(APP_ID_PREFIX);
        details.modifiedAt = (await lstat(join(folderPath, "reskinpack.json"))).mtimeMs;
      } else {
        details.missingManifest = true;
      }
    } catch (error) {
      details.valid = false;
      details.error = error.message;
    }
    packs.push(details);
  }
  return packs.sort((a, b) => b.modifiedAt - a.modifiedAt);
}

async function getNewPackIdentity(root, name) {
  const slug = slugify(name);
  const folderSlug = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/.test(slug)
    ? `${slug}-rinks`
    : slug;
  const folders = await readdir(root, { withFileTypes: true }).catch((error) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  const folderNames = new Set(folders.map((entry) => entry.name.toLowerCase()));
  const usedIds = new Set();
  for (const folder of folders) {
    if (!folder.isDirectory()) continue;
    try {
      const { pack } = await readPack(join(root, folder.name));
      if (pack) usedIds.add(pack["unique-id"].toLowerCase());
    } catch {
      // Skip invalid manifests when collecting existing pack IDs
    }
  }

  let suffix = 1;
  while (true) {
    const ending = suffix === 1 ? "" : `-${suffix}`;
    const folderName = `${folderSlug}${ending}`;
    const uniqueId = `${APP_ID_PREFIX}${slug}${ending}`;
    if (!folderNames.has(folderName.toLowerCase()) && !usedIds.has(uniqueId)) {
      return { folderName, uniqueId };
    }
    suffix += 1;
  }
}

async function ensurePackFolder(root, folderName) {
  const folder = join(root, validateFolderName(folderName));
  const entry = await getEntry(folder);
  if (!entry?.isDirectory() || entry.isSymbolicLink()) {
    throw new Error("The selected reskin pack folder is no longer available.");
  }
  return folder;
}

async function ensureSafeDestination(folder, relativePath) {
  if (!isSafePngPath(relativePath)) {
    throw new Error("The existing rink has an unsafe PNG path; choose a different rink.");
  }
  const destination = resolve(folder, ...relativePath.split("/"));
  if (!relative(folder, destination) || relative(folder, destination).startsWith(`..${sep}`)) {
    throw new Error("The rink PNG path must stay inside its reskin pack.");
  }
  let current = folder;
  for (const part of relativePath.split("/")) {
    current = join(current, part);
    if ((await getEntry(current))?.isSymbolicLink()) {
      throw new Error("The rink PNG path contains a link outside the pack.");
    }
  }
  return destination;
}

export async function inspectRinkExport(gameFolder, request) {
  const rinkName = validateName(request?.rinkName, "Rink name");
  const root = getPackRoot(gameFolder);
  const creating = request?.newPackName != null;
  let folderName;
  let pack;

  if (creating) {
    const packName = validateName(request.newPackName, "Pack name");
    const identity = await getNewPackIdentity(root, packName);
    folderName = identity.folderName;
    pack = {
      name: packName,
      "unique-id": identity.uniqueId,
      version: "1.0.0",
      "pack-format": 1,
      reskins: [],
    };
  } else {
    folderName = validateFolderName(request?.folderName);
    const folder = await ensurePackFolder(root, folderName);
    const existing = await readPack(folder);
    const missingIdentity = existing.pack ? null : await getNewPackIdentity(root, folderName);
    pack = existing.pack || {
      name: folderName,
      "unique-id": missingIdentity.uniqueId,
      version: "1.0.0",
      "pack-format": 1,
      reskins: [],
    };
  }

  const relativePath = `textures/ice/${slugify(rinkName)}.png`;
  const lowerName = rinkName.toLocaleLowerCase();
  const matches = pack.reskins.flatMap((entry, index) => {
    if (entry?.type !== "rink_ice" || typeof entry.name !== "string" ||
        entry.name.toLocaleLowerCase() !== lowerName) return [];
    const sharedCount = pack.reskins.filter((other) =>
      typeof other?.path === "string" &&
      typeof entry.path === "string" &&
      other.path.toLowerCase() === entry.path.toLowerCase(),
    ).length;
    return [{ index, name: entry.name, path: entry.path, sharedCount }];
  });
  for (const match of matches) {
    await ensureSafeDestination(join(root, folderName), match.path);
  }
  const pathUsers = pack.reskins.filter((entry) =>
    typeof entry?.path === "string" && entry.path.toLowerCase() === relativePath.toLowerCase(),
  );
  const candidateExists = matches.length ? false : !!(await getEntry(
    await ensureSafeDestination(join(root, folderName), relativePath),
  ));

  return {
    folderName,
    packName: pack.name,
    uniqueId: pack["unique-id"],
    rinkName,
    relativePath,
    matches,
    pathConflict: matches.length === 0 && pathUsers.length > 0,
    unlistedFile: matches.length === 0 && pathUsers.length === 0 && candidateExists,
  };
}

// ---------- PNG and JSON manifest writing ----------

export async function writeRinkToPack(gameFolder, request, pngBytes) {
  // Resolve conflicts and the chosen replacement before preparing writes
  const inspection = await inspectRinkExport(gameFolder, request);
  if (inspection.pathConflict) {
    throw new Error("That filename is used by another reskin. Choose a different rink name.");
  }
  if (inspection.unlistedFile && request.overwriteUnlisted !== true) {
    throw new Error("A PNG with that filename already exists. Confirm replacement first.");
  }

  const root = getPackRoot(gameFolder);
  const creating = request.newPackName != null;
  const folder = join(root, inspection.folderName);
  let relativePath = inspection.relativePath;
  let keepExistingEntry = false;
  if (inspection.matches.length) {
    const match = inspection.matches.find((item) =>
      item.index === request.replaceIndex && item.path === request.expectedPath,
    );
    if (!match) throw new Error("Choose an existing rink to replace and confirm it first.");
    relativePath = match.path;
    keepExistingEntry = true;
  } else if (request.replaceIndex != null) {
    throw new Error("The pack changed. Review its rinks and try again.");
  }

  if (!creating) await ensurePackFolder(root, inspection.folderName);
  const destination = await ensureSafeDestination(folder, relativePath);
  const oldPng = await getEntry(destination);
  if (oldPng && !oldPng.isFile()) {
    throw new Error("The rink PNG destination is not a regular file.");
  }
  if (oldPng && !keepExistingEntry && !request.overwriteUnlisted) {
    throw new Error("A PNG with that filename already exists. Confirm replacement first.");
  }

  // Replacing a listed rink keeps its existing JSON entry
  const manifestPath = join(folder, "reskinpack.json");
  const existing = creating ? { pack: null, text: null } : await readPack(folder);
  let manifestText = null;
  if (!keepExistingEntry) {
    const pack = existing.pack || {
      name: creating ? validateName(request.newPackName, "Pack name") : inspection.packName,
      "unique-id": inspection.uniqueId,
      version: "1.0.0",
      "pack-format": 1,
      reskins: [],
    };
    pack.reskins.push({ type: "rink_ice", name: inspection.rinkName, path: relativePath });
    manifestText = `${JSON.stringify(pack, null, 2)}\n`;
  }

  await mkdir(root, { recursive: true });
  if (creating) await mkdir(folder);
  await mkdir(dirname(destination), { recursive: true });
  await ensureSafeDestination(folder, relativePath);

  const token = randomUUID();
  const pngTemp = join(dirname(destination), `.${basename(destination)}.${token}.tmp`);
  const jsonTemp = manifestText == null ? null : join(folder, `.reskinpack.${token}.tmp`);
  const pngBackup = oldPng ? join(dirname(destination), `.${basename(destination)}.${token}.bak`) : null;
  const jsonBackup = existing.text != null && manifestText != null
    ? join(folder, `.reskinpack.${token}.bak`)
    : null;
  let pngBackedUp = false;
  let jsonBackedUp = false;
  let pngInstalled = false;
  let jsonInstalled = false;

  try {
    // Stage complete files without touching the originals
    await writeFile(pngTemp, pngBytes, { flag: "wx" });
    if (jsonTemp) await writeFile(jsonTemp, manifestText, { flag: "wx" });

    // Recheck the manifest and destination PNG before replacing either file
    if (!creating) {
      const latest = await readPack(folder);
      if (latest.text !== existing.text) {
        throw new Error("The reskin pack changed during export. Review it and try again.");
      }
    }
    const latestPng = await getEntry(destination);
    if (
      !!latestPng !== !!oldPng ||
      (oldPng && (latestPng.size !== oldPng.size || latestPng.mtimeMs !== oldPng.mtimeMs))
    ) {
      throw new Error("The rink PNG changed during export. Review it and try again.");
    }
    // Keep backups until every staged file has been installed
    if (pngBackup) {
      await rename(destination, pngBackup);
      pngBackedUp = true;
    }
    await rename(pngTemp, destination);
    pngInstalled = true;
    if (jsonTemp) {
      if (jsonBackup) {
        await rename(manifestPath, jsonBackup);
        jsonBackedUp = true;
      }
      await rename(jsonTemp, manifestPath);
      jsonInstalled = true;
    }
  } catch (error) {
    // Recover in reverse order, retain backups if recovery itself fails
    try {
      if (jsonInstalled) await removeIfPresent(manifestPath);
      if (jsonBackedUp) await rename(jsonBackup, manifestPath);
      if (pngInstalled) await removeIfPresent(destination);
      if (pngBackedUp) await rename(pngBackup, destination);
    } catch (restoreError) {
      throw new Error(`Export failed and automatic recovery failed. Backup files remain in the pack: ${restoreError.message}`);
    }
    throw error;
  } finally {
    // Discard unused staged files after success or recovery
    await discardTemporaryFile(pngTemp);
    await discardTemporaryFile(jsonTemp);
  }

  await discardTemporaryFile(pngBackup);
  await discardTemporaryFile(jsonBackup);
  return { folderName: inspection.folderName, packName: inspection.packName, rinkName: inspection.rinkName };
}
