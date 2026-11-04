/*
 * INSPECTOR
 * DESCRIPTION: Manages Properties & Presets, and unapplied preview controls.
 * PROCESS: Renderer
 */

import {
  describeSelection,
  getSelectedElementsAppearanceSummary,
  getSelectedElementsWithLayers,
} from "../editor-state.js";
import {
  calculateInitialGraphicScale,
  calculateGraphicDisplaySize,
  calculateGraphicQuality,
  GRAPHIC_OVERLAY_LIMITS,
} from "../graphic-overlay.js";

const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;
const SCALE_SNAP_DISTANCE = 1;
const OFFSET_SNAP_DISTANCE = 24;

const ui = {
  inspectorTabs: [
    ...document.querySelectorAll('.inspector-tabs [role="tab"]'),
  ],
  inspectorTabpanels: [
    ...document.querySelectorAll('.inspector-panel [role="tabpanel"]'),
  ],
  activeLayerHeading: document.querySelector("#active-layer-heading"),
  activeTargetLabel: document.querySelector("#properties-panel .eyebrow"),
  fillForm: document.querySelector("#fill-form"),
  selectionSummary: document.querySelector("#selection-summary"),
  graphicForm: document.querySelector("#graphic-overlay-form"),
  graphicSourceDimensions: document.querySelector("#graphic-source-dimensions"),
  graphicDisplayDimensions: document.querySelector("#graphic-display-dimensions"),
  graphicScaleSlider: document.querySelector("#graphic-scale-slider"),
  graphicScaleMarker: document.querySelector("#graphic-scale-marker"),
  graphicScaleValue: document.querySelector("#graphic-scale-value"),
  graphicOpacitySlider: document.querySelector("#graphic-opacity-slider"),
  graphicOpacityValue: document.querySelector("#graphic-opacity-value"),
  graphicOffsetXSlider: document.querySelector("#graphic-offset-x-slider"),
  graphicOffsetXValue: document.querySelector("#graphic-offset-x-value"),
  graphicOffsetYSlider: document.querySelector("#graphic-offset-y-slider"),
  graphicOffsetYValue: document.querySelector("#graphic-offset-y-value"),
  graphicQualityWarning: document.querySelector("#graphic-quality-warning"),
  replaceGraphicButton: document.querySelector("#replace-graphic-button"),
  removeGraphicButton: document.querySelector("#remove-graphic-button"),
  fillTypeInputs: [...document.querySelectorAll('[name="fill-type"]')],
  fillMixedIndicator: document.querySelector("#fill-mixed-indicator"),
  solidFillControls: document.querySelector("#solid-fill-controls"),
  linearGradientFillControls: document.querySelector(
    "#linear-gradient-fill-controls",
  ),
  solidColorPicker: document.querySelector("#solid-color-picker"),
  solidHexInput: document.querySelector("#solid-hex-input"),
  gradientStartColorPicker: document.querySelector(
    "#gradient-start-color-picker",
  ),
  gradientStartHexInput: document.querySelector("#gradient-start-hex-input"),
  gradientEndColorPicker: document.querySelector("#gradient-end-color-picker"),
  gradientEndHexInput: document.querySelector("#gradient-end-hex-input"),
  gradientPreviewBar: document.querySelector("#gradient-preview-bar"),
  gradientDirectionDial: document.querySelector("#gradient-direction-dial"),
  gradientDirectionArrow: document.querySelector(".gradient-direction-arrow"),
  gradientDirectionInput: document.querySelector("#gradient-direction-input"),
  gradientDirectionDescription: document.querySelector(
    "#gradient-direction-description",
  ),
  gradientDirectionPresets: [
    ...document.querySelectorAll("[data-gradient-direction]"),
  ],
  applyButton: document.querySelector("#apply-button"),
  discardPreviewButtons: [...document.querySelectorAll("[data-discard-preview]")],
  applyGraphicButton: document.querySelector("#apply-graphic-button"),
  previewDialog: document.querySelector("#appearance-preview-dialog"),
  previewDialogTitle: document.querySelector("#appearance-preview-title"),
  previewDiscardButton: document.querySelector("#preview-discard-button"),
  previewApplyButton: document.querySelector("#preview-apply-button"),
  previewBackButton: document.querySelector("#preview-back-button"),
  opacitySlider: document.querySelector("#opacity-slider"),
  opacityValue: document.querySelector("#opacity-value"),
  resetButton: document.querySelector("#reset-button"),
  presetForm: document.querySelector("#preset-form"),
  presetTypeInputs: [...document.querySelectorAll('[name="preset-type"]')],
  presetIceColorPicker: document.querySelector("#preset-ice-color-picker"),
  presetIceHexInput: document.querySelector("#preset-ice-hex-input"),
  presetAccent1Label: document.querySelector("#preset-accent-1-label"),
  presetAccent1ColorPicker: document.querySelector(
    "#preset-accent-1-color-picker",
  ),
  presetAccent1HexInput: document.querySelector("#preset-accent-1-hex-input"),
  presetAccent2Label: document.querySelector("#preset-accent-2-label"),
  presetAccent2ColorPicker: document.querySelector(
    "#preset-accent-2-color-picker",
  ),
  presetAccent2HexInput: document.querySelector("#preset-accent-2-hex-input"),
  applyPresetButton: document.querySelector("#apply-preset-button"),
};

