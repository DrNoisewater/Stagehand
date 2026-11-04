/** DOM helpers, icons, menus, modals and toasts. */

const ICONS = {
  play: '<path d="M7 4.8v14.4c0 .8.9 1.3 1.6.9l11.3-7.2c.6-.4.6-1.4 0-1.8L8.6 3.9C7.9 3.5 7 4 7 4.8z"/>',
  pause: '<rect x="6" y="4.5" width="4.2" height="15" rx="1.2"/><rect x="13.8" y="4.5" width="4.2" height="15" rx="1.2"/>',
  prev: '<path d="M18.5 5.3v13.4c0 .8-.9 1.2-1.5.8L8 13.2v5.3H5.5v-13H8v5.3l9-6.3c.6-.4 1.5 0 1.5.8z"/>',
  next: '<path d="M5.5 5.3v13.4c0 .8.9 1.2 1.5.8l9-6.3v5.3h2.5v-13H16v5.3L7 4.5c-.6-.4-1.5 0-1.5.8z"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>',
  list: '<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
  grid: '<rect x="4" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5"/>',
  star: '<path d="M12 3.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z"/>',
  heart: '<path d="M12 20s-7.5-4.6-7.5-10.1A4.4 4.4 0 0 1 12 7.2a4.4 4.4 0 0 1 7.5 2.7C19.5 15.4 12 20 12 20z"/>',
  folder: '<path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2.5h7a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>',
  folderPlus: '<path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2.5h7a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/><path d="M12 11v5M9.5 13.5h5"/>',
  sliders: '<path d="M5 4v6M5 14v6M12 4v3M12 11v9M19 4v9M19 17v3"/><circle cx="5" cy="12" r="2"/><circle cx="12" cy="9" r="2"/><circle cx="19" cy="15" r="2"/>',
  more: '<circle cx="5.5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="18.5" cy="12" r="1.3"/>',
  edit: '<path d="M15.5 5.5l3 3L8.8 18.2l-3.8.8.8-3.8z"/><path d="M13.5 7.5l3 3"/>',
  loop: '<path d="M17 4l3 3-3 3"/><path d="M4 12v-1a4 4 0 0 1 4-4h12"/><path d="M7 20l-3-3 3-3"/><path d="M20 12v1a4 4 0 0 1-4 4H4"/>',
  volume: '<path d="M4 9.5v5h3.5l4.5 4v-13l-4.5 4z"/><path d="M15.5 9a4.2 4.2 0 0 1 0 6M18 6.5a7.8 7.8 0 0 1 0 11"/>',
  volumeOff: '<path d="M4 9.5v5h3.5l4.5 4v-13l-4.5 4z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/>',
  music: '<path d="M9 18V6l11-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>',
  split: '<path d="M4 18V12M8 18V6M12 18v-9M16 18v-4M20 18V9"/>',
  clock: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l2.5 2"/>',
  history: '<path d="M4 12a8 8 0 1 0 2.4-5.7L4 8.6"/><path d="M4 4.5v4.1h4.1M12 8v4l2.5 2"/>',
  library: '<path d="M5 4.5v15M9.5 4.5v15M14 5l4.5 14"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  trash: '<path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12"/>',
  external: '<path d="M14 5h5v5M19 5l-8 8"/><path d="M17 14v4a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 5 18V8.5A1.5 1.5 0 0 1 6.5 7H10"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  alert: '<path d="M12 4l9 15.5H3z"/><path d="M12 10v4M12 17h.01"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8h.01"/>',
  chevron: '<path d="M6 9l6 6 6-6"/>',
  chevronRight: '<path d="M9 6l6 6-6 6"/>',
  chevronLeft: '<path d="M15 6l-6 6 6 6"/>',
  download: '<path d="M12 4.5v10M7.5 10.5l4.5 4.5 4.5-4.5"/><path d="M5 19.5h14"/>',
  globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.4 2.5 3.5 5.3 3.5 8.5s-1.1 6-3.5 8.5c-2.4-2.5-3.5-5.3-3.5-8.5s1.1-6 3.5-8.5z"/>',
  pie: '<path d="M11 4.6A7.5 7.5 0 1 0 19.4 13H11z"/><path d="M14 3.6a7.5 7.5 0 0 1 6.4 6.4H14z"/>',
  amp: '<rect x="3.5" y="6.5" width="17" height="12.5" rx="2"/><path d="M3.5 10.5h17"/><circle cx="8.5" cy="15" r="1.8"/><circle cx="15.5" cy="15" r="1.8"/><path d="M8 6.5V4.5h8v2"/>',
  compass: '<circle cx="12" cy="12" r="8.5"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/>',
  sortUp: '<path d="M12 18V6M7 11l5-5 5 5"/>',
  sortDown: '<path d="M12 6v12M7 13l5 5 5-5"/>',
  zoomIn: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2M8.5 11h5M11 8.5v5"/>',
  zoomOut: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2M8.5 11h5"/>',
  fit: '<path d="M4 9V5h4M20 9V5h-4M4 15v4h4M20 15v4h-4"/>',
  refresh: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3L19.5 9"/><path d="M19.5 4.5V9H15"/>',
  restore: '<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3L4.5 9"/><path d="M4.5 4.5V9H9"/>',
  sparkle: '<path d="M12 3.5l1.8 5 5 1.8-5 1.8-1.8 5-1.8-5-5-1.8 5-1.8z"/><path d="M18.5 15.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z"/>',
  setlist: '<path d="M4 6h10M4 11h10M4 16h6"/><path d="M17 9v8.5"/><circle cx="15" cy="17.5" r="2"/><path d="M17 9l3-1"/>',
  tuning: '<path d="M6 3.5v17M10 3.5v17M14 3.5v17M18 3.5v17"/><circle cx="6" cy="8" r="1.6"/><circle cx="14" cy="14" r="1.6"/>',
  people: '<circle cx="9" cy="8.5" r="3"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0"/><circle cx="16.5" cy="9.5" r="2.5"/><path d="M15.5 14.2A4.8 4.8 0 0 1 21 19"/>',
  video: '<rect x="3" y="6" width="13" height="12" rx="2"/><path d="M16 10.5l5-3v9l-5-3z"/>',
  person: '<circle cx="12" cy="8.5" r="3.5"/><path d="M5 19.5a7 7 0 0 1 14 0"/>',
  copy: '<rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V6.5A1.5 1.5 0 0 0 14.5 5h-8A1.5 1.5 0 0 0 5 6.5v8A1.5 1.5 0 0 0 6.5 16H8"/>',
  wand: '<path d="M5 19l10-10M14 6l1-2 1 2 2 1-2 1-1 2-1-2-2-1z"/>',
  guitar: '<path d="M14 4l6 6-9 9H5v-6z"/><path d="M12 6l6 6"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  tones: '<rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="8" cy="12" r="2"/><circle cx="16" cy="12" r="2"/>',
  record: '<circle cx="12" cy="12" r="6"/>',
  stop: '<rect x="6.5" y="6.5" width="11" height="11" rx="2"/>',
  drum: '<ellipse cx="12" cy="8" rx="8" ry="3"/><path d="M4 8v8c0 1.7 3.6 3 8 3s8-1.3 8-3V8M8 11v7M16 11v7"/>',
  repeat: '<path d="M4 11V9a3 3 0 0 1 3-3h12l-3-3M20 13v2a3 3 0 0 1-3 3H5l3 3"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  levels: '<path d="M5 20v-6M10 20V8M15 20v-9M20 20V4"/>',
};

