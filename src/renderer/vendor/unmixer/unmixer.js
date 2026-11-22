/* Stagehand • compact stem-job panel. Progress is independent of animation time. */
(() => {
  const ns='http://www.w3.org/2000/svg';
  const base=typeof document==='undefined'?'art/':new URL('art/',document.currentScript.src).href;
  const captions={queued:'Waiting to split stems',splitting:'Splitting the stems',finalizing:'Preparing stem files',ready:'Stems ready',error:'Stem separation failed',cancelled:'Stem separation cancelled'};
  const terminal=p=>['ready','error','cancelled'].includes(p);
  const clamp=v=>Math.min(1,Math.max(0,v));
  const valid=v=>typeof v==='number'&&Number.isFinite(v);
  function mount(host,{onReport=()=>{},onPlayFullMix,asset=n=>base+n,manual=false}={}){
    const doc=host.ownerDocument;
    function add(p,k,a={}){const e=doc.createElementNS(ns,k);for(const [n,v] of Object.entries(a))e.setAttribute(n,v);p.append(e);return e;}
    const svg=add(host,'svg',{viewBox:'0 0 660 206',style:'display:block;width:100%;height:auto','aria-label':'Stem separation'});
    add(svg,'rect',{x:1,y:1,width:658,height:204,rx:13,fill:'#17181e',stroke:'#665344','stroke-width':2});
    function text(x,y,size,fill,weight=400){return add(svg,'text',{x,y,'font-family':'DejaVu Sans, Arial, sans-serif','font-size':size,'font-weight':weight,fill});}
    const heading=text(19,29,17,'#f9eadd',700),percentage=text(640,29,18,'#ffa970',700);percentage.setAttribute('text-anchor','end');
    add(svg,'rect',{x:19,y:41,width:621,height:8,rx:4,fill:'#35343b'});
    const bar=add(svg,'rect',{x:19,y:41,width:0,height:8,rx:4,fill:'#f59862'});
    const scene=add(svg,'svg',{x:19,y:61,width:370,height:98,viewBox:'0 0 2172 574','aria-hidden':'true'});
    function art(file,x,y,width,height){return add(scene,'image',{href:asset(file),x,y,width,height});}
    art('bench-press.jpg',0,0,2172,574);const skull=art('head.png',4,3,392,340);
    const forearm=art('press-arm.png',170,389,333,153);
    const colors=['#ff8474','#e795ff','#78ffd3','#ffcd69'];
    const paths=[[733,302,1202,302],...[219,277,335,393].map(y=>[1202,302,1776,y])];
    const beams=paths.map(([x,y,x2,y2],i)=>{
      const g=add(scene,'g',{}), d='M'+x+' '+y+' L'+x2+' '+y2, c=i?colors[i-1]:'#ffdb88';
      for(const [w,alpha] of [[28,.12],[15,.26],[5,.82]])add(g,'path',{d,fill:'none',stroke:c,'stroke-linecap':'round','stroke-width':w,opacity:alpha});
      const shot=add(g,'path',{d,fill:'none',stroke:'#fff6d8','stroke-width':7,'stroke-linecap':'round',pathLength:100,'stroke-dasharray':'10 90'});
      return {g,shot};
    });
    const flash=add(scene,'circle',{cx:1202,cy:302,r:12,fill:'#ffebb2'});
    const traces=colors.map(c=>add(scene,'path',{stroke:c,'stroke-width':5,fill:'none'}));
    const desc1=text(404,90,14,'#e5d9cc',600),desc2=text(404,113,13,'#c6bfb8'),desc3=text(404,133,13,'#c6bfb8');
    const song=text(19,185,14,'#d8c6b6',600);
    const control=add(svg,'g',{'aria-label':'Play now with the full mix'});
    add(control,'rect',{x:421,y:164,width:220,height:31,rx:6,fill:'#2b2a2e',stroke:'#6d6058'});
    add(control,'path',{d:'M433 173v13l10 -6.5z',fill:'#ffba82'});
    const btn=add(control,'text',{x:451,y:185,fill:'#f5ebe0','font-size':13,'font-family':'DejaVu Sans,Arial,sans-serif','font-weight':700});btn.textContent='Play now with the full mix';
    let state=null,dead=false,reduced=false,frame;
    const copy=()=>state?{...state,stems:state.stems.map(s=>({...s}))}:null;
    function fit(el,str,max){el.textContent=str;if(typeof el.getComputedTextLength!=='function'||el.getComputedTextLength()<=max)return;
      const chars=Array.from(str);let lo=0,hi=chars.length;while(lo<hi){let mid=Math.ceil((lo+hi)/2);el.textContent=chars.slice(0,mid).join('')+'…';if(el.getComputedTextLength()>max)hi=mid-1;else lo=mid;}el.textContent=chars.slice(0,lo).join('')+'…';}
    function paint(){
      const s=state||{phase:'queued',song:'',progress:null,stems:[]};
      heading.textContent=captions[s.phase];percentage.textContent=s.progress===null?'':Math.floor(s.progress*100+1e-9)+'%';
      bar.setAttribute('x',19);bar.setAttribute('width',s.progress===null?0:621*s.progress);
      fit(song,[s.artist,s.song].filter(Boolean).join(' · '),391);
      desc1.textContent=s.phase==='ready'?'Ready to mix':s.phase==='error'?'Processing stopped':s.phase==='cancelled'?'Job cancelled':'Instrument separation';
      let rows=s.stems.slice(0,2).map(o=>o.name+' · '+(valid(o.progress)?Math.floor(o.progress*100+1e-9)+'%':o.status||'Pending'));
      fit(desc2,s.message||rows[0]||(s.phase==='ready'?'Stem files are available.':terminal(s.phase)?'':s.phase==='finalizing'?'Writing the outputs…':'Isolating the instruments'),227);
      fit(desc3,s.message?'':rows[1]||(!terminal(s.phase)&&s.phase!=='finalizing'?'from the full mix.':''),227);
      svg.setAttribute('aria-label',[s.song,captions[s.phase],percentage.textContent,s.message,...rows].filter(Boolean).join(', '));
    }
    function fraction(e,old){
      if('progress' in e)return valid(e.progress)?clamp(e.progress):null;
      if('completed' in e||'total' in e)return valid(e.completed)&&valid(e.total)&&e.total>0?clamp(e.completed/e.total):null;
      return old;
    }
    function apply(e,initial=false){
      if(dead||!state||e.jobId!==state.jobId||e.songId!==state.songId||!Number.isSafeInteger(e.sequence)||e.sequence<=state.sequence||terminal(state.phase))return false;
      if(e.phase&&!Object.hasOwn(captions,e.phase))return false;
      const phase=e.phase||state.phase;
      state={...state,sequence:e.sequence,phase,progress:phase==='ready'?1:fraction(e,state.progress),
        message:e.message===undefined?(phase===state.phase?state.message:''):String(e.message||''),
        stems:Array.isArray(e.stems)?e.stems.filter(o=>o&&o.name).map(o=>({name:String(o.name),progress:fraction(o,null),status:String(o.status||'')})):state.stems};
      paint();onReport(copy());return true;
    }
    function start(e){
      if(dead||!e||!e.jobId||!e.songId||!Number.isSafeInteger(e.sequence)||e.sequence<0||(e.phase&&!Object.hasOwn(captions,e.phase)))return false;
      if(state&&e.jobId===state.jobId&&e.songId===state.songId)return apply(e);
      state={jobId:e.jobId,songId:e.songId,song:String(e.song||''),artist:String(e.artist||''),sequence:-1,phase:'queued',progress:null,stems:[],message:''};
      return apply(e,true);
    }
    function draw(seconds){
      if(dead)return;const active=state&&['splitting','finalizing'].includes(state.phase);
      const t=reduced?1.35:seconds,cycle=((t%1.65)+1.65)%1.65;
      // The forearm and hand rotate together about the elbow. Contact is cycle zero.
      const smooth=x=>{const v=clamp(x);return v*v*(3-2*v);};
      const lift=cycle<.2?0:cycle<.85?smooth((cycle-.2)/.65):cycle<1.36?1:1-smooth((cycle-1.36)/.29);
      forearm.setAttribute('transform','rotate('+(-32*(active&&!reduced?lift:0))+' 178 523)');
      skull.setAttribute('transform','rotate('+(active&&!reduced?1.8*Math.sin(t*3.1):0)+' 255 327)');
      for(let i=0;i<5;i++){
        const {g,shot}=beams[i],on=i===0?0:.51,span=i===0?.51:.78,k=(cycle-on)/span;
        g.setAttribute('opacity',!active?0:reduced?.65:(.24+.73*(k>=0&&k<=1?Math.sin(Math.PI*k)**.65:0)));
        shot.setAttribute('opacity',active&&!reduced&&k>=0&&k<=1?1:0);
        shot.setAttribute('stroke-dashoffset',10-110*clamp(k));
      }
      flash.setAttribute('opacity',active?(reduced?.55:Math.exp(-((cycle-.54)**2)/.013)):0);
      flash.setAttribute('r',11+16*Math.exp(-((cycle-.54)**2)/.013));
      traces.forEach((e,i)=>{let d='';for(let k=0;k<=55;k++){const u=k/55,p=u*24-t*5;const amp=active?Math.sin(p*(i+1))*(.3+.7*Math.cos(p*.42+i)**2)*11:0;d+=(k?'L':'M')+(1778+305*u).toFixed(1)+' '+(219+58*i+amp).toFixed(1);}e.setAttribute('d',d);});
      if(state&&state.progress===null&&!terminal(state.phase)){bar.setAttribute('width',62);bar.setAttribute('x',19+(reduced?280:279*(1+Math.sin(t*2))));}
    }
    function fullMix(){if(state&&!dead&&onPlayFullMix)onPlayFullMix(copy());}
    if(onPlayFullMix){control.setAttribute('role','button');control.setAttribute('tabindex','0');control.style.cursor='pointer';control.addEventListener?.('click',fullMix);control.addEventListener?.('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();fullMix();}});}
    else control.setAttribute('display','none');
    paint();draw(0);
    const mq=typeof matchMedia==='function'?matchMedia('(prefers-reduced-motion: reduce)'):null;
    function pref(){reduced=!!mq?.matches;}pref();mq?.addEventListener('change',pref);
    if(!manual){const tick=ts=>{if(!dead){draw(ts/1000);frame=requestAnimationFrame(tick);}};frame=requestAnimationFrame(tick);}
    return {start,update:apply,getReport:copy,draw,setReducedMotion(v){reduced=!!v;},destroy(){dead=true;if(frame!==undefined)cancelAnimationFrame(frame);mq?.removeEventListener('change',pref);svg.remove();}};
  }
  globalThis.Unmixer={mount};
})();
