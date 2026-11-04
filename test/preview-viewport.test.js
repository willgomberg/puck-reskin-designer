/*
 * PREVIEW VIEWPORT TESTS
 * DESCRIPTION: Tests preview zoom, pan, fitting, and camera bounds.
 * PROCESS: Tests (Node.js)
 */

// ---------- Imports and fixtures ----------

import test from "node:test";
import assert from "node:assert/strict";

import {
  COMPLETE_RINK_VIEW_BOX,
  calculatePannedViewBox,
  calculateZoomedViewBox,
  formatZoomPercentage,
  getResetViewBox,
  getZoomForViewBox,
} from "../src/renderer/ui/preview-viewport.js";

function assertViewBoxIsClose(actual, expected) {
  Object.keys(expected).forEach((key) => {
    assert.ok(
      Math.abs(actual[key] - expected[key]) < 1e-9,
      `${key}: expected ${expected[key]}, received ${actual[key]}`,
    );
  });
}

// ---------- Tests ----------

test("100% and reset return the exact complete rink view", () => {
  const viewBox = calculateZoomedViewBox(
    { x: 100, y: 100, width: 4096, height: 2048 },
    1,
    { x: 2048, y: 1024 },
  );

  assert.deepEqual(viewBox, COMPLETE_RINK_VIEW_BOX);
  assert.deepEqual(getResetViewBox(), COMPLETE_RINK_VIEW_BOX);
  assert.notEqual(getResetViewBox(), COMPLETE_RINK_VIEW_BOX);
});

test("center-anchored zoom keeps the same rink center", () => {
  const viewBox = calculateZoomedViewBox(
    COMPLETE_RINK_VIEW_BOX,
    2,
    { x: 4096, y: 2048 },
  );

  assert.deepEqual(viewBox, { x: 2048, y: 1024, width: 4096, height: 2048 });
});

test("a tall preview keeps the fitted rink size and fills the preview when zoomed", () => {
  const previewSize = { width: 1200, height: 800 };
  const fit = getResetViewBox(previewSize);

  assertViewBoxIsClose(fit, {
    x: 0,
    y: (4096 - 8192 / 1.5) / 2,
    width: 8192,
    height: 8192 / 1.5,
  });
  assert.equal(getZoomForViewBox(fit), 1);

  const zoomed = calculateZoomedViewBox(fit, 4, { x: 4096, y: 2048 });
  assertViewBoxIsClose(zoomed, {
    x: 3072,
    y: 2048 - 8192 / 1.5 / 8,
    width: 2048,
    height: 8192 / 1.5 / 4,
  });
  assert.equal(zoomed.width / zoomed.height, previewSize.width / previewSize.height);
  assert.equal(getZoomForViewBox(zoomed), 4);
});

test("panning a zoomed tall preview stops at the visible rink edges", () => {
  const viewBox = calculateZoomedViewBox(
    getResetViewBox({ width: 1200, height: 800 }),
    2,
    { x: 4096, y: 2048 },
  );

  assert.equal(calculatePannedViewBox(viewBox, { x: 0, y: 10000 }, { width: 1200, height: 800 }).y, 0);
  assert.equal(calculatePannedViewBox(viewBox, { x: 0, y: -10000 }, { width: 1200, height: 800 }).y, 4096 - viewBox.height);
});

test("a wide preview fits the rink vertically and keeps its zoom when resized", () => {
  const wideFit = getResetViewBox({ width: 1000, height: 350 });
  assertViewBoxIsClose(wideFit, {
    x: (8192 - 4096 * 1000 / 350) / 2,
    y: 0,
    width: 4096 * 1000 / 350,
    height: 4096,
  });

  const tallFit = getResetViewBox({ width: 1000, height: 700 });
  const zoomed = calculateZoomedViewBox(tallFit, 4, { x: 4096, y: 2048 });
  const resized = calculateZoomedViewBox(
    zoomed,
    getZoomForViewBox(zoomed),
    { x: 4096, y: 2048 },
    { width: 1000, height: 350 },
  );

  assert.equal(getZoomForViewBox(resized), 4);
  assert.equal(resized.width / resized.height, 1000 / 350);
});

test("off-center zoom preserves the rink point beneath the pointer", () => {
  const anchor = { x: 2048, y: 3072 };
  const viewBox = calculateZoomedViewBox(COMPLETE_RINK_VIEW_BOX, 2, anchor);

  assert.deepEqual(viewBox, { x: 1024, y: 1536, width: 4096, height: 2048 });
  assert.equal((anchor.x - viewBox.x) / viewBox.width, 0.25);
  assert.equal((anchor.y - viewBox.y) / viewBox.height, 0.75);
});

test("zoom clamps to the 100% minimum and 800% maximum", () => {
  const center = { x: 4096, y: 2048 };

  assert.deepEqual(
    calculateZoomedViewBox(COMPLETE_RINK_VIEW_BOX, 0.2, center),
    COMPLETE_RINK_VIEW_BOX,
  );
  assert.deepEqual(
    calculateZoomedViewBox(COMPLETE_RINK_VIEW_BOX, 20, center),
    { x: 3584, y: 1792, width: 1024, height: 512 },
  );
});

test("drag displacement pans in the natural direction using SVG units", () => {
  const result = calculatePannedViewBox(
    { x: 2048, y: 1024, width: 4096, height: 2048 },
    { x: 100, y: -50 },
    { width: 1000, height: 500 },
  );

  assert.deepEqual(result, { x: 1638.4, y: 1228.8, width: 4096, height: 2048 });
});

test("panning clamps the view at all four rink edges", () => {
  const viewBox = { x: 2048, y: 1024, width: 4096, height: 2048 };
  const viewportSize = { width: 1000, height: 500 };

  assert.deepEqual(
    calculatePannedViewBox(viewBox, { x: 10000, y: 10000 }, viewportSize),
    { x: 0, y: 0, width: 4096, height: 2048 },
  );
  assert.deepEqual(
    calculatePannedViewBox(viewBox, { x: -10000, y: -10000 }, viewportSize),
    { x: 4096, y: 2048, width: 4096, height: 2048 },
  );
});

test("camera calculations retain precise zoom despite rounded display text", () => {
  const preciseZoom = 1.754;
  const firstView = calculateZoomedViewBox(
    COMPLETE_RINK_VIEW_BOX,
    preciseZoom,
    { x: 4096, y: 2048 },
  );

  assert.equal(formatZoomPercentage(firstView), "175%");
  assert.ok(Math.abs(getZoomForViewBox(firstView) - preciseZoom) < 1e-12);

  const secondView = calculateZoomedViewBox(
    firstView,
    getZoomForViewBox(firstView) + 0.25,
    { x: 4096, y: 2048 },
  );
  assertViewBoxIsClose(secondView, {
    x: 4096 - 8192 / 2.004 / 2,
    y: 2048 - 4096 / 2.004 / 2,
    width: 8192 / 2.004,
    height: 4096 / 2.004,
  });
});