let displayedGradientDirection = 0;
let chosenGradientDirection = null;
let editedRinkProperties = { fill: false, opacity: false };
const editedGraphicProperties = new Set();
let presetPreviewStarted = false;
let mixedRinkAppearance = false;
let previewContext = null;

// ---------- Temporary appearance preview UI ----------

export function updateAppearancePreviewIndicator(context = null) {
  previewContext = context;
  ui.discardPreviewButtons.forEach((button) => {
    button.hidden = button.dataset.discardPreview !== context;
  });
  const applyButtons = [
    ["rink", ui.applyButton],
    ["graphic", ui.applyGraphicButton],
    ["preset", ui.applyPresetButton],
  ];
  applyButtons.forEach(([buttonContext, button]) => {
    const isPending = buttonContext === context ||
      (buttonContext === "rink" && mixedRinkAppearance);
    button.classList.toggle("primary-action", isPending);
    button.classList.toggle("secondary-action", !isPending);
  });
  ui.applyButton.textContent = context === "rink" ? "Apply changes" : "Apply to selection";
}

export function isAppearancePreviewDialogOpen() {
  return ui.previewDialog.open;
}

// Dialog's form supplies explicit results, Esc behaves like Back
export function confirmAppearancePreview(operation = "continue") {
  const operationTitle = operation.charAt(0).toUpperCase() + operation.slice(1);
  ui.previewDialogTitle.textContent = operation === "continue"
    ? "Continue with unapplied change?"
    : `${operationTitle} unapplied change?`;
  ui.previewDiscardButton.textContent = `Discard & ${operation}`;
  ui.previewApplyButton.textContent = `Apply & ${operation}`;
  return new Promise((resolve) => {
    ui.previewDialog.returnValue = "";
    ui.previewDialog.addEventListener("close", () => {
      const choice = ui.previewDialog.returnValue;
      resolve(["apply", "discard"].includes(choice) ? choice : "back");
    }, { once: true });
    ui.previewDialog.showModal();
    ui.previewBackButton.focus();
  });
}

// ---------- Inspector display and tabs ----------

// Returns whether the rink selections have mixed fills or opacities
export function updateInspector(editorState) {
  editedRinkProperties = { fill: false, opacity: false };
  editedGraphicProperties.clear();
  presetPreviewStarted = false;
  const showsGraphic =
    editorState.activePropertiesTarget === "graphic-overlay" &&
    editorState.graphicOverlay;

  ui.fillForm.hidden = Boolean(showsGraphic);
  ui.graphicForm.hidden = !showsGraphic;

  if (showsGraphic) {
    ui.activeTargetLabel.textContent = "Graphic overlay";
    ui.activeLayerHeading.textContent = editorState.graphicOverlay.fileName;
    syncGraphicControls(editorState.graphicOverlay);
    return false;
  }

  ui.selectionSummary.textContent = `Selection: ${describeSelection(editorState)}.`;
  const activeLayer = editorState.layers[editorState.activeLayerKey];

  ui.activeTargetLabel.textContent = "Active layer";
  ui.activeLayerHeading.textContent = activeLayer.name;
  return syncAppearanceControls(editorState);
}

export function showPropertiesTab() {
  activateInspectorTab(ui.inspectorTabs[0]);
}

function activateInspectorTab(tabToActivate, shouldFocus = false) {
  ui.inspectorTabs.forEach((tab) => {
    const isActive = tab === tabToActivate;
    tab.setAttribute("aria-selected", String(isActive));
    tab.tabIndex = isActive ? 0 : -1;
    ui.inspectorTabpanels.find(
      (panel) => panel.id === tab.getAttribute("aria-controls"),
    ).hidden = !isActive;
  });

  if (shouldFocus) {
    tabToActivate.focus();
  }
}

