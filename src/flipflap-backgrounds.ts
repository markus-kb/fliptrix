export interface FlipFlapBackgroundAsset {
  fileName: string;
  label: string;
  url: string;
}

const BACKGROUND_IMAGE_MODULES = import.meta.glob<{ default: string }>(
  "./assets/bg/*.{jpg,jpeg,png,webp,avif}",
  {
    eager: true,
    import: "default",
  },
);

function toBackgroundLabel(fileName: string): string {
  const stem = fileName.replace(/\.[^.]+$/, "");
  return stem.replace(/[-_]+/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

const FLIPFLAP_BACKGROUND_ASSETS: FlipFlapBackgroundAsset[] = Object.entries(
  BACKGROUND_IMAGE_MODULES,
)
  .map(([modulePath, url]) => {
    const parts = modulePath.split("/");
    const fileName = parts[parts.length - 1];
    return {
      fileName,
      label: toBackgroundLabel(fileName),
      url,
    };
  })
  .sort((a, b) => a.fileName.localeCompare(b.fileName));

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
