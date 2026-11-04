/*
 * EDITOR APPLICATION
 * DESCRIPTION: Coordinates editor state, SVG updates, UI, and desktop actions.
 * PROCESS: Renderer
 */

import "./style.css";
import {
  applyEditorAction,
  applyUndoRedo,
  createUndoRedoHistory,
  createEditorState,
  createGraphicOverlaySettingsAction,
  createSelectedElementsAppearanceAction,
  describeSelection,
  getSelectedElementsWithLayers,
  hasEditorActionChanges,
  hasMultipleElements,
  loadProjectIntoEditorState,
  resetSelectedElementAppearances,
  recordUndoRedoAction,
  setGraphicOverlay,
  setElementVisibility,
  setLayerVisibility,
  setRinkSelection,
} from "./editor-state.js";
import { prepareGraphicOverlay, validateStoredGraphicOverlay } from "./graphic-overlay.js";
import {
  connectExportDialog,
  isExportDialogOpen,
  openExportDialog,
} from "./ui/export-dialog.js";
import {
  createProjectFileData,
  MAX_PROJECT_FILE_BYTES,
  parseProjectFileText,
} from "./project-format.js";
import {
  confirmAppearancePreview,
  connectInspectorEvents,
  getChosenGraphicOverlaySettings,
  getChosenRinkAppearanceUpdates,
  getChosenPresetType,
  isAppearancePreviewDialogOpen,
  showPropertiesTab,
  updateAppearancePreviewIndicator,
  updateInspector,
  validatePresetColors,
} from "./ui/inspector.js";
import { createPresetAppearanceAction } from "./presets.js";
import {
  buildLayerBrowser,
  connectLayerBrowserEvents,
  openGraphicOverlayFilePicker,
  updateChangedLayerRows,
  updateGraphicOverlayRow,
  updateLayerGroup,
} from "./ui/layer-browser.js";
import {
  createPngBlobForExport,
  inspectSvgElements,
  parseSvgText,
  prepareSvgForPreview,
  updateSvgPreviewViewBox,
  updateSvgEditorAction,
} from "./svg-operations.js";
import {
  connectPreviewViewportEvents,
  setPreviewViewportTarget,
} from "./ui/preview-viewport.js";
import {
  connectUpdateDialog,
  isUpdateDialogOpen,
  openUpdateDialog,
} from "./ui/update-dialog.js";
import { isWelcomeDialogOpen, openWelcomeDialog } from "./ui/welcome-dialog.js";
import {
  confirmProjectReplacementDialog,
  connectSaveDialog,
  isProjectReplacementDialogOpen,
  isSaveDialogOpen,
  openSaveDialog,
  updateProjectName,
} from "./ui/save-dialog.js";
import rinkTemplateUrl from "../../Rink SVG Template.svg?url";

const ui = {
  undoButton: document.querySelector("#undo-button"),
  redoButton: document.querySelector("#redo-button"),
  newProjectButton: document.querySelector("#new-project-button"),
  openButton: document.querySelector("#open-button"),
  projectFileInput: document.querySelector("#project-file-input"),
  saveButton: document.querySelector("#save-button"),
  exportPngButton: document.querySelector("#export-png-button"),
  statusMessage: document.querySelector("#status-message"),
  rinkPreview: document.querySelector("#rink-preview"),
  workspace: document.querySelector(".workspace"),
};

let editorState = null;
let rinkSvg = null;
let svgData = null;
let rinkTemplateText = null;
let graphicOverlayImportRequestId = 0;
// New, Open, Save, and rename share one current file, so they must not overlap
let projectFileOperationInProgress = false;
let pngExportInProgress = false;
let savedProject = null;
// Only filename needed, main owns the native project's full path
let currentProjectFileName = null;
// Visual-only appearance snapshots, never part of editor state or history
let appearancePreview = null;
const undoRedoHistory = createUndoRedoHistory();

// ---------- Application initialization ----------

async function initializeApp() {
  connectEditorControls();

  try {
    const response = await fetch(rinkTemplateUrl);

    if (!response.ok) {
      throw new Error(`The rink template could not be loaded (${response.status}).`);
    }

    rinkTemplateText = await response.text();
    const showWelcome = window.desktopAPI
      ? await window.desktopAPI.shouldShowWelcome().catch((error) => {
        console.warn("Could not read welcome preferences.", error);
        return false;
      })
      : false;
    buildEditorFromTemplate();
    if (showWelcome) {
      openWelcomeDialog();
      window.desktopAPI.markWelcomeShown().catch((error) => {
        console.warn("Could not remember that the welcome dialog was shown.", error);
      });
    }
  } catch (error) {
    ui.rinkPreview.setAttribute("aria-busy", "false");
    ui.rinkPreview.textContent = "The rink preview could not be loaded.";
    setStatus(error.message, "error");
  }
}

