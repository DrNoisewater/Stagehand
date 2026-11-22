/* Load bones.js first. All coordinates are in the original illustration's pixels. */
(() => {
  const baseURL = new URL('.', document.currentScript.src);
  const ns = 'http://www.w3.org/2000/svg';
  function node(parent, tag, attrs = {}) {
    const el = document.createElementNS(ns, tag);
    for (const [key, val] of Object.entries(attrs)) el.setAttribute(key, val);
    parent.append(el);
    return el;
  }
  let nextInstance = 0;
  const takeNames=['vinyl','crate','typewriter'];
  let sequence=[];
  function nextTake(){
    // Preserve the shuffled order across views, including a full WebView remount.
    try {
      const saved=JSON.parse(sessionStorage.getItem('stagehand.reliquary.takes'));
      if(Array.isArray(saved)&&saved.length<=3&&saved.every(n=>takeNames.includes(n)))sequence=saved;
    }catch{}
    const previous=sequence[0];
    let bag=sequence.slice(1);
    if(!bag.length){
      bag=takeNames.slice();
      for(let i=bag.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[bag[i],bag[j]]=[bag[j],bag[i]];}
      if(bag[0]===previous||(!previous&&bag[0]==='typewriter'))[bag[0],bag[1]]=[bag[1],bag[0]];
    }
    const name=bag.shift();
    sequence=[name,...bag];
    try{sessionStorage.setItem('stagehand.reliquary.takes',JSON.stringify(sequence));}catch{}
    return name;
  }
  window.mountReliquary = function(host, options={}) {
    const svg = node(host, 'svg', {viewBox:'0 0 1983 793',role:'img'});
    svg.style.cssText='display:block;width:100%;height:auto;background:#101719';
    function art(parent, file, rect) {
      const [x,y,width,height] = rect;
      return node(parent,'image',{x,y,width,height,href:new URL('art/'+file,baseURL).href});
    }
    art(svg,'temple.png',[0,0,1983,793]);
    const auraId = 'reliquary-aura-' + (++nextInstance);
    const gradient = node(node(svg,'defs'),'radialGradient',{id:auraId});
    for (const [offset,color,alpha] of [[0,'#ffe7bf',.7],[.53,'#ff9b93',.55],[.72,'#bf8cff',.45],[1,'#8670fe',0]]) {
      node(gradient,'stop',{offset,'stop-color':color,'stop-opacity':alpha});
    }
    const halo = node(svg,'ellipse',{cx:1695,cy:236,rx:278,ry:165,fill:'url(#'+auraId+')',opacity:0});
    const bones = window.ReliquaryBones, joints={};
    for(const [name,bone] of Object.entries(bones)){
      const group=node(joints[bone.parent]||svg,'g',{'data-joint':name});
      joints[name]=group;
      art(group,name+'.png',bone.rect);
    }
    const takes={}, levers={};
    let selected='typewriter', platterAngle=0;
    for(const [name,parts] of Object.entries(window.ReliquaryTakes)){
      const layer=takes[name]=node(svg,'g',{display:'none','data-take':name});
      art(layer,name+'-stage.png',[0,0,705,793]);
      levers[name]={};
      if(name==='crate')art(layer,'crate-corner.png',[559,538,568,255]);
      if(name==='vinyl'){
        art(layer,'vinyl-cabinet.png',[690,537,432,256]);
        const plane=node(layer,'g',{transform:'translate(254.5 642) scale(1 .45926)'});
        levers.vinyl.platter=node(plane,'g');
        art(levers.vinyl.platter,'vinyl-label.png',[-67.5,-67.5,135,135]);
        art(layer,'vinyl-spindle.png',[242,615,28,35]);
      }
      for(const [part,spec] of Object.entries(parts)){
        const joint=levers[name][part]=node(layer,'g',{'data-part':part});
        art(joint,name+'-'+part+'.png',spec.rect);
      }
    }
    function selectTake(choice){
      selected=takeNames.includes(choice)?choice:nextTake();
      for(const [name,g] of Object.entries(takes))g.setAttribute('display',name===selected?'inline':'none');
      for(const [name,g] of Object.entries(joints))if(name!=='brain')g.setAttribute('display',selected==='typewriter'?'inline':'none');
      svg.setAttribute('data-performance',selected);
    }
    function pose(part,angle){
      const pivot=window.ReliquaryTakes[selected][part].pivot;
      levers[selected][part].setAttribute('transform','rotate('+angle+' '+pivot.join(' ')+')');
    }
    const sparks = Array.from({length:12}, (_,i) => {
      const spark = node(svg,'g',{opacity:0});
      node(spark,'circle',{r:9,fill:'url(#'+auraId+')'});
      node(spark,'path',{d:'M0 -5 Q1 -1 4 0 Q1 1 0 5 Q-1 1 -4 0 Q-1 -1 0 -5',fill:i%3?'#d1b9ff':'#fff2ba'});
      return spark;
    });
    const tubeLights = [[1551,372],[1630,352],[1700,330],[1764,349],[1812,376]].map(([cx,cy]) =>
      node(svg,'ellipse',{cx,cy,rx:23,ry:36,fill:'url(#'+auraId+')',opacity:0}));
    const gestures=['read','riff','relay','stickyKey'];
    let remaining=[], gesture='', elapsed=0, duration=1, rest=0, lastGesture='';
    function resetGestures(){
      remaining=[]; gesture=''; elapsed=0; rest=2.5+Math.random()*2.5;
    }
    function advanceGestures(dt){
      if(gesture){
        elapsed+=dt;
        if(elapsed>=duration){
          gesture=''; rest=3.6+Math.random()*4.6;
        }
      }else if((rest-=dt)<=0){
        if(!remaining.length)remaining=gestures.slice();
        const choices=remaining.filter(name=>name!==lastGesture);
        gesture=choices[Math.floor(Math.random()*choices.length)];
        remaining.splice(remaining.indexOf(gesture),1);
        lastGesture=gesture;
        elapsed=0;
        duration=(gesture==='riff'?3.3:2.8)+Math.random()*.9;
      }
    }
    const routes = [
      'M1605 391 C1585 480 1571 527 1529 570 C1491 599 1458 624 1417 609 S1361 585 1332 583',
      'M1591 400 C1570 496 1561 560 1509 611 C1467 656 1410 648 1370 630 Q1348 622 1332 622'
    ];
    const wires = routes.map(d => {
      const g = node(svg,'g',{fill:'none',d,'stroke-linecap':'round',opacity:0});
      node(g,'path',{d,stroke:'#44ffce','stroke-width':23,'stroke-opacity':.12});
      node(g,'path',{d,stroke:'#69ffdf','stroke-width':12,'stroke-opacity':.33});
      node(g,'path',{d,stroke:'#6fffd5','stroke-width':4,'stroke-opacity':.58});
      const packets = node(g,'path',{d,stroke:'#dbfff3','stroke-width':4,'stroke-dasharray':'11 67'});
      return {g,packets};
    });
    const screen=node(svg,'g',{'font-family':'Consolas, Menlo, monospace',fill:'#a1edcd'});
    function label(x,y,size,color,weight='normal') {
      return node(screen,'text',{x,y,fill:color,'font-size':size,'font-weight':weight});
    }
    const header=label(800,219,18,'#91c7af','bold');header.textContent='MUSICBRAINZ / ARCHIVE';
    const lamp=node(screen,'circle',{cx:1274,cy:212,r:6,fill:'#8bffab'});
    node(screen,'path',{d:'M800 236 H1280 M800 398 H1280',stroke:'#3b7666','stroke-width':2});
    const artist=label(799,293,51,'#e4ffcf','bold');
    const kind=label(801,330,17,'#e0b069','bold');
    const title=label(800,371,32,'#a9ffdf');
    const status=label(917,440,17,'#a6d8bb','bold');
    const count=label(1280,477,20,'#def6bb','bold');count.setAttribute('text-anchor','end');
    const disc=node(screen,'g',{transform:'translate(850 456)'});
    node(disc,'circle',{r:44,fill:'#132825',stroke:'#af9066','stroke-width':2});
    const points=[], lengths=[0];let totalLength=0;
    for(let i=0;i<=256;i++){
      const u=i/256,a=-Math.PI/2+Math.PI*6*u,r=37-24*u;
      const pt=[r*Math.cos(a),r*Math.sin(a)];
      if(i){totalLength+=Math.hypot(pt[0]-points[i-1][0],pt[1]-points[i-1][1]);lengths.push(totalLength);}
      points.push(pt);
    }
    const groove=points.map((p,i)=>(i?'L':'M')+p.join(' ')).join(' ');
    node(disc,'path',{d:groove,fill:'none',stroke:'#436157','stroke-width':2.4});
    const trail=node(disc,'path',{d:groove,fill:'none',stroke:'#ffbc70','stroke-width':3,'stroke-linecap':'round'});
    node(disc,'circle',{r:9,fill:'#a65339'});node(disc,'circle',{r:2.4,fill:'#f8db9f'});
    const tip=node(disc,'circle',{r:3.2,fill:'#fff3c7'});
    const pct=label(915,482,39,'#ffe2a0','bold');
    function renderMeter(ms){
      const busy=data.state==='searching'&&!known();
      const ratio=data.state==='complete'?1:known()?Math.max(0,Math.min(1,data.completed/data.total)):0;
      const pos=busy?(motion.matches?0:(ms%2400)/2400):ratio;
      const n=Math.min(255,Math.floor(pos*256)), f=pos*256-n;
      const len=lengths[n]+f*(lengths[n+1]-lengths[n]);
      trail.setAttribute('stroke-dasharray',len+' '+(totalLength+1));
      trail.setAttribute('opacity',busy||ratio===0?0:1);
      const a=points[n],b=points[n+1];
      tip.setAttribute('cx',a[0]+f*(b[0]-a[0]));tip.setAttribute('cy',a[1]+f*(b[1]-a[1]));
      tip.setAttribute('opacity',busy||ratio>0?1:0);
      pct.textContent=busy?'TUNING IN':known()||data.state==='complete'?Math.floor(ratio*100)+'%':'—';
      pct.setAttribute('font-size',busy?26:39);
    }
    const states={idle:'STANDBY',searching:'SEARCHING',complete:'SEARCH COMPLETE',error:'SIGNAL LOST',cancelled:'SEARCH STOPPED'};
    const blank={artist:'',album:'',song:'',completed:null,total:null,state:'idle'};
    let data={...blank}, energy=0, activity=0, packetDistance=0, lastTime=null, frame, dead=false;
    const motion=matchMedia('(prefers-reduced-motion: reduce)');
    function fit(el,value,size,min){
      const full=String(value);el.textContent=full;el.setAttribute('font-size',size);
      const width=el.getComputedTextLength();
      if(width>480)el.setAttribute('font-size',Math.max(min,size*480/width));
      if(el.getComputedTextLength()>480){
        const chars=Array.from(full);let lo=0,hi=chars.length;
        while(lo<hi){const mid=Math.ceil((lo+hi)/2);el.textContent=chars.slice(0,mid).join('')+'…';if(el.getComputedTextLength()>480)hi=mid-1;else lo=mid;}
        el.textContent=chars.slice(0,lo).join('')+'…';
      }
      node(el,'title').textContent=full;
    }
    function known(){return Number.isFinite(data.total)&&data.total>0&&Number.isFinite(data.completed);}
    function render(){
      fit(artist,data.artist||'Archive terminal',51,27);
      kind.textContent=data.song?'RECORDING':data.album?'RELEASE':'QUERY';
      fit(title,data.song||data.album||(data.state==='searching'?'Listening for a match…':'—'),32,20);
      status.textContent=states[data.state];

      count.textContent=known()?Math.min(data.total,Math.max(0,data.completed))+' / '+data.total:'';
      renderMeter(lastTime||0);
      lamp.setAttribute('fill',data.state==='error'?'#ff965e':'#a6ffc1');
      svg.setAttribute('aria-label',[states[data.state],data.artist,data.album,data.song,count.textContent].filter(Boolean).join(', '));
    }
    function rotate(name,angle){
      const [x,y]=bones[name].pivot;
      joints[name].setAttribute('transform','rotate('+angle+' '+x+' '+y+')');
    }
    function tick(ms){
      if(dead)return;
      const t=ms/1000,s=Math.sin;
      const active=data.state==='searching', move=motion.matches?0:1;
      const dt = lastTime===null ? 0 : Math.min(.08,Math.max(0,(ms-lastTime)/1000));
      lastTime=ms;
      const goal=data.state==='complete'?1:known()?Math.max(0,Math.min(1,data.completed/data.total)):0;
      energy += (goal-energy)*(-Math.expm1(-dt/.5));
      activity += ((active?1:0)-activity)*(-Math.expm1(-dt/.38));
      const playing=activity*move;
      const tap=(phase)=>Math.pow((1+s(phase))/2,3);
      if(active && move)advanceGestures(dt);
      const u=Math.min(1,elapsed/duration);
      const blend=gesture?Math.sin(Math.PI*u)**2:0;
      const read=gesture==='read'?blend:0;
      const riff=gesture==='riff'?blend:0;
      const relay=gesture==='relay'?blend:0;
      const key=gesture==='stickyKey'?blend:0;
      const strum=Math.sin(6*Math.PI*u);
      const knock=tap(5*Math.PI*u);
      const typing=playing*(1-.94*read-.65*relay-.75*key);
      rotate('head',typing*(1.4*s(t*2.9)+.6*s(t*1.3))+playing*(4*read+3*riff*strum-3*relay+1.6*key*knock));
      rotate('jaw',playing*(.9*tap(t*5)+2.5*riff*(1+strum)/2+2.6*relay+2*key*knock));
      rotate('nearArm',typing*(-1.6+1.6*tap(t*9))+playing*(-1.4*read-2.2*riff*tap(t*14)-2.5*key*(1-knock)));
      rotate('nearHand',typing*(3.4*tap(t*9+.5)-1.6)+playing*(4*riff*strum+6*key*knock-2*read));
      rotate('farArm',typing*(-2+2*tap(t*8.3+2))-playing*(1.6*relay+2*riff*tap(t*14+2)));
      rotate('farHand',typing*(4*tap(t*8.3+2.5)-1.5)-playing*(4*riff*strum+2.4*relay));
      if(selected==='vinyl'){
        const scratch=Math.pow((1+Math.sin(t*1.3))/2,3);
        pose('head',playing*(3.5*s(t*3.2)+1.5*s(t*1.6)));
        pose('cue',playing*(2.8*s(t*2.4)+3.4*scratch*s(t*7)));
        pose('dial',playing*(.3+1.1*s(t*1.7)));
        platterAngle=(platterAngle+playing*dt*(85+scratch*240*s(t*7)))%360;
        levers.vinyl.platter.setAttribute('transform','rotate('+platterAngle+')');
      }else if(selected==='crate'){
        const lift=(1+s(t*1.15))/2;
        pose('sleeve',playing*(-4.6*lift+1.9*s(t*2.3)));
        pose('dig',playing*3.8*s(t*3.6));
        pose('head',playing*(2.9*s(t*1.15)+1.2*s(t*3.6)));
      }
      tubeLights.forEach((tube,i)=>{
        const wave=Math.max(0,1-Math.abs(6*u-i-.6));
        tube.setAttribute('opacity',playing*relay*wave*.93);
      });
      const beat = (1+s(t*4.1-.35*s(t*4.1)))/2;
      const swell = playing*(beat-.45+.6*relay);
      joints.brain.setAttribute('transform',
        'translate(1697 '+(297+playing*1.8*s(t*1.8))+') scale('+(1+.028*swell)+' '+(1+.045*swell)+') translate(-1697 -297)');
      halo.setAttribute('opacity',activity*(.36+.32*(move?beat:.5)+.25*relay*move));
      sparks.forEach((spark,i) => {
        const u=(t/(2.7+i%4*.36)+i*.381966)%1;
        const x=1517+(i*79)%349+12*s(t*1.2+i);
        const y=171+Math.abs(x-1695)*.32-u*(78+15*(i%3));
        spark.setAttribute('transform','translate('+x+' '+y+') scale('+(.47+.28*(i%3))+')');
        spark.setAttribute('opacity',playing*Math.pow(s(Math.PI*u),2)*.8);
      });
      const cablePower = data.state==='complete'?1:activity;
      packetDistance=(packetDistance+playing*dt*(64+76*energy))%78;
      wires.forEach(({g,packets},i)=>{
        g.setAttribute('opacity',cablePower*(.16+.84*energy));
        packets.setAttribute('stroke-dashoffset',-packetDistance-i*34);
        packets.setAttribute('stroke-width',2+3*energy);
      });
      if(active&&!known())renderMeter(ms);
      lamp.setAttribute('opacity',active&&move?.75+.25*s(t*4):1);
      frame=requestAnimationFrame(tick);
    }
    function update(patch={}){
      if(dead)return;
      data={...data,...patch};
      if(!Object.hasOwn(states,data.state))data.state='idle';
      render();
    }
    render();frame=requestAnimationFrame(tick);
    return {update,start(artist,take=options.take){selectTake(take);resetGestures();update({...blank,artist,state:'searching'});},result:update,destroy(){dead=true;cancelAnimationFrame(frame);svg.remove();}};
  };
})();
