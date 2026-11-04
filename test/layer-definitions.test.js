/*
 * LAYER DEFINITIONS TESTS
 * DESCRIPTION: Checks layer keys, default angles, and rink SVG selectors.
 * PROCESS: Tests (Node.js)
 */

// ---------- Imports and fixtures ----------

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { rinkLayerDefinitions } from "../src/renderer/layer-definitions.js";

const rinkSvgText = readFileSync(
  new URL("../Rink SVG Template.svg", import.meta.url),
  "utf8",
);

// ---------- Tests ----------

test("layer definitions use unique element keys and valid gradient directions", () => {
  const elementKeys = Object.values(rinkLayerDefinitions).flatMap((layer) =>
    layer.elements.map((element) => element.key),
  );

  assert.equal(new Set(elementKeys).size, elementKeys.length);

  Object.values(rinkLayerDefinitions).forEach((layer) => {
    assert.ok(layer.elements.length > 0);
    assert.ok(Number.isInteger(layer.defaultLinearGradientDirectionDegrees));
    assert.ok(layer.defaultLinearGradientDirectionDegrees >= 0);
    assert.ok(layer.defaultLinearGradientDirectionDegrees < 360);
  });
});

test("every configured SVG selector starts from an id in the rink template", () => {
  const templateIds = new Set(
    [...rinkSvgText.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]),
  );

  Object.values(rinkLayerDefinitions).forEach((layer) => {
    layer.elements.forEach((element) => {
      const selectorId = element.svgSelector.match(/^#([\w-]+)/)?.[1];

      assert.ok(selectorId, `${element.key} must use an id-based SVG selector`);
      assert.ok(
        templateIds.has(selectorId),
        `${element.key} references missing SVG id "${selectorId}"`,
      );
    });
  });
});

test("ice appearance targets only the canonical full-rink surface", () => {
  assert.equal(
    rinkLayerDefinitions.ice.elements[0].svgSelector,
    "#ice-all",
  );
});