// ---------- Complete editor construction ----------

// Keep the previous editor available if rebuilding from the template fails
function buildEditorFromTemplate(project = null) {
  graphicOverlayImportRequestId += 1;
  const previousEditorState = editorState;
  const previousRinkSvg = rinkSvg;
  const previousSvgData = svgData;

  try {
    rinkSvg = parseSvgText(rinkTemplateText);
    prepareSvgForPreview(rinkSvg);
    ui.rinkPreview.replaceChildren(rinkSvg);

    svgData = inspectSvgElements(rinkSvg);
    editorState = createEditorState(svgData.originalAppearanceByElementKey);

    if (project) {
      loadProjectIntoEditorState(editorState, project);
      applyEditorStateToSvg();
    }
  } catch (error) {
    editorState = previousEditorState;
    rinkSvg = previousRinkSvg;
    svgData = previousSvgData;

    if (rinkSvg) {
      ui.rinkPreview.replaceChildren(rinkSvg);
    }
    throw error;
  }

  undoRedoHistory.undoStack.length = 0;
  undoRedoHistory.redoStack.length = 0;
  appearancePreview = null;
  updateAppearancePreviewIndicator();
  displayEditorInterface();
  setPreviewViewportTarget(rinkSvg);
  savedProject = createProjectFileData(editorState);
  currentProjectFileName = null;
  updateSaveButton();
}

function displayEditorInterface() {
  ui.rinkPreview.setAttribute("aria-busy", "false");
  ui.openButton.disabled = false;
  ui.saveButton.disabled = false;
  ui.exportPngButton.disabled = false;

  buildLayerBrowser(editorState);
  updateInspector(editorState);
  updateUndoRedoButtons();
  setStatus(
    "Rink loaded. Select layers or individual elements to edit together.",
    "success",
  );
}

function applyEditorStateToSvg() {
  updateSvgEditorAction(rinkSvg, {
    gradientDefinitionChanges: Object.values(editorState.gradientDefinitions).map(
      (definition) => ({ gradientKey: definition.key, nextDefinition: definition }),
    ),
    appearanceChanges: Object.values(editorState.layers).flatMap((layer) =>
      layer.elements.map((element) => ({
        layerKey: layer.key, elementKey: element.key, nextAppearance: element.appearance,
      })),
    ),
    graphicOverlayChange: { nextGraphic: editorState.graphicOverlay },
  }, svgData);
}

// ---------- Temporary appearance previews ----------

function showAppearancePreview(context, action, description) {
  discardAppearancePreview();
  if (!hasEditorActionChanges(action)) {
    setStatus("The chosen settings match the applied appearance.");
    return;
  }
  appearancePreview = { context, action, description };
  updateSvgEditorAction(rinkSvg, action, svgData);
  updateChangedLayerRows(editorState, action.appearanceChanges ?? [], true);
  updateAppearancePreviewIndicator(context);
  setStatus(`Previewing ${description}. Choose Apply to keep the changes.`);
}

function previewSelectedAppearance() {
  if (!editorState || isEditorDialogOpen() || editorState.activePropertiesTarget !== "rink-layer") return;
  if (getSelectedElementsWithLayers(editorState).length === 0) return;
  const updates = getChosenRinkAppearanceUpdates();
  // Incomplete fields leave the last valid preview visible
  if (!updates) return;
  showAppearancePreview("rink", createSelectedElementsAppearanceAction(editorState, updates),
    `${describeAppearanceUpdates(updates)} on ${describeSelection(editorState)}`);
}

function previewGraphicOverlaySettings() {
  if (!editorState?.graphicOverlay || isEditorDialogOpen()) return;
  const settings = getChosenGraphicOverlaySettings(false);
  if (!settings) return;
  showAppearancePreview("graphic", createGraphicOverlaySettingsAction(editorState, settings),
    `graphic ${describeGraphicOverlaySettings(settings)}`);
}

function previewPreset() {
  if (!editorState || isEditorDialogOpen()) return;
  const colors = validatePresetColors(false);
  if (!colors) return;
  const presetKey = getChosenPresetType();
  showAppearancePreview("preset", createPresetAppearanceAction(editorState, presetKey, colors),
    `the ${presetKey === "standard" ? "Standard" : "Gradient"} preset`);
}

