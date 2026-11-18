'use strict';
/**
 * 4.25: the song finder hides the ads on the song site.
 *  - AD_HOSTS: ad and tracker sites. Anything the finder's pages ask of them is stopped
 *    before it leaves the PC (session.webRequest in finder.js).
 *  - AD_CSS: put on the song site's own pages to hide the empty boxes ads sit in.
 * Kept careful: the song site, Google sign-in and Drive, and the file sites songs are on
 * must keep working, so google.com, gstatic.com and googleapis.com are never on the list.
 */

const AD_HOSTS = [
  // Google's ad side (not google.com itself: sign-in and Drive live there)
  'doubleclick.net',
  'googlesyndication.com',
  'googleadservices.com',
  'adservice.google.com',
  'googletagservices.com',
  'google-analytics.com',
  'fundingchoicesmessages.google.com',
  'imasdk.googleapis.com',
  // ad exchanges and networks
  'amazon-adsystem.com',
  'adnxs.com',
  'taboola.com',
  'outbrain.com',
  'criteo.com',
  'criteo.net',
  'pubmatic.com',
  'rubiconproject.com',
  'openx.net',
  'media.net',
  'casalemedia.com',
  'indexww.com',
  'sharethrough.com',
  '33across.com',
  'smartadserver.com',
  'adform.net',
  'bidswitch.net',
  '3lift.com',
  'lijit.com',
  'sovrn.com',
  'yieldmo.com',
  'teads.tv',
  'revcontent.com',
  'mgid.com',
  'adskeeper.com',
  'bidvertiser.com',
  'zedo.com',
  'advertising.com',
  'moatads.com',
  'adsafeprotected.com',
  'doubleverify.com',
  'scorecardresearch.com',
  'quantserve.com',
  'quantcount.com',
  // pop-up and pop-under networks (the ones that open other programs' download pages)
  'propellerads.com',
  'popads.net',
  'popcash.net',
  'adsterra.com',
  'exoclick.com',
  'juicyads.com',
  'trafficjunky.net',
  'hilltopads.net',
  'clickadu.com',
  'adcash.com',
  'onclickads.net',
  'onclkds.com',
  'galaksion.com',
  'ad-maven.com',
  'admaven.com',
  'monetag.com',
  'a-ads.com',
  'coinzilla.io',
  'richpush.co',
  'pushame.com',
];

/** Sites that must never be stopped, even if a list entry ever came to cover them. */
const NEVER = ['customsforge.com', 'google.com', 'accounts.google.com', 'drive.google.com', 'gstatic.com', 'googleapis.com', 'googleusercontent.com', 'recaptcha.net'];

/** Is this host (or a URL) an ad or tracker site? */
function isAdHost(hostOrUrl) {
  let host = String(hostOrUrl || '').toLowerCase();
  if (host.includes('/')) {
    try {
      host = new URL(host).hostname.toLowerCase();
    } catch (_) {
      return false;
    }
  }
  host = host.replace(/\.$/, '');
  if (!host) return false;
  const hit = AD_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
  if (!hit) return false;
  // an exact never-block site wins (adservice.google.com is still an ad host: it is not google.com itself)
  return !NEVER.includes(host);
}

/**
 * Hides the boxes ads sit in. Careful: never a box that holds the song table, the search box,
 * a form, the site's menu or a download button (the :has() guard), nor the page itself, so a site's own layout can't be caught by it.
 */
const AD_BOXES = [
  'ins.adsbygoogle',
  '.adsbygoogle',
  '[id^="google_ads"]',
  '[id^="div-gpt-ad"]',
  '[data-ad-slot]',
  '[data-ad-client]',
  '[data-ad-unit]',
  'iframe[src*="doubleclick.net"]',
  'iframe[src*="googlesyndication.com"]',
  'iframe[src*="amazon-adsystem.com"]',
  'iframe[src*="adnxs.com"]',
  'iframe[id^="google_ads_iframe"]',
  // class or id names that start with these words ("ad-slot", "ad-slot-top", "x ad-banner"), never
  // ones that merely contain them ("download-slot", "head-banner" hold "ad-" too)
  ...['ad-slot', 'adslot', 'ad-banner', 'ad-container', 'ad-wrapper', 'ad-unit', 'adunit', 'sponsored-ad'].flatMap((w) => [`[class^="${w}" i]`, `[class*=" ${w}" i]`, `[id^="${w}" i]`]),
  '[class*="advert" i]',
  '[id*="advert" i]',
  '[aria-label="Advertisement" i]',
  '[aria-label="Advertisements" i]',
];
const AD_CSS = `:is(${AD_BOXES.join(', ')}):not(html, body, main, #app, #root):not(:has(table, input, textarea, select, form, nav, [role=table], [role=grid], [role=navigation], [download], a[href*="download" i])) { display: none !important; }`;

module.exports = { AD_HOSTS, isAdHost, AD_CSS, AD_BOXES };
