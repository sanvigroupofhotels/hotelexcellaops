/**
 * PhotoPicker — mobile-friendly multi-photo capture / upload.
 *
 * Two entry points: "Take Photo" (camera, single shot) and "Upload Photo"
 * (gallery, multiple). Selected files are held in local state and previewed
 * as thumbnails. Clicking a thumbnail opens the ImageLightbox. Also renders
 * any already-uploaded existing photos (by signed URL) with a remove hook
 * if provided.
 *
 * The parent owns persistence — on submit the parent uploads whatever is
 * in `files` and passes any existing paths through.
 */
import { useMemo, useRef, useState } from "react";
import { Camera, Upload, X } from "lucide-react";
import { ImageLightbox } from "./image-lightbox";

export interface PhotoPickerProps {
  files: File[];
  onFilesChange: (files: File[]) => void;
  existingUrls?: string[];
  onRemoveExisting?: (index: number) => void;
  label?: string;
  disabled?: boolean;
}

export function PhotoPicker({ files, onFilesChange, existingUrls = [], onRemoveExisting, label, disabled }: PhotoPickerProps) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const [lightboxAt, setLightboxAt] = useState<number | null>(null);

  const objectUrls = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);
  const allUrls = [...existingUrls, ...objectUrls];

  const append = (list: FileList | null) => {
    if (!list) return;
    onFilesChange([...files, ...Array.from(list)]);
  };

  return (
    <div className="space-y-2">
      {label && (
        <label className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1">
          <Camera className="h-3 w-3" /> {label}
        </label>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={disabled} onClick={() => cameraRef.current?.click()}
          className="inline-flex items-center gap-1.5 border border-border rounded-md px-3 py-2 text-xs hover:bg-muted/40 disabled:opacity-50">
          <Camera className="h-3.5 w-3.5" /> Take Photo
        </button>
        <button type="button" disabled={disabled} onClick={() => galleryRef.current?.click()}
          className="inline-flex items-center gap-1.5 border border-border rounded-md px-3 py-2 text-xs hover:bg-muted/40 disabled:opacity-50">
          <Upload className="h-3.5 w-3.5" /> Upload Photo
        </button>
        <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden"
          onChange={(e) => { append(e.target.files); e.target.value = ""; }} />
        <input ref={galleryRef} type="file" accept="image/*" multiple className="hidden"
          onChange={(e) => { append(e.target.files); e.target.value = ""; }} />
      </div>
      {allUrls.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {allUrls.map((u, idx) => {
            const isExisting = idx < existingUrls.length;
            return (
              <div key={idx} className="relative h-16 w-16 rounded-md overflow-hidden border border-border bg-muted/20">
                <button type="button" onClick={() => setLightboxAt(idx)} className="block h-full w-full">
                  <img src={u} alt="" className="h-full w-full object-cover" />
                </button>
                <button type="button"
                  onClick={() => {
                    if (isExisting) onRemoveExisting?.(idx);
                    else {
                      const local = idx - existingUrls.length;
                      onFilesChange(files.filter((_, i) => i !== local));
                    }
                  }}
                  className="absolute top-0.5 right-0.5 h-5 w-5 rounded-full bg-black/70 text-white inline-flex items-center justify-center"
                  aria-label="Remove">
                  <X className="h-3 w-3" />
                </button>
              </div>
            );
          })}
        </div>
      )}
      {lightboxAt !== null && (
        <ImageLightbox urls={allUrls} index={lightboxAt} onClose={() => setLightboxAt(null)} />
      )}
    </div>
  );
}
