// Scipio API - Cloudflare Pages Function
// Catches all /api/* routes
// Environment secrets (set in Cloudflare Pages dashboard > Settings > Environment Variables):
//   GITHUB_TOKEN  - GitHub PAT with repo scope (encrypted)
//   REPO_OWNER    - GitHub username (e.g. "AssiamahS")
//   REPO_NAME     - Repo name (e.g. "scipio")

const CORS_HEADERS = {
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Scipio-Profile',
  'Access-Control-Max-Age': '86400',
};

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '';
  // Allow same-origin (Pages URL) + localhost for dev
  const isAllowed = origin.includes('scipio') || origin.includes('localhost') || origin.includes('127.0.0.1') || origin.includes('pages.dev') || origin.includes('assiamahs.github.io');
  return {
    ...CORS_HEADERS,
    'Access-Control-Allow-Origin': isAllowed ? origin : '*',
  };
}

function json(data, status = 200, request, env) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(request, env) },
  });
}

async function ghFetch(env, path, opts = {}) {
  const owner = env.REPO_OWNER || 'AssiamahS';
  const repo = env.REPO_NAME || 'scipio';
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
  return fetch(url, {
    ...opts,
    headers: {
      'Authorization': `token ${env.GITHUB_TOKEN}`,
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
      'User-Agent': 'Scipio-Pages/1.0',
      ...(opts.headers || {}),
    },
  });
}

// Read a JSON file from the repo
async function readFile(env, path) {
  const r = await ghFetch(env, path);
  if (r.status === 404) return { data: null, sha: null };
  if (!r.ok) throw new Error(`GitHub API ${r.status}: ${await r.text()}`);
  const file = await r.json();
  const content = atob(file.content.replace(/\n/g, ''));
  return { data: JSON.parse(content), sha: file.sha };
}

// Write a JSON file to the repo
async function writeFile(env, path, data, sha, message) {
  const content = btoa(unescape(encodeURIComponent(JSON.stringify(data, null, 2))));
  const body = { message: message || `Update ${path}`, content };
  if (sha) body.sha = sha;

  const r = await ghFetch(env, path, {
    method: 'PUT',
    body: JSON.stringify(body),
  });

  if (!r.ok) {
    const err = await r.json();
    throw new Error(err.message || `GitHub write failed: ${r.status}`);
  }

  const result = await r.json();
  return { sha: result.content.sha };
}

// === ROUTE HANDLERS ===

async function getJobs(env) {
  const { data, sha } = await readFile(env, 'jobs.json');
  return { jobs: data?.jobs || [], next_id: data?.next_id || 1, sha };
}

async function addJob(env, job) {
  const { data, sha } = await readFile(env, 'jobs.json');
  const db = data || { jobs: [], next_id: 1 };
  job.id = db.next_id++;
  job.applied_date = job.applied_date || new Date().toISOString().slice(0, 10);
  job.updated_date = new Date().toISOString().slice(0, 10);
  job.history = job.history || [{ status: job.status || 'wishlist', date: new Date().toISOString().slice(0, 16).replace('T', ' ') }];
  db.jobs.push(job);
  const result = await writeFile(env, 'jobs.json', db, sha, `Added: ${job.company} - ${job.role}`);
  return { job, sha: result.sha };
}

async function updateJob(env, id, updates) {
  const { data, sha } = await readFile(env, 'jobs.json');
  if (!data) throw new Error('No jobs data');
  const job = data.jobs.find(j => j.id === id);
  if (!job) throw new Error(`Job ${id} not found`);
  Object.assign(job, updates, { updated_date: new Date().toISOString().slice(0, 10) });
  if (updates.status) {
    job.history = job.history || [];
    job.history.push({ status: updates.status, date: new Date().toISOString().slice(0, 16).replace('T', ' ') });
  }
  const result = await writeFile(env, 'jobs.json', data, sha, `Update: ${job.company} - ${updates.status || 'edit'}`);
  return { job, sha: result.sha };
}

async function deleteJob(env, id) {
  const { data, sha } = await readFile(env, 'jobs.json');
  if (!data) throw new Error('No jobs data');
  data.jobs = data.jobs.filter(j => j.id !== id);
  const result = await writeFile(env, 'jobs.json', data, sha, `Removed job ${id}`);
  return { removed: id, sha: result.sha };
}

async function getProfile(env, profileId) {
  const path = profileId ? `profiles/${profileId}.json` : 'profiles/default.json';
  const { data, sha } = await readFile(env, path);
  return { profile: data, sha };
}

async function saveProfile(env, profileId, profile) {
  const path = profileId ? `profiles/${profileId}.json` : 'profiles/default.json';
  let sha = null;
  try {
    const existing = await readFile(env, path);
    sha = existing.sha;
  } catch (e) { /* file doesn't exist yet */ }
  const result = await writeFile(env, path, profile, sha, `Profile: ${profile.first_name} ${profile.last_name}`);
  return { profile, sha: result.sha };
}

// === MAIN HANDLER (Pages Function) ===
export async function onRequest(context) {
  const { request, env } = context;

  // Handle CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(request, env) });
  }

  const url = new URL(request.url);
  const path = url.pathname;

  try {
    // GET /api/jobs
    if (path === '/api/jobs' && request.method === 'GET') {
      const result = await getJobs(env);
      return json(result, 200, request, env);
    }

    // POST /api/jobs
    if (path === '/api/jobs' && request.method === 'POST') {
      const body = await request.json();
      const result = await addJob(env, body);
      return json(result, 201, request, env);
    }

    // PUT /api/jobs/:id
    const jobMatch = path.match(/^\/api\/jobs\/(\d+)$/);
    if (jobMatch && request.method === 'PUT') {
      const body = await request.json();
      const result = await updateJob(env, parseInt(jobMatch[1]), body);
      return json(result, 200, request, env);
    }

    // DELETE /api/jobs/:id
    if (jobMatch && request.method === 'DELETE') {
      const result = await deleteJob(env, parseInt(jobMatch[1]));
      return json(result, 200, request, env);
    }

    // GET /api/profile/:id?
    const profileMatch = path.match(/^\/api\/profile(?:\/(.+))?$/);
    if (profileMatch && request.method === 'GET') {
      const result = await getProfile(env, profileMatch[1]);
      return json(result, 200, request, env);
    }

    // PUT /api/profile/:id?
    if (profileMatch && request.method === 'PUT') {
      const body = await request.json();
      const result = await saveProfile(env, profileMatch[1], body);
      return json(result, 200, request, env);
    }

    // Health check
    if (path === '/api/health') {
      return json({ status: 'ok', version: '1.0.0', platform: 'cloudflare-pages' }, 200, request, env);
    }

    return json({ error: 'Not found' }, 404, request, env);
  } catch (e) {
    console.error('API error:', e);
    return json({ error: e.message }, 500, request, env);
  }
}
