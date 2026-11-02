import {api} from './api.js';
import {toast} from './ui.js';
/** Captures our own window and internal audio; never OS loopback.
 *  With the native engine (the Rocksmith cable) the sound is collected straight from the
 *  engine, the same way the looper gets it. (4.0.6: the sound used to go through a hidden
 *  audio player into the video recorder, and on a real PC the clip could come out silent.)
 *  4.0.7: video and sound go to disk every second while recording (clip-sessions.js in the
 *  app); nothing big is kept here. A whole song's video used to be kept in the page and
 *  copied again to save it, and the page ran out of memory and went blank. */
/** title(): what the file is called after "SH - " (the song's title, or Jam Session). */
const LIMIT_S=600; // 10 minutes
const fmt=(s)=>`${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`;
export function createClipRecorder({rig,engine,title=()=>'Jam Session',songId=()=>null}){
  let startedAt=0;
  let recorder=null,video=null,monitor=null,extra=null,dest=null,timer=null,done=null,session=null,send=Promise.resolve(),beat=0,pieces=Promise.resolve(),soundBytes=0;
  let pcm=null; // native: {handle, rate, parts: Int16Array[], n, on}
  function clean(){clearTimeout(timer);clearInterval(beat);video?.getTracks().forEach(t=>t.stop());extra?.disconnect(dest);monitor?.close();pcm?.handle?.close();video=monitor=extra=dest=null;recorder=null;api.app.activity('').catch(()=>{});}
  // pieces go out one after another, in order; a full disk or the size limit stops the recording
  const put=(kind,bytes)=>{const id=session;send=send.then(()=>id&&api.clips.chunk(id,kind,bytes)).then(r=>{if(r&&r.full&&recorder?.state==='recording'){toast({title:'Recording stopped',message:'It reached the size limit.',kind:'info'});recorder.stop();}}).catch(e=>{if(recorder?.state==='recording'){toast({title:'Recording stopped',message:e.message,kind:'err'});recorder.stop();}});return send;};
  const flushSound=()=>{if(!pcm||!pcm.n)return;soundBytes+=pcm.n*2;const all=new Int16Array(pcm.n);let o=0;for(const q of pcm.parts){all.set(q,o);o+=q.length;}pcm.parts=[];pcm.n=0;put('a',new Uint8Array(all.buffer));};
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
          pcm={handle:null,rate:rig.backend?.rate||48000,parts:[],n:0,on:false};
          const p=pcm;
          p.handle=rig.captureMix((d,rate)=>{
            if(!p.on)return;
            p.rate=rate;
            const q=new Int16Array(d.length&~1);
            for(let i=0;i<q.length;i++){const x=d[i];q[i]=x>=1?32767:x<=-1?-32768:Math.round(x*32767);}
            p.parts.push(q);p.n+=q.length;
          });
          pcm.rate=pcm.handle.rate||pcm.rate;
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
        session=await api.clips.begin({title:name,songId:songId(),rate:pcm?pcm.rate:48000});
        send=Promise.resolve();pieces=Promise.resolve();soundBytes=0;
        // 10 Mbit/s: the saved MP4 is made again from this at full quality, so more only costs disk
        recorder=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:10000000,...(audioTracks.length?{audioBitsPerSecond:256000}:{})});
        done=new Promise((resolve,reject)=>{
          recorder.ondataavailable=e=>{const d=e.data;pieces=pieces.then(async()=>{if(d.size)put('v',new Uint8Array(await d.arrayBuffer()));flushSound();});};
          recorder.onerror=e=>{const id=session;session=null;clean();if(id)api.clips.cancel(id).catch(()=>{});reject(Error(e.error?.message||'Video encoder failed.'));};
          recorder.onstop=async()=>{try{
            if(pcm)pcm.on=false;
            // the last piece of video arrives just before this: let it go out, then the sound
            await pieces;flushSound();await send;
            const native=!!pcm;const id=session;session=null;clean();pcm=null;
            if(native&&!soundBytes)toast({title:'No sound reached the recording',message:'The video is saved without sound. Try turning the guitar off and on again before the next one.',kind:'err',timeout:8000});
            const seconds=(performance.now()-startedAt)/1000;
            toast({title:'Saving the video…',message:`${fmt(seconds)} long.`,kind:'info',timeout:3000});
            const saved=await api.clips.finish(id,{seconds});
            if(saved&&saved.take)toast({title:`Saved “${saved.take.name}”`,message:'In Recordings (the file is “SH - …mp4”).',kind:'ok',actions:[{label:'Recordings',onClick:()=>import('./recordings.js').then(r=>r.openRecordings({focus:saved.take.id}))}]});
            resolve(saved&&saved.path);}catch(e){clean();reject(e);}};
        });
        // Catch auto-stop failures as well as explicit save failures.
        done.catch(e=>toast({title:'Could not export clip',message:e.message,kind:'err'}));
        recorder.start(1000);startedAt=performance.now();if(pcm)pcm.on=true;
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
