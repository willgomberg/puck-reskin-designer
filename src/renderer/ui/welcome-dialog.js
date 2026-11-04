/*
 * WELCOME DIALOG
 * DESCRIPTION: Shows quick-start tips on the first desktop launch.
 * PROCESS: Renderer
 */

const dialog = document.querySelector("#welcome-dialog");

// ---------- Dialog display ----------

export function isWelcomeDialogOpen() {
  return dialog.open;
}

export function openWelcomeDialog() {
  if (!dialog.open) dialog.showModal();
}
