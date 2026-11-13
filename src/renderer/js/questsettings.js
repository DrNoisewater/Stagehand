/** Settings › Quest (4.16): the one switch for the Quest companion, the address and code, the headsets it knows. */
import { api } from './api.js';
import { bus } from './store.js';
import { h, toast } from './ui.js';
import { quest } from './quest.js';

function ago(t) {
  if (!t) return 'never';
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 2) return 'just now';
  if (m < 60) return `${m} minutes ago`;
  const hrs = Math.round(m / 60);
  if (hrs < 36) return `${hrs} hour${hrs === 1 ? '' : 's'} ago`;
  const d = Math.round(hrs / 24);
  return `${d} day${d === 1 ? '' : 's'} ago`;
}

export async function pane(el, setting) {
  let st = (await api.companion.status().catch(() => null)) || { on: false };
  const sw = h('input.toggle', { type: 'checkbox', 'aria-label': 'Use a Meta Quest' });
  sw.checked = !!st.on;
  const body = h('div.quest-body');
  el.append(
    setting('Use Stagehand on a Meta Quest', 'See the highway around you in VR, and the piano’s falling notes on your real keys. Your guitar, the sound and the scoring stay on this PC: listen through the PC’s speakers or headphones. Off: nothing on your network can reach Stagehand.', sw),
    body
  );
  sw.onchange = async () => {
    sw.disabled = true;
    try {
      st = await api.companion.set(sw.checked);
    } catch (err) {
      sw.checked = false;
      toast({ title: 'Couldn’t switch the Quest on', message: err.message, kind: 'err' });
    }
    sw.disabled = false;
    draw();
  };

  function draw() {
    body.innerHTML = '';
    sw.checked = !!st.on;
    if (!st.on) {
      body.append(h('div.quest-off', null, h('div.quest-off-art', { html: headsetSvg() }), h('p', { text: 'Switch this on, then open the Browser on your Quest. You’ll pair it once with a 4-number code; after that it finds Stagehand by itself.' })));
      return;
    }
    const steps = h('ol.quest-steps');
    const addr = h('div.quest-addr', null, h('b', { text: st.address ? st.address.replace(/^https:\/\//, '') : 'No network found' }));
    const copy = h('button.btn.small.ghost', { type: 'button', text: 'Copy' });
    copy.onclick = () => navigator.clipboard.writeText(st.address || '').then(() => toast({ title: 'Address copied', kind: 'info' })).catch(() => {});
    if (st.address) addr.append(copy);
    steps.append(
      h('li', null, h('span', { text: 'Put on the Quest and open the Browser. Type this address:' }), addr, h('small', { text: 'The first time, it warns that the connection isn’t private: choose Advanced, then Proceed. That’s Stagehand’s own lock on your home network; it asks once.' })),
      h('li', null, h('span', { text: 'Type this code on the Quest:' }), h('div.quest-code', null, ...String(st.code || '----').split('').map((d) => h('i', { text: d }))), h('small', { text: 'Only once per headset. It remembers this PC, and this PC remembers it.' }))
    );
    const newCode = h('button.btn.small.ghost', { type: 'button', text: 'New code' });
    newCode.onclick = async () => {
      st = await api.companion.newCode();
      draw();
    };
    body.append(h('div.quest-card', null, steps, h('div.quest-row', null, h('span.d', { text: st.network ? `On ${st.network}. If Windows asks, let Stagehand use private networks.` : 'If Windows asks, let Stagehand use private networks.' }), newCode)));
    if (st.others && st.others.length) body.append(h('p.quest-fine', { text: `Not reaching it? This PC also answers on ${st.others.map((a) => a.replace(/^https:\/\//, '')).join(', ')}.` }));
    if (st.error) body.append(h('p.quest-fine.bad', { text: st.error }));

    body.append(h('h3.quest-h', { text: 'Headsets' }));
    if (!st.devices || !st.devices.length) body.append(h('p.quest-fine', { text: 'None yet.' }));
    for (const d of st.devices || []) {
      const forget = h('button.btn.small.ghost', { type: 'button', text: 'Forget' });
      forget.onclick = async () => {
        st = await api.companion.forget(d.id);
        draw();
      };
      body.append(h('div.quest-dev', null, h('span.quest-dev-ic', { html: headsetSvg() }), h('div', null, h('b', { text: d.name || 'Quest' }), h('span', { text: d.connected ? 'Connected now' : `Last seen ${ago(d.lastSeen)}` })), d.connected ? h('span.status-pill.ok', { text: 'Connected' }) : null, forget));
    }
  }
  draw();
  // headsets coming and going while this is open
  const onQuest = () => {
    if (!el.isConnected) return bus.removeEventListener('quest', onQuest);
    if (quest.status) st = quest.status;
    draw();
  };
  bus.addEventListener('quest', onQuest);
}

function headsetSvg() {
  return '<svg viewBox="0 0 64 40" aria-hidden="true"><path d="M8 8c0-3 2-5 5-5h38c3 0 5 2 5 5v18c0 3-2 5-5 5H41l-5-6h-8l-5 6H13c-3 0-5-2-5-5z" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/><circle cx="22" cy="17" r="4" fill="currentColor"/><circle cx="42" cy="17" r="4" fill="currentColor"/></svg>';
}
