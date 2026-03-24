#!/usr/bin/env python3
"""
Scipio Auto-Apply Engine
Applies to jobs using browser automation + AI.

Usage:
  uv run python applier.py apply <url> [--dry-run] [--headed]
  uv run python applier.py batch [--dry-run] [--headed] [--limit N]
  uv run python applier.py score <url>

Modes:
  apply   - Apply to a single job URL
  batch   - Apply to all wishlist jobs in jobs.json
  score   - Score a job URL against your profile (no apply)

Options:
  --dry-run   Fill forms but don't submit (screenshot instead)
  --headed    Show browser window (default: headless)
  --limit N   Max jobs to apply to in batch mode (default: 5)
"""

import asyncio
import json
import sys
import os
import base64
from datetime import datetime
from pathlib import Path

from playwright.async_api import async_playwright

# Add parent to path for imports
sys.path.insert(0, str(Path(__file__).parent))

from ats_handlers import fill_application, detect_ats
from ai_engine import (
    answer_question, generate_cover_letter, score_job_match,
    get_quick_answer, classify_question, get_client
)

PROFILE_PATH = Path(__file__).parent / 'profile.json'
JOBS_PATH = Path(__file__).parent.parent / 'jobs.json'
SCREENSHOTS_DIR = Path(__file__).parent / 'screenshots'
LOG_PATH = Path(__file__).parent / 'apply_log.json'

# GitHub API config for syncing
GITHUB_OWNER = 'AssiamahS'
GITHUB_REPO = 'scipio'


def load_profile() -> dict:
    return json.loads(PROFILE_PATH.read_text())


def load_jobs() -> dict:
    if JOBS_PATH.exists():
        return json.loads(JOBS_PATH.read_text())
    return {"jobs": [], "next_id": 1}


def save_jobs(db: dict):
    JOBS_PATH.write_text(json.dumps(db, indent=2))


def log_application(job_id: int, company: str, role: str, url: str, status: str, details: dict):
    """Append to application log."""
    logs = []
    if LOG_PATH.exists():
        logs = json.loads(LOG_PATH.read_text())

    logs.append({
        "timestamp": datetime.now().isoformat(),
        "job_id": job_id,
        "company": company,
        "role": role,
        "url": url,
        "status": status,
        "details": details
    })
    LOG_PATH.write_text(json.dumps(logs, indent=2))


def update_job_status(job_id: int, new_status: str):
    """Update a job's status in jobs.json."""
    db = load_jobs()
    for job in db["jobs"]:
        if job["id"] == job_id:
            job["status"] = new_status
            job["updated_date"] = datetime.now().strftime("%Y-%m-%d")
            job["history"].append({
                "status": new_status,
                "date": datetime.now().strftime("%Y-%m-%d %H:%M")
            })
            break
    save_jobs(db)


async def sync_to_github(db: dict):
    """Push updated jobs.json to GitHub."""
    token = os.environ.get('GITHUB_TOKEN')
    if not token:
        print("  [!] No GITHUB_TOKEN set, skipping sync")
        return

    import httpx

    headers = {
        'Authorization': f'token {token}',
        'Accept': 'application/vnd.github.v3+json',
    }

    api_url = f'https://api.github.com/repos/{GITHUB_OWNER}/{GITHUB_REPO}/contents/jobs.json'

    async with httpx.AsyncClient() as client:
        # Get current SHA
        r = await client.get(api_url, headers=headers)
        sha = r.json().get('sha') if r.status_code == 200 else None

        # Update file
        content = base64.b64encode(json.dumps(db, indent=2).encode()).decode()
        body = {
            "message": f"Auto-apply update - {datetime.now().strftime('%Y-%m-%d %H:%M')}",
            "content": content,
        }
        if sha:
            body["sha"] = sha

        r = await client.put(api_url, headers=headers, json=body)
        if r.status_code in (200, 201):
            print("  [+] Synced to GitHub")
        else:
            print(f"  [!] GitHub sync failed: {r.status_code}")


