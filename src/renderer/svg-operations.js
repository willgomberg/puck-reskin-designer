/*
 * SVG OPERATIONS
 * DESCRIPTION: Updates the visible rink SVG & optional graphic overlays, and restores appearances.
 * PROCESS: Renderer
 */

import { rinkLayerDefinitions } from "./layer-definitions.js";

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const RINK_WIDTH = 8192;
const RINK_HEIGHT = 4096;
const EDITOR_GRADIENTS_ATTRIBUTE = "data-editor-gradients";
const GRAPHIC_OVERLAY_ID = "editor-graphic-overlay";
const GRAPHIC_OVERLAY_ATTRIBUTE = "data-editor-graphic-overlay";

// ---------- SVG parsing and preview setup ----------

export function parseSvgText(svgText) {
  const svgDocument = new DOMParser().parseFromString(svgText, "image/svg+xml");

  if (svgDocument.querySelector("parsererror")) {
    throw new Error("The rink template is not valid SVG.");
  }

  return svgDocument.documentElement;
}

export function prepareSvgForPreview(rinkSvg) {
  // The viewBox keeps 2:1 ratio, CSS controls the on-screen size
  rinkSvg.removeAttribute("width");
  rinkSvg.removeAttribute("height");
  rinkSvg.setAttribute("role", "img");
  rinkSvg.setAttribute("aria-label", "Editable Puck rink preview");
  rinkSvg.setAttribute("preserveAspectRatio", "xMidYMid meet");

  // Fix the ice size so % dimensions don't follow the zoomed viewBox
  const iceSurface = rinkSvg.querySelector("#ice-all");
  iceSurface.setAttribute("width", String(RINK_WIDTH));
  iceSurface.setAttribute("height", String(RINK_HEIGHT));

  // Hide duplicate ice paths to avoid overlap artifacts on visibility / opacity changes
  rinkSvg.querySelectorAll("#ice > :not(#ice-all)").forEach((iceUnderlay) => {
    iceUnderlay.setAttribute("display", "none");
  });
}

export function updateSvgPreviewViewBox(rinkSvg, viewBox) {
  rinkSvg.setAttribute(
    "viewBox",
    `${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`,
  );
}

// ---------- Template inspection and geometry ----------

function findSvgNodes(rinkSvg, svgSelector) {
  const svgNodes = [...rinkSvg.querySelectorAll(svgSelector)];

  if (svgNodes.length === 0) {
    throw new Error(`The rink template has no SVG nodes matching "${svgSelector}".`);
  }

  return svgNodes;
}

function captureSvgNodeStates(svgNodes) {
  return svgNodes.map((svgNode) => ({
    fill: svgNode.getAttribute("fill"),
    opacity: svgNode.getAttribute("opacity"),
    style: svgNode.getAttribute("style"),
    visibility: svgNode.getAttribute("visibility"),
  }));
}

function combineBounds(boundsList) {
  const left = Math.min(...boundsList.map((bounds) => bounds.x));
  const top = Math.min(...boundsList.map((bounds) => bounds.y));
  const right = Math.max(...boundsList.map((bounds) => bounds.x + bounds.width));
  const bottom = Math.max(...boundsList.map((bounds) => bounds.y + bounds.height));

  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  };
}

function getCombinedSvgBounds(svgNodes) {
  return combineBounds(svgNodes.map((svgNode) => svgNode.getBBox()));
}

function convertRgbToHex(rgbColor) {
  const colorChannels = rgbColor.match(/[\d.]+/g)?.slice(0, 3).map(Number);

  if (!colorChannels || colorChannels.length !== 3) {
    throw new Error(`The SVG fill color "${rgbColor}" could not be read.`);
  }

  return `#${colorChannels
    .map((channel) => Math.round(channel).toString(16).padStart(2, "0"))
    .join("")}`.toUpperCase();
}

