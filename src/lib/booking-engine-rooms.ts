/**
 * Client-side static metadata for booking-engine room types.
 * MRP is a fixed marketing price used to show a struck-through reference.
 * Features are shown verbatim on Step 2 and Step 4.
 */
export type RoomMeta = {
  mrp: number;
  tagline: string;
  features: string[];
};

const META: Record<string, RoomMeta> = {
  Oak: {
    mrp: 5500,
    tagline: "Luxury & Comfort",
    features: ["Max 2 Guests", "1 King Bed", "City View", "Free WiFi", "Breakfast Included"],
  },
  Mapple: {
    mrp: 6500,
    tagline: "Spacious & Elegant",
    features: ["Max 2 Guests", "1 King Bed", "City View", "Free WiFi", "Breakfast Included"],
  },
};

const DEFAULT: RoomMeta = {
  mrp: 0,
  tagline: "Premium Stay",
  features: ["Free WiFi", "Breakfast Included"],
};

/** Strip trailing " Room" so we can key by base name. */
export function roomKey(type: string): string {
  return type.replace(/\s+Room$/i, "").trim();
}

export function getRoomMeta(type: string): RoomMeta {
  return META[roomKey(type)] ?? DEFAULT;
}
