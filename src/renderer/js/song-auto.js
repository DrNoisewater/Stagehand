import {rig} from './rig.js';
import {engine} from './stage.js';
import {state,on} from './store.js';
let lastTab=null,lastTone=null,lastSong=null;
export function refreshSongTone(force=false){
 const hw=document.querySelector('.highway:not([hidden])')?.__hw,p=window.__shPractice;
 const tab=hw?.tab||(p?.song?.id===state.nowPlaying?p.tab:null);
 if(!rig.autoSong||!rig.on||!tab?.songTones)return;
 const st=tab.songTones;let key=st.base;for(const c of st.changes||[])if(c.t<=engine.position+.02)key=c.key;else break;
 const tone=st.tones.find(t=>t.key===key)||st.tones[0];if(!tone)return;
 if(force||tab!==lastTab||tone!==lastTone||state.nowPlaying!==lastSong||rig.mode!=='song'){
  if(tab!==lastTab)rig.prepareTones(st.tones);lastTab=tab;lastTone=tone;lastSong=state.nowPlaying;rig.setSongTone(tone);
 }
}
rig.addEventListener('song-auto',()=>refreshSongTone(true));on('practice',()=>refreshSongTone());engine.addEventListener('seek',()=>refreshSongTone());setInterval(()=>refreshSongTone(),40);
