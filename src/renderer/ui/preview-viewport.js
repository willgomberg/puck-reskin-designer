/*
 * PREVIEW VIEWPORT
 * DESCRIPTION: Manages preview zoom and pan and requests SVG viewBox updates.
 * PROCESS: Renderer
 */

// ---------- Camera configuration and state ----------

const RINK_WIDTH = 8192;
const RINK_HEIGHT = 4096;
const MIN_ZOOM = 1;
const MAX_ZOOM = 8;
const BUTTON_ZOOM_STEP = 0.25;
const WHEEL_ZOOM_RATE = 0.002;

export const COMPLETE_RINK_VIEW_BOX = Object.freeze({
  x: 0,
  y: 0,
  width: RINK_WIDTH,
  height: RINK_HEIGHT,
});

let rinkSvg = null;
let currentViewBox = { ...COMPLETE_RINK_VIEW_BOX };
let renderedViewBox = { ...COMPLETE_RINK_VIEW_BOX };
let onViewBoxChange = null;
let pendingFrame = null;
let activePointerId = null;
let previousPointerPosition = null;

let ui = null;

// ---------- Pure camera geometry ----------

export function getZoomForViewBox(viewBox) {
  return Math.max(RINK_WIDTH / viewBox.width, RINK_HEIGHT / viewBox.height);
}

export function getResetViewBox(viewBox = COMPLETE_RINK_VIEW_BOX) {
  const aspectRatio = viewBox.width / viewBox.height;
  const width = Math.max(RINK_WIDTH, RINK_HEIGHT * aspectRatio);
  const height = width / aspectRatio;

  return {
    x: (RINK_WIDTH - width) / 2,
    y: (RINK_HEIGHT - height) / 2,
    width,
    height,
  };
}

export function calculateZoomedViewBox(viewBox, requestedZoom, anchorPoint, viewportSize) {
  const zoom = clamp(requestedZoom, MIN_ZOOM, MAX_ZOOM);
  const fittedViewBox = viewportSize
    ? getResetViewBox({ width: viewportSize.width, height: viewportSize.height })
    : getResetViewBox(viewBox);
  const width = fittedViewBox.width / zoom;
  const height = fittedViewBox.height / zoom;
  const xRatio = (anchorPoint.x - viewBox.x) / viewBox.width;
  const yRatio = (anchorPoint.y - viewBox.y) / viewBox.height;

  return clampViewBox({
    x: anchorPoint.x - xRatio * width,
    y: anchorPoint.y - yRatio * height,
    width,
    height,
  });
}

export function calculatePannedViewBox(
  viewBox,
  screenDisplacement,
  viewportSize,
) {
  if (getZoomForViewBox(viewBox) <= MIN_ZOOM) {
    return getResetViewBox(viewBox);
  }

  return clampViewBox({
    ...viewBox,
    // Dragging right moves the camera left 1:1, keeping content under the pointer
    x: viewBox.x - screenDisplacement.x * viewBox.width / viewportSize.width,
    y: viewBox.y - screenDisplacement.y * viewBox.height / viewportSize.height,
  });
}

export function clampViewBox(viewBox) {
  return {
    ...viewBox,
    x: viewBox.width >= RINK_WIDTH
      ? (RINK_WIDTH - viewBox.width) / 2
      : clamp(viewBox.x, 0, RINK_WIDTH - viewBox.width),
    y: viewBox.height >= RINK_HEIGHT
      ? (RINK_HEIGHT - viewBox.height) / 2
      : clamp(viewBox.y, 0, RINK_HEIGHT - viewBox.height),
  };
}

export function formatZoomPercentage(viewBox) {
  return `${Math.round(getZoomForViewBox(viewBox) * 100)}%`;
}

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}

// ---------- Target lifecycle and display ----------

export function connectPreviewViewportEvents(callbacks) {
  onViewBoxChange = callbacks.onViewBoxChange;
  ui = {
    preview: document.querySelector("#rink-preview"),
    zoomOutButton: document.querySelector("#zoom-out-button"),
    zoomResetButton: document.querySelector("#zoom-reset-button"),
    zoomInButton: document.querySelector("#zoom-in-button"),
  };
  ui.zoomOutButton.addEventListener("click", () =>
    zoomFromCenter(-BUTTON_ZOOM_STEP),
  );
  ui.zoomResetButton.addEventListener("click", resetViewport);
  ui.zoomInButton.addEventListener("click", () => zoomFromCenter(BUTTON_ZOOM_STEP));
  ui.preview.addEventListener("wheel", handleWheel, { passive: false });
  ui.preview.addEventListener("pointerdown", startPan);
  ui.preview.addEventListener("pointermove", continuePan);
  ui.preview.addEventListener("pointerup", endPan);
  ui.preview.addEventListener("pointercancel", endPan);
  ui.preview.addEventListener("lostpointercapture", endPan);
  new ResizeObserver(resizeViewport).observe(ui.preview);
  updateControls();
}

export function setPreviewViewportTarget(nextRinkSvg) {
  if (activePointerId !== null) {
    endPan({ pointerId: activePointerId });
  }

  rinkSvg = nextRinkSvg;
  currentViewBox = getResetViewBox(getPreviewSize());
  renderedViewBox = { ...currentViewBox };
  scheduleViewBoxUpdate();
  updateControls();
}

