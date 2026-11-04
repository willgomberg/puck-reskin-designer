/*
 * EDITOR STATE TESTS
 * DESCRIPTION: Tests selection, appearance actions, previews, and undo/redo.
 * PROCESS: Tests (Node.js)
 */

// ---------- Imports and fixtures ----------

import test from "node:test";
import assert from "node:assert/strict";

import {
  applyEditorAction,
  applyUndoRedo,
  createUndoRedoHistory,
  createEditorState,
  createSelectedElementsAppearanceAction,
  createGraphicOverlaySettingsAction,
  getLayerVisibility,
  getSelectedElementsAppearanceSummary,
  getSelectedElementsWithLayers,
  hasEditorActionChanges,
  recordUndoRedoAction,
  resetSelectedElementAppearances,
  setElementVisibility,
  setLayerVisibility,
  setGraphicOverlay,
  setRinkSelection,
  setSelectedElementsLinearGradientFill,
  setSelectedElementsOpacity,
  setSelectedElementsSolidFill,
  updateGraphicOverlaySettings,
} from "../src/renderer/editor-state.js";
import { rinkLayerDefinitions } from "../src/renderer/layer-definitions.js";

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

// ---------- Tests ----------

test("creates the layer hierarchy with the first layer active and nothing selected", () => {
  const editorState = createEditorState(createOriginalAppearances());

  assert.equal(editorState.activeLayerKey, "ice");
  assert.equal(editorState.layers.ice.elements[0].isSelected, false);
  assert.equal(editorState.layers.faceoffCircles.elements[0].isSelected, false);
  assert.equal(editorState.layers.ice.elements[0].appearance.opacity, 1);
  assert.deepEqual(editorState.gradientDefinitions, {});
});

test("exclusive selection clears every other layer and can narrow to an already selected child", () => {
  const editorState = createEditorState(createOriginalAppearances());
  setRinkSelection(editorState, "ice", null, { isSelected: true });
  setRinkSelection(editorState, "blueLines", null, { isSelected: true });
  setRinkSelection(editorState, "goalLines", null, { isSelected: true });

  const result = setRinkSelection(editorState, "faceoffCircles", null, { replace: true });
  assert.deepEqual(result.changedLayerKeys, ["ice", "faceoffCircles", "blueLines", "goalLines"]);
  assert.deepEqual(
    getSelectedElementsWithLayers(editorState).map(({ layer }) => layer.key),
    Array(4).fill("faceoffCircles"),
  );

  setRinkSelection(editorState, "faceoffCircles", "bottomRightCircle", { replace: true });
  setRinkSelection(editorState, "faceoffCircles", "bottomRightCircle", { replace: true });
  assert.deepEqual(
    getSelectedElementsWithLayers(editorState).map(({ element }) => element.key),
    ["bottomRightCircle"],
  );
});

test("additive selection completes partial layers and removes full layers without clearing others", () => {
  const editorState = createEditorState(createOriginalAppearances());
  setRinkSelection(editorState, "ice", null, { isSelected: true });
  setRinkSelection(editorState, "blueLines", "leftBlueLine");
  setRinkSelection(editorState, "blueLines");
  assert.ok(editorState.layers.blueLines.elements.every((element) => element.isSelected));

  setRinkSelection(editorState, "blueLines", "rightBlueLine");
  assert.equal(editorState.layers.blueLines.elements[0].isSelected, true);
  assert.equal(editorState.layers.blueLines.elements[1].isSelected, false);

  setRinkSelection(editorState, "blueLines", null, { isSelected: true });
  setRinkSelection(editorState, "blueLines");
  assert.deepEqual(
    getSelectedElementsWithLayers(editorState).map(({ element }) => element.key),
    ["iceAll"],
  );

  setRinkSelection(editorState, "ice", null, { isSelected: false });
  assert.equal(getSelectedElementsWithLayers(editorState).length, 0);
});