function handleInspectorTabKeydown(event, requestTab) {
  const currentIndex = ui.inspectorTabs.indexOf(event.currentTarget);
  let nextIndex;

  if (event.key === "ArrowRight") {
    nextIndex = (currentIndex + 1) % ui.inspectorTabs.length;
  } else if (event.key === "ArrowLeft") {
    nextIndex =
      (currentIndex - 1 + ui.inspectorTabs.length) % ui.inspectorTabs.length;
  } else if (event.key === "Home") {
    nextIndex = 0;
  } else if (event.key === "End") {
    nextIndex = ui.inspectorTabs.length - 1;
  } else {
    return;
  }

  event.preventDefault();
  requestTab(ui.inspectorTabs[nextIndex], true);
}

// ---------- Rink appearance controls ----------

function syncAppearanceControls(editorState) {
  const {
    fill,
    opacity,
    gradientDefinition,
    gradientDirection,
    hasMixedFills,
    hasMixedGradientDirections,
    hasMixedOpacities,
  } = getSelectedElementsAppearanceSummary(editorState);

  setChosenFillType(fill.kind);

  if (fill.kind === "linear-gradient") {
    setGradientColorValues(
      gradientDefinition.stops[0].color,
      gradientDefinition.stops.at(-1).color,
    );
  } else {
    setColorControlValue(ui.solidColorPicker, ui.solidHexInput, fill.color);
    setGradientColorValues(fill.color, "#000000");
  }

  syncGradientDirectionControl(
    gradientDirection,
    hasMixedGradientDirections,
  );

  mixedRinkAppearance = hasMixedFills || hasMixedOpacities;
  ui.fillMixedIndicator.hidden = !hasMixedFills;
  ui.opacitySlider.value = String(Math.round(opacity * 100));
  displayOpacityValue(ui.opacitySlider, ui.opacityValue, hasMixedOpacities);
  showFillControls(fill.kind);
  updateActionControls(editorState);
  return hasMixedFills || hasMixedOpacities;
}

function updateActionControls(editorState) {
  const hasSelection =
    editorState && getSelectedElementsWithLayers(editorState).length > 0;
  ui.applyButton.disabled = !hasSelection;
  ui.resetButton.disabled = !hasSelection;
  ui.applyPresetButton.disabled = !editorState;
  updateAppearancePreviewIndicator(previewContext);
}

// Apply uses only edited fill/opacity; with no edits, it matches both displayed values
export function getChosenRinkAppearanceUpdates(forApply = false) {
  const matchDisplayed =
    forApply && !editedRinkProperties.fill && !editedRinkProperties.opacity;
  const updates = {};
  if (editedRinkProperties.fill || matchDisplayed) {
    if (getChosenFillType() === "solid") {
      const color = validateSolidColor(forApply);
      if (!color) return null;
      updates.fill = { kind: "solid", color };
    } else {
      const colors = validateGradientColors(forApply);
      if (!colors) return null;
      updates.fill = {
        kind: "linear-gradient",
        directionDegrees: matchDisplayed ? displayedGradientDirection : chosenGradientDirection,
        stops: [
          { offset: 0, color: colors.startColor },
          { offset: 1, color: colors.endColor },
        ],
      };
    }
  }
  if (editedRinkProperties.opacity || matchDisplayed) updates.opacity = getChosenOpacity();
  return updates;
}

function validateSolidColor(forApply = true) {
  const color = normalizeHexColor(ui.solidHexInput.value);
  setHexValidity(ui.solidHexInput, Boolean(color));

  if (color && forApply) {
    setColorControlValue(ui.solidColorPicker, ui.solidHexInput, color);
  } else if (!color && forApply) {
    ui.solidHexInput.focus();
  }

  return color;
}

function getChosenFillType() {
  return (
    ui.fillTypeInputs.find((fillTypeInput) => fillTypeInput.checked)?.value ??
    "solid"
  );
}

function getChosenOpacity() {
  return getOpacityValue(ui.opacitySlider);
}

