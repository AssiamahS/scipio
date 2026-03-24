"""
ATS-specific form handlers for Greenhouse, Lever, Workday, and generic forms.
Each handler knows how to fill out its platform's application form.
"""
import asyncio
import re
from playwright.async_api import Page, Locator

# Common field mappings - maps form labels/names to profile keys
FIELD_MAP = {
    'first.name': 'first_name', 'first_name': 'first_name', 'fname': 'first_name',
    'last.name': 'last_name', 'last_name': 'last_name', 'lname': 'last_name',
    'full.name': '__full_name__',
    'email': 'email', 'e-mail': 'email', 'email.address': 'email',
    'phone': 'phone', 'mobile': 'phone', 'phone.number': 'phone', 'telephone': 'phone',
    'linkedin': 'linkedin', 'linkedin.url': 'linkedin', 'linkedin.profile': 'linkedin',
    'github': 'github', 'website': 'github', 'portfolio': 'github',
    'city': 'city', 'state': 'state', 'zip': 'zip', 'zipcode': 'zip', 'postal': 'zip',
    'location': 'location', 'address': 'location',
    'salary': 'desired_salary', 'desired.salary': 'desired_salary', 'expected.salary': 'desired_salary',
    'compensation': 'desired_salary',
    'years': 'years_experience', 'experience': 'years_experience',
    'current.company': 'current_company', 'current.employer': 'current_company',
    'current.title': 'current_title', 'job.title': 'current_title',
}


async def safe_fill(locator: Locator, value: str, timeout: int = 3000):
    """Safely fill a field, ignoring errors."""
    try:
        await locator.fill(value, timeout=timeout)
        return True
    except Exception:
        return False


async def safe_click(locator: Locator, timeout: int = 3000):
    """Safely click an element."""
    try:
        await locator.click(timeout=timeout)
        return True
    except Exception:
        return False


async def safe_select(locator: Locator, value: str, timeout: int = 3000):
    """Safely select from dropdown."""
    try:
        await locator.select_option(value=value, timeout=timeout)
        return True
    except Exception:
        try:
            await locator.select_option(label=value, timeout=timeout)
            return True
        except Exception:
            return False


def normalize_label(text: str) -> str:
    """Normalize a form label for matching."""
    text = text.lower().strip()
    text = re.sub(r'[^a-z0-9.]', '.', text)
    text = re.sub(r'\.+', '.', text).strip('.')
    return text


def match_field(label: str, profile: dict) -> str | None:
    """Try to match a form label to a profile field."""
    norm = normalize_label(label)

    # Direct match
    if norm in FIELD_MAP:
        key = FIELD_MAP[norm]
        if key == '__full_name__':
            return f"{profile['first_name']} {profile['last_name']}"
        return str(profile.get(key, ''))

    # Partial match
    for pattern, key in FIELD_MAP.items():
        if pattern in norm or norm in pattern:
            if key == '__full_name__':
                return f"{profile['first_name']} {profile['last_name']}"
            return str(profile.get(key, ''))

    return None


async def detect_ats(page: Page) -> str:
    """Detect which ATS the page is using."""
    url = page.url.lower()

    if 'greenhouse.io' in url or 'boards.greenhouse' in url:
        return 'greenhouse'
    if 'lever.co' in url or 'jobs.lever' in url:
        return 'lever'
    if 'myworkdayjobs.com' in url or 'workday.com' in url:
        return 'workday'
    if 'linkedin.com' in url:
        return 'linkedin'
    if 'indeed.com' in url:
        return 'indeed'

    # Check page content
    content = await page.content()
    content_lower = content.lower()

    if 'greenhouse' in content_lower:
        return 'greenhouse'
    if 'lever' in content_lower:
        return 'lever'
    if 'workday' in content_lower:
        return 'workday'

    return 'generic'