// Restore the committed rink and graphic overlay before replacing a preview
function discardAppearancePreview() {
  if (!appearancePreview) return false;
  updateSvgEditorAction(rinkSvg, appearancePreview.action, svgData, true);
  updateChangedLayerRows(editorState, appearancePreview.action.appearanceChanges ?? []);
  appearancePreview = null;
  updateAppearancePreviewIndicator();
  return true;
}

function discardInspectorPreview() {
  if (discardAppearancePreview()) {
    updateInspector(editorState);
    setStatus("Preview discarded. The rink shows its last applied appearance.");
  }
}

// Back keeps the preview; Discard restores committed values; Apply commits the snapshots
async function resolveAppearancePreview(operation = "continue") {
  if (!appearancePreview) return true;
  const choice = await confirmAppearancePreview(operation);
  if (choice === "back") return false;
  if (!appearancePreview) return true;
  if (choice === "discard") {
    discardInspectorPreview();
  } else {
    const { action, description } = appearancePreview;
    commitAppearanceAction(action, `Applied ${description}.`);
  }
  return true;
}

async function handleInspectorContextChange(context) {
  if (isEditorDialogOpen()) return false;
  const nextContext = context === "preset" ? "preset" :
    editorState?.activePropertiesTarget === "graphic-overlay" ? "graphic" : "rink";
  return !appearancePreview || appearancePreview.context === nextContext ||
    resolveAppearancePreview();
}

function isEditorDialogOpen() {
  return isWelcomeDialogOpen() || isExportDialogOpen() || isAppearancePreviewDialogOpen() || isUpdateDialogOpen() ||
    isSaveDialogOpen() || isProjectReplacementDialogOpen();
}

// ---------- Rink appearance editing ----------

function applySelectedAppearance() {
  if (!editorState || getSelectedElementsWithLayers(editorState).length === 0) {
    setStatus("Select at least one rink element before applying changes.", "error");
    return;
  }
  const updates = getChosenRinkAppearanceUpdates(true);
  if (!updates) {
    setStatus("Enter six-digit hex colors in #RRGGBB format.", "error");
    return;
  }
  const action = createSelectedElementsAppearanceAction(editorState, updates);
  commitAppearanceAction(
    action,
    `Applied ${describeAppearanceUpdates(updates)} to ${describeSelection(editorState)}.`,
  );
}

function describeAppearanceUpdates(updates) {
  const descriptions = [];
  if (updates.fill?.kind === "solid") descriptions.push(updates.fill.color);
  if (updates.fill?.kind === "linear-gradient") {
    const { stops, directionDegrees } = updates.fill;
    descriptions.push(`a ${stops[0].color} to ${stops.at(-1).color} gradient` +
      (directionDegrees == null ? "" : ` at ${directionDegrees}°`));
  }
  if (updates.opacity !== undefined) descriptions.push(`${Math.round(updates.opacity * 100)}% opacity`);
  return descriptions.join(" and ");
}

function resetSelectedElements() {
  if (!editorState) {
    setStatus("The rink is not ready yet.", "error");
    return;
  }

  if (getSelectedElementsWithLayers(editorState).length === 0) {
    setStatus("Select at least one rink element to reset.", "error");
    return;
  }

  const action = resetSelectedElementAppearances(editorState);

  finishEditorAction(action, { refreshInspector: true });
  setStatus(
    `${capitalizeFirst(describeSelection(editorState))} restored to the original appearance.`,
    "success",
  );
}

function handleVisibilityToggle(layerKey, elementKey, visibility) {
  const layer = editorState.layers[layerKey];
  const element = elementKey
    ? layer.elements.find((candidate) => candidate.key === elementKey)
    : null;
  const nextVisibility =
    visibility === "visible"
      ? "hidden"
      : "visible";
  const action = element
    ? setElementVisibility(editorState, layerKey, elementKey, nextVisibility)
    : setLayerVisibility(editorState, layerKey, nextVisibility);

  finishEditorAction(action, { refreshInspector: true });
  setStatus(
    `${(element ?? layer).name} ${nextVisibility === "visible" ? "shown" : "hidden"}.`,
    "success",
  );
}

// ---------- Presets ----------

function applyPreset() {
  if (!editorState) {
    setStatus("The rink is not ready yet.", "error");
    return;
  }

  const colors = validatePresetColors();

  if (!colors) {
    setStatus("Enter three six-digit preset colors in #RRGGBB format.", "error");
    return;
  }

  const presetKey = getChosenPresetType();
  const action = createPresetAppearanceAction(editorState, presetKey, colors);
  commitAppearanceAction(
    action,
    `Applied the ${presetKey === "standard" ? "Standard" : "Gradient"} preset.`,
  );
}