function handleFillTypeChange(event, editorState) {
  if (!editorState) {
    showFillControls(event.target.value);
    updateActionControls(editorState);
    return;
  }

  const {
    fill,
    gradientDefinition,
    gradientDirection,
    hasMixedGradientDirections,
  } =
    getSelectedElementsAppearanceSummary(editorState);

  if (event.target.value === "linear-gradient") {
    if (gradientDefinition) {
      setGradientColorValues(
        gradientDefinition.stops[0].color,
        gradientDefinition.stops.at(-1).color,
      );
    } else {
      setGradientColorValues(fill.color, "#000000");
    }
    syncGradientDirectionControl(
      gradientDirection,
      hasMixedGradientDirections,
    );
  } else {
    setColorControlValue(
      ui.solidColorPicker,
      ui.solidHexInput,
      gradientDefinition?.stops[0].color ?? fill.color,
    );
  }

  showFillControls(event.target.value);
  updateActionControls(editorState);
}

function setChosenFillType(fillType) {
  ui.fillTypeInputs.forEach((fillTypeInput) => {
    fillTypeInput.checked = fillTypeInput.value === fillType;
  });
}

function showFillControls(fillType) {
  const isGradient = fillType === "linear-gradient";
  ui.solidFillControls.hidden = isGradient;
  ui.linearGradientFillControls.hidden = !isGradient;
}

// ---------- Shared color and opacity controls ----------

function getOpacityValue(control) {
  return Number(control.value) / 100;
}

function displayOpacityValue(control, output, isMixed = false) {
  output.textContent = isMixed ? "Mixed" : `${formatPercentage(Number(control.value))}%`;
}

function formatPercentage(value) {
  return Number(value.toFixed(2)).toString();
}

function handleColorPickerInput(colorPicker, hexInput) {
  hexInput.value = colorPicker.value.toUpperCase();
  setHexValidity(hexInput, true);
  updateGradientPreviewFor(colorPicker);
}

function handleHexInput(colorPicker, hexInput) {
  const color = normalizeHexColor(hexInput.value);

  setHexValidity(hexInput, Boolean(color));
  if (color) {
    colorPicker.value = color;
    setHexValidity(hexInput, true);
    updateGradientPreviewFor(colorPicker);
  }
}

function setColorControlValue(colorPicker, hexInput, color) {
  colorPicker.value = color;
  hexInput.value = color;
  setHexValidity(hexInput, true);
}

function normalizeHexColor(value) {
  const trimmedValue = value.trim();
  return HEX_COLOR_PATTERN.test(trimmedValue) ? trimmedValue.toUpperCase() : null;
}

function setHexValidity(hexInput, isValid) {
  hexInput.setAttribute("aria-invalid", String(!isValid));
  hexInput.classList.toggle("input-error", !isValid);
}

// ---------- Linear gradient controls ----------

export function validateGradientColors(forApply = true) {
  const startColor = normalizeHexColor(ui.gradientStartHexInput.value);
  const endColor = normalizeHexColor(ui.gradientEndHexInput.value);

  setHexValidity(ui.gradientStartHexInput, Boolean(startColor));
  setHexValidity(ui.gradientEndHexInput, Boolean(endColor));

  if (!startColor || !endColor) {
    if (forApply) (startColor ? ui.gradientEndHexInput : ui.gradientStartHexInput).focus();
    return null;
  }

  if (forApply) setGradientColorValues(startColor, endColor);
  return { startColor, endColor };
}

// Keeps control in sync without treating displayed value as a user edit
function syncGradientDirectionControl(directionDegrees, isMixed) {
  chosenGradientDirection = null;
  displayGradientDirection(directionDegrees, isMixed);
}

function chooseGradientDirection(directionDegrees, onAppearancePreview) {
  chosenGradientDirection = normalizeGradientDirection(directionDegrees);
  displayGradientDirection(chosenGradientDirection, false);

  editedRinkProperties.fill = true;
  onAppearancePreview();
}

function displayGradientDirection(directionDegrees, isMixed) {
  displayedGradientDirection = directionDegrees;
  ui.gradientDirectionDial.style.setProperty(
    "--gradient-direction",
    isMixed ? "0deg" : `${directionDegrees}deg`,
  );
  ui.gradientDirectionArrow.textContent = isMixed ? "—" : "→";
  ui.gradientDirectionDial.setAttribute("aria-valuenow", String(directionDegrees));

  if (isMixed) {
    ui.gradientDirectionDial.setAttribute("aria-valuetext", "Mixed directions");
    ui.gradientDirectionInput.value = "";
    ui.gradientDirectionInput.placeholder = "—";
    ui.gradientDirectionDescription.textContent = "Mixed directions";
  } else {
    const description = describeGradientDirection(directionDegrees);
    ui.gradientDirectionDial.setAttribute(
      "aria-valuetext",
      `${directionDegrees} degrees, ${description.toLowerCase()}`,
    );
    ui.gradientDirectionInput.value = String(directionDegrees);
    ui.gradientDirectionInput.placeholder = "";
    ui.gradientDirectionDescription.textContent = description;
  }

  ui.gradientDirectionPresets.forEach((preset) => {
    const isChosenPreset =
      !isMixed && Number(preset.dataset.gradientDirection) === directionDegrees;
    preset.setAttribute("aria-pressed", String(isChosenPreset));
  });
}

