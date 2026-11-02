import {api} from './api.js';
import {toast} from './ui.js';
/** Captures our own window and internal audio; never OS loopback. */
/** title(): what the file is called after "SH - " (the song's title, or Jam Session). */
export function createClipRecorder({rig,engine,title=()=>'Jam Session',songId=()=>null}){
  let startedAt=0;
  let recorder=null,video=null,monitor=null,extra=null,dest=null,chunks=[],timer=null,bytes=0,done=null;
  function clean(){clearTimeout(timer);video?.getTracks().forEach(t=>t.stop());extra?.disconnect(dest);monitor?.close();video=monitor=extra=dest=null;recorder=null;}
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
        monitor=await rig.monitorMix();dest=monitor.ctx.createMediaStreamDestination();monitor.node.connect(dest);
        if(rig.kind!=='native'){
          await engine.ensure?.();
          const songDest=engine.ctx.createMediaStreamDestination();engine.masterAnalyser.connect(songDest);
          extra=monitor.ctx.createMediaStreamSource(songDest.stream);extra.connect(dest);
          const oldClose=monitor.close;monitor.close=()=>{engine.masterAnalyser.disconnect(songDest);monitor.node.disconnect(dest);oldClose();};
        }
        const stream=new MediaStream([...video.getVideoTracks(),...dest.stream.getAudioTracks()]);
        video.getVideoTracks()[0].contentHint='motion';
        const mime=['video/mp4;codecs=avc1.42002A,mp4a.40.2','video/webm;codecs=h264,opus','video/webm;codecs=vp8,opus','video/webm'].find(x=>MediaRecorder.isTypeSupported(x));
        if(!mime)throw Error('Video recording is unavailable on this system.');
        recorder=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:20000000,audioBitsPerSecond:256000});chunks=[];bytes=0;
        done=new Promise((resolve,reject)=>{
          recorder.ondataavailable=e=>{if(e.data.size){chunks.push(e.data);bytes+=e.data.size;if(bytes>600*1024*1024&&recorder?.state==='recording')recorder.stop();}};
          recorder.onerror=e=>{clean();reject(Error(e.error?.message||'Video encoder failed.'));};
          recorder.onstop=async()=>{try{const blob=new Blob(chunks,{type:mime});clean();
            const seconds=(performance.now()-startedAt)/1000;
            const saved=await api.clips.save(new Uint8Array(await blob.arrayBuffer()),{title:title()||'Jam Session',songId:songId(),seconds});
            if(saved&&saved.take)toast({title:`Saved “${saved.take.name}”`,message:'In your recordings.',kind:'ok',actions:[{label:'Recordings',onClick:()=>import('./recordings.js').then(r=>r.openRecordings({focus:saved.take.id}))}]});
            resolve(saved&&saved.path);}catch(e){clean();reject(e);}finally{chunks=[];}};
        });
        // Catch auto-stop failures as well as explicit save failures.
        done.catch(e=>toast({title:'Could not export clip',message:e.message,kind:'err'}));
        recorder.start(1000);startedAt=performance.now();timer=setTimeout(()=>{if(recorder?.state==='recording')recorder.stop();},180000);
        video.getVideoTracks()[0].onended=()=>{if(recorder?.state==='recording')recorder.stop();};
        toast({title:'Recording',message:`Up to 3 minutes. Saved as “SH - ${title()||'Jam Session'}” in your recordings.`,kind:'info'});
      }catch(e){clean();throw e;}
    },
    async stop(){if(recorder?.state==='recording')recorder.stop();return done;}
  };
}