function resetViewport() {
  if (!rinkSvg) {
    return;
  }

  currentViewBox = getResetViewBox(currentViewBox);
  scheduleViewBoxUpdate();
  updateControls();
}

function zoomFromCenter(zoomChange) {
  const center = {
    x: currentViewBox.x + currentViewBox.width / 2,
    y: currentViewBox.y + currentViewBox.height / 2,
  };
  setZoom(getZoomForViewBox(currentViewBox) + zoomChange, center);
}

function setZoom(zoom, anchorPoint) {
  currentViewBox = calculateZoomedViewBox(currentViewBox, zoom, anchorPoint);
  scheduleViewBoxUpdate();
  updateControls();
}

function getPreviewSize() {
  const style = getComputedStyle(ui.preview);

  return {
    width: ui.preview.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
    height: ui.preview.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom),
  };
}

function resizeViewport() {
  if (!rinkSvg) {
    return;
  }

  const center = {
    x: currentViewBox.x + currentViewBox.width / 2,
    y: currentViewBox.y + currentViewBox.height / 2,
  };
  currentViewBox = calculateZoomedViewBox(
    currentViewBox,
    getZoomForViewBox(currentViewBox),
    center,
    getPreviewSize(),
  );
  scheduleViewBoxUpdate();
}

function scheduleViewBoxUpdate() {
  if (pendingFrame !== null) {
    return;
  }

  pendingFrame = requestAnimationFrame(() => {
    pendingFrame = null;

    if (rinkSvg) {
      onViewBoxChange({ ...currentViewBox });
      renderedViewBox = { ...currentViewBox };
    }
  });
}

function updateControls() {
  const hasTarget = Boolean(rinkSvg);
  const zoom = getZoomForViewBox(currentViewBox);
  ui.zoomOutButton.disabled = !hasTarget || zoom <= MIN_ZOOM;
  ui.zoomResetButton.disabled = !hasTarget;
  ui.zoomInButton.disabled = !hasTarget || zoom >= MAX_ZOOM;
  ui.zoomResetButton.textContent = formatZoomPercentage(currentViewBox);
  ui.preview.classList.toggle("viewport-can-pan", hasTarget && zoom > MIN_ZOOM);
  ui.preview.style.setProperty("--preview-padding-scale", Math.max(0, 2 - zoom));
}

// ---------- Wheel zoom and pointer panning ----------

function handleWheel(event) {
  if (!rinkSvg) {
    return;
  }

  event.preventDefault();
  const pointerRatios = getPointerRatios(event.clientX, event.clientY);

  if (!pointerRatios) {
    return;
  }

  const anchorPoint = {
    x: currentViewBox.x + pointerRatios.x * currentViewBox.width,
    y: currentViewBox.y + pointerRatios.y * currentViewBox.height,
  };
  // Normalize line & page-based wheel movement to a pixel-like distance
  let deltaScale = 1;

  if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) {
    deltaScale = 16;
  } else if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
    deltaScale = ui.preview.clientHeight;
  }
  const nextZoom = getZoomForViewBox(currentViewBox) *
    Math.exp(-event.deltaY * deltaScale * WHEEL_ZOOM_RATE);

  setZoom(nextZoom, anchorPoint);
}

function startPan(event) {
  if (
    !rinkSvg ||
    event.button !== 0 ||
    getZoomForViewBox(currentViewBox) <= MIN_ZOOM
  ) {
    return;
  }

  activePointerId = event.pointerId;
  previousPointerPosition = { x: event.clientX, y: event.clientY };
  ui.preview.setPointerCapture(event.pointerId);
  ui.preview.classList.add("viewport-is-panning");
  event.preventDefault();
}

function continuePan(event) {
  if (event.pointerId !== activePointerId) {
    return;
  }

  const viewportSize = getRenderedViewportSize();

  if (viewportSize) {
    currentViewBox = calculatePannedViewBox(
      currentViewBox,
      {
        x: event.clientX - previousPointerPosition.x,
        y: event.clientY - previousPointerPosition.y,
      },
      viewportSize,
    );
    previousPointerPosition = { x: event.clientX, y: event.clientY };
    scheduleViewBoxUpdate();
  }

  event.preventDefault();
}

// Map screen coordinates through rendered SVG before applying them to the pending camera
function getPointerRatios(clientX, clientY) {
  const screenTransform = rinkSvg.getScreenCTM();

  if (!screenTransform) {
    return null;
  }

  const svgPoint = new DOMPoint(clientX, clientY).matrixTransform(
    screenTransform.inverse(),
  );

  return {
    x: clamp((svgPoint.x - renderedViewBox.x) / renderedViewBox.width, 0, 1),
    y: clamp((svgPoint.y - renderedViewBox.y) / renderedViewBox.height, 0, 1),
  };
}

function getRenderedViewportSize() {
  const screenTransform = rinkSvg.getScreenCTM();

  if (!screenTransform) {
    return null;
  }

  return {
    width:
      renderedViewBox.width * Math.hypot(screenTransform.a, screenTransform.b),
    height:
      renderedViewBox.height * Math.hypot(screenTransform.c, screenTransform.d),
  };
}

function endPan(event) {
  if (event.pointerId !== activePointerId) {
    return;
  }

  activePointerId = null;
  previousPointerPosition = null;
  ui.preview.classList.remove("viewport-is-panning");

  if (ui.preview.hasPointerCapture?.(event.pointerId)) {
    ui.preview.releasePointerCapture(event.pointerId);
  }
}
