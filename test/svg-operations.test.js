/*
 * SVG OPERATIONS TESTS
 * DESCRIPTION: Tests SVG updates, exact reset, and committed export copies.
 * PROCESS: Tests (Node.js)
 */

// ---------- Imports and fixtures ----------

import test from "node:test";
import assert from "node:assert/strict";

import {
  calculateLinearGradientEndpoints,
  calculateGraphicOverlayGeometry,
  prepareSvgForPreview,
  restoreSvgNodeStates,
  serializeSvgForExport,
  updateSvgElementAppearance,
  updateSvgGraphicOverlay,
  updateSvgPreviewViewBox,
} from "../src/renderer/svg-operations.js";

function assertPointIsClose(actualPoint, expectedPoint) {
  assert.ok(Math.abs(actualPoint.x - expectedPoint.x) < 1e-9);
  assert.ok(Math.abs(actualPoint.y - expectedPoint.y) < 1e-9);
}

// Supply SVG nodes for tests
function createTestSvgNode(attributes = {}, queriedNodes = {}) {
  const savedAttributes = new Map(Object.entries(attributes));

  return {
    getAttribute(name) {
      return savedAttributes.get(name) ?? null;
    },
    setAttribute(name, value) {
      savedAttributes.set(name, value);
    },
    removeAttribute(name) {
      savedAttributes.delete(name);
    },
    querySelector(selector) {
      return queriedNodes[selector] ?? null;
    },
    querySelectorAll(selector) {
      return queriedNodes[selector] ?? [];
    },
    cloneNode() {
      return createTestSvgNode(Object.fromEntries(savedAttributes));
    },
    get savedAttributes() {
      return savedAttributes;
    },
  };
}

// ---------- Tests ----------

test("preview setup keeps SVG geometry responsive and accessible", () => {
  const iceSurface = createTestSvgNode({ width: "100%", height: "100%" });
  const iceUnderlays = [createTestSvgNode(), createTestSvgNode()];
  const rinkSvg = createTestSvgNode(
    { width: "8192", height: "4096" },
    {
      "#ice-all": iceSurface,
      "#ice > :not(#ice-all)": iceUnderlays,
    },
  );

  prepareSvgForPreview(rinkSvg);

  assert.equal(rinkSvg.getAttribute("width"), null);
  assert.equal(rinkSvg.getAttribute("height"), null);
  assert.equal(rinkSvg.getAttribute("role"), "img");
  assert.equal(
    rinkSvg.getAttribute("aria-label"),
    "Editable Puck rink preview",
  );
  assert.equal(rinkSvg.getAttribute("preserveAspectRatio"), "xMidYMid meet");
  assert.equal(iceSurface.getAttribute("width"), "8192");
  assert.equal(iceSurface.getAttribute("height"), "4096");
  iceUnderlays.forEach((iceUnderlay) => {
    assert.equal(iceUnderlay.getAttribute("display"), "none");
  });
});

test("gradient endpoints follow the chosen angle across the complete bounds", () => {
  const bounds = { x: 10, y: 20, width: 200, height: 100 };

  assert.deepEqual(calculateLinearGradientEndpoints(bounds, 0), {
    start: { x: 10, y: 70 },
    end: { x: 210, y: 70 },
  });
  assert.deepEqual(calculateLinearGradientEndpoints(bounds, 90), {
    start: { x: 110, y: 20 },
    end: { x: 110, y: 120 },
  });
  assert.deepEqual(calculateLinearGradientEndpoints(bounds, 180), {
    start: { x: 210, y: 70 },
    end: { x: 10, y: 70 },
  });
  assert.deepEqual(calculateLinearGradientEndpoints(bounds, 270), {
    start: { x: 110, y: 120 },
    end: { x: 110, y: 20 },
  });

  const diagonalEndpoints = calculateLinearGradientEndpoints(bounds, 45);
  assertPointIsClose(diagonalEndpoints.start, { x: 35, y: -5 });
  assertPointIsClose(diagonalEndpoints.end, { x: 185, y: 145 });
});

test("appearance updates every SVG node and reset restores exact attributes", () => {
  const firstNode = createTestSvgNode({
    fill: "#FFFFFF",
    opacity: "0.8",
    style: "stroke-width: 2",
  });
  const secondNode = createTestSvgNode({ visibility: "hidden", display: "none" });
  const svgNodes = [firstNode, secondNode];

  updateSvgElementAppearance(svgNodes, {
    fill: { kind: "linear-gradient", gradientKey: "element-test" },
    opacity: 0.35,
  });

  svgNodes.forEach((svgNode) => {
    assert.equal(svgNode.getAttribute("fill"), "url(#editor-gradient-element-test)");
    assert.equal(svgNode.getAttribute("opacity"), "0.35");
    assert.equal(svgNode.getAttribute("visibility"), null);
  });
  updateSvgElementAppearance(svgNodes, { fill: { kind: "solid", color: "#FFFFFF" }, opacity: 0 });
  assert.equal(firstNode.getAttribute("opacity"), "0");
  assert.equal(secondNode.getAttribute("display"), "none");

  restoreSvgNodeStates(svgNodes, [
    {
      fill: "#FFFFFF",
      opacity: "0.8",
      style: "stroke-width: 2",
      visibility: null,
    },
    { fill: null, opacity: null, style: null, visibility: "visible" },
  ]);

  assert.equal(firstNode.getAttribute("fill"), "#FFFFFF");
  assert.equal(firstNode.getAttribute("opacity"), "0.8");
  assert.equal(firstNode.getAttribute("style"), "stroke-width: 2");
  assert.equal(firstNode.getAttribute("visibility"), null);
  assert.equal(secondNode.getAttribute("fill"), null);
  assert.equal(secondNode.getAttribute("opacity"), null);
  assert.equal(secondNode.getAttribute("style"), null);
  assert.equal(secondNode.getAttribute("visibility"), "visible");
});

