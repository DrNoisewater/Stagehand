'use strict';
/**
 * 4.25: asking Noisewater Labs for official Rocksmith DLC songs.
 *
 * Official (paid) songs can't be downloaded, so the Official DLC page lets the player ask
 * for them. There is no Stagehand server: the request goes out as an e-mail through ntfy.sh
 * (already used by Backstage), posted to a random topic with ntfy's Email header. When that
 * fails, the page opens the player's own mail app with the same words (mailto) instead.
 * Node built-ins only.
 */
const https = require('https');
const crypto = require('crypto');

/** Where these requests go. The owner asked for exactly this address. */
const REQUEST_EMAIL = 'jferguson2194@hotmail.com';
const REQUEST_TITLE = 'Stagehand song request';
const NTFY_HOST = 'ntfy.sh';
/** One request every 12 hours. */
const REQUEST_GAP = 12 * 60 * 60 * 1000;
const MAX_SONGS = 300;

const clean = (s, n) => String(s == null ? '' : s).replace(/[\r\n\t]+/g, ' ').trim().slice(0, n);

/** 24 letters and digits: a topic nobody else uses. */
function randomTopic() {
  const abc = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const b = crypto.randomBytes(24);
  let s = '';
  for (let i = 0; i < 24; i++) s += abc[b[i] % abc.length];
  return s;
}

/** The request's songs, cleaned: [{artist,title}], no empties, no repeats. */
function songsOf(list) {
  const seen = new Set();
  const out = [];
  for (const s of Array.isArray(list) ? list : []) {
    if (!s) continue;
    const artist = clean(s.artist, 200);
    const title = clean(s.title, 200);
    if (!title) continue;
    const k = `${artist.toLowerCase()}|${title.toLowerCase()}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ artist, title });
    if (out.length >= MAX_SONGS) break;
  }
  return out;
}

/** The request in plain words. */
function requestBody({ songs, contact, note, name, version }) {
  const lines = ['A Stagehand player is asking for these official Rocksmith songs.', ''];
  lines.push(`Reach them at: ${clean(contact, 200)}`);
  if (clean(name, 80)) lines.push(`Backstage name: ${clean(name, 80)}`);
  lines.push('');
  lines.push(`Songs (${songs.length}):`);
  for (const s of songs) lines.push(`- ${s.artist ? `${s.artist} – ` : ''}${s.title}`);
  const n = String(note == null ? '' : note).trim().slice(0, 2000);
  if (n) lines.push('', 'Note:', n);
  lines.push('', `Sent from Stagehand${version ? ` ${clean(version, 40)}` : ''}.`);
  return lines.join('\n');
}

/** The same request for the player's own mail app (kept short enough for a mailto link). */
function mailtoFor(body) {
  let text = body;
  if (text.length > 1800) text = `${text.slice(0, 1780)}\n…`;
  return `mailto:${REQUEST_EMAIL}?subject=${encodeURIComponent(REQUEST_TITLE)}&body=${encodeURIComponent(text)}`;
}

/** POST over HTTPS; resolves { status } or rejects on a network failure or after 15 s. */
function httpsPost({ host, path, headers, body, timeout = 15000 }) {
  return new Promise((resolve, reject) => {
    const data = Buffer.from(body, 'utf8');
    const req = https.request({ host, path, method: 'POST', headers: { ...headers, 'Content-Length': data.length }, timeout }, (res) => {
      res.resume();
      res.on('end', () => resolve({ status: res.statusCode }));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('timed out')));
    req.on('error', reject);
    req.end(data);
  });
}

/**
 * Send one request. { ok:true, via:'email' } when ntfy took it; otherwise
 * { ok:false, via:'mailto', mailto, text, why } for the page to open the mail app.
 */
async function sendRequest({ songs, contact, note, name, version }, { post = httpsPost, topic = randomTopic() } = {}) {
  const text = requestBody({ songs, contact, note, name, version });
  try {
    const r = await post({
      host: NTFY_HOST,
      path: `/${topic}`,
      headers: { Email: REQUEST_EMAIL, Title: REQUEST_TITLE, 'Content-Type': 'text/plain; charset=utf-8' },
      body: text,
    });
    if (r && r.status >= 200 && r.status < 300) return { ok: true, via: 'email', text };
    return { ok: false, via: 'mailto', mailto: mailtoFor(text), text, why: `The mail service answered ${r ? r.status : 'nothing'}.` };
  } catch (err) {
    return { ok: false, via: 'mailto', mailto: mailtoFor(text), text, why: err && err.message ? err.message : 'No connection.' };
  }
}

module.exports = { REQUEST_EMAIL, REQUEST_TITLE, REQUEST_GAP, NTFY_HOST, randomTopic, songsOf, requestBody, mailtoFor, httpsPost, sendRequest };
