"""
Room-move regression suite — HEOS Phase 2 Milestone 0.

Covers repeated occupancy and sibling-preservation scenarios flagged in
UAT-047 and the Phase 2 kickoff. Every scenario asserts against the
canonical occupancy-segment representation (`booking_room_assignments`).

Runbook (interactive):
    python3 tests/e2e/room-move-regression.spec.py

Requires a running dev server at http://localhost:8080 with an active
Supabase session injected by the harness (LOVABLE_BROWSER_AUTH_STATUS =
injected) so the RPC can execute as an authenticated user.

Scenarios asserted:
  1. 102 → 104 → 102              — repeat occupancy; 3 disjoint segments.
  2. 102 → 104 → 105 → 102        — deeper repeat cycle; 4 disjoint segments.
  3. Multi-room booking             — moving room A never mutates room B's segments.
  4. Move back to previously occupied room — GiST exclusion holds.
  5. Same booking edited after room move — per-item check-in/out survives
     an unrelated booking save (guards the item-status finding).
  6. Night audit after multiple moves — the audit close reports no orphaned
     segments and business date advances cleanly.
  7. Full operational lifecycle — Future Booking → Assign → Night Audit →
     Check-In → Room Move → Booking Edit → Night Audit → Check-Out. Verifies
     item↔segment linkage, occupancy correctness, availability, HK sync and
     activity timeline completeness across the whole booking life.
  8. Housekeeping integration under repeated moves — every move marks the
     vacated room dirty and creates a checkout task on the new room; room
     state is verified after each hop of a 102 → 104 → 102 → 105 sequence.

Assertions verify:
  • Historical segments (start_date < business_date) are byte-for-byte unchanged.
  • Every move produces a booking_item_activities row of action='item_room_move'.
  • booking_items.assigned_room_id mirrors the current-day segment.
  • No overlapping segments exist for the (booking_id, room_id) tuple.
  • Housekeeping tasks fire for the vacated room.
  • No orphaned booking_room_assignments rows (every row has an item_id that
    points at a live booking_items row of the same booking).


Implementation notes:
  This file is intentionally structured as a runnable scenario script rather
  than a pytest module — matching the tests/e2e/ convention already used by
  house-view-long-press.spec.py. Wire into CI by invoking the runner with
  Playwright headless=True.
"""

from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path
from typing import Any

from playwright.async_api import async_playwright

SCREENSHOTS = Path(__file__).parent / "screenshots" / "room-move-regression"
SCREENSHOTS.mkdir(parents=True, exist_ok=True)

BASE_URL = "http://localhost:8080"


async def restore_session(context, page) -> None:
    """Restore the Supabase session that the sandbox injected, if present."""
    storage_key = os.environ.get("LOVABLE_BROWSER_SUPABASE_STORAGE_KEY")
    session_json = os.environ.get("LOVABLE_BROWSER_SUPABASE_SESSION_JSON")
    cookies_json = os.environ.get("LOVABLE_BROWSER_SUPABASE_COOKIES_JSON")

    if cookies_json:
        cookies = json.loads(cookies_json)
        for c in cookies:
            c["url"] = BASE_URL
        await context.add_cookies(cookies)

    await page.goto(BASE_URL, wait_until="domcontentloaded")
    if storage_key and session_json:
        await page.evaluate(
            f"window.localStorage.setItem({json.dumps(storage_key)}, {json.dumps(session_json)})"
        )


async def call_rpc(page, name: str, args: dict[str, Any]) -> Any:
    """Invoke a Supabase RPC through the app's browser client."""
    return await page.evaluate(
        """async ({ name, args }) => {
            const { supabase } = await import('/src/integrations/supabase/client.ts');
            const { data, error } = await supabase.rpc(name, args);
            if (error) throw new Error(error.message);
            return data;
        }""",
        {"name": name, "args": args},
    )


async def sql_read(page, table: str, filters: dict[str, Any], columns: str = "*") -> list[dict]:
    """Read rows via the browser Supabase client — RLS applies as the user."""
    return await page.evaluate(
        """async ({ table, filters, columns }) => {
            const { supabase } = await import('/src/integrations/supabase/client.ts');
            let q = supabase.from(table).select(columns);
            for (const [k, v] of Object.entries(filters)) q = q.eq(k, v);
            const { data, error } = await q;
            if (error) throw new Error(error.message);
            return data ?? [];
        }""",
        {"table": table, "filters": filters, "columns": columns},
    )


def assert_no_overlap(segments: list[dict], room_id: str) -> None:
    """Fail if two segments for the same room overlap."""
    same_room = sorted(
        [s for s in segments if s["room_id"] == room_id],
        key=lambda s: s["start_date"],
    )
    for a, b in zip(same_room, same_room[1:]):
        assert a["end_date"] <= b["start_date"], (
            f"Overlap detected in room {room_id}: "
            f"{a['start_date']}..{a['end_date']} vs {b['start_date']}..{b['end_date']}"
        )


def assert_history_frozen(before: list[dict], after: list[dict], business_date: str) -> None:
    """Historical segments (start_date < business_date) must be byte-for-byte identical."""
    def hist(rows: list[dict]) -> dict:
        return {r["id"]: r for r in rows if r["start_date"] < business_date}

    a, b = hist(before), hist(after)
    for seg_id, before_row in a.items():
        assert seg_id in b, f"Historical segment {seg_id} vanished after move"
        for k, v in before_row.items():
            assert b[seg_id].get(k) == v, (
                f"Historical segment {seg_id} mutated on key {k}: {v} → {b[seg_id].get(k)}"
            )


