/* Stagehand Song Finder reference player. No backend simulation. */
export class RoadiePlayer {
  constructor(host, {base = '.', onStatus = () => {}} = {}) {
    this.host = host; this.base = base; this.onStatus = onStatus;
    this.state = null; this.actual = 'idle'; this.pending = null; this.progress = null;
    this.token = 0; this.celebrating = false; this.job = null;
    this.video = document.createElement('video');
    Object.assign(this.video, {muted:true, playsInline:true, preload:'auto', disablePictureInPicture:true});
    this.video.style.cssText = 'display:block;width:100%;height:100%;object-fit:contain;background:#17120e;pointer-events:none';
    this.video.setAttribute('aria-hidden','true'); host.replaceChildren(this.video);
    host.setAttribute('role','img');
    this.motion = matchMedia('(prefers-reduced-motion: reduce)');
    this.visibility = () => {if(document.hidden || this.motion.matches) this.video.pause(); else this.video.play().catch(()=>{});};
    this.motionChange = () => this.render(this.state || 'idle');
    document.addEventListener('visibilitychange',this.visibility);
    this.motion.addEventListener('change',this.motionChange);
    this.setState('idle');
  }
  report(){
    const names={idle:'Ready',searching:'Searching…',found:'Song found',downloading:'Downloading…',importing:'Importing…',imported:'In Songs ✓',failed:'Could not acquire song'};
    const label=names[this.actual] + (this.actual==='downloading' && this.progress!==null ? ` ${Math.round(this.progress*100)}%` : '');
    this.host.setAttribute('aria-label',label); this.onStatus(label,this.actual,this.progress);
  }
  setProgress(fraction){this.progress=Number.isFinite(fraction)?Math.max(0,Math.min(1,fraction)):null; this.report();}
  // Backend should filter stale events by job ID before calling this API.
  setState(next, {jobId = this.job} = {}) {
    if (!['idle','searching','found','downloading','importing','imported','failed'].includes(next)) throw new Error('Unknown Roadie state: '+next);
    const newJob = jobId !== this.job; this.job=jobId;
    if (newJob || (next==='downloading' && this.actual!==next)) this.progress=null;
    this.actual=next; this.report();
    if(this.celebrating && (next==='searching' || next==='idle')) {this.pending=next;return;}
    if(newJob || next!==this.state) {this.pending=null;this.celebrating=false;this.render(next);}
  }
  clip(name, loop=false, after=null, poster=15){
    const t=++this.token, video=this.video;
    video.pause(); video.onended=null; video.onerror=null;
    video.loop=loop; video.poster=`${this.base}/art/keyframe-${String(poster).padStart(2,'0')}.png`;
    if (this.motion.matches) { video.removeAttribute('src');video.load(); if(after && name==='success') {this.celebrating=false;this.pending=null;}return; }
    video.src=`${this.base}/clips/${name}.mp4`;
    video.onended=()=>{if(t===this.token && after)after();};
    video.onerror=()=>{if(t!==this.token)return;video.pause();video.onerror=null;video.removeAttribute('src');video.load(); if(this.celebrating){this.celebrating=false;const p=this.pending;this.pending=null;if(p)this.render(p);}};
    video.load(); if(!document.hidden)video.play().catch(()=>{});
  }
  render(s){
    this.state=s; this.celebrating=false;
    switch(s){
      case 'searching':this.clip('search-loop',true,null,0);break;
      case 'found':this.clip('found',false,()=>this.clip('found-hold',true,null,5),4);break;
      case 'downloading':this.clip('download-enter',false,()=>this.clip('download-loop',true,null,8),8);break;
      case 'importing':this.clip('import-enter',false,()=>this.clip('import-loop',true,null,10),10);break;
      case 'imported':
        if(this.motion.matches){this.clip('success-hold',true,null,14);break;}
        this.celebrating=true;this.clip('success',false,()=>{this.celebrating=false;const p=this.pending;this.pending=null;if(p==='searching'){this.clip('reset',false,()=>this.render('searching'),15);this.state='searching';}else if(p){this.render(p);}else this.clip('success-hold',true,null,14);},14);break;
      case 'failed':this.video.pause();++this.token;this.video.onended=null;this.video.onerror=null;this.video.removeAttribute('src');this.video.poster=`${this.base}/art/keyframe-15.png`;this.video.load();break;
      default:this.clip('idle',true,null,15);
    }
  }
  dispose(){++this.token;this.video.onended=null;this.video.onerror=null;this.video.pause();this.video.removeAttribute('src');this.video.load();document.removeEventListener('visibilitychange',this.visibility);this.motion.removeEventListener('change',this.motionChange);this.host.replaceChildren();}
}