async def fill_greenhouse(page: Page, profile: dict) -> dict:
    """Handle Greenhouse ATS applications."""
    result = {'filled': [], 'missed': [], 'ats': 'greenhouse'}

    # Greenhouse uses #application-form or similar
    # Standard fields
    fields = [
        ('#first_name', profile['first_name']),
        ('#last_name', profile['last_name']),
        ('#email', profile['email']),
        ('#phone', profile['phone']),
        ('input[name*="first_name"]', profile['first_name']),
        ('input[name*="last_name"]', profile['last_name']),
        ('input[name*="email"]', profile['email']),
        ('input[name*="phone"]', profile['phone']),
    ]

    for selector, value in fields:
        loc = page.locator(selector).first
        if await safe_fill(loc, value):
            result['filled'].append(selector)

    # LinkedIn field
    linkedin_fields = page.locator('input[name*="linkedin"], input[placeholder*="LinkedIn"]')
    if await linkedin_fields.count() > 0:
        if await safe_fill(linkedin_fields.first, profile['linkedin']):
            result['filled'].append('linkedin')

    # Resume upload
    resume_uploaded = await upload_resume(page, profile['resume_path'])
    if resume_uploaded:
        result['filled'].append('resume')
    else:
        result['missed'].append('resume')

    # Try to fill any labeled inputs we recognize
    await fill_labeled_inputs(page, profile, result)

    return result


async def fill_lever(page: Page, profile: dict) -> dict:
    """Handle Lever ATS applications."""
    result = {'filled': [], 'missed': [], 'ats': 'lever'}

    # Lever typically uses name attributes
    fields = [
        ('input[name="name"]', f"{profile['first_name']} {profile['last_name']}"),
        ('input[name="email"]', profile['email']),
        ('input[name="phone"]', profile['phone']),
        ('input[name="org"]', profile['current_company']),
        ('input[name="urls[LinkedIn]"]', profile['linkedin']),
        ('input[name="urls[GitHub]"]', profile['github']),
        ('input[name="urls[Portfolio]"]', profile['github']),
    ]

    for selector, value in fields:
        loc = page.locator(selector).first
        if await safe_fill(loc, value):
            result['filled'].append(selector)

    # Resume upload
    if await upload_resume(page, profile['resume_path']):
        result['filled'].append('resume')
    else:
        result['missed'].append('resume')

    # Lever text areas (cover letter, additional info)
    await fill_labeled_inputs(page, profile, result)

    return result


async def fill_workday(page: Page, profile: dict) -> dict:
    """Handle Workday ATS applications - the most complex."""
    result = {'filled': [], 'missed': [], 'ats': 'workday'}

    # Workday uses data-automation-id attributes
    wd_fields = [
        ('[data-automation-id="legalNameSection_firstName"]', profile['first_name']),
        ('[data-automation-id="legalNameSection_lastName"]', profile['last_name']),
        ('[data-automation-id="email"]', profile['email']),
        ('[data-automation-id="phone-number"]', profile['phone']),
        ('[data-automation-id="addressSection_city"]', profile['city']),
        ('[data-automation-id="addressSection_postalCode"]', profile['zip']),
    ]

    for selector, value in wd_fields:
        loc = page.locator(selector).first
        if await safe_fill(loc, value):
            result['filled'].append(selector)

    # Workday uses "How Did You Hear About Us" - try selecting
    hear_about = page.locator('[data-automation-id="source"]').first
    await safe_select(hear_about, 'Job Board')

    # Resume upload (Workday often has a specific upload area)
    if await upload_resume(page, profile['resume_path']):
        result['filled'].append('resume')
    else:
        result['missed'].append('resume')

    await fill_labeled_inputs(page, profile, result)

    return result


async def fill_generic(page: Page, profile: dict) -> dict:
    """Handle generic/unknown application forms."""
    result = {'filled': [], 'missed': [], 'ats': 'generic'}

    # Try common input patterns
    inputs = await page.locator('input[type="text"], input[type="email"], input[type="tel"], input[type="url"], input[type="number"]').all()

    for inp in inputs:
        try:
            # Get identifying info
            name = await inp.get_attribute('name') or ''
            placeholder = await inp.get_attribute('placeholder') or ''
            label_text = ''

            # Try to find associated label
            inp_id = await inp.get_attribute('id')
            if inp_id:
                label = page.locator(f'label[for="{inp_id}"]')
                if await label.count() > 0:
                    label_text = await label.first.inner_text()

            # Try aria-label
            aria = await inp.get_attribute('aria-label') or ''

            # Match against profile
            for text in [name, placeholder, label_text, aria]:
                if not text:
                    continue
                value = match_field(text, profile)
                if value:
                    current = await inp.input_value()
                    if not current:  # Don't overwrite existing values
                        await safe_fill(inp, value)
                        result['filled'].append(text)
                    break
        except Exception:
            continue

    # Resume upload
    if await upload_resume(page, profile['resume_path']):
        result['filled'].append('resume')

    return result