function describeGradientDirection(directionDegrees) {
  const cardinalDirections = {
    0: "Left to right",
    90: "Top to bottom",
    180: "Right to left",
    270: "Bottom to top",
  };

  return (
    cardinalDirections[directionDegrees] ??
    `${directionDegrees}° clockwise from left to right`
  );
}

function normalizeGradientDirection(directionDegrees) {
  return ((Math.round(directionDegrees) % 360) + 360) % 360;
}

function getPointerGradientDirection(event) {
  const dialBounds = ui.gradientDirectionDial.getBoundingClientRect();
  const x = event.clientX - (dialBounds.left + dialBounds.width / 2);
  const y = event.clientY - (dialBounds.top + dialBounds.height / 2);

  return normalizeGradientDirection(Math.atan2(y, x) * 180 / Math.PI);
}

function handleGradientDirectionKeydown(event, onAppearancePreview) {
  const directionChange = event.shiftKey ? 15 : 1;
  let nextDirection;

  if (["ArrowRight", "ArrowUp"].includes(event.key)) {
    nextDirection = displayedGradientDirection + directionChange;
  } else if (["ArrowLeft", "ArrowDown"].includes(event.key)) {
    nextDirection = displayedGradientDirection - directionChange;
  } else if (event.key === "Home") {
    nextDirection = 0;
  } else if (event.key === "End") {
    nextDirection = 359;
  } else {
    return;
  }

  event.preventDefault();
  chooseGradientDirection(nextDirection, onAppearancePreview);
}

function setGradientColorValues(startColor, endColor) {
  setColorControlValue(
    ui.gradientStartColorPicker,
    ui.gradientStartHexInput,
    startColor,
  );
  setColorControlValue(
    ui.gradientEndColorPicker,
    ui.gradientEndHexInput,
    endColor,
  );
  updateGradientPreview();
}

function updateGradientPreviewFor(colorPicker) {
  if (
    colorPicker === ui.gradientStartColorPicker ||
    colorPicker === ui.gradientEndColorPicker
  ) {
    updateGradientPreview();
  }
}

function updateGradientPreview() {
  ui.gradientPreviewBar.style.setProperty(
    "--gradient-start",
    ui.gradientStartColorPicker.value,
  );
  ui.gradientPreviewBar.style.setProperty(
    "--gradient-end",
    ui.gradientEndColorPicker.value,
  );
}

// ---------- Graphic overlay controls ----------

function syncGraphicControls(graphic) {
  const defaultScale = calculateInitialGraphicScale(
    graphic.sourceWidth,
    graphic.sourceHeight,
  );
  const defaultScalePercent = defaultScale * 100;
  const scaleMinimumPercent = Math.min(
    GRAPHIC_OVERLAY_LIMITS.minScale * 100,
    defaultScalePercent,
    graphic.scale * 100,
  );
  const scaleMaximumPercent = GRAPHIC_OVERLAY_LIMITS.maxScale * 100;
  const markerPercent = Math.min(
    scaleMaximumPercent,
    Math.max(scaleMinimumPercent, defaultScalePercent),
  );

  ui.graphicSourceDimensions.textContent =
    `${graphic.sourceWidth} × ${graphic.sourceHeight} px`;
  ui.graphicScaleSlider.min = String(scaleMinimumPercent);
  ui.graphicScaleSlider.value = String(graphic.scale * 100);
  ui.graphicScaleMarker.style.setProperty(
    "--default-position",
    (markerPercent - scaleMinimumPercent) /
      (scaleMaximumPercent - scaleMinimumPercent),
  );
  ui.graphicOpacitySlider.value = String(Math.round(graphic.opacity * 100));
  ui.graphicOffsetXSlider.value = String(graphic.offsetX);
  ui.graphicOffsetYSlider.value = String(graphic.offsetY);
  updateGraphicOverlayControlDisplay(graphic);
}

