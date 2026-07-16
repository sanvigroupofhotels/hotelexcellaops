/**
 * Signature auto-processing — UAT-039.
 *
 * Client-side canvas pipeline that turns a scanned / photographed signature
 * on paper into an invoice-ready, transparent PNG:
 *
 *   1. Detect paper luminance from corner samples.
 *   2. Alpha-mask pixels: paper → transparent, ink → opaque, mid-tones → soft alpha ramp.
 *   3. Boost contrast on remaining pixels (linear stretch of L channel).
 *   4. Trim to the non-transparent bounding box with a small margin.
 *   5. Export as PNG dataURL.
 *
 * The pipeline is deterministic and free of ML dependencies — perfect for
 * the common case (dark ink on light paper). When the automatic estimate
 * fails to isolate the signature (image is too noisy or the paper is dark)
 * the caller can pass a `crop` region to restrict processing to a user-
 * selected rectangle — see the Branding upload flow.
 */

export interface SignatureProcessOptions {
  /** Restrict processing to this rectangle of the original image (pixels). */
  crop?: { x: number; y: number; w: number; h: number };
  /** Override auto-detected paper luminance (0..255). */
  paperLuminance?: number;
  /** Trim padding around the detected signature (pixels). Default 6. */
  trimPadding?: number;
}

export interface SignatureProcessResult {
  /** Processed PNG data URL (transparent background). */
  dataUrl: string;
  /** Original uploaded image as a data URL for A/B preview. */
  originalDataUrl: string;
  width: number;
  height: number;
  /** Ratio of opaque pixels — heuristic quality score (0..1). */
  inkCoverage: number;
  /** True when we could not confidently isolate the signature. */
  lowConfidence: boolean;
}

export async function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not load image"));
    img.src = src;
  });
}

export async function fileToDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result || ""));
    fr.onerror = () => reject(new Error("Could not read file"));
    fr.readAsDataURL(file);
  });
}