async def fill_labeled_inputs(page: Page, profile: dict, result: dict):
    """Fill inputs by finding their labels."""
    inputs = await page.locator('input:visible, textarea:visible, select:visible').all()

    for inp in inputs:
        try:
            current = await inp.input_value()
            if current:  # Already filled
                continue

            # Get all identifying attributes
            name = await inp.get_attribute('name') or ''
            placeholder = await inp.get_attribute('placeholder') or ''
            aria = await inp.get_attribute('aria-label') or ''
            inp_id = await inp.get_attribute('id') or ''

            label_text = ''
            if inp_id:
                label = page.locator(f'label[for="{inp_id}"]')
                if await label.count() > 0:
                    label_text = await label.first.inner_text()

            for text in [label_text, name, placeholder, aria]:
                if not text:
                    continue
                value = match_field(text, profile)
                if value:
                    tag = await inp.evaluate('el => el.tagName')
                    if tag == 'SELECT':
                        await safe_select(inp, value)
                    else:
                        await safe_fill(inp, value)
                    result['filled'].append(text)
                    break
        except Exception:
            continue


async def upload_resume(page: Page, resume_path: str) -> bool:
    """Try to upload resume via file input."""
    try:
        # Find file input
        file_inputs = page.locator('input[type="file"]')
        count = await file_inputs.count()
        if count > 0:
            await file_inputs.first.set_input_files(resume_path)
            await asyncio.sleep(1)  # Wait for upload processing
            return True

        # Try clicking upload button to trigger file dialog
        upload_btns = page.locator('button:has-text("Upload"), button:has-text("resume"), a:has-text("Upload"), [data-automation-id="file-upload"]')
        if await upload_btns.count() > 0:
            # Use file chooser
            async with page.expect_file_chooser(timeout=5000) as fc_info:
                await upload_btns.first.click()
            file_chooser = await fc_info.value
            await file_chooser.set_files(resume_path)
            await asyncio.sleep(1)
            return True
    except Exception:
        pass
    return False


async def handle_sponsorship_question(page: Page, profile: dict):
    """Handle work authorization / sponsorship questions."""
    # Common patterns
    auth_patterns = [
        'authorized to work',
        'work authorization',
        'legally authorized',
        'eligible to work',
    ]
    sponsorship_patterns = [
        'sponsorship',
        'visa',
        'require sponsorship',
        'need sponsorship',
    ]

    # Find radio buttons or selects related to authorization
    radios = await page.locator('input[type="radio"]').all()
    for radio in radios:
        try:
            label = page.locator(f'label[for="{await radio.get_attribute("id")}"]')
            if await label.count() > 0:
                text = (await label.first.inner_text()).lower()
                name = (await radio.get_attribute('name') or '').lower()

                # Work authorization - select "Yes"
                for pattern in auth_patterns:
                    if pattern in name or pattern in text:
                        if 'yes' in text:
                            await safe_click(radio)

                # Sponsorship - select "No"
                for pattern in sponsorship_patterns:
                    if pattern in name or pattern in text:
                        if 'no' in text:
                            await safe_click(radio)
        except Exception:
            continue


async def handle_eeo_questions(page: Page):
    """Handle optional EEO/demographic questions - decline to answer."""
    decline_options = page.locator(
        'option:has-text("Decline"), option:has-text("Prefer not"), '
        'input[value*="decline"], input[value*="prefer not"]'
    )
    count = await decline_options.count()
    for i in range(count):
        try:
            await safe_click(decline_options.nth(i))
        except Exception:
            continue


# Main dispatcher
async def fill_application(page: Page, profile: dict) -> dict:
    """Detect ATS and fill the application form."""
    ats = await detect_ats(page)

    handlers = {
        'greenhouse': fill_greenhouse,
        'lever': fill_lever,
        'workday': fill_workday,
        'generic': fill_generic,
        'linkedin': fill_generic,
        'indeed': fill_generic,
    }

    handler = handlers.get(ats, fill_generic)
    result = await handler(page, profile)

    # Always try these
    await handle_sponsorship_question(page, profile)
    await handle_eeo_questions(page)

    return result
