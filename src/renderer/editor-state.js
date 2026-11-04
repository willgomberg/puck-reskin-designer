/*
 * EDITOR STATE
 * DESCRIPTION: Manages plain editor data, selections, actions, and undo/redo.
 * PROCESS: Renderer
 */

import { rinkLayerDefinitions } from "./layer-definitions.js";

const MAX_UNDO_STEPS = 15;

// ---------- State creation and copying ----------

export function createEditorState(originalAppearanceByElementKey) {
  const layers = {};
  const firstLayerKey = Object.keys(rinkLayerDefinitions)[0];

  for (const [layerKey, layerDefinition] of Object.entries(rinkLayerDefinitions)) {
    layers[layerKey] = {
      ...layerDefinition,
      key: layerKey,
      elements: layerDefinition.elements.map((elementDefinition) => {
        const originalAppearance =
          originalAppearanceByElementKey[elementDefinition.key];

        if (!originalAppearance) {
          throw new Error(
            `No original appearance was found for "${elementDefinition.name}".`,
          );
        }

        return {
          ...elementDefinition,
          originalAppearance: copyAppearance(originalAppearance),
          appearance: copyAppearance(originalAppearance),
          isSelected: false,
        };
      }),
    };
  }

  return {
    layers,
    gradientDefinitions: {},
    graphicOverlay: null,
    activeLayerKey: firstLayerKey,
    expandedLayerKey: null,
    activePropertiesTarget: "rink-layer",
  };
}

export function loadProjectIntoEditorState(editorState, project) {
  Object.entries(project.layers).forEach(([layerKey, savedLayer]) => {
    Object.entries(savedLayer.elements).forEach(([elementKey, savedElement]) => {
      const element = editorState.layers[layerKey].elements.find(
        (candidate) => candidate.key === elementKey,
      );
      element.appearance = copyAppearance(savedElement.appearance);
    });
  });

  editorState.gradientDefinitions = structuredClone(
    project.gradientDefinitions,
  );
  editorState.graphicOverlay = copyGraphicOverlay(project.graphicOverlay);
}

function copyAppearance(appearance) {
  return structuredClone(appearance);
}

function copyGradientDefinition(gradientDefinition) {
  if (!gradientDefinition) {
    return null;
  }

  return {
    ...gradientDefinition,
    coordinateSpace: { ...gradientDefinition.coordinateSpace },
    stops: gradientDefinition.stops.map((stop) => ({ ...stop })),
  };
}

// A shallow copy isolates settings, PNG data URL is an immutable string
function copyGraphicOverlay(graphicOverlay) {
  return graphicOverlay ? { ...graphicOverlay } : null;
}

// ---------- Selection ----------

// Checkboxes set selection explicitly; name clicks replace or Ctrl/Cmd-toggle it
export function setRinkSelection(
  editorState,
  layerKey,
  elementKey = null,
  { replace = false, isSelected } = {},
) {
  const layer = editorState.layers[layerKey];
  const targets = elementKey
    ? layer.elements.filter((element) => element.key === elementKey)
    : layer.elements;
  const nextSelected =
    isSelected ??
    (replace || !targets.every((element) => element.isSelected));
  const changedLayerKeys = new Set();

  Object.values(editorState.layers).forEach((candidateLayer) => {
    candidateLayer.elements.forEach((element) => {
      const isTarget = candidateLayer === layer && targets.includes(element);

      if (!isTarget && !replace) return;

      const nextValue = isTarget && nextSelected;

      if (element.isSelected !== nextValue) {
        element.isSelected = nextValue;
        changedLayerKeys.add(candidateLayer.key);
      }
    });
  });

  return { changedLayerKeys: [...changedLayerKeys], isSelected: nextSelected };
}

// ---------- State queries ----------

export function getSelectedElements(layer) {
  return layer.elements.filter((element) => element.isSelected);
}

export function getSelectedElementsWithLayers(editorState) {
  return Object.values(editorState.layers).flatMap((layer) =>
    getSelectedElements(layer).map((element) => ({ layer, element })),
  );
}

export function describeSelection(editorState) {
  const selectedElementsWithLayers = getSelectedElementsWithLayers(editorState);

  if (selectedElementsWithLayers.length === 0) {
    return "no rink elements";
  }

  if (selectedElementsWithLayers.length === 1) {
    return selectedElementsWithLayers[0].element.name.toLowerCase();
  }

  const layerCount = new Set(
    selectedElementsWithLayers.map(({ layer }) => layer.key),
  ).size;
  const layerLabel = layerCount === 1 ? "layer" : "layers";
  return `${selectedElementsWithLayers.length} elements across ${layerCount} ${layerLabel}`;
}

export function hasMultipleElements(layer) {
  return layer.elements.length > 1;
}

