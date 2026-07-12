// ============================================================
// LeadFyn — shared/ui.js
// Shared UI components used across all 17 pages
// ============================================================


// ─── LEADFYN WHITE THEME INJECTOR ────────────────────────────
// Called once on DOMContentLoaded by every admin page
export function injectLeadFynTheme() {
  if (document.getElementById('lf-theme')) return;
  const s = document.createElement('style');
  s.id = 'lf-theme';
  s.textContent = `
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap');
    :root {
      --dark:    #ffffff !important;
      --dark2:   #f5f5f7 !important;
      --dark3:   #e8e8ed !important;
      --card:    rgba(0,0,0,0.03) !important;
      --glass:   rgba(0,0,0,0.04) !important;
      --border:  rgba(0,0,0,0.08) !important;
      --border2: rgba(0,113,227,0.3) !important;
      --muted:   #6e6e73 !important;
      --text:    #1d1d1f !important;
      --accent:  #0071e3 !important;
      --accent2: #0077ed !important;
      --accent3: #0a84ff !important;
      --green:   #1a7f1a !important;
      --shadow-sm: 0 2px 12px rgba(0,0,0,.06) !important;
      --shadow-md: 0 4px 24px rgba(0,0,0,.08) !important;
      --shadow-xl: 0 8px 40px rgba(0,0,0,.10) !important;
      --glow:    0 0 20px rgba(0,113,227,.12) !important;
      --glow2:   0 0 40px rgba(0,113,227,.08) !important;
    }
    body { font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif !important; background: #f5f5f7 !important; color: #1d1d1f !important; }
    .bg-orbs { display: none !important; }
    .sidebar { background: #ffffff !important; border-right: 1px solid rgba(0,0,0,.08) !important; box-shadow: 2px 0 12px rgba(0,0,0,.04) !important; }
    .sidebar-brand { border-bottom: 1px solid rgba(0,0,0,.08) !important; }
    .brand-name { color: #1d1d1f !important; }
    .brand-badge { background: #0071e3 !important; color: #fff !important; }
    .nav-item { color: #6e6e73 !important; border-radius: 10px !important; }
    .nav-item:hover { background: rgba(0,113,227,.07) !important; color: #0071e3 !important; }
    .nav-item.active { background: rgba(0,113,227,.10) !important; color: #0071e3 !important; font-weight: 700 !important; }
    .sidebar-footer { border-top: 1px solid rgba(0,0,0,.08) !important; }
    .btn-nav-signout { background: rgba(0,0,0,.05) !important; color: #6e6e73 !important; border: 1px solid rgba(0,0,0,.08) !important; border-radius: 8px !important; }
    .btn-nav-signout:hover { background: rgba(239,68,68,.08) !important; color: #dc2626 !important; }
    .page-header { background: #ffffff !important; border-bottom: 1px solid rgba(0,0,0,.07) !important; box-shadow: 0 1px 8px rgba(0,0,0,.04) !important; }
    .stat-card, .card, .panel, [class*="card"], [class*="panel"] { background: #ffffff !important; border: 1px solid rgba(0,0,0,.07) !important; box-shadow: 0 2px 12px rgba(0,0,0,.05) !important; }
    .btn-cta, .btn-primary, [class*="btn-cta"] { background: #0071e3 !important; border-color: #0071e3 !important; }
    .btn-cta:hover, .btn-primary:hover { background: #0077ed !important; }
    .table-wrap, .data-table { background: #ffffff !important; }
    .data-table thead tr { background: #f5f5f7 !important; }
    .data-table th { color: #6e6e73 !important; border-bottom: 1px solid rgba(0,0,0,.08) !important; }
    .data-table td { border-bottom: 1px solid rgba(0,0,0,.05) !important; color: #1d1d1f !important; }
    .data-table tbody tr:hover { background: rgba(0,113,227,.04) !important; }
    input, select, textarea { background: #ffffff !important; border: 1px solid rgba(0,0,0,.12) !important; color: #1d1d1f !important; border-radius: 10px !important; }
    input:focus, select:focus, textarea:focus { border-color: #0071e3 !important; box-shadow: 0 0 0 3px rgba(0,113,227,.12) !important; }
    .af-toast { border-radius: 12px !important; }
    h1, h2, h3, h4 { color: #1d1d1f !important; }
    .section-pill { background: rgba(0,113,227,.08) !important; color: #0071e3 !important; border-color: rgba(0,113,227,.2) !important; }
  `;
  document.head.appendChild(s);
}

