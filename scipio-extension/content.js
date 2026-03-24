// Scipio Auto-Apply - Content Script
// Runs inside the actual browser page, no bot detection

(function() {
  'use strict';

  const FIELD_MAP = {
    'first.name': 'first_name', 'first_name': 'first_name', 'fname': 'first_name',
    'firstname': 'first_name', 'given.name': 'first_name',
    'last.name': 'last_name', 'last_name': 'last_name', 'lname': 'last_name',
    'lastname': 'last_name', 'family.name': 'last_name', 'surname': 'last_name',
    'full.name': '__full_name__', 'fullname': '__full_name__', 'name': '__full_name__',
    'email': 'email', 'e.mail': 'email', 'email.address': 'email', 'emailaddress': 'email',
    'phone': 'phone', 'mobile': 'phone', 'phone.number': 'phone', 'phonenumber': 'phone',
    'telephone': 'phone', 'cell': 'phone',
    'linkedin': 'linkedin', 'linkedin.url': 'linkedin', 'linkedin.profile': 'linkedin',
    'github': 'github', 'website': 'github', 'portfolio': 'github',
    'city': 'city', 'state': 'state', 'zip': 'zip', 'zipcode': 'zip',
    'postal': 'zip', 'postal.code': 'zip',
    'location': 'location', 'address': 'location',
    'salary': 'desired_salary', 'desired.salary': 'desired_salary',
    'expected.salary': 'desired_salary', 'compensation': 'desired_salary',
    'salary.expectation': 'desired_salary',
    'years': 'years_experience', 'experience': 'years_experience',
    'years.of.experience': 'years_experience',
    'current.company': 'current_company', 'current.employer': 'current_company',
    'company': 'current_company', 'employer': 'current_company',
    'current.title': 'current_title', 'job.title': 'current_title',
    'title': 'current_title',
    'country': 'country',
  };

  // Yes/No question patterns
  const YES_PATTERNS = ['authorized', 'legally authorized', 'eligible to work', 'legal right'];
  const NO_PATTERNS = ['sponsorship', 'visa', 'require sponsorship', 'h1b', 'h-1b'];
  const DECLINE_PATTERNS = ['gender', 'race', 'ethnicity', 'veteran', 'disability', 'demographic', 'sexual orientation'];

  function normalize(text) {
    return text.toLowerCase().replace(/[^a-z0-9]/g, '.').replace(/\.+/g, '.').replace(/^\.|\.$/, '');
  }

  function matchField(text, profile) {
    const norm = normalize(text);
    // Direct match
    if (FIELD_MAP[norm]) {
      const key = FIELD_MAP[norm];
      if (key === '__full_name__') return `${profile.first_name} ${profile.last_name}`;
      return profile[key] || '';
    }
    // Partial match
    for (const [pattern, key] of Object.entries(FIELD_MAP)) {
      if (norm.includes(pattern) || pattern.includes(norm)) {
        if (key === '__full_name__') return `${profile.first_name} ${profile.last_name}`;
        return profile[key] || '';
      }
    }
    return null;
  }

  function getFieldLabel(input) {
    // Try label[for]
    const id = input.id;
    if (id) {
      const label = document.querySelector(`label[for="${id}"]`);
      if (label) return label.textContent.trim();
    }
    // Try aria-label
    if (input.getAttribute('aria-label')) return input.getAttribute('aria-label');
    // Try placeholder
    if (input.placeholder) return input.placeholder;
    // Try name attribute
    if (input.name) return input.name;
    // Try parent label
    const parentLabel = input.closest('label');
    if (parentLabel) return parentLabel.textContent.trim();
    // Try preceding label/text
    const prev = input.previousElementSibling;
    if (prev && (prev.tagName === 'LABEL' || prev.tagName === 'SPAN' || prev.tagName === 'DIV')) {
      return prev.textContent.trim();
    }
    return '';
  }

  function setNativeValue(el, value) {
    // Trigger React/Vue/Angular-compatible value setting
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype, 'value'
    )?.set || Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype, 'value'
    )?.set;

    if (nativeInputValueSetter) {
      nativeInputValueSetter.call(el, value);
    } else {
      el.value = value;
    }

    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
  }

  function handleYesNoQuestion(label, radios) {
    const labelLower = label.toLowerCase();

    for (const pattern of YES_PATTERNS) {
      if (labelLower.includes(pattern)) {
        const yesRadio = radios.find(r => {
          const rLabel = getFieldLabel(r).toLowerCase();
          return rLabel.includes('yes');
        });
        if (yesRadio) { yesRadio.click(); return true; }
      }
    }

    for (const pattern of NO_PATTERNS) {
      if (labelLower.includes(pattern)) {
        const noRadio = radios.find(r => {
          const rLabel = getFieldLabel(r).toLowerCase();
          return rLabel.includes('no');
        });
        if (noRadio) { noRadio.click(); return true; }
      }
    }

    return false;
  }

  function handleSelectQuestion(select, label) {
    const labelLower = label.toLowerCase();
    const options = Array.from(select.options);

    // EEO - decline
    for (const pattern of DECLINE_PATTERNS) {
      if (labelLower.includes(pattern)) {
        const decline = options.find(o =>
          o.text.toLowerCase().includes('decline') ||
          o.text.toLowerCase().includes('prefer not') ||
          o.text.toLowerCase().includes('not to')
        );
        if (decline) { select.value = decline.value; select.dispatchEvent(new Event('change', { bubbles: true })); return true; }
      }
    }

    // Work authorization
    for (const pattern of YES_PATTERNS) {
      if (labelLower.includes(pattern)) {
        const yes = options.find(o => o.text.toLowerCase().includes('yes'));
        if (yes) { select.value = yes.value; select.dispatchEvent(new Event('change', { bubbles: true })); return true; }
      }
    }

    // Sponsorship
    for (const pattern of NO_PATTERNS) {
      if (labelLower.includes(pattern)) {
        const no = options.find(o => o.text.toLowerCase().includes('no'));
        if (no) { select.value = no.value; select.dispatchEvent(new Event('change', { bubbles: true })); return true; }
      }
    }

    return false;
  }

  function detectATS() {
    const url = window.location.href.toLowerCase();
    if (url.includes('greenhouse.io')) return 'greenhouse';
    if (url.includes('lever.co')) return 'lever';
    if (url.includes('myworkdayjobs.com') || url.includes('workday.com')) return 'workday';
    if (url.includes('linkedin.com')) return 'linkedin';
    if (url.includes('indeed.com')) return 'indeed';
    if (url.includes('ziprecruiter.com')) return 'ziprecruiter';
    if (url.includes('smartrecruiters.com')) return 'smartrecruiters';
    if (url.includes('icims.com')) return 'icims';
    if (url.includes('jobvite.com')) return 'jobvite';
    if (url.includes('silkroad.com')) return 'silkroad';
    if (url.includes('taleo.net')) return 'taleo';
    if (url.includes('successfactors.com')) return 'successfactors';
    if (url.includes('ultipro.com')) return 'ultipro';
    if (url.includes('paycom.com')) return 'paycom';
    if (url.includes('bamboohr.com')) return 'bamboohr';
    if (url.includes('ashbyhq.com')) return 'ashby';
    return 'generic';
  }

  // Greenhouse-specific selectors
  function getGreenhouseFields(profile) {
    return [
      ['#first_name', profile.first_name],
      ['#last_name', profile.last_name],
      ['#email', profile.email],
      ['#phone', profile.phone],
      ['input[name*="first_name"]', profile.first_name],
      ['input[name*="last_name"]', profile.last_name],
      ['input[name*="email"]', profile.email],
      ['input[name*="phone"]', profile.phone],
      ['input[autocomplete="given-name"]', profile.first_name],
      ['input[autocomplete="family-name"]', profile.last_name],
      ['input[autocomplete="email"]', profile.email],
      ['input[autocomplete="tel"]', profile.phone],
    ];
  }

  // Lever-specific selectors
  function getLeverFields(profile) {
    return [
      ['input[name="name"]', `${profile.first_name} ${profile.last_name}`],
      ['input[name="email"]', profile.email],
      ['input[name="phone"]', profile.phone],
      ['input[name="org"]', profile.current_company],
      ['input[name="urls[LinkedIn]"]', profile.linkedin],
      ['input[name="urls[GitHub]"]', profile.github],
      ['input[name="urls[Portfolio]"]', profile.github],
      ['input[name="urls[Other]"]', profile.linkedin],
    ];
  }

  // Workday-specific selectors
  function getWorkdayFields(profile) {
    return [
      ['[data-automation-id="legalNameSection_firstName"]', profile.first_name],
      ['[data-automation-id="legalNameSection_lastName"]', profile.last_name],
      ['[data-automation-id="email"]', profile.email],
      ['[data-automation-id="phone-number"]', profile.phone],
      ['[data-automation-id="addressSection_city"]', profile.city],
      ['[data-automation-id="addressSection_postalCode"]', profile.zip],
      ['input[data-automation-id="legalNameSection_firstName"]', profile.first_name],
      ['input[data-automation-id="legalNameSection_lastName"]', profile.last_name],
    ];
  }

  function fillForm(profile) {
    const ats = detectATS();
    let filled = [];
    let missed = [];

    // 1. Fill ATS-specific fields first
    let specificFields = [];
    if (ats === 'greenhouse') specificFields = getGreenhouseFields(profile);
    else if (ats === 'lever') specificFields = getLeverFields(profile);
    else if (ats === 'workday') specificFields = getWorkdayFields(profile);

    for (const [selector, value] of specificFields) {
      const el = document.querySelector(selector);
      if (el && !el.value) {
        setNativeValue(el, value);
        filled.push(selector);
      }
    }

    // 2. Fill all visible text/email/tel/url inputs by label matching
    const inputs = document.querySelectorAll(
      'input[type="text"]:not([readonly]), input[type="email"]:not([readonly]), ' +
      'input[type="tel"]:not([readonly]), input[type="url"]:not([readonly]), ' +
      'input[type="number"]:not([readonly]), input:not([type]):not([readonly])'
    );

    for (const input of inputs) {
      if (input.value) continue; // Already filled
      if (input.offsetParent === null) continue; // Hidden

      const label = getFieldLabel(input);
      if (!label) continue;

      const value = matchField(label, profile);
      if (value) {
        setNativeValue(input, value);
        filled.push(label);
      }
    }

    // 3. Handle radio buttons (work auth, sponsorship)
    const radioGroups = {};
    document.querySelectorAll('input[type="radio"]').forEach(r => {
      const name = r.name;
      if (!radioGroups[name]) radioGroups[name] = [];
      radioGroups[name].push(r);
    });

    for (const [name, radios] of Object.entries(radioGroups)) {
      // Find the question label for this radio group
      const firstRadio = radios[0];
      const container = firstRadio.closest('fieldset, .field, .question, [class*="question"], [class*="field"]');
      let questionLabel = '';
      if (container) {
        const legend = container.querySelector('legend, label, .label, [class*="label"]');
        if (legend) questionLabel = legend.textContent;
      }
      if (!questionLabel) questionLabel = name;

      if (handleYesNoQuestion(questionLabel, radios)) {
        filled.push(`radio: ${questionLabel.slice(0, 40)}`);
      }
    }

    // 4. Handle select dropdowns
    document.querySelectorAll('select:not([readonly])').forEach(select => {
      if (select.value && select.selectedIndex > 0) return;
      if (select.offsetParent === null) return;

      const label = getFieldLabel(select);
      if (label && handleSelectQuestion(select, label)) {
        filled.push(`select: ${label.slice(0, 40)}`);
      }
    });

    // 5. Try resume upload
    const fileInput = document.querySelector('input[type="file"]');
    if (fileInput) {
      missed.push('resume (click Upload in extension popup)');
    }

    return { ats, filled, missed, fieldCount: inputs.length };
  }

  // Listen for messages from popup
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'fill') {
      chrome.storage.local.get('profile', (data) => {
        if (data.profile) {
          const result = fillForm(data.profile);
          sendResponse(result);
        } else {
          sendResponse({ error: 'No profile saved. Open extension popup to set up.' });
        }
      });
      return true; // async response
    }

    if (msg.action === 'detect') {
      const ats = detectATS();
      const forms = document.querySelectorAll('form');
      const inputs = document.querySelectorAll('input, textarea, select');
      sendResponse({
        ats,
        url: window.location.href,
        formCount: forms.length,
        inputCount: inputs.length,
        title: document.title
      });
      return true;
    }

    if (msg.action === 'getPageInfo') {
      // Get job description text for the tracker
      const bodyText = document.body.innerText.slice(0, 3000);
      sendResponse({
        title: document.title,
        url: window.location.href,
        text: bodyText
      });
      return true;
    }
  });

  // Show floating indicator that Scipio is active
  function showBadge() {
    if (document.getElementById('scipio-badge')) return;
    const badge = document.createElement('div');
    badge.id = 'scipio-badge';
    badge.innerHTML = 'S';
    badge.title = 'Scipio Auto-Apply Active';
    document.body.appendChild(badge);
  }

  // Only show badge on pages that look like job applications
  const pageText = document.body?.innerText?.toLowerCase() || '';
  if (pageText.includes('apply') || pageText.includes('application') ||
      pageText.includes('resume') || pageText.includes('cover letter')) {
    showBadge();
  }
})();