// ---------- Graphic overlay editing ----------

async function importGraphicOverlay(file) {
  if (isEditorDialogOpen() || !(await resolveAppearancePreview())) return;
  if (!editorState) {
    setStatus("The rink is not ready yet.", "error");
    return;
  }

  const requestId = ++graphicOverlayImportRequestId;
  setStatus(`Preparing "${file.name}"…`);

  try {
    const graphic = await prepareGraphicOverlay(file, file.name);

    if (requestId !== graphicOverlayImportRequestId) {
      return;
    }

    const action = setGraphicOverlay(editorState, graphic);
    editorState.activePropertiesTarget = "graphic-overlay";
    showPropertiesTab();
    finishEditorAction(action, { refreshInspector: true });
    updateLayerGroup(editorState, editorState.activeLayerKey);
    updateGraphicOverlayRow(editorState);
    setStatus(
      `${action.graphicOverlayChange.previousGraphic ? "Replaced" : "Imported"} graphic overlay "${file.name}".`,
      "success",
    );
  } catch (error) {
    if (requestId !== graphicOverlayImportRequestId) {
      return;
    }
    setStatus(`Graphic was not imported. ${error.message}`, "error");
  }
}

async function activateGraphicOverlay() {
  if (!editorState?.graphicOverlay) {
    return;
  }

  if (isEditorDialogOpen() || !(await resolveAppearancePreview())) return;

  editorState.activePropertiesTarget = "graphic-overlay";
  showPropertiesTab();
  updateGraphicOverlayRow(editorState);
  updateLayerGroup(editorState, editorState.activeLayerKey);
  updateInspector(editorState);
  setStatus(`Graphic overlay "${editorState.graphicOverlay.fileName}" is active.`);
}

function applyGraphicOverlaySettings() {
  if (!editorState?.graphicOverlay) {
    setStatus("There is no graphic overlay to update.", "error");
    return;
  }

  const settings = getChosenGraphicOverlaySettings();
  if (!settings) {
    setStatus("Enter graphic settings within the displayed limits.", "error");
    return;
  }

  const action = createGraphicOverlaySettingsAction(editorState, settings);
  commitAppearanceAction(action, `Applied graphic ${describeGraphicOverlaySettings(settings)}.`);
}

function describeGraphicOverlaySettings(settings) {
  const descriptions = [];
  if (settings.scale !== undefined) descriptions.push(`${Number((settings.scale * 100).toFixed(2))}% scale`);
  if (settings.opacity !== undefined) descriptions.push(`${Math.round(settings.opacity * 100)}% opacity`);
  if (settings.offsetX !== undefined) descriptions.push(`${settings.offsetX} px horizontal offset`);
  if (settings.offsetY !== undefined) descriptions.push(`${settings.offsetY} px vertical offset`);
  return descriptions.join(", ");
}

function removeGraphicOverlay() {
  if (!editorState?.graphicOverlay) {
    return;
  }

  const fileName = editorState.graphicOverlay.fileName;
  const action = setGraphicOverlay(editorState, null);
  editorState.activePropertiesTarget = "rink-layer";
  finishEditorAction(action, { refreshInspector: true });
  updateLayerGroup(editorState, editorState.activeLayerKey);
  setStatus(`Removed graphic overlay "${fileName}".`, "success");
}

// ---------- Shared action completion ----------

// Inspector Apply and dialog Apply share the same state/history path
function commitAppearanceAction(action, successMessage) {
  const hasChanges = hasEditorActionChanges(action);
  applyEditorAction(editorState, action);
  finishEditorAction(action, { refreshInspector: true });
  setStatus(
    hasChanges ? successMessage : "The chosen settings already match the applied appearance.",
    hasChanges ? "success" : "info",
  );
}

function updateEditorActionDisplay(action, isUndo = false) {
  updateSvgEditorAction(rinkSvg, action, svgData, isUndo);
  updateChangedLayerRows(editorState, action.appearanceChanges ?? []);
  if (action.graphicOverlayChange) updateGraphicOverlayRow(editorState);
}

function finishEditorAction(action, { refreshInspector = false } = {}) {
  const hadPreview = discardAppearancePreview();
  updateEditorActionDisplay(action);
  recordUndoRedoAction(undoRedoHistory, action);
  updateUndoRedoButtons();
  updateSaveButton();
  if (refreshInspector || hadPreview) updateInspector(editorState);
}