test("preview viewBox updates stay live while export restores complete rink bounds", () => {
  const rinkSvg = createTestSvgNode({
    viewBox: "0 0 8192 4096",
    role: "img",
    "aria-label": "Editable Puck rink preview",
  });
  const originalXmlSerializer = globalThis.XMLSerializer;

  globalThis.XMLSerializer = class {
    serializeToString(svgNode) {
      return JSON.stringify(Object.fromEntries(svgNode.savedAttributes));
    }
  };

  try {
    updateSvgPreviewViewBox(rinkSvg, {
      x: 1024,
      y: 512,
      width: 2048,
      height: 1024,
    });

    const exportAttributes = JSON.parse(serializeSvgForExport(rinkSvg));

    assert.equal(rinkSvg.getAttribute("viewBox"), "1024 512 2048 1024");
    assert.equal(exportAttributes.width, "8192");
    assert.equal(exportAttributes.height, "4096");
    assert.equal(exportAttributes.viewBox, "0 0 8192 4096");
    assert.equal(exportAttributes.role, undefined);
    assert.equal(exportAttributes["aria-label"], undefined);
  } finally {
    globalThis.XMLSerializer = originalXmlSerializer;
  }
});

test("export excludes multi-element color previews while leaving the live SVG intact", () => {
  const selectors = ["#ice-all", "#top-left-circle path"];
  const liveNodes = selectors.map(() => [
    createTestSvgNode({ fill: "#CC3344" }),
    createTestSvgNode({ fill: "#CC3344" }),
  ]);
  const exportedNodes = liveNodes.map((nodes) => nodes.map((node) => node.cloneNode()));
  const rinkSvg = createTestSvgNode();
  rinkSvg.cloneNode = () => createTestSvgNode({}, Object.fromEntries(
    selectors.map((selector, index) => [selector, exportedNodes[index]]),
  ));
  const previews = [
    {
      layerKey: "ice", elementKey: "iceAll",
      previousAppearance: { fill: { kind: "solid", color: "#008000" }, opacity: 0.8 },
    },
    {
      layerKey: "faceoffCircles", elementKey: "topLeftCircle",
      previousAppearance: { fill: { kind: "linear-gradient", gradientKey: "circle" }, opacity: 0 },
    },
  ];
  const previousSerializer = globalThis.XMLSerializer;
  globalThis.XMLSerializer = class {
    serializeToString() {
      return JSON.stringify(exportedNodes.map((nodes) => nodes.map(
        (node) => Object.fromEntries(node.savedAttributes),
      )));
    }
  };
  try {
    const exported = JSON.parse(serializeSvgForExport(rinkSvg, { appearanceChanges: previews }));
    exported[0].forEach((attributes) => {
      assert.deepEqual(attributes, { fill: "#008000", opacity: "0.8" });
    });
    exported[1].forEach((attributes) => {
      assert.deepEqual(attributes, { fill: "url(#editor-gradient-circle)", opacity: "0" });
    });
    liveNodes.flat().forEach((node) => assert.equal(node.getAttribute("fill"), "#CC3344"));
  } finally {
    globalThis.XMLSerializer = previousSerializer;
  }
});

