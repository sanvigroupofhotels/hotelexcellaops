import { createFileRoute } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { Topbar } from "@/components/topbar";
import { mockQuotes } from "@/lib/mock-data";
import { Bell, MessageCircle, Phone, Mail } from "lucide-react";

export const Route = createFileRoute("/follow-ups")({
  component: FollowUps,
});

function FollowUps() {
  const items = mockQuotes.filter((q) => ["Pending", "Sent", "Negotiating", "No Response"].includes(q.status)).slice(0, 5);
  return (
    <>
      <Topbar title="Follow-ups" subtitle="Thoughtful, timely touches that convert" />
      <div className="px-4 md:px-8 py-6 md:py-8 space-y-4 max-w-[1100px]">
        {items.map((q, i) => (
          <motion.div
            key={q.id}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.06 }}
            className="luxe-card rounded-xl p-5 flex flex-col md:flex-row md:items-center gap-4 hover:border-gold/40 transition"
          >
            <div className="h-10 w-10 rounded-md bg-gold-soft border border-gold/30 flex items-center justify-center">
              <Bell className="h-4 w-4 text-gold" />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm">{q.guest}</span>
                <span className="text-[11px] text-muted-foreground font-mono">{q.id}</span>
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                {q.roomType} · {q.checkIn} – {q.checkOut} · ₹{q.amount.toLocaleString("en-IN")}
              </div>
            </div>
            <div className="flex gap-2">
              <button className="inline-flex items-center gap-1.5 rounded-md bg-success/15 border border-success/40 text-success px-3 py-2 text-xs hover:bg-success/20">
                <MessageCircle className="h-3.5 w-3.5" /> WhatsApp
              </button>
              <button className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-2 text-xs hover:border-gold/40">
                <Phone className="h-3.5 w-3.5 text-gold" /> Call
              </button>
              <button className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-2 text-xs hover:border-gold/40">
                <Mail className="h-3.5 w-3.5 text-gold" /> Email
              </button>
            </div>
          </motion.div>
        ))}
      </div>
    </>
  );
}
