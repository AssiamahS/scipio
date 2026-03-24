// Scipio Extension Popup Logic

const DEFAULT_PROFILE = {
  first_name: 'Sylvester',
  last_name: 'Assiamah',
  email: 'sylvesterassiamah105@gmail.com',
  phone: '908-839-0555',
  linkedin: 'https://linkedin.com/in/sylvesterassiamah',
  github: 'https://github.com/AssiamahS',
  location: 'New Jersey, USA',
  city: 'Red Bank',
  state: 'NJ',
  zip: '07701',
  country: 'United States',
  current_title: 'Infrastructure Operations',
  current_company: 'Hackensack Meridian Health Network',
  desired_salary: '120000',
  years_experience: '7',
  remote_only: true,
  requires_sponsorship: false,
};

const DEFAULT_SETTINGS = {
  gh_token: '',
  dash_url: 'https://assiamahs.github.io/scipio/',
};

// Tab switching
function switchTab(name) {
  document.querySelectorAll('.tab').forEach((t, i) => {
    t.classList.toggle('active', t.textContent.toLowerCase().includes(name));
  });
  document.querySelectorAll('.tab-content').forEach(tc => tc.classList.remove('active'));
  document.getElementById(`tab-${name}`).classList.add('active');
}

// Detect page on load
document.addEventListener('DOMContentLoaded', async () => {
  // Load profile
  chrome.storage.local.get(['profile', 'settings'], (data) => {
    const profile = data.profile || DEFAULT_PROFILE;
    // Save default if not exists
    if (!data.profile) {
      chrome.storage.local.set({ profile: DEFAULT_PROFILE });
    }
    fillProfileForm(profile);

    const settings = data.settings || DEFAULT_SETTINGS;
    if (!data.settings) {
      chrome.storage.local.set({ settings: DEFAULT_SETTINGS });
    }
    fillSettingsForm(settings);
  });

  // Detect current page
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) {
      chrome.tabs.sendMessage(tab.id, { action: 'detect' }, (response) => {
        if (chrome.runtime.lastError || !response) {
          document.getElementById('pageTitle').textContent = tab.title || 'Unknown page';
          document.getElementById('pageAts').textContent = 'N/A';
          document.getElementById('pageForms').textContent = '(extension not active on this page)';
          document.getElementById('fillBtn').disabled = true;
          return;
        }
        document.getElementById('pageTitle').textContent = (response.title || '').slice(0, 50);
        document.getElementById('pageAts').textContent = response.ats;
        document.getElementById('pageForms').textContent = `| ${response.formCount} forms, ${response.inputCount} inputs`;
        document.getElementById('fillBtn').disabled = false;
      });
    }
  } catch (e) {
    console.error('Detection error:', e);
  }
});

// Fill application form
async function fillForm() {
  const btn = document.getElementById('fillBtn');
  const resultEl = document.getElementById('result');
  btn.disabled = true;
  btn.textContent = 'Filling...';

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    chrome.tabs.sendMessage(tab.id, { action: 'fill' }, (response) => {
      btn.disabled = false;
      btn.textContent = 'Auto-Fill Application';

      if (chrome.runtime.lastError || !response) {
        showResult(resultEl, 'error', 'Could not connect to page. Refresh and try again.');
        return;
      }

      if (response.error) {
        showResult(resultEl, 'error', response.error);
        return;
      }

      const filled = response.filled || [];
      const missed = response.missed || [];

      if (filled.length === 0 && missed.length === 0) {
        showResult(resultEl, 'info', `ATS: ${response.ats} | No fillable fields found. You may need to click "Apply" first to open the form.`);
      } else {
        let html = `Filled ${filled.length} field(s) on ${response.ats}`;
        if (missed.length) html += ` | Missed: ${missed.join(', ')}`;
        if (filled.length) {
          html += '<div class="filled-list">' + filled.map(f => `<div>${f}</div>`).join('') + '</div>';
        }
        showResult(resultEl, filled.length > 0 ? 'success' : 'info', html);
      }
    });
  } catch (e) {
    btn.disabled = false;
    btn.textContent = 'Auto-Fill Application';
    showResult(resultEl, 'error', e.message);
  }
}

