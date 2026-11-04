/*
 * PROJECT FORMAT TESTS
 * DESCRIPTION: Tests project validation and durable design round trips.
 * PROCESS: Tests (Node.js)
 */

// ---------- Imports and fixtures ----------

import test from "node:test";
import assert from "node:assert/strict";

import {
  createEditorState,
  loadProjectIntoEditorState,
  setSelectedElementsLinearGradientFill,
} from "../src/renderer/editor-state.js";
import { rinkLayerDefinitions } from "../src/renderer/layer-definitions.js";
import {
  createProjectFileData,
  MAX_PROJECT_FILE_BYTES,
  parseProjectFileText,
} from "../src/renderer/project-format.js";

function createOriginalAppearances(color = "#FFFFFF") {
  return Object.values(rinkLayerDefinitions).reduce((appearances, layer) => {
    layer.elements.forEach((element) => {
      appearances[element.key] = {
        fill: { kind: "solid", color },
        opacity: 1,
      };
    });
    return appearances;
  }, {});
}

function createPngHeaderDataUrl(width, height) {
  const header = new Uint8Array(24);
  header.set([137, 80, 78, 71, 13, 10, 26, 10]);
  new DataView(header.buffer).setUint32(8, 13);
  header.set([73, 72, 68, 82], 12);
  new DataView(header.buffer).setUint32(16, width);
  new DataView(header.buffer).setUint32(20, height);
  return `data:image/png;base64,${Buffer.from(header).toString("base64")}`;
}

function createEditorStateWithGradient() {
  const editorState = createEditorState(createOriginalAppearances());
  editorState.layers.ice.elements[0].isSelected = true;
  setSelectedElementsLinearGradientFill(editorState, {
    stops: [
      { offset: 0, color: "#123456" },
      { offset: 1, color: "#ABCDEF" },
    ],
  });
  return editorState;
}

// ---------- Tests ----------

test("project cap admits the maximum embedded PNG with room for JSON", () => {
  assert.ok(MAX_PROJECT_FILE_BYTES > Math.ceil(65_000_000 / 3) * 4 + 1_000_000);
  assert.throws(() => parseProjectFileText(" ".repeat(MAX_PROJECT_FILE_BYTES + 1)), /100 MiB/);
});

test("saves durable appearance data and only referenced gradients", () => {
  const editorState = createEditorState(createOriginalAppearances());
  const ice = editorState.layers.ice.elements[0];

  ice.isSelected = true;
  ice.appearance.opacity = 0.4;
  ice.appearance.stroke = { settings: { width: 2 } };
  setSelectedElementsLinearGradientFill(editorState, {
    stops: [
      { offset: 0, color: "#123456" },
      { offset: 1, color: "#ABCDEF" },
    ],
  });
  editorState.gradientDefinitions.unused = {
    key: "unused",
    kind: "linear-gradient",
  };
  editorState.activeLayerKey = "goalLines";
  editorState.undoStack = [{ runtime: true }];

  const savedProject = createProjectFileData(editorState);
  const savedIce = savedProject.layers.ice.elements.iceAll;

  assert.equal(savedProject.formatVersion, 1);
  assert.deepEqual(savedIce.appearance, ice.appearance);
  assert.equal(savedIce.appearance.opacity, 0.4);
  assert.equal(savedIce.appearance.visibility, undefined);
  ice.appearance.stroke.settings.width = 5;
  assert.equal(savedIce.appearance.stroke.settings.width, 2);
  assert.deepEqual(Object.keys(savedProject.gradientDefinitions), [
    "element-ice-iceAll",
  ]);
  assert.equal(savedProject.activeLayerKey, undefined);
  assert.equal(savedProject.undoStack, undefined);
  assert.equal(savedIce.isSelected, undefined);
  assert.equal(savedIce.originalAppearance, undefined);
});

