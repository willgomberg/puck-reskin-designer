/*
 * PROJECT FORMAT
 * DESCRIPTION: Creates and validates durable version 1 project data.
 * PROCESS: Renderer and Main
 */

import { rinkLayerDefinitions } from "./layer-definitions.js";
import {
  GRAPHIC_OVERLAY_LIMITS,
  parsePngDataUrlDimensions,
} from "./graphic-overlay.js";

const FILE_TYPE = "puck-rink-reskin-project";
const FORMAT_VERSION = 1;
const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;
const GRADIENT_KEY_PATTERN = /^[a-z0-9_-]+$/i;
const MIN_STORED_GRAPHIC_SCALE = 0.01;

// Room for the largest allowed graphic PNG as base64, plus project metadata
export const MAX_PROJECT_FILE_BYTES = 100 * 1024 * 1024;

// ---------- Project snapshots ----------

export function createProjectFileData(editorState) {
  const layers = {};
  const usedGradientKeys = new Set();

  Object.entries(editorState.layers).forEach(([layerKey, layer]) => {
    const elements = {};

    layer.elements.forEach((element) => {
      elements[element.key] = {
        appearance: copyAppearance(element.appearance),
      };

      if (element.appearance.fill.kind === "linear-gradient") {
        usedGradientKeys.add(element.appearance.fill.gradientKey);
      }
    });

    layers[layerKey] = { elements };
  });

  const gradientDefinitions = {};
  usedGradientKeys.forEach((gradientKey) => {
    gradientDefinitions[gradientKey] = structuredClone(
      editorState.gradientDefinitions[gradientKey],
    );
  });

  return {
    fileType: FILE_TYPE,
    formatVersion: FORMAT_VERSION,
    layers,
    gradientDefinitions,
    graphicOverlay: editorState.graphicOverlay ? { ...editorState.graphicOverlay } : null,
  };
}

// ---------- Project parsing ----------

// Renderer separately checks that the stored PNG can be decoded
export function parseProjectFileText(projectText) {
  if (projectText.length > MAX_PROJECT_FILE_BYTES) {
    throw new Error("Project files cannot exceed 100 MiB.");
  }
  let project;

  try {
    project = JSON.parse(projectText);
  } catch {
    throw new Error("The selected file is not valid JSON.");
  }

  if (!isObject(project) || project.fileType !== FILE_TYPE) {
    throw new Error("This is not a Puck Rink Reskin project file.");
  }

  if (project.formatVersion !== FORMAT_VERSION) {
    throw new Error(
      `Project format version ${String(project.formatVersion)} is not supported.`,
    );
  }

  if (!isObject(project.layers) || !isObject(project.gradientDefinitions)) {
    throw new Error("The project layers or gradients are malformed.");
  }

  const referencedGradientKeys = new Set();

  Object.entries(project.layers).forEach(([layerKey, savedLayer]) => {
    const layerDefinition = Object.hasOwn(rinkLayerDefinitions, layerKey)
      ? rinkLayerDefinitions[layerKey]
      : null;

    if (!layerDefinition) {
      throw new Error(`The project references unknown layer "${layerKey}".`);
    }

    if (!isObject(savedLayer) || !isObject(savedLayer.elements)) {
      throw new Error(`Layer "${layerKey}" is malformed.`);
    }

    Object.entries(savedLayer.elements).forEach(([elementKey, savedElement]) => {
      const elementExists = layerDefinition.elements.some(
        (element) => element.key === elementKey,
      );

      if (!elementExists) {
        throw new Error(
          `Layer "${layerKey}" references unknown element "${elementKey}".`,
        );
      }

      validateAppearance(savedElement?.appearance, layerKey, elementKey);
      if (savedElement.appearance.fill.kind === "linear-gradient") {
        referencedGradientKeys.add(savedElement.appearance.fill.gradientKey);
      }
    });
  });

  Object.entries(project.gradientDefinitions).forEach(
    ([gradientKey, definition]) => {
      if (!referencedGradientKeys.has(gradientKey)) {
        throw new Error(`Gradient "${gradientKey}" is not used by an element.`);
      }

      validateGradientDefinition(definition, gradientKey);
    },
  );

  referencedGradientKeys.forEach((gradientKey) => {
    if (!Object.hasOwn(project.gradientDefinitions, gradientKey)) {
      throw new Error(`Gradient "${gradientKey}" is missing its definition.`);
    }
  });

  project.graphicOverlay ??= null;
  validateGraphicOverlay(project.graphicOverlay);

  return project;
}

// ---------- Design validation ----------

