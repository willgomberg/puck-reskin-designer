/*
 * PNG EXPORT DIALOG
 * DESCRIPTION: Collects PNG export choices and confirms rink replacements.
 * PROCESS: Renderer
 */

const ui = {
  dialog: document.querySelector("#png-export-dialog"),
  form: document.querySelector("#png-export-form"),
  locationStatus: document.querySelector("#export-location-status"),
  locationControls: document.querySelector("#export-location-controls"),
  locationChangeButton: document.querySelector("#export-location-change"),
  locationInput: document.querySelector("#export-location-input"),
  locationHelp: document.querySelector("#export-location-help"),
  locationBrowseButton: document.querySelector("#export-location-browse"),
  locationUseButton: document.querySelector("#export-location-use"),
  packFields: document.querySelector("#export-pack-fields"),
  existingPackRadio: document.querySelector("#export-existing-pack-radio"),
  newPackRadio: document.querySelector("#export-new-pack-radio"),
  elsewhereRadio: document.querySelector("#export-elsewhere-radio"),
  packSelect: document.querySelector("#export-pack-select"),
  packSelection: document.querySelector("#export-pack-selection"),
  packNameInput: document.querySelector("#export-pack-name"),
  packNameLabel: document.querySelector("#export-pack-name-label"),
  rinkNameInput: document.querySelector("#export-rink-name"),
  conflictBox: document.querySelector("#export-conflict"),
  conflictText: document.querySelector("#export-conflict-text"),
  replacementSelect: document.querySelector("#export-replacement-select"),
  errorText: document.querySelector("#export-dialog-error"),
  submitButton: document.querySelector("#export-dialog-submit"),
  cancelButton: document.querySelector("#export-dialog-cancel"),
};

let callbacks;
let gameFound = false;
let confirmedGameFolder = "";
let editingLocation = false;
let busy = false;
let pendingReplacement = null;
let gameFolderRequestId = 0;

// ---------- Dialog display and controls ----------

export function isExportDialogOpen() {
  return ui.dialog.open;
}

function setError(message = "") {
  ui.errorText.textContent = message;
  ui.errorText.hidden = !message;
}

function updateExportControls() {
  const elsewhere = ui.elsewhereRadio.checked;
  ui.form.inert = busy;
  ui.packFields.hidden = elsewhere;
  ui.packSelect.disabled = elsewhere || !ui.existingPackRadio.checked;
  ui.packNameInput.disabled = elsewhere || !ui.newPackRadio.checked;
  ui.packSelect.hidden = !ui.existingPackRadio.checked;
  ui.packNameInput.hidden = !ui.newPackRadio.checked;
  ui.packNameLabel.hidden = !ui.newPackRadio.checked;
  ui.locationControls.hidden = gameFound && !editingLocation;
  ui.locationChangeButton.hidden = !gameFound || editingLocation;
  ui.locationStatus.dataset.type = gameFound ? "success" : "";
  ui.locationHelp.hidden = gameFound;
  ui.submitButton.textContent = elsewhere ? "Save PNG…" : pendingReplacement ? "Confirm replacement" : "Export to Puck";
  ui.submitButton.disabled = busy || (!elsewhere && !gameFound);
}

function displayPackExportState(state) {
  gameFound = !!state.gameFolder;
  confirmedGameFolder = state.gameFolder || "";
  ui.locationInput.value = state.gameFolder || "";
  editingLocation = false;
  ui.locationStatus.textContent = gameFound
    ? "✓ Puck folder found. No need to touch this field."
    : "Puck was not found automatically. Choose its game folder to export a pack.";
  // Keep the selected-content button when refreshing the pack options
  ui.packSelect.replaceChildren(ui.packSelection);

  for (const pack of state.packs) {
    const option = document.createElement("option");
    option.value = pack.folderName;
    option.textContent = `${pack.name}${pack.missingManifest ? " · No JSON yet" : ""}${pack.valid ? "" : " · Invalid JSON"}`;
    if (pack.appCreated) {
      const origin = document.createElement("span");
      origin.className = "dialog-help";
      origin.textContent = " · Made with this app";
      option.append(origin);
    }
    option.disabled = !pack.valid;
    ui.packSelect.append(option);
  }

  const validPacks = state.packs.filter((pack) => pack.valid);
  ui.existingPackRadio.disabled = validPacks.length === 0;
  if (state.defaultFolderName) {
    ui.existingPackRadio.checked = true;
    ui.packSelect.value = state.defaultFolderName;
  } else {
    ui.newPackRadio.checked = true;
  }
  if (validPacks.length && !state.defaultFolderName) {
    ui.packSelect.value = validPacks[0].folderName;
  }
  clearConfirmation();
}

// ---------- Replacement confirmation ----------

function clearConfirmation() {
  pendingReplacement = null;
  ui.conflictBox.hidden = true;
  ui.replacementSelect.replaceChildren();
  ui.replacementSelect.hidden = true;
  updateExportControls();
}

