/** Settings › Quest (4.16): the Quest companion switch, the address and code, the headsets it knows. */
import { api } from './api.js';
import { h, toast } from './ui.js';

const ago = (t) => {
  if (!t) return 'never';
  const s = (Date.now() - t) / 1000;
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400 * 2) return `${Math.round(s / 3600)} h ago`;
  return new Date(t).toLocaleDateString();
};

export async function pane(el, setting) {
  let st = await api.companion.status().catch(() => null);
  if (!st) st = { on: false, wanted: false, devices: [] };

  const sw = h('input.toggle', { type: 'checkbox', 'aria-label': 'Quest companion' });
  sw.checked = !!st.on;
  const body = h('div.quest-body');
  el.append(
    setting(
      'Quest companion',
      'Play from a Meta Quest headset: the highway and your backgrounds all around you, or falling notes on your real piano. Your guitar, piano and the sound stay on this PC, exactly as now; the headset only shows things. Off: Stagehand doesn’t use your network for this.',
      sw
    ),
    body
  );
  sw.onchange = async () => {
    sw.disabled = true;
    try {
      st = await api.companion.setOn(sw.checked);
    } catch (err) {
      toast({ title: 'The Quest companion didn’t start', message: err.message, kind: 'err' });
      st = await api.companion.status().catch(() => st);
    }
    sw.disabled = false;
    sw.checked = !!st.on;
    draw();
  };

  const draw = () => {
    body.innerHTML = '';
    if (!st.on) {
      if (st.error) body.append(h('p.quest-note.bad', { text: `It couldn’t start: ${st.error}` }));
      if (st.devices.length) body.append(devices());
      return;
    }
    const url = st.url || (st.port ? `https://<this PC>:${st.port}` : '');
    const addr = url.replace(/^https:\/\//, '');
    const card = h(
      'div.quest-card',
      null,
      h('div.quest-step', null, h('span.quest-n', { text: '1' }), h('div', null, h('div.quest-k', { text: 'On the Quest, open the Browser and go to' }), h('div.quest-addr', { text: `https://${addr}` }))),
      h('div.quest-step', null, h('span.quest-n', { text: '2' }), h('div', null, h('div.quest-k', { text: 'The first time, it warns the connection isn’t private' }), h('div.quest-d', { text: 'Stagehand made its own certificate for your home network. Tap Advanced, then Proceed. It only asks once.' }))),
      h('div.quest-step', null, h('span.quest-n', { text: '3' }), h('div', null, h('div.quest-k', { text: 'Type this code in the headset' }), h('div.quest-code', { text: st.code || '····' })))
    );
    const newCode = h('button.btn.small.ghost', { type: 'button', text: 'New code' });
    newCode.onclick = async () => {
      st = await api.companion.newCode();
      draw();
    };
    card.append(h('div.quest-foot', null, h('span.quest-d', { text: st.addresses.length > 1 ? `Other addresses for this PC: ${st.addresses.slice(1).join(', ')}` : 'The Quest must be on the same home network as this PC.' }), newCode));
    body.append(card);
    body.append(h('p.quest-note', { text: 'If Windows asks whether Stagehand may use the network, allow it on private networks. The headset remembers this PC: next time, open the same address and it connects by itself.' }));
    body.append(devices());
  };

  const devices = () => {
    const box = h('div.quest-devices');
    box.append(h('div.quest-k', { text: st.devices.length ? 'Headsets' : 'No headset yet' }));
    for (const d of st.devices) {
      const forget = h('button.btn.small.ghost', { type: 'button', text: 'Forget' });
      forget.onclick = async () => {
        st = await api.companion.forget(d.id);
        draw();
      };
      box.append(h('div.quest-dev', null, h(d.online ? 'span.status-pill.ok' : 'span.status-pill', { text: d.online ? 'Connected' : 'Not connected' }), h('span.quest-dev-name', { text: d.name }), h('span.quest-d', { text: d.online ? '' : `last seen ${ago(d.seen)}` }), forget));
    }
    return box;
  };

  draw();
  const off = api.on('companion:status', (s) => {
    if (!el.isConnected) return off && off();
    st = s;
    sw.checked = !!s.on;
    draw();
  });
}
