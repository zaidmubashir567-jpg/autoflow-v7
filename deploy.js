/**
 * AutoFlow v7 — One-Click Deploy to Vercel + GitHub
 * Run: node deploy.js
 * Needs: VERCEL_TOKEN and GITHUB_TOKEN set as env vars
 */
const https = require('https');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const VERCEL_TOKEN = process.env.VERCEL_TOKEN;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_USER  = 'zaidmubashir567-jpg';
const REPO_NAME    = 'autoflow-v7';
const PROJECT_DIR  = __dirname;

// ── helpers ────────────────────────────────────────────────────
function api(hostname, path, method, token, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = https.request({
      hostname, path, method,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'User-Agent': 'autoflow-deploy',
        ...(data ? {'Content-Length': Buffer.byteLength(data)} : {})
      }
    }, res => {
      let out = '';
      res.on('data', c => out += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(out) }); }
        catch { resolve({ status: res.statusCode, body: out }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function walk(dir, base, skip = new Set(['.git','supabase','node_modules'])) {
  const out = [];
  for (const e of fs.readdirSync(dir, {withFileTypes:true})) {
    if (e.isDirectory()) {
      if (!skip.has(e.name)) walk(path.join(dir,e.name), base, skip).forEach(x=>out.push(x));
    } else {
      const rel = path.relative(base, path.join(dir,e.name)).replace(/\\/g,'/');
      if (!['deploy.js','DEPLOY.md','DEPLOY_NOW.bat','.gitignore'].includes(e.name))
        out.push(rel);
    }
  }
  return out;
}

// ── Step 1: Vercel ─────────────────────────────────────────────
async function deployVercel() {
  if (!VERCEL_TOKEN) { console.log('⚠  No VERCEL_TOKEN — skipping Vercel'); return; }
  console.log('\n[1/2] Deploying to Vercel...');

  const files = walk(PROJECT_DIR, PROJECT_DIR).map(rel => ({
    file: rel,
    data: fs.readFileSync(path.join(PROJECT_DIR, rel)).toString('base64'),
    encoding: 'base64'
  }));
  console.log(`    Uploading ${files.length} files...`);

  const res = await api('api.vercel.com', '/v13/deployments', 'POST', VERCEL_TOKEN, {
    name: REPO_NAME,
    files,
    projectSettings: { framework: null },
    target: 'production'
  });

  if (res.status === 200 || res.status === 201) {
    const url = res.body.url || res.body.alias?.[0];
    console.log(`✅  Vercel deployed! https://${url}`);
    return url;
  } else {
    console.error('❌  Vercel error:', JSON.stringify(res.body).slice(0,300));
  }
}

// ── Step 2: GitHub ─────────────────────────────────────────────
async function deployGitHub() {
  if (!GITHUB_TOKEN) { console.log('⚠  No GITHUB_TOKEN — skipping GitHub'); return; }
  console.log('\n[2/2] Pushing to GitHub...');

  // Create repo (ignore if already exists)
  const create = await api('api.github.com', '/user/repos', 'POST', GITHUB_TOKEN, {
    name: REPO_NAME, description: 'AutoFlow v7 — AI lead-gen SaaS',
    private: true, auto_init: false
  });
  if (create.status === 201) console.log('    Repo created.');
  else if (create.status === 422) console.log('    Repo already exists, continuing.');
  else { console.error('❌  GitHub create error:', JSON.stringify(create.body).slice(0,200)); return; }

  // Git push using CLI with token auth
  const authUrl = `https://${GITHUB_USER}:${GITHUB_TOKEN}@github.com/${GITHUB_USER}/${REPO_NAME}.git`;
  try {
    execSync('git init', { cwd: PROJECT_DIR, stdio:'pipe' });
    execSync('git config user.email "zaidmubashir567@gmail.com"', { cwd: PROJECT_DIR, stdio:'pipe' });
    execSync('git config user.name "Zaid Mubashir"', { cwd: PROJECT_DIR, stdio:'pipe' });
    execSync('git branch -M main', { cwd: PROJECT_DIR, stdio:'pipe' });
    execSync('git add -A', { cwd: PROJECT_DIR, stdio:'pipe' });
    try { execSync('git commit -m "AutoFlow v7 — deploy"', { cwd: PROJECT_DIR, stdio:'pipe' }); }
    catch(e) { /* already committed */ }
    execSync(`git remote remove origin`, { cwd: PROJECT_DIR, stdio:'pipe' }).toString();
  } catch(e) {}
  try {
    execSync(`git remote add origin ${authUrl}`, { cwd: PROJECT_DIR, stdio:'pipe' });
    execSync('git push -u origin main --force', { cwd: PROJECT_DIR, stdio:'pipe' });
    console.log(`✅  Pushed to https://github.com/${GITHUB_USER}/${REPO_NAME}`);
  } catch(e) {
    console.error('❌  Git push failed:', e.message.slice(0,200));
  }
}

// ── Main ───────────────────────────────────────────────────────
(async () => {
  console.log('=== AutoFlow v7 Deploy ===');
  if (!VERCEL_TOKEN && !GITHUB_TOKEN) {
    console.log(`
Set tokens first, then run: node deploy.js

  PowerShell:
    $env:VERCEL_TOKEN = "vcp_..."   (from https://vercel.com/account/settings/tokens)
    $env:GITHUB_TOKEN = "ghp_..."   (from https://github.com/settings/tokens)
    node deploy.js
`);
    process.exit(1);
  }
  await deployVercel();
  await deployGitHub();
  console.log('\n=== Done ===');
})();
