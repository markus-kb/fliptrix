export const DEFAULT_BACKGROUND_PULSE_SPEED = 1;

const PULSE_MIN_ZOOM = 1.05;
const PULSE_ZOOM_DELTA = 0.1;

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

export interface PulseTransformInput {
  viewportWidth: number;
  viewportHeight: number;
  imageWidth: number;
  imageHeight: number;
  animationEnabled: boolean;
  pulseSpeed: number;
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

export function computePulseTransform(input: PulseTransformInput): ImageTransform {
  const {
    viewportWidth,
    viewportHeight,
    imageWidth,
    imageHeight,
    animationEnabled,
    pulseSpeed,
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
  const clampedSpeed = Number.isFinite(pulseSpeed)
    ? Math.min(Math.max(pulseSpeed, 0.1), 3)
    : DEFAULT_BACKGROUND_PULSE_SPEED;

  // Gentle pulsating zoom - no drift, just breathing effect
  const zoomPhase = Math.sin(timeSec * clampedSpeed * 0.4);
  const scaleMultiplier = PULSE_MIN_ZOOM + ((zoomPhase + 1) / 2) * PULSE_ZOOM_DELTA;

  return computeCoverPlacement({
    viewportWidth,
    viewportHeight,
    imageWidth,
    imageHeight,
    scaleMultiplier,
  });
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
    pulseSpeed: number,
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

    const transform = computePulseTransform({
      viewportWidth,
      viewportHeight,
      imageWidth: this.image.naturalWidth,
      imageHeight: this.image.naturalHeight,
      animationEnabled,
      pulseSpeed,
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
