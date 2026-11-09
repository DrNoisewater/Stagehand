/**
 * The direct connection between two Stagehands (WebRTC data channel,
 * DTLS-encrypted; 4.1 for friends, 4.3 for Backstage). The offer and answer
 * travel sealed through the main process (services/greenroom.js), through the
 * other person's hidden address. No UI here (see greenroom.js), and `api` is
 * passed in so tests can drive it in a plain browser.
 *
 * What travels is the videos you show backstage, with what's in them
 * (song, part, tone: `list`).
 * On the channel (JSON text, plus binary chunks of a file):
 *   friend → host  {op:'hi', name} (4.1.3: who's watching; older hosts ignore it)
 *                  {op:'list', r}   {op:'get', r, id, part: 'video'|'thumb', from}   {op:'cancel', r}
 *                  (`from`: carry on a download that was cut off, from that byte)
 *   host → friend  {op:'hello', name}        {op:'list', r, name, recordings}
 *                  {op:'file', r, id, part, size} + chunks + {op:'end', r}
 *                  {op:'error', r, message}
 */

// how each PC learns its address on the internet (4.1.3: more of them, so one being down or blocked doesn't matter)
export const ICE = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302', 'stun:stun.cloudflare.com:3478', 'stun:global.stun.twilio.com:3478'] }];
const CHUNK = 64 * 1024;
const MAX_FILE = 4 * 1024 * 1024 * 1024;
const SLICE = 1 << 20; // read from disk a megabyte at a time

/**
 * Waits until the connection details (ICE candidates: every address this PC can be
 * reached at) are gathered. Gathering often never says "complete" (an unreachable
 * STUN server, idle interfaces), so it also stops once the candidates have been
 * quiet for a while. At most `ms`.
 *
 * 4.1.6: it used to stop half a second after the first outside address. A PC with
 * several network adapters (Wi-Fi and Ethernet, a VPN, the virtual adapters some
 * programs add) can find a useless one first, and its answer then lacked the one
 * that works: friends got "answered, but your PCs couldn't connect" one way only.
 * Now it waits until every adapter has been asked (or the candidates go quiet for
 * 1.5 s after an outside address was found).
 */
function gathered(pc, ms = 6000) {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  const servers = (pc.getConfiguration().iceServers || []).length > 0;
  return new Promise((res) => {
    let quiet = null;
    let pub = false;
    const t = setTimeout(done, ms);
    function done() {
      clearTimeout(t);
      clearTimeout(quiet);
      pc.removeEventListener('icegatheringstatechange', state);
      pc.removeEventListener('icecandidate', cand);
      res();
    }
    function state() {
      if (pc.iceGatheringState === 'complete') done();
    }
    function cand(e) {
      if (!e.candidate) return done();
      if (/ typ (srflx|relay)/.test(e.candidate.candidate)) pub = true;
      clearTimeout(quiet);
      quiet = setTimeout(done, pub ? 1500 : servers ? 3000 : 400);
    }
    pc.addEventListener('icegatheringstatechange', state);
    pc.addEventListener('icecandidate', cand);
  });
}

async function sendBytes(dc, bytes) {
  dc.bufferedAmountLowThreshold = 1 << 20;
  for (let o = 0; o < bytes.byteLength; o += CHUNK) {
    if (dc.bufferedAmount > 8 << 20) {
      await new Promise((res, rej) => {
        const t = setInterval(() => dc.readyState !== 'open' && (clearInterval(t), rej(new Error('closed'))), 500);
        dc.addEventListener('bufferedamountlow', () => (clearInterval(t), res()), { once: true });
      });
    }
    if (dc.readyState !== 'open') throw new Error('closed');
    dc.send(bytes.subarray(o, Math.min(o + CHUNK, bytes.byteLength)));
  }
}

// ------------------------------------------------------------------ host --
/**
 * Answers people who connect to watch, handing out the videos main says are
 * shown backstage (it refuses the rest). Returns { peers, stop }.
 */