// Add current page to tracker
async function addToTracker() {
  const resultEl = document.getElementById('result');

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    chrome.tabs.sendMessage(tab.id, { action: 'getPageInfo' }, async (response) => {
      const title = response?.title || tab.title || '';
      const url = response?.url || tab.url || '';

      // Try to extract company and role from title
      let company = '';
      let role = '';

      // Common patterns: "Role at Company" or "Company - Role" or "Role | Company"
      if (title.includes(' at ')) {
        [role, company] = title.split(' at ').map(s => s.trim());
      } else if (title.includes(' - ')) {
        const parts = title.split(' - ').map(s => s.trim());
        if (parts.length >= 2) {
          role = parts[0];
          company = parts[1];
        }
      } else if (title.includes(' | ')) {
        const parts = title.split(' | ').map(s => s.trim());
        if (parts.length >= 2) {
          role = parts[0];
          company = parts[1];
        }
      } else {
        role = title.slice(0, 60);
      }

      // Clean up common suffixes
      company = company.replace(/\s*[-|]\s*(Careers|Jobs|Hiring|Greenhouse|Lever).*$/i, '').trim();
      role = role.replace(/^(Job Application for|Apply for)\s*/i, '').trim();

      // Save to GitHub
      chrome.storage.local.get('settings', async (data) => {
        const settings = data.settings || {};
        if (settings.gh_token) {
          const success = await addJobToGitHub(settings.gh_token, company, role, url);
          if (success) {
            showResult(resultEl, 'success', `Added to tracker: ${company} - ${role}`);
          } else {
            showResult(resultEl, 'error', 'Failed to sync to GitHub. Check token in Settings.');
          }
        } else {
          showResult(resultEl, 'info', `Would add: ${company} - ${role}. Set GitHub token in Settings to sync.`);
        }
      });
    });
  } catch (e) {
    showResult(resultEl, 'error', e.message);
  }
}

async function addJobToGitHub(token, company, role, url) {
  try {
    const apiUrl = `https://api.github.com/repos/AssiamahS/scipio/contents/jobs.json`;
    const headers = {
      'Authorization': `token ${token}`,
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
    };

    // Get current file
    const getResp = await fetch(apiUrl, { headers });
    if (!getResp.ok) return false;

    const fileData = await getResp.json();
    const content = atob(fileData.content.replace(/\n/g, ''));
    const db = JSON.parse(content);

    // Add new job
    const now = new Date().toISOString().slice(0, 10);
    const nowFull = new Date().toISOString().slice(0, 16).replace('T', ' ');

    db.jobs.push({
      id: db.next_id++,
      company: company || 'Unknown',
      role: role || 'Unknown',
      url,
      salary: '',
      notes: 'Added via Scipio extension',
      status: 'applied',
      applied_date: now,
      updated_date: now,
      history: [{ status: 'applied', date: nowFull }]
    });

    // Push update
    const newContent = btoa(unescape(encodeURIComponent(JSON.stringify(db, null, 2))));
    const putResp = await fetch(apiUrl, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        message: `Applied: ${company} - ${role}`,
        content: newContent,
        sha: fileData.sha,
      })
    });

    return putResp.ok;
  } catch (e) {
    console.error('GitHub sync error:', e);
    return false;
  }
}

// Profile form
function fillProfileForm(profile) {
  const map = {
    pFirstName: 'first_name', pLastName: 'last_name', pEmail: 'email',
    pPhone: 'phone', pLinkedin: 'linkedin', pGithub: 'github',
    pCity: 'city', pState: 'state', pZip: 'zip', pCountry: 'country',
    pTitle: 'current_title', pCompany: 'current_company',
    pSalary: 'desired_salary', pYears: 'years_experience',
  };
  for (const [elId, key] of Object.entries(map)) {
    const el = document.getElementById(elId);
    if (el) el.value = profile[key] || '';
  }
}

function saveProfile() {
  const profile = {
    first_name: document.getElementById('pFirstName').value,
    last_name: document.getElementById('pLastName').value,
    email: document.getElementById('pEmail').value,
    phone: document.getElementById('pPhone').value,
    linkedin: document.getElementById('pLinkedin').value,
    github: document.getElementById('pGithub').value,
    city: document.getElementById('pCity').value,
    state: document.getElementById('pState').value,
    zip: document.getElementById('pZip').value,
    country: document.getElementById('pCountry').value,
    location: `${document.getElementById('pCity').value}, ${document.getElementById('pState').value}`,
    current_title: document.getElementById('pTitle').value,
    current_company: document.getElementById('pCompany').value,
    desired_salary: document.getElementById('pSalary').value,
    years_experience: document.getElementById('pYears').value,
    remote_only: true,
    requires_sponsorship: false,
  };

  chrome.storage.local.set({ profile }, () => {
    showResult(document.getElementById('profileResult'), 'success', 'Profile saved!');
  });
}

// Settings
function fillSettingsForm(settings) {
  document.getElementById('sGhToken').value = settings.gh_token || '';
  document.getElementById('sDashUrl').value = settings.dash_url || 'https://assiamahs.github.io/scipio/';
  document.getElementById('dashLink').href = settings.dash_url || 'https://assiamahs.github.io/scipio/';
}

function saveSettings() {
  const settings = {
    gh_token: document.getElementById('sGhToken').value.trim(),
    dash_url: document.getElementById('sDashUrl').value.trim(),
  };
  chrome.storage.local.set({ settings }, () => {
    document.getElementById('dashLink').href = settings.dash_url;
    showResult(document.getElementById('result'), 'success', 'Settings saved!');
    switchTab('apply');
  });
}

function showResult(el, type, html) {
  el.className = `result show ${type}`;
  el.innerHTML = html;
}