// ─── ADMIN NAV ───────────────────────────────────────────────
export function adminNav(activePage = '') {
  const links = [
    { href: '/admin/dashboard.html',        icon: '📊', label: 'Dashboard' },
    { href: '/admin/automations.html', icon: '⚙️', label: 'Automations' },
    { href: '/admin/inboxes.html',     icon: '📮', label: 'Inboxes' },
    { href: '/admin/pipeline.html',         icon: '⚡', label: 'Pipeline' },
    { href: '/admin/leads.html',            icon: '👥', label: 'Leads' },
    { href: '/admin/pipeline-manager.html', icon: '🎯', label: 'Manager' },
    { href: '/admin/outreach-hub.html',     icon: '📡', label: 'Outreach' },
    { href: '/admin/sequences.html',        icon: '📧', label: 'Sequences' },
    { href: '/admin/websites.html',         icon: '🌐', label: 'Websites' },
    { href: '/admin/proposals.html',        icon: '📄', label: 'Proposals' },
    { href: '/admin/chatbot.html',           icon: '🤖', label: 'AI Receptionist' },
    { href: '/admin/calendar.html',         icon: '📅', label: 'Bookings' },
    { href: '/admin/analytics.html',        icon: '📈', label: 'Analytics' },
    { href: '/admin/settings.html',         icon: '⚙️', label: 'Settings' },
    { href: '/admin/credentials.html',      icon: '🔑', label: 'Credentials' },
  ];

  const items = links.map(l => {
    const active = l.label.toLowerCase() === activePage.toLowerCase();
    return `<a href="${l.href}" class="nav-item${active ? ' active' : ''}">
      <span class="nav-icon">${l.icon}</span>
      <span class="nav-label">${l.label}</span>
    </a>`;
  }).join('');

  return `
    <nav class="sidebar" id="sidebar">
      <div class="sidebar-brand">
        <span class="brand-icon">⚡</span>
        <span class="brand-name">LeadFyn</span>
        <span class="brand-badge">Solo</span>
      </div>
      <div class="nav-links">${items}</div>
      <div class="sidebar-footer">
        <button class="btn-nav-signout" onclick="import('/shared/auth.js').then(m=>m.signOut())">
          Sign out
        </button>
      </div>
    </nav>`;
}

// ─── CLIENT NAV (read-only portal) ──────────────────────────
export function clientNav(activePage = '') {
  const links = [
    { href: '/client/dashboard.html',  icon: '📊', label: 'Dashboard' },
    { href: '/client/leads.html',      icon: '👥', label: 'My Leads' },
    { href: '/client/campaigns.html',  icon: '⚡', label: 'Campaigns' },
    { href: '/client/reports.html',    icon: '📈', label: 'Reports' },
    { href: '/client/proposals.html',  icon: '📄', label: 'Proposals' },
    { href: '/client/settings.html',   icon: '⚙️', label: 'Settings' },
  ];

  const items = links.map(l => {
    const active = l.label.toLowerCase() === activePage.toLowerCase();
    return `<a href="${l.href}" class="nav-item${active ? ' active' : ''}">
      <span class="nav-icon">${l.icon}</span>
      <span class="nav-label">${l.label}</span>
    </a>`;
  }).join('');

  return `
    <nav class="sidebar" id="sidebar">
      <div class="sidebar-brand">
        <span class="brand-icon">🤖</span>
        <span class="brand-name">LeadFyn</span>
        <span class="brand-badge">Portal</span>
      </div>
      <div class="nav-links">${items}</div>
      <div class="sidebar-footer">
        <button class="btn-nav-signout" onclick="import('/shared/auth.js').then(m=>m.signOut())">
          Sign out
        </button>
      </div>
    </nav>`;
}

// ─── TOAST ───────────────────────────────────────────────────
// Usage: toast('12 emails sent', 'success')
// Types: success | error | warning | info
let _toastTimer;
export function toast(message, type = 'info', duration = 3500) {
  let el = document.getElementById('af-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'af-toast';
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.className = `af-toast af-toast--${type} af-toast--visible`;
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove('af-toast--visible'), duration);
}

