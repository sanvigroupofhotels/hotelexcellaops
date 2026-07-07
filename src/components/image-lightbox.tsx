/**
 * ImageLightbox — full-screen photo viewer with pinch zoom and gallery.
 *
 * Shared by Inventory, Laundry, and any future module that needs a
 * "click thumbnail → see full image" flow. Uses react-zoom-pan-pinch for
 * touch pinch / desktop scroll zoom. Renders as a fixed-position overlay
 * appended to body, so it works from inside any dialog.
 */
import { useEffect } from "react";
import { X, ChevronLeft, ChevronRight, Download } from "lucide-react";
import { TransformWrapper, TransformComponent } from "react-zoom-pan-pinch";
import { useState } from "react";

export interface ImageLightboxProps {
  urls: (string | null | undefined)[];
  index?: number;
  onClose: () => void;
}

export function ImageLightbox({ urls, index = 0, onClose }: ImageLightboxProps) {
  const filtered = urls.filter((u): u is string => !!u);
  const [i, setI] = useState(Math.min(index, Math.max(0, filtered.length - 1)));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") setI((v) => Math.max(0, v - 1));
      if (e.key === "ArrowRight") setI((v) => Math.min(filtered.length - 1, v + 1));
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose, filtered.length]);

  if (filtered.length === 0) return null;
  const url = filtered[i];

  return (
    <div className="fixed inset-0 z-[200] bg-black/95 flex flex-col" role="dialog" aria-modal="true">
      <div className="flex items-center justify-between px-3 py-2 text-white/90 text-xs">
        <div className="tabular-nums">
          {filtered.length > 1 ? `${i + 1} / ${filtered.length}` : ""}
        </div>
        <div className="flex items-center gap-2">
          <a href={url} download target="_blank" rel="noreferrer"
            className="p-2 rounded hover:bg-white/10" aria-label="Open in new tab">
            <Download className="h-4 w-4" />
          </a>
          <button onClick={onClose} className="p-2 rounded hover:bg-white/10" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>
      <div className="flex-1 relative">
        <TransformWrapper
          key={url}
          initialScale={1}
          minScale={1}
          maxScale={6}
          doubleClick={{ mode: "toggle" }}
          wheel={{ step: 0.2 }}
          pinch={{ step: 5 }}
          centerOnInit
        >
          <TransformComponent wrapperStyle={{ width: "100%", height: "100%" }} contentStyle={{ width: "100%", height: "100%" }}>
            <img src={url} alt="" className="w-full h-full object-contain select-none" draggable={false} />
          </TransformComponent>
        </TransformWrapper>
        {filtered.length > 1 && (
          <>
            <button onClick={() => setI((v) => Math.max(0, v - 1))} disabled={i === 0}
              className="absolute left-2 top-1/2 -translate-y-1/2 p-2 rounded-full bg-black/50 text-white disabled:opacity-30">
              <ChevronLeft className="h-6 w-6" />
            </button>
            <button onClick={() => setI((v) => Math.min(filtered.length - 1, v + 1))} disabled={i === filtered.length - 1}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-full bg-black/50 text-white disabled:opacity-30">
              <ChevronRight className="h-6 w-6" />
            </button>
          </>
        )}
      </div>
      {filtered.length > 1 && (
        <div className="flex gap-2 p-2 overflow-x-auto bg-black">
          {filtered.map((u, idx) => (
            <button key={idx} onClick={() => setI(idx)}
              className={`h-14 w-14 shrink-0 rounded overflow-hidden border-2 ${idx === i ? "border-gold" : "border-transparent opacity-60"}`}>
              <img src={u} alt="" className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
