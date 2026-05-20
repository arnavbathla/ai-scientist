#!/usr/bin/env python3
"""Take high-quality, properly-sized screenshots of ResearchOS for the README.

Usage:
    PLAYWRIGHT_BROWSERS_PATH=0 python3 scripts/take_screenshots.py

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
PASSWORD = os.environ.get("ACCEPTANCE_PASSWORD", "acceptance1234")
RUN_ID = os.environ.get("RUN_ID", "cmpdhtzpo0005m6gmuhaojtt9")
PROJECT_ID = os.environ.get("PROJECT_ID", "cmpdhtz920003m6gm8mr4f7zk")

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

        # 2) Dashboard
        await page.screenshot(path=str(OUT / "02-dashboard.png"), full_page=False)
        print("02-dashboard.png written")

        # 3) Project page
        await page.goto(f"{BASE}/projects/{PROJECT_ID}", wait_until="networkidle")
        await page.add_style_tag(content=HIDE_DEVTOOLS_CSS)
        await page.wait_for_timeout(800)
        await page.screenshot(path=str(OUT / "03-project.png"), full_page=False)
        print("03-project.png written")

        # 4) Run page — SSE keeps the connection alive forever, so don't wait
        # for networkidle. Just wait for DOM + a short settle.
        await page.goto(f"{BASE}/runs/{RUN_ID}", wait_until="domcontentloaded", timeout=15_000)
        # Let initial data fetches and React hydration finish.
        await page.wait_for_selector("text=Live event stream", timeout=10_000)
        await page.add_style_tag(content=HIDE_DEVTOOLS_CSS)
        await page.wait_for_timeout(2500)
        await page.screenshot(path=str(OUT / "04-run.png"), full_page=False)
        print("04-run.png written")

        # 5) Settings → Models
        await page.goto(f"{BASE}/settings/models", wait_until="networkidle")
        await page.add_style_tag(content=HIDE_DEVTOOLS_CSS)
        await page.wait_for_timeout(800)
        await page.screenshot(path=str(OUT / "05-settings-models.png"), full_page=False)
        print("05-settings-models.png written")

        # 6) Settings → Sources
        await page.goto(f"{BASE}/settings/sources", wait_until="networkidle")
        await page.add_style_tag(content=HIDE_DEVTOOLS_CSS)
        await page.wait_for_timeout(800)
        await page.screenshot(path=str(OUT / "06-settings-sources.png"), full_page=False)
        print("06-settings-sources.png written")

        await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
