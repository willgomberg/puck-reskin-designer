/*
 * PRESETS TESTS
 * DESCRIPTION: Tests preset targets, preview actions, and history restoration.
 * PROCESS: Tests (Node.js)
 */

// ---------- Imports and fixtures ----------

import test from "node:test";
import assert from "node:assert/strict";

import {
  applyUndoRedo,
  createEditorState,
  createUndoRedoHistory,
  recordUndoRedoAction,
  setElementsLinearGradientFill,
} from "../src/renderer/editor-state.js";
import { rinkLayerDefinitions } from "../src/renderer/layer-definitions.js";
import { applyPresetAppearance, createPresetAppearanceAction } from "../src/renderer/presets.js";

const COLORS = {
  iceColor: "#F8FCFF",
  accent1Color: "#A10028",
  accent2Color: "#124E9A",
};

const ICE_LAYER_KEYS = ["ice", "goalieCreases"];
const ACCENT_ONE_LAYER_KEYS = [
  "goalLines",
  "centerLine",
  "neutralZoneDots",
  "faceoffCircles",
];
const ACCENT_TWO_LAYER_KEYS = ["blueLines", "centerCircle"];
const GRADIENT_LAYER_KEYS = [...ACCENT_ONE_LAYER_KEYS, ...ACCENT_TWO_LAYER_KEYS];

function createOriginalAppearances() {
  return Object.values(rinkLayerDefinitions).reduce((appearances, layer) => {
    layer.elements.forEach((element, index) => {
      appearances[element.key] = {
        fill: { kind: "solid", color: index % 2 ? "#EEEEEE" : "#FFFFFF" },
        opacity: index % 2 ? 0 : 0.35 + index * 0.1,
      };
    });
    return appearances;
  }, {});
}

function createState() {
  return createEditorState(createOriginalAppearances());
}

function getLayerElements(editorState, layerKeys) {
  return layerKeys.flatMap((layerKey) => editorState.layers[layerKey].elements);
}

function snapshotState(editorState) {
  return {
    appearances: Object.fromEntries(
      Object.values(editorState.layers).flatMap((layer) =>
        layer.elements.map((element) => [
          element.key,
          structuredClone(element.appearance),
        ]),
      ),
    ),
    gradientDefinitions: structuredClone(editorState.gradientDefinitions),
  };
}

// ---------- Tests ----------

test("preset previews calculate the entire recipe without changing state", () => {
  const state = createEditorState(createOriginalAppearances());
  const before = structuredClone(state);
  for (const key of ["standard", "gradient"]) {
    const preview = createPresetAppearanceAction(state, key, COLORS);
    assert.equal(preview.appearanceChanges.length, 18);
    assert.deepEqual(state, before);
    const committed = applyPresetAppearance(structuredClone(state), key, COLORS);
    assert.deepEqual(preview, committed);
  }
});

test("Standard maps all 18 elements to its three solid color groups", () => {
  const editorState = createState();
  const action = applyPresetAppearance(editorState, "standard", COLORS);

  assert.equal(action.appearanceChanges.length, 18);
  getLayerElements(editorState, ICE_LAYER_KEYS).forEach((element) =>
    assert.deepEqual(element.appearance.fill, {
      kind: "solid",
      color: COLORS.iceColor,
    }),
  );
  getLayerElements(editorState, ACCENT_ONE_LAYER_KEYS).forEach((element) =>
    assert.deepEqual(element.appearance.fill, {
      kind: "solid",
      color: COLORS.accent1Color,
    }),
  );
  getLayerElements(editorState, ACCENT_TWO_LAYER_KEYS).forEach((element) =>
    assert.deepEqual(element.appearance.fill, {
      kind: "solid",
      color: COLORS.accent2Color,
    }),
  );
});

test("Standard removes gradient definitions that its solid fills make unused", () => {
  const editorState = createState();
  const layer = editorState.layers.goalLines;
  setElementsLinearGradientFill(
    editorState,
    layer.elements.map((element) => ({ layer, element })),
    {
      directionDegrees: 37,
      stops: [
        { offset: 0, color: "#111111" },
        { offset: 1, color: "#999999" },
      ],
    },
  );

  const action = applyPresetAppearance(editorState, "standard", COLORS);

  assert.deepEqual(editorState.gradientDefinitions, {});
  assert.equal(
    action.gradientDefinitionChanges.filter(
      ({ previousDefinition, nextDefinition }) =>
        previousDefinition && nextDefinition === null,
    ).length,
    2,
  );
});

