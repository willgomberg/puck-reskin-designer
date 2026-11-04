/*
 * GRAPHIC OVERLAY
 * DESCRIPTION: Validates imported PNG data and prepares the graphic overlay.
 * PROCESS: Renderer and Main
 */

const MAX_DECODED_PIXELS = 16_000_000;
const PNG_DATA_URL_PREFIX_PATTERN = /^data:image\/png;base64,/i;
const BASE64_PAYLOAD_PATTERN = /^[a-z0-9+/]*={0,2}$/i;

export const GRAPHIC_OVERLAY_LIMITS = Object.freeze({
  maxDecodedPixels: MAX_DECODED_PIXELS,
  // Allow PNG overhead beyond the max decoded RGBA pixel data
  maxEncodedBytes: MAX_DECODED_PIXELS * 4 + 1_000_000,
  maxDimension: 8192,
  defaultMaxWidth: 1200,
  defaultMaxHeight: 1200,
  minScale: 0.1,
  maxScale: 2.5,
  minOffsetX: -4096,
  maxOffsetX: 4096,
  minOffsetY: -2048,
  maxOffsetY: 2048,
});

const PNG_HEADER_LENGTH = 24;
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

// ---------- Alpha bounds and display calculations ----------

export function findVisibleAlphaBounds(pixelData, width, height) {
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (pixelData[(y * width + x) * 4 + 3] > 0) {
        left = Math.min(left, x);
        top = Math.min(top, y);
        right = Math.max(right, x);
        bottom = Math.max(bottom, y);
      }
    }
  }

  return right < left
    ? null
    : { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
}

export function calculateInitialGraphicScale(sourceWidth, sourceHeight, limits = GRAPHIC_OVERLAY_LIMITS) {
  return Math.min(
    1,
    limits.defaultMaxWidth / sourceWidth,
    limits.defaultMaxHeight / sourceHeight,
  );
}

export function calculateGraphicDisplaySize(sourceWidth, sourceHeight, scale) {
  return {
    width: sourceWidth * scale,
    height: sourceHeight * scale,
  };
}

export function calculateGraphicQuality(scale) {
  return {
    upscaleRatio: scale,
    severity: scale <= 1 ? "none" : scale <= 1.3 ? "warning" : "danger",
  };
}

// ---------- PNG validation ----------

// Reads the PNG dimensions from its required IHDR chunk before image decoding
export function parsePngDimensions(headerBytes) {
  if (
    !(headerBytes instanceof Uint8Array) ||
    headerBytes.length < PNG_HEADER_LENGTH
  ) {
    throw new Error("The PNG has an invalid header.");
  }

  const hasPngSignature = PNG_SIGNATURE.every(
    (byte, index) => headerBytes[index] === byte,
  );
  const headerView = new DataView(
    headerBytes.buffer,
    headerBytes.byteOffset,
    headerBytes.byteLength,
  );
  const hasIhdrChunk =
    headerView.getUint32(8) === 13 &&
    String.fromCharCode(...headerBytes.slice(12, 16)) === "IHDR";

  if (!hasPngSignature || !hasIhdrChunk) {
    throw new Error("The PNG has an invalid header.");
  }

  return {
    width: headerView.getUint32(16),
    height: headerView.getUint32(20),
  };
}

// Read dimensions from a bounded base64 payload without image decoding
export function parsePngDataUrlDimensions(dataUrl, limits = GRAPHIC_OVERLAY_LIMITS) {
  const prefix = typeof dataUrl === "string"
    ? dataUrl.match(PNG_DATA_URL_PREFIX_PATTERN)?.[0]
    : null;
  const base64Payload = prefix ? dataUrl.slice(prefix.length) : "";
  const paddingLength = base64Payload.endsWith("==")
    ? 2
    : Number(base64Payload.endsWith("="));
  const decodedByteLength = base64Payload.length * 3 / 4 - paddingLength;

  if (
    base64Payload.length < 32 ||
    base64Payload.length % 4 !== 0 ||
    !BASE64_PAYLOAD_PATTERN.test(base64Payload) ||
    decodedByteLength > limits.maxEncodedBytes
  ) {
    return null;
  }

  try {
    const headerBytes = Uint8Array.from(
      atob(base64Payload.slice(0, 32)),
      (character) => character.charCodeAt(0),
    );
    return parsePngDimensions(headerBytes);
  } catch {
    return null;
  }
}

