import { rig } from './rig.js';
import { hueRGB } from './fluidbg.js';
/** Uses the post-fader song bus, so mute/solo/volume are already respected. */
export function musicEnergy(engine) {
  const song = engine.masterLevel ? engine.masterLevel() : 0;
  const guitar = rig.on && !rig.muted ? (rig.levels().output ?? rig.levels().input ?? 0) : 0;
  return Math.min(1,Math.sqrt(Math.max(0,song+guitar))*1.8);
}
const motion=new WeakMap();
export function audioSplats(engine,t) {
  const e=musicEnergy(engine);if(e<.015)return [];
  const spec=engine.spectrum?.();
  const st=motion.get(engine)||{level:0};const onset=Math.max(0,e-st.level*1.25);st.level=st.level*.65+e*.35;motion.set(engine,st);
  const ranges=[[4,28],[28,160],[160,500]];
  const splats=ranges.map(([lo,hi],i)=>{
    let band=0;if(spec){for(let k=lo;k<Math.min(hi,spec.length);k++)band+=spec[k]/255;band/=hi-lo;}
    const power=e*(.3+band)+onset;
    return {x:.15+i*.33,y:.25+band*.4,dx:Math.cos(t+i)*(300+onset*1800)*power,dy:(350+i*180+onset*1200)*power,radius:.25+power*.75,...hueRGB((i*.22+band*.3+t*.015)%1,power*.2)};
  });
  if(onset>.08)for(let i=0;i<6;i++){const a=i/6*Math.PI*2+t*.2;splats.push({x:.5+Math.cos(a)*.25,y:.48+Math.sin(a)*.24,dx:Math.cos(a)*onset*2200,dy:Math.sin(a)*onset*2200,radius:.3+onset,...hueRGB((t*.04+i/8)%1,onset*.5)});}
  return splats;
}

