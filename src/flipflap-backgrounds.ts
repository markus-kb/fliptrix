import airport1 from "./assets/bg/airport1.jpg";
import airport2 from "./assets/bg/airport2.jpg";

export interface FlipFlapBackgroundAsset {
  fileName: string;
  label: string;
  url: string;
}

function toBackgroundLabel(fileName: string): string {
  const stem = fileName.replace(/\.[^.]+$/, "");
  return stem.replace(/[-_]+/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

const FLIPFLAP_BACKGROUND_ASSETS: FlipFlapBackgroundAsset[] = [
  {
    fileName: "airport1.jpg",
    label: toBackgroundLabel("airport1.jpg"),
    url: airport1,
  },
  {
    fileName: "airport2.jpg",
    label: toBackgroundLabel("airport2.jpg"),
    url: airport2,
  },
].sort((a, b) => a.fileName.localeCompare(b.fileName));

export function getFlipFlapBackgroundAssets(): FlipFlapBackgroundAsset[] {
  return [...FLIPFLAP_BACKGROUND_ASSETS];
}

export function resolveFlipFlapBackgroundImageUrl(
  fileName: string | null | undefined,
): string | null {
  if (!fileName) {
    return null;
  }

  const asset = FLIPFLAP_BACKGROUND_ASSETS.find((entry) => entry.fileName === fileName);
  return asset?.url ?? null;
}
