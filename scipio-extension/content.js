// Scipio Auto-Apply - Content Script
// Runs inside the actual browser page, no bot detection

(function() {
  'use strict';

  let profile_cache = null;

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
    'location': 'address', 'address': 'address', 'street': 'address', 'street.address': 'address',
    'address.line': 'address', 'address.1': 'address',
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
    const evtOpts = { bubbles: true };
    const label = getFieldLabel(el) || el.name || el.id;

    // 1. Focus + click
    el.focus();
    el.click();

    // 2. Try execCommand insertText (browser treats as real user input)
    el.select();
    document.execCommand('selectAll');
    const inserted = document.execCommand('insertText', false, value);
    if (inserted && el.value === value) {
      log('SET (execCommand)', el.tagName, label, '=', value.slice(0, 30));
      el.dispatchEvent(new Event('change', evtOpts));
      el.dispatchEvent(new FocusEvent('blur', evtOpts));
      return;
    }

    // 3. Simplify Copilot technique
    trySimplifySet(el, value);

    // 4. Direct value + attribute
    el.value = value;
    if (el.tagName === 'TEXTAREA') {
      el.textContent = value;
      el.innerHTML = value;
    } else {
      el.setAttribute('value', value);
    }

    // 5. Full event chain
    el.dispatchEvent(new KeyboardEvent('keydown', evtOpts));
    el.dispatchEvent(new KeyboardEvent('keypress', evtOpts));
    el.dispatchEvent(new CustomEvent('textInput', evtOpts));
    el.dispatchEvent(new InputEvent('input', { ...evtOpts, data: value, inputType: 'insertText' }));
    el.dispatchEvent(new KeyboardEvent('keyup', evtOpts));
    el.dispatchEvent(new Event('change', evtOpts));
    el.dispatchEvent(new FocusEvent('blur', evtOpts));

    log('SET', el.tagName, label, '=', value.slice(0, 30));
  }

  function trySimplifySet(el, value) {
    try {
      const instanceSetter = Object.getOwnPropertyDescriptor(el, 'value')?.set;
      const protoSetter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')?.set;
      if (instanceSetter && protoSetter && instanceSetter !== protoSetter) {
        protoSetter.call(el, value);
      } else if (protoSetter) {
        protoSetter.call(el, value);
      } else if (instanceSetter) {
        instanceSetter.call(el, value);
      }
      return el.value === value;
    } catch(e) { return false; }
  }

  // Debug logger - check console with: Scipio:
  function log(...args) {
    console.log('%c[Scipio]', 'color: #38bdf8; font-weight: bold', ...args);
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

  // State abbreviation to full name mapping
  const STATE_MAP = {
    'AL':'Alabama','AK':'Alaska','AZ':'Arizona','AR':'Arkansas','CA':'California',
    'CO':'Colorado','CT':'Connecticut','DE':'Delaware','FL':'Florida','GA':'Georgia',
    'HI':'Hawaii','ID':'Idaho','IL':'Illinois','IN':'Indiana','IA':'Iowa',
    'KS':'Kansas','KY':'Kentucky','LA':'Louisiana','ME':'Maine','MD':'Maryland',
    'MA':'Massachusetts','MI':'Michigan','MN':'Minnesota','MS':'Mississippi','MO':'Missouri',
    'MT':'Montana','NE':'Nebraska','NV':'Nevada','NH':'New Hampshire','NJ':'New Jersey',
    'NM':'New Mexico','NY':'New York','NC':'North Carolina','ND':'North Dakota','OH':'Ohio',
    'OK':'Oklahoma','OR':'Oregon','PA':'Pennsylvania','RI':'Rhode Island','SC':'South Carolina',
    'SD':'South Dakota','TN':'Tennessee','TX':'Texas','UT':'Utah','VT':'Vermont',
    'VA':'Virginia','WA':'Washington','WV':'West Virginia','WI':'Wisconsin','WY':'Wyoming',
    'DC':'District of Columbia',
  };

  function selectOption(select, value) {
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    select.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }

  function handleSelectQuestion(select, label) {
    const labelLower = label.toLowerCase();
    const options = Array.from(select.options);

    // State/Location dropdown
    if (labelLower.includes('state') || labelLower.includes('location') || labelLower.includes('province')) {
      // Try matching state abbreviation and full name
      const stateAbbr = (profile_cache && profile_cache.state) || 'NJ';
      const stateFull = STATE_MAP[stateAbbr.toUpperCase()] || '';

      const match = options.find(o => {
        const t = o.text.trim().toLowerCase();
        const v = o.value.trim().toLowerCase();
        return t === stateAbbr.toLowerCase() || t === stateFull.toLowerCase() ||
               v === stateAbbr.toLowerCase() || v === stateFull.toLowerCase() ||
               t.includes(stateFull.toLowerCase()) || t.includes(stateAbbr.toLowerCase());
      });
      if (match) { selectOption(select, match.value); return true; }
    }

    // Education level
    if (labelLower.includes('education') || labelLower.includes('highest level')) {
      const match = options.find(o => {
        const t = o.text.toLowerCase();
        return t.includes("bachelor") || t.includes("4 year") || t.includes("undergraduate");
      });
      if (match) { selectOption(select, match.value); return true; }
    }

    // School - try to find "Other" or closest match
    if (labelLower.includes('school') && !labelLower.includes('high school')) {
      const match = options.find(o => o.text.toLowerCase().includes('other')) ||
                    options.find(o => o.text.toLowerCase().includes('not listed'));
      if (match) { selectOption(select, match.value); return true; }
    }

    // Degree
    if (labelLower === 'degree' || labelLower === '* degree' || labelLower.includes('degree type')) {
      const match = options.find(o => {
        const t = o.text.toLowerCase();
        return t.includes("bachelor") || t.includes("b.s") || t.includes("bs") || t.includes("b.a");
      });
      if (match) { selectOption(select, match.value); return true; }
    }

    // License/Certs - select "No License" or "None"
    if (labelLower.includes('license') || labelLower.includes('cert')) {
      const match = options.find(o => {
        const t = o.text.toLowerCase();
        return t.includes('no license') || t.includes('none') || t.includes('n/a') || t.includes('not applicable');
      });
      if (match) { selectOption(select, match.value); return true; }
    }

    // Generic "Yes or No" / "Please select" questions
    if (labelLower.includes('yes or no') || labelLower.includes('please select yes') ||
        labelLower.includes('were you') || labelLower.includes('have you') ||
        labelLower.includes('are you an employee') || labelLower.includes('employee or volunteer')) {
      const no = options.find(o => o.text.toLowerCase().trim() === 'no' || o.value.toLowerCase().trim() === 'no');
      if (no) { selectOption(select, no.value); return true; }
    }

    // Country dropdown
    if (labelLower.includes('country')) {
      const match = options.find(o =>
        o.text.toLowerCase().includes('united states') ||
        o.value.toLowerCase() === 'us' ||
        o.value.toLowerCase() === 'usa'
      );
      if (match) { selectOption(select, match.value); return true; }
    }

    // EEO - decline
    for (const pattern of DECLINE_PATTERNS) {
      if (labelLower.includes(pattern)) {
        const decline = options.find(o =>
          o.text.toLowerCase().includes('decline') ||
          o.text.toLowerCase().includes('prefer not') ||
          o.text.toLowerCase().includes('not to')
        );
        if (decline) { selectOption(select, decline.value); return true; }
      }
    }

    // Work authorization
    for (const pattern of YES_PATTERNS) {
      if (labelLower.includes(pattern)) {
        const yes = options.find(o => o.text.toLowerCase().includes('yes'));
        if (yes) { selectOption(select, yes.value); return true; }
      }
    }

    // Sponsorship
    for (const pattern of NO_PATTERNS) {
      if (labelLower.includes(pattern)) {
        const no = options.find(o => o.text.toLowerCase().includes('no'));
        if (no) { selectOption(select, no.value); return true; }
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
    profile_cache = profile; // cache for dropdown handlers
    const ats = detectATS();
    let filled = [];
    let missed = [];
    log('=== FILL START ===', 'ATS:', ats, 'URL:', window.location.href);
    log('Profile address:', profile.address);

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
      const firstRadio = radios[0];
      const container = firstRadio.closest('fieldset, .field, .question, [class*="question"], [class*="field"]');
      let questionLabel = '';
      if (container) {
        const legend = container.querySelector('legend, label, .label, [class*="label"]');
        if (legend) questionLabel = legend.textContent;
      }
      if (!questionLabel) questionLabel = name;

      // Work auth / sponsorship
      if (handleYesNoQuestion(questionLabel, radios)) {
        filled.push(`radio: ${questionLabel.slice(0, 40)}`);
        continue;
      }

      // EEO questions - answer with actual info
      const ql = questionLabel.toLowerCase();

      // Gender -> Male
      if (ql.includes('gender') || ql.includes('sex')) {
        const match = radios.find(r => (getFieldLabel(r) || '').toLowerCase().trim() === 'male');
        if (match) { match.click(); filled.push('gender: Male'); continue; }
      }

      // Race -> Black or African American
      if (ql.includes('race') || ql.includes('ethnicity')) {
        const match = radios.find(r => {
          const l = (getFieldLabel(r) || '').toLowerCase();
          return l.includes('black') || l.includes('african american');
        });
        if (match) { match.click(); filled.push('race: Black/African American'); continue; }
      }

      // Disability -> No
      if (ql.includes('disability')) {
        const match = radios.find(r => {
          const l = (getFieldLabel(r) || '').toLowerCase();
          return l.includes('no, i do not') || l.includes('i do not have a disability');
        });
        if (match) { match.click(); filled.push('disability: No'); continue; }
      }

      // Veteran -> Not a protected veteran
      if (ql.includes('veteran')) {
        const match = radios.find(r => {
          const l = (getFieldLabel(r) || '').toLowerCase();
          return l.includes('not a protected') || l.includes('i am not');
        });
        if (match) { match.click(); filled.push('veteran: No'); continue; }
      }

      // Any other EEO -> decline
      if (ql.includes('eeo') || ql.includes('self identify') || ql.includes('self-identify')) {
        const decline = radios.find(r => {
          const l = (getFieldLabel(r) || '').toLowerCase();
          return l.includes('choose not') || l.includes('decline') || l.includes('prefer not');
        });
        if (decline) { decline.click(); filled.push('eeo: decline'); continue; }
      }
    }

    // 3b. Standalone EEO radios that weren't in groups
    for (const radio of document.querySelectorAll('input[type="radio"]:not(:checked)')) {
      const rLabel = (getFieldLabel(radio) || '').toLowerCase();
      if (rLabel === 'male') { radio.click(); filled.push('gender: Male'); }
      else if (rLabel.includes('black') || rLabel.includes('african american')) { radio.click(); filled.push('race: Black'); }
      else if (rLabel.includes('no, i do not have a disability') || rLabel.includes('i do not have a disability')) { radio.click(); filled.push('disability: No'); }
      else if (rLabel.includes('not a protected veteran') || rLabel.includes('i am not a protected')) { radio.click(); filled.push('veteran: No'); }
    }

    // 3c. Handle date fields - always use yyyy-MM-dd (ISO) format
    const todayISO = new Date().toISOString().slice(0, 10); // 2026-03-24

    for (const inp of document.querySelectorAll('input[type="date"], input[placeholder*="m/d"], input[placeholder*="mm/dd"], input[placeholder*="date"]')) {
      if (inp.value) continue;
      setNativeValue(inp, todayISO);
      filled.push('date: today');
    }

    // Also find date inputs by label
    for (const inp of document.querySelectorAll('input')) {
      if (inp.value || inp.type === 'hidden' || inp.type === 'file' || inp.type === 'radio' || inp.type === 'checkbox') continue;
      const label = (getFieldLabel(inp) || '').toLowerCase();
      if (label.includes('date') && !label.includes('update') && !label.includes('posted')) {
        setNativeValue(inp, todayISO);
        filled.push('date: ' + label.slice(0, 30));
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

    // 5. Handle textareas - fill ALL empty visible ones
    for (const ta of document.querySelectorAll('textarea')) {
      if (ta.value) continue;
      try { if (ta.offsetParent === null) continue; } catch(e) {}

      let surroundingText = '';
      try {
        let el = ta.previousElementSibling;
        for (let i = 0; i < 3 && el; i++) { surroundingText += ' ' + el.textContent; el = el.previousElementSibling; }
        if (ta.parentElement) surroundingText += ' ' + ta.parentElement.textContent;
        if (ta.parentElement?.parentElement) surroundingText += ' ' + ta.parentElement.parentElement.textContent;
      } catch(e) {}

      const label = getFieldLabel(ta) || '';
      const allText = [label, ta.placeholder, surroundingText].join(' ').toLowerCase();
      log('TEXTAREA:', ta.name || ta.id || '(anon)', 'allText:', allText.slice(0,80));

      if (allText.includes('cover letter') || allText.includes('why are you interested') || allText.includes('tell us about')) {
        setNativeValue(ta, profile.summary || 'N/A');
        filled.push('textarea: summary');
      } else {
        setNativeValue(ta, 'N/A');
        filled.push('textarea: N/A');
      }
    }

    // 6. Brute-force fallback for ALL empty visible fields (input, textarea, contenteditable)
    for (const inp of document.querySelectorAll('input, textarea, [contenteditable="true"]')) {
      // Skip filled or irrelevant
      const isContentEditable = inp.getAttribute('contenteditable') === 'true';
      const currentVal = isContentEditable ? inp.textContent.trim() : inp.value;
      if (currentVal) continue;
      if (!isContentEditable) {
        if (inp.type === 'hidden' || inp.type === 'file' || inp.type === 'submit' ||
            inp.type === 'checkbox' || inp.type === 'radio' || inp.type === 'button') continue;
      }
      try { if (inp.offsetParent === null) continue; } catch(e) {}

      // Get label + surrounding text
      const label = getFieldLabel(inp);
      let surroundingText = '';
      try {
        let el = inp.previousElementSibling;
        for (let i = 0; i < 3 && el; i++) { surroundingText += ' ' + el.textContent; el = el.previousElementSibling; }
        if (inp.parentElement) surroundingText += ' ' + inp.parentElement.textContent;
      } catch(e) {}

      const allAttrs = [label, inp.name, inp.id, inp.placeholder,
        inp.getAttribute('aria-label'), inp.getAttribute('autocomplete'),
        surroundingText].filter(Boolean);
      const allText = allAttrs.map(s => s.toLowerCase()).join(' ');

      log('FALLBACK checking:', inp.tagName, 'label:', (label||'').slice(0,40), 'surrounding:', surroundingText.slice(0,60));

      // N/A fields: "if yes", "if no", "facility", "dates worked", "reply with n/a"
      if (allText.includes('if yes') || allText.includes('if no') || allText.includes('n/a') ||
          allText.includes('facility') || allText.includes('dates worked') || allText.includes('reply with')) {
        if (isContentEditable) {
          inp.textContent = 'N/A';
          inp.dispatchEvent(new Event('input', { bubbles: true }));
        } else {
          setNativeValue(inp, 'N/A');
        }
        filled.push('N/A field (fallback)');
        continue;
      }

      // Address
      if ((allText.includes('address') || allText.includes('street')) &&
          !allText.includes('email') && !allText.includes('ip-')) {
        setNativeValue(inp, profile.address || '1174 Summit Ave');
        filled.push('address (fallback)');
        continue;
      }

      // Standard field matching
      for (const attr of allAttrs) {
        const value = matchField(attr, profile);
        if (value) { setNativeValue(inp, value); filled.push(attr + ' (fallback)'); break; }
      }
    }

    log('=== FILL DONE ===', 'Filled:', filled.length, 'Missed:', missed.length);
    log('Filled:', filled);
    log('Missed:', missed);
    return { ats, filled, missed, fieldCount: inputs.length };
  }

  // Listen for messages from popup
  // Resume attachment via DataTransfer
  function attachResume(resumeData) {
    const fileInputs = document.querySelectorAll('input[type="file"]');
    if (fileInputs.length === 0) return false;

    try {
      // Convert base64 data URL to File object
      const arr = resumeData.data.split(',');
      const mime = arr[0].match(/:(.*?);/)[1];
      const bstr = atob(arr[1]);
      let n = bstr.length;
      const u8arr = new Uint8Array(n);
      while (n--) u8arr[n] = bstr.charCodeAt(n);
      const file = new File([u8arr], resumeData.name, { type: mime });

      // Use DataTransfer to set the file on the input
      const dt = new DataTransfer();
      dt.items.add(file);

      for (const fileInput of fileInputs) {
        fileInput.files = dt.files;
        fileInput.dispatchEvent(new Event('change', { bubbles: true }));
        fileInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
      return true;
    } catch (e) {
      console.error('Scipio: resume attach failed:', e);
      return false;
    }
  }

  function clickCaptchaCheckbox() {
    // reCAPTCHA v2 checkbox is inside an iframe
    try {
      const iframes = document.querySelectorAll('iframe[src*="recaptcha"], iframe[title*="reCAPTCHA"]');
      for (const iframe of iframes) {
        try {
          const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
          const checkbox = iframeDoc.querySelector('.recaptcha-checkbox, #recaptcha-anchor');
          if (checkbox) {
            checkbox.click();
            log('CAPTCHA: clicked reCAPTCHA checkbox');
            return true;
          }
        } catch(e) {
          // Cross-origin iframe - can't access directly, try clicking the iframe itself
          log('CAPTCHA: cross-origin iframe, clicking iframe element');
          iframe.click();
          return true;
        }
      }

      // Try clicking any visible captcha checkbox directly on page
      const captchaDiv = document.querySelector('.g-recaptcha, [data-sitekey], .recaptcha');
      if (captchaDiv) {
        captchaDiv.click();
        log('CAPTCHA: clicked g-recaptcha div');
        return true;
      }
    } catch(e) {
      log('CAPTCHA: error', e.message);
    }
    return false;
  }

  function clickNextOrSubmit() {
    const selectors = ['button:not([disabled])', 'input[type="submit"]:not([disabled])', 'a[role="button"]', 'a.btn', 'a.button'];
    const keywords = ['next', 'submit', 'continue', 'apply', 'send', 'complete', 'finish', 'save'];

    for (const selector of selectors) {
      for (const el of document.querySelectorAll(selector)) {
        const text = (el.textContent || el.value || '').toLowerCase().trim();
        for (const kw of keywords) {
          if (text === kw || text.startsWith(kw)) {
            log('CLICKING:', el.tagName, text);
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            setTimeout(() => el.click(), 300);
            return { clicked: true, buttonText: text };
          }
        }
      }
    }
    log('No Next/Submit button found');
    return { clicked: false, buttonText: '' };
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'clickNext') {
      const result = clickNextOrSubmit();
      sendResponse(result);
      return true;
    }

    if (msg.action === 'fill') {
      chrome.storage.local.get(["profile", "resume_data"], (data) => {
        if (data.profile) {
          const result = fillForm(data.profile);

          // Try attaching resume
          if (data.resume_data) {
            const attached = attachResume(data.resume_data);
            if (attached) {
              result.filled.push('resume (auto-attached)');
            } else {
              result.missed.push('resume (no file input found)');
            }
          } else {
            result.missed.push('resume (upload one in Profile tab)');
          }

          // Try clicking CAPTCHA if present
          chrome.storage.local.set({ scipio_autofill_active: true });
          if (clickCaptchaCheckbox()) {
            result.filled.push('captcha clicked');
          }

          // Click Next/Submit if requested
          if (msg.clickNext) {
            // Wait a beat for captcha to process
            setTimeout(() => clickNextOrSubmit(), 500);
            result.filled.push('clicked Next/Submit');
          }

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