function updateGraphicOverlayControlDisplay(graphic) {
  const scale = Number(ui.graphicScaleSlider.value) / 100;
  const offsetX = Number(ui.graphicOffsetXSlider.value);
  const offsetY = Number(ui.graphicOffsetYSlider.value);
  const displaySize = calculateGraphicDisplaySize(
    graphic.sourceWidth,
    graphic.sourceHeight,
    scale,
  );
  const quality = calculateGraphicQuality(scale);

  ui.graphicScaleValue.textContent = `${formatPercentage(scale * 100)}%`;
  ui.graphicScaleSlider.setAttribute(
    "aria-valuetext",
    `${formatPercentage(scale * 100)}% (default ${formatPercentage(
      calculateInitialGraphicScale(graphic.sourceWidth, graphic.sourceHeight) * 100,
    )}%)`,
  );
  displayOpacityValue(ui.graphicOpacitySlider, ui.graphicOpacityValue);
  ui.graphicOffsetXValue.textContent = `${offsetX} px`;
  ui.graphicOffsetYValue.textContent = `${offsetY} px`;
  ui.graphicDisplayDimensions.textContent =
    `${Math.round(displaySize.width)} × ${Math.round(displaySize.height)} px`;
  ui.graphicQualityWarning.hidden = quality.severity === "none";
  ui.graphicQualityWarning.dataset.severity = quality.severity;
  ui.graphicQualityWarning.textContent = quality.severity === "danger"
    ? "Strong enlargement: this PNG is above 130% of native size and may noticeably lose quality."
    : "Enlarged PNG: this graphic is above its native size and may lose some quality.";
}

export function getChosenGraphicOverlaySettings(forApply = true) {
  const settings = {
    scale: Number(ui.graphicScaleSlider.value) / 100,
    opacity: getOpacityValue(ui.graphicOpacitySlider),
    offsetX: Number(ui.graphicOffsetXSlider.value),
    offsetY: Number(ui.graphicOffsetYSlider.value),
  };
  const controls = [
    [
      ui.graphicScaleSlider,
      settings.scale <= GRAPHIC_OVERLAY_LIMITS.maxScale &&
        settings.scale >= Number(ui.graphicScaleSlider.min) / 100,
    ],
    [ui.graphicOpacitySlider, settings.opacity >= 0 && settings.opacity <= 1],
    [
      ui.graphicOffsetXSlider,
      settings.offsetX >= GRAPHIC_OVERLAY_LIMITS.minOffsetX &&
        settings.offsetX <= GRAPHIC_OVERLAY_LIMITS.maxOffsetX,
    ],
    [
      ui.graphicOffsetYSlider,
      settings.offsetY >= GRAPHIC_OVERLAY_LIMITS.minOffsetY &&
        settings.offsetY <= GRAPHIC_OVERLAY_LIMITS.maxOffsetY,
    ],
  ];
  const invalidControl = controls.find(([, isValid]) => !isValid)?.[0];

  if (forApply) invalidControl?.focus();
  return invalidControl || !Object.values(settings).every(Number.isFinite)
    ? null
    : Object.fromEntries(Object.entries(settings).filter(([key]) => editedGraphicProperties.has(key)));
}

// Pointer drags snap near the default value; keyboard input keeps slider's normal steps
function connectSnappingGraphicSlider(
  control,
  getSnapValue,
  snapDistance,
  getEditorState,
  onInput,
) {
  let isPointerDrag = false;

  control.addEventListener("pointerdown", () => {
    isPointerDrag = true;
  });
  ["pointerup", "pointercancel"].forEach((eventName) => {
    control.addEventListener(eventName, () => {
      isPointerDrag = false;
    });
  });
  control.addEventListener("input", () => {
    const snapValue = getSnapValue();
    if (
      isPointerDrag &&
      Number.isFinite(snapValue) &&
      Math.abs(Number(control.value) - snapValue) <= snapDistance
    ) {
      control.value = String(snapValue);
    }

    const graphic = getEditorState()?.graphicOverlay;
    if (graphic) {
      updateGraphicOverlayControlDisplay(graphic);
      onInput();
    }
  });
}

// ---------- Preset controls ----------

export function getChosenPresetType() {
  return (
    ui.presetTypeInputs.find((presetTypeInput) => presetTypeInput.checked)
      ?.value ?? "standard"
  );
}