async def apply_to_url(page, url: str, profile: dict, job_info: dict = None, dry_run: bool = False) -> dict:
    """Navigate to a job URL and apply."""
    result = {
        "url": url,
        "status": "unknown",
        "ats": "unknown",
        "fields_filled": [],
        "fields_missed": [],
        "screenshot": None,
    }

    try:
        print(f"  [*] Navigating to {url}")
        await page.goto(url, wait_until='domcontentloaded', timeout=30000)
        await asyncio.sleep(2)  # Let JS render

        # Detect ATS
        ats = await detect_ats(page)
        result["ats"] = ats
        print(f"  [*] Detected ATS: {ats}")

        # Look for "Apply" button on job listing pages
        apply_btn = page.locator(
            'a:has-text("Apply"), button:has-text("Apply"), '
            'a:has-text("Apply Now"), button:has-text("Apply Now"), '
            'a:has-text("Apply for this job"), button:has-text("Submit Application"), '
            '[data-automation-id="jobPostingApplyButton"]'
        ).first

        try:
            if await apply_btn.is_visible(timeout=3000):
                print("  [*] Clicking Apply button...")
                await apply_btn.click()
                await asyncio.sleep(3)
        except Exception:
            print("  [*] No Apply button found, assuming we're on the form")

        # Fill the application
        print("  [*] Filling application form...")
        fill_result = await fill_application(page, profile)
        result["fields_filled"] = fill_result.get("filled", [])
        result["fields_missed"] = fill_result.get("missed", [])
        result["ats"] = fill_result.get("ats", ats)

        # Handle any custom text questions with AI
        await handle_custom_questions(page, profile, job_info)

        print(f"  [+] Filled {len(result['fields_filled'])} fields")
        if result["fields_missed"]:
            print(f"  [!] Missed: {', '.join(result['fields_missed'])}")

        # Screenshot
        SCREENSHOTS_DIR.mkdir(exist_ok=True)
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        company = (job_info or {}).get("company", "unknown").replace(" ", "_")[:20]
        ss_path = SCREENSHOTS_DIR / f"{company}_{ts}.png"
        await page.screenshot(path=str(ss_path), full_page=True)
        result["screenshot"] = str(ss_path)
        print(f"  [*] Screenshot: {ss_path}")

        if dry_run:
            result["status"] = "dry_run"
            print("  [~] DRY RUN - not submitting")
        else:
            # Find and click submit
            submitted = await click_submit(page)
            if submitted:
                result["status"] = "submitted"
                print("  [+] APPLICATION SUBMITTED!")
                await asyncio.sleep(2)
                # Post-submit screenshot
                await page.screenshot(path=str(SCREENSHOTS_DIR / f"{company}_{ts}_submitted.png"), full_page=True)
            else:
                result["status"] = "filled_not_submitted"
                print("  [!] Form filled but could not find submit button")

    except Exception as e:
        result["status"] = "error"
        result["error"] = str(e)
        print(f"  [!] Error: {e}")

        # Error screenshot
        try:
            SCREENSHOTS_DIR.mkdir(exist_ok=True)
            await page.screenshot(path=str(SCREENSHOTS_DIR / f"error_{datetime.now().strftime('%H%M%S')}.png"))
        except Exception:
            pass

    return result


async def handle_custom_questions(page, profile: dict, job_info: dict = None):
    """Find and answer custom text questions on the form."""
    # Find textarea and text inputs that might be custom questions
    textareas = await page.locator('textarea:visible').all()

    for ta in textareas:
        try:
            current = await ta.input_value()
            if current:  # Already answered
                continue

            # Find the question text
            ta_id = await ta.get_attribute('id') or ''
            label_text = ''
            if ta_id:
                label = page.locator(f'label[for="{ta_id}"]')
                if await label.count() > 0:
                    label_text = await label.first.inner_text()

            if not label_text:
                # Try previous sibling or parent label
                aria = await ta.get_attribute('aria-label') or ''
                placeholder = await ta.get_attribute('placeholder') or ''
                label_text = aria or placeholder

            if not label_text:
                continue

            # Try quick answer first, fall back to AI
            quick = get_quick_answer(label_text, profile)
            if quick:
                await ta.fill(quick)
                print(f"  [*] Quick answered: {label_text[:40]}...")
            else:
                qtype = classify_question(label_text)
                if qtype == 'cover_letter':
                    answer = generate_cover_letter(profile, job_info or {})
                else:
                    answer = answer_question(label_text, profile, job_info)
                await ta.fill(answer)
                print(f"  [*] AI answered: {label_text[:40]}...")

        except Exception:
            continue


async def click_submit(page) -> bool:
    """Find and click the submit button."""
    submit_selectors = [
        'button[type="submit"]',
        'input[type="submit"]',
        'button:has-text("Submit")',
        'button:has-text("Submit Application")',
        'button:has-text("Apply")',
        'button:has-text("Send Application")',
        'button:has-text("Complete")',
        '[data-automation-id="submitButton"]',
    ]

    for selector in submit_selectors:
        try:
            btn = page.locator(selector).first
            if await btn.is_visible(timeout=2000):
                await btn.click()
                return True
        except Exception:
            continue

    return False


async def run_apply(url: str, dry_run: bool = False, headed: bool = False, job_info: dict = None, job_id: int = None):
    """Apply to a single job."""
    profile = load_profile()

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=not headed)
        context = await browser.new_context(
            viewport={"width": 1280, "height": 900},
            user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        )
        page = await context.new_page()

        result = await apply_to_url(page, url, profile, job_info, dry_run)

        await browser.close()

    # Log it
    company = (job_info or {}).get("company", "Unknown")
    role = (job_info or {}).get("role", "Unknown")
    log_application(job_id or 0, company, role, url, result["status"], result)

    # Update tracker if submitted
    if job_id and result["status"] == "submitted":
        update_job_status(job_id, "applied")
        print(f"\n  [+] Tracker updated: #{job_id} -> applied")

        # Sync to GitHub
        db = load_jobs()
        await sync_to_github(db)

    return result