const FILLED = new Set(['play', 'pause', 'prev', 'next', 'more', 'record', 'stop']);

export function icon(name, cls = '') {
  const filled = FILLED.has(name) || cls.includes('fill');
  return `<svg class="i ${filled ? 'fill' : ''} ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg>`;
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/** Tiny element factory: h('div.cls', {attrs}, children...) */
export function h(tag, attrs, ...children) {
  const [name, ...classes] = tag.split('.');
  const el = document.createElement(name || 'div');
  if (classes.length) el.className = classes.join(' ');
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'style' && typeof v === 'object') {
        for (const [sk, sv] of Object.entries(v)) {
          if (sk.startsWith('--')) el.style.setProperty(sk, sv);
          else el.style[sk] = sv;
        }
      }
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    }
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function fmtDuration(sec) {
  if (!Number.isFinite(sec) || sec <= 0) return '';
  const m = Math.floor(sec / 60);
  const s = Math.round(sec - m * 60);
  return s === 60 ? `${m + 1}:00` : `${m}:${String(s).padStart(2, '0')}`;
}

export function fmtBytes(n) {
  if (!n) return '0 MB';
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
  return `${(n / 1024 ** 3).toFixed(1)} GB`;
}

export function fmtDate(ms) {
  if (!ms) return '';
  return new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function fmtDateTime(ms) {
  if (!ms) return '';
  return new Date(ms).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

// ------------------------------------------------------------------ menus --
let openMenu = null;

export function closeMenu() {
  if (openMenu) {
    openMenu.remove();
    openMenu = null;
  }
}

/**
 * items: [{label, icon, hint, danger, disabled, onClick, submenu:[...]}, '-' , {label:'Group', heading:true}]
 */
export function showMenu(x, y, items, { align = 'left' } = {}) {
  closeMenu();
  const menu = h('div.menu', { role: 'menu' });
  const build = (list, root) => {
    for (const it of list) {
      if (!it) continue;
      if (it === '-') {
        root.append(h('hr'));
        continue;
      }
      if (it.heading) {
        root.append(h('div.label', { text: it.label }));
        continue;
      }
      const b = h('button', { role: 'menuitem', type: 'button', class: it.danger ? 'danger' : '', disabled: it.disabled });
      b.innerHTML = `${it.icon ? icon(it.icon) : '<span style="width:16px"></span>'}<span>${esc(it.label)}</span>${it.hint ? `<span class="hint">${esc(it.hint)}</span>` : it.submenu ? `<span class="hint">${icon('chevronRight')}</span>` : ''}`;
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        if (it.submenu) {
          const r = b.getBoundingClientRect();
          showMenu(r.right + 2, r.top - 5, it.submenu);
          return;
        }
        closeMenu();
        it.onClick && it.onClick();
      });
      root.append(b);
    }
  };
  build(items, menu);
  document.body.append(menu);
  const r = menu.getBoundingClientRect();
  let left = align === 'right' ? x - r.width : x;
  let top = y;
  if (left + r.width > window.innerWidth - 8) left = window.innerWidth - r.width - 8;
  if (top + r.height > window.innerHeight - 8) top = Math.max(8, y - r.height);
  menu.style.left = `${Math.max(8, left)}px`;
  menu.style.top = `${top}px`;
  openMenu = menu;
  const first = menu.querySelector('button:not([disabled])');
  if (first) first.focus({ preventScroll: true });
  menu.addEventListener('keydown', (e) => {
    const btns = [...menu.querySelectorAll('button:not([disabled])')];
    const i = btns.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') {
      btns[(i + 1) % btns.length].focus();
      e.preventDefault();
    } else if (e.key === 'ArrowUp') {
      btns[(i - 1 + btns.length) % btns.length].focus();
      e.preventDefault();
    } else if (e.key === 'Escape') {
      closeMenu();
    }
  });
  return menu;
}

