/*
 * LAYER BROWSER TESTS
 * DESCRIPTION: Tests shared and mixed fills through layer-row updates.
 * PROCESS: Tests (Node.js)
 */

// ---------- Imports and fixtures ----------

import test from "node:test";
import assert from "node:assert/strict";

function createRow() {
  const controls = new Map();
  return {
    classList: { toggle() {} },
    querySelector(selector) {
      if (!controls.has(selector)) {
        controls.set(selector, {
          style: {}, dataset: {}, classList: { toggle() {} }, setAttribute() {},
        });
      }
      return controls.get(selector);
    },
  };
}

// ---------- Tests ----------

test("layer swatches preserve shared fills and give each mixed fill an equal portion", async () => {
  const layerRow = createRow();
  let elementRows;
  const group = {
    querySelector(selector) {
      if (selector === '[data-row-type="layer"]') return layerRow;
      if (selector === "[data-element-list]") return null;
      return elementRows[Number(selector.match(/\d+/)[0])];
    },
  };
  const previousDocument = globalThis.document;
  globalThis.document = {
    querySelector: () => ({ querySelector: () => group }),
  };

  try {
    const { updateLayerGroup } = await import("../src/renderer/ui/layer-browser.js");
    const solid = (color) => ({ kind: "solid", color });
    const gradient = (gradientKey) => ({ kind: "linear-gradient", gradientKey });
    const stops = [{ color: "#0000ff", offset: 0 }, { color: "#ff0000", offset: 1 }];
    const state = {
      layers: {}, gradientDefinitions: {
        horizontal: { directionDegrees: 0, stops },
        vertical: { directionDegrees: 90, stops },
        diagonal: { directionDegrees: 45, stops },
        other: { directionDegrees: 180, stops: [
          { color: "#00ff00", offset: 0 }, { color: "#ffffff", offset: 1 },
        ] },
      },
    };
    const render = (fills) => {
      elementRows = fills.map(createRow);
      state.layers.lines = {
        key: "lines", name: "Lines", elements: fills.map((fill, index) => ({
          key: String(index), name: `Line ${index}`,
          appearance: { fill, opacity: 1 }, isSelected: false,
        })),
      };
      updateLayerGroup(state, "lines");
      return layerRow.querySelector(".layer-swatch").style.background;
    };

    assert.equal(render([solid("#ffffff"), solid("#ffffff")]), "#ffffff no-repeat border-box");
    for (const [key, angle] of [["horizontal", 90], ["vertical", 180], ["diagonal", 135]]) {
      const shared = render([gradient(key), gradient(key)]);
      assert.equal(shared, `linear-gradient(${angle}deg, #0000ff 0%, #ff0000 100%) no-repeat border-box`);
      assert.equal(elementRows[0].querySelector(".layer-swatch").style.background, shared);
    }

    const mixed = render([gradient("horizontal"), solid("#ffffff")]);
    assert.match(mixed, /^linear-gradient\(180deg, #0000ff 0%, #ff0000 100%\) 0 0 \/ 50% 100% no-repeat border-box,/);
    assert.match(mixed, /linear-gradient\(#ffffff, #ffffff\) 0 0 \/ 100% 100% no-repeat border-box$/);
    assert.match(elementRows[0].querySelector(".layer-swatch").style.background, /^linear-gradient\(90deg,/);

    for (const second of ["vertical", "other"]) {
      const mixedGradients = render([gradient("horizontal"), gradient(second)]);
      assert.equal((mixedGradients.match(/linear-gradient\(180deg,/g) ?? []).length, 2);
      assert.match(mixedGradients, /\/ 50% 100% no-repeat border-box,/);
      assert.match(mixedGradients, /\/ 100% 100% no-repeat border-box$/);
    }

    const colors = ["#ff0000", "#ffffff", "#ffffff", "#ffffff"];
    const mixedSolids = render(colors.map(solid));
    assert.deepEqual([...mixedSolids.matchAll(/\/ (\d+)% 100%/g)].map((match) => Number(match[1])), [25, 50, 75, 100]);
    assert.match(mixedSolids, /^linear-gradient\(#ff0000, #ff0000\) 0 0/);
    assert.match(mixedSolids, /linear-gradient\(#ffffff, #ffffff\) 0 0 \/ 100%/);
    assert.equal(render([gradient("diagonal")]), "linear-gradient(135deg, #0000ff 0%, #ff0000 100%) no-repeat border-box");

    render([solid("#ffffff"), solid("#ffffff")]);
    const [left, right] = state.layers.lines.elements;
    const eye = (row) => row.querySelector(".visibility-toggle").dataset.visibility;
    left.appearance.opacity = 0;
    right.appearance.opacity = 0.01;
    updateLayerGroup(state, "lines");
    assert.equal(eye(layerRow), "mixed");
    assert.equal(eye(elementRows[0]), "hidden");
    assert.equal(eye(elementRows[1]), "visible");

    updateLayerGroup(state, "lines", [{ elementKey: right.key, nextAppearance: { opacity: 0 } }]);
    assert.equal(eye(layerRow), "hidden");
    assert.equal(eye(elementRows[1]), "hidden");
    assert.equal(right.appearance.opacity, 0.01);
    updateLayerGroup(state, "lines");
    assert.equal(eye(layerRow), "mixed");
    assert.equal(eye(elementRows[1]), "visible");
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});