test("fills and opacity survive a save and parse round trip", () => {
  const editorState = createEditorState(createOriginalAppearances());
  const ice = editorState.layers.ice.elements[0];
  const centerLine = editorState.layers.centerLine.elements[0];

  ice.appearance.fill.color = "#112233";
  ice.appearance.opacity = 0;
  centerLine.isSelected = true;
  setSelectedElementsLinearGradientFill(editorState, {
    stops: [
      { offset: 0, color: "#445566" },
      { offset: 1, color: "#DDEEFF" },
    ],
  });

  const parsedProject = parseProjectFileText(
    JSON.stringify(createProjectFileData(editorState)),
  );
  const freshState = createEditorState(createOriginalAppearances("#000000"));
  loadProjectIntoEditorState(freshState, parsedProject);

  assert.deepEqual(freshState.layers.ice.elements[0].appearance, ice.appearance);
  assert.deepEqual(
    freshState.layers.centerLine.elements[0].appearance,
    centerLine.appearance,
  );
  assert.deepEqual(
    freshState.gradientDefinitions,
    editorState.gradientDefinitions,
  );
});

test("rejects invalid types, unsupported versions, and broken references", () => {
  const validProject = createProjectFileData(
    createEditorState(createOriginalAppearances()),
  );

  assert.throws(
    () =>
      parseProjectFileText(
        JSON.stringify({ ...validProject, fileType: "other" }),
      ),
    /not a Puck Rink Reskin project/,
  );
  assert.throws(
    () =>
      parseProjectFileText(
        JSON.stringify({ ...validProject, formatVersion: 2 }),
      ),
    /not supported/,
  );

  const invalidOpacityProject = structuredClone(validProject);
  invalidOpacityProject.layers.ice.elements.iceAll.appearance.opacity = 1.1;
  assert.throws(
    () => parseProjectFileText(JSON.stringify(invalidOpacityProject)),
    /Appearance for "ice\.iceAll" is malformed/,
  );

  const invalidDirectionProject = createProjectFileData(
    createEditorStateWithGradient(),
  );
  invalidDirectionProject.gradientDefinitions[
    "element-ice-iceAll"
  ].directionDegrees = 360;
  assert.throws(
    () => parseProjectFileText(JSON.stringify(invalidDirectionProject)),
    /Gradient "element-ice-iceAll" is malformed/,
  );

  validProject.layers.ice.elements.unknown =
    validProject.layers.ice.elements.iceAll;
  assert.throws(
    () => parseProjectFileText(JSON.stringify(validProject)),
    /unknown element/,
  );

  const missingGradientProject = createProjectFileData(
    createEditorState(createOriginalAppearances()),
  );
  missingGradientProject.layers.ice.elements.iceAll.appearance.fill = {
    kind: "linear-gradient",
    gradientKey: "missing",
  };
  assert.throws(
    () => parseProjectFileText(JSON.stringify(missingGradientProject)),
    /missing its definition/,
  );
});

test("rejects gradient keys that are unsafe in SVG selectors", () => {
  const editorState = createEditorState(createOriginalAppearances());
  editorState.layers.ice.elements[0].isSelected = true;
  setSelectedElementsLinearGradientFill(editorState, {
    stops: [
      { offset: 0, color: "#123456" },
      { offset: 1, color: "#ABCDEF" },
    ],
  });

  const project = createProjectFileData(editorState);
  project.layers.ice.elements.iceAll.appearance.fill.gradientKey =
    'element-ice-iceAll"]';

  assert.throws(
    () => parseProjectFileText(JSON.stringify(project)),
    /Fill for "ice\.iceAll" is malformed/,
  );
});

