/*
 * RESKIN PACK TESTS
 * DESCRIPTION: Tests game discovery and safe reskin-pack exports.
 * PROCESS: Tests (Node.js)
 */

// ---------- Imports and fixtures ----------

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { findPuckInSteamRoot, validatePuckFolder } from "../src/main/game-detection.js";
import {
  inspectRinkExport,
  listReskinPacks,
  writeRinkToPack,
} from "../src/main/reskin-pack.js";

async function withFakeGame(run) {
  const root = await mkdtemp(join(tmpdir(), "puck-rink-export-test-"));
  const game = join(root, "Puck");
  const packs = join(game, "reskinpacks");
  await mkdir(packs, { recursive: true });
  await mkdir(join(game, "Puck_Data"));
  try {
    await run({ game, packs });
  } finally {
    // Root was created by this test, NEVER inside a real Steam library
    await rm(root, { recursive: true, force: true });
  }
}

const pngBytes = Buffer.from("isolated test PNG bytes");

// ---------- Tests ----------

test("accepts the Puck folder or its reskinpacks folder", async () => {
  await withFakeGame(async ({ game, packs }) => {
    assert.equal(await validatePuckFolder(game), game);
    assert.equal(await validatePuckFolder(packs), game);
    assert.equal(await validatePuckFolder(join(game, "other")), null);
  });
});