test("selection preserves appearance and survives edits until an exclusive click replaces it", () => {
  const editorState = createEditorState(createOriginalAppearances());
  const originalAppearance = structuredClone(editorState.layers.ice.elements[0].appearance);
  setRinkSelection(editorState, "ice", null, { replace: true });
  setRinkSelection(editorState, "faceoffCircles", "topLeftCircle");
  assert.deepEqual(editorState.layers.ice.elements[0].appearance, originalAppearance);

  const action = setSelectedElementsSolidFill(editorState, "#123456");
  assert.equal(action.appearanceChanges.length, 2);
  assert.equal(getSelectedElementsWithLayers(editorState).length, 2);

  setRinkSelection(editorState, "blueLines", null, { replace: true });
  assert.deepEqual(
    getSelectedElementsWithLayers(editorState).map(({ element }) => element.key),
    ["leftBlueLine", "rightBlueLine"],
  );
  assert.equal(editorState.layers.ice.elements[0].appearance.fill.color, "#123456");
});

test("keeps nested appearance data independent from its original snapshot", () => {
  const originalAppearances = createOriginalAppearances();
  originalAppearances.iceAll.stroke = {
    color: "#123456",
    settings: { width: 2 },
  };
  const editorState = createEditorState(originalAppearances);
  const iceElement = editorState.layers.ice.elements[0];

  iceElement.appearance.stroke.settings.width = 5;

  assert.equal(iceElement.originalAppearance.stroke.settings.width, 2);
  assert.equal(originalAppearances.iceAll.stroke.settings.width, 2);
});

test("changes one element visibility without changing its siblings", () => {
  const editorState = createEditorState(createOriginalAppearances());
  const action = setElementVisibility(
    editorState,
    "faceoffCircles",
    "topLeftCircle",
    "hidden",
  );

  assert.deepEqual(action.gradientDefinitionChanges, []);
  assert.equal(action.appearanceChanges.length, 1);
  const [change] = action.appearanceChanges;
  assert.equal(change.previousAppearance.opacity, 1);
  assert.equal(change.nextAppearance.opacity, 0);
  assert.deepEqual(change.nextAppearance.fill, {
    kind: "solid",
    color: "#FFFFFF",
  });
  assert.equal(
    editorState.layers.faceoffCircles.elements[0].appearance.opacity,
    0,
  );
  assert.equal(
    editorState.layers.faceoffCircles.elements[1].appearance.opacity,
    1,
  );
  assert.equal(editorState.layers.faceoffCircles.elements[0].isSelected, false);
  assert.equal(getLayerVisibility(editorState.layers.faceoffCircles), "mixed");
});

test("changes every element in a layer and reports its derived visibility", () => {
  const editorState = createEditorState(createOriginalAppearances());
  const action = setLayerVisibility(editorState, "faceoffCircles", "hidden");

  assert.equal(action.appearanceChanges.length, 4);
  assert.deepEqual(action.gradientDefinitionChanges, []);
  assert.equal(getLayerVisibility(editorState.layers.faceoffCircles), "hidden");
  assert.ok(
    editorState.layers.faceoffCircles.elements.every(
      (element) => element.appearance.opacity === 0,
    ),
  );
});

test("changes selected elements and returns their previous and next appearances", () => {
  const editorState = createEditorState(createOriginalAppearances());
  editorState.layers.ice.elements[0].isSelected = true;
  editorState.layers.ice.elements[0].appearance.opacity = 0;
  const { appearanceChanges, gradientDefinitionChanges } =
    setSelectedElementsSolidFill(editorState, "#12AB34");

  assert.equal(appearanceChanges.length, 1);
  assert.deepEqual(gradientDefinitionChanges, []);
  assert.deepEqual(appearanceChanges[0].previousAppearance.fill, {
    kind: "solid",
    color: "#FFFFFF",
  });
  assert.deepEqual(appearanceChanges[0].nextAppearance.fill, {
    kind: "solid",
    color: "#12AB34",
  });
  assert.equal(appearanceChanges[0].previousAppearance.opacity, 0);
  assert.equal(appearanceChanges[0].nextAppearance.opacity, 0);
  assert.equal(editorState.layers.ice.elements[0].appearance.fill.color, "#12AB34");
  assert.equal(editorState.layers.ice.elements[0].appearance.opacity, 0);
});

