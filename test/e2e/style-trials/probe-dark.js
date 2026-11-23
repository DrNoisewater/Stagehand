// elements in the page area (not the frame) with their own dark background
module.exports = () => {
  const parse = c => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[ ,\/]+/).filter(Boolean).map(Number); return { r:p[0], g:p[1], b:p[2], a:p.length > 3 ? p[3] : 1 }; };
  const lum = ({r,g,b}) => { const f = v => (v/=255) <= .03928 ? v/12.92 : ((v+.055)/1.055)**2.4; return .2126*f(r)+.7152*f(g)+.0722*f(b); };
  const out = new Map();
  for (const el of document.querySelectorAll('#app *')) {
    if (el.closest('.sidebar,.titlebar,.nowbar,.identity-banner,.gear-faceplate,canvas,svg,.gear-lineup,.dropui,.drop-card,[class*="dc-"]')) continue;
    const r = el.getBoundingClientRect(); if (r.width < 30 || r.height < 14 || r.bottom < 0 || r.top > innerHeight) continue;
    const cs = getComputedStyle(el); let c = parse(cs.backgroundColor);
    if ((!c || c.a < .5) && cs.backgroundImage.includes('gradient')) { const m = cs.backgroundImage.match(/rgba?\([^)]+\)/g); if (m) c = parse(m[m.length-1]); }
    if (!c || c.a < .5 || lum(c) > .06) continue;
    const key = el.tagName.toLowerCase() + '.' + String(el.className).trim().split(/\s+/).slice(0,3).join('.') + ' < ' + String(el.parentElement?.className||'').split(/\s+/)[0];
    if (!out.has(key)) out.set(key, `${Math.round(r.width)}x${Math.round(r.height)} ${cs.backgroundColor}`);
  }
  return [...out].map(([k,v]) => k + '  ' + v);
};
