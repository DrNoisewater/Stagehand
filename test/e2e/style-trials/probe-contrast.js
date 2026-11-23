// returns text elements whose colour is too close to the colour behind them (contrast < 3.2)
module.exports = () => {
  const parse = c => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[ ,\/]+/).filter(Boolean).map(Number); return { r:p[0], g:p[1], b:p[2], a:p.length > 3 ? p[3] : 1 }; };
  const lum = ({r,g,b}) => { const f = v => (v/=255) <= .03928 ? v/12.92 : ((v+.055)/1.055)**2.4; return .2126*f(r)+.7152*f(g)+.0722*f(b); };
  const bgOf = el => { const stack = []; for (let e = el; e; e = e.parentElement) { const cs = getComputedStyle(e); const c = parse(cs.backgroundColor); if (cs.backgroundImage !== 'none' && cs.backgroundImage.includes('gradient')) { const m = cs.backgroundImage.match(/rgba?\([^)]+\)|#[0-9a-f]{3,8}/gi); if (m) { const g = parse(m[m.length-1].startsWith('#') ? 'rgb(0,0,0)' : m[m.length-1]); if (g && g.a > .6) { stack.push(g); break; } } } if (c && c.a > 0) { stack.push(c); if (c.a >= .95) break; } }
    let out = { r:255, g:255, b:255 }; for (let i = stack.length - 1; i >= 0; i--) { const c = stack[i]; out = { r:c.r*c.a+out.r*(1-c.a), g:c.g*c.a+out.g*(1-c.a), b:c.b*c.a+out.b*(1-c.a) }; } return out; };
  const bad = new Map();
  for (const el of document.querySelectorAll('#app *')) {
    if (!el.childNodes.length || ![...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) continue;
    const r = el.getBoundingClientRect(); if (!r.width || r.bottom < 0 || r.top > innerHeight) continue;
    const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || +cs.opacity < .3) continue;
    const fg = parse(cs.color); const bg = bgOf(el); if (!fg) continue;
    const L1 = lum(fg), L2 = lum(bg); const ratio = (Math.max(L1,L2)+.05)/(Math.min(L1,L2)+.05);
    if (ratio < 3.2) { const key = el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : '') + ' < ' + (el.parentElement?.className || ''); if (!bad.has(key)) bad.set(key, `${ratio.toFixed(1)} "${el.textContent.trim().slice(0,24)}"`); }
  }
  return [...bad].map(([k,v]) => k + '  ' + v);
};