test("changes selected opacity without changing fill", () => {
  const editorState = createEditorState(createOriginalAppearances());
  const iceElement = editorState.layers.ice.elements[0];

  iceElement.isSelected = true;
  iceElement.appearance.opacity = 0;
  const opacityChanges = setSelectedElementsOpacity(editorState, 0.35);
  const { appearanceChanges, gradientDefinitionChanges } = opacityChanges;

  assert.equal(appearanceChanges.length, 1);
  assert.deepEqual(gradientDefinitionChanges, []);
  assert.equal(appearanceChanges[0].previousAppearance.opacity, 0);
  assert.equal(appearanceChanges[0].nextAppearance.opacity, 0.35);
  assert.deepEqual(appearanceChanges[0].nextAppearance.fill, {
    kind: "solid",
    color: "#FFFFFF",
  });
  assert.equal(getLayerVisibility(editorState.layers.ice), "visible");
  assert.equal(iceElement.appearance.opacity, 0.35);

  const undoRedoHistory = createUndoRedoHistory();
  recordUndoRedoAction(undoRedoHistory, opacityChanges);
  applyUndoRedo(editorState, undoRedoHistory, "undo");
  assert.equal(iceElement.appearance.opacity, 0);
  assert.equal(getLayerVisibility(editorState.layers.ice), "hidden");
  applyUndoRedo(editorState, undoRedoHistory, "redo");
  assert.equal(iceElement.appearance.opacity, 0.35);
});

test("zero opacity hides elements, positive opacity shows them, and showing mixed layers preserves visible opacities", () => {
  const state = createEditorState(createOriginalAppearances());
  const layer = state.layers.blueLines;
  const [left, right] = layer.elements;
  left.isSelected = true;
  right.appearance.opacity = 0.35;
  setSelectedElementsOpacity(state, 0);
  assert.equal(getLayerVisibility(layer), "mixed");
  assert.equal(getSelectedElementsAppearanceSummary(state).opacity, 0);

  setLayerVisibility(state, "blueLines", "visible");
  assert.equal(left.appearance.opacity, 1);
  assert.equal(right.appearance.opacity, 0.35);
  assert.equal(getLayerVisibility(layer), "visible");

  setLayerVisibility(state, "blueLines", "hidden");
  assert.equal(getLayerVisibility(layer), "hidden");
  setSelectedElementsOpacity(state, 0.01);
  assert.equal(left.appearance.opacity, 0.01);
  assert.equal(getLayerVisibility(layer), "mixed");
  setElementVisibility(state, "blueLines", right.key, "visible");
  assert.equal(getLayerVisibility(layer), "visible");
  assert.equal(right.appearance.opacity, 1);
});

