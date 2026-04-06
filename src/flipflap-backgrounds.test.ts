import { describe, expect, it } from "vitest";

import {
  getFlipFlapBackgroundAssets,
  resolveFlipFlapBackgroundImageUrl,
} from "./flipflap-backgrounds";

describe("flipflap background assets", () => {
  it("discovers background images from src/assets/bg", () => {
    const assets = getFlipFlapBackgroundAssets();
    const names = assets.map((asset) => asset.fileName);

    expect(names).toContain("airport1.jpg");
    expect(names).toContain("airport2.jpg");
  });

  it("resolves a selected image filename to a bundled URL", () => {
    const url = resolveFlipFlapBackgroundImageUrl("airport1.jpg");

    expect(url).toBeTruthy();
  });

  it("returns null for missing filenames", () => {
    expect(resolveFlipFlapBackgroundImageUrl(null)).toBeNull();
    expect(resolveFlipFlapBackgroundImageUrl("does-not-exist.jpg")).toBeNull();
  });
});