export function startHost(api, { iceServers = ICE, onPeers = null } = {}) {
  const peers = new Map();
  const names = new Map(); // conn -> the friend's name, once they say it
  const changed = () => onPeers && onPeers(peers.size, [...names.values()].filter(Boolean));

  function serve(dc, kill, conn) {
    let busy = Promise.resolve();
    const cancelled = new Set();
    let idle;
    const poke = () => {
      clearTimeout(idle);
      idle = setTimeout(kill, 10 * 60 * 1000);
    };
    const send = (m) => dc.readyState === 'open' && dc.send(JSON.stringify(m));
    dc.onopen = async () => {
      poke();
      try {
        const l = await api.room.hostList();
        send({ op: 'hello', name: l.name || '' });
      } catch (_) {}
    };
    dc.onclose = kill;
    dc.onmessage = (e) => {
      if (typeof e.data !== 'string' || e.data.length > 2000) return;
      let m;
      try {
        m = JSON.parse(e.data);
      } catch (_) {
        return;
      }
      poke();
      const r = Number(m.r) || 0;
      if (m.op === 'hi') {
        names.set(conn, String(m.name || 'Someone').slice(0, 40));
        changed();
        return;
      }
      if (m.op === 'cancel') {
        cancelled.add(r);
        return;
      }
      busy = busy.then(async () => {
        try {
          if (cancelled.has(r)) return;
          if (m.op === 'list') {
            const l = await api.room.hostList();
            send({ op: 'list', r, name: l.name || '', recordings: l.recordings });
          } else if (m.op === 'get' && typeof m.id === 'string') {
            const part = m.part === 'thumb' ? 'thumb' : 'video';
            let off = Math.max(0, Math.floor(Number(m.from) || 0));
            let first = await api.room.hostRead(m.id, part, off, SLICE); // main refuses what isn't shared
            send({ op: 'file', r, id: m.id, part, size: first.size, from: Math.min(off, first.size) });
            for (;;) {
              const bytes = first.bytes instanceof Uint8Array ? first.bytes : new Uint8Array(first.bytes);
              await sendBytes(dc, bytes);
              off += bytes.byteLength;
              if (off >= first.size || !bytes.byteLength) break;
              if (cancelled.has(r)) break;
              first = await api.room.hostRead(m.id, part, off, SLICE);
            }
            send({ op: 'end', r, cancelled: cancelled.has(r) });
          }
        } catch (err) {
          send({ op: 'error', r, message: (err && err.message) || 'Something went wrong' });
        } finally {
          cancelled.delete(r);
        }
      });
    };
    return () => clearTimeout(idle);
  }

  const off = api.on('room:offer', async ({ conn, sdp }) => {
    if (peers.size >= 8 || peers.has(conn)) return;
    const pc = new RTCPeerConnection({ iceServers });
    let stopIdle = null;
    const kill = () => {
      if (!peers.has(conn)) return;
      peers.delete(conn);
      names.delete(conn);
      if (stopIdle) stopIdle();
      try {
        pc.close();
      } catch (_) {}
      changed();
    };
    peers.set(conn, pc);
    changed();
    const never = setTimeout(() => pc.connectionState !== 'connected' && kill(), 45000);
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') clearTimeout(never);
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') kill();
    };
    pc.ondatachannel = (e) => {
      if (e.channel.label !== 'recordings') return;
      stopIdle = serve(e.channel, kill, conn);
    };
    try {
      await pc.setRemoteDescription({ type: 'offer', sdp });
      await pc.setLocalDescription(await pc.createAnswer());
      await gathered(pc);
      await api.room.answer(conn, pc.localDescription.sdp);
    } catch (_) {
      kill();
    }
  });

  return {
    peers,
    stop() {
      off && off();
      for (const pc of peers.values()) pc.close();
      peers.clear();
      names.clear();
      changed();
    },
  };
}

// ---------------------------------------------------------------- friend --
/**
 * Connects to someone's Stagehand (their hidden address). Resolves a link:
 *   { name, list(), get(id, { part, onChunk, onProgress }) → { bytes, size }, cancel(), close(), onclose }
 * With onChunk the pieces go there as they arrive (to start a video playing)
 * and `bytes` comes back empty.
 * Errors carry `code`: OFFLINE (no answer), RELAY, DIRECT (couldn't connect directly).
 */
