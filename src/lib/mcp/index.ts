import { auth, defineMcp } from "@lovable.dev/mcp-js";
import whoamiTool from "./tools/whoami";
import listBookingsTool from "./tools/list-bookings";
import getBusinessDateTool from "./tools/get-business-date";
import searchBookingsTool from "./tools/search-bookings";
import getBookingTool from "./tools/get-booking";
import getBookingItemsTool from "./tools/get-booking-items";
import getBookingBalanceTool from "./tools/get-booking-balance";
import listBookingChargesTool from "./tools/list-booking-charges";
import listBookingPaymentsTool from "./tools/list-booking-payments";
import { arrivalsTool, departuresTool, inHouseGuestsTool } from "./tools/operational-lists";
import houseViewTool from "./tools/house-view";
import { roomAvailabilityTool, roomStatusTool } from "./tools/room-operations";
import { complaintsSummaryTool, housekeepingTasksTool } from "./tools/housekeeping-complaints";
import nightAuditStatusTool from "./tools/night-audit-status";
import { cashSummaryTool, occupancyRevenueSummaryTool } from "./tools/reports";
import getInvoicePreviewTool from "./tools/get-invoice-preview";

// The OAuth issuer must be the direct Supabase host. On publish, SUPABASE_URL is
// rewritten to a .lovable.cloud proxy and rejected by mcp-js (RFC 8414 issuer
// mismatch). VITE_SUPABASE_PROJECT_ID is inlined by Vite at build time.
const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "heos-mcp",
  title: "HEOS",
  version: "0.2.0",
  instructions:
    "Read-only operational tools for the hotel configured in this HEOS instance. Use get_business_date as the operational clock. Booking is the commercial entity; booking items are operational rooms; occupancy segments preserve room history. All tools enforce the signed-in user's RLS and HEOS permission matrix. No tool can write, close Night Audit, or access guest documents.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [
    whoamiTool,
    getBusinessDateTool,
    listBookingsTool,
    searchBookingsTool,
    getBookingTool,
    getBookingItemsTool,
    getBookingBalanceTool,
    listBookingChargesTool,
    listBookingPaymentsTool,
    arrivalsTool,
    departuresTool,
    inHouseGuestsTool,
    houseViewTool,
    roomStatusTool,
    roomAvailabilityTool,
    housekeepingTasksTool,
    complaintsSummaryTool,
    nightAuditStatusTool,
    occupancyRevenueSummaryTool,
    cashSummaryTool,
    getInvoicePreviewTool,
  ],
});