// Inspect after DOM insertion so inherited fills & getBBox() are available
export function inspectSvgElements(rinkSvg) {
  const svgNodesByElementKey = {};
  const svgBoundsByElementKey = {};
  const svgBoundsByLayerKey = {};
  const originalSvgNodeStatesByElementKey = {};
  const originalAppearanceByElementKey = {};

  Object.entries(rinkLayerDefinitions).forEach(([layerKey, layerDefinition]) => {
    layerDefinition.elements.forEach((elementDefinition) => {
      const svgNodes = findSvgNodes(rinkSvg, elementDefinition.svgSelector);
      const fillColors = new Set(
        svgNodes.map((svgNode) => convertRgbToHex(getComputedStyle(svgNode).fill)),
      );
      const opacityValues = new Set(
        svgNodes.map((svgNode) => Number(getComputedStyle(svgNode).opacity)),
      );

      if (fillColors.size !== 1) {
        throw new Error(
          `The SVG nodes for "${elementDefinition.name}" do not share one fill color.`,
        );
      }

      if (
        opacityValues.size !== 1 ||
        !Number.isFinite([...opacityValues][0])
      ) {
        throw new Error(
          `The SVG nodes for "${elementDefinition.name}" do not share one opacity.`,
        );
      }

      svgNodesByElementKey[elementDefinition.key] = svgNodes;
      svgBoundsByElementKey[elementDefinition.key] =
        getCombinedSvgBounds(svgNodes);
      originalSvgNodeStatesByElementKey[elementDefinition.key] =
        captureSvgNodeStates(svgNodes);
      originalAppearanceByElementKey[elementDefinition.key] = {
        fill: {
          kind: "solid",
          color: [...fillColors][0],
        },
        opacity: [...opacityValues][0],
      };
    });

    svgBoundsByLayerKey[layerKey] = combineBounds(
      layerDefinition.elements.map(
        (elementDefinition) => svgBoundsByElementKey[elementDefinition.key],
      ),
    );
  });

  return {
    svgNodesByElementKey,
    svgBoundsByElementKey,
    svgBoundsByLayerKey,
    originalSvgNodeStatesByElementKey,
    originalAppearanceByElementKey,
  };
}

// ---------- Appearance updates ----------

// Normal edits use cached nodes, export copies must look up their own nodes
export function updateSvgEditorAction(rinkSvg, action, svgData, isUndo = false) {
  (action.gradientDefinitionChanges ?? []).forEach((change) => {
    const definition = isUndo ? change.previousDefinition : change.nextDefinition;
    if (definition) {
      const scope = definition.coordinateSpace;
      const bounds = scope.kind === "element"
        ? svgData.svgBoundsByElementKey[scope.elementKey]
        : svgData.svgBoundsByLayerKey[scope.layerKey];
      updateSvgGradientDefinition(rinkSvg, definition, bounds);
    } else {
      removeSvgGradientDefinition(rinkSvg, change.gradientKey);
    }
  });
  (action.appearanceChanges ?? []).forEach((change) => {
    const definition = rinkLayerDefinitions[change.layerKey].elements.find(
      (element) => element.key === change.elementKey,
    );
    const nodes = svgData?.svgNodesByElementKey?.[change.elementKey] ??
      findSvgNodes(rinkSvg, definition.svgSelector);
    if (!isUndo && action.restoresOriginal) {
      restoreSvgNodeStates(nodes, svgData.originalSvgNodeStatesByElementKey[change.elementKey]);
    } else {
      updateSvgElementAppearance(nodes, isUndo ? change.previousAppearance : change.nextAppearance);
    }
  });
  if (action.graphicOverlayChange) {
    updateSvgGraphicOverlay(rinkSvg, isUndo
      ? action.graphicOverlayChange.previousGraphic
      : action.graphicOverlayChange.nextGraphic);
  }
}

export function updateSvgElementAppearance(svgNodes, appearance) {
  let fill;

  if (appearance.fill.kind === "solid") {
    fill = appearance.fill.color;
  } else if (appearance.fill.kind === "linear-gradient") {
    fill = `url(#${createSvgGradientId(appearance.fill.gradientKey)})`;
  } else {
    throw new Error(`Unsupported SVG fill kind "${appearance.fill.kind}".`);
  }

  svgNodes.forEach((svgNode) => {
    svgNode.setAttribute("fill", fill);
    svgNode.setAttribute("opacity", String(appearance.opacity));
    svgNode.removeAttribute("visibility");
  });
}

// ---------- Graphic overlay ----------

export function calculateGraphicOverlayGeometry(graphicOverlay) {
  const width = graphicOverlay.sourceWidth * graphicOverlay.scale;
  const height = graphicOverlay.sourceHeight * graphicOverlay.scale;

  return {
    width,
    height,
    x: (RINK_WIDTH - width) / 2 + graphicOverlay.offsetX,
    y: (RINK_HEIGHT - height) / 2 + graphicOverlay.offsetY,
  };
}

