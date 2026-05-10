// ============================================================
// AutoFlow v7 — shared/ui.js
// Shared UI components used across all 17 pages
// ============================================================

// ─── ADMIN NAV ───────────────────────────────────────────────
export function adminNav(activePage = '') {
  const links = [
    { href: '/admin/dashboard.html',        icon: '📊', label: 'Dashboard' },
    { href: '/admin/pipeline.html',         icon: '⚡', label: 'Pipeline' },
    { href: '/admin/leads.html',            icon: '👥', label: 'Leads' },
    { href: '/admin/pipeline-manager.html', icon: '🎯', label: 'Manager' },
    { href: '/admin/outreach-hub.html',     icon: '📡', label: 'Outreach' },
    { href: '/admin/clients.html',          icon: '🏢', label: 'Clients' },
    { href: '/admin/sequences.html',        icon: '📧', label: 'Sequences' },
    { href: '/admin/websites.html',         icon: '🌐', label: 'Websites' },
    { href: '/admin/proposals.html',        icon: '📄', label: 'Proposals' },
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
        <span class="brand-icon">🤖</span>
        <span class="brand-name">AutoFlow</span>
        <span class="brand-badge">v7</span>
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
        <span class="brand-name">AutoFlow</span>
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
const NODE_ORDER = ['Victor','Maya','Marcus','Filter','Sofia','Aria','James','Leo','Email Hunter','Deploy','Elena','Priya','Raj','Theo'];

export function nodeProgress(currentNode, status = 'running') {
  return NODE_ORDER.map(name => {
    const idx     = NODE_ORDER.indexOf(name);
    const curIdx  = NODE_ORDER.indexOf(currentNode);
    const done    = idx < curIdx || status === 'completed';
    const active  = name === currentNode && status === 'running';
    const cls     = done ? 'node--done' : active ? 'node--active' : 'node--pending';
    const spinner = active ? '<span class="node-spinner"></span>' : '';
    return `<div class="pipeline-node ${cls}">
      ${spinner}<span class="node-name">${name}</span>
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

// ─── SHARED CSS (inject once into <head>) ────────────────────
export function injectSharedCSS() {
  if (document.getElementById('af-shared-css')) return;
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
      --color-bg:          #0f172a;
      --color-surface:     #1e293b;
      --color-border:      #334155;
      --color-text:        #f1f5f9;
      --color-text-muted:  #94a3b8;
    }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
           background: var(--color-bg); color: var(--color-text); display: flex; }
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
  `;
  document.head.appendChild(style);
}