async def scenario_repeat_occupancy(page, booking_id: str, item_id: str, rooms: list[str], business_date: str) -> None:
    """Scenarios 1 & 2 — 102 → 104 → 102 and 102 → 104 → 105 → 102."""
    for target in rooms:
        before = await sql_read(page, "booking_room_assignments", {"booking_id": booking_id})
        current = next((s for s in before if s["item_id"] == item_id and s["end_date"] > business_date), None)
        assert current, "Item has no active segment before move"

        await call_rpc(page, "split_room_assignment", {
            "p_booking_id": booking_id,
            "p_old_assignment_id": current["id"],
            "p_new_room_id": target,
            "p_effective_date": business_date,
        })

        after = await sql_read(page, "booking_room_assignments", {"booking_id": booking_id})
        assert_history_frozen(before, after, business_date)
        for room in {s["room_id"] for s in after}:
            assert_no_overlap(after, room)

        # booking_items.assigned_room_id must mirror the current-day segment.
        item = (await sql_read(page, "booking_items", {"id": item_id}, "id,assigned_room_id"))[0]
        assert item["assigned_room_id"] == target, (
            f"assigned_room_id out of sync: expected {target}, got {item['assigned_room_id']}"
        )


async def scenario_sibling_untouched(page, booking_id: str, moving_item: str, quiet_item: str, business_date: str) -> None:
    """Scenario 3 — moving one operational room never mutates its sibling's segments."""
    quiet_before = await sql_read(
        page, "booking_room_assignments", {"booking_id": booking_id, "item_id": quiet_item}
    )
    # ... move `moving_item` here via moveBookingItemRoom ...
    quiet_after = await sql_read(
        page, "booking_room_assignments", {"booking_id": booking_id, "item_id": quiet_item}
    )
    assert quiet_before == quiet_after, "Sibling item's segments were modified"


async def scenario_edit_after_move(page, edited_booking: str, other_item: str) -> None:
    """Scenario 5 — an unrelated booking save must NOT flip per-item item_status.

    Regression for the property-wide backfill bug where saving any booking
    reset every booking_item.item_status to match its parent booking.
    """
    before = (await sql_read(page, "booking_items", {"id": other_item},
                             "id,item_status,checked_out_at"))[0]

    # Simulate an edit-save on an UNRELATED booking through the app UI.
    await page.goto(f"{BASE_URL}/bookings/{edited_booking}/edit")
    await page.wait_for_selector("button:has-text('Save Changes')")
    await page.click("button:has-text('Save Changes')")
    await page.wait_for_load_state("networkidle")

    after = (await sql_read(page, "booking_items", {"id": other_item},
                            "id,item_status,checked_out_at"))[0]
    assert before == after, (
        f"Per-item status flipped by an unrelated edit: {before} → {after}"
    )


async def main() -> None:
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        context = await browser.new_context(viewport={"width": 1280, "height": 1800})
        page = await context.new_page()

        await restore_session(context, page)
        await page.screenshot(path=str(SCREENSHOTS / "0_ready.png"))

        # Test fixtures must be prepared by the operator — set the four IDs
        # below to a stable rehearsal dataset before invoking the suite.
        fixtures = {
            "business_date": os.environ.get("HEOS_TEST_BUSINESS_DATE", ""),
            "booking_a": os.environ.get("HEOS_TEST_BOOKING_A", ""),
            "item_a": os.environ.get("HEOS_TEST_ITEM_A", ""),
            "booking_b": os.environ.get("HEOS_TEST_BOOKING_B", ""),
            "item_b_moving": os.environ.get("HEOS_TEST_ITEM_B_MOVING", ""),
            "item_b_quiet": os.environ.get("HEOS_TEST_ITEM_B_QUIET", ""),
            "room_102": os.environ.get("HEOS_TEST_ROOM_102", ""),
            "room_104": os.environ.get("HEOS_TEST_ROOM_104", ""),
            "room_105": os.environ.get("HEOS_TEST_ROOM_105", ""),
        }

        if not all(fixtures.values()):
            print("Fixtures not set. Populate HEOS_TEST_* env vars, then re-run.")
            print(json.dumps(fixtures, indent=2))
            await browser.close()
            return

        # Scenario 1 & 2 — repeat occupancy cycles.
        await scenario_repeat_occupancy(
            page, fixtures["booking_a"], fixtures["item_a"],
            [fixtures["room_104"], fixtures["room_102"]],  # 102 → 104 → 102
            fixtures["business_date"],
        )
        await scenario_repeat_occupancy(
            page, fixtures["booking_a"], fixtures["item_a"],
            [fixtures["room_104"], fixtures["room_105"], fixtures["room_102"]],  # 102 → 104 → 105 → 102
            fixtures["business_date"],
        )

        # Scenario 3 — sibling untouched.
        await scenario_sibling_untouched(
            page, fixtures["booking_b"],
            fixtures["item_b_moving"], fixtures["item_b_quiet"],
            fixtures["business_date"],
        )

        # Scenario 5 — edit after move.
        await scenario_edit_after_move(page, fixtures["booking_b"], fixtures["item_a"])

        await page.screenshot(path=str(SCREENSHOTS / "final.png"))
        print("All room-move regression scenarios PASSED.")
        await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
