import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import vm from 'node:vm';
import {GEAR_PHOTOS,gearPhotoInfo} from '../src/renderer/js/gear-photos.js';

// Exercise the production control functions with a small DOM event adapter.
// Browser layout / pointer-capture behavior still needs the renderer audit.
class Element extends EventTarget {
  constructor(tag,cls='') {super();this.tagName=tag;this.children=[];this.attrs={};this.disabled=false;this.style={setProperty:(k,v)=>this.style[k]=v};this.classes=new Set(cls.split('.').filter(Boolean));this.classList={add:k=>this.classes.add(k),toggle:(k,on)=>on?this.classes.add(k):this.classes.delete(k)};}
  append(...nodes){this.children.push(...nodes.filter(Boolean));}
  setAttribute(k,v){this.attrs[k]=String(v);}
  getAttribute(k){return this.attrs[k]??null;}
  querySelectorAll(selector){const out=[];for(const c of this.children){if(!(c instanceof Element))continue;if(c.classes.has(selector.slice(1)))out.push(c);out.push(...c.querySelectorAll(selector));}return out;}
  focus(){}
  setPointerCapture(){}
}
function h(tag,attrs,...children){const [name,...classes]=tag.split('.');const el=new Element(name,classes.join('.'));for(const [k,v]of Object.entries(attrs||{})){if(k==='style')Object.assign(el.style,v);else if(k==='disabled')el.disabled=v;else if(k==='text')el.textContent=v;else el.setAttribute(k,v);}el.append(...children);return el;}
class Custom extends Event{constructor(type,opts={}){super(type);this.detail=opts.detail;}}
const source=readFileSync(new URL('../src/renderer/js/rigui.js',import.meta.url),'utf8');
const a=source.indexOf('export function rotaryKnob('),b=source.indexOf('/** The signal chain:');
const ctx={h,CustomEvent:Custom,MouseEvent:Event,gearPhotoInfo,modal:()=>{}};
vm.createContext(ctx);vm.runInContext(source.slice(a,b).replaceAll('export function','function')+';this.controls={rotaryKnob,gearFaceplate};',ctx);
const {rotaryKnob,gearFaceplate}=ctx.controls;
function event(target,type,data={}){const e=new Event(type,{cancelable:true});for(const [k,v]of Object.entries(data))Object.defineProperty(e,k,{value:v});target.dispatchEvent(e);}
let live=5,calls=0;
const knob=rotaryKnob({name:'PreAmp',min:0,max:10,value:5,def:3,step:.1,onInput:v=>{live=v;calls++;}});
event(knob,'keydown',{key:'ArrowUp'});assert(Math.abs(live-5.1)<1e-10);
event(knob,'keydown',{key:'End'});assert.equal(live,10);
event(knob,'keydown',{key:'ArrowUp'});assert.equal(live,10);
event(knob,'dblclick');assert.equal(live,3);
knob.disabled=true;event(knob,'keydown',{key:'Home'});assert.equal(live,3,'read-only song tones cannot change');knob.disabled=false;
const row=h('div',null,knob),face=gearFaceplate('Amp_MarshallJCM800',row);
const overlay=face.querySelectorAll('.gear-hotspot')[0];assert(overlay,'photo maps the actual preamp control');
event(overlay,'keydown',{key:'ArrowUp'});assert(live>3);assert.equal(Number(knob.getAttribute('aria-valuenow')),live);
knob.setValue(7,{emit:true});assert.equal(Number(overlay.getAttribute('aria-valuenow')),7,'labeled and faceplate controls synchronize both ways');
event(overlay,'dblclick');assert.equal(live,3,'photo reset reaches the real default');
const before=calls;knob.setValue(NaN,{emit:true});assert.equal(calls,before);
const fractional=rotaryKnob({name:'Range',min:.3,max:1.05,value:.3,step:.2,onInput:v=>live=v});event(fractional,'keydown',{key:'End'});assert(live<=1.05&&live>=.3,'rounding never escapes endpoints');
for(const [key,item]of Object.entries(GEAR_PHOTOS)){
 assert(existsSync(new URL('../src/renderer/art/gear/'+item.file,import.meta.url)),key+' image exists');
 for(const point of Object.values(item.knobs||{}))assert(point[0]>=0&&point[0]<=100&&point[1]>=0&&point[1]<=100,key+' control is inside image');
}
assert.equal(gearPhotoInfo('Cab_Marshall1960a_57_Cone'),gearPhotoInfo('Cab_Marshall1960a_Condenser_Cone'),'microphone variants share the same physical cabinet');
console.log('gear controls: live updates, keyboard, reset, limits, read-only mode, linked faceplates and asset integrity passed');