export function getLayerVisibility(layer) {
  const visibleElementCount = layer.elements.filter(
    (element) => element.appearance.opacity > 0,
  ).length;

  if (visibleElementCount === layer.elements.length) {
    return "visible";
  }

  return visibleElementCount === 0 ? "hidden" : "mixed";
}

export function getGradientDefinition(editorState, gradientKey) {
  const gradientDefinition = editorState.gradientDefinitions[gradientKey];

  if (!gradientDefinition) {
    throw new Error(`No gradient definition was found for "${gradientKey}".`);
  }

  return gradientDefinition;
}

// Prefer selected element in the active layer as the control reference
export function getSelectedElementsAppearanceSummary(editorState) {
  const selectedElementsWithLayers = getSelectedElementsWithLayers(editorState);
  const selectedFillSignatures = new Set(
    selectedElementsWithLayers.map(({ element }) =>
      createFillSignature(editorState, element.appearance.fill),
    ),
  );
  const selectedOpacities = new Set(
    selectedElementsWithLayers.map(({ element }) => element.appearance.opacity),
  );
  const selectedGradientDirections = new Set(
    selectedElementsWithLayers.map(({ layer, element }) =>
      getElementGradientDirection(editorState, layer, element),
    ),
  );
  const activeLayer = editorState.layers[editorState.activeLayerKey];
  const reference =
    selectedElementsWithLayers.find(({ layer }) => layer === activeLayer) ??
    selectedElementsWithLayers[0] ??
    { layer: activeLayer, element: activeLayer.elements[0] };
  const { layer: referenceLayer, element: referenceElement } = reference;

  const referenceAppearance = copyAppearance(referenceElement.appearance);
  const { fill, opacity } = referenceAppearance;
  const gradientDefinition =
    fill.kind === "linear-gradient"
      ? copyGradientDefinition(getGradientDefinition(editorState, fill.gradientKey))
      : null;
  const gradientDirection = getElementGradientDirection(
    editorState,
    referenceLayer,
    referenceElement,
  );

  return {
    fill,
    opacity,
    gradientDefinition,
    gradientDirection,
    hasMixedFills: selectedFillSignatures.size > 1,
    hasMixedGradientDirections: selectedGradientDirections.size > 1,
    hasMixedOpacities: selectedOpacities.size > 1,
  };
}

function getElementGradientDirection(editorState, layer, element) {
  if (element.appearance.fill.kind === "linear-gradient") {
    return getGradientDefinition(
      editorState,
      element.appearance.fill.gradientKey,
    ).directionDegrees;
  }

  return layer.defaultLinearGradientDirectionDegrees;
}

// Compare gradient settings rather than resource keys so equivalent fills are not marked mixed
function createFillSignature(editorState, fill) {
  if (fill.kind === "solid") {
    return `solid:${fill.color}`;
  }

  const gradientDefinition = getGradientDefinition(
    editorState,
    fill.gradientKey,
  );

  return JSON.stringify({
    kind: gradientDefinition.kind,
    coordinateSpaceKind: gradientDefinition.coordinateSpace.kind,
    directionDegrees: gradientDefinition.directionDegrees,
    stops: gradientDefinition.stops,
  });
}

// ---------- Editor action contract ----------

/*
 * Actions store before/after snapshots for appearances, gradients, and overlay.
 * Builders leave state untouched; setters and undo/redo apply changes.
 * Null gradient definitions and overlay snapshots mean absent. restoresOriginal
 * requests exact SVG reset; app.js updates the SVG and records committed actions.
 */

export function applyEditorAction(editorState, action, isUndo = false) {
  (action.gradientDefinitionChanges ?? []).forEach((change) => {
    const definition = isUndo ? change.previousDefinition : change.nextDefinition;
    if (definition) {
      editorState.gradientDefinitions[change.gradientKey] =
        copyGradientDefinition(definition);
    } else {
      delete editorState.gradientDefinitions[change.gradientKey];
    }
  });
  (action.appearanceChanges ?? []).forEach((change) => {
    const element = editorState.layers[change.layerKey].elements.find(
      (candidate) => candidate.key === change.elementKey,
    );
    element.appearance = copyAppearance(
      isUndo ? change.previousAppearance : change.nextAppearance,
    );
  });
  if (action.graphicOverlayChange) {
    editorState.graphicOverlay = copyGraphicOverlay(
      isUndo
        ? action.graphicOverlayChange.previousGraphic
        : action.graphicOverlayChange.nextGraphic,
    );
  }
  return action;
}