document.addEventListener('mousedown', (e) => {
  if (openMenu && !openMenu.contains(e.target)) closeMenu();
});
window.addEventListener('blur', closeMenu);
window.addEventListener('resize', closeMenu);

// ----------------------------------------------------------------- modals --
const modalStack = [];

export function modal({ title, body, footer, wide = false, onClose, dismissable = true }) {
  const backdrop = h('div.modal-backdrop');
  const box = h(`div.modal${wide ? '.wide' : ''}`, { role: 'dialog', 'aria-modal': 'true', 'aria-label': title });
  const close = () => {
    backdrop.remove();
    const i = modalStack.indexOf(api);
    if (i >= 0) modalStack.splice(i, 1);
    onClose && onClose();
  };
  const head = h('header', null, h('h2', { text: title }));
  if (dismissable) {
    const x = h('button.icon-btn', { type: 'button', title: 'Close', html: icon('x'), onclick: close });
    head.append(x);
  }
  const bodyEl = h('div.body');
  if (body) bodyEl.append(body);
  box.append(head, bodyEl);
  let footEl = null;
  if (footer) {
    footEl = h('footer');
    footEl.append(...[].concat(footer));
    box.append(footEl);
  }
  backdrop.append(box);
  backdrop.addEventListener('mousedown', (e) => {
    if (e.target === backdrop && dismissable) close();
  });
  // 4.1.4: a new box always opens in front of the ones already open (a "Remove Alex?"
  // question used to open behind the Recordings window, which sits higher)
  let top = 0;
  for (const b of document.querySelectorAll('.modal-backdrop')) top = Math.max(top, parseInt(getComputedStyle(b).zIndex, 10) || 0);
  document.getElementById('overlays').append(backdrop);
  if (top && (parseInt(getComputedStyle(backdrop).zIndex, 10) || 0) <= top) backdrop.style.zIndex = String(top + 1);
  const api = { el: box, body: bodyEl, footer: footEl, close, dismissable };
  modalStack.push(api);
  setTimeout(() => {
    const f = box.querySelector('[autofocus], input, select, .btn.primary');
    if (f) f.focus();
  }, 30);
  return api;
}

export function topModal() {
  return modalStack[modalStack.length - 1] || null;
}

