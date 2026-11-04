/*
 * PROJECT FILE UI
 * DESCRIPTION: Owns project naming and New / Open replacement confirmation.
 * PROCESS: Renderer
 */

const ui = {
  dialog: document.querySelector("#project-save-dialog"),
  form: document.querySelector("#project-save-form"),
  nameInput: document.querySelector("#save-project-name"),
  cancelButton: document.querySelector("#save-dialog-cancel"),
  nameControls: document.querySelector("#project-name-controls"),
  nameDisplay: document.querySelector("#project-name-display"),
  nameLabel: document.querySelector("#project-name"),
  editButton: document.querySelector("#project-name-edit"),
  renameForm: document.querySelector("#project-rename-form"),
  renameInput: document.querySelector("#project-rename-input"),
  renameConfirm: document.querySelector("#project-rename-confirm"),
  renameCancel: document.querySelector("#project-rename-cancel"),
  replacementDialog: document.querySelector("#project-replacement-dialog"),
  replacementTitle: document.querySelector("#project-replacement-title"),
  replacementDescription: document.querySelector("#project-replacement-description"),
  replacementBack: document.querySelector("#project-replacement-back"),
};

// ---------- Project name display and renaming ----------

export function updateProjectName(name, hasFile, enabled) {
  if (!enabled || ui.nameLabel.textContent !== name) setProjectNameEditing(false);
  ui.nameLabel.textContent = name;
  ui.nameLabel.title = name;
  ui.editButton.disabled = !enabled;
  ui.editButton.title = hasFile ? "Rename project" : "Name and save project";
  ui.editButton.setAttribute("aria-label", ui.editButton.title);
}

function setProjectNameEditing(editing) {
  ui.nameDisplay.hidden = editing;
  ui.renameForm.hidden = !editing;
  if (editing) {
    ui.renameInput.value = ui.nameLabel.textContent;
    ui.renameInput.setCustomValidity("");
    ui.renameInput.focus();
    ui.renameInput.select();
  }
}

// ---------- Name validation ----------

function validateProjectName(input) {
  const name = input.value.trim();
  input.setCustomValidity(!name
    ? "Enter a project name."
    : name.length > 80 || /[<>:"/\\|?*\u0000-\u001f]/.test(name) || /\.$/.test(name) ||
        /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(name)
      ? 'Use up to 80 characters, without < > : " / \\ | ? *, control characters, reserved names, or a final period.'
      : "");
  return input.reportValidity() ? name : null;
}

// ---------- Dialog display ----------

export function isSaveDialogOpen() {
  return ui.dialog.open;
}

export function openSaveDialog(projectName) {
  if (projectName !== undefined) ui.nameInput.value = projectName;
  ui.nameInput.setCustomValidity("");
  ui.dialog.returnValue = "";
  return new Promise((resolve) => {
    ui.dialog.addEventListener("close", () => {
      resolve(ui.dialog.returnValue === "save" ? ui.nameInput.value.trim() : null);
    }, { once: true });
    ui.dialog.showModal();
    ui.nameInput.focus();
    ui.nameInput.select();
  });
}

// ---------- Project replacement confirmation ----------

export function isProjectReplacementDialogOpen() {
  return ui.replacementDialog.open;
}

export function confirmProjectReplacementDialog(operation, hasUnsaved, hasPreview) {
  ui.replacementTitle.textContent = operation === "new" ? "Start a new project?" : "Open another project?";
  ui.replacementDescription.textContent = hasUnsaved && hasPreview
    ? "This project has unsaved changes and an unapplied edit shown in the rink preview."
    : hasUnsaved ? "This project has unsaved changes."
      : "Your last edit is shown in the rink preview, but is not applied.";
  if (hasPreview) ui.replacementDescription.textContent += " Saving also applies the preview.";
  ui.replacementDialog.returnValue = "";
  return new Promise((resolve) => {
    ui.replacementDialog.addEventListener("close", () => {
      const choice = ui.replacementDialog.returnValue;
      resolve(["save", "discard"].includes(choice) ? choice : "back");
    }, { once: true });
    ui.replacementDialog.showModal();
    ui.replacementBack.focus();
  });
}

// ---------- Event wiring ----------

export function connectSaveDialog({ onEditName, onRename, canRename }) {
  ui.nameInput.addEventListener("input", () => ui.nameInput.setCustomValidity(""));
  ui.form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (validateProjectName(ui.nameInput) !== null) ui.dialog.close("save");
  });
  ui.cancelButton.addEventListener("click", () => ui.dialog.close());
  ui.renameConfirm.textContent = canRename ? "Rename" : "Save copy…";
  ui.editButton.addEventListener("click", () => {
    if (onEditName()) setProjectNameEditing(true);
  });
  ui.renameInput.addEventListener("input", () => ui.renameInput.setCustomValidity(""));
  ui.renameForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const name = validateProjectName(ui.renameInput);
    if (name === null) return;
    setProjectNameEditing(false);
    ui.editButton.focus();
    if (name !== ui.nameLabel.textContent) onRename(name);
  });
  ui.renameCancel.addEventListener("click", () => {
    setProjectNameEditing(false);
    ui.editButton.focus();
  });
  ui.renameForm.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    setProjectNameEditing(false);
    ui.editButton.focus();
  });
  ui.nameControls.addEventListener("focusout", (event) => {
    if (event.relatedTarget && !ui.nameControls.contains(event.relatedTarget)) setProjectNameEditing(false);
  });
  document.addEventListener("pointerdown", (event) => {
    if (!ui.nameControls.contains(event.target)) setProjectNameEditing(false);
  });
}
