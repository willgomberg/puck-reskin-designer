/*
 * GRAPHIC OVERLAY TESTS
 * DESCRIPTION: Tests PNG headers, alpha bounds, initial sizing, and quality.
 * PROCESS: Tests (Node.js)
 */

// ---------- Imports and fixtures ----------

import test from "node:test";
import assert from "node:assert/strict";

import {
  calculateGraphicDisplaySize,
  calculateGraphicQuality,
  calculateInitialGraphicScale,
  GRAPHIC_OVERLAY_LIMITS,
  findVisibleAlphaBounds,
  parsePngDataUrlDimensions,
  parsePngDimensions,
} from "../src/renderer/graphic-overlay.js";

function createPixels(width, height, visiblePoints) {
  const pixels = new Uint8ClampedArray(width * height * 4);
  visiblePoints.forEach(([x, y, alpha = 255]) => {
    pixels[(y * width + x) * 4 + 3] = alpha;
  });
  return pixels;
}

// ---------- Tests ----------

test("alpha bounds include visible edge pixels and ignore transparent pixels", () => {
  assert.deepEqual(
    findVisibleAlphaBounds(createPixels(5, 4, [[0, 0, 1], [4, 3]]), 5, 4),
    { x: 0, y: 0, width: 5, height: 4 },
  );
  assert.deepEqual(
    findVisibleAlphaBounds(createPixels(6, 5, [[2, 1], [4, 3]]), 6, 5),
    { x: 2, y: 1, width: 3, height: 3 },
  );
  assert.equal(findVisibleAlphaBounds(createPixels(3, 2, []), 3, 2), null);
});

test("default scale never upscales and fits within the default box", () => {
  assert.equal(calculateInitialGraphicScale(800, 600), 1);
  assert.equal(calculateInitialGraphicScale(2400, 600), 0.5);
  assert.equal(calculateInitialGraphicScale(600, 2400), 0.5);
  assert.deepEqual(calculateGraphicDisplaySize(2400, 600, 0.5), {
    width: 1200,
    height: 300,
  });
});

test("quality thresholds distinguish native, moderate, and strong enlargement", () => {
  assert.equal(calculateGraphicQuality(1).severity, "none");
  assert.equal(calculateGraphicQuality(1.15).severity, "warning");
  assert.equal(calculateGraphicQuality(1.3).severity, "warning");
  assert.equal(calculateGraphicQuality(1.31).severity, "danger");
});

test("PNG dimensions are read from a valid IHDR header", () => {
  const header = new Uint8Array(24);
  header.set([137, 80, 78, 71, 13, 10, 26, 10]);
  new DataView(header.buffer).setUint32(8, 13);
  header.set([73, 72, 68, 82], 12);
  new DataView(header.buffer).setUint32(16, 5000);
  new DataView(header.buffer).setUint32(20, 5000);

  assert.deepEqual(parsePngDimensions(header), { width: 5000, height: 5000 });
  const dataUrl = `data:image/png;base64,${Buffer.from(header).toString("base64")}`;
  assert.deepEqual(parsePngDataUrlDimensions(dataUrl), {
    width: 5000,
    height: 5000,
  });
  assert.equal(parsePngDataUrlDimensions("data:image/png;base64,invalid!"), null);
  assert.equal(GRAPHIC_OVERLAY_LIMITS.maxDecodedPixels, 16_000_000);
  assert.equal(GRAPHIC_OVERLAY_LIMITS.maxDimension, 8192);
  assert.equal(GRAPHIC_OVERLAY_LIMITS.minScale, 0.1);
  assert.equal(GRAPHIC_OVERLAY_LIMITS.maxScale, 2.5);

  header[0] = 0;
  assert.throws(() => parsePngDimensions(header), /invalid header/);
});
