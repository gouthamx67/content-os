import { describe, expect, it } from "vitest";
import {
  assetExtensionForMime,
  assetUploadName,
  imageBytesMatchMime,
  isAllowedAssetUpload,
  isImageAssetType,
  MAX_ASSET_UPLOAD_BYTES,
} from "./asset-upload";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
const WEBP = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x10, 0, 0, 0, 0x57, 0x45, 0x42, 0x50,
]);

describe("asset upload rules", () => {
  it("accepts images for screenshot types and refuses documents", () => {
    expect(isImageAssetType("SCREENSHOT")).toBe(true);
    expect(isImageAssetType("UI_CAPTURE")).toBe(true);
    expect(isImageAssetType("VIDEO")).toBe(false);
    expect(isAllowedAssetUpload("SCREENSHOT", "image/png")).toBe(true);
    expect(isAllowedAssetUpload("SCREENSHOT", "application/pdf")).toBe(false);
    expect(isAllowedAssetUpload("DOCUMENT", "application/pdf")).toBe(true);
    expect(isAllowedAssetUpload("VIDEO", "video/mp4")).toBe(true);
    expect(isAllowedAssetUpload("OTHER", "text/plain")).toBe(true);
  });

  it("maps an accepted mime to the stored extension", () => {
    expect(assetExtensionForMime("image/png")).toBe("png");
    expect(assetExtensionForMime("image/jpeg")).toBe("jpg");
    expect(assetExtensionForMime("application/pdf")).toBe("pdf");
    expect(assetExtensionForMime("application/x-thing")).toBeNull();
  });

  it("keeps the display name usable by the image resolver", () => {
    expect(assetUploadName("Dashboard", "dash.png", "png")).toBe(
      "Dashboard.png",
    );
    expect(assetUploadName("", "dash.png", "png")).toBe("dash.png");
    expect(assetUploadName("Shot.PNG", "shot.png", "png")).toBe("Shot.PNG");
    expect(assetUploadName("Shot.jpeg", "shot.jpeg", "jpg")).toBe("Shot.jpeg");
    expect(assetUploadName("../../x", "x.png", "png")).toBe(".._.._x.png");
  });

  it("checks image bytes instead of trusting the declared mime", () => {
    expect(imageBytesMatchMime("image/png", PNG)).toBe(true);
    expect(imageBytesMatchMime("image/png", JPEG)).toBe(false);
    expect(imageBytesMatchMime("image/jpeg", JPEG)).toBe(true);
    expect(imageBytesMatchMime("image/webp", WEBP)).toBe(true);
    expect(
      imageBytesMatchMime("image/gif", new TextEncoder().encode("GIF89a")),
    ).toBe(true);
    expect(
      imageBytesMatchMime("image/png", new TextEncoder().encode("<html>")),
    ).toBe(false);
  });

  it("caps uploads at 10 MB", () => {
    expect(MAX_ASSET_UPLOAD_BYTES).toBe(10 * 1024 * 1024);
  });
});