test("version 1 round-trips and validates a self-contained graphic", () => {
  const editorState = createEditorState(createOriginalAppearances());
  editorState.graphicOverlay = {
    fileName: "team crest.png",
    pngDataUrl: createPngHeaderDataUrl(640, 320),
    sourceWidth: 640,
    sourceHeight: 320,
    scale: 1.25,
    opacity: 0.75,
    offsetX: 100,
    offsetY: -50,
  };

  const saved = createProjectFileData(editorState);
  const parsed = parseProjectFileText(JSON.stringify(saved));
  assert.deepEqual(parsed.graphicOverlay, editorState.graphicOverlay);

  const freshState = createEditorState(createOriginalAppearances());
  loadProjectIntoEditorState(freshState, parsed);
  assert.deepEqual(freshState.graphicOverlay, editorState.graphicOverlay);

  for (const [key, value] of [
    ["fileName", "team crest.jpg"],
    ["pngDataUrl", "data:image/jpeg;base64,AAAA"],
    ["sourceWidth", 0],
    ["scale", 2.51],
    ["opacity", -0.1],
    ["offsetX", 4097],
    ["offsetY", -2049],
  ]) {
    const invalid = structuredClone(saved);
    invalid.graphicOverlay[key] = value;
    assert.throws(
      () => parseProjectFileText(JSON.stringify(invalid)),
      /graphic overlay is malformed/,
    );
  }

  const mismatchedPngHeader = structuredClone(saved);
  mismatchedPngHeader.graphicOverlay.pngDataUrl = createPngHeaderDataUrl(320, 640);
  assert.throws(
    () => parseProjectFileText(JSON.stringify(mismatchedPngHeader)),
    /graphic overlay is malformed/,
  );

  const largestAcceptedSquare = structuredClone(saved);
  largestAcceptedSquare.graphicOverlay.pngDataUrl = createPngHeaderDataUrl(4000, 4000);
  largestAcceptedSquare.graphicOverlay.sourceWidth = 4000;
  largestAcceptedSquare.graphicOverlay.sourceHeight = 4000;
  assert.doesNotThrow(() =>
    parseProjectFileText(JSON.stringify(largestAcceptedSquare)),
  );

  const tooManyPixels = structuredClone(saved);
  tooManyPixels.graphicOverlay.sourceWidth = 5001;
  tooManyPixels.graphicOverlay.sourceHeight = 5000;
  tooManyPixels.graphicOverlay.pngDataUrl = createPngHeaderDataUrl(5001, 5000);
  assert.throws(
    () => parseProjectFileText(JSON.stringify(tooManyPixels)),
    /graphic overlay is malformed/,
  );

  const importedScaleBelowEditableMinimum = structuredClone(saved);
  importedScaleBelowEditableMinimum.graphicOverlay.scale = 0.05;
  assert.doesNotThrow(() =>
    parseProjectFileText(JSON.stringify(importedScaleBelowEditableMinimum)),
  );
});

test("missing current elements keep their fresh template appearance", () => {
  const project = createProjectFileData(
    createEditorState(createOriginalAppearances("#112233")),
  );
  delete project.layers.faceoffCircles.elements.topLeftCircle;

  const freshState = createEditorState(createOriginalAppearances("#AABBCC"));
  loadProjectIntoEditorState(
    freshState,
    parseProjectFileText(JSON.stringify(project)),
  );

  assert.equal(
    freshState.layers.faceoffCircles.elements[0].appearance.fill.color,
    "#AABBCC",
  );
  assert.equal(freshState.layers.faceoffCircles.elements[0].isSelected, false);
});

test("normalizes colours and an omitted optional graphic in version 1", () => {
  const project = createProjectFileData(createEditorStateWithGradient());
  project.layers.centerLine.elements.centerLine.appearance.fill.color = "#abcdef";
  project.gradientDefinitions["element-ice-iceAll"].stops[0].color = "#aabbcc";
  delete project.graphicOverlay;
  const parsed = parseProjectFileText(JSON.stringify(project));
  assert.equal(parsed.layers.centerLine.elements.centerLine.appearance.fill.color, "#ABCDEF");
  assert.equal(parsed.gradientDefinitions["element-ice-iceAll"].stops[0].color, "#AABBCC");
  assert.equal(parsed.graphicOverlay, null);
});

test("rejects gradient shapes that the two-stop element controls cannot edit", () => {
  const original = createProjectFileData(createEditorStateWithGradient());
  for (const change of [
    (gradient) => gradient.stops.push({ offset: 0.5, color: "#000000" }),
    (gradient) => { gradient.stops[0].offset = 0.2; },
    (gradient) => { gradient.coordinateSpace = { kind: "layer", layerKey: "ice" }; },
  ]) {
    const project = structuredClone(original);
    change(project.gradientDefinitions["element-ice-iceAll"]);
    assert.throws(() => parseProjectFileText(JSON.stringify(project)), /Gradient/);
  }
});