export function updateSvgGraphicOverlay(rinkSvg, graphicOverlay) {
  let svgImage = rinkSvg.querySelector(`[${GRAPHIC_OVERLAY_ATTRIBUTE}]`);

  if (!graphicOverlay) {
    svgImage?.remove();
    return null;
  }

  if (!svgImage) {
    const iceGroup = rinkSvg.querySelector(":scope > #ice");
    if (!iceGroup) {
      throw new Error('The rink template has no top-level "ice" group.');
    }

    svgImage = rinkSvg.ownerDocument.createElementNS(SVG_NAMESPACE, "image");
    svgImage.id = GRAPHIC_OVERLAY_ID;
    svgImage.setAttribute(GRAPHIC_OVERLAY_ATTRIBUTE, "");
    svgImage.setAttribute("pointer-events", "none");
    iceGroup.after(svgImage);
  }

  const geometry = calculateGraphicOverlayGeometry(graphicOverlay);
  svgImage.setAttribute("href", graphicOverlay.pngDataUrl);
  svgImage.setAttribute("x", String(geometry.x));
  svgImage.setAttribute("y", String(geometry.y));
  svgImage.setAttribute("width", String(geometry.width));
  svgImage.setAttribute("height", String(geometry.height));
  svgImage.setAttribute("opacity", String(graphicOverlay.opacity));
  return svgImage;
}

// ---------- Gradient resources ----------

export function updateSvgGradientDefinition(
  rinkSvg,
  gradientDefinition,
  coordinateBounds,
) {
  if (gradientDefinition.kind !== "linear-gradient") {
    throw new Error(`Unsupported gradient kind "${gradientDefinition.kind}".`);
  }

  const gradientContainer = getOrCreateEditorGradientContainer(rinkSvg);
  const gradientId = createSvgGradientId(gradientDefinition.key);
  let svgGradient = gradientContainer.querySelector(`#${gradientId}`);

  if (!svgGradient) {
    svgGradient = document.createElementNS(SVG_NAMESPACE, "linearGradient");
    svgGradient.id = gradientId;
    gradientContainer.append(svgGradient);
  }

  const { start, end } = calculateLinearGradientEndpoints(
    coordinateBounds,
    gradientDefinition.directionDegrees,
  );

  svgGradient.setAttribute("gradientUnits", "userSpaceOnUse");
  svgGradient.setAttribute("x1", String(start.x));
  svgGradient.setAttribute("y1", String(start.y));
  svgGradient.setAttribute("x2", String(end.x));
  svgGradient.setAttribute("y2", String(end.y));
  svgGradient.replaceChildren(
    ...gradientDefinition.stops.map((stop) => {
      const svgStop = document.createElementNS(SVG_NAMESPACE, "stop");
      svgStop.setAttribute("offset", String(stop.offset));
      svgStop.setAttribute("stop-color", stop.color);
      return svgStop;
    }),
  );
}

export function removeSvgGradientDefinition(rinkSvg, gradientKey) {
  const gradientContainer = rinkSvg.querySelector(
    `defs[${EDITOR_GRADIENTS_ATTRIBUTE}]`,
  );

  gradientContainer
    ?.querySelector(`#${createSvgGradientId(gradientKey)}`)
    ?.remove();

  if (gradientContainer && gradientContainer.children.length === 0) {
    gradientContainer.remove();
  }
}

function getOrCreateEditorGradientContainer(rinkSvg) {
  let gradientContainer = rinkSvg.querySelector(
    `defs[${EDITOR_GRADIENTS_ATTRIBUTE}]`,
  );

  if (!gradientContainer) {
    gradientContainer = document.createElementNS(SVG_NAMESPACE, "defs");
    gradientContainer.setAttribute(EDITOR_GRADIENTS_ATTRIBUTE, "");
    rinkSvg.prepend(gradientContainer);
  }

  return gradientContainer;
}