function luminance(r: number, g: number, b: number): number {
  // Rec. 709
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Process a signature image and return a transparent PNG dataURL.
 */
export async function processSignature(
  originalDataUrl: string,
  opts: SignatureProcessOptions = {},
): Promise<SignatureProcessResult> {
  const img = await loadImage(originalDataUrl);
  const srcW = img.naturalWidth || img.width;
  const srcH = img.naturalHeight || img.height;

  // Downscale very large images for performance; the invoice renders at
  // ~220px wide anyway.
  const MAX_DIM = 1400;
  const scale = Math.min(1, MAX_DIM / Math.max(srcW, srcH));
  const cropX = Math.max(0, Math.floor((opts.crop?.x ?? 0) * scale));
  const cropY = Math.max(0, Math.floor((opts.crop?.y ?? 0) * scale));
  const cropW = Math.max(1, Math.floor((opts.crop?.w ?? srcW) * scale));
  const cropH = Math.max(1, Math.floor((opts.crop?.h ?? srcH) * scale));

  const cvs = document.createElement("canvas");
  cvs.width = Math.floor(srcW * scale);
  cvs.height = Math.floor(srcH * scale);
  const ctx = cvs.getContext("2d", { willReadFrequently: true } as any) as CanvasRenderingContext2D | null;
  if (!ctx) throw new Error("Canvas not supported");
  ctx.drawImage(img, 0, 0, cvs.width, cvs.height);

  const region = ctx.getImageData(cropX, cropY, cropW, cropH);
  const d = region.data;

  // 1. Detect paper luminance from a border sample (skip if user supplied).
  let paperL = opts.paperLuminance;
  if (paperL == null) {
    let sum = 0;
    let n = 0;
    const stride = 4;
    const sampleRow = (y: number) => {
      for (let x = 0; x < cropW; x += stride) {
        const i = (y * cropW + x) * 4;
        sum += luminance(d[i], d[i + 1], d[i + 2]);
        n++;
      }
    };
    const sampleCol = (x: number) => {
      for (let y = 0; y < cropH; y += stride) {
        const i = (y * cropW + x) * 4;
        sum += luminance(d[i], d[i + 1], d[i + 2]);
        n++;
      }
    };
    sampleRow(0);
    sampleRow(cropH - 1);
    sampleCol(0);
    sampleCol(cropW - 1);
    paperL = n > 0 ? sum / n : 220;
  }

  // 2. Determine ink threshold. Everything within `soft` below paper stays
  //    solid ink; between `soft` and `hard` gets a soft alpha ramp; brighter
  //    than paper - hard → transparent.
  const hard = Math.max(30, paperL - 30);   // start of the ramp toward transparent
  const soft = Math.max(10, paperL - 100);  // fully opaque threshold
  const range = Math.max(1, hard - soft);

  // 3. Estimate ink pixel darkest value in the region (for contrast stretch).
  let inkMin = 255;
  for (let i = 0; i < d.length; i += 4) {
    const L = luminance(d[i], d[i + 1], d[i + 2]);
    if (L < inkMin) inkMin = L;
  }
  const stretchDen = Math.max(1, soft - inkMin);

  let opaqueCount = 0;

  for (let i = 0; i < d.length; i += 4) {
    const r = d[i];
    const g = d[i + 1];
    const b = d[i + 2];
    const L = luminance(r, g, b);

    let alpha = 0;
    if (L <= soft) alpha = 255;
    else if (L >= hard) alpha = 0;
    else alpha = Math.round(255 * (1 - (L - soft) / range));

    if (alpha > 0) {
      opaqueCount++;
      // Contrast stretch: map inkMin..soft → 0..80 so ink stays dark & crisp.
      const stretched = Math.max(0, Math.min(80, Math.round(((L - inkMin) / stretchDen) * 80)));
      d[i] = stretched;
      d[i + 1] = stretched;
      d[i + 2] = stretched;
      d[i + 3] = alpha;
    } else {
      d[i + 3] = 0;
    }
  }

  // Paint the processed region onto a fresh canvas so we can trim it.
  const trimCvs = document.createElement("canvas");
  trimCvs.width = cropW;
  trimCvs.height = cropH;
  const trimCtx = trimCvs.getContext("2d");
  if (!trimCtx) throw new Error("Canvas not supported");
  trimCtx.putImageData(region, 0, 0);

  // 4. Trim to non-transparent bounding box.
  const bboxCtx = trimCtx;
  const bbox = findBoundingBox(bboxCtx, cropW, cropH);
  const pad = opts.trimPadding ?? 6;

  let outX = 0, outY = 0, outW = cropW, outH = cropH;
  if (bbox) {
    outX = Math.max(0, bbox.minX - pad);
    outY = Math.max(0, bbox.minY - pad);
    outW = Math.min(cropW - outX, bbox.maxX - bbox.minX + 1 + pad * 2);
    outH = Math.min(cropH - outY, bbox.maxY - bbox.minY + 1 + pad * 2);
  }

  const outCvs = document.createElement("canvas");
  outCvs.width = outW;
  outCvs.height = outH;
  const outCtx = outCvs.getContext("2d");
  if (!outCtx) throw new Error("Canvas not supported");
  outCtx.drawImage(trimCvs, outX, outY, outW, outH, 0, 0, outW, outH);

  const totalPixels = cropW * cropH;
  const inkCoverage = totalPixels === 0 ? 0 : opaqueCount / totalPixels;
  // Confidence heuristics:
  //   - Ink covers virtually the whole canvas → probably a dark background.
  //   - Ink is almost invisible → probably a blank scan.
  const lowConfidence = inkCoverage < 0.001 || inkCoverage > 0.5 || !bbox;

  return {
    dataUrl: outCvs.toDataURL("image/png"),
    originalDataUrl,
    width: outW,
    height: outH,
    inkCoverage,
    lowConfidence,
  };
}

function findBoundingBox(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const img = ctx.getImageData(0, 0, w, h).data;
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = img[(y * w + x) * 4 + 3];
      if (a > 8) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return { minX, minY, maxX, maxY };
}
