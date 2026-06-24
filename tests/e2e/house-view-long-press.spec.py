import asyncio, json, os
from pathlib import Path
from playwright.async_api import async_playwright

SS = Path("/tmp/browser/lp/screenshots"); SS.mkdir(exist_ok=True, parents=True)
BASE = "http://localhost:8080"
ELIGIBLE_STATUSES = {"Confirmed","Pending","Tentative","Pending-Confirmation","Arriving Today","Checked-In","In-House"}

async def long_press(page, locator, hold_ms=750):
    box = await locator.bounding_box()
    assert box, "no box"
    cx, cy = box["x"]+box["width"]/2, box["y"]+box["height"]/2
    client = await page.context.new_cdp_session(page)
    await client.send("Input.dispatchTouchEvent", {"type":"touchStart","touchPoints":[{"x":cx,"y":cy,"id":1}]})
    await page.wait_for_timeout(hold_ms)
    await client.send("Input.dispatchTouchEvent", {"type":"touchEnd","touchPoints":[]})

async def main():
    storage_key = os.environ["LOVABLE_BROWSER_SUPABASE_STORAGE_KEY"]
    session_json = os.environ["LOVABLE_BROWSER_SUPABASE_SESSION_JSON"]
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        ctx = await browser.new_context(
            viewport={"width":390,"height":844},
            user_agent="Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1",
            has_touch=True, is_mobile=True,
        )
        page = await ctx.new_page()
        page.on("console", lambda m: print("CONSOLE", m.type, m.text[:200]))
        await page.goto(BASE, wait_until="domcontentloaded")
        await page.evaluate(f"window.localStorage.setItem({json.dumps(storage_key)}, {json.dumps(session_json)})")
        await page.goto(f"{BASE}/house-view?lp=debug", wait_until="domcontentloaded")
        await page.wait_for_timeout(3500)
        await page.screenshot(path=str(SS/"01_loaded.png"))

        chips = page.locator("[data-booking-pill]")
        n = await chips.count()
        print("chips:", n)
        if n == 0:
            print("no chips; route content:")
            print((await page.content())[:1500])
            await browser.close(); return

        # collect chip metadata
        infos = []
        for i in range(n):
            c = chips.nth(i)
            eligible = await c.get_attribute("data-move-eligible")
            status = await c.get_attribute("data-booking-status")
            bid = await c.get_attribute("data-booking-pill")
            infos.append((i, eligible, status, bid))
        print("infos sample:", infos[:10])

        eligible_chips = [x for x in infos if x[1]=="true"]
        ineligible_chips = [x for x in infos if x[1]=="false"]
        print("eligible:", len(eligible_chips), "ineligible:", len(ineligible_chips))

        results = {"eligible_open": [], "ineligible_no_open": []}

        # ELIGIBLE: pick up to 3 across distinct statuses
        seen_status = set()
        targets = []
        for i,el,st,bid in eligible_chips:
            if st in seen_status: continue
            seen_status.add(st); targets.append((i,st,bid))
            if len(targets)>=3: break
        for idx, st, bid in targets:
            chip = chips.nth(idx)
            await chip.scroll_into_view_if_needed()
            await long_press(page, chip, 750)
            await page.wait_for_timeout(400)
            dialog = page.get_by_role("dialog").filter(has_text="Move Booking")
            opened = await dialog.count() > 0
            await page.screenshot(path=str(SS/f"eligible_{st}.png"))
            print(f"ELIGIBLE status={st} opened={opened}")
            results["eligible_open"].append((st, bid, opened))
            if opened:
                await page.keyboard.press("Escape")
                await page.wait_for_timeout(300)

        # INELIGIBLE: pick one
        if ineligible_chips:
            i,el,st,bid = ineligible_chips[0]
            chip = chips.nth(i)
            await chip.scroll_into_view_if_needed()
            await long_press(page, chip, 750)
            await page.wait_for_timeout(400)
            dialog = page.get_by_role("dialog").filter(has_text="Move Booking")
            opened = await dialog.count() > 0
            await page.screenshot(path=str(SS/f"ineligible_{st}.png"))
            print(f"INELIGIBLE status={st} opened={opened}")
            results["ineligible_no_open"].append((st, bid, opened))

        print("RESULTS:", json.dumps(results, indent=2))
        # Assertions
        ok = True
        for st,bid,opened in results["eligible_open"]:
            if not opened: ok=False; print("FAIL eligible did not open", st, bid)
        for st,bid,opened in results["ineligible_no_open"]:
            if opened: ok=False; print("FAIL ineligible opened", st, bid)
        print("PASS" if ok else "FAIL")
        await browser.close()

asyncio.run(main())