// ---------- Undo and redo ----------

function handleUndoRedo(direction) {
  if (isEditorDialogOpen() || projectFileOperationInProgress) return;
  const hadPreview = discardAppearancePreview();
  const action = applyUndoRedo(
    editorState,
    undoRedoHistory,
    direction,
  );

  if (!action) {
    if (hadPreview) {
      updateInspector(editorState);
      setStatus("Preview discarded. There are no applied changes to undo or redo.");
    }
    return;
  }

  if (!editorState.graphicOverlay) {
    editorState.activePropertiesTarget = "rink-layer";
    updateLayerGroup(editorState, editorState.activeLayerKey);
  }

  updateEditorActionDisplay(action, direction === "undo");
  updateInspector(editorState);
  updateUndoRedoButtons();
  updateSaveButton();
  setStatus(
    `${direction === "undo" ? "Undid" : "Redid"} the last change.`,
    "success",
  );
}

// Let focused form fields keep their normal text undo and redo shortcuts
function handleUndoRedoShortcut(event) {
  if (isEditorDialogOpen()) return;
  if (
    !(event.ctrlKey || event.metaKey) ||
    event.altKey ||
    event.target.closest?.("input, textarea, [contenteditable]")
  ) {
    return;
  }

  const key = event.key.toLowerCase();
  if (key !== "z" && key !== "y") return;

  event.preventDefault();
  handleUndoRedo(key === "y" || event.shiftKey ? "redo" : "undo");
}

function updateUndoRedoButtons() {
  ui.undoButton.disabled = undoRedoHistory.undoStack.length === 0;
  ui.redoButton.disabled = undoRedoHistory.redoStack.length === 0;
  ui.undoButton.title = ui.undoButton.disabled ? "Nothing to undo" : "Undo";
  ui.redoButton.title = ui.redoButton.disabled ? "Nothing to redo" : "Redo";
  window.desktopAPI?.setUndoRedoAvailability(
    !ui.undoButton.disabled,
    !ui.redoButton.disabled,
  );
}

// ---------- Project files and unsaved changes ----------

async function saveProject(saveAs = false, renameTo) {
  if (isEditorDialogOpen()) return false;
  if (!editorState) {
    setStatus("The rink is not ready to save.", "error");
    return false;
  }

  if (projectFileOperationInProgress) return false;
  projectFileOperationInProgress = true;
  updateSaveButton();
  try {
    if (!(await resolveAppearancePreview("save"))) return false;
    return await saveCurrentProject(saveAs, renameTo);
  } catch (error) {
    setStatus(`Project was not saved. ${error.message}`, "error");
    return false;
  } finally {
    projectFileOperationInProgress = false;
    updateSaveButton();
  }
}

// Save and Save & continue share the same writes while their callers own the operation lock
async function saveCurrentProject(saveAs = false, renameTo) {
  try {
    let projectName = renameTo;
    if (!currentProjectFileName || saveAs) {
      projectName = await openSaveDialog(currentProjectFileName?.replace(/\.(json|rskn)$/i, "") ?? "");
      if (projectName === null) return false;
    }
    const project = createProjectFileData(editorState);
    const text = JSON.stringify(project, null, 2);
    if (!window.desktopAPI) {
      const fileName = projectName ? `${projectName}.rskn`
        : currentProjectFileName.replace(/\.(json|rskn)$/i, ".rskn");
      downloadTextFile(text, fileName, "application/json;charset=utf-8");
      savedProject = project;
      showProjectName(fileName);
      setStatus("Project downloaded. You can open this file to continue later.", "success");
      return true;
    }

    const fileName = await window.desktopAPI.saveProjectFile(text, saveAs || !currentProjectFileName, projectName);
    if (fileName) {
      savedProject = project;
      showProjectName(fileName);
      if (renameTo !== undefined) {
        try {
          const renamedFileName = await window.desktopAPI.renameProjectFile(renameTo);
          showProjectName(renamedFileName);
          setStatus(`Saved and renamed project to "${renamedFileName}".`, "success");
        } catch (error) {
          // The design was saved even if the filename could not be changed
          setStatus(`Saved project "${fileName}", but could not rename it. ${error.message}`, "error");
        }
      } else {
        setStatus(`Saved project "${fileName}".`, "success");
      }
      return true;
    }
    return false;
  } catch (error) {
    setStatus(`Project was not saved. ${error.message}`, "error");
    return false;
  }
}

