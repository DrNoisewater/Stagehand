import {api} from './api.js';
import {toast} from './ui.js';
import {nowPlayingTone} from './tonelib.js';
import {createSoundTrack} from './clip-sound.js';
/** Captures our own window and internal audio; never OS loopback.
 *  With the native engine (the Rocksmith cable) the sound is collected straight from the
 *  engine, the same way the looper gets it. (4.0.6: the sound used to go through a hidden
 *  audio player into the video recorder, and on a real PC the clip could come out silent.)
 *  4.0.7: video and sound go to disk every second while recording (clip-sessions.js in the
 *  app); nothing big is kept here. A whole song's video used to be kept in the page and
 *  copied again to save it, and the page ran out of memory and went blank. */
/** title(): what the file is called after "SH - " (the song's title, or Jam Session).
 *  about(): what's being played, kept with the clip for Backstage (4.3): { song, part, tuning, speed }. */
const LIMIT_S=600; // 10 minutes
const fmt=(s)=>`${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`;
export function createClipRecorder({rig,engine,title=()=>'Jam Session',songId=()=>null,about=()=>null}){
  // the song, the part, and the tone playing when the recording starts
  const details=()=>{let a={};try{a={...(about()||{})};}catch(_){}
    const instrument=rig&&rig.instrument==='bass'?'bass':'guitar';let tone=null;
    try{const t=nowPlayingTone().tone;if(t&&Array.isArray(t.gear)&&t.gear.length)tone={name:t.name,kind:t.kind||instrument,gear:t.gear,capture:t.capture||null,cabId:t.cabId||null,autoCab:t.autoCab!==false};}catch(_){}
    return{...a,instrument,tone};};
  let startedAt=0;
  let recorder=null,video=null,monitor=null,extra=null,dest=null,timer=null,done=null,session=null,send=Promise.resolve(),beat=0,pieces=Promise.resolve(),soundBytes=0;
  let pcm=null; // native: {handle, track (clip-sound.js), rate}
  let watch=0,lostAt=0,lostTold=false;
  function clean(){clearTimeout(timer);clearInterval(beat);clearInterval(watch);video?.getTracks().forEach(t=>t.stop());extra?.disconnect(dest);monitor?.close();pcm?.handle?.close();video=monitor=extra=dest=null;recorder=null;api.app.activity('').catch(()=>{});}
  // pieces go out one after another, in order; a full disk or the size limit stops the recording
  const put=(kind,bytes)=>{const id=session;send=send.then(()=>id&&api.clips.chunk(id,kind,bytes)).then(r=>{if(r&&r.full&&recorder?.state==='recording'){toast({title:'Recording stopped',message:'It reached the size limit.',kind:'info'});recorder.stop();}}).catch(e=>{if(recorder?.state==='recording'){toast({title:'Recording stopped',message:e.message,kind:'err'});recorder.stop();}});return send;};
  // the sound so far, on the recording's clock (gaps are filled with silence: clip-sound.js)
  const flushSound=(end=false)=>{if(!pcm)return;const all=pcm.track.take(performance.now(),{end});if(!all)return;soundBytes+=all.byteLength;put('a',new Uint8Array(all.buffer));};
  const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
  /** 4.1.2: never record without sound. Wait until the engine's sound reaches us;
   *  if it doesn't, ask again, then restart the engine once; if it still doesn't,
   *  don't start (saying why) rather than record minutes of silence. */
  async function soundCheck(p){
    const arrived=async(ms)=>{const until=performance.now()+ms;while(performance.now()<until){if(p.track.seen)return true;await sleep(50);}return p.track.seen;};
    if(await arrived(1200))return;
    rig.monitorOn();
    if(await arrived(1200))return;
    toast({title:'Waking the sound engine',message:'Sound wasn’t reaching the recorder. Restarting it once (a second of quiet).',kind:'info'});
    await rig.restart();
    if(rig.kind==='native'&&await arrived(2500))return;
    throw Error('The recording didn’t start: no sound reached the recorder, even after restarting the sound engine. Turn the guitar off and on in the guitar card, then try again.');
  }
  /** While recording: if the sound stops, reconnect at once and say so on screen. */
  function watchSound(){
    clearInterval(watch);lostAt=0;lostTold=false;
    watch=setInterval(()=>{
      if(!pcm||!recorder||recorder.state!=='recording')return;
      const now=performance.now();
      if(!pcm.track.gap(now)){if(lostTold)toast({title:'Sound is back in the recording',message:'The gap is filled with silence, so it stays in step.',kind:'ok',timeout:3000});lostAt=0;lostTold=false;return;}
      if(!lostAt)lostAt=now;
      rig.monitorOn(); // ask the engine in use now (it may have restarted) to send again
      if(!lostTold&&now-lostAt>1500){lostTold=true;toast({title:'Sound dropped out',message:rig.on?'Reconnecting. The recording carries on.':'The guitar was disconnected. The recording carries on and the sound comes back when it reconnects.',kind:'err',timeout:5000});}
    },400);
  }
  return {
    get active(){return !!recorder&&recorder.state==='recording';},
    async start(){
      if(recorder)return;
      if(!rig.on)throw Error('Connect your instrument before recording a take.');
      try{
        toast({title:'Preparing 1080p / 60 fps recording',message:'The video encoder downloads automatically on first use.',kind:'info'});
        await api.clips.prepare();
        const source=await api.clips.source();
        video=await navigator.mediaDevices.getUserMedia({audio:false,video:{mandatory:{chromeMediaSource:'desktop',chromeMediaSourceId:source,maxWidth:1920,maxHeight:1080,minFrameRate:60,maxFrameRate:60}}});
        let audioTracks=[];
        if(rig.kind==='native'){
          const rate=rig.backend?.rate||48000;
          pcm={handle:null,rate,track:createSoundTrack(rate)};
          const p=pcm;
          p.handle=rig.captureMix((d,r)=>p.track.feed(d,r,performance.now()));
          await soundCheck(p);
          pcm.rate=p.track.rate;
        }else{
          monitor=await rig.monitorMix();dest=monitor.ctx.createMediaStreamDestination();monitor.node.connect(dest);
          await engine.ensure?.();
          const songDest=engine.ctx.createMediaStreamDestination();engine.masterAnalyser.connect(songDest);
          extra=monitor.ctx.createMediaStreamSource(songDest.stream);extra.connect(dest);
          const oldClose=monitor.close;monitor.close=()=>{engine.masterAnalyser.disconnect(songDest);monitor.node.disconnect(dest);oldClose();};
          audioTracks=dest.stream.getAudioTracks();
        }
        const stream=new MediaStream([...video.getVideoTracks(),...audioTracks]);
        video.getVideoTracks()[0].contentHint='motion';
        const kinds=audioTracks.length?['video/mp4;codecs=avc1.42002A,mp4a.40.2','video/webm;codecs=h264,opus','video/webm;codecs=vp8,opus','video/webm']:['video/mp4;codecs=avc1.42002A','video/webm;codecs=h264','video/webm;codecs=vp8','video/webm'];
        const mime=kinds.find(x=>MediaRecorder.isTypeSupported(x));
        if(!mime)throw Error('Video recording is unavailable on this system.');
        const name=title()||'Jam Session';
        session=await api.clips.begin({title:name,songId:songId(),rate:pcm?pcm.rate:48000,about:details()});
        send=Promise.resolve();pieces=Promise.resolve();soundBytes=0;
        // 10 Mbit/s: the saved MP4 is made again from this at full quality, so more only costs disk
        recorder=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:10000000,...(audioTracks.length?{audioBitsPerSecond:256000}:{})});
        done=new Promise((resolve,reject)=>{
          recorder.ondataavailable=e=>{const d=e.data;pieces=pieces.then(async()=>{if(d.size)put('v',new Uint8Array(await d.arrayBuffer()));flushSound();});};
          recorder.onerror=e=>{const id=session;session=null;clean();if(id)api.clips.cancel(id).catch(()=>{});reject(Error(e.error?.message||'Video encoder failed.'));};
          recorder.onstop=async()=>{try{
            const endAt=performance.now();
            // the last piece of video arrives just before this: let it go out, then the sound
            // (topped up to the full length if it was cut short at the end)
            await pieces;if(pcm){const a=pcm.track.take(endAt,{end:true});if(a){soundBytes+=a.byteLength;put('a',new Uint8Array(a.buffer));}}await send;
            const id=session;session=null;clean();pcm=null;
            const seconds=(performance.now()-startedAt)/1000;
            toast({title:'Saving the video…',message:`${fmt(seconds)} long.`,kind:'info',timeout:3000});
            const saved=await api.clips.finish(id,{seconds});
            const open=saved&&saved.take?[{label:'My clips',onClick:()=>import('./greenroom.js').then(r=>r.openGreenRoom({tab:'mine',focus:saved.take.id}))}]:[];
            // (the sound was checked before recording and watched all through: 4.1.2)
            if(saved&&saved.take)toast({title:`Saved “${saved.take.name}”`,message:'Backstage, under My clips. Show it there if you want everyone to see it.',kind:'ok',actions:open});
            resolve(saved&&saved.path);}catch(e){clean();reject(e);}};
        });
        // Catch auto-stop failures as well as explicit save failures.
        done.catch(e=>toast({title:'Could not export clip',message:e.message,kind:'err'}));
        recorder.start(1000);startedAt=performance.now();if(pcm){pcm.track.begin(startedAt);watchSound();}
        const doing=()=>api.app.activity(`Recording a video of ${name} (${fmt((performance.now()-startedAt)/1000)} in)`).catch(()=>{});
        doing();beat=setInterval(doing,5000);
        timer=setTimeout(()=>{if(recorder?.state==='recording')recorder.stop();},LIMIT_S*1000);
        video.getVideoTracks()[0].onended=()=>{if(recorder?.state==='recording')recorder.stop();};
        toast({title:'Recording',message:`Up to 10 minutes. Saved as “SH - ${name}” in your recordings.`,kind:'info'});
      }catch(e){const id=session;session=null;pcm=null;clean();if(id)api.clips.cancel(id).catch(()=>{});throw e;}
    },
    async stop(){if(recorder?.state==='recording')recorder.stop();return done;}
  };
}