// Project bounds onto gradient direction to preserve its angle and cover those bounds
export function calculateLinearGradientEndpoints(bounds, directionDegrees) {
  const directionRadians = directionDegrees * Math.PI / 180;
  const rawXDirection = Math.cos(directionRadians);
  const rawYDirection = Math.sin(directionRadians);
  const xDirection = Math.abs(rawXDirection) < 1e-12 ? 0 : rawXDirection;
  const yDirection = Math.abs(rawYDirection) < 1e-12 ? 0 : rawYDirection;
  const center = {
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2,
  };
  const halfLength =
    (Math.abs(bounds.width * xDirection) +
      Math.abs(bounds.height * yDirection)) / 2;

  return {
    start: {
      x: center.x - xDirection * halfLength,
      y: center.y - yDirection * halfLength,
    },
    end: {
      x: center.x + xDirection * halfLength,
      y: center.y + yDirection * halfLength,
    },
  };
}

function createSvgGradientId(gradientKey) {
  return `editor-gradient-${gradientKey}`;
}

// ---------- Reset ----------

export function restoreSvgNodeStates(svgNodes, originalSvgNodeStates) {
  svgNodes.forEach((svgNode, index) => {
    const originalNodeState = originalSvgNodeStates[index];
    restoreAttribute(svgNode, "fill", originalNodeState.fill);
    restoreAttribute(svgNode, "opacity", originalNodeState.opacity);
    restoreAttribute(svgNode, "style", originalNodeState.style);
    restoreAttribute(svgNode, "visibility", originalNodeState.visibility);
  });
}

function restoreAttribute(svgNode, attributeName, originalValue) {
  if (originalValue === null) {
    svgNode.removeAttribute(attributeName);
    return;
  }

  svgNode.setAttribute(attributeName, originalValue);
}

// ---------- Export ----------

// Restore committed appearances in the full-rink export copy when a preview is active
export function serializeSvgForExport(rinkSvg, previewAction = null, svgData = null) {
  const exportSvg = rinkSvg.cloneNode(true);
  if (previewAction) {
    // Never use cached live nodes when restoring the export copy
    updateSvgEditorAction(exportSvg, previewAction, { ...svgData, svgNodesByElementKey: {} }, true);
  }
  exportSvg.setAttribute("xmlns", SVG_NAMESPACE);
  exportSvg.setAttribute("width", String(RINK_WIDTH));
  exportSvg.setAttribute("height", String(RINK_HEIGHT));
  exportSvg.setAttribute("viewBox", `0 0 ${RINK_WIDTH} ${RINK_HEIGHT}`);
  exportSvg.removeAttribute("role");
  exportSvg.removeAttribute("aria-label");

  return new XMLSerializer().serializeToString(exportSvg);
}

export async function createPngBlobForExport(rinkSvg, previewAction = null, svgData = null) {
  const svgText = serializeSvgForExport(rinkSvg, previewAction, svgData);
  const graphicHref = rinkSvg.querySelector(`[${GRAPHIC_OVERLAY_ATTRIBUTE}]`)?.getAttribute("href");

  // Valid PNG header does NOT guarantee the image can be decoded
  if (graphicHref) {
    try {
      await loadImageForExport(graphicHref);
    } catch {
      throw new Error("The graphic overlay could not be decoded for PNG export.");
    }
  }

  const svgBlob = new Blob([svgText], { type: "image/svg+xml;charset=utf-8" });
  const svgUrl = URL.createObjectURL(svgBlob);
  let canvas;

  try {
    const image = await loadImageForExport(svgUrl);
    if (image.naturalWidth !== RINK_WIDTH || image.naturalHeight !== RINK_HEIGHT) {
      throw new Error("The rink SVG has unexpected export dimensions.");
    }

    canvas = document.createElement("canvas");
    canvas.width = RINK_WIDTH;
    canvas.height = RINK_HEIGHT;
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("A canvas could not be created for PNG export.");
    }

    context.drawImage(image, 0, 0, RINK_WIDTH, RINK_HEIGHT);
    return await new Promise((resolve, reject) => {
      canvas.toBlob((pngBlob) => {
        if (pngBlob) {
          resolve(pngBlob);
        } else {
          reject(new Error("The rink PNG could not be encoded."));
        }
      }, "image/png");
    });
  } finally {
    URL.revokeObjectURL(svgUrl);
    // Release the large bitmap as soon as encoding finishes / fails
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
    }
  }
}

function loadImageForExport(source) {
  const image = new Image();
  image.src = source;
  return image.decode().then(() => image);
}