export function hasEditorActionChanges(action) {
  return Boolean(
    (action.appearanceChanges ?? []).some(
      ({ previousAppearance, nextAppearance }) =>
        JSON.stringify(previousAppearance) !== JSON.stringify(nextAppearance),
    ) ||
    (action.gradientDefinitionChanges ?? []).some(
      ({ previousDefinition, nextDefinition }) =>
        JSON.stringify(previousDefinition) !== JSON.stringify(nextDefinition),
    ) ||
    (action.graphicOverlayChange &&
      !areGraphicOverlaySnapshotsEqual(
        action.graphicOverlayChange.previousGraphic,
        action.graphicOverlayChange.nextGraphic,
      )),
  );
}

// ---------- Graphic overlay actions ----------

export function setGraphicOverlay(editorState, graphicOverlay) {
  const previousGraphic = copyGraphicOverlay(editorState.graphicOverlay);
  editorState.graphicOverlay = copyGraphicOverlay(graphicOverlay);

  return {
    appearanceChanges: [],
    gradientDefinitionChanges: [],
    graphicOverlayChange: {
      previousGraphic,
      nextGraphic: copyGraphicOverlay(editorState.graphicOverlay),
    },
  };
}

export function updateGraphicOverlaySettings(editorState, settings) {
  const action = createGraphicOverlaySettingsAction(editorState, settings);
  return applyEditorAction(editorState, action);
}

export function createGraphicOverlaySettingsAction(editorState, settings) {
  if (!editorState.graphicOverlay) {
    throw new Error("No graphic overlay is available to update.");
  }

  return {
    appearanceChanges: [],
    gradientDefinitionChanges: [],
    graphicOverlayChange: {
      previousGraphic: copyGraphicOverlay(editorState.graphicOverlay),
      nextGraphic: { ...editorState.graphicOverlay, ...settings },
    },
  };
}

function areGraphicOverlaySnapshotsEqual(first, second) {
  if (first === second) {
    return true;
  }

  if (!first || !second) {
    return false;
  }

  return Object.keys(first).every((key) => first[key] === second[key]) &&
    Object.keys(first).length === Object.keys(second).length;
}

// ---------- Rink appearance actions ----------

export function setSelectedElementsSolidFill(editorState, color) {
  return setElementsSolidFill(
    editorState,
    getSelectedElementsWithLayers(editorState),
    color,
  );
}

export function setElementsSolidFill(editorState, elementsWithLayers, color) {
  const action = createElementsAppearanceAction(
    editorState, elementsWithLayers, { fill: { kind: "solid", color } },
  );
  return applyEditorAction(editorState, action);
}

export function setSelectedElementsLinearGradientFill(
  editorState,
  gradientSettings,
) {
  return setElementsLinearGradientFill(
    editorState,
    getSelectedElementsWithLayers(editorState),
    gradientSettings,
  );
}

export function setElementsLinearGradientFill(
  editorState,
  elementsWithLayers,
  gradientSettings,
) {
  const action = createElementsAppearanceAction(
    editorState, elementsWithLayers, { fill: { kind: "linear-gradient", ...gradientSettings } },
  );
  return applyEditorAction(editorState, action);
}

// Omitted properties stay unchanged, so opacity edits preserve mixed fills
export function createSelectedElementsAppearanceAction(editorState, updates) {
  return createElementsAppearanceAction(
    editorState, getSelectedElementsWithLayers(editorState), updates,
  );
}

export function createElementsAppearanceAction(editorState, elementsWithLayers, updates) {
  const appearanceChanges = [];
  const gradientDefinitionChanges = [];

  elementsWithLayers.forEach(({ layer, element }) => {
    const appearanceUpdates = {};
    if (updates.opacity !== undefined) appearanceUpdates.opacity = updates.opacity;
    if (updates.fill?.kind === "solid") {
      appearanceUpdates.fill = updates.fill;
    } else if (updates.fill?.kind === "linear-gradient") {
      const gradientKey = `element-${layer.key}-${element.key}`;
      const previousDefinition = copyGradientDefinition(
        editorState.gradientDefinitions[gradientKey],
      );
      const currentDefinition = editorState.gradientDefinitions[element.appearance.fill.gradientKey];
      const nextDefinition = createElementGradientDefinition(
        gradientKey, layer, element, updates.fill, currentDefinition,
      );
      gradientDefinitionChanges.push({ gradientKey, previousDefinition, nextDefinition });
      appearanceUpdates.fill = { kind: "linear-gradient", gradientKey };
    }
    appearanceChanges.push(createAppearanceChange(layer, element, appearanceUpdates));
  });

  gradientDefinitionChanges.push(
    ...getUnusedGradientDefinitionChanges(editorState, appearanceChanges),
  );

  return { appearanceChanges, gradientDefinitionChanges };
}

export function setSelectedElementsOpacity(editorState, opacity) {
  const action = createSelectedElementsAppearanceAction(editorState, { opacity });
  return applyEditorAction(editorState, action);
}