export async function connectTo(api, addr, { iceServers = ICE, timeout = 20000, name = '', onStage = null } = {}) {
  const pc = new RTCPeerConnection({ iceServers });
  const dc = pc.createDataChannel('recordings', { ordered: true });
  dc.binaryType = 'arraybuffer';
  const fail = (err) => {
    try {
      pc.close();
    } catch (_) {}
    throw err;
  };
  try {
    await pc.setLocalDescription(await pc.createOffer());
    await gathered(pc);
    const answer = await api.room.connect(addr, pc.localDescription.sdp);
    // they answered: now the direct line between the two PCs
    if (onStage) onStage('direct');
    await pc.setRemoteDescription({ type: 'answer', sdp: answer });
  } catch (err) {
    fail(err);
  }

  let r = 0;
  const wait = new Map();
  let file = null; // the file coming in: { r, parts, got, size, onChunk, onProgress }
  let hello = null;
  const helloP = new Promise((res) => (hello = res));
  const link = {
    name: '',
    onclose: null,
    closed: false,
    list: () => ask({ op: 'list' }),
    get: (id, { part = 'video', from = 0, onChunk = null, onProgress = null } = {}) => ask({ op: 'get', id, part, from }, { onChunk, onProgress }),
    /** Stops the file coming in now (it resolves with what came, `cancelled: true`). */
    cancel() {
      if (file && dc.readyState === 'open') dc.send(JSON.stringify({ op: 'cancel', r: file.r }));
    },
    close() {
      if (link.closed) return;
      link.closed = true;
      for (const w of wait.values()) w.reject(Object.assign(new Error('The connection closed'), { code: 'CLOSED' }));
      wait.clear();
      try {
        pc.close();
      } catch (_) {}
      link.onclose && link.onclose();
    },
  };
  let queue = Promise.resolve();
  function ask(m, cb = {}) {
    // one request at a time, so file chunks never interleave
    const p = queue.then(
      () =>
        new Promise((resolve, reject) => {
          if (link.closed || dc.readyState !== 'open') return reject(Object.assign(new Error('The connection closed'), { code: 'CLOSED' }));
          const id = ++r;
          wait.set(id, { resolve, reject, ...cb });
          dc.send(JSON.stringify({ ...m, r: id }));
        })
    );
    queue = p.catch(() => {});
    return p;
  }
  dc.onmessage = (e) => {
    if (link.closed) return; // pieces still on their way after closing: not ours any more
    if (typeof e.data !== 'string') {
      if (!file) return;
      if (file.onChunk) file.onChunk(new Uint8Array(e.data));
      else file.parts.push(e.data);
      file.got += e.data.byteLength;
      if (file.from + file.got > file.size || file.got > MAX_FILE) {
        const w = wait.get(file.r);
        file = null;
        if (w) w.reject(new Error('The take came through wrong'));
        return;
      }
      if (file.onProgress) file.onProgress((file.from + file.got) / Math.max(1, file.size));
      return;
    }
    let m;
    try {
      m = JSON.parse(e.data);
    } catch (_) {
      return;
    }
    if (m.op === 'hello') {
      link.name = String(m.name || '');
      hello();
      return;
    }
    const w = wait.get(m.r);
    if (!w) return;
    if (m.op === 'file') {
      const size = Math.min(Number(m.size) || 0, MAX_FILE);
      file = { r: m.r, parts: [], got: 0, size, from: Math.max(0, Math.min(size, Number(m.from) || 0)), onChunk: w.onChunk || null, onProgress: w.onProgress || null };
      return;
    }
    wait.delete(m.r);
    if (m.op === 'list') {
      if (m.name) link.name = String(m.name);
      w.resolve(Array.isArray(m.recordings) ? m.recordings : []);
    } else if (m.op === 'end' && file && file.r === m.r) {
      const out = new Uint8Array(file.got);
      let o = 0;
      for (const p of file.parts) {
        out.set(new Uint8Array(p), o);
        o += p.byteLength;
      }
      const { size, from } = file;
      file = null;
      w.resolve({ bytes: out, size, from, cancelled: !!m.cancelled });
    } else if (m.op === 'error') {
      file = null;
      w.reject(new Error(m.message || 'Something went wrong'));
    }
  };
  dc.onclose = () => link.close();
  pc.onconnectionstatechange = () => (pc.connectionState === 'failed' || pc.connectionState === 'closed') && link.close();

  await new Promise((res, rej) => {
    const t = setTimeout(() => rej(Object.assign(new Error('Couldn’t connect directly to their PC. One of your networks may block it.'), { code: 'DIRECT' })), timeout);
    if (dc.readyState === 'open') {
      clearTimeout(t);
      res();
    }
    dc.onopen = () => {
      clearTimeout(t);
      res();
    };
  }).catch(fail);
  // say who's watching (4.1.3)
  try {
    dc.send(JSON.stringify({ op: 'hi', name: String(name || '') }));
  } catch (_) {}
  // the host says its name first; don't wait long for it
  await Promise.race([helloP, new Promise((res) => setTimeout(res, 1500))]);
  return link;
}