async function newProject() {
  if (!editorState || isEditorDialogOpen() || projectFileOperationInProgress || pngExportInProgress) return;
  projectFileOperationInProgress = true;
  updateSaveButton();
  try {
    if (!(await confirmProjectReplacement("new"))) return;
    // Clear the native Save target only after the user agrees to replace the current project
    await window.desktopAPI?.resetProjectFileSession();
    buildEditorFromTemplate();
    showPropertiesTab();
    setStatus("New project started. The rink is restored to its default appearance.", "success");
  } catch (error) {
    setStatus(`Could not start a new project. ${error.message}`, "error");
  } finally {
    projectFileOperationInProgress = false;
    updateSaveButton();
  }
}

async function openProject() {
  if (isEditorDialogOpen()) return;
  if (projectFileOperationInProgress || pngExportInProgress) return;

  if (!window.desktopAPI) {
    ui.projectFileInput.value = "";
    ui.projectFileInput.click();
    return;
  }

  projectFileOperationInProgress = true;
  updateSaveButton();
  try {
    const projectFile = await window.desktopAPI.openProjectFile();
    if (!projectFile) return;

    let project = parseProjectFileText(projectFile.text);
    await validateStoredGraphicOverlay(project.graphicOverlay);
    const previousSavedProject = savedProject;
    if (!(await confirmProjectReplacement("open"))) return;
    // Reopening the file just saved should load that latest design, not the earlier read
    if (savedProject !== previousSavedProject && await window.desktopAPI.isOpenedProjectCurrent()) project = savedProject;
    buildEditorFromTemplate(project);
    // Only a successfully loaded project becomes the target of the next Save
    await window.desktopAPI.confirmOpenedProject();
    showProjectName(projectFile.fileName);
    setStatus(`Opened project "${projectFile.fileName}".`, "success");
  } catch (error) {
    setStatus(`Could not open the project. ${error.message}`, "error");
  } finally {
    projectFileOperationInProgress = false;
    updateSaveButton();
  }
}

async function openProjectFromBrowser(event) {
  const projectFile = event.target.files[0];

  if (!projectFile || projectFileOperationInProgress || pngExportInProgress) return;

  projectFileOperationInProgress = true;
  updateSaveButton();
  try {
    if (projectFile.size > MAX_PROJECT_FILE_BYTES) {
      throw new Error("Project files cannot exceed 100 MiB.");
    }
    const project = parseProjectFileText(await projectFile.text());
    await validateStoredGraphicOverlay(project.graphicOverlay);
    if (!(await confirmProjectReplacement("open"))) return;
    buildEditorFromTemplate(project);
    showProjectName(projectFile.name);
    setStatus(`Opened project "${projectFile.name}".`, "success");
  } catch (error) {
    setStatus(`Project was not opened. ${error.message}`, "error");
  } finally {
    projectFileOperationInProgress = false;
    updateSaveButton();
  }
}

function showProjectName(fileName) {
  currentProjectFileName = fileName;
  const name = fileName?.replace(/\.(json|rskn)$/i, "") || "Untitled project";
  updateProjectName(name, !!fileName, !!editorState && !projectFileOperationInProgress);
  document.title = `${name} — Puck Reskin Designer`;
}

// Compare durable data without repeatedly serializing the embedded PNG
function hasUnsavedChanges() {
  if (!editorState || !savedProject) return false;
  const project = createProjectFileData(editorState);
  const withoutPng = (key, value) => key === "pngDataUrl" ? undefined : value;
  return project.graphicOverlay?.pngDataUrl !== savedProject.graphicOverlay?.pngDataUrl ||
    JSON.stringify(project, withoutPng) !== JSON.stringify(savedProject, withoutPng);
}

function updateSaveButton() {
  // Prevent edits arriving between a replacement decision and its completed save/load
  ui.workspace.inert = projectFileOperationInProgress;
  ui.newProjectButton.disabled = !editorState || projectFileOperationInProgress;
  showProjectName(currentProjectFileName);
  const unsaved = hasUnsavedChanges();
  ui.saveButton.classList.toggle("is-saved", !unsaved);
  ui.saveButton.title = unsaved
    ? "Save project (unsaved changes)"
    : "Save project (no unsaved changes)";
}

