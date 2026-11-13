import { afterEach, describe, expect, it, vi } from "vitest";
import { compressUploadImage } from "../src/lib/compress-upload-image";

const { compress } = vi.hoisted(() => ({ compress: vi.fn() }));
vi.mock("browser-image-compression", () => ({ default: compress }));
afterEach(() => { vi.unstubAllGlobals(); compress.mockReset(); });
const photo = () => new File([new Uint8Array(2 * 1024 * 1024)], "id.png", { type: "image/png", lastModified: 123 });

describe("upload image compression", () => {
  it("leaves PDFs unchanged", async () => {
    vi.stubGlobal("window", {});
    const pdf = new File([new Uint8Array(400000)], "bill.pdf", { type: "application/pdf" });
    expect(await compressUploadImage(pdf)).toBe(pdf);
    expect(compress).not.toHaveBeenCalled();
  });
  it("leaves already-small images unchanged", async () => {
    vi.stubGlobal("window", {});
    const small = new File(["photo"], "id.jpg", { type: "image/jpeg" });
    expect(await compressUploadImage(small)).toBe(small);
  });
  it("does not evaluate the codec outside the browser", async () => {
    vi.stubGlobal("window", undefined);
    const file = photo();
    expect(await compressUploadImage(file)).toBe(file);
    expect(compress).not.toHaveBeenCalled();
  });
  it("uses reduced bytes with matching JPEG filename and MIME", async () => {
    vi.stubGlobal("window", {});
    compress.mockResolvedValue(new Blob([new Uint8Array(120000)], { type: "image/jpeg" }));
    const result = await compressUploadImage(photo());
    expect(result.size).toBe(120000);
    expect(result.name).toBe("id.jpg");
    expect(result.type).toBe("image/jpeg");
    expect(result.lastModified).toBe(123);
  });
  it("never increases the uploaded file size", async () => {
    vi.stubGlobal("window", {});
    const file = photo();
    compress.mockResolvedValue(new Blob([new Uint8Array(file.size + 1)]));
    expect(await compressUploadImage(file)).toBe(file);
  });
  it("retains the original if decoding fails", async () => {
    vi.stubGlobal("window", {});
    const file = photo();
    compress.mockRejectedValue(new Error("Unsupported codec"));
    expect(await compressUploadImage(file)).toBe(file);
  });
});