export function confirmDialog({ title, message, confirm = 'Continue', danger = false }) {
  return new Promise((resolve) => {
    let result = false;
    const ok = h(`button.btn${danger ? '.danger' : '.primary'}`, { type: 'button', text: confirm });
    const cancel = h('button.btn.ghost', { type: 'button', text: 'Cancel' });
    const m = modal({
      title,
      body: h('p', { text: message }),
      footer: [cancel, ok],
      onClose: () => resolve(result),
    });
    ok.onclick = () => {
      result = true;
      m.close();
    };
    cancel.onclick = () => m.close();
  });
}

// ----------------------------------------------------------------- toasts --
let toastRoot = null;
export function toast({ title, message = '', kind = 'ok', actions = [], timeout = 5200 }) {
  if (!toastRoot) {
    toastRoot = h('div.toasts', { 'aria-live': 'polite' });
    document.body.append(toastRoot);
  }
  const ic = kind === 'err' ? 'alert' : kind === 'info' ? 'info' : 'check';
  const el = h(`div.toast.${kind}`, { role: kind === 'err' ? 'alert' : 'status' });
  el.innerHTML = `${icon(ic)}<div class="msg"><b>${esc(title)}</b>${message ? `<span>${esc(message)}</span>` : ''}</div>`;
  const act = h('div.act');
  for (const a of actions) {
    act.append(
      h('button.btn.small.ghost', {
        type: 'button',
        text: a.label,
        onclick: () => {
          a.onClick();
          remove();
        },
      })
    );
  }
  act.append(h('button.icon-btn', { type: 'button', title: 'Dismiss', html: icon('x'), style: { width: '24px', height: '24px' }, onclick: () => remove() }));
  el.append(act);
  toastRoot.append(el);
  while (toastRoot.children.length > 3) toastRoot.firstElementChild.remove();
  let t = setTimeout(() => remove(), kind === 'err' ? timeout * 2 : timeout);
  el.addEventListener('mouseenter', () => clearTimeout(t));
  el.addEventListener('mouseleave', () => (t = setTimeout(() => remove(), 2500)));
  function remove() {
    clearTimeout(t);
    el.remove();
  }
  return remove;
}

export function debounce(fn, ms) {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}

export function isTyping() {
  const a = document.activeElement;
  return !!a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' || a.isContentEditable);
}

/**
 * The tone-key note in the corner. Pass a promise (what the rig answers) and it
 * says "Loading…" until the engine has really switched, then the result: the
 * screen never claims a tone change that didn't happen.
 * @param {number} number the key
 * @param {string} name the tone's name
 * @param {Promise<{ok:boolean,tone?:object,standIn?:boolean,error?:string}>} [done]
 */
export function toneToast(number,name,done){
 document.querySelector('.tone-toast')?.remove();
 const el=h('div.tone-toast',{role:'status',text:`Tone ${number} — ${name}`});document.body.append(el);
 let timer=null;
 const leave=(ms)=>{clearTimeout(timer);timer=setTimeout(()=>{el.classList.add('leaving');setTimeout(()=>el.remove(),250);},ms);};
 if(!done){leave(2000);return;}
 el.classList.add('pending');el.textContent=`Tone ${number} — loading ${name}…`;
 Promise.resolve(done).then((r)=>{
  if(!el.isConnected)return;
  el.classList.remove('pending');
  if(r&&r.ok){el.textContent=`Tone ${number} — ${name}`;leave(2000);}
  else{el.classList.add('bad');el.textContent=`Tone ${number} didn’t change: ${(r&&r.error)||'the sound engine didn’t answer.'}`;leave(5000);}
 },()=>{el.classList.remove('pending');el.classList.add('bad');el.textContent=`Tone ${number} didn’t change.`;leave(5000);});
}
export function holdButton(button,action){
 let timer=null,start=0,held=false;const stop=()=>{clearTimeout(timer);timer=null;};
 button.onpointerdown=e=>{if(e.button!==0)return;stop();held=true;start=performance.now();button.setPointerCapture(e.pointerId);action(1);const repeat=()=>{if(!button.isConnected)return stop();action(performance.now()-start>1600?3:1);timer=setTimeout(repeat,performance.now()-start>1600?65:120);};timer=setTimeout(repeat,380);};
 button.onpointerup=stop;button.onpointercancel=stop;button.onlostpointercapture=stop;button.onclick=e=>{if(e.detail===0||!held)action(1);held=false;};
}

/**
 * A small "Guitar" / "Bass" tag for what Stagehand thinks is plugged in, so a wrong
 * guess is easy to spot.
 * @param {object} rig the rig (rig.js)
 */
export function instrumentTag(rig){
 const inst=rig&&rig.instrument;if(!inst)return '';
 const label=inst==='bass'?'Bass':'Guitar';
 const how='set in Settings';
 return `<span class="inst-tag" title="${esc(label)} (${how})">${label}</span>`;
}
