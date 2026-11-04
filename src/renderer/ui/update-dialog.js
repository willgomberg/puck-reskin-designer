/*
 * UPDATE DIALOG
 * DESCRIPTION: Checks for newer version of app (via GitHub releases).
 * PROCESS: Renderer
 */

const ui = {
  dialog: document.querySelector("#update-dialog"),
  message: document.querySelector("#update-message"),
  versions: document.querySelector("#update-versions"),
  error: document.querySelector("#update-error"),
  retryButton: document.querySelector("#update-retry"),
  releaseButton: document.querySelector("#update-open-release"),
  closeButton: document.querySelector("#update-close"),
};
let callbacks;
let busy = false;

// ---------- Dialog display and actions ----------

export function isUpdateDialogOpen() {
  return ui.dialog.open;
}

function setError(message = "") {
  ui.error.textContent = message;
  ui.error.hidden = !message;
}

export async function openUpdateDialog() {
  if (busy) return;
  busy = true;
  setError();
  ui.message.textContent = "Checking GitHub for a newer release…";
  ui.message.dataset.type = "info";
  ui.versions.hidden = true;
  ui.retryButton.hidden = true;
  ui.releaseButton.hidden = true;
  ui.releaseButton.disabled = false;
  if (!ui.dialog.open) ui.dialog.showModal();
  ui.closeButton.focus();

  try {
    const result = await callbacks.check();
    if (!ui.dialog.open) return;
    if (result.status === "error") throw new Error(result.message);
    ui.message.textContent = result.status === "available"
      ? "A newer version of Puck Reskin Designer is available."
      : "No newer release is available.";
    ui.message.dataset.type = "success";
    ui.versions.textContent = `Installed: ${result.installedVersion} · Available: ${result.availableVersion}`;
    ui.versions.hidden = false;
    ui.releaseButton.hidden = result.status !== "available";
  } catch (error) {
    if (!ui.dialog.open) return;
    ui.message.textContent = "Could not check for updates.";
    ui.message.dataset.type = "error";
    setError(error.message);
    ui.retryButton.hidden = false;
  } finally {
    busy = false;
  }
}

async function openReleasePage() {
  if (busy) return;
  busy = true;
  ui.releaseButton.disabled = true;
  setError();
  try {
    const result = await callbacks.openReleasePage();
    if (result.status === "error") throw new Error(result.message);
  } catch (error) {
    if (ui.dialog.open) setError(error.message);
  } finally {
    busy = false;
    ui.releaseButton.disabled = false;
  }
}

// ---------- Event wiring ----------

export function connectUpdateDialog(actions) {
  callbacks = actions;
  ui.retryButton.addEventListener("click", openUpdateDialog);
  ui.releaseButton.addEventListener("click", openReleasePage);
  ui.closeButton.addEventListener("click", () => ui.dialog.close());
}