test("Gradient keeps three ice elements solid and creates 15 scoped gradients", () => {
  const editorState = createState();
  const action = applyPresetAppearance(editorState, "gradient", COLORS);

  assert.equal(action.appearanceChanges.length, 18);
  getLayerElements(editorState, ICE_LAYER_KEYS).forEach((element) =>
    assert.deepEqual(element.appearance.fill, {
      kind: "solid",
      color: COLORS.iceColor,
    }),
  );
  assert.equal(Object.keys(editorState.gradientDefinitions).length, 15);

  GRADIENT_LAYER_KEYS.forEach((layerKey) => {
    const layer = editorState.layers[layerKey];
    layer.elements.forEach((element) => {
      const expectedKey = `element-${layerKey}-${element.key}`;
      assert.deepEqual(element.appearance.fill, {
        kind: "linear-gradient",
        gradientKey: expectedKey,
      });
      assert.deepEqual(editorState.gradientDefinitions[expectedKey], {
        key: expectedKey,
        kind: "linear-gradient",
        coordinateSpace: {
          kind: "element",
          layerKey,
          elementKey: element.key,
        },
        directionDegrees: layer.defaultLinearGradientDirectionDegrees,
        stops: [
          { offset: 0, color: COLORS.accent1Color },
          { offset: 1, color: COLORS.accent2Color },
        ],
      });
    });
  });
});

test("Gradient replaces a customized direction with each layer default", () => {
  const editorState = createState();
  const layer = editorState.layers.blueLines;
  const [element] = layer.elements;
  setElementsLinearGradientFill(editorState, [{ layer, element }], {
    directionDegrees: 213,
    stops: [
      { offset: 0, color: "#010101" },
      { offset: 1, color: "#020202" },
    ],
  });

  applyPresetAppearance(editorState, "gradient", COLORS);

  assert.equal(
    editorState.gradientDefinitions[`element-blueLines-${element.key}`]
      .directionDegrees,
    90,
  );
});

test("presets preserve opacity, selection, and panel state", () => {
  for (const presetKey of ["standard", "gradient"]) {
    const editorState = createState();
    editorState.layers.faceoffCircles.elements[2].isSelected = true;
    editorState.layers.blueLines.elements[0].isSelected = true;
    editorState.activeLayerKey = "blueLines";
    editorState.expandedLayerKey = "faceoffCircles";
    const interfaceStateBefore = Object.values(editorState.layers).flatMap(
      (layer) =>
        layer.elements.map((element) => ({
          key: element.key,
          opacity: element.appearance.opacity,
          isSelected: element.isSelected,
        })),
    );

    applyPresetAppearance(editorState, presetKey, COLORS);

    assert.deepEqual(
      Object.values(editorState.layers).flatMap((layer) =>
        layer.elements.map((element) => ({
          key: element.key,
          opacity: element.appearance.opacity,
          isSelected: element.isSelected,
        })),
      ),
      interfaceStateBefore,
    );
    assert.equal(editorState.activeLayerKey, "blueLines");
    assert.equal(editorState.expandedLayerKey, "faceoffCircles");
  }
});

test("one history entry undoes and redoes the complete preset", () => {
  const editorState = createState();
  const history = createUndoRedoHistory();
  const goalLineLayer = editorState.layers.goalLines;
  setElementsLinearGradientFill(
    editorState,
    [{ layer: goalLineLayer, element: goalLineLayer.elements[0] }],
    {
      directionDegrees: 27,
      stops: [
        { offset: 0, color: "#112233" },
        { offset: 1, color: "#445566" },
      ],
    },
  );
  const before = snapshotState(editorState);
  const action = applyPresetAppearance(editorState, "gradient", COLORS);
  const after = snapshotState(editorState);

  assert.equal(recordUndoRedoAction(history, action), true);
  assert.equal(history.undoStack.length, 1);
  applyUndoRedo(editorState, history, "undo");
  assert.deepEqual(snapshotState(editorState), before);
  assert.equal(history.redoStack.length, 1);
  applyUndoRedo(editorState, history, "redo");
  assert.deepEqual(snapshotState(editorState), after);
});

test("rejects an unknown preset key", () => {
  assert.throws(
    () => applyPresetAppearance(createState(), "surprise", COLORS),
    /Unknown appearance preset "surprise"/,
  );
});