export function setElementVisibility(
  editorState,
  layerKey,
  elementKey,
  visibility,
) {
  const layer = editorState.layers[layerKey];
  const element = layer?.elements.find(
    (candidate) => candidate.key === elementKey,
  );

  if (!element) {
    throw new Error(`No rink element was found for "${elementKey}".`);
  }

  return {
    appearanceChanges: [
      changeElementAppearance(layer, element, {
        opacity: visibility === "hidden" ? 0 : element.appearance.opacity || 1,
      }),
    ],
    gradientDefinitionChanges: [],
  };
}

export function setLayerVisibility(editorState, layerKey, visibility) {
  const layer = editorState.layers[layerKey];

  if (!layer) {
    throw new Error(`No rink layer was found for "${layerKey}".`);
  }

  return {
    appearanceChanges: layer.elements.map((element) =>
      changeElementAppearance(layer, element, {
        opacity: visibility === "hidden" ? 0 : element.appearance.opacity || 1,
      }),
    ),
    gradientDefinitionChanges: [],
  };
}

export function resetSelectedElementAppearances(editorState) {
  const appearanceChanges = getSelectedElementsWithLayers(editorState).map(
    ({ layer, element }) =>
      createAppearanceChange(layer, element, element.originalAppearance),
  );

  return applyEditorAction(editorState, {
    restoresOriginal: true,
    appearanceChanges,
    gradientDefinitionChanges: getUnusedGradientDefinitionChanges(
      editorState,
      appearanceChanges,
    ),
  });
}

function changeElementAppearance(layer, element, appearanceUpdates) {
  const change = createAppearanceChange(layer, element, appearanceUpdates);
  element.appearance = copyAppearance(change.nextAppearance);
  return change;
}

function createAppearanceChange(layer, element, appearanceUpdates) {
  return {
    layerKey: layer.key,
    elementKey: element.key,
    previousAppearance: copyAppearance(element.appearance),
    nextAppearance: copyAppearance({ ...element.appearance, ...appearanceUpdates }),
  };
}

// ---------- Gradient definition helpers ----------

function createElementGradientDefinition(
  gradientKey,
  layer,
  element,
  gradientSettings,
  previousDefinition,
) {
  const directionDegrees =
    gradientSettings.directionDegrees ??
    previousDefinition?.directionDegrees ??
    layer.defaultLinearGradientDirectionDegrees;

  return {
    key: gradientKey,
    kind: "linear-gradient",
    coordinateSpace: {
      kind: "element",
      layerKey: layer.key,
      elementKey: element.key,
    },
    directionDegrees,
    stops: gradientSettings.stops.map((stop) => ({ ...stop })),
  };
}

// Capture unused gradients in the action so undo can restore them
export function getUnusedGradientDefinitionChanges(editorState, appearanceChanges) {
  const previousGradientKeys = new Set(
    appearanceChanges
      .map(({ previousAppearance }) => previousAppearance.fill.gradientKey)
      .filter(Boolean),
  );
  const nextAppearanceByKey = new Map(
    appearanceChanges.map((change) => [change.elementKey, change.nextAppearance]),
  );
  const usedGradientKeys = new Set(
    Object.values(editorState.layers).flatMap((layer) =>
      layer.elements.map((element) =>
        (nextAppearanceByKey.get(element.key) ?? element.appearance).fill.gradientKey,
      ),
    ),
  );

  return [...previousGradientKeys].flatMap((gradientKey) => {
    const previousDefinition = editorState.gradientDefinitions[gradientKey];

    if (usedGradientKeys.has(gradientKey) || !previousDefinition) {
      return [];
    }

    return [{
      gradientKey,
      previousDefinition: copyGradientDefinition(previousDefinition),
      nextDefinition: null,
    }];
  });
}

// ---------- Undo and redo ----------

export function createUndoRedoHistory() {
  return { undoStack: [], redoStack: [] };
}

export function recordUndoRedoAction(undoRedoHistory, action) {
  const hasChanges = hasEditorActionChanges(action);

  if (!hasChanges) {
    return false;
  }

  undoRedoHistory.undoStack.push(action);
  if (undoRedoHistory.undoStack.length > MAX_UNDO_STEPS) {
    undoRedoHistory.undoStack.shift();
  }
  undoRedoHistory.redoStack.length = 0;
  return true;
}

export function applyUndoRedo(editorState, undoRedoHistory, direction) {
  const isUndo = direction === "undo";
  const sourceStack = isUndo
    ? undoRedoHistory.undoStack
    : undoRedoHistory.redoStack;
  const destinationStack = isUndo
    ? undoRedoHistory.redoStack
    : undoRedoHistory.undoStack;
  const action = sourceStack.pop();

  if (!action) {
    return null;
  }

  applyEditorAction(editorState, action, isUndo);

  destinationStack.push(action);
  return action;
}
