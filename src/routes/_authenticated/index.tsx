import { createFileRoute, Link } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { Topbar } from "@/components/topbar";
import { StatusPill } from "@/components/status-pill";
import { listQuotes } from "@/lib/quotes-api";
import { listCustomers } from "@/lib/customers-api";
import { supabase } from "@/integrations/supabase/client";
import { useRealtimeInvalidate } from "@/hooks/use-realtime";
import {
  ArrowUpRight,
  TrendingUp,
  FilePlus,
  Clock,
  CheckCircle2,
  IndianRupee,
  Loader2,
  Users,
  CalendarPlus,
  UserPlus,
  Briefcase,
  Activity,
} from "lucide-react";

import { AdminOnly } from "@/components/admin-only";

export const Route = createFileRoute("/_authenticated/")({
  component: () => <AdminOnly><Dashboard /></AdminOnly>,
});

function startOfMonth() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function Dashboard() {
  useRealtimeInvalidate(
    ["quotes", "customers", "followups"],
    ["quotes", "customers", "followups"],
    "dashboard",
  );
  const { data: quotes = [], isLoading } = useQuery({ queryKey: ["quotes"], queryFn: listQuotes });
  const { data: customers = [] } = useQuery({ queryKey: ["customers"], queryFn: listCustomers });
  const { data: staffCount = 0 } = useQuery({
    queryKey: ["staff-count"],
    queryFn: async () => {
      const { count } = await supabase
        .from("profiles")
        .select("id", { count: "exact", head: true });
      return count ?? 0;
    },
    staleTime: 5 * 60_000,
  });

  const monthStart = startOfMonth();
  const quotesThisMonth = quotes.filter((q) => new Date(q.created_at) >= monthStart).length;
  const customersThisMonth = customers.filter(
    (c) => new Date(c.created_at) >= monthStart,
  ).length;

  const pending = quotes.filter((q) =>
    ["Draft", "Pending", "Sent", "Negotiation", "Negotiating", "No Response"].includes(q.status),
  ).length;
  const converted = quotes.filter((q) =>
    ["Confirmed", "Completed", "Converted"].includes(q.status),
  ).length;
  const estRevenue = quotes
    .filter((q) => !["Failed", "Cancelled", "Lost", "Expired"].includes(q.status))
    .reduce((s, q) => s + Number(q.total), 0);
  const conversionRate = quotes.length ? Math.round((converted / quotes.length) * 100) : 0;

  const kpis = [
    { label: "Total Quotes", value: quotes.length, icon: FilePlus },
    { label: "Total Customers", value: customers.length, icon: Users },
    { label: "Quotes This Month", value: quotesThisMonth, icon: CalendarPlus },
    { label: "Customers This Month", value: customersThisMonth, icon: UserPlus },
    { label: "Active Staff", value: staffCount, icon: Briefcase },
  ];

  const stats = [
    { label: "Pending", value: pending, icon: Clock, accent: false },
    { label: "Confirmed", value: converted, icon: CheckCircle2, accent: false },
    {
      label: "Est. Revenue",
      value: `₹${(estRevenue / 1000).toFixed(1)}k`,
      icon: IndianRupee,
      accent: true,
    },
    { label: "Conversion", value: `${conversionRate}%`, icon: TrendingUp, accent: false },
  ];

  // Recent activity: latest 10 quotes + customers merged by created_at desc
  type Activity =
    | { kind: "quote"; at: string; id: string; title: string; sub: string }
    | { kind: "customer"; at: string; id: string; title: string; sub: string };
  const activity: Activity[] = [
    ...quotes.map((q) => ({
      kind: "quote" as const,
      at: q.created_at,
      id: q.id,
      title: q.guest_name,
      sub: q.reference_code,
    })),
    ...customers.map((c) => ({
      kind: "customer" as const,
      at: c.created_at,
      id: c.id,
      title: c.guest_name,
      sub: c.customer_reference,
    })),
  ]
    .sort((a, b) => +new Date(b.at) - +new Date(a.at))
    .slice(0, 10);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  return (
    <>
      <Topbar title="Dashboard" subtitle="Today, an at-a-glance view of your reservations" />
      <div className="px-4 md:px-8 py-6 md:py-8 space-y-8 max-w-[1400px]">
        <motion.section
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="luxe-card rounded-2xl p-6 md:p-10 relative overflow-hidden"
        >
          <div className="absolute -right-24 -top-24 h-72 w-72 rounded-full bg-gold/10 blur-3xl pointer-events-none" />
          <div className="relative flex flex-col md:flex-row md:items-end md:justify-between gap-6">
            <div>
              <p className="text-xs tracking-[0.3em] uppercase text-gold/80">{greeting}</p>
              <h2 className="font-display text-3xl md:text-5xl mt-2 max-w-xl">
                Welcome back to <span className="gold-text-gradient">Hotel Excella</span>.
              </h2>
              <p className="text-sm text-muted-foreground mt-3 max-w-md">
                You have <span className="text-gold">{pending} active quotes</span> and a{" "}
                <span className="text-gold">{conversionRate}%</span> conversion rate.
              </p>
            </div>
            <Link
              to="/generate"
              search={{ customerId: undefined }}
              className="group inline-flex items-center gap-2 self-start md:self-auto rounded-full gold-gradient px-5 py-3 text-sm font-medium text-charcoal hover:shadow-[0_0_30px_oklch(0.82_0.13_82/0.35)] transition"
            >
              Generate new quote
              <ArrowUpRight className="h-4 w-4 transition group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
            </Link>
          </div>
        </motion.section>

        {/* Operational KPI summary */}
        <section>
          <h3 className="font-display text-sm uppercase tracking-[0.2em] text-muted-foreground mb-3">
            Operational Summary
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
            {kpis.map((k, i) => {
              const Icon = k.icon;
              return (
                <motion.div
                  key={k.label}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.04 * i, duration: 0.3 }}
                  className="luxe-card rounded-xl p-4 hover:border-gold/40 transition-all"
                >
                  <div className="flex items-center justify-between">
                    <div className="h-8 w-8 rounded-md bg-secondary text-gold flex items-center justify-center">
                      <Icon className="h-3.5 w-3.5" />
                    </div>
                  </div>
                  <div className="mt-3 font-display text-2xl text-foreground tabular-nums">
                    {k.value}
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-0.5 tracking-wide">
                    {k.label}
                  </div>
                </motion.div>
              );
            })}
          </div>
        </section>

        <section className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
          {stats.map((s, i) => {
            const Icon = s.icon;
            return (
              <motion.div
                key={s.label}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.08 * i + 0.1, duration: 0.4 }}
                className={`luxe-card rounded-xl p-5 hover:border-gold/40 transition-all ${s.accent ? "ring-1 ring-gold/30" : ""}`}
              >
                <div className="flex items-center justify-between">
                  <div
                    className={`h-9 w-9 rounded-md flex items-center justify-center ${s.accent ? "gold-gradient text-charcoal" : "bg-secondary text-gold"}`}
                  >
                    <Icon className="h-4 w-4" />
                  </div>
                  <span className="text-[11px] text-success flex items-center gap-1">
                    <TrendingUp className="h-3 w-3" />
                    live
                  </span>
                </div>
                <div className="mt-5 font-display text-3xl text-foreground">{s.value}</div>
                <div className="text-xs text-muted-foreground mt-1 tracking-wide">{s.label}</div>
              </motion.div>
            );
          })}
        </section>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6">
          <section>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-display text-xl">Recent Quotes</h3>
              <Link to="/history" className="text-xs text-gold hover:underline">
                View all →
              </Link>
            </div>
            <div className="luxe-card rounded-xl overflow-hidden">
              <div className="hidden md:grid grid-cols-12 gap-4 px-6 py-3 text-[11px] uppercase tracking-wider text-muted-foreground border-b border-border">
                <div className="col-span-3">Quote ID</div>
                <div className="col-span-3">Guest</div>
                <div className="col-span-2">Stay</div>
                <div className="col-span-2">Amount</div>
                <div className="col-span-2">Status</div>
              </div>
              {isLoading && (
                <div className="p-10 flex justify-center">
                  <Loader2 className="h-5 w-5 animate-spin text-gold" />
                </div>
              )}
              {!isLoading && quotes.length === 0 && (
                <div className="p-12 text-center text-sm text-muted-foreground">
                  No quotes yet —{" "}
                  <Link
                    to="/generate"
                    search={{ customerId: undefined }}
                    className="text-gold hover:underline"
                  >
                    create your first one
                  </Link>
                  .
                </div>
              )}
              {quotes.slice(0, 6).map((q, i) => (
                <motion.div
                  key={q.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.04 * i + 0.1 }}
                >
                  <Link
                    to="/quote/$id"
                    params={{ id: q.id }}
                    className="grid grid-cols-2 md:grid-cols-12 gap-2 md:gap-4 px-4 md:px-6 py-4 border-b border-border last:border-0 hover:bg-secondary/40 transition cursor-pointer"
                  >
                    <div className="col-span-2 md:col-span-3 text-xs font-mono text-muted-foreground">
                      {q.reference_code}
                    </div>
                    <div className="md:col-span-3 text-sm">{q.guest_name}</div>
                    <div className="md:col-span-2 text-sm text-muted-foreground">
                      {new Date(q.check_in).toLocaleDateString("en-IN", {
                        day: "2-digit",
                        month: "short",
                      })}{" "}
                      –{" "}
                      {new Date(q.check_out).toLocaleDateString("en-IN", {
                        day: "2-digit",
                        month: "short",
                      })}
                    </div>
                    <div className="md:col-span-2 text-sm font-medium">
                      ₹{Number(q.total).toLocaleString("en-IN")}
                    </div>
                    <div className="md:col-span-2">
                      <StatusPill status={q.status} />
                    </div>
                  </Link>
                </motion.div>
              ))}
            </div>
          </section>

          {/* Recent Activity widget */}
          <section>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-display text-xl flex items-center gap-2">
                <Activity className="h-4 w-4 text-gold" /> Recent Activity
              </h3>
            </div>
            <div className="luxe-card rounded-xl overflow-hidden">
              {activity.length === 0 && (
                <div className="p-10 text-center text-xs text-muted-foreground">
                  No recent activity yet.
                </div>
              )}
              {activity.map((a) => {
                const Icon = a.kind === "quote" ? FilePlus : UserPlus;
                const href =
                  a.kind === "quote"
                    ? { to: "/quote/$id" as const, params: { id: a.id } }
                    : { to: "/customers/$id" as const, params: { id: a.id } };
                return (
                  <Link
                    key={`${a.kind}-${a.id}`}
                    {...href}
                    className="flex items-start gap-3 px-4 py-3 border-b border-border/60 last:border-0 hover:bg-secondary/40 transition"
                  >
                    <div className="h-7 w-7 mt-0.5 rounded-md bg-secondary text-gold flex items-center justify-center shrink-0">
                      <Icon className="h-3.5 w-3.5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-xs text-muted-foreground">
                        {a.kind === "quote" ? "New quote" : "New customer"}
                      </div>
                      <div className="text-sm truncate">{a.title}</div>
                      <div className="text-[11px] font-mono text-muted-foreground/80 truncate">
                        {a.sub}
                      </div>
                    </div>
                    <div className="text-[10px] text-muted-foreground whitespace-nowrap pt-1">
                      {new Date(a.at).toLocaleDateString("en-IN", {
                        day: "2-digit",
                        month: "short",
                      })}
                    </div>
                  </Link>
                );
              })}
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