// ─── MODAL ───────────────────────────────────────────────────
// Usage: modal('Confirm Send', '<p>Send 12 emails?</p>', [{label:'Send',action:fn,primary:true},{label:'Cancel',action:closeModal}])
export function modal(title, bodyHTML, buttons = []) {
  closeModal();
  const btns = buttons.map(b =>
    `<button class="btn${b.primary ? ' btn-primary' : ''}" data-modal-btn="${b.label}">${b.label}</button>`
  ).join('');

  const m = document.createElement('div');
  m.id = 'af-modal';
  m.className = 'af-modal';
  m.innerHTML = `
    <div class="af-modal__backdrop" onclick="closeModal()"></div>
    <div class="af-modal__box">
      <div class="af-modal__header">
        <h3 class="af-modal__title">${title}</h3>
        <button class="af-modal__close" onclick="closeModal()">✕</button>
      </div>
      <div class="af-modal__body">${bodyHTML}</div>
      ${btns ? `<div class="af-modal__footer">${btns}</div>` : ''}
    </div>`;

  document.body.appendChild(m);
  requestAnimationFrame(() => m.classList.add('af-modal--open'));

  // Wire button actions
  buttons.forEach(b => {
    m.querySelector(`[data-modal-btn="${b.label}"]`)?.addEventListener('click', b.action);
  });
}

export function closeModal() {
  const m = document.getElementById('af-modal');
  if (m) m.remove();
}
window.closeModal = closeModal;

// ─── DATA TABLE ──────────────────────────────────────────────
// cols: [{key, label, render?}]  rows: array of objects
// Usage: el.innerHTML = dataTable(cols, rows, {emptyMsg, onRowClick})
export function dataTable(cols, rows, opts = {}) {
  const {
    emptyMsg = 'No data yet.',
    onRowClick = null,
    colCount = cols.length
  } = opts;

  const heads = cols.map(c => `<th>${c.label}</th>`).join('');
  const empty = `<tr><td colspan="${colCount}" class="table-empty">${emptyMsg}</td></tr>`;

  const bodyRows = rows.length === 0 ? empty : rows.map((row, i) => {
    const cells = cols.map(c => {
      const val = c.render ? c.render(row[c.key], row) : (row[c.key] ?? '—');
      return `<td>${val}</td>`;
    }).join('');
    const click = onRowClick ? ` style="cursor:pointer" onclick="(${onRowClick})(${i})"` : '';
    return `<tr${click}>${cells}</tr>`;
  }).join('');

  return `
    <div class="table-wrap">
      <table class="data-table">
        <thead><tr>${heads}</tr></thead>
        <tbody>${bodyRows}</tbody>
      </table>
    </div>`;
}

// ─── PIPELINE PROGRESS ───────────────────────────────────────
// stage: 'new'|'contacted'|'replied'|'interested'|'discovery_call'|'proposal_sent'|'negotiation'|'won'|'lost'
const STAGES = ['new','contacted','replied','interested','discovery_call','proposal_sent','negotiation','won','lost'];
const STAGE_LABELS = {
  new:'New', contacted:'Contacted', replied:'Replied', interested:'Interested',
  discovery_call:'Discovery Call', proposal_sent:'Proposal Sent',
  negotiation:'Negotiation', won:'Won', lost:'Lost'
};

export function pipelineProgress(currentStage) {
  const idx = STAGES.indexOf(currentStage);
  const steps = STAGES.map((s, i) => {
    const cls = i < idx ? 'done' : i === idx ? 'active' : '';
    return `<div class="pipe-step ${cls}" title="${STAGE_LABELS[s]}">
      <div class="pipe-dot"></div>
      <span class="pipe-label">${STAGE_LABELS[s]}</span>
    </div>`;
  }).join('<div class="pipe-line"></div>');

  return `<div class="pipeline-progress">${steps}</div>`;
}

// ─── CHANNEL BADGE ───────────────────────────────────────────
// channels: array of {channel: 'email'|'whatsapp'|..., verified: bool}
// Shows all 10 channels, grey if not found, colored if found
const CHANNEL_META = {
  email:        { icon: '✉️',  label: 'Email',        color: '#10b981' },
  whatsapp:     { icon: '💬',  label: 'WhatsApp',     color: '#25d366' },
  sms:          { icon: '📱',  label: 'SMS',           color: '#3b82f6' },
  phone:        { icon: '📞',  label: 'Phone',         color: '#6366f1' },
  facebook:     { icon: '📘',  label: 'Facebook',      color: '#1877f2' },
  instagram:    { icon: '📷',  label: 'Instagram',     color: '#e1306c' },
  yelp:         { icon: '⭐',  label: 'Yelp',          color: '#d32323' },
  linkedin:     { icon: '💼',  label: 'LinkedIn',      color: '#0a66c2' },
  contact_form: { icon: '🌐',  label: 'Contact Form',  color: '#8b5cf6' },
  direct_mail:  { icon: '📮',  label: 'Direct Mail',   color: '#f59e0b' }, // paid — gold
};