test("export restores committed gradient resources and graphic settings only in its copy", () => {
  const committedDefinition = {
    key: "ice-gradient", kind: "linear-gradient", directionDegrees: 90,
    coordinateSpace: { kind: "element", layerKey: "ice", elementKey: "iceAll" },
    stops: [{ offset: 0, color: "#112233" }, { offset: 1, color: "#445566" }],
  };
  const committedGraphic = {
    pngDataUrl: "data:image/png;base64,AAAA", sourceWidth: 100, sourceHeight: 50,
    scale: 1, opacity: 0.8, offsetX: 0, offsetY: 0,
  };
  const liveSvg = createTestSvgNode();
  const exportedImage = createTestSvgNode({ width: "200", opacity: "0.2" });
  const exportedGradient = createTestSvgNode({ x1: "0", x2: "200" });
  const temporaryGradient = createTestSvgNode();
  let removedTemporary = false;
  temporaryGradient.remove = () => { removedTemporary = true; };
  exportedGradient.replaceChildren = (...nodes) => { exportedGradient.stops = nodes; };
  const defs = createTestSvgNode({}, {
    "#editor-gradient-ice-gradient": exportedGradient,
    "#editor-gradient-temporary": temporaryGradient,
  });
  defs.children = [exportedGradient, temporaryGradient];
  const exportedSvg = createTestSvgNode({}, {
    "defs[data-editor-gradients]": defs,
    "[data-editor-graphic-overlay]": exportedImage,
  });
  liveSvg.cloneNode = () => exportedSvg;
  const originalDocument = globalThis.document;
  const originalSerializer = globalThis.XMLSerializer;
  globalThis.document = { createElementNS: () => createTestSvgNode() };
  globalThis.XMLSerializer = class { serializeToString() { return "<svg/>"; } };
  const preview = {
    gradientDefinitionChanges: [
      { gradientKey: "ice-gradient", previousDefinition: committedDefinition },
      { gradientKey: "temporary", previousDefinition: null },
    ],
    graphicOverlayChange: { previousGraphic: committedGraphic },
  };
  try {
    serializeSvgForExport(liveSvg, preview, {
      svgBoundsByElementKey: { iceAll: { x: 0, y: 0, width: 200, height: 100 } },
    });
    assert.equal(exportedGradient.getAttribute("x1"), "100");
    assert.equal(exportedGradient.getAttribute("y1"), "0");
    assert.equal(exportedGradient.getAttribute("y2"), "100");
    assert.deepEqual(exportedGradient.stops.map((node) => node.getAttribute("stop-color")), ["#112233", "#445566"]);
    assert.equal(removedTemporary, true);
    assert.equal(exportedImage.getAttribute("width"), "100");
    assert.equal(exportedImage.getAttribute("opacity"), "0.8");
    assert.equal(exportedImage.getAttribute("x"), "4046");
    assert.equal(liveSvg.getAttribute("width"), null);
    assert.equal(liveSvg.getAttribute("viewBox"), null);
  } finally {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
    globalThis.XMLSerializer = originalSerializer;
  }
});

test("graphic overlay geometry is centered with offsets", () => {
  assert.deepEqual(calculateGraphicOverlayGeometry({
    sourceWidth: 1000,
    sourceHeight: 500,
    scale: 2,
    offsetX: 100,
    offsetY: -50,
  }), {
    width: 2000,
    height: 1000,
    x: 3196,
    y: 1498,
  });
});

test("graphic overlay is inserted after ice, updated, removed, and exported", () => {
  const children = [];
  const createNode = (tagName) => {
    const node = createTestSvgNode();
    node.tagName = tagName;
    node.remove = () => children.splice(children.indexOf(node), 1);
    return node;
  };
  const ice = createNode("g");
  const markings = createNode("g");
  children.push(ice, markings);
  ice.after = (node) => children.splice(children.indexOf(ice) + 1, 0, node);
  const rinkSvg = createTestSvgNode({}, {
    ":scope > #ice": ice,
  });
  rinkSvg.ownerDocument = { createElementNS: (_namespace, tagName) => createNode(tagName) };
  rinkSvg.querySelector = (selector) => {
    if (selector === ":scope > #ice") return ice;
    if (selector === "[data-editor-graphic-overlay]") {
      return children.find((node) => node.getAttribute("data-editor-graphic-overlay") !== null) ?? null;
    }
    return null;
  };
  rinkSvg.cloneNode = () => {
    const clone = createTestSvgNode();
    clone.hasGraphic = children.some((node) => node.getAttribute("data-editor-graphic-overlay") !== null);
    return clone;
  };
  const graphic = {
    fileName: "logo.png",
    pngDataUrl: "data:image/png;base64,AAAA",
    sourceWidth: 100,
    sourceHeight: 50,
    scale: 1,
    opacity: 0.8,
    offsetX: 0,
    offsetY: 0,
  };

  const image = updateSvgGraphicOverlay(rinkSvg, graphic);
  assert.deepEqual(children.map((node) => node.tagName), ["g", "image", "g"]);
  assert.equal(image.getAttribute("href"), graphic.pngDataUrl);
  assert.equal(image.getAttribute("x"), "4046");
  assert.equal(image.getAttribute("y"), "2023");
  assert.equal(image.getAttribute("pointer-events"), "none");

  updateSvgGraphicOverlay(rinkSvg, { ...graphic, scale: 2, opacity: 0.5 });
  assert.equal(image.getAttribute("width"), "200");
  assert.equal(image.getAttribute("opacity"), "0.5");

  const originalXmlSerializer = globalThis.XMLSerializer;
  globalThis.XMLSerializer = class {
    serializeToString(svgNode) {
      return svgNode.hasGraphic ? "<svg><image href=\"data:image/png;base64,AAAA\"/></svg>" : "<svg/>";
    }
  };
  try {
    assert.match(serializeSvgForExport(rinkSvg), /data:image\/png;base64,AAAA/);
  } finally {
    globalThis.XMLSerializer = originalXmlSerializer;
  }

  updateSvgGraphicOverlay(rinkSvg, null);
  assert.deepEqual(children.map((node) => node.tagName), ["g", "g"]);
});
