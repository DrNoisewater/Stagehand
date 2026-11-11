/** Real renderer audit using ui3's real services, fixture songs and fake audio device. */
const path = require('path');
module.exports = async ({page, outDir, check, baseline}) => {
  const shot = async name => { await page.waitForTimeout(350); await page.screenshot({path:path.join(outDir, name+'.png')}); };
  const go = async name => { await page.evaluate(async name => (await import('./js/store.js')).setPage(name), name); await page.waitForTimeout(600); };
  for(let i=0;i<3 && await page.locator('.modal').count();i++) await page.keyboard.press('Escape');
  for(const name of ['play','songs','tones','discover','progress','greenroom']) {
    await go(name); await shot(name);
    check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),name+' fits the window');
  }
  await go('songs');
  await page.getByRole('button',{name:'Album tiles',exact:true}).click(); await shot('songs-tiles');
  await page.getByRole('button',{name:'List',exact:true}).click();
  const row=page.locator('.scroller .row').first(); if(await row.count()) {await row.click();await shot('song-details');}
  await page.locator('#search').fill('no-song-matches-identity'); await page.waitForTimeout(400); await shot('songs-empty');
  await page.locator('#search').fill(''); await page.waitForTimeout(350);
  await page.evaluate(async()=> (await import('./js/dialogs.js')).settings('guitar'));await shot('settings');await page.keyboard.press('Escape');
  for(const size of [{width:1280,height:800},{width:1024,height:768}]) {
    await page.setViewportSize(size);
    for(const name of ['play','songs','tones','discover','progress','greenroom']) {await go(name);await shot(name+'-'+size.width);}
  }
  await page.setViewportSize({width:1600,height:950});
  await page.emulateMedia({reducedMotion:'reduce'});await go('play');await shot('reduced-motion');
  if(!baseline) {
    check(await page.evaluate(()=>getComputedStyle(document.querySelector('.identity-banner')).animationName==='none'),'decorative header is static with reduced motion');
  }
};
