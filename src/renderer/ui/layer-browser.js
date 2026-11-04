/*
 * LAYER BROWSER
 * DESCRIPTION: Displays & updates layer browser & its graphic overlay subsection
 * PROCESS: Renderer
 */

import {
  getGradientDefinition,
  getLayerVisibility,
  getSelectedElements,
  hasMultipleElements,
} from "../editor-state.js";

const ui = {
  layerList: document.querySelector("#layer-list"),
  layerBrowserRowTemplate: document.querySelector("#layer-browser-row-template"),
  elementListTemplate: document.querySelector("#element-list-template"),
  layerHelp: document.querySelector(".layer-help"),
  layerHelpButton: document.querySelector("#layer-help-button"),
  selectionHelp: document.querySelector("#layer-selection-help"),
  graphicRow: document.querySelector("#graphic-overlay-row"),
  graphicSwatch: document.querySelector("#graphic-overlay-swatch"),
  graphicName: document.querySelector("#graphic-overlay-name"),
  graphicFileInput: document.querySelector("#graphic-overlay-file-input"),
};

// ---------- Creation ----------

export function buildLayerBrowser(editorState) {
  ui.layerList.replaceChildren();

  Object.values(editorState.layers).forEach((layer) => {
    const layerGroup = document.createElement("div");
    layerGroup.className = "layer-group";
    layerGroup.dataset.layerGroup = layer.key;
    layerGroup.append(buildLayerBrowserRow(layer));

    if (hasMultipleElements(layer)) {
      const elementList = ui.elementListTemplate.content.firstElementChild.cloneNode(
        true,
      );
      const elementOptions = elementList.querySelector(".element-options");

      elementList.dataset.elementList = layer.key;
      elementList.id = `elements-${layer.key}`;
      elementList.setAttribute("aria-label", `${layer.name} elements`);

      layer.elements.forEach((element) => {
        elementOptions.append(buildLayerBrowserRow(layer, element));
      });

      layerGroup.append(elementList);
    }

    ui.layerList.append(layerGroup);
    updateLayerGroup(editorState, layer.key);
  });

  updateGraphicOverlayRow(editorState);
}

function buildLayerBrowserRow(layer, element = null) {
  const row = ui.layerBrowserRowTemplate.content.firstElementChild.cloneNode(true);
  const checkbox = row.querySelector(".layer-checkbox");
  const visibilityButton = row.querySelector(".visibility-toggle");
  const itemButton = row.querySelector(".layer-item");
  const expansionButton = row.querySelector(".layer-expansion-toggle");
  const name = row.querySelector(".layer-name");
  const isElementRow = element !== null;
  const rowValue = element ?? layer;

  row.dataset.layerKey = layer.key;
  row.dataset.rowType = isElementRow ? "element" : "layer";
  checkbox.dataset.action = isElementRow ? "select-element" : "select-layer";
  visibilityButton.dataset.action = "toggle-visibility";
  itemButton.dataset.action = "select-item";

  checkbox.dataset.layerKey = layer.key;
  visibilityButton.dataset.layerKey = layer.key;
  itemButton.dataset.layerKey = layer.key;

  if (isElementRow) {
    row.classList.add("element-row");
    row.dataset.elementKey = element.key;
    checkbox.dataset.elementKey = element.key;
    visibilityButton.dataset.elementKey = element.key;
    itemButton.dataset.elementKey = element.key;
    checkbox.setAttribute("aria-label", `Select ${element.name.toLowerCase()}`);
  } else {
    checkbox.setAttribute("aria-label", `Select all ${layer.name.toLowerCase()}`);

    if (hasMultipleElements(layer)) {
      expansionButton.hidden = false;
      expansionButton.dataset.action = "toggle-expansion";
      expansionButton.dataset.layerKey = layer.key;
      expansionButton.setAttribute("aria-controls", `elements-${layer.key}`);
      row.classList.add("has-elements");
    }
  }

  if (expansionButton.hidden) expansionButton.remove();

  name.textContent = rowValue.name;
  return row;
}

// ---------- Updates ----------

