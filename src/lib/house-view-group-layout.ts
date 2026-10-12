/** Display geometry only: never changes stay dates, room placement or actions. */
export function houseViewGroupLayout(
  cellW: number,
  span: number,
  slot: number,
  slots: number,
  stacked: boolean,
  continuesLeft = false,
  continuesRight = false,
) {
  if (stacked) {
    // Separate tracks prevent two multi-day stays from painting over each other.
    return {
      left: continuesLeft ? 0 : 2,
      width: span * cellW - (continuesLeft ? 0 : 2) - (continuesRight ? 0 : 2),
      top: 2 + slot * 32,
      bottom: "auto" as const,
      height: 28,
    };
  }
  // Preserve the existing side-by-side layout for single-day groups.
  const width = (cellW - 4 - (slots - 1) * 4) / slots;
  return { left: 2 + slot * (width + 4), width };
}