export function validatePresetColors(forApply = true) {
  const controls = [
    [ui.presetIceColorPicker, ui.presetIceHexInput, "iceColor"],
    [ui.presetAccent1ColorPicker, ui.presetAccent1HexInput, "accent1Color"],
    [ui.presetAccent2ColorPicker, ui.presetAccent2HexInput, "accent2Color"],
  ];
  const colors = {};
  let firstInvalidInput = null;

  controls.forEach(([picker, hexInput, colorKey]) => {
    const color = normalizeHexColor(hexInput.value);
    setHexValidity(hexInput, Boolean(color));

    if (color) {
      if (forApply) setColorControlValue(picker, hexInput, color);
      colors[colorKey] = color;
    } else {
      firstInvalidInput ??= hexInput;
    }
  });

  if (forApply) firstInvalidInput?.focus();
  return firstInvalidInput ? null : colors;
}

function updatePresetColorLabels() {
  const isGradient = getChosenPresetType() === "gradient";
  ui.presetAccent1Label.textContent = isGradient
    ? "Gradient start color"
    : "Accent color 1";
  ui.presetAccent2Label.textContent = isGradient
    ? "Gradient end color"
    : "Accent color 2";
  ui.presetAccent1HexInput.setAttribute(
    "aria-label",
    isGradient ? "Gradient start hex color" : "Accent 1 hex color",
  );
  ui.presetAccent2HexInput.setAttribute(
    "aria-label",
    isGradient ? "Gradient end hex color" : "Accent 2 hex color",
  );
}

// ---------- Event wiring ----------

function connectTabEvents(onContextChange) {
  const requestTab = async (tab, shouldFocus = false) => {
    if (tab.getAttribute("aria-selected") === "true") return;
    const context = tab.getAttribute("aria-controls") === "presets-panel" ? "preset" : "properties";
    if (await onContextChange(context)) activateInspectorTab(tab, shouldFocus);
  };
  ui.inspectorTabs.forEach((tab) => {
    tab.addEventListener("click", () => requestTab(tab));
    tab.addEventListener("keydown", (event) => handleInspectorTabKeydown(event, requestTab));
  });
}

function connectColorEvents({ onRinkPreview, onPresetPreview }) {
  const colorControls = [
    [ui.solidColorPicker, ui.solidHexInput, "rink"],
    [ui.gradientStartColorPicker, ui.gradientStartHexInput, "rink"],
    [ui.gradientEndColorPicker, ui.gradientEndHexInput, "rink"],
    [ui.presetIceColorPicker, ui.presetIceHexInput, "preset"],
    [ui.presetAccent1ColorPicker, ui.presetAccent1HexInput, "preset"],
    [ui.presetAccent2ColorPicker, ui.presetAccent2HexInput, "preset"],
  ];
  colorControls.forEach(([picker, hexInput, context]) => {
    const reportPreview = () => {
      if (context === "preset") {
        presetPreviewStarted = true;
        onPresetPreview();
      } else {
        editedRinkProperties.fill = true;
        onRinkPreview();
      }
    };
    picker.addEventListener("input", () => {
      handleColorPickerInput(picker, hexInput);
      reportPreview();
    });
    hexInput.addEventListener("input", () => {
      handleHexInput(picker, hexInput);
      reportPreview();
    });
  });
}

function connectAppearanceEvents({
  getEditorState,
  onApply,
  onRinkPreview,
  onReset,
  onDiscardPreview,
}) {
  ui.fillTypeInputs.forEach((fillTypeInput) => {
    fillTypeInput.addEventListener("change", (event) => {
      handleFillTypeChange(event, getEditorState());
      editedRinkProperties.fill = true;
      onRinkPreview();
    });
  });
  ui.fillForm.addEventListener("submit", (event) => {
    event.preventDefault();
    onApply();
  });
  ui.opacitySlider.addEventListener("input", () => {
    displayOpacityValue(ui.opacitySlider, ui.opacityValue);
    editedRinkProperties.opacity = true;
    onRinkPreview();
  });
  ui.resetButton.addEventListener("click", onReset);
  ui.discardPreviewButtons.forEach((button) => {
    button.addEventListener("click", onDiscardPreview);
  });
}

function connectPresetEvents({ onApplyPreset, onPresetPreview }) {
  ui.presetTypeInputs.forEach((presetTypeInput) => {
    presetTypeInput.addEventListener("change", () => {
      updatePresetColorLabels();
      if (presetPreviewStarted) onPresetPreview();
    });
  });
  ui.presetForm.addEventListener("submit", (event) => {
    event.preventDefault();
    onApplyPreset();
  });
}