test("finds Puck in a secondary Steam library", async () => {
  const root = await mkdtemp(join(tmpdir(), "puck-steam-location-test-"));
  try {
    const steamRoot = join(root, "Steam");
    const otherLibrary = join(root, "Games");
    const game = join(otherLibrary, "steamapps", "common", "Puck");
    await mkdir(join(steamRoot, "steamapps"), { recursive: true });
    await mkdir(join(game, "Puck_Data"), { recursive: true });
    await writeFile(
      join(steamRoot, "steamapps", "libraryfolders.vdf"),
      `"libraryfolders"\n{\n "1" { "path" "${otherLibrary.replace(/\\/g, "\\\\")}" }\n}`,
    );
    await writeFile(
      join(otherLibrary, "steamapps", "appmanifest_2994020.acf"),
      '"AppState" { "appid" "2994020" "installdir" "Puck" }',
    );
    assert.equal(await findPuckInSteamRoot(steamRoot), game);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("creates a pack with a safe ID and appends a second rink", async () => {
  await withFakeGame(async ({ game, packs }) => {
    const first = await writeRinkToPack(game, {
      newPackName: "Mark's Cool Rinks",
      rinkName: "Pink Blue Ice",
    }, pngBytes);
    assert.equal(first.folderName, "mark-s-cool-rinks");
    const folder = join(packs, first.folderName);
    const manifestPath = join(folder, "reskinpack.json");
    const firstPack = JSON.parse(await readFile(manifestPath, "utf8"));
    assert.equal(firstPack["unique-id"], "reskindesigner-mark-s-cool-rinks");
    assert.equal(firstPack["pack-format"], 1);
    assert.deepEqual(firstPack.reskins, [{
      type: "rink_ice", name: "Pink Blue Ice", path: "textures/ice/pink-blue-ice.png",
    }]);
    assert.deepEqual(await readFile(join(folder, firstPack.reskins[0].path)), pngBytes);

    await writeRinkToPack(game, {
      folderName: first.folderName,
      rinkName: "Second Ice",
    }, pngBytes);
    const updated = JSON.parse(await readFile(manifestPath, "utf8"));
    assert.equal(updated.reskins.length, 2);
    assert.equal(updated.reskins[0].name, "Pink Blue Ice");
    assert.equal(updated.reskins[1].path, "textures/ice/second-ice.png");

    const reserved = await writeRinkToPack(game, {
      newPackName: "CON", rinkName: "Ice",
    }, pngBytes);
    assert.equal(reserved.folderName, "con-rinks");
  });
});

test("creates reskinpacks when absent and fills a folder with no JSON", async () => {
  await withFakeGame(async ({ game, packs }) => {
    await rm(packs, { recursive: true });
    const created = await writeRinkToPack(game, {
      newPackName: "First Pack", rinkName: "First Ice",
    }, pngBytes);
    assert.equal(created.folderName, "first-pack");

    const unfinishedFolder = join(packs, "Unfinished Pack");
    await mkdir(unfinishedFolder);
    await writeRinkToPack(game, {
      folderName: "Unfinished Pack", rinkName: "Second Ice",
    }, pngBytes);
    const pack = JSON.parse(await readFile(join(unfinishedFolder, "reskinpack.json"), "utf8"));
    assert.equal(pack.name, "Unfinished Pack");
    assert.match(pack["unique-id"], /^reskindesigner-/);
    assert.equal(pack.reskins[0].path, "textures/ice/second-ice.png");
  });
});

test("preserves mixed reskin entries and their nonstandard paths", async () => {
  await withFakeGame(async ({ game, packs }) => {
    const folder = join(packs, "mixed-pack");
    await mkdir(folder);
    const pack = {
      name: "Mixed pack",
      "unique-id": "someone-elses-pack",
      version: "7.2.0",
      "pack-format": 1,
      customField: "keep me",
      reskins: [
        { type: "rink_ice", name: "Old Ice", path: "rinks/old.png" },
        { type: "stick_attacker", name: "Galaxy", path: "sticks/galaxy.png" },
      ],
    };
    await writeFile(join(folder, "reskinpack.json"), JSON.stringify(pack));

    await writeRinkToPack(game, { folderName: "mixed-pack", rinkName: "New Ice" }, pngBytes);
    const updated = JSON.parse(await readFile(join(folder, "reskinpack.json"), "utf8"));
    assert.deepEqual(updated.reskins.slice(0, 2), pack.reskins);
    assert.equal(updated.customField, "keep me");
    assert.equal(updated.version, "7.2.0");
    assert.equal(updated["unique-id"], "someone-elses-pack");
    assert.deepEqual(updated.reskins[2], {
      type: "rink_ice", name: "New Ice", path: "textures/ice/new-ice.png",
    });
  });
});

test("requires explicit replacement and keeps duplicated entries intact", async () => {
  await withFakeGame(async ({ game, packs }) => {
    const folder = join(packs, "duplicates");
    await mkdir(join(folder, "rinks"), { recursive: true });
    const pack = {
      name: "Duplicates", "unique-id": "duplicates", version: "1.0.0", "pack-format": 1,
      reskins: [
        { type: "rink_ice", name: "Same Ice", path: "rinks/first.png" },
        { type: "rink_ice", name: "Same Ice", path: "rinks/second.png" },
        { type: "puck", name: "Other", path: "pucks/other.png" },
      ],
    };
    await writeFile(join(folder, "reskinpack.json"), JSON.stringify(pack));
    await writeFile(join(folder, "rinks", "first.png"), "first old");
    await writeFile(join(folder, "rinks", "second.png"), "second old");

    const inspection = await inspectRinkExport(game, {
      folderName: "duplicates", rinkName: "Same Ice",
    });
    assert.equal(inspection.matches.length, 2);
    await assert.rejects(writeRinkToPack(game, {
      folderName: "duplicates", rinkName: "Same Ice",
    }, pngBytes), /Choose an existing rink/);

    await writeRinkToPack(game, {
      folderName: "duplicates", rinkName: "Same Ice",
      replaceIndex: 1, expectedPath: "rinks/second.png",
    }, pngBytes);
    assert.equal(await readFile(join(folder, "rinks", "first.png"), "utf8"), "first old");
    assert.deepEqual(await readFile(join(folder, "rinks", "second.png")), pngBytes);
    assert.deepEqual(JSON.parse(await readFile(join(folder, "reskinpack.json"), "utf8")), pack);
  });
});

test("does not overwrite invalid packs or an unlisted PNG without confirmation", async () => {
  await withFakeGame(async ({ game, packs }) => {
    const broken = join(packs, "broken");
    await mkdir(broken);
    await writeFile(join(broken, "reskinpack.json"), "{broken");
    const listed = await listReskinPacks(game);
    assert.equal(listed[0].valid, false);
    await assert.rejects(writeRinkToPack(game, {
      folderName: "broken", rinkName: "Ice",
    }, pngBytes), /not valid JSON/);
    assert.equal(await readFile(join(broken, "reskinpack.json"), "utf8"), "{broken");

    const empty = join(packs, "empty");
    await mkdir(join(empty, "textures", "ice"), { recursive: true });
    const png = join(empty, "textures", "ice", "ice.png");
    await writeFile(png, "original");
    const inspection = await inspectRinkExport(game, {
      folderName: "empty", rinkName: "Ice",
    });
    assert.equal(inspection.unlistedFile, true);
    await assert.rejects(writeRinkToPack(game, {
      folderName: "empty", rinkName: "Ice",
    }, pngBytes), /Confirm replacement/);
    assert.equal(await readFile(png, "utf8"), "original");
  });
});

test("rejects a filename used by another type and an unsafe existing path", async () => {
  await withFakeGame(async ({ game, packs }) => {
    const folder = join(packs, "conflicts");
    await mkdir(folder);
    const manifestPath = join(folder, "reskinpack.json");
    const pack = {
      name: "Conflicts", "unique-id": "conflicts", version: "1.0.0", "pack-format": 1,
      reskins: [{ type: "puck", name: "Puck", path: "textures/ice/new-ice.png" }],
    };
    await writeFile(manifestPath, JSON.stringify(pack));
    const inspection = await inspectRinkExport(game, {
      folderName: "conflicts", rinkName: "New Ice",
    });
    assert.equal(inspection.pathConflict, true);
    await assert.rejects(writeRinkToPack(game, {
      folderName: "conflicts", rinkName: "New Ice",
    }, pngBytes), /filename is used/);

    pack.reskins = [{ type: "rink_ice", name: "Unsafe", path: "../outside.png" }];
    await writeFile(manifestPath, JSON.stringify(pack));
    await assert.rejects(inspectRinkExport(game, {
      folderName: "conflicts", rinkName: "Unsafe",
    }), /unsafe PNG path/);
  });
});
