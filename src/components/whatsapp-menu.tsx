import { MessageCircle, ChevronDown } from "lucide-react";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from "@/components/ui/dropdown-menu";

export type WhatsAppTemplate =
  | "confirmation" | "payment" | "checkin" | "checkout" | "empty";

const ITEMS: { key: WhatsAppTemplate; label: string }[] = [
  { key: "confirmation", label: "Booking Confirmation" },
  { key: "checkin", label: "Check-In Welcome" },
  { key: "checkout", label: "Check-Out Thank You" },
  { key: "empty", label: "Custom Message" },
];

/**
 * Consolidated WhatsApp menu used on Booking and Quote detail pages.
 * Parent decides what each template means and how to send it.
 */
export function WhatsAppMenu({
  onSelect, disabled,
}: {
  onSelect: (t: WhatsAppTemplate) => void;
  disabled?: boolean;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          disabled={disabled}
          className="inline-flex items-center gap-2 rounded-md bg-success/15 border border-success/40 text-success px-4 py-2.5 text-sm hover:bg-success/20 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <MessageCircle className="h-4 w-4" /> WhatsApp
          <ChevronDown className="h-3.5 w-3.5 opacity-70" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[220px]">
        {ITEMS.map((it) => (
          <DropdownMenuItem key={it.key} onClick={() => onSelect(it.key)} className="cursor-pointer">
            {it.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