export function updateLayerGroup(editorState, layerKey, previewAppearanceChanges = []) {
  const committedLayer = editorState.layers[layerKey];
  // Preview only the eye state. Committed fills, selection, + editor data stay intact.s
  const layer = previewAppearanceChanges.length === 0 ? committedLayer : {
    ...committedLayer,
    elements: committedLayer.elements.map((element) => {
      const change = previewAppearanceChanges.find(
        (candidate) => candidate.elementKey === element.key,
      );
      if (!change) return element;
      return {
        ...element,
        appearance: { ...element.appearance, opacity: change.nextAppearance.opacity },
      };
    }),
  };
  const layerGroup = ui.layerList.querySelector(
    `[data-layer-group="${layerKey}"]`,
  );
  const layerRow = layerGroup.querySelector('[data-row-type="layer"]');

  updateLayerBrowserRow(editorState, layerRow, layer);

  layer.elements.forEach((element) => {
    const elementRow = layerGroup.querySelector(
      `[data-element-key="${element.key}"]`,
    );

    if (elementRow) {
      updateLayerBrowserRow(editorState, elementRow, layer, element);
    }
  });

  const elementList = layerGroup.querySelector("[data-element-list]");

  if (elementList) {
    elementList.hidden = editorState.expandedLayerKey !== layerKey;
  }
}

function updateLayerBrowserRow(editorState, row, layer, element = null) {
  const checkbox = row.querySelector(".layer-checkbox");
  const visibilityButton = row.querySelector(".visibility-toggle");
  const itemButton = row.querySelector(".layer-item");
  const expansionButton = row.querySelector(".layer-expansion-toggle");
  const swatch = row.querySelector(".layer-swatch");
  const isElementRow = element !== null;
  const selectedElements = getSelectedElements(layer);
  const isSelected = isElementRow
    ? element.isSelected
    : selectedElements.length === layer.elements.length;
  const visibility = isElementRow
    ? element.appearance.opacity > 0 ? "visible" : "hidden"
    : getLayerVisibility(layer);
  const displayName = isElementRow ? element.name : layer.name;
  const isActiveLayer =
    editorState.activePropertiesTarget === "rink-layer" &&
    editorState.activeLayerKey === layer.key;
  const isExpanded = editorState.expandedLayerKey === layer.key;

  checkbox.checked = isSelected;
  checkbox.indeterminate =
    !isElementRow && selectedElements.length > 0 && !isSelected;
  row.classList.toggle(
    "has-selection",
    isElementRow ? isSelected : selectedElements.length > 0,
  );

  itemButton.classList.toggle("is-active", !isElementRow && isActiveLayer);
  itemButton.setAttribute("aria-pressed", String(isSelected));

  if (isElementRow) {
    const background = createFillBackground(
      editorState,
      element.appearance.fill,
    );
    // Cover the border so gradient endpoints don't wrap around edges
    swatch.style.background = `${background} no-repeat border-box`;
  } else {
    itemButton.setAttribute("aria-current", String(isActiveLayer));
    swatch.style.background = createLayerSwatchBackground(editorState, layer);

    if (hasMultipleElements(layer)) {
      expansionButton.setAttribute("aria-expanded", String(isExpanded));
      expansionButton.setAttribute(
        "aria-label",
        `${isExpanded ? "Collapse" : "Expand"} ${layer.name.toLowerCase()} elements`,
      );
    }
  }

  const visibilityAction = visibility === "visible" ? "Hide" : "Show";
  const rowType = isElementRow ? "element" : "layer";
  const visibilityLabel = `${visibilityAction} ${displayName} ${rowType}`;

  visibilityButton.dataset.visibility = visibility;
  visibilityButton.setAttribute(
    "aria-pressed",
    visibility === "mixed" ? "mixed" : String(visibility === "visible"),
  );
  visibilityButton.setAttribute("aria-label", visibilityLabel);
  visibilityButton.title = `${visibilityAction} ${displayName}`;
}

export function updateChangedLayerRows(editorState, appearanceChanges, isPreview = false) {
  const changedLayerKeys = new Set(
    appearanceChanges.map(({ layerKey }) => layerKey),
  );
  changedLayerKeys.forEach((layerKey) =>
    updateLayerGroup(editorState, layerKey, isPreview ? appearanceChanges : []),
  );
}

export function updateGraphicOverlayRow(editorState) {
  const graphic = editorState.graphicOverlay;
  const isActive =
    graphic && editorState.activePropertiesTarget === "graphic-overlay";

  ui.graphicRow.classList.toggle("is-active", Boolean(isActive));
  ui.graphicRow.setAttribute("aria-current", String(Boolean(isActive)));
  ui.graphicName.textContent = graphic?.fileName ?? "Add graphic overlay";
  ui.graphicRow.title = graphic?.fileName ?? "Import a PNG graphic overlay";
  ui.graphicRow.dataset.action = graphic ? "activate-graphic" : "import-graphic";
  ui.graphicSwatch.classList.toggle("is-upload", !graphic);
  ui.graphicSwatch.style.backgroundImage = graphic
    ? `url("${graphic.pngDataUrl}")`
    : "";
}

