/*
 * APPEARANCE PRESETS
 * DESCRIPTION: Builds and applies preset recipes using normal editor actions.
 * PROCESS: Renderer
 */

import {
  applyEditorAction,
  createElementsAppearanceAction,
  getUnusedGradientDefinitionChanges,
} from "./editor-state.js";

const ICE_LAYER_KEYS = ["ice", "goalieCreases"];
const ACCENT_ONE_LAYER_KEYS = [
  "goalLines",
  "centerLine",
  "neutralZoneDots",
  "faceoffCircles",
];
const ACCENT_TWO_LAYER_KEYS = ["blueLines", "centerCircle"];
const GRADIENT_LAYER_KEYS = [
  ...ACCENT_ONE_LAYER_KEYS,
  ...ACCENT_TWO_LAYER_KEYS,
];

// ---------- Preset recipe targets and action construction ----------

function getLayerElements(editorState, layerKeys) {
  return layerKeys.flatMap((layerKey) => {
    const layer = editorState.layers[layerKey];

    if (!layer) {
      throw new Error(`No rink layer was found for "${layerKey}".`);
    }

    return layer.elements.map((element) => ({ layer, element }));
  });
}

function mergeActions(editorState, ...actions) {
  const appearanceChanges = actions.flatMap((action) => action.appearanceChanges);
  // Check unused gradients after combining all recipe groups
  return {
    appearanceChanges,
    gradientDefinitionChanges: [
      ...actions.flatMap((action) => action.gradientDefinitionChanges)
        .filter((change) => change.nextDefinition),
      ...getUnusedGradientDefinitionChanges(editorState, appearanceChanges),
    ],
  };
}

function createStandardPresetAction(editorState, colors) {
  return mergeActions(
    editorState,
    createElementsAppearanceAction(
      editorState,
      getLayerElements(editorState, ICE_LAYER_KEYS),
      { fill: { kind: "solid", color: colors.iceColor } },
    ),
    createElementsAppearanceAction(
      editorState,
      getLayerElements(editorState, ACCENT_ONE_LAYER_KEYS),
      { fill: { kind: "solid", color: colors.accent1Color } },
    ),
    createElementsAppearanceAction(
      editorState,
      getLayerElements(editorState, ACCENT_TWO_LAYER_KEYS),
      { fill: { kind: "solid", color: colors.accent2Color } },
    ),
  );
}

function createGradientPresetAction(editorState, colors) {
  const actions = [
    createElementsAppearanceAction(
      editorState,
      getLayerElements(editorState, ICE_LAYER_KEYS),
      { fill: { kind: "solid", color: colors.iceColor } },
    ),
  ];

  GRADIENT_LAYER_KEYS.forEach((layerKey) => {
    const layer = editorState.layers[layerKey];
    actions.push(
      createElementsAppearanceAction(
        editorState,
        getLayerElements(editorState, [layerKey]),
        {
          fill: {
            kind: "linear-gradient",
            directionDegrees: layer.defaultLinearGradientDirectionDegrees,
            stops: [
              { offset: 0, color: colors.accent1Color },
              { offset: 1, color: colors.accent2Color },
            ],
          },
        },
      ),
    );
  });

  return mergeActions(editorState, ...actions);
}

// ---------- Public preset actions ----------

export function applyPresetAppearance(editorState, presetKey, colors) {
  const action = createPresetAppearanceAction(editorState, presetKey, colors);
  return applyEditorAction(editorState, action);
}

export function createPresetAppearanceAction(editorState, presetKey, colors) {
  if (presetKey === "standard") {
    return createStandardPresetAction(editorState, colors);
  }

  if (presetKey === "gradient") {
    return createGradientPresetAction(editorState, colors);
  }

  throw new Error(`Unknown appearance preset "${presetKey}".`);
}
