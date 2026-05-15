const { execFileSync } = require('child_process');
const fs = require('fs');

const REPO = 'C:\\Users\\SC\\Desktop\\main ff\\autoflow_v7';
const GIT  = 'D:\\Git\\cmd\\git.exe';

const run = (args, label) => {
  try {
    const out = execFileSync(GIT, args, { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    console.log('OK ' + label + (out.trim() ? ':\n' + out.trim() : ''));
    return true;
  } catch (e) {
    console.log('FAIL ' + label + ':\n' + (e.stderr || e.message || '').trim());
    return false;
  }
};

const lock = REPO + '\\.git\\index.lock';
if (fs.existsSync(lock)) { fs.unlinkSync(lock); console.log('Removed lock'); }

run(['config', 'user.email', 'zaidmubashir567@gmail.com'], 'config email');
run(['config', 'user.name', 'Zaid Mubashir'], 'config name');
run(['add', '-A'], 'add -A');
run(['commit', '-m', 'feat: All 5 phases — DuckDuckGo, intent scoring, follow-ups, mini-audit, niche memory'], 'commit');
run(['push', 'origin', 'main'], 'push') ? console.log('\nPUSHED — Vercel redeploys now!') : console.log('\nPush failed');
