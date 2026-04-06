export const DEFAULT_BACKGROUND_SWIRL_SPEED = 1;

const SWIRL_MIN_ZOOM = 1.08;
const SWIRL_ZOOM_DELTA = 0.04;
const SWIRL_DRIFT_RATIO = 0.7;

export interface CoverPlacementInput {
  viewportWidth: number;
  viewportHeight: number;
  imageWidth: number;
  imageHeight: number;
  scaleMultiplier: number;
}

export interface ImageTransform {
  drawX: number;
  drawY: number;
  drawWidth: number;
  drawHeight: number;
}

export interface SwirlTransformInput {
  viewportWidth: number;
  viewportHeight: number;
  imageWidth: number;
  imageHeight: number;
  animationEnabled: boolean;
  swirlSpeed: number;
  nowMs: number;
}

export function computeCoverPlacement(input: CoverPlacementInput): ImageTransform {
  const { viewportWidth, viewportHeight, imageWidth, imageHeight, scaleMultiplier } = input;

  const scale =
    Math.max(viewportWidth / imageWidth, viewportHeight / imageHeight) * scaleMultiplier;
  const drawWidth = imageWidth * scale;
  const drawHeight = imageHeight * scale;

  return {
    drawX: (viewportWidth - drawWidth) / 2,
    drawY: (viewportHeight - drawHeight) / 2,
    drawWidth,
    drawHeight,
  };
}

export function computeSwirlTransform(input: SwirlTransformInput): ImageTransform {
  const {
    viewportWidth,
    viewportHeight,
    imageWidth,
    imageHeight,
    animationEnabled,
    swirlSpeed,
    nowMs,
  } = input;

  if (!animationEnabled) {
    return computeCoverPlacement({
      viewportWidth,
      viewportHeight,
      imageWidth,
      imageHeight,
      scaleMultiplier: 1,
    });
  }

  const timeSec = nowMs / 1000;
  const clampedSpeed = Number.isFinite(swirlSpeed)
    ? Math.min(Math.max(swirlSpeed, 0.1), 3)
    : DEFAULT_BACKGROUND_SWIRL_SPEED;

  const zoomPhase = Math.sin(timeSec * clampedSpeed * 0.08);
  const scaleMultiplier = SWIRL_MIN_ZOOM + ((zoomPhase + 1) / 2) * SWIRL_ZOOM_DELTA;
  const placement = computeCoverPlacement({
    viewportWidth,
    viewportHeight,
    imageWidth,
    imageHeight,
    scaleMultiplier,
  });

  const spareX = Math.max(0, (placement.drawWidth - viewportWidth) / 2);
  const spareY = Math.max(0, (placement.drawHeight - viewportHeight) / 2);

  const driftX = Math.sin(timeSec * clampedSpeed * 0.23) * spareX * SWIRL_DRIFT_RATIO;
  const driftY = Math.sin(timeSec * clampedSpeed * 0.31 + Math.PI / 4) * spareY * SWIRL_DRIFT_RATIO;

  return {
    drawX: placement.drawX + driftX,
    drawY: placement.drawY + driftY,
    drawWidth: placement.drawWidth,
    drawHeight: placement.drawHeight,
  };
}

export class BackgroundImageManager {
  private image: HTMLImageElement | null = null;

  constructor(imageUrl: string) {
    const image = new Image();
    image.src = imageUrl;
    this.image = image;
  }

  draw(
    ctx: CanvasRenderingContext2D,
    viewportWidth: number,
    viewportHeight: number,
    animationEnabled: boolean,
    swirlSpeed: number,
    nowMs: number,
  ): boolean {
    if (
      !this.image ||
      !this.image.complete ||
      this.image.naturalWidth <= 0 ||
      this.image.naturalHeight <= 0
    ) {
      return false;
    }

    const transform = computeSwirlTransform({
      viewportWidth,
      viewportHeight,
      imageWidth: this.image.naturalWidth,
      imageHeight: this.image.naturalHeight,
      animationEnabled,
      swirlSpeed,
      nowMs,
    });

    ctx.drawImage(
      this.image,
      transform.drawX,
      transform.drawY,
      transform.drawWidth,
      transform.drawHeight,
    );
    return true;
  }
}
