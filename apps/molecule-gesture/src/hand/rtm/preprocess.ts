/**
 * Pre/post-processing for the OpenMMLab RTMDet-nano hand detector and the
 * RTMPose-m hand5 landmark model, matching the mmdeploy SDK pipeline.json
 * shipped with the official ONNX exports (and rtmlib's reference code).
 *
 * Everything works on plain RGBA buffers so the same code runs in a browser
 * worker and in Node tests.
 */

export interface RgbaImage {
  data: Uint8ClampedArray | Uint8Array;
  width: number;
  height: number;
}

export interface BBox {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

// RTMDet: BGR channel order, Resize(keep_ratio) + Pad(114) to 320x320.
const DET_MEAN_BGR = [103.53, 116.28, 123.675];
const DET_STD_BGR = [57.375, 57.12, 58.395];
const DET_PAD_VALUE = 114;

// RTMPose: RGB channel order, TopDownAffine to 256x256, border value 0.
const POSE_MEAN_RGB = [123.675, 116.28, 103.53];
const POSE_STD_RGB = [58.395, 57.12, 57.375];

/** Bilinear sample of channel values at a fractional source position. */
function sampleInto(
  img: RgbaImage,
  sx: number,
  sy: number,
  out: Float32Array,
  outOfBounds: number,
): void {
  const { data, width, height } = img;
  if (sx < -1 || sy < -1 || sx > width || sy > height) {
    out[0] = out[1] = out[2] = outOfBounds;
    return;
  }
  const x0 = Math.floor(sx);
  const y0 = Math.floor(sy);
  const fx = sx - x0;
  const fy = sy - y0;
  const xa = Math.min(Math.max(x0, 0), width - 1);
  const xb = Math.min(Math.max(x0 + 1, 0), width - 1);
  const ya = Math.min(Math.max(y0, 0), height - 1);
  const yb = Math.min(Math.max(y0 + 1, 0), height - 1);
  // Out-of-range neighbours contribute the border value (cv2 BORDER_CONSTANT).
  const inXa = x0 >= 0 && x0 < width;
  const inXb = x0 + 1 >= 0 && x0 + 1 < width;
  const inYa = y0 >= 0 && y0 < height;
  const inYb = y0 + 1 >= 0 && y0 + 1 < height;
  const w00 = (1 - fx) * (1 - fy);
  const w10 = fx * (1 - fy);
  const w01 = (1 - fx) * fy;
  const w11 = fx * fy;
  const i00 = (ya * width + xa) * 4;
  const i10 = (ya * width + xb) * 4;
  const i01 = (yb * width + xa) * 4;
  const i11 = (yb * width + xb) * 4;
  for (let c = 0; c < 3; c++) {
    const v00 = inXa && inYa ? data[i00 + c] : outOfBounds;
    const v10 = inXb && inYa ? data[i10 + c] : outOfBounds;
    const v01 = inXa && inYb ? data[i01 + c] : outOfBounds;
    const v11 = inXb && inYb ? data[i11 + c] : outOfBounds;
    out[c] = v00 * w00 + v10 * w10 + v01 * w01 + v11 * w11;
  }
}

export interface DetectorInput {
  tensor: Float32Array;
  /** Scale applied to the source image (input = source * ratio). */
  ratio: number;
  size: number;
}

/** Letterbox the frame into a size x size BGR, mean/std-normalised CHW tensor. */
export function preprocessDetector(img: RgbaImage, size = 320): DetectorInput {
  const ratio = Math.min(size / img.height, size / img.width);
  const rw = Math.max(1, Math.floor(img.width * ratio));
  const rh = Math.max(1, Math.floor(img.height * ratio));
  const scaleX = img.width / rw;
  const scaleY = img.height / rh;
  const plane = size * size;
  const tensor = new Float32Array(3 * plane);
  const px = new Float32Array(3);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r: number, g: number, b: number;
      if (x < rw && y < rh) {
        sampleInto(img, (x + 0.5) * scaleX - 0.5, (y + 0.5) * scaleY - 0.5, px, 0);
        r = px[0];
        g = px[1];
        b = px[2];
      } else {
        r = g = b = DET_PAD_VALUE;
      }
      const i = y * size + x;
      tensor[i] = (b - DET_MEAN_BGR[0]) / DET_STD_BGR[0];
      tensor[plane + i] = (g - DET_MEAN_BGR[1]) / DET_STD_BGR[1];
      tensor[2 * plane + i] = (r - DET_MEAN_BGR[2]) / DET_STD_BGR[2];
    }
  }
  return { tensor, ratio, size };
}

export interface Detection extends BBox {
  score: number;
}

/**
 * Decode the end-to-end detector output. mmdeploy bakes NMS into the graph:
 * `dets` is [1, N, 5] = (x1, y1, x2, y2, score) in letterboxed input pixels.
 */
export function decodeDetections(
  dets: Float32Array,
  numDets: number,
  ratio: number,
  frameWidth: number,
  frameHeight: number,
  minScore: number,
): Detection[] {
  const out: Detection[] = [];
  for (let i = 0; i < numDets; i++) {
    const score = dets[i * 5 + 4];
    if (!(score >= minScore)) continue;
    const x1 = clamp(dets[i * 5] / ratio, 0, frameWidth);
    const y1 = clamp(dets[i * 5 + 1] / ratio, 0, frameHeight);
    const x2 = clamp(dets[i * 5 + 2] / ratio, 0, frameWidth);
    const y2 = clamp(dets[i * 5 + 3] / ratio, 0, frameHeight);
    if (x2 - x1 < 4 || y2 - y1 < 4) continue;
    out.push({ x1, y1, x2, y2, score });
  }
  out.sort((a, b) => b.score - a.score);
  return out;
}