async function confirmProjectReplacement(operation) {
  const unsaved = hasUnsavedChanges();
  if (!unsaved && !appearancePreview) return true;
  const choice = await confirmProjectReplacementDialog(operation, unsaved, !!appearancePreview);
  if (choice === "back") return false;
  // Discard happens only when rebuilding succeeds, so Back or load errors keep the preview
  if (choice === "discard") return true;
  if (appearancePreview) {
    const { action, description } = appearancePreview;
    commitAppearanceAction(action, `Applied ${description}.`);
  }
  if (!(await saveCurrentProject())) return false;
  if (hasUnsavedChanges() || appearancePreview) {
    setStatus("The project changed while saving. Save the latest changes before continuing.", "error");
    return false;
  }
  return true;
}

// ---------- Exports and downloads ----------

async function exportModifiedPng() {
  if (!editorState) {
    setStatus("The rink is not ready to export.", "error");
    return;
  }

  if (pngExportInProgress || projectFileOperationInProgress || isEditorDialogOpen()) return;
  if (!(await resolveAppearancePreview("export"))) return;
  if (window.desktopAPI) {
    await openExportDialog();
    return;
  }

  pngExportInProgress = true;
  ui.exportPngButton.disabled = true;
  setStatus("Preparing the full-resolution PNG…");

  try {
    const pngBlob = await createPngBlobForExport(rinkSvg, appearancePreview?.action, svgData);
    downloadBlobFile(pngBlob, "puck-rink-modified.png");
    setStatus("PNG download started.", "success");
  } catch (error) {
    setStatus(`PNG was not exported. ${error.message}`, "error");
  } finally {
    pngExportInProgress = false;
    ui.exportPngButton.disabled = false;
  }
}

async function saveDesktopPng(saveAction, successMessage) {
  if (pngExportInProgress) return null;
  pngExportInProgress = true;
  ui.exportPngButton.disabled = true;
  setStatus("Preparing the full-resolution PNG…");

  try {
    const pngBlob = await createPngBlobForExport(rinkSvg, appearancePreview?.action, svgData);
    const pngBytes = new Uint8Array(await pngBlob.arrayBuffer());
    const result = await saveAction(pngBytes);
    if (result) setStatus(successMessage(result), "success");
    return result;
  } catch (error) {
    setStatus(`PNG was not exported. ${error.message}`, "error");
    throw error;
  } finally {
    pngExportInProgress = false;
    ui.exportPngButton.disabled = false;
  }
}

function downloadTextFile(contents, fileName, mimeType) {
  const fileBlob = new Blob([contents], { type: mimeType });
  downloadBlobFile(fileBlob, fileName);
}

function downloadBlobFile(fileBlob, fileName) {
  const downloadUrl = URL.createObjectURL(fileBlob);
  const downloadLink = document.createElement("a");

  downloadLink.href = downloadUrl;
  downloadLink.download = fileName;
  document.body.append(downloadLink);
  downloadLink.click();
  downloadLink.remove();
  // Give the browser time to start the download before releasing a large Blob
  setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
}

// ---------- Layer navigation and selection ----------

function handleLayerExpansionToggle(layerKey) {
  const previousExpandedLayerKey = editorState.expandedLayerKey;
  editorState.expandedLayerKey = previousExpandedLayerKey === layerKey ? null : layerKey;
  new Set([previousExpandedLayerKey, layerKey]).forEach((key) => {
    if (key) updateLayerGroup(editorState, key);
  });
}

async function handleRinkSelectionChange(layerKey, elementKey, options) {
  // Restore the toggled checkbox while the preview decision is pending
  if (isEditorDialogOpen() || appearancePreview) updateLayerGroup(editorState, layerKey);
  if (isEditorDialogOpen() || !(await resolveAppearancePreview())) return;
  const previousLayerKey = editorState.activeLayerKey;
  const previousExpandedLayerKey = editorState.expandedLayerKey;
  const layer = editorState.layers[layerKey];
  const { changedLayerKeys, isSelected } = setRinkSelection(
    editorState,
    layerKey,
    elementKey,
    options,
  );

  editorState.activeLayerKey = layerKey;
  editorState.activePropertiesTarget = "rink-layer";

  if (!elementKey && isSelected) {
    editorState.expandedLayerKey = hasMultipleElements(layer) ? layerKey : null;
  }

  showPropertiesTab();
  new Set([previousLayerKey, previousExpandedLayerKey, layerKey, ...changedLayerKeys])
    .forEach((key) => {
      if (key) updateLayerGroup(editorState, key);
    });
  updateGraphicOverlayRow(editorState);
  const hasMixedAppearances = updateInspector(editorState);
  announceSelectionChange(hasMixedAppearances);
}