test("creates an element-scoped gradient while preserving element visibility", () => {
  const editorState = createEditorState(createOriginalAppearances());
  const iceElement = editorState.layers.ice.elements[0];
  const centerLineElement = editorState.layers.centerLine.elements[0];

  iceElement.isSelected = false;
  centerLineElement.isSelected = true;
  centerLineElement.appearance.opacity = 0;

  const { appearanceChanges, gradientDefinitionChanges } =
    setSelectedElementsLinearGradientFill(editorState, {
      stops: [
        { offset: 0, color: "#FF0000" },
        { offset: 1, color: "#0000FF" },
      ],
    });
  const gradientDefinition =
    editorState.gradientDefinitions["element-centerLine-centerLine"];

  assert.equal(appearanceChanges.length, 1);
  assert.equal(gradientDefinitionChanges.length, 1);
  assert.equal(gradientDefinitionChanges[0].previousDefinition, null);
  assert.deepEqual(gradientDefinition.coordinateSpace, {
    kind: "element",
    layerKey: "centerLine",
    elementKey: "centerLine",
  });
  assert.equal(gradientDefinition.directionDegrees, 90);
  assert.deepEqual(gradientDefinition.stops, [
    { offset: 0, color: "#FF0000" },
    { offset: 1, color: "#0000FF" },
  ]);
  assert.deepEqual(centerLineElement.appearance.fill, {
    kind: "linear-gradient",
    gradientKey: "element-centerLine-centerLine",
  });
  assert.equal(centerLineElement.appearance.opacity, 0);

  const selectionAppearance =
    getSelectedElementsAppearanceSummary(editorState);
  assert.equal(selectionAppearance.hasMixedFills, false);
  assert.deepEqual(selectionAppearance.gradientDefinition, gradientDefinition);

  const reappliedGradient = setSelectedElementsLinearGradientFill(editorState, {
    stops: [
      { offset: 0, color: "#FFFFFF" },
      { offset: 1, color: "#000000" },
    ],
  });
  assert.deepEqual(
    reappliedGradient.gradientDefinitionChanges[0].previousDefinition.stops,
    [
      { offset: 0, color: "#FF0000" },
      { offset: 1, color: "#0000FF" },
    ],
  );
  assert.deepEqual(
    reappliedGradient.gradientDefinitionChanges[0].nextDefinition.stops,
    [
      { offset: 0, color: "#FFFFFF" },
      { offset: 1, color: "#000000" },
    ],
  );
  assert.equal(
    reappliedGradient.gradientDefinitionChanges[0].nextDefinition.directionDegrees,
    90,
  );
});

test("creates separate horizontal gradients that compare as the same fill", () => {
  const editorState = createEditorState(createOriginalAppearances());
  const selectedCircles = editorState.layers.faceoffCircles.elements.slice(0, 2);

  editorState.layers.ice.elements[0].isSelected = false;
  selectedCircles.forEach((element) => {
    element.isSelected = true;
  });
  editorState.activeLayerKey = "faceoffCircles";

  const { gradientDefinitionChanges } =
    setSelectedElementsLinearGradientFill(editorState, {
      stops: [
        { offset: 0, color: "#FF0000" },
        { offset: 1, color: "#0000FF" },
      ],
    });

  assert.equal(gradientDefinitionChanges.length, 2);
  assert.deepEqual(
    gradientDefinitionChanges.map(({ gradientKey }) => gradientKey),
    [
      "element-faceoffCircles-topLeftCircle",
      "element-faceoffCircles-topRightCircle",
    ],
  );
  gradientDefinitionChanges.forEach(({ nextDefinition }) => {
    assert.equal(nextDefinition.directionDegrees, 0);
  });
  assert.equal(
    getSelectedElementsAppearanceSummary(editorState).hasMixedFills,
    false,
  );

  editorState.gradientDefinitions[
    gradientDefinitionChanges[1].gradientKey
  ].coordinateSpace = {
    kind: "layer",
    layerKey: "faceoffCircles",
  };
  assert.equal(
    getSelectedElementsAppearanceSummary(editorState).hasMixedFills,
    true,
  );
});

