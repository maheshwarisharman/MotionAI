/**
 * Reference image service — validates, downloads/decodes, and prepares
 * user-supplied images for Gemini multimodal prompts and Remotion rendering.
 */

import fs from "fs";
import http from "http";
import https from "https";
import path from "path";
import { URL } from "url";
import type {
  PreparedReferenceImage,
  ReferenceImageInput,
} from "../types/index.js";
import { logger } from "../utils/logger.js";

const MAX_REFERENCE_IMAGES = 5;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_TOTAL_IMAGE_BYTES = 20 * 1024 * 1024;

const MIME_TO_EXTENSION: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

function sanitizeBaseName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function isAllowedImageMimeType(mimeType: string): boolean {
  return Object.hasOwn(MIME_TO_EXTENSION, mimeType);
}

function getExtensionForMimeType(mimeType: string): string {
  return MIME_TO_EXTENSION[mimeType] ?? "png";
}

function inferFileStem(input: ReferenceImageInput, index: number): string {
  const sourceName =
    input.name ??
    (input.url ? path.basename(new URL(input.url).pathname) : `reference-${index + 1}`);
  const stem = sourceName.replace(/\.[^.]+$/, "");
  return sanitizeBaseName(stem) || `reference-${index + 1}`;
}

function parseDataUrl(dataUrl: string): { mimeType: string; buffer: Buffer } {
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,([a-zA-Z0-9+/=]+)$/u.exec(
    dataUrl,
  );

  if (!match) {
    throw new Error("Reference image dataUrl must be a valid base64 image data URL");
  }

  const mimeType = match[1];
  const base64Payload = match[2];

  if (!mimeType || !base64Payload) {
    throw new Error("Reference image dataUrl is missing mime type or content");
  }

  if (!isAllowedImageMimeType(mimeType)) {
    throw new Error(`Unsupported reference image type "${mimeType}"`);
  }

  const buffer = Buffer.from(base64Payload, "base64");

  if (buffer.length === 0) {
    throw new Error("Reference image dataUrl decoded to an empty file");
  }

  if (buffer.length > MAX_IMAGE_BYTES) {
    throw new Error("Reference image exceeds the 5MB size limit");
  }

  return { mimeType, buffer };
}

async function downloadImage(url: string): Promise<{ mimeType: string; buffer: Buffer }> {
  const parsedUrl = new URL(url);
  const client = parsedUrl.protocol === "https:" ? https : http;

  return new Promise((resolve, reject) => {
    const request = client.get(parsedUrl, (response) => {
      if (
        response.statusCode &&
        response.statusCode >= 300 &&
        response.statusCode < 400 &&
        response.headers.location
      ) {
        response.resume();
        resolve(downloadImage(new URL(response.headers.location, parsedUrl).toString()));
        return;
      }

      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`Image URL returned HTTP ${response.statusCode ?? "unknown"}`));
        return;
      }

      const contentTypeHeader = response.headers["content-type"]?.split(";")[0]?.trim();
      if (!contentTypeHeader || !isAllowedImageMimeType(contentTypeHeader)) {
        response.resume();
        reject(new Error("Image URL must return a supported image content-type"));
        return;
      }

      const chunks: Buffer[] = [];
      let totalBytes = 0;

      response.on("data", (chunk: Buffer) => {
        totalBytes += chunk.length;
        if (totalBytes > MAX_IMAGE_BYTES) {
          response.destroy(new Error("Reference image exceeds the 5MB size limit"));
          return;
        }
        chunks.push(chunk);
      });

      response.on("end", () => {
        resolve({
          mimeType: contentTypeHeader,
          buffer: Buffer.concat(chunks),
        });
      });

      response.on("error", reject);
    });

    request.on("error", reject);
    request.setTimeout(10_000, () => {
      request.destroy(new Error("Timed out while downloading reference image"));
    });
  });
}

export class ReferenceImageService {
  async prepareImages(
    referenceImages: ReferenceImageInput[] | undefined,
  ): Promise<PreparedReferenceImage[]> {
    if (!referenceImages?.length) {
      return [];
    }

    if (referenceImages.length > MAX_REFERENCE_IMAGES) {
      throw new Error(`A maximum of ${MAX_REFERENCE_IMAGES} reference images is allowed`);
    }

    const preparedImages: PreparedReferenceImage[] = [];
    let totalBytes = 0;

    for (const [index, image] of referenceImages.entries()) {
      const hasUrl = typeof image.url === "string";
      const hasDataUrl = typeof image.dataUrl === "string";

      if (hasUrl === hasDataUrl) {
        throw new Error(
          "Each reference image must include exactly one of `url` or `dataUrl`",
        );
      }

      const source = hasDataUrl
        ? parseDataUrl(image.dataUrl as string)
        : await downloadImage(image.url as string);

      totalBytes += source.buffer.length;
      if (totalBytes > MAX_TOTAL_IMAGE_BYTES) {
        throw new Error("Combined reference images exceed the 20MB size limit");
      }

      const filename = `${inferFileStem(image, index)}.${getExtensionForMimeType(source.mimeType)}`;

      preparedImages.push({
        filename,
        mimeType: source.mimeType,
        buffer: source.buffer,
        base64Data: source.buffer.toString("base64"),
      });
    }

    return preparedImages;
  }

  writeImagesToJobDirectory(jobDir: string, images: PreparedReferenceImage[]): void {
    if (!images.length) {
      return;
    }

    const assetsDir = path.join(jobDir, "assets");
    fs.mkdirSync(assetsDir, { recursive: true });

    for (const image of images) {
      const outputPath = path.join(assetsDir, image.filename);
      fs.writeFileSync(outputPath, image.buffer);
      logger.debug({ msg: "Wrote reference image asset", outputPath });
    }
  }
}

export const referenceImageService = new ReferenceImageService();