// Full-screen GPU scenes. The actual post-fader audio drives motion, light and
// geometry; the guitar's output drives its own central glow. No chart triggers.
const vertex=`attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}`;
const fragment=`precision mediump float;
uniform vec2 resolution;uniform float time,energy,bass,mid,high,instrument,mode,pitch,attack;
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
float fbm(vec2 p){float a=.5,v=0.;for(int i=0;i<4;i++){v+=a*noise(p);p=p*2.03+vec2(5.2,1.3);a*=.5;}return v;}
mat2 rot(float a){return mat2(cos(a),-sin(a),sin(a),cos(a));}
void main(){
 vec2 uv=(gl_FragCoord.xy-.5*resolution)/resolution.y;
 vec3 col=vec3(.009,.012,.025);float t=time;uv*=1.-attack*.035;
 if(mode<.5){
  // Layered luminous curtains: folded silk, fine striations, soft volumetric haze.
  for(int i=0;i<24;i++){
   float z=float(i)/24.;vec2 q=uv*vec2(1.25,1.0);q.x+=sin(z*4.+t*.17)*.15;
   float flow=fbm(vec2(q.x*1.8+t*.08,z*3.-t*.12));
   float ridge=.12+sin(q.x*2.6+z*4.+t*.24+pitch*.8)*(.12+bass*.22+instrument*.12)+(flow-.5)*.65;
   float d=q.y-ridge+z*.12;
   float curtain=exp(-abs(d)*(12.+z*18.))*pow(max(0.,noise(vec2(q.x*24.+t*.2,z*7.))),1.6);
   float filaments=.35+.65*pow(.5+.5*sin(q.x*130.+flow*15.+z*9.),3.);
   vec3 tint=mix(vec3(.08,.55,.65),vec3(.55,.16,.85),flow+z*.35);
   float core=exp(-abs(d)*180.)*(.3+.7*flow);
   col+=tint*(curtain*filaments*.10+core*.075)*(.8+energy*2.)*(1.-z*.6);
  }
  col+=vec3(.03,.15,.22)*exp(-length(uv-vec2(0,.1))*3.)*(.2+instrument);
 }else if(mode<1.5){
  // Deep orbit: hundreds of seeded particles and a gravitational light ring.
  vec2 q=uv*rot(t*.045);float r=length(q),angle=atan(q.y,q.x);
  float ring=exp(-abs(r-(.25+bass*.09+attack*.12))*90.);
  col+=mix(vec3(.22,.20,.8),vec3(.3,.85,1.),.5+.5*sin(angle*2.+t))*ring*(.18+energy*.7);
  for(int i=0;i<28;i++){
   float layer=float(i);float z=fract(layer/28.+t*(.025+instrument*.045));float scale=1.5+z*15.;
   vec2 grid=q*scale+vec2(layer*7.13,layer*3.7);vec2 id=floor(grid),cell=fract(grid)-.5;
   vec2 center=vec2(hash(id+layer),hash(id+layer+9.))-.5;
   float d=length(cell-center*.7);float star=exp(-d*d*(180.+z*400.));
   float seed=hash(id+layer*2.);float fade=sin(z*3.14159);
   vec3 tint=mix(vec3(.13,.3,1.),vec3(.9,.32,.55),seed);
   col+=star*tint*fade*(.24+high*.8+energy*.4+attack*.5)*step(.68,seed);
  }
  float halo=exp(-r*6.);col+=vec3(.08,.17,.4)*halo*(.3+instrument*2.);
 }else{
  // Crystal corridor: mirrored facets recede toward a bright vanishing point.
  vec2 q=uv*rot(sin(t*.09)*.12);float radius=max(length(q),.04);float ang=atan(q.y,q.x);
  float sector=abs(mod(ang+3.14159/6.,3.14159/3.)-3.14159/6.);
  float depth=.32/radius+t*(.35+instrument*.3);float edge=abs(sin(sector*6.));
  float ribs=pow(.5+.5*cos(depth*8.+bass*1.5),28.);
  float rails=exp(-edge*100.);float facets=pow(.5+.5*sin(sector*12.+depth*1.5),8.);
  vec3 tint=mix(vec3(.05,.5,.8),vec3(.65,.12,.65),.5+.5*sin(depth*.6+t*.15));
  col+=tint*(ribs*.55+rails*.5+facets*.06)*smoothstep(.02,.2,radius)*(.4+energy);
  col+=vec3(.22,.45,.7)*exp(-radius*12.)*(.3+instrument);
 }
 // Darken the highway's foreground; retain color and detail above its horizon.
 col*=mix(.55,1.,smoothstep(-.5,.15,uv.y));
 col*=1.-.35*smoothstep(.2,1.2,length(uv));
 col=vec3(1.)-exp(-col*1.8);gl_FragColor=vec4(col,1.);
}`;
export function createReactive(host){
 let canvas=null,gl=null,program=null,buffer=null,loc={},last=0,phase=0,values=[0,0,0,0],lastLevel=0,attack=0,pitch=0,pitchAt=0;
 function drop(){if(gl){gl.deleteBuffer(buffer);gl.deleteProgram(program);gl.getExtension('WEBGL_lose_context')?.loseContext();}canvas?.remove();canvas=gl=program=buffer=null;last=0;}
 function init(){
  canvas=document.createElement('canvas');canvas.className='hw-fluid reactive-bg';host.prepend(canvas);
  gl=canvas.getContext('webgl',{alpha:false,antialias:false,depth:false,powerPreference:'high-performance'});
  if(!gl){canvas.remove();canvas=null;return false;}
  const compile=(type,source)=>{const sh=gl.createShader(type);gl.shaderSource(sh,source);gl.compileShader(sh);if(!gl.getShaderParameter(sh,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(sh));return sh;};
  try{program=gl.createProgram();const v=compile(gl.VERTEX_SHADER,vertex),f=compile(gl.FRAGMENT_SHADER,fragment);gl.attachShader(program,v);gl.attachShader(program,f);gl.linkProgram(program);gl.deleteShader(v);gl.deleteShader(f);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program));gl.useProgram(program);
   buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW);const a=gl.getAttribLocation(program,'p');gl.enableVertexAttribArray(a);gl.vertexAttribPointer(a,2,gl.FLOAT,false,0,0);
   for(const k of ['resolution','time','energy','bass','mid','high','instrument','mode','pitch','attack'])loc[k]=gl.getUniformLocation(program,k);
  }catch(e){console.warn('Visualizer:',e.message);drop();return false;}return true;
 }
 return {drop,draw(mode,engine,now){
  if(!gl&&!init())return;
  const dt=last?Math.min(.1,(now-last)/1000):.016;last=now;
  const w=Math.min(1280,host.clientWidth||1280),h=Math.round(w*(host.clientHeight||720)/(host.clientWidth||1280));
  if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;gl.viewport(0,0,w,h);}
  const e=musicEnergy(engine),spec=engine.spectrum?.();
  const bands=[[2,22],[22,120],[120,400]].map(([a,b])=>{let sum=0;for(let i=a;i<b;i++)sum+=(spec?.[i]||0)/255;return sum/(b-a);});
  const g=rig.on&&!rig.muted?Math.min(1,Math.sqrt(rig.levels().output||0)*2):0;
  const next=[e,...bands];next.forEach((v,i)=>values[i]+=(v-values[i])*(1-Math.exp(-dt*(v>values[i]?14:4))));
  attack=Math.max(attack*Math.exp(-dt*5),Math.max(0,e-lastLevel)*5);lastLevel=e;
  if(now-pitchAt>75){const p=g>.025?rig.pitch():null;if(p)pitch=(p.midi%12)/12;pitchAt=now;}
  phase+=dt*(.65+values[0]*1.8);gl.uniform1f(loc.pitch,pitch);gl.uniform1f(loc.attack,Math.min(1,attack));
  gl.uniform2f(loc.resolution,w,h);gl.uniform1f(loc.time,phase);gl.uniform1f(loc.energy,values[0]);gl.uniform1f(loc.bass,values[1]);gl.uniform1f(loc.mid,values[2]);gl.uniform1f(loc.high,values[3]);gl.uniform1f(loc.instrument,g);gl.uniform1f(loc.mode,mode==='aurora'?0:mode==='orbit'?1:2);gl.drawArrays(gl.TRIANGLES,0,6);
 }};
}