test("keeps mixed defaults until one absolute direction is chosen", () => {
  const editorState = createEditorState(createOriginalAppearances());
  const iceElement = editorState.layers.ice.elements[0];
  const centerLineElement = editorState.layers.centerLine.elements[0];
  const gradientSettings = {
    stops: [
      { offset: 0, color: "#FF0000" },
      { offset: 1, color: "#0000FF" },
    ],
  };

  iceElement.isSelected = true;
  centerLineElement.isSelected = true;

  const defaultSummary = getSelectedElementsAppearanceSummary(editorState);
  assert.equal(defaultSummary.gradientDirection, 0);
  assert.equal(defaultSummary.hasMixedGradientDirections, true);

  setSelectedElementsLinearGradientFill(editorState, gradientSettings);
  assert.equal(
    editorState.gradientDefinitions["element-ice-iceAll"].directionDegrees,
    0,
  );
  assert.equal(
    editorState.gradientDefinitions["element-centerLine-centerLine"]
      .directionDegrees,
    90,
  );

  setSelectedElementsLinearGradientFill(editorState, {
    ...gradientSettings,
    directionDegrees: 215,
  });
  assert.equal(
    editorState.gradientDefinitions["element-ice-iceAll"].directionDegrees,
    215,
  );
  assert.equal(
    editorState.gradientDefinitions["element-centerLine-centerLine"]
      .directionDegrees,
    215,
  );
  assert.equal(
    getSelectedElementsAppearanceSummary(editorState).hasMixedGradientDirections,
    false,
  );

  setSelectedElementsLinearGradientFill(editorState, {
    stops: [
      { offset: 0, color: "#FFFFFF" },
      { offset: 1, color: "#000000" },
    ],
  });
  assert.equal(
    editorState.gradientDefinitions["element-centerLine-centerLine"]
      .directionDegrees,
    215,
  );
});

test("uses the selected element's layer for its default gradient direction", () => {
  const editorState = createEditorState(createOriginalAppearances());

  editorState.layers.ice.elements[0].isSelected = true;
  editorState.activeLayerKey = "centerLine";

  const summary = getSelectedElementsAppearanceSummary(editorState);
  assert.equal(summary.gradientDirection, 0);
  assert.equal(summary.hasMixedGradientDirections, false);
});

test("undo and redo restore a gradient direction change", () => {
  const editorState = createEditorState(createOriginalAppearances());
  const undoRedoHistory = createUndoRedoHistory();
  const gradientSettings = {
    stops: [
      { offset: 0, color: "#FF0000" },
      { offset: 1, color: "#0000FF" },
    ],
  };

  editorState.layers.ice.elements[0].isSelected = true;
  setSelectedElementsLinearGradientFill(editorState, gradientSettings);
  const directionChange = setSelectedElementsLinearGradientFill(editorState, {
    ...gradientSettings,
    directionDegrees: 135,
  });
  recordUndoRedoAction(undoRedoHistory, directionChange);

  applyUndoRedo(editorState, undoRedoHistory, "undo");
  assert.equal(
    editorState.gradientDefinitions["element-ice-iceAll"].directionDegrees,
    0,
  );
  applyUndoRedo(editorState, undoRedoHistory, "redo");
  assert.equal(
    editorState.gradientDefinitions["element-ice-iceAll"].directionDegrees,
    135,
  );
});

test("reports mixed fills using a selected element in the active layer as reference", () => {
  const editorState = createEditorState(createOriginalAppearances());
  const faceoffCircle = editorState.layers.faceoffCircles.elements[0];

  editorState.layers.ice.elements[0].isSelected = true;
  faceoffCircle.isSelected = true;
  faceoffCircle.appearance.fill.color = "#AC0026";
  editorState.activeLayerKey = "faceoffCircles";

  assert.deepEqual(getSelectedElementsAppearanceSummary(editorState), {
    fill: { kind: "solid", color: "#AC0026" },
    opacity: 1,
    gradientDefinition: null,
    gradientDirection: 0,
    hasMixedFills: true,
    hasMixedGradientDirections: false,
    hasMixedOpacities: false,
  });
});

test("reports a solid and a gradient selection as mixed fills", () => {
  const editorState = createEditorState(createOriginalAppearances());
  const faceoffCircle = editorState.layers.faceoffCircles.elements[0];

  editorState.layers.ice.elements[0].isSelected = true;
  setSelectedElementsLinearGradientFill(editorState, {
    stops: [
      { offset: 0, color: "#FF0000" },
      { offset: 1, color: "#0000FF" },
    ],
  });
  faceoffCircle.isSelected = true;

  assert.equal(
    getSelectedElementsAppearanceSummary(editorState).hasMixedFills,
    true,
  );
});

