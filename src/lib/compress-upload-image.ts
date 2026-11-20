/** Compress only browser-decodable still photos, just before transmission.
 * PDFs, animation and unsupported formats retain their original bytes.
 * Never replace an upload with a larger file or block it on codec failure.
 */
export const IMAGE_COMPRESSION = { maxBytes: 280 * 1024, maxSide: 1600, quality: 0.82 } as const;

export async function compressUploadImage(file: File): Promise<File> {
  if (typeof window === "undefined" || !/^image\/(jpeg|png|webp)$/i.test(file.type) || file.size <= IMAGE_COMPRESSION.maxBytes) {
    return file;
  }
  try {
    // PNG/WebP can contain animation despite their still-image MIME types.
    if (/^image\/(png|webp)$/i.test(file.type)) {
      const bytes = await file.arrayBuffer();
      const view = new DataView(bytes);
      const png = file.type.toLowerCase() === "image/png";
      for (let offset = png ? 8 : 12; offset + 8 <= view.byteLength;) {
        const length = view.getUint32(offset + (png ? 0 : 4), !png);
        const kind = String.fromCharCode(...new Uint8Array(bytes, offset + (png ? 4 : 0), 4));
        if (kind === "acTL" || kind === "ANIM" || kind === "ANMF") return file;
        offset += 8 + length + (png ? 4 : length % 2);
      }
    }
    const { default: compress } = await import("browser-image-compression");
    const result = await compress(file, {
      maxSizeMB: IMAGE_COMPRESSION.maxBytes / (1024 * 1024),
      maxWidthOrHeight: IMAGE_COMPRESSION.maxSide,
      initialQuality: IMAGE_COMPRESSION.quality,
      maxIteration: 10,
      fileType: "image/jpeg",
      useWebWorker: false,
      preserveExif: false,
    });
    if (result.size >= file.size || result.size === 0) return file;
    const name = `${file.name.replace(/\.[^.]+$/, "")}.jpg`;
    return new File([result], name, { type: "image/jpeg", lastModified: file.lastModified });
  } catch {
    return file;
  }
}