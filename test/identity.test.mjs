import assert from 'node:assert/strict';
import { ArtDirector, MenuArtVisits } from '../src/renderer/js/art-rotation.mjs';
import { VenueRotation } from '../src/renderer/js/venue-rotation.mjs';
import { readFileSync, existsSync } from 'node:fs';
const memory = () => { const map = new Map(); return {getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v)}; };
const storage=memory(),session=memory(); const ids=['amp','bass','crate'];
const a=new ArtDirector({storage,session,random:()=>.4});
const first=a.choose('jam',ids);
for(let i=0;i<100;i++) assert.equal(a.choose('jam',ids),first,'rerenders must not advance art');
const b=new ArtDirector({storage,session}); assert.equal(b.choose('jam',ids),first,'reload keeps session art');
const cycle=[first,a.choose('jam',ids,{next:true}),a.choose('jam',ids,{next:true})]; assert.equal(new Set(cycle).size,3,'all alternatives before repeating');
let last=cycle.at(-1); for(let i=0;i<50;i++){const n=a.choose('jam',ids,{next:true});assert.notEqual(n,last,'no immediate repeats');last=n;}
a.pin('jam','bass');assert.equal(a.choose('jam',ids,{next:true}),'bass');
const c=new ArtDirector({storage,session:memory()});assert.equal(c.choose('jam',ids),'bass','pin survives a new session');
a.pin('jam',null); assert(ids.includes(a.choose('jam',ids)));
assert.equal(a.choose('empty',[]),null);assert.equal(a.choose('only',['amp'],{next:true}),'amp');
const broken={getItem(){throw Error('denied')},setItem(){throw Error('full')}}; const d=new ArtDirector({storage:broken,session:broken});const stable=d.choose('jam',ids);assert.equal(d.choose('jam',ids),stable);
const v=new VenueRotation({storage:memory(),random:()=>.2});const opts={enabled:true,eligible:['studio','cellar'],fallback:'warehouse'};const room=v.forSong('one',opts);for(let i=0;i<100;i++)assert.equal(v.forSong('one',opts),room);assert.notEqual(v.forSong('two',opts),room);v.use('studio');assert.equal(v.forSong('two',opts),'studio');assert.equal(v.forSong('three',{...opts,enabled:false}),'warehouse');
const m=JSON.parse(readFileSync(new URL('../src/renderer/art/manifest.json',import.meta.url)));for(const art of m.assets)assert(existsSync(new URL('../src/renderer/art/'+art.file,import.meta.url)));for(const placement of Object.values(m.placements)){assert(placement.length>=3);for(const id of placement)assert(m.assets.some(a=>a.id===id));}
for(const [pool,list] of Object.entries(m.events||{})){assert(list.length>=1,pool);for(const id of list)assert(m.assets.some(a=>a.id===id),`${pool}: ${id}`);}
console.log('identity: session stability, shuffle cycles, pins, unavailable storage, venue song boundaries and asset manifest all passed');

const corrupt=memory();corrupt.setItem('stagehand.art.v1:jam','null');assert(ids.includes(new ArtDirector({storage:corrupt}).choose('jam',ids)));

// Return visits advance menu art; rerenders and highway routes cannot consume it.
const menuDirector = new ArtDirector({storage:memory(),session:memory(),random:()=>.3});
const visits = new MenuArtVisits(menuDirector);
const pools = {play:ids,songs:ids,'sidebar-play':ids,'empty-play':ids};
visits.enter('play',pools);
const start = menuDirector.choose('play',ids);
visits.enter('play',pools);
assert.equal(menuDirector.choose('play',ids),start);
visits.enter('now',pools);
assert.equal(menuDirector.choose('play',ids),start,'highway leaves decoration unchanged');
visits.enter('play',pools);
assert.notEqual(menuDirector.choose('play',ids),start,'return from highway is a menu visit');
const second = menuDirector.choose('play',ids);
visits.enter('songs',pools);visits.enter('play',pools,{rotate:false});
assert.equal(menuDirector.choose('play',ids),second,'rotation preference respected');
menuDirector.pin('play',start);
visits.enter('songs',pools);visits.enter('play',pools);
assert.equal(menuDirector.choose('play',ids),start,'pin wins over navigation shuffle');
const offline = new ArtDirector({storage:broken,session:broken,random:()=>.3});
const offlineCycle = ids.map(()=>offline.choose('offline',ids,{next:true}));
assert.equal(new Set(offlineCycle).size,ids.length,'shuffle bag works when storage fails');
assert(!m.placements.now && !m.placements.highway,'no highway illustration pool');
console.log('menu art: visits, stable rerenders, pins, opt-out, highway exclusion and offline shuffle passed');