function announceSelectionChange(hasMixedAppearances) {
  const selectedCount = getSelectedElementsWithLayers(editorState).length;

  if (selectedCount === 0) {
    setStatus("No rink elements selected. Select a layer or individual element to edit it.");
  } else if (hasMixedAppearances) {
    setStatus(
      `${capitalizeFirst(describeSelection(editorState))} selected with different appearance settings.`,
    );
  } else {
    setStatus(`${capitalizeFirst(describeSelection(editorState))} selected.`);
  }
}

// ---------- Manual update check ----------

function checkForUpdates() {
  if (isEditorDialogOpen() || projectFileOperationInProgress || pngExportInProgress) return;
  // Checking versions does not resolve or commit an appearance preview
  openUpdateDialog();
}

// ---------- Status helpers ----------

function capitalizeFirst(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function setStatus(message, type = "info") {
  ui.statusMessage.textContent = message;
  ui.statusMessage.dataset.type = type;
}

// ---------- Event wiring ----------

function connectEditorControls() {
  ui.newProjectButton.hidden = !!window.desktopAPI;
  connectSaveDialog({
    onEditName: () => {
      if (!editorState || projectFileOperationInProgress || isEditorDialogOpen()) return false;
      if (currentProjectFileName) return true;
      saveProject();
      return false;
    },
    onRename: (name) => saveProject(false, name),
    canRename: !!window.desktopAPI,
  });
  connectPreviewViewportEvents({
    onViewBoxChange: (viewBox) => updateSvgPreviewViewBox(rinkSvg, viewBox),
  });
  connectLayerBrowserEvents({
    onSelectionChange: handleRinkSelectionChange,
    onLayerExpansionToggle: handleLayerExpansionToggle,
    onVisibilityToggle: handleVisibilityToggle,
    onGraphicClick: activateGraphicOverlay,
    onGraphicFileChosen: importGraphicOverlay,
  });
  connectInspectorEvents({
    getEditorState: () => editorState,
    onApply: applySelectedAppearance,
    onRinkPreview: previewSelectedAppearance,
    onGraphicPreview: previewGraphicOverlaySettings,
    onPresetPreview: previewPreset,
    onContextChange: handleInspectorContextChange,
    onDiscardPreview: discardInspectorPreview,
    onApplyPreset: applyPreset,
    onReset: resetSelectedElements,
    onApplyGraphic: applyGraphicOverlaySettings,
    onReplaceGraphic: openGraphicOverlayFilePicker,
    onRemoveGraphic: removeGraphicOverlay,
  });
  ui.undoButton.addEventListener("click", () => handleUndoRedo("undo"));
  ui.redoButton.addEventListener("click", () => handleUndoRedo("redo"));
  if (window.desktopAPI) {
    connectUpdateDialog({
      check: () => window.desktopAPI.checkForUpdates(),
      openReleasePage: () => window.desktopAPI.openUpdateReleasePage(),
    });
    window.desktopAPI.onCheckForUpdatesRequested(checkForUpdates);
    connectExportDialog({
      loadPacks: () => window.desktopAPI.getReskinPackState(),
      browseGameFolder: () => window.desktopAPI.browsePuckFolder(),
      setGameFolder: (path) => window.desktopAPI.setPuckFolder(path),
      inspectExport: (request) => window.desktopAPI.inspectReskinExport(request),
      onExportPack: (request) => saveDesktopPng(
        (pngBytes) => window.desktopAPI.exportPngToPack(request, pngBytes),
        (result) => `Exported "${result.rinkName}" to "${result.packName}".`,
      ),
      onSaveElsewhere: () => saveDesktopPng(
        (pngBytes) => window.desktopAPI.savePngFile(pngBytes),
        (fileName) => `Exported PNG "${fileName}".`,
      ),
    });
    window.desktopAPI.onUndoRedoRequested(handleUndoRedo);
    window.desktopAPI.onNewProjectRequested(newProject);
    window.desktopAPI.onOpenRequested(openProject);
    window.desktopAPI.onSaveRequested(saveProject);
    window.desktopAPI.onExportPngRequested(exportModifiedPng);
  }
  document.addEventListener("keydown", handleUndoRedoShortcut);
  window.addEventListener("beforeunload", (event) => {
    if (hasUnsavedChanges()) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
  ui.openButton.addEventListener("click", openProject);
  ui.newProjectButton.addEventListener("click", newProject);
  ui.projectFileInput.addEventListener("change", openProjectFromBrowser);
  ui.saveButton.addEventListener("click", () => saveProject());
  ui.exportPngButton.addEventListener("click", exportModifiedPng);
}

initializeApp();
