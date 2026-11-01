import {h,toast,isTyping} from './ui.js';
import {createTuner} from './tuner.js';
import {scoreHit,matchDelta} from './performance-math.js';
import {createClipRecorder} from './take-video.js';

export function createPerformanceTools({root,stage,H,rig}){
  const eng=stage.engine;
  const toneKey=()=>rig.mode==='song'?rig.songTone:rig.mode==='live'?rig.liveTone:rig.toneId;
  const row=h('div.hw-tools');root.append(row);
  const button=(text,title,fn)=>{const b=h('button.hw-chip',{type:'button',text,title});b.onclick=fn;row.append(b);return b;};
  const tuner=createTuner();tuner.el.classList.add('hw-mini-tuner');tuner.el.hidden=true;root.append(tuner.el);
  const toggleTuner=()=>{tuner.el.hidden=!tuner.el.hidden;tuner.el.hidden?tuner.hide():tuner.show();};
  button('Tuner · U','Open tuner without leaving the song (U)',toggleTuner);
  const hud=h('div.attack-hud',{hidden:true});root.append(hud);
  let run=null,seen=new Set(),last=0,runSong=null,runPart=null,personalBest=0;
  eng.addEventListener('seek',()=>{if(run)run.valid=false;});
  eng.addEventListener('speed',()=>{if(run&&eng.speed!==1)run.valid=false;});
  const draw=()=>{hud.innerHTML=`<small>Score attack · ×${run.multiplier}</small><b>${run.points.toLocaleString()}</b><span>${run.combo} streak${run.valid?'':' · practice run'} · Best ${personalBest.toLocaleString()}</span>`;};
  const attack=button('Score attack','Start a full-speed run from the beginning',()=>{
    if(!H.tab||!rig.on) return toast({title:'Connect your instrument first',kind:'info'});
    if(run){run=null;hud.hidden=true;attack.setAttribute('aria-pressed','false');return;}
    stage.setLoop?.(null);eng.setSpeed(1);stage.seek(0);
    H.judge?.reset(0);seen.clear();last=0;runSong=H.song.id;runPart=H.tab.id;
    try{personalBest=Math.max(0,...JSON.parse(localStorage.getItem(`stagehand.attack:${runSong}:${runPart}`)||'[]').map(r=>r.points));}catch{personalBest=0;}
    run={points:0,combo:0,multiplier:1,bestCombo:0,valid:true};hud.hidden=false;attack.setAttribute('aria-pressed','true');draw();
    if(!eng.playing)stage.toggle();
  });
  const clip=createClipRecorder({rig,engine:eng});
  const rec=button('● Record clip','Save highway video with the audible song and processed instrument',async()=>{
    rec.disabled=true;
    try{if(clip.active){rec.textContent='Exporting MP4…';await clip.stop();rec.textContent='● Record clip';}else{await clip.start();rec.textContent='■ Save clip';}}
    catch(e){rec.textContent='● Record clip';toast({title:'Clip recording',message:e.message,kind:'err'});}finally{rec.disabled=false;}
  });
  const panel=h('section.perf-panel',{hidden:true});root.append(panel);
  let matching=false,cancelMatch=false,undo=null,matched=null,matchTone=null,matchOn=false;
  const leaderboard=h('section.perf-panel',{hidden:true});root.append(leaderboard);
  const closeBoard=h('button.btn.soft',{text:'Close'});closeBoard.onclick=()=>leaderboard.hidden=true;
  const match=button('Tone match · Off','Compare the guitar stem with your processed instrument',()=>{panel.hidden=!panel.hidden;});
  const info=h('p',{text:'Play the same riff along with the song for 8 seconds. We gently adjust bass, mids, treble and gain. Requires a separated guitar stem. Your mix can stay muted.'});
  const start=h('button.btn.glow-primary',{text:'Listen for 8 seconds'}), revert=h('button.btn.soft',{text:'Undo match',disabled:true});
  const toggle=h('button.btn.soft',{text:'Match off',disabled:true,'aria-pressed':'false'});
  const status=()=>{match.textContent=`Tone match · ${matching?'Listening':matchOn?'On':'Off'}`;match.setAttribute('aria-pressed',String(matchOn));toggle.textContent=matchOn?'Turn match off':'Turn match on';toggle.setAttribute('aria-pressed',String(matchOn));};
  const apply=(values)=>{for(const [k,v]of Object.entries(values))v===undefined?rig.resetKnob(k):rig.setKnob(k,v);};
  toggle.onclick=()=>{if(!matched||toneKey()!==matchTone)return;matchOn=!matchOn;apply(matchOn?matched:undo);status();rig.dispatchEvent(new Event('change'));};
  rig.addEventListener('change',()=>{if(matchTone&&toneKey()!==matchTone){undo=matched=null;matchOn=false;toggle.disabled=revert.disabled=true;status();}});
  panel.append(h('h3',{text:'Tone match · BETA'}),info,start,toggle,revert);
  revert.onclick=()=>{if(undo&&toneKey()===matchTone){apply(undo);undo=matched=null;rig._toneMatchOriginal=null;matchOn=false;toggle.disabled=revert.disabled=true;status();rig.dispatchEvent(new Event('change'));info.textContent='Original tone restored. Tone match is off.';}};
  start.onclick=async()=>{
    const index=stage.trackIndex('guitar'),track=eng.tracks[index];
    if(!track?.loaded||track.name!=='guitar'||!eng.playing||!rig.on)return toast({title:'Play a song with guitar stems and connect your instrument',kind:'info'});
    if(matching)return;
    matching=true;cancelMatch=false;start.disabled=true;status();
    if(matchOn&&undo){apply(undo);matchOn=false;}
    const reference=eng.ctx.createAnalyser();reference.fftSize=2048;
    const bins=new Float32Array(reference.frequencyBinCount),a=[0,0,0],b=[0,0,0];let count=0;
    // Tap the worklet before stem faders, never unmute the reference in the audible mix.
    eng.node.connect(reference,index,0);
    let monitor;
    try{
      monitor=await rig.monitorProcessed();
      const player=monitor.ctx.createAnalyser();player.fftSize=2048;monitor.node.connect(player);
      const pb=new Float32Array(player.frequencyBinCount);
      const bands=(an,arr,rate)=>{an.getFloatFrequencyData(arr);const out=[0,0,0];for(let i=1;i<arr.length;i++){const hz=i*rate/an.fftSize;if(hz<80||hz>7000)continue;out[hz<350?0:hz<1800?1:2]+=10**(arr[i]/10);}return out;};
      const initialTone=toneKey(), initialSong=H.song.id;
      for(let n=0;n<80&&!cancelMatch;n++){
        await new Promise(r=>setTimeout(r,100));
        if(!eng.playing||!H.open||H.song.id!==initialSong||toneKey()!==initialTone)throw Error('Match stopped because playback or tone changed.');
        const x=bands(reference,bins,eng.ctx.sampleRate),y=bands(player,pb,monitor.ctx.sampleRate);
        if(x.reduce((s,v)=>s+v,0)>1e-7&&y.reduce((s,v)=>s+v,0)>1e-7){x.forEach((v,i)=>a[i]+=v);y.forEach((v,i)=>b[i]+=v);count++;}
        info.textContent=`Listening… ${Math.ceil((80-n)/10)} seconds. Play the same riff.`;
      }
      if(cancelMatch)return;
      const delta=matchDelta(a,b);if(count<15||!delta)throw Error('Not enough guitar signal. Try a louder section and play along.');
      undo=Object.fromEntries(['bass','mid','treble','gain'].map(k=>[k,rig.knobs[k]]));
      ['bass','mid','treble'].forEach((k,i)=>rig.setKnob(k,(rig.knobs[k]??.5)+delta[i]));
      // A conservative brightness-based gain nudge, not a claim to recover the original amp.
      const dg=Math.max(-.04,Math.min(.04,delta[2]*.25));rig.setKnob('gain',(rig.knobs.gain??rig.tone?.gain??.5)+dg);
      rig._toneMatchOriginal={...undo};
      matched=Object.fromEntries(['bass','mid','treble','gain'].map(k=>[k,rig.knobs[k]]));matchTone=initialTone;matchOn=true;toggle.disabled=false;status();
      rig.dispatchEvent(new Event('change'));revert.disabled=false;info.textContent=`Matched gently. EQ changes: ${delta.map(x=>`${x>=0?'+':''}${Math.round(x*100)}`).join(' / ')}%. Use On/Off to compare. Undo restores your original tone.`;
    }catch(e){info.textContent=e.message;}finally{eng.node.disconnect(reference);monitor?.close();matching=false;start.disabled=false;status();}
  };
  const timer=setInterval(()=>{
    if(!H.open)return;
    if(run){const pos=eng.position;if(pos<last-.15||eng.speed!==1||stage.getLoop?.()||!rig.on||H.song.id!==runSong||H.tab?.id!==runPart)run.valid=false;last=pos;draw();}
    if(!clip.active&&rec.textContent==='■ Save clip')rec.textContent='● Record clip';
  },250);
  document.addEventListener('keydown',e=>{if(!H.open||isTyping()||e.ctrlKey||e.altKey||e.metaKey)return;if(e.key.toLowerCase()==='u'){e.preventDefault();toggleTuner();}});
  return {
    judged(e){if(!run||seen.has(e.id))return;if(stage.getLoop?.()||eng.speed!==1)run.valid=false;seen.add(e.id);scoreHit(run,!!e.hit);draw();},
    ended(){
      if(!run)return;
      if(run.valid&&seen.size>=20&&seen.size>=H.targets.filter(t=>!t.linked).length*.9){
        const key=`stagehand.attack:${H.song.id}:${H.tab.id}`;
        let runs=[];try{runs=JSON.parse(localStorage.getItem(key)||'[]');}catch{}
        runs.push({...run,at:Date.now()});runs.sort((a,b)=>b.points-a.points);runs=runs.slice(0,10);localStorage.setItem(key,JSON.stringify(runs));
        leaderboard.replaceChildren(h('h3',{text:'Your score attack leaderboard'}),...runs.map((r,i)=>h('p',{text:`${i+1}. ${r.points.toLocaleString()} points · ${r.bestCombo} streak · ${new Date(r.at).toLocaleDateString()}`})),closeBoard);leaderboard.hidden=false;
      }else toast({title:'Practice run complete',message:'Leaderboard runs require a full song at 100% speed, without seeks or loops.',kind:'info'});
      run=null;hud.hidden=true;attack.setAttribute('aria-pressed','false');
    },
    close(){if(undo&&toneKey()===matchTone){apply(undo);rig._toneMatchOriginal=null;undo=matched=null;matchOn=false;toggle.disabled=revert.disabled=true;status();}cancelMatch=true;leaderboard.hidden=true;tuner.hide();tuner.el.hidden=true;panel.hidden=true;run=null;hud.hidden=true;attack.setAttribute('aria-pressed','false');if(clip.active)clip.stop().catch(e=>toast({title:'Clip could not be saved',message:e.message,kind:'err'}));}
  };
}
