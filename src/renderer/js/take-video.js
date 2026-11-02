import {api} from './api.js';
import {toast} from './ui.js';
import {wavBytes} from './codec.js';
/** Captures our own window and internal audio; never OS loopback.
 *  With the native engine (the Rocksmith cable) the sound is collected straight from the
 *  engine, the same way the looper gets it, and saved next to the video as a WAV; the save
 *  step joins the two. (4.0.6: the sound used to go through a hidden audio player into the
 *  video recorder, and on a real PC the clip could come out silent.) */
/** title(): what the file is called after "SH - " (the song's title, or Jam Session). */
export function createClipRecorder({rig,engine,title=()=>'Jam Session',songId=()=>null}){
  let startedAt=0;
  let recorder=null,video=null,monitor=null,extra=null,dest=null,chunks=[],timer=null,bytes=0,done=null;
  let pcm=null; // native: {handle, rate, parts: Int16Array[], frames}
  function clean(){clearTimeout(timer);video?.getTracks().forEach(t=>t.stop());extra?.disconnect(dest);monitor?.close();pcm?.handle.close();video=monitor=extra=dest=null;recorder=null;}
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
          pcm={handle:null,rate:48000,parts:[],frames:0,on:false};
          const p=pcm;
          p.handle=rig.captureMix((d,rate)=>{
            if(!p.on)return;
            p.rate=rate;
            const n=d.length>>1;
            if(p.frames+n>rate*200)return; // a little over the 3-minute limit
            const q=new Int16Array(n*2);
            for(let i=0;i<q.length;i++){const x=d[i];q[i]=x>=1?32767:x<=-1?-32768:Math.round(x*32767);}
            p.parts.push(q);p.frames+=n;
          });
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
        recorder=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:20000000,...(audioTracks.length?{audioBitsPerSecond:256000}:{})});chunks=[];bytes=0;
        done=new Promise((resolve,reject)=>{
          recorder.ondataavailable=e=>{if(e.data.size){chunks.push(e.data);bytes+=e.data.size;if(bytes>600*1024*1024&&recorder?.state==='recording')recorder.stop();}};
          recorder.onerror=e=>{clean();reject(Error(e.error?.message||'Video encoder failed.'));};
          recorder.onstop=async()=>{try{const blob=new Blob(chunks,{type:mime});
            const audio=pcm?wavBytes(pcm):null;pcm=null;clean();
            if(audio&&audio.byteLength<=44)throw Error('No sound came from the sound engine while recording. Try turning the guitar off and on again.');
            const seconds=(performance.now()-startedAt)/1000;
            const saved=await api.clips.save(new Uint8Array(await blob.arrayBuffer()),{title:title()||'Jam Session',songId:songId(),seconds,...(audio?{audio}:{})});
            if(saved&&saved.take)toast({title:`Saved “${saved.take.name}”`,message:'In Recordings (the file is “SH - …mp4”).',kind:'ok',actions:[{label:'Recordings',onClick:()=>import('./recordings.js').then(r=>r.openRecordings({focus:saved.take.id}))}]});
            resolve(saved&&saved.path);}catch(e){clean();reject(e);}finally{chunks=[];}};
        });
        // Catch auto-stop failures as well as explicit save failures.
        done.catch(e=>toast({title:'Could not export clip',message:e.message,kind:'err'}));
        recorder.start(1000);startedAt=performance.now();if(pcm)pcm.on=true;
        timer=setTimeout(()=>{if(recorder?.state==='recording')recorder.stop();},180000);
        video.getVideoTracks()[0].onended=()=>{if(recorder?.state==='recording')recorder.stop();};
        toast({title:'Recording',message:`Up to 3 minutes. Saved as “SH - ${title()||'Jam Session'}” in your recordings.`,kind:'info'});
      }catch(e){pcm=null;clean();throw e;}
    },
    async stop(){if(recorder?.state==='recording')recorder.stop();return done;}
  };
}
