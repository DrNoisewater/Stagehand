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
      h('div.quest-step', null, h('span.quest-n', { text: '1' }), h('div', null, h('div.quest-k', { text: 'On the Quest, open the Browser and type this in the address bar' }), h('div.quest-addr', { text: `https://${addr}` }))),
      h('div.quest-step', null, h('span.quest-n', { text: '2' }), h('div', null, h('div.quest-k', { text: 'The first time, it warns “Your connection is not private”' }), h('div.quest-d', { text: 'That’s expected: Stagehand made its own certificate for your home network. Tap Advanced, then “Proceed to …”. It only asks once.' }))),
      h('div.quest-step', null, h('span.quest-n', { text: '3' }), h('div', null, h('div.quest-k', { text: 'Type this code in the headset' }), h('div.quest-code', { text: st.code || '····' })))
    );
    const newCode = h('button.btn.small.ghost', { type: 'button', text: 'New code' });
    newCode.onclick = async () => {
      st = await api.companion.newCode();
      draw();
    };
    const where = (st.where || []).slice(1);
    card.append(h('div.quest-foot', null, h('span.quest-d', { text: where.length ? `If that address doesn’t open, try: ${where.map((w) => `https://${w.address}:${st.port} (${w.name})`).join(', ')}` : 'The Quest must be on the same home network as this PC.' }), newCode));
    body.append(card);
    if (!st.devices.some((d) => d.online)) body.append(reach());
    body.append(h('p.quest-note', { text: 'The headset remembers this PC: next time, open the same address and it connects by itself.' }));
    body.append(devices());
  };

  /** Can the headset get to this PC? What the PC has seen so far, and what to do about it. */
  const reach = () => {
    const box = h('div.quest-card');
    const r = st.reach;
    const fw = st.firewall;
    const line = (kind, title, text) => box.append(h('div', null, h(`span.status-pill.${kind}`, { text: title }), text ? h('div.quest-d', { text, style: { marginTop: '4px' } }) : null));
    if (r && r.step === 'link') line('ok', 'The headset reached Stagehand', 'Type the code in the headset.');
    else if (r && r.step === 'page') line('ok', 'The page opened in the headset', `From ${r.from}. Type the code there.`);
    else if (r && r.step === 'cert') line('warn', 'The headset found this PC', `From ${r.from}. On its warning page, tap Advanced, then “Proceed to …”.`);
    else if (r) line('warn', 'Another device reached this PC', `From ${r.from}, but the page hasn’t opened yet. Check the address starts with https://.`);
    else line('warn', 'Nothing has reached this PC from the headset yet', 'If the page never loads in the headset, something is stopping it on the way. The likeliest is below.');
    if (r && r.step !== 'knock') return box;

    if (fw && fw.network === 'Public') {
      line('bad', 'Windows treats this network as Public', `On a Public network Windows keeps other devices out. If ${fw.netName ? `“${fw.netName}”` : 'this'} is your home network, set it to Private: Windows Settings › Network & internet › Wi-Fi (or Ethernet) › your network › Private network.${api.companion.allowFirewall ? ' Or use the button below.' : ''}`);
    }
    if (fw && (fw.state === 'blocked' || fw.state === 'no-rule')) {
      line('bad', fw.state === 'blocked' ? 'Windows Firewall is blocking Stagehand' : 'Windows Firewall probably blocks Stagehand', fw.state === 'blocked' ? 'This happens when Windows asked whether Stagehand may use the network and the question was closed (it often hides behind the window).' : 'Stagehand isn’t on Windows Firewall’s allowed list yet.');
    } else if (fw && (fw.state === 'allowed' || fw.state === 'off') && fw.network !== 'Public') {
      line('ok', 'Windows Firewall lets the headset in', 'If you have another security program (Norton, McAfee, Bitdefender, Avast…), it may have its own firewall: allow Stagehand there too.');
    }
    if (fw && (fw.state === 'blocked' || fw.state === 'no-rule' || fw.network === 'Public')) {
      if (api.companion.allowFirewall) {
        const fix = h('button.btn.small', { type: 'button', text: 'Let the headset in' });
        fix.onclick = async () => {
          fix.disabled = true;
          fix.textContent = 'Windows will ask for permission…';
          const res = await api.companion.allowFirewall().catch(() => null);
          if (res && res.ok) toast({ title: 'Done', message: 'Windows Firewall now lets devices on your home network open Stagehand’s Quest page.' });
          else toast({ title: res && res.cancelled ? 'Nothing changed' : 'That didn’t work', message: 'You can do it by hand: see the steps here.', kind: 'err' });
          st = await api.companion.status().catch(() => st);
          draw();
        };
        box.append(h('div', null, fix, h('span.quest-d', { text: ' Adds one rule to Windows Firewall for Stagehand’s Quest page, for home-network devices only.' })));
      }
      box.append(h('div.quest-d', { text: 'By hand: open Start, type Firewall, open “Allow an app through Windows Firewall”, click Change settings, find Stagehand (there may be two lines) and tick Private on each (Public too if your home network shows as Public), then OK.' }));
    }
    if (st.vpn) line('warn', `A VPN is on (${st.vpn})`, 'VPNs often hide this PC from other devices at home. Switch it off, or turn on its “allow local network” option.');
    const tips = h(
      'details',
      null,
      h('summary.quest-d', { text: 'More things to check' }),
      h('ul.quest-d', { style: { margin: '6px 0 0', paddingLeft: '18px' } },
        h('li', { text: 'The Quest and this PC on the same home network. A guest Wi-Fi keeps devices apart, and some routers do on their 5 GHz or mesh network too (“AP isolation”).' }),
        h('li', { text: 'Typed exactly, with the numbers and the :port at the end. The PC’s name won’t work; the numbers will (Pi-hole doesn’t matter for those).' }),
        h('li', { text: 'Try the address on a phone on the same Wi-Fi. If the phone opens it too, the problem is in the headset; if not, it’s this PC or the router.' })
      )
    );
    box.append(tips);
    return box;
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