export interface PoseCrop {
  tensor: Float32Array;
  centerX: number;
  centerY: number;
  /** Source-pixel width/height covered by the model input. */
  scaleW: number;
  scaleH: number;
  inputW: number;
  inputH: number;
}

/**
 * mmpose TopdownGetBboxCenterScale(padding=1.25) + aspect fix + TopdownAffine.
 * With no rotation the affine is: src = center + (dst - input/2) * scale/input.
 */
export function preprocessPose(
  img: RgbaImage,
  box: BBox,
  inputW = 256,
  inputH = 256,
  padding = 1.25,
): PoseCrop {
  const centerX = (box.x1 + box.x2) / 2;
  const centerY = (box.y1 + box.y2) / 2;
  let scaleW = (box.x2 - box.x1) * padding;
  let scaleH = (box.y2 - box.y1) * padding;
  const aspect = inputW / inputH;
  if (scaleW > scaleH * aspect) scaleH = scaleW / aspect;
  else scaleW = scaleH * aspect;

  const plane = inputW * inputH;
  const tensor = new Float32Array(3 * plane);
  const px = new Float32Array(3);
  const stepX = scaleW / inputW;
  const stepY = scaleH / inputH;
  const originX = centerX - scaleW / 2;
  const originY = centerY - scaleH / 2;
  for (let v = 0; v < inputH; v++) {
    const sy = originY + v * stepY;
    for (let u = 0; u < inputW; u++) {
      sampleInto(img, originX + u * stepX, sy, px, 0);
      const i = v * inputW + u;
      tensor[i] = (px[0] - POSE_MEAN_RGB[0]) / POSE_STD_RGB[0];
      tensor[plane + i] = (px[1] - POSE_MEAN_RGB[1]) / POSE_STD_RGB[1];
      tensor[2 * plane + i] = (px[2] - POSE_MEAN_RGB[2]) / POSE_STD_RGB[2];
    }
  }
  return { tensor, centerX, centerY, scaleW, scaleH, inputW, inputH };
}

export interface DecodedKeypoint {
  x: number;
  y: number;
  score: number;
}

/**
 * SimCC decode (mmpose get_simcc_maximum): argmax along each 1-D
 * classification vector, divide by simcc_split_ratio, score = min(maxX, maxY),
 * then map from model-input pixels back to source-frame pixels.
 */
export function decodeSimcc(
  simccX: Float32Array,
  simccY: Float32Array,
  numKeypoints: number,
  binsX: number,
  binsY: number,
  crop: PoseCrop,
  splitRatio = 2.0,
): DecodedKeypoint[] {
  const out: DecodedKeypoint[] = [];
  for (let k = 0; k < numKeypoints; k++) {
    let bestX = 0;
    let maxX = -Infinity;
    const offX = k * binsX;
    for (let i = 0; i < binsX; i++) {
      const v = simccX[offX + i];
      if (v > maxX) {
        maxX = v;
        bestX = i;
      }
    }
    let bestY = 0;
    let maxY = -Infinity;
    const offY = k * binsY;
    for (let i = 0; i < binsY; i++) {
      const v = simccY[offY + i];
      if (v > maxY) {
        maxY = v;
        bestY = i;
      }
    }
    const score = Math.min(maxX, maxY);
    const ix = bestX / splitRatio;
    const iy = bestY / splitRatio;
    out.push({
      x: (ix / crop.inputW) * crop.scaleW + crop.centerX - crop.scaleW / 2,
      y: (iy / crop.inputH) * crop.scaleH + crop.centerY - crop.scaleH / 2,
      score: score > 0 ? score : 0,
    });
  }
  return out;
}

/** Tight box around confident keypoints, expanded for tracking the next frame. */
export function bboxFromKeypoints(
  keypoints: DecodedKeypoint[],
  minScore: number,
  expand: number,
  frameWidth: number,
  frameHeight: number,
): BBox | null {
  let x1 = Infinity;
  let y1 = Infinity;
  let x2 = -Infinity;
  let y2 = -Infinity;
  let n = 0;
  for (const kp of keypoints) {
    if (kp.score < minScore) continue;
    n++;
    x1 = Math.min(x1, kp.x);
    y1 = Math.min(y1, kp.y);
    x2 = Math.max(x2, kp.x);
    y2 = Math.max(y2, kp.y);
  }
  if (n < 8) return null;
  const cx = (x1 + x2) / 2;
  const cy = (y1 + y2) / 2;
  // Hands are roughly square once fingers are spread; use the longer side.
  const side = Math.max(x2 - x1, y2 - y1) * expand;
  return {
    x1: clamp(cx - side / 2, 0, frameWidth),
    y1: clamp(cy - side / 2, 0, frameHeight),
    x2: clamp(cx + side / 2, 0, frameWidth),
    y2: clamp(cy + side / 2, 0, frameHeight),
  };
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