function showConflict(inspection, request) {
  if (inspection.pathConflict) {
    throw new Error("That PNG filename is already used by a different reskin. Choose another rink name.");
  }
  if (!inspection.matches.length && !inspection.unlistedFile) return false;

  pendingReplacement = request;
  ui.conflictBox.hidden = false;
  if (inspection.matches.length) {
    if (inspection.matches.length > 1) {
      ui.conflictText.textContent = "Several rinks have this name. Choose the exact entry to replace. Entries sharing one PNG will all show the replacement image.";
    } else if (inspection.matches[0].sharedCount > 1) {
      ui.conflictText.textContent = `This rink's PNG is used by ${inspection.matches[0].sharedCount} pack entries. Confirming will change the image for all of them, while keeping their JSON entries.`;
    } else {
      ui.conflictText.textContent = "A rink with this name already exists. Confirm to replace its PNG; its name and other pack entries will stay as they are.";
    }
    ui.replacementSelect.hidden = false;
    if (inspection.matches.length > 1) {
      const placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = "Choose a rink to replace";
      placeholder.disabled = true;
      placeholder.selected = true;
      ui.replacementSelect.append(placeholder);
    }
    for (const match of inspection.matches) {
      const option = document.createElement("option");
      option.value = String(match.index);
      option.textContent = `${match.name} — ${match.path} (entry ${match.index + 1})`;
      ui.replacementSelect.append(option);
    }
    pendingReplacement.matches = inspection.matches;
  } else {
    ui.conflictText.textContent = "A PNG with this filename exists but is not listed in the pack. Confirm to replace that file and add this rink.";
    pendingReplacement.overwriteUnlisted = true;
  }
  updateExportControls();
  return true;
}

// ---------- Export requests ----------

function getExportRequest() {
  return {
    rinkName: ui.rinkNameInput.value,
    ...(ui.newPackRadio.checked
      ? { newPackName: ui.packNameInput.value }
      : { folderName: ui.packSelect.value }),
  };
}

async function submitExport(event) {
  event.preventDefault();
  if (busy) return;
  setError();
  busy = true;
  updateExportControls();

  try {
    if (ui.elsewhereRadio.checked) {
      const result = await callbacks.onSaveElsewhere();
      if (result) ui.dialog.close();
      return;
    }

    const request = getExportRequest();
    if (!pendingReplacement) {
      const inspection = await callbacks.inspectExport(request);
      if (showConflict(inspection, request)) return;
    } else {
      if (pendingReplacement.matches) {
        const selected = pendingReplacement.matches.find((match) =>
          match.index === Number(ui.replacementSelect.value),
        );
        if (!selected || !ui.replacementSelect.value) {
          throw new Error("Choose which existing rink to replace.");
        }
        request.replaceIndex = selected.index;
        request.expectedPath = selected.path;
      } else {
        request.overwriteUnlisted = true;
      }
    }

    await callbacks.onExportPack(request);
    ui.dialog.close();
  } catch (error) {
    setError(error.message);
  } finally {
    busy = false;
    updateExportControls();
  }
}

// ---------- Game folder requests ----------

// Ignore stale lookups; manual folder actions temporarily disable the form
async function loadGameFolderState(loadState, isAutomatic = false) {
  if (busy) return;
  const requestId = ++gameFolderRequestId;
  setError();
  if (!isAutomatic) {
    busy = true;
    gameFound = false;
    updateExportControls();
  }

  try {
    const state = await loadState();
    if (requestId !== gameFolderRequestId || !ui.dialog.open) return;
    if (state) displayPackExportState(state);
    if (isAutomatic) ui.rinkNameInput.focus();
    else if (state && gameFound) ui.locationChangeButton.focus();
  } catch (error) {
    if (requestId !== gameFolderRequestId || !ui.dialog.open) return;
    setError(error.message);
    if (isAutomatic) ui.locationStatus.textContent = "Puck could not be located automatically.";
  } finally {
    if (requestId === gameFolderRequestId && !isAutomatic) {
      busy = false;
    }
    if (requestId === gameFolderRequestId) updateExportControls();
  }
}

// ---------- Opening the dialog ----------

export async function openExportDialog() {
  if (ui.dialog.open) return;
  setError();
  ui.rinkNameInput.value = "";
  ui.packNameInput.value = "";
  gameFound = false;
  confirmedGameFolder = "";
  editingLocation = false;
  ui.newPackRadio.checked = true;
  clearConfirmation();
  ui.dialog.showModal();
  ui.locationStatus.textContent = "Looking for Puck…";
  await loadGameFolderState(callbacks.loadPacks, true);
}

// ---------- Event wiring ----------

export function connectExportDialog(actions) {
  callbacks = actions;
  ui.form.addEventListener("submit", submitExport);
  ui.form.addEventListener("input", (event) => {
    if (event.target !== ui.replacementSelect) clearConfirmation();
    if (event.target === ui.locationInput) {
      gameFolderRequestId += 1;
      gameFound = !!confirmedGameFolder && ui.locationInput.value === confirmedGameFolder;
      ui.locationStatus.textContent = gameFound
        ? "✓ Puck folder found. No need to touch this field."
        : "Use the path or Browse to confirm Puck’s location.";
      updateExportControls();
    }
    setError();
  });
  ui.form.addEventListener("change", (event) => {
    if (event.target !== ui.replacementSelect) clearConfirmation();
    setError();
  });
  ui.locationBrowseButton.addEventListener("click", () =>
    loadGameFolderState(callbacks.browseGameFolder),
  );
  ui.locationChangeButton.addEventListener("click", () => {
    editingLocation = true;
    updateExportControls();
    ui.locationInput.focus();
  });
  ui.locationUseButton.addEventListener("click", () =>
    loadGameFolderState(() => callbacks.setGameFolder(ui.locationInput.value)),
  );
  ui.cancelButton.addEventListener("click", () => {
    if (!busy) ui.dialog.close();
  });
  ui.dialog.addEventListener("cancel", (event) => {
    if (busy) event.preventDefault();
  });
  ui.dialog.addEventListener("close", () => {
    gameFolderRequestId += 1;
    busy = false;
    clearConfirmation();
    setError();
  });
}