function connectGradientDirectionEvents({ getEditorState, onRinkPreview }) {
  ui.gradientDirectionDial.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    ui.gradientDirectionDial.setPointerCapture(event.pointerId);
    chooseGradientDirection(getPointerGradientDirection(event), onRinkPreview);
  });
  ui.gradientDirectionDial.addEventListener("pointermove", (event) => {
    if (ui.gradientDirectionDial.hasPointerCapture(event.pointerId)) {
      chooseGradientDirection(
        getPointerGradientDirection(event),
        onRinkPreview,
      );
    }
  });
  ui.gradientDirectionDial.addEventListener("pointerup", (event) => {
    if (ui.gradientDirectionDial.hasPointerCapture(event.pointerId)) {
      ui.gradientDirectionDial.releasePointerCapture(event.pointerId);
    }
  });
  ui.gradientDirectionDial.addEventListener("keydown", (event) =>
    handleGradientDirectionKeydown(event, onRinkPreview),
  );
  ui.gradientDirectionInput.addEventListener("input", () => {
    if (ui.gradientDirectionInput.value === "") {
      ui.gradientDirectionDescription.textContent = "Enter an angle";
      return;
    }

    const directionDegrees = Number(ui.gradientDirectionInput.value);
    if (Number.isFinite(directionDegrees)) {
      chooseGradientDirection(directionDegrees, onRinkPreview);
    }
  });
  ui.gradientDirectionInput.addEventListener("change", () => {
    if (ui.gradientDirectionInput.value === "") {
      const { gradientDirection, hasMixedGradientDirections } =
        getSelectedElementsAppearanceSummary(getEditorState());
      syncGradientDirectionControl(
        gradientDirection,
        hasMixedGradientDirections,
      );
      editedRinkProperties.fill = true;
      onRinkPreview();
      return;
    }

    const directionDegrees = Number(ui.gradientDirectionInput.value);
    if (Number.isFinite(directionDegrees)) {
      chooseGradientDirection(directionDegrees, onRinkPreview);
    }
  });
  ui.gradientDirectionPresets.forEach((preset) => {
    preset.addEventListener("click", () =>
      chooseGradientDirection(Number(preset.dataset.gradientDirection), onRinkPreview),
    );
  });
}

function connectGraphicEvents({
  getEditorState,
  onApplyGraphic,
  onReplaceGraphic,
  onRemoveGraphic,
  onGraphicPreview,
}) {
  ui.graphicScaleSlider.max = String(GRAPHIC_OVERLAY_LIMITS.maxScale * 100);
  ui.graphicOffsetXSlider.min = String(GRAPHIC_OVERLAY_LIMITS.minOffsetX);
  ui.graphicOffsetXSlider.max = String(GRAPHIC_OVERLAY_LIMITS.maxOffsetX);
  ui.graphicOffsetYSlider.min = String(GRAPHIC_OVERLAY_LIMITS.minOffsetY);
  ui.graphicOffsetYSlider.max = String(GRAPHIC_OVERLAY_LIMITS.maxOffsetY);

  connectSnappingGraphicSlider(
    ui.graphicScaleSlider,
    () => {
      const graphic = getEditorState()?.graphicOverlay;
      return graphic
        ? calculateInitialGraphicScale(
          graphic.sourceWidth,
          graphic.sourceHeight,
        ) * 100
        : NaN;
    },
    SCALE_SNAP_DISTANCE,
    getEditorState,
    () => { editedGraphicProperties.add("scale"); onGraphicPreview(); },
  );
  connectSnappingGraphicSlider(
    ui.graphicOpacitySlider,
    () => NaN,
    0,
    getEditorState,
    () => { editedGraphicProperties.add("opacity"); onGraphicPreview(); },
  );
  connectSnappingGraphicSlider(
    ui.graphicOffsetXSlider,
    () => 0,
    OFFSET_SNAP_DISTANCE,
    getEditorState,
    () => { editedGraphicProperties.add("offsetX"); onGraphicPreview(); },
  );
  connectSnappingGraphicSlider(
    ui.graphicOffsetYSlider,
    () => 0,
    OFFSET_SNAP_DISTANCE,
    getEditorState,
    () => { editedGraphicProperties.add("offsetY"); onGraphicPreview(); },
  );
  ui.graphicForm.addEventListener("submit", (event) => {
    event.preventDefault();
    onApplyGraphic();
  });
  ui.replaceGraphicButton.addEventListener("click", onReplaceGraphic);
  ui.removeGraphicButton.addEventListener("click", onRemoveGraphic);
}

export function connectInspectorEvents(actions) {
  connectTabEvents(actions.onContextChange);
  connectColorEvents(actions);
  connectAppearanceEvents(actions);
  connectPresetEvents(actions);
  connectGradientDirectionEvents(actions);
  connectGraphicEvents(actions);
}