export function channelBadge(foundChannels = []) {
  const foundSet = new Set(foundChannels.map(c => c.channel ?? c));

  return Object.entries(CHANNEL_META).map(([key, meta]) => {
    const found = foundSet.has(key);
    const style = found ? `background:${meta.color};color:#fff;border-color:${meta.color}` : '';
    const cls = found ? 'ch-badge ch-badge--found' : 'ch-badge ch-badge--missing';
    return `<span class="${cls}" style="${style}" title="${meta.label}">${meta.icon}</span>`;
  }).join('');
}

// ─── NODE PROGRESS (pipeline run live view) ──────────────────
const NODE_META = {
  'Discovering':   { icon: '🔍', label: 'Phase 1 — Discovering'   },
  'Investigating': { icon: '🌐', label: 'Phase 2 — Investigating'  },
  'Scoring':       { icon: '🎯', label: 'Phase 2 — Scoring Leads'  },
  'Emailing':      { icon: '✉️',  label: 'Phase 4 — Writing Emails' },
  'Scheduling':    { icon: '📅', label: 'Phase 3 — Scheduling'     },
  'Learning':      { icon: '🧠', label: 'Phase 5 — Niche Memory'   },
  'paused_approval':{ icon: '✋', label: 'Awaiting Your Review'    }
};
const NODE_ORDER = ['Discovering','Investigating','Scoring','Emailing','Scheduling','Learning','paused_approval'];

export function nodeProgress(currentNode, status = 'running') {
  // Normalise unknown node names — map anything not in NODE_ORDER to 'Discovering'
  const activeNode = NODE_ORDER.includes(currentNode) ? currentNode : (status === 'completed' ? 'paused_approval' : 'Discovering');
  return NODE_ORDER.map(name => {
    const idx     = NODE_ORDER.indexOf(name);
    const curIdx  = NODE_ORDER.indexOf(activeNode);
    const done    = idx < curIdx || status === 'completed';
    const active  = name === activeNode && status === 'running';
    const cls     = done ? 'node--done' : active ? 'node--active' : 'node--pending';
    const spinner = active ? '<span class="node-spinner"></span>' : '';
    const meta    = NODE_META[name] ?? { icon: '⚙️', label: name };
    return `<div class="pipeline-node ${cls}" title="${meta.label}">
      ${spinner}<span style="margin-right:5px">${meta.icon}</span><span class="node-name">${meta.label}</span>
    </div>`;
  }).join('');
}

// ─── STAT CARD ───────────────────────────────────────────────
export function statCard(label, value, sub = '', icon = '') {
  return `<div class="stat-card">
    <div class="stat-icon">${icon}</div>
    <div class="stat-value">${value}</div>
    <div class="stat-label">${label}</div>
    ${sub ? `<div class="stat-sub">${sub}</div>` : ''}
  </div>`;
}

// ─── PRIORITY BADGE (P1–P5 AI recommendations, Twin pattern) ─
export function priorityBadge(level) {
  const colors = { P1:'#ef4444', P2:'#f59e0b', P3:'#3b82f6', P4:'#8b5cf6', P5:'#6b7280' };
  const c = colors[level] ?? colors.P5;
  return `<span class="priority-badge" style="background:${c}">${level}</span>`;
}

// ─── REPLY CLASSIFICATION BADGE ──────────────────────────────
export function classificationBadge(cls) {
  const map = {
    INTERESTED:     { color:'#10b981', label:'Interested' },
    QUESTION:       { color:'#3b82f6', label:'Question' },
    OBJECTION:      { color:'#f59e0b', label:'Objection' },
    NOT_INTERESTED: { color:'#ef4444', label:'Not Interested' },
    OUT_OF_OFFICE:  { color:'#8b5cf6', label:'Out of Office' },
    UNSUBSCRIBE:    { color:'#6b7280', label:'Unsubscribe' },
  };
  const m = map[cls] ?? { color:'#6b7280', label: cls };
  return `<span class="cls-badge" style="background:${m.color};color:#fff">${m.label}</span>`;
}

