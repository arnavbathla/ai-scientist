#!/usr/bin/env python3
"""Take high-quality, properly-sized screenshots of ResearchOS for the README.

Usage:
    BASE=http://localhost:3000 ACCEPTANCE_EMAIL=demo@researchos.local \\
      ACCEPTANCE_PASSWORD=password123 RUN_ID=... PROJECT_ID=... \\
      python3 scripts/take_screenshots.py

Requires playwright + chromium installed.
"""
from __future__ import annotations

import asyncio
import os
import pathlib
import sys

from playwright.async_api import async_playwright

OUT = pathlib.Path(__file__).resolve().parent.parent / "docs" / "screenshots"
OUT.mkdir(parents=True, exist_ok=True)

BASE = os.environ.get("BASE", "http://localhost:3000")
EMAIL = os.environ.get("ACCEPTANCE_EMAIL")
PASSWORD = os.environ.get("ACCEPTANCE_PASSWORD", "password123")
RUN_ID = os.environ.get("RUN_ID")
PROJECT_ID = os.environ.get("PROJECT_ID")

if not EMAIL:
    sys.exit("Set ACCEPTANCE_EMAIL env var")

VIEWPORT = {"width": 1920, "height": 1200}


HIDE_DEVTOOLS_CSS = """
nextjs-portal, [data-nextjs-toast], [data-nextjs-dialog-overlay] { display: none !important; }
.nextjs-static-indicator-toast-wrapper { display: none !important; }
button[aria-label*="Issues"], button[aria-label*="Next.js"] { display: none !important; }
"""


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(
            viewport=VIEWPORT,
            device_scale_factor=2,
            color_scheme="dark",
        )
        page = await context.new_page()
        await page.add_init_script(
            f"""
            const style = document.createElement('style');
            style.textContent = `{HIDE_DEVTOOLS_CSS}`;
            (document.head || document.documentElement).appendChild(style);
            """
        )

        # 1) Login page (logged out)
        await page.goto(f"{BASE}/login", wait_until="networkidle")
        await page.add_style_tag(content=HIDE_DEVTOOLS_CSS)
        await page.wait_for_timeout(500)
        await page.screenshot(path=str(OUT / "01-login.png"), full_page=False)
        print("01-login.png written")

        # Sign in
        await page.fill('input[name="email"], input[type="email"]', EMAIL)
        await page.fill('input[name="password"], input[type="password"]', PASSWORD)
        await page.click('button[type="submit"]')
        await page.wait_for_url(f"{BASE}/dashboard", timeout=10_000)
        await page.wait_for_load_state("networkidle")
        await page.add_style_tag(content=HIDE_DEVTOOLS_CSS)
        await page.wait_for_timeout(800)

        # 2) Dashboard (with the new one-shot composer)
        await page.screenshot(path=str(OUT / "02-dashboard.png"), full_page=False)
        print("02-dashboard.png written")

        # 3) Skills page
        await page.goto(f"{BASE}/skills", wait_until="networkidle")
        await page.add_style_tag(content=HIDE_DEVTOOLS_CSS)
        await page.wait_for_timeout(800)
        await page.screenshot(path=str(OUT / "03-skills.png"), full_page=False)
        print("03-skills.png written")

        # 4) Project page (optional)
        if PROJECT_ID:
            await page.goto(f"{BASE}/projects/{PROJECT_ID}", wait_until="networkidle")
            await page.add_style_tag(content=HIDE_DEVTOOLS_CSS)
            await page.wait_for_timeout(800)
            await page.screenshot(path=str(OUT / "04-project.png"), full_page=False)
            print("04-project.png written")

        # 5) Run page — Cursor-style chat layout
        if RUN_ID:
            await page.goto(f"{BASE}/runs/{RUN_ID}", wait_until="domcontentloaded", timeout=15_000)
            await page.wait_for_timeout(3500)
            await page.add_style_tag(content=HIDE_DEVTOOLS_CSS)
            await page.screenshot(path=str(OUT / "05-run-chat.png"), full_page=False)
            print("05-run-chat.png written")

        # 6) Settings → Models
        await page.goto(f"{BASE}/settings/models", wait_until="networkidle")
        await page.add_style_tag(content=HIDE_DEVTOOLS_CSS)
        await page.wait_for_timeout(800)
        await page.screenshot(path=str(OUT / "06-settings-models.png"), full_page=False)
        print("06-settings-models.png written")

        # 7) Settings → Sources
        await page.goto(f"{BASE}/settings/sources", wait_until="networkidle")
        await page.add_style_tag(content=HIDE_DEVTOOLS_CSS)
        await page.wait_for_timeout(800)
        await page.screenshot(path=str(OUT / "07-settings-sources.png"), full_page=False)
        print("07-settings-sources.png written")

        await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