async def run_batch(dry_run: bool = False, headed: bool = False, limit: int = 5):
    """Apply to all wishlist jobs."""
    profile = load_profile()
    db = load_jobs()

    wishlist = [j for j in db["jobs"] if j["status"] == "wishlist" and j.get("url")]
    if not wishlist:
        print("No wishlist jobs with URLs to apply to.")
        return

    to_apply = wishlist[:limit]
    print(f"\n{'='*60}")
    print(f"  SCIPIO AUTO-APPLY {'(DRY RUN)' if dry_run else ''}")
    print(f"  Applying to {len(to_apply)} of {len(wishlist)} wishlist jobs")
    print(f"{'='*60}\n")

    results = []

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=not headed)
        context = await browser.new_context(
            viewport={"width": 1280, "height": 900},
            user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        )

        for i, job in enumerate(to_apply, 1):
            print(f"\n--- [{i}/{len(to_apply)}] {job['company']} - {job['role']} ---")
            page = await context.new_page()

            job_info = {
                "company": job["company"],
                "role": job["role"],
                "description": job.get("notes", ""),
            }

            result = await apply_to_url(page, job["url"], profile, job_info, dry_run)
            results.append({"job": job, "result": result})

            # Log
            log_application(job["id"], job["company"], job["role"], job["url"], result["status"], result)

            # Update status if submitted
            if result["status"] == "submitted" and not dry_run:
                update_job_status(job["id"], "applied")
                print(f"  [+] Tracker: #{job['id']} -> applied")

            await page.close()

            # Human-like delay between applications
            if i < len(to_apply):
                delay = 5
                print(f"  [*] Waiting {delay}s before next application...")
                await asyncio.sleep(delay)

        await browser.close()

    # Sync to GitHub
    db = load_jobs()
    await sync_to_github(db)

    # Summary
    print(f"\n{'='*60}")
    print("  BATCH RESULTS")
    print(f"{'='*60}")
    submitted = sum(1 for r in results if r["result"]["status"] == "submitted")
    filled = sum(1 for r in results if r["result"]["status"] in ("filled_not_submitted", "dry_run"))
    errors = sum(1 for r in results if r["result"]["status"] == "error")
    print(f"  Submitted: {submitted}")
    print(f"  Filled (not submitted): {filled}")
    print(f"  Errors: {errors}")
    print(f"  Total: {len(results)}")

    for r in results:
        status_icon = {"submitted": "+", "dry_run": "~", "filled_not_submitted": "?", "error": "!"}.get(r["result"]["status"], "?")
        print(f"  [{status_icon}] {r['job']['company']} - {r['result']['status']} ({r['result']['ats']})")


async def run_score(url: str):
    """Score a job URL against profile."""
    profile = load_profile()

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        await page.goto(url, wait_until='domcontentloaded', timeout=30000)
        await asyncio.sleep(2)

        # Get job description text
        body_text = await page.inner_text('body')
        description = body_text[:2000]

        await browser.close()

    job_info = {
        "company": "Unknown",
        "role": "Unknown",
        "description": description,
    }

    result = score_job_match(profile, job_info)
    print(f"\nJob Match Score: {result.get('score', '?')}/10")
    print(f"Reason: {result.get('reason', 'N/A')}")
    print(f"Matching Skills: {', '.join(result.get('matching_skills', []))}")


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return

    cmd = sys.argv[1]
    args = sys.argv[2:]

    dry_run = '--dry-run' in args
    headed = '--headed' in args
    limit = 5

    for i, a in enumerate(args):
        if a == '--limit' and i + 1 < len(args):
            limit = int(args[i + 1])

    # Filter out flags
    urls = [a for a in args if not a.startswith('--') and not a.isdigit()]
    # Re-add digits that aren't after --limit
    for i, a in enumerate(args):
        if a.isdigit() and (i == 0 or args[i-1] != '--limit'):
            urls.append(a)

    if cmd == 'apply':
        if not urls:
            print("Usage: applier.py apply <url> [--dry-run] [--headed]")
            return
        asyncio.run(run_apply(urls[0], dry_run=dry_run, headed=headed))

    elif cmd == 'batch':
        asyncio.run(run_batch(dry_run=dry_run, headed=headed, limit=limit))

    elif cmd == 'score':
        if not urls:
            print("Usage: applier.py score <url>")
            return
        asyncio.run(run_score(urls[0]))

    else:
        print(f"Unknown command: {cmd}")
        print(__doc__)


if __name__ == '__main__':
    main()
