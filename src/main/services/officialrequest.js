'use strict';
/**
 * 4.25: asking Noisewater Labs for official Rocksmith DLC songs. 4.26: one request asks for
 * all of them (the player doesn't pick songs; Noisewater Labs sends every file).
 *
 * Official (paid) songs can't be downloaded, so the Official DLC page lets the player ask
 * for them. There is no Stagehand server: the request goes out as an e-mail through ntfy.sh
 * (already used by Backstage), posted to a random topic with ntfy's Email header. When that
 * fails it goes through FormSubmit (an e-mail form service). When both fail, the Discover
 * service keeps it and tries again by itself later. The player is never sent to a mail app.
 * Node built-ins only.
 */
const https = require('https');
const crypto = require('crypto');

/** Where these requests go. The owner asked for exactly this address. */
const REQUEST_EMAIL = 'jferguson2194@hotmail.com';
const REQUEST_TITLE = 'Stagehand song request';
const NTFY_HOST = 'ntfy.sh';
const FORM_HOST = 'formsubmit.co';
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

/**
 * The request in plain words. 4.26: the player no longer picks songs: `all` asks for every
 * official song they don't have, and the e-mail stays short (how many, not the list).
 */
function requestBody({ songs, all = false, count = 0, contact, note, name, version }) {
  const n = Number(count) || (songs ? songs.length : 0);
  const lines = [all ? `A Stagehand player is asking for all the official Rocksmith DLC they don't have${n ? ` (${n} songs)` : ''}.` : 'A Stagehand player is asking for these official Rocksmith songs.', ''];
  lines.push(`Reach them at: ${clean(contact, 200)}`);
  if (clean(name, 80)) lines.push(`Backstage name: ${clean(name, 80)}`);
  if (!all) {
    lines.push('');
    lines.push(`Songs (${songs.length}):`);
    for (const s of songs) lines.push(`- ${s.artist ? `${s.artist} – ` : ''}${s.title}`);
  }
  const words = String(note == null ? '' : note).trim().slice(0, 2000);
  if (words) lines.push('', 'Note:', words);
  lines.push('', `Sent from Stagehand${version ? ` ${clean(version, 40)}` : ''}.`);
  return lines.join('\n');
}

/** POST over HTTPS; resolves { status, body } or rejects on a network failure or after 15 s. */
function httpsPost({ host, path, headers, body, timeout = 15000 }) {
  return new Promise((resolve, reject) => {
    const data = Buffer.from(body, 'utf8');
    const req = https.request({ host, path, method: 'POST', headers: { ...headers, 'Content-Length': data.length }, timeout }, (res) => {
      const parts = [];
      let size = 0;
      res.on('data', (c) => {
        size += c.length;
        if (size < 64 * 1024) parts.push(c);
      });
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(parts).toString('utf8') }));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('timed out')));
    req.on('error', reject);
    req.end(data);
  });
}

const looksLikeEmail = (s) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(s || '').trim());

/** 1) ntfy.sh with its Email header: any 2xx answer is taken. */
async function viaNtfy(text, { post, topic }) {
  const r = await post({
    host: NTFY_HOST,
    path: `/${topic}`,
    headers: { Email: REQUEST_EMAIL, Title: REQUEST_TITLE, 'Content-Type': 'text/plain; charset=utf-8' },
    body: text,
  });
  if (r && r.status >= 200 && r.status < 300) return true;
  throw new Error(`ntfy answered ${r ? r.status : 'nothing'}`);
}

/** 2) FormSubmit's JSON form: taken when its reply says success. */
async function viaForm(text, { contact, name }, { post }) {
  const msg = { name: String(name || '').trim().slice(0, 80) || 'A Stagehand player', message: text, _subject: REQUEST_TITLE, _template: 'table', _captcha: 'false' };
  if (looksLikeEmail(contact)) msg.email = String(contact).trim();
  const r = await post({
    host: FORM_HOST,
    path: `/ajax/${REQUEST_EMAIL}`,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(msg),
  });
  let j = null;
  try {
    j = JSON.parse((r && r.body) || 'null');
  } catch (_) {}
  if (r && r.status >= 200 && r.status < 300 && j && (j.success === true || j.success === 'true')) return true;
  throw new Error(`FormSubmit answered ${r ? r.status : 'nothing'}${j && j.message ? `: ${j.message}` : ''}`);
}

/**
 * Send one request: ntfy.sh first, then FormSubmit. { ok:true, via:'ntfy'|'formsubmit', text },
 * or { ok:false, text, why } when neither took it (the caller keeps it and tries again later).
 */
async function sendRequest({ songs, all, count, contact, note, name, version }, { post = httpsPost, topic = randomTopic() } = {}) {
  const text = requestBody({ songs, all, count, contact, note, name, version });
  const why = [];
  try {
    if (await viaNtfy(text, { post, topic })) return { ok: true, via: 'ntfy', text };
  } catch (err) {
    why.push(err && err.message ? err.message : 'ntfy failed');
  }
  try {
    if (await viaForm(text, { contact, name }, { post })) return { ok: true, via: 'formsubmit', text };
  } catch (err) {
    why.push(err && err.message ? err.message : 'FormSubmit failed');
  }
  return { ok: false, text, why: why.join('; ') };
}

module.exports = { REQUEST_EMAIL, REQUEST_TITLE, REQUEST_GAP, NTFY_HOST, FORM_HOST, randomTopic, songsOf, requestBody, httpsPost, sendRequest, looksLikeEmail };