export function openGraphicOverlayFilePicker() {
  ui.graphicFileInput.value = "";
  ui.graphicFileInput.click();
}

// ---------- Swatches ----------

function createFillBackground(editorState, fill, directionDegrees = null) {
  if (fill.kind === "solid") {
    return fill.color;
  }

  const gradientDefinition = getGradientDefinition(
    editorState,
    fill.gradientKey,
  );
  // CSS 0deg points up, while the editor's 0deg points right
  const cssAngle = ((directionDegrees ?? gradientDefinition.directionDegrees) + 90) % 360;
  const stops = gradientDefinition.stops.map(
    (stop) => `${stop.color} ${stop.offset * 100}%`,
  );

  return `linear-gradient(${cssAngle}deg, ${stops.join(", ")})`;
}

// Shows one shared fill accurately, or shows segmented by element for mixed fills
function createLayerSwatchBackground(editorState, layer) {
  const fillBackgrounds = layer.elements.map((element) =>
    createFillBackground(editorState, element.appearance.fill),
  );

  if (new Set(fillBackgrounds).size === 1) {
    return `${fillBackgrounds[0]} no-repeat border-box`;
  }

  const segmentSize = 100 / layer.elements.length;
  const segments = layer.elements.map((element, index) => {
    const { fill } = element.appearance;
    const background =
      fill.kind === "solid"
        ? `linear-gradient(${fill.color}, ${fill.color})`
        : createFillBackground(editorState, fill, 90);
    // Prevent fractional px values from creating gaps in swatch segments
    const width = (index + 1) * segmentSize;

    return `${background} 0 0 / ${width}% 100% no-repeat border-box`;
  });

  return segments.join(", ");
}

// ---------- Events ----------

export function connectLayerBrowserEvents(actions) {
  connectSelectionHelpEvents();
  ui.layerList.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action]");

    if (!button || !ui.layerList.contains(button)) {
      return;
    }

    const { action, layerKey, elementKey } = button.dataset;

    if (action === "select-item") {
      actions.onSelectionChange(layerKey, elementKey, {
        replace: !(event.ctrlKey || event.metaKey),
      });
    } else if (action === "toggle-expansion") {
      actions.onLayerExpansionToggle(layerKey);
    } else if (action === "toggle-visibility") {
      actions.onVisibilityToggle(layerKey, elementKey, button.dataset.visibility);
    }
  });

  ui.layerList.addEventListener("change", (event) => {
    const checkbox = event.target.closest('input[type="checkbox"][data-action]');

    if (!checkbox || !ui.layerList.contains(checkbox)) {
      return;
    }

    const { action, layerKey, elementKey } = checkbox.dataset;

    if (action === "select-layer" || action === "select-element") {
      actions.onSelectionChange(layerKey, elementKey, { isSelected: checkbox.checked });
    }
  });

  ui.graphicRow.addEventListener("click", () => {
    if (ui.graphicRow.dataset.action === "activate-graphic") {
      actions.onGraphicClick();
    } else {
      openGraphicOverlayFilePicker();
    }
  });
  ui.graphicFileInput.addEventListener("change", () => {
    const file = ui.graphicFileInput.files[0];
    if (file) {
      actions.onGraphicFileChosen(file);
    }
  });
}

function connectSelectionHelpEvents() {
  const showHelp = () => {
    ui.selectionHelp.hidden = false;
  };
  const hideHelp = () => {
    ui.selectionHelp.hidden = true;
  };

  ui.layerHelp.addEventListener("pointerenter", showHelp);
  ui.layerHelp.addEventListener("pointerleave", () => {
    if (!ui.layerHelp.contains(document.activeElement)) hideHelp();
  });
  ui.layerHelpButton.addEventListener("focus", showHelp);
  ui.layerHelpButton.addEventListener("blur", hideHelp);
  ui.layerHelpButton.addEventListener("click", showHelp);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") hideHelp();
  });
  document.addEventListener("pointerdown", (event) => {
    if (!ui.layerHelp.contains(event.target)) hideHelp();
  });
}
