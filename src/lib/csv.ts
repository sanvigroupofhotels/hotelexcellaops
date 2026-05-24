/** Tiny RFC4180-style CSV builder with UTF-8 BOM for Excel. */
export function toCSV(rows: Record<string, any>[], columns?: string[]): string {
  if (!rows.length) return "\uFEFF";
  const cols = columns ?? Object.keys(rows[0]);
  const esc = (v: any) => {
    if (v === null || v === undefined) return "";
    const s = String(v).replace(/"/g, '""');
    return /[",\n\r]/.test(s) ? `"${s}"` : s;
  };
  const header = cols.join(",");
  const body = rows.map((r) => cols.map((c) => esc(r[c])).join(",")).join("\n");
  return "\uFEFF" + header + "\n" + body;
}

export function downloadCSV(filename: string, rows: Record<string, any>[], columns?: string[]) {
  if (!rows.length) {
    // Avoid silently doing nothing — surface to caller.
    throw new Error("Nothing to export — no rows match the current filters");
  }
  const csv = toCSV(rows, columns);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });

  // iOS Safari path
  const nav = navigator as any;
  if (nav.share && /iPad|iPhone|iPod/.test(navigator.userAgent)) {
    const file = new File([blob], filename, { type: "text/csv" });
    if (nav.canShare && nav.canShare({ files: [file] })) {
      nav.share({ files: [file], title: filename }).catch(() => {});
      return;
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 1000);
}
