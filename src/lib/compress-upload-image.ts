/** Compress only browser-decodable still photos, just before transmission.
 * PDFs, animation and unsupported formats retain their original bytes.
 * Never replace an upload with a larger file or block it on codec failure.
 */
export async function compressUploadImage(file: File): Promise<File> {
  if (typeof window === "undefined" || !/^image\/(jpeg|png|webp)$/i.test(file.type) || file.size <= 300 * 1024) {
    return file;
  }
  try {
    const { default: compress } = await import("browser-image-compression");
    const result = await compress(file, {
      maxSizeMB: 0.75,
      maxWidthOrHeight: 2400,
      initialQuality: 0.88,
      maxIteration: 4,
      // Do not sacrifice readable ID/receipt text to chase a fixed percentage.
      alwaysKeepResolution: true,
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