function validateGraphicOverlay(graphic) {
  if (graphic === null) {
    return;
  }

  const pngDimensions = parsePngDataUrlDimensions(graphic?.pngDataUrl);
  const isValid =
    isObject(graphic) &&
    typeof graphic.fileName === "string" &&
    graphic.fileName.toLowerCase().endsWith(".png") &&
    Number.isInteger(graphic.sourceWidth) &&
    graphic.sourceWidth > 0 &&
    graphic.sourceWidth <= GRAPHIC_OVERLAY_LIMITS.maxDimension &&
    Number.isInteger(graphic.sourceHeight) &&
    graphic.sourceHeight > 0 &&
    graphic.sourceHeight <= GRAPHIC_OVERLAY_LIMITS.maxDimension &&
    graphic.sourceWidth * graphic.sourceHeight <=
      GRAPHIC_OVERLAY_LIMITS.maxDecodedPixels &&
    pngDimensions?.width === graphic.sourceWidth &&
    pngDimensions.height === graphic.sourceHeight &&
    Number.isFinite(graphic.scale) &&
    // Existing saved projects can contain scales below UI's normal minimum
    graphic.scale >= MIN_STORED_GRAPHIC_SCALE &&
    graphic.scale <= GRAPHIC_OVERLAY_LIMITS.maxScale &&
    Number.isFinite(graphic.opacity) &&
    graphic.opacity >= 0 &&
    graphic.opacity <= 1 &&
    Number.isFinite(graphic.offsetX) &&
    graphic.offsetX >= GRAPHIC_OVERLAY_LIMITS.minOffsetX &&
    graphic.offsetX <= GRAPHIC_OVERLAY_LIMITS.maxOffsetX &&
    Number.isFinite(graphic.offsetY) &&
    graphic.offsetY >= GRAPHIC_OVERLAY_LIMITS.minOffsetY &&
    graphic.offsetY <= GRAPHIC_OVERLAY_LIMITS.maxOffsetY;

  if (!isValid) {
    throw new Error("The graphic overlay is malformed.");
  }
}

function validateAppearance(appearance, layerKey, elementKey) {
  if (
    !isObject(appearance) ||
    !isObject(appearance.fill) ||
    !Number.isFinite(appearance.opacity) ||
    appearance.opacity < 0 ||
    appearance.opacity > 1
  ) {
    throw new Error(`Appearance for "${layerKey}.${elementKey}" is malformed.`);
  }

  const { fill } = appearance;
  const isSolid = fill.kind === "solid" && HEX_COLOR_PATTERN.test(fill.color);
  const isGradient =
    fill.kind === "linear-gradient" &&
    typeof fill.gradientKey === "string" &&
    GRADIENT_KEY_PATTERN.test(fill.gradientKey);

  if (!isSolid && !isGradient) {
    throw new Error(`Fill for "${layerKey}.${elementKey}" is malformed.`);
  }
  if (isSolid) fill.color = fill.color.toUpperCase();
}

/*
 * Supports two-stop gradients scoped to individual elements
 * NOTE: Will need to be modified if gradients ever allow 3+ stops
*/
function validateGradientDefinition(definition, gradientKey) {
  if (
    !isObject(definition) ||
    definition.key !== gradientKey ||
    definition.kind !== "linear-gradient" ||
    !Number.isInteger(definition.directionDegrees) ||
    definition.directionDegrees < 0 ||
    definition.directionDegrees >= 360 ||
    !Array.isArray(definition.stops) ||
    definition.stops.length !== 2 ||
    definition.stops[0]?.offset !== 0 ||
    definition.stops[1]?.offset !== 1 ||
    !definition.stops.every(
      (stop) =>
        isObject(stop) &&
        Number.isFinite(stop.offset) &&
        stop.offset >= 0 &&
        stop.offset <= 1 &&
        HEX_COLOR_PATTERN.test(stop.color),
    )
  ) {
    throw new Error(`Gradient "${gradientKey}" is malformed.`);
  }

  const coordinateSpace = definition.coordinateSpace;
  const layerDefinition =
    isObject(coordinateSpace) &&
    Object.hasOwn(rinkLayerDefinitions, coordinateSpace.layerKey)
      ? rinkLayerDefinitions[coordinateSpace.layerKey]
      : null;
  const isElementSpace =
    coordinateSpace?.kind === "element" &&
    layerDefinition?.elements.some(
      (element) => element.key === coordinateSpace.elementKey,
    );

  if (!isElementSpace) {
    throw new Error(`Gradient "${gradientKey}" has an unsupported coordinate space.`);
  }
  definition.stops.forEach((stop) => {
    stop.color = stop.color.toUpperCase();
  });
}

// ---------- Data helpers ----------

function copyAppearance(appearance) {
  return structuredClone(appearance);
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