// ─── SKELETON LOADER ─────────────────────────────────────────
export function skeleton(lines = 4) {
  return Array(lines).fill(0).map(() =>
    `<div class="skeleton-line"></div>`
  ).join('');
}

// ─── PAGE LOADER BAR (NProgress-style thin top bar) ─────────
// Call startLoader() at top of page, stopLoader() when data is painted.
export function startLoader() {
  let bar = document.getElementById('af-loader');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'af-loader';
    bar.style.cssText = `
      position:fixed;top:0;left:0;height:3px;width:0%;z-index:99999;
      background:linear-gradient(90deg,#4f46e5,#818cf8);
      transition:width .25s ease,opacity .4s ease;pointer-events:none;
    `;
    document.body.appendChild(bar);
  }
  bar.style.opacity = '1';
  bar.style.width   = '30%';
  setTimeout(() => { bar.style.width = '70%'; }, 200);
  setTimeout(() => { bar.style.width = '85%'; }, 600);
}
export function stopLoader() {
  const bar = document.getElementById('af-loader');
  if (!bar) return;
  bar.style.width   = '100%';
  setTimeout(() => { bar.style.opacity = '0'; bar.style.width = '0%'; }, 300);
}

// ─── SHARED CSS (inject once into <head>) ────────────────────
export function injectSharedCSS() {
  if (document.getElementById('af-shared-css')) return;

  // Preconnect to Supabase — establishes TCP before any fetch fires
  if (!document.querySelector('link[rel="preconnect"][href*="supabase"]')) {
    ['https://ndwvsrtyjnaddrifafqk.supabase.co',
     'https://cdn.jsdelivr.net'].forEach(href => {
      const l = document.createElement('link');
      l.rel = 'preconnect'; l.href = href; l.crossOrigin = '';
      document.head.appendChild(l);
    });
  }

  startLoader();
  const style = document.createElement('style');
  style.id = 'af-shared-css';
  style.textContent = `
    /* ── Layout ── */
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --color-primary:     #1a1a2e;
      --color-accent:      #4f46e5;
      --color-success:     #10b981;
      --color-warning:     #f59e0b;
      --color-danger:      #ef4444;
      --color-bg:          #ffffff;
      --color-surface:     #f8fafc;
      --color-border:      #e2e8f0;
      --color-text:        #0f172a;
      --color-text-muted:  #64748b;
      --radius:            8px;
      --shadow:            0 1px 3px rgba(0,0,0,.1);
      --shadow-md:         0 4px 12px rgba(0,0,0,.1);
    }
    [data-theme="dark"] {
      --color-bg:          #060614;
      --color-surface:     #0d0d2b;
      --color-border:      rgba(255,255,255,0.09);
      --color-text:        #f1f5f9;
      --color-text-muted:  #94a3b8;
      --color-accent:      #6366f1;
      --shadow:            0 2px 8px rgba(0,0,0,.5);
      --shadow-md:         0 8px 32px rgba(0,0,0,.55);
    }
    [data-theme="dark"] body {
      background: #060614 !important;
      background-image:
        radial-gradient(ellipse 60% 50% at 20% -10%, rgba(99,102,241,.10), transparent),
        radial-gradient(ellipse 40% 40% at 80% 90%, rgba(139,92,246,.07), transparent) !important;
      background-attachment: fixed !important;
    }
    [data-theme="dark"] .sidebar {
      background: rgba(4,4,18,0.96) !important;
      border-right: 1px solid rgba(255,255,255,.08);
      backdrop-filter: blur(20px);
      box-shadow: 4px 0 24px rgba(0,0,0,.5);
    }
    [data-theme="dark"] .sidebar-brand { border-bottom-color: rgba(255,255,255,.08) !important; }
    [data-theme="dark"] .brand-icon { font-size: 22px; filter: drop-shadow(0 0 8px rgba(99,102,241,.5)); }
    [data-theme="dark"] .nav-item { color: rgba(255,255,255,.6) !important; }
    [data-theme="dark"] .nav-item:hover { background: rgba(255,255,255,.05) !important; color: #fff !important; }
    [data-theme="dark"] .nav-item.active {
      background: rgba(99,102,241,.15) !important; border-left-color: #6366f1 !important; color: #fff !important;
    }
    [data-theme="dark"] .btn-nav-signout { background: rgba(255,255,255,.06) !important; color: rgba(255,255,255,.6) !important; }
    [data-theme="dark"] .btn-nav-signout:hover { background: rgba(255,255,255,.12) !important; color: #fff !important; }
    [data-theme="dark"] .page-title { font-weight: 900 !important; color: #f1f5f9; }
    [data-theme="dark"] .page-sub   { color: #64748b; }
    [data-theme="dark"] .stat-card {
      background: rgba(255,255,255,.04) !important;
      border: 1px solid rgba(255,255,255,.09) !important;
      border-radius: 14px !important; backdrop-filter: blur(16px);
      box-shadow: 0 8px 32px rgba(0,0,0,.55), inset 0 1px 0 rgba(255,255,255,.07) !important;
      transform: perspective(600px) rotateX(3deg);
      transition: transform .3s ease, box-shadow .3s ease, border-color .3s !important;
      position: relative; overflow: hidden;
    }
    [data-theme="dark"] .stat-card::before {
      content: ''; position: absolute; top: 0; left: 0; right: 0; height: 1px;
      background: linear-gradient(90deg, transparent, rgba(99,102,241,.5), transparent);
    }
    [data-theme="dark"] .stat-card:hover {
      transform: perspective(600px) rotateX(0deg) translateY(-6px) !important;
      box-shadow: 0 8px 32px rgba(0,0,0,.55), 0 0 40px rgba(99,102,241,.2), inset 0 1px 0 rgba(255,255,255,.12) !important;
      border-color: rgba(99,102,241,.35) !important;
    }
    [data-theme="dark"] .stat-value {
      font-size: 30px !important; font-weight: 900 !important;
      background: linear-gradient(135deg, #fff, #818cf8);
      -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;
    }
    [data-theme="dark"] .stat-icon  { filter: drop-shadow(0 2px 6px rgba(99,102,241,.35)); }
    [data-theme="dark"] .stat-label { color: #94a3b8 !important; }
    [data-theme="dark"] .stat-sub   { color: #818cf8 !important; font-weight: 600 !important; }
    [data-theme="dark"] .card {
      background: rgba(255,255,255,.04) !important;
      border: 1px solid rgba(255,255,255,.09) !important;
      border-radius: 14px !important; backdrop-filter: blur(16px);
      box-shadow: 0 8px 32px rgba(0,0,0,.5), inset 0 1px 0 rgba(255,255,255,.05) !important;
      transition: box-shadow .3s, border-color .3s;
    }
    [data-theme="dark"] .card:hover { border-color: rgba(99,102,241,.3) !important; }
    [data-theme="dark"] .card-title {
      color: #f1f5f9 !important; font-weight: 700 !important;
      padding-bottom: 12px; border-bottom: 1px solid rgba(255,255,255,.09); margin-bottom: 16px !important;
    }
    [data-theme="dark"] .data-table th {
      background: rgba(255,255,255,.03) !important; border-bottom-color: rgba(255,255,255,.09) !important; color: #64748b !important;
    }
    [data-theme="dark"] .data-table td { border-bottom-color: rgba(255,255,255,.06) !important; }
    [data-theme="dark"] .data-table tr:hover td { background: rgba(99,102,241,.05) !important; }
    [data-theme="dark"] .table-empty { color: #64748b !important; }
    [data-theme="dark"] .btn {
      background: rgba(255,255,255,.06) !important; border-color: rgba(255,255,255,.12) !important; color: #f1f5f9 !important;
    }
    [data-theme="dark"] .btn:hover { background: rgba(255,255,255,.1) !important; }
    [data-theme="dark"] .btn-primary { background: #6366f1 !important; border-color: #6366f1 !important; color: #fff !important; }
    [data-theme="dark"] .btn-primary:hover { background: #4f46e5 !important; }
    [data-theme="dark"] .skeleton-line {
      background: linear-gradient(90deg, rgba(255,255,255,.04) 25%, rgba(255,255,255,.08) 50%, rgba(255,255,255,.04) 75%) !important;
      background-size: 200% 100% !important; animation: af-shimmer 1.5s infinite !important;
    }
    @keyframes af-shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }
    [data-theme="dark"] .af-modal__box {
      background: #0d0d2b !important; border: 1px solid rgba(255,255,255,.1);
      box-shadow: 0 24px 80px rgba(0,0,0,.7);
    }
    [data-theme="dark"] .pipeline-node { background: rgba(255,255,255,.04) !important; }
    [data-theme="dark"] .pipeline-node.node--active { background: rgba(99,102,241,.12) !important; color: #818cf8 !important; }
    [data-theme="dark"] #af-loader { background: linear-gradient(90deg, #6366f1, #a78bfa) !important; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
           background: var(--color-bg); color: var(--color-text); display: flex; min-height: 100vh; margin: 0; }
    #app  { display: flex; flex: 1; min-height: 100vh; }
    /* ── Sidebar ── */
    .sidebar { width: 220px; min-height: 100vh; background: var(--color-primary);
               color: #fff; display: flex; flex-direction: column; flex-shrink: 0; }
    .sidebar-brand { display: flex; align-items: center; gap: 8px; padding: 20px 16px;
                     border-bottom: 1px solid rgba(255,255,255,.1); font-weight: 700; font-size: 16px; }
    .brand-badge { font-size: 10px; background: var(--color-accent); padding: 2px 6px;
                   border-radius: 10px; font-weight: 600; }
    .nav-links { flex: 1; padding: 12px 0; overflow-y: auto; }
    .nav-item { display: flex; align-items: center; gap: 10px; padding: 10px 16px;
                color: rgba(255,255,255,.7); text-decoration: none; font-size: 14px;
                transition: all .15s; border-left: 3px solid transparent; }
    .nav-item:hover { background: rgba(255,255,255,.08); color: #fff; }
    .nav-item.active { background: rgba(255,255,255,.12); color: #fff;
                       border-left-color: var(--color-accent); }
    .sidebar-footer { padding: 16px; border-top: 1px solid rgba(255,255,255,.1); }
    .btn-nav-signout { width: 100%; padding: 8px; background: rgba(255,255,255,.08);
                       color: rgba(255,255,255,.7); border: none; border-radius: var(--radius);
                       cursor: pointer; font-size: 13px; }
    .btn-nav-signout:hover { background: rgba(255,255,255,.15); color: #fff; }
    /* ── Main content ── */
    .main { flex: 1; min-height: 100vh; overflow-x: hidden; }
    .page-header { padding: 24px 32px 0; }
    .page-title { font-size: 22px; font-weight: 700; }
    .page-sub { color: var(--color-text-muted); font-size: 14px; margin-top: 4px; }
    .page-body { padding: 24px 32px; }
    /* ── Cards ── */
    .card { background: var(--color-surface); border: 1px solid var(--color-border);
            border-radius: var(--radius); padding: 20px; box-shadow: var(--shadow); }
    .card-title { font-size: 15px; font-weight: 600; margin-bottom: 16px; }
    /* ── Buttons ── */
    .btn { padding: 8px 16px; border-radius: var(--radius); border: 1px solid var(--color-border);
           cursor: pointer; font-size: 14px; font-weight: 500; background: var(--color-surface);
           color: var(--color-text); transition: all .15s; }
    .btn:hover { background: var(--color-border); }
    .btn-primary { background: var(--color-accent); color: #fff; border-color: var(--color-accent); }
    .btn-primary:hover { opacity: .9; }
    .btn-success { background: var(--color-success); color: #fff; border-color: var(--color-success); }
    .btn-danger  { background: var(--color-danger);  color: #fff; border-color: var(--color-danger);  }
    .btn-navy    { background: var(--color-primary);  color: #fff; border-color: var(--color-primary); }
    .btn-navy:hover { opacity: .85; }
    /* ── Table ── */
    .table-wrap { overflow-x: auto; }
    .data-table { width: 100%; border-collapse: collapse; font-size: 14px; }
    .data-table th { background: var(--color-surface); padding: 10px 12px; text-align: left;
                     font-weight: 600; font-size: 12px; color: var(--color-text-muted);
                     border-bottom: 2px solid var(--color-border); white-space: nowrap; }
    .data-table td { padding: 12px; border-bottom: 1px solid var(--color-border); vertical-align: middle; }
    .data-table tr:hover td { background: var(--color-surface); }
    .table-empty { text-align: center; color: var(--color-text-muted); padding: 40px; }
    /* ── Toast ── */
    .af-toast { position: fixed; bottom: 24px; right: 24px; padding: 12px 20px;
                border-radius: var(--radius); font-size: 14px; font-weight: 500;
                box-shadow: var(--shadow-md); opacity: 0; transform: translateY(8px);
                transition: all .2s; pointer-events: none; z-index: 9999; max-width: 360px; }
    .af-toast--visible { opacity: 1; transform: translateY(0); }
    .af-toast--success { background: var(--color-success); color: #fff; }
    .af-toast--error   { background: var(--color-danger);  color: #fff; }
    .af-toast--warning { background: var(--color-warning); color: #fff; }
    .af-toast--info    { background: var(--color-primary); color: #fff; }
    /* ── Modal ── */
    .af-modal { position: fixed; inset: 0; z-index: 1000; display: flex;
                align-items: center; justify-content: center; opacity: 0; transition: opacity .2s; }
    .af-modal--open { opacity: 1; }
    .af-modal__backdrop { position: absolute; inset: 0; background: rgba(0,0,0,.5); }
    .af-modal__box { position: relative; background: var(--color-bg); border-radius: var(--radius);
                     padding: 24px; width: 480px; max-width: 90vw; box-shadow: var(--shadow-md); }
    .af-modal__header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
    .af-modal__title { font-size: 17px; font-weight: 700; }
    .af-modal__close { background: none; border: none; cursor: pointer; font-size: 18px;
                       color: var(--color-text-muted); }
    .af-modal__footer { display: flex; gap: 8px; justify-content: flex-end; margin-top: 20px; }
    /* ── Pipeline progress (9-stage) ── */
    .pipeline-progress { display: flex; align-items: center; overflow-x: auto; padding: 8px 0; }
    .pipe-step { display: flex; flex-direction: column; align-items: center; gap: 4px; flex-shrink: 0; }
    .pipe-dot  { width: 12px; height: 12px; border-radius: 50%; background: var(--color-border); }
    .pipe-step.done .pipe-dot   { background: var(--color-success); }
    .pipe-step.active .pipe-dot { background: var(--color-accent); box-shadow: 0 0 0 4px rgba(79,70,229,.2); }
    .pipe-label { font-size: 11px; color: var(--color-text-muted); white-space: nowrap; }
    .pipe-line  { flex: 1; height: 2px; background: var(--color-border); min-width: 20px; }
    /* ── Channel badges ── */
    .ch-badge { display: inline-flex; align-items: center; justify-content: center;
                width: 28px; height: 28px; border-radius: 6px; font-size: 14px;
                border: 1px solid var(--color-border); margin: 1px; cursor: default; }
    .ch-badge--missing { opacity: .3; filter: grayscale(1); }
    /* ── Node progress ── */
    .pipeline-node { display: flex; align-items: center; gap: 6px; padding: 6px 10px;
                     border-radius: var(--radius); font-size: 13px; margin: 2px 0;
                     background: var(--color-surface); }
    .pipeline-node.node--done   { color: var(--color-success); }
    .pipeline-node.node--active { background: rgba(79,70,229,.1); color: var(--color-accent); font-weight: 600; }
    .pipeline-node.node--pending{ color: var(--color-text-muted); }
    .node-spinner { width: 12px; height: 12px; border: 2px solid var(--color-accent);
                    border-top-color: transparent; border-radius: 50%; animation: spin .7s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    /* ── Stat cards ── */
    .stat-card { background: var(--color-surface); border: 1px solid var(--color-border);
                 border-radius: var(--radius); padding: 20px; text-align: center; }
    .stat-icon  { font-size: 24px; margin-bottom: 8px; }
    .stat-value { font-size: 28px; font-weight: 700; }
    .stat-label { font-size: 13px; color: var(--color-text-muted); margin-top: 4px; }
    .stat-sub   { font-size: 12px; color: var(--color-text-muted); margin-top: 2px; }
    /* ── Badges ── */
    .priority-badge { display: inline-block; padding: 2px 8px; border-radius: 10px;
                      color: #fff; font-size: 11px; font-weight: 700; }
    .cls-badge { display: inline-block; padding: 3px 10px; border-radius: 10px;
                 font-size: 12px; font-weight: 600; }
    /* ── Skeleton ── */
    .skeleton-line { height: 14px; background: var(--color-border); border-radius: 4px;
                     margin: 10px 0; animation: pulse 1.5s ease-in-out infinite; }
    @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.5} }
    /* ── Stats grid ── */
    .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 16px; }
    /* ── Page fade-in ── */
    #app { animation: af-fade .18s ease; }
    @keyframes af-fade { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
  `;
  document.head.appendChild(style);

  // Stop loader once #app content is injected (MutationObserver)
  const obs = new MutationObserver(() => {
    const app = document.getElementById('app');
    if (app && app.children.length > 0) { stopLoader(); obs.disconnect(); }
  });
  obs.observe(document.getElementById('app') || document.body, { childList: true, subtree: true });
  // Fallback: always stop after 4s
  setTimeout(stopLoader, 4000);
}