test("reports different selected opacity values as mixed", () => {
  const editorState = createEditorState(createOriginalAppearances());
  const iceElement = editorState.layers.ice.elements[0];
  const faceoffCircle = editorState.layers.faceoffCircles.elements[0];

  iceElement.isSelected = true;
  faceoffCircle.isSelected = true;
  faceoffCircle.appearance.opacity = 0.5;

  const selectionAppearance =
    getSelectedElementsAppearanceSummary(editorState);
  assert.equal(selectionAppearance.opacity, 1);
  assert.equal(selectionAppearance.hasMixedOpacities, true);
  assert.equal(selectionAppearance.hasMixedFills, false);
});

test("reset restores selected elements without changing unselected elements", () => {
  const editorState = createEditorState(createOriginalAppearances());
  const iceElement = editorState.layers.ice.elements[0];
  const faceoffCircle = editorState.layers.faceoffCircles.elements[0];

  iceElement.isSelected = true;
  iceElement.appearance.fill.color = "#111111";
  iceElement.appearance.opacity = 0;
  faceoffCircle.appearance.fill.color = "#222222";
  const { appearanceChanges: changes } =
    resetSelectedElementAppearances(editorState);

  assert.equal(changes.length, 1);
  assert.equal(changes[0].previousAppearance.fill.color, "#111111");
  assert.equal(changes[0].nextAppearance.fill.color, "#FFFFFF");
  assert.equal(iceElement.appearance.fill.color, "#FFFFFF");
  assert.equal(iceElement.appearance.opacity, 1);
  assert.equal(getLayerVisibility(editorState.layers.ice), "visible");
  assert.equal(faceoffCircle.appearance.fill.color, "#222222");
  assert.equal(iceElement.originalAppearance.fill.color, "#FFFFFF");
  assert.equal(iceElement.originalAppearance.opacity, 1);
});

test("undo and redo restore visibility without restoring selection", () => {
  const editorState = createEditorState(createOriginalAppearances());
  const undoRedoHistory = createUndoRedoHistory();
  const iceElement = editorState.layers.ice.elements[0];
  const faceoffCircle = editorState.layers.faceoffCircles.elements[0];
  const visibilityChanges = setElementVisibility(
    editorState,
    "ice",
    "iceAll",
    "hidden",
  );

  recordUndoRedoAction(undoRedoHistory, visibilityChanges);
  iceElement.isSelected = false;
  faceoffCircle.isSelected = true;

  applyUndoRedo(editorState, undoRedoHistory, "undo");
  assert.equal(iceElement.appearance.opacity, 1);
  assert.equal(iceElement.isSelected, false);
  assert.equal(faceoffCircle.isSelected, true);
  assert.equal(undoRedoHistory.redoStack.length, 1);

  applyUndoRedo(editorState, undoRedoHistory, "redo");
  assert.equal(iceElement.appearance.opacity, 0);
  assert.equal(iceElement.isSelected, false);
  assert.equal(undoRedoHistory.undoStack.length, 1);
});