// Decode the saved PNG to validate it without trimming or re-encoding
export async function validateStoredGraphicOverlay(graphic) {
  if (!graphic) return;
  const image = new Image();
  image.src = graphic.pngDataUrl;
  try {
    await image.decode();
    if (image.naturalWidth !== graphic.sourceWidth || image.naturalHeight !== graphic.sourceHeight) {
      throw new Error("The stored PNG dimensions do not match.");
    }
  } catch {
    throw new Error("The project's graphic overlay PNG could not be decoded.");
  } finally {
    image.src = "";
  }
}

// ---------- PNG import ----------

export async function prepareGraphicOverlay(pngBlob, fileName, limits = GRAPHIC_OVERLAY_LIMITS) {
  const hasPngType = pngBlob instanceof Blob &&
    (!pngBlob.type || pngBlob.type === "image/png");
  if (!hasPngType || typeof fileName !== "string" || !fileName.toLowerCase().endsWith(".png")) {
    throw new Error("Choose a valid PNG file.");
  }

  if (pngBlob.size > limits.maxEncodedBytes) {
    throw new Error("The PNG file is too large to import safely.");
  }

  let bitmap;

  try {
    const headerBytes = new Uint8Array(
      await pngBlob.slice(0, PNG_HEADER_LENGTH).arrayBuffer(),
    );
    const encodedDimensions = parsePngDimensions(headerBytes);
    validateDecodedSize(
      encodedDimensions.width,
      encodedDimensions.height,
      limits,
    );

    bitmap = await createImageBitmap(pngBlob);
    validateDecodedSize(bitmap.width, bitmap.height, limits);
    if (
      bitmap.width !== encodedDimensions.width ||
      bitmap.height !== encodedDimensions.height
    ) {
      throw new Error("The PNG dimensions do not match its header.");
    }

    const sourceCanvas = document.createElement("canvas");
    sourceCanvas.width = bitmap.width;
    sourceCanvas.height = bitmap.height;
    const sourceContext = sourceCanvas.getContext("2d", { willReadFrequently: true });
    sourceContext.drawImage(bitmap, 0, 0);
    bitmap.close();
    bitmap = null;

    let pixelData = sourceContext.getImageData(
      0,
      0,
      sourceCanvas.width,
      sourceCanvas.height,
    ).data;
    const bounds = findVisibleAlphaBounds(
      pixelData,
      sourceCanvas.width,
      sourceCanvas.height,
    );
    pixelData = null;

    if (!bounds) {
      throw new Error("The PNG is completely transparent.");
    }

    const usesCompleteSource =
      bounds.x === 0 &&
      bounds.y === 0 &&
      bounds.width === sourceCanvas.width &&
      bounds.height === sourceCanvas.height;
    let outputCanvas = sourceCanvas;

    if (!usesCompleteSource) {
      outputCanvas = document.createElement("canvas");
      outputCanvas.width = bounds.width;
      outputCanvas.height = bounds.height;
      outputCanvas.getContext("2d").drawImage(
        sourceCanvas,
        bounds.x,
        bounds.y,
        bounds.width,
        bounds.height,
        0,
        0,
        bounds.width,
        bounds.height,
      );
      // Release the larger backing store before encoding the cropped canvas
      sourceCanvas.width = 0;
      sourceCanvas.height = 0;
    }

    const croppedBlob = await canvasToPngBlob(outputCanvas);
    return {
      fileName,
      pngDataUrl: await blobToDataUrl(croppedBlob),
      sourceWidth: bounds.width,
      sourceHeight: bounds.height,
      scale: calculateInitialGraphicScale(bounds.width, bounds.height, limits),
      opacity: 1,
      offsetX: 0,
      offsetY: 0,
    };
  } catch (error) {
    if (error instanceof Error && (
      error.message.startsWith("The PNG") || error.message.startsWith("Choose")
    )) {
      throw error;
    }
    throw new Error("The selected file could not be decoded as a PNG.");
  } finally {
    bitmap?.close();
  }
}

// ---------- Decoding and encoding helpers ----------

function validateDecodedSize(width, height, limits) {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width <= 0 ||
    height <= 0
  ) {
    throw new Error("The PNG has invalid dimensions.");
  }

  if (width > limits.maxDimension || height > limits.maxDimension) {
    throw new Error(`The PNG exceeds the ${limits.maxDimension}-pixel dimension limit.`);
  }

  if (width * height > limits.maxDecodedPixels) {
    throw new Error(`The PNG exceeds the ${limits.maxDecodedPixels.toLocaleString()}-pixel safety limit.`);
  }
}

function canvasToPngBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error("The cropped PNG could not be encoded."));
      }
    }, "image/png");
  });
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(reader.result));
    reader.addEventListener("error", () => reject(new Error("The cropped PNG could not be stored.")));
    reader.readAsDataURL(blob);
  });
}