test("gradient definitions are replaced, removed, undone, and redone", () => {
  const editorState = createEditorState(createOriginalAppearances());
  const undoRedoHistory = createUndoRedoHistory();
  const iceElement = editorState.layers.ice.elements[0];
  const gradientKey = "element-ice-iceAll";
  const createGradient = (startColor, endColor) =>
    setSelectedElementsLinearGradientFill(editorState, {
      stops: [
        { offset: 0, color: startColor },
        { offset: 1, color: endColor },
      ],
    });

  iceElement.isSelected = true;
  recordUndoRedoAction(undoRedoHistory, createGradient("#FF0000", "#0000FF"));
  assert.equal(Object.keys(editorState.gradientDefinitions).length, 1);

  applyUndoRedo(editorState, undoRedoHistory, "undo");
  assert.equal(editorState.gradientDefinitions[gradientKey], undefined);
  assert.equal(iceElement.appearance.fill.kind, "solid");

  applyUndoRedo(editorState, undoRedoHistory, "redo");
  assert.equal(
    editorState.gradientDefinitions[gradientKey].stops[0].color,
    "#FF0000",
  );

  recordUndoRedoAction(undoRedoHistory, createGradient("#00FF00", "#000000"));
  assert.equal(Object.keys(editorState.gradientDefinitions).length, 1);
  applyUndoRedo(editorState, undoRedoHistory, "undo");
  assert.equal(
    editorState.gradientDefinitions[gradientKey].stops[0].color,
    "#FF0000",
  );

  const solidChanges = setSelectedElementsSolidFill(editorState, "#ABCDEF");
  recordUndoRedoAction(undoRedoHistory, solidChanges);
  assert.equal(editorState.gradientDefinitions[gradientKey], undefined);
  applyUndoRedo(editorState, undoRedoHistory, "undo");
  assert.equal(
    editorState.gradientDefinitions[gradientKey].stops[0].color,
    "#FF0000",
  );
  applyUndoRedo(editorState, undoRedoHistory, "redo");
  assert.equal(editorState.gradientDefinitions[gradientKey], undefined);
  assert.equal(iceElement.appearance.fill.color, "#ABCDEF");
});

test("history keeps fifteen actions and clears redo after a new edit", () => {
  const editorState = createEditorState(createOriginalAppearances());
  const undoRedoHistory = createUndoRedoHistory();

  editorState.layers.ice.elements[0].isSelected = true;
  for (let index = 1; index <= 17; index += 1) {
    const color = `#${index.toString(16).padStart(6, "0")}`;
    recordUndoRedoAction(
      undoRedoHistory,
      setSelectedElementsSolidFill(editorState, color),
    );
  }

  assert.equal(undoRedoHistory.undoStack.length, 15);
  applyUndoRedo(editorState, undoRedoHistory, "undo");
  assert.equal(undoRedoHistory.redoStack.length, 1);

  recordUndoRedoAction(
    undoRedoHistory,
    setSelectedElementsSolidFill(editorState, "#ABCDEF"),
  );
  assert.equal(undoRedoHistory.redoStack.length, 0);
});

test("graphic import, replacement, settings, removal, undo, and redo share history", () => {
  const editorState = createEditorState(createOriginalAppearances());
  const history = createUndoRedoHistory();
  const first = {
    fileName: "first.png",
    pngDataUrl: "data:image/png;base64,AAAA",
    sourceWidth: 800,
    sourceHeight: 400,
    scale: 1,
    opacity: 1,
    offsetX: 0,
    offsetY: 0,
  };
  const replacement = {
    ...first,
    fileName: "second.png",
    pngDataUrl: "data:image/png;base64,BBBB",
    scale: 0.5,
  };

  recordUndoRedoAction(history, setGraphicOverlay(editorState, first));
  assert.equal(editorState.graphicOverlay.fileName, "first.png");
  recordUndoRedoAction(history, setGraphicOverlay(editorState, replacement));
  assert.equal(editorState.graphicOverlay.opacity, 1);
  assert.equal(editorState.graphicOverlay.offsetX, 0);

  recordUndoRedoAction(history, updateGraphicOverlaySettings(editorState, {
    scale: 1.25,
    opacity: 0.6,
    offsetX: 20,
    offsetY: -10,
  }));
  assert.equal(editorState.graphicOverlay.scale, 1.25);

  recordUndoRedoAction(history, setGraphicOverlay(editorState, null));
  assert.equal(editorState.graphicOverlay, null);
  applyUndoRedo(editorState, history, "undo");
  assert.equal(editorState.graphicOverlay.fileName, "second.png");
  assert.equal(editorState.graphicOverlay.offsetY, -10);
  applyUndoRedo(editorState, history, "redo");
  assert.equal(editorState.graphicOverlay, null);
});

test("appearance previews leave state untouched and combined Apply creates one undo step", () => {
  const state = createEditorState(createOriginalAppearances());
  const history = createUndoRedoHistory();
  setRinkSelection(state, "blueLines", null, { replace: true });
  const before = structuredClone(state);
  const updates = {
    fill: {
      kind: "linear-gradient", directionDegrees: 45,
      stops: [{ offset: 0, color: "#FF0000" }, { offset: 1, color: "#0000FF" }],
    },
    opacity: 0.6,
  };
  const preview = createSelectedElementsAppearanceAction(state, updates);
  assert.equal(hasEditorActionChanges(preview), true);
  assert.deepEqual(state, before);
  assert.equal(history.undoStack.length, 0);

  applyEditorAction(state, preview);
  recordUndoRedoAction(history, preview);
  const applied = structuredClone(state);
  assert.equal(history.undoStack.length, 1);
  state.layers.blueLines.elements.forEach((element) => {
    assert.equal(element.appearance.opacity, 0.6);
    assert.equal(state.gradientDefinitions[element.appearance.fill.gradientKey].directionDegrees, 45);
  });
  applyUndoRedo(state, history, "undo");
  assert.deepEqual(state, before);
  applyUndoRedo(state, history, "redo");
  assert.deepEqual(state, applied);
  assert.equal(hasEditorActionChanges(createSelectedElementsAppearanceAction(state, updates)), false);
});

test("opacity-only previews preserve mixed fills and fill-only previews preserve mixed opacities", () => {
  const state = createEditorState(createOriginalAppearances());
  setRinkSelection(state, "ice", null, { replace: true });
  setSelectedElementsLinearGradientFill(state, {
    directionDegrees: 90,
    stops: [{ offset: 0, color: "#FF0000" }, { offset: 1, color: "#0000FF" }],
  });
  state.layers.ice.elements[0].appearance.opacity = 0.35;
  setRinkSelection(state, "blueLines", null, { isSelected: true });
  const before = structuredClone(state);
  const opacityPreview = createSelectedElementsAppearanceAction(state, { opacity: 0.5 });
  assert.deepEqual(state, before);
  assert.deepEqual(opacityPreview.gradientDefinitionChanges, []);
  opacityPreview.appearanceChanges.forEach(({ previousAppearance, nextAppearance }) => {
    assert.deepEqual(nextAppearance.fill, previousAppearance.fill);
    assert.equal(nextAppearance.opacity, 0.5);
  });
  const fillPreview = createSelectedElementsAppearanceAction(state, {
    fill: { kind: "solid", color: "#AABBCC" },
  });
  fillPreview.appearanceChanges.forEach(({ previousAppearance, nextAppearance }) => {
    assert.equal(nextAppearance.opacity, previousAppearance.opacity);
  });
  assert.deepEqual(state, before);
});

test("graphic previews preserve untouched settings and use the normal undo snapshots", () => {
  const state = createEditorState(createOriginalAppearances());
  setGraphicOverlay(state, {
    fileName: "logo.png", pngDataUrl: "data:image/png;base64,AAAA",
    sourceWidth: 1000, sourceHeight: 500, scale: 0.123456,
    opacity: 0.765432, offsetX: 20, offsetY: -30,
  });
  const before = structuredClone(state);
  const action = createGraphicOverlaySettingsAction(state, { offsetX: 200, opacity: 0.5 });
  assert.deepEqual(state, before);
  assert.equal(action.graphicOverlayChange.nextGraphic.scale, 0.123456);
  assert.equal(action.graphicOverlayChange.nextGraphic.offsetY, -30);
  applyEditorAction(state, action);
  const history = createUndoRedoHistory();
  recordUndoRedoAction(history, action);
  applyUndoRedo(state, history, "undo");
  assert.deepEqual(state, before);
});
