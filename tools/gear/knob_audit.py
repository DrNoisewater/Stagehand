"""4.10: the knob audit. For every knob on every gear photo: fit the circle that really turns
(refine), read the angle its pointer shows in the photo (pointer), and draw review sheets
(sheets): each knob as [photo with the circle and pointer | turned all the way down | all the
way up], so a wrong centre, size or angle is obvious by eye.

  python3 tools/gear/knob_audit.py sheets <outdir> [gear key …]   review sheets of the shipped table
  python3 tools/gear/knob_audit.py fit <gear key> <knob> <x%> <y%> <r%>   fit + angle for a rough placement

The result lives in tools/gear/audit.json (knobs: [x %, y %, radius % of width, pointer angle];
sliders: see build_photos.py) and has the last word in build_photos.py. Fix a knob by editing
audit.json, run build_photos.py, then look at the sheets again. Needs numpy, opencv, Pillow (AVIF).
"""
import json, re, os, math, sys
import numpy as np, cv2
from PIL import Image
ROOT=os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
FULL=ROOT+'/src/renderer/art/gear/full'
def table():
    js=open(ROOT+'/src/renderer/js/gear-photos.js').read()
    return json.loads(re.search(r'export const GEAR_PHOTOS = (\{.*?\});\n', js, re.S).group(1))
_cache={}
def photo(key):
    if key not in _cache:
        im=Image.open(f'{FULL}/{key}.avif').convert('RGBA')
        bg=Image.new('RGBA',im.size,(60,60,60,255)); bg.alpha_composite(im)
        _cache[key]=np.array(bg.convert('RGB'))
    return _cache[key]
def px(key,v):
    im=photo(key); W=im.shape[1]
    return v[0]/100*W, v[1]/100*im.shape[0], v[2]/100*W
def polar(gray,cx,cy,r,r0=0.3,r1=0.9,nr=24,na=360):
    th=np.deg2rad(np.arange(na)*360/na)   # 0 = up, clockwise
    rr=np.linspace(r0*r,r1*r,nr)
    X=cx+np.outer(rr,np.sin(th)); Y=cy-np.outer(rr,np.cos(th))
    return cv2.remap(gray,X.astype(np.float32),Y.astype(np.float32),cv2.INTER_LINEAR,borderMode=cv2.BORDER_REPLICATE)
def pointer(key,v):
    """angle (deg, 0 = up, clockwise) of the knob's pointer line + a confidence."""
    im=photo(key).astype(np.float32); cx,cy,r=px(key,v)
    best=None
    for ch in range(4):
        g=im.mean(axis=2) if ch==3 else im[:,:,ch]
        for (a,b) in ((0.35,0.9),(0.55,1.0),(0.2,0.6)):
            P=polar(g,cx,cy,r,a,b)
            prof=P.mean(axis=0)
            k=61; pad=np.concatenate([prof[-k:],prof,prof[:k]])
            med=np.array([np.median(pad[i:i+2*k+1]) for i in range(len(prof))])
            d=prof-med
            d=np.convolve(np.concatenate([d[-3:],d,d[:3]]),np.ones(5)/5,'same')[3:-3]
            for sign in (1,-1):
                i=int(np.argmax(sign*d)); pk=sign*d[i]
                # how much of the radial extent agrees (a pointer is a line, not a blob)
                col=P[:, i]-np.median(P,axis=1)
                agree=float((sign*col>pk*0.4).mean())
                rest=np.delete(sign*d, [(i+j)%360 for j in range(-25,26)])
                conf=pk/(rest.std()+1e-3)*agree
                if best is None or conf>best[1]: best=(i,conf)
    return best
def turned(key,v,a0,target,size=96,span=1.6):
    im=photo(key); cx,cy,r=px(key,v)
    R=int(round(r*span)); 
    x0,y0=int(round(cx))-R,int(round(cy))-R
    pad=cv2.copyMakeBorder(im,R,R,R,R,cv2.BORDER_CONSTANT,value=(60,60,60))
    crop=pad[y0+R:y0+3*R,x0+R:x0+3*R].copy()
    c=(cx-x0,cy-y0)
    if target is not None:
        M=cv2.getRotationMatrix2D(c,-(target-a0),1.0)
        rot=cv2.warpAffine(crop,M,(crop.shape[1],crop.shape[0]),flags=cv2.INTER_LINEAR)
        mask=np.zeros(crop.shape[:2],np.uint8); cv2.circle(mask,(int(round(c[0])),int(round(c[1]))),int(round(r)),255,-1,cv2.LINE_AA)
        m=(mask/255.0)[:,:,None]; crop=(rot*m+crop*(1-m)).astype(np.uint8)
    out=cv2.resize(crop,(size,size),interpolation=cv2.INTER_AREA if crop.shape[0]>size else cv2.INTER_CUBIC)
    s=size/(2*R)
    return out,s,c
def tile(key,name,v,a0,conf=None,size=96):
    a,s,c=turned(key,v,a0,None,size)
    a=a.copy(); r=px(key,v)[2]
    cv2.circle(a,(int(c[0]*s),int(c[1]*s)),int(r*s),(0,255,255),1,cv2.LINE_AA)
    t=math.radians(a0); p1=(int(c[0]*s+math.sin(t)*r*s*0.5),int(c[1]*s-math.cos(t)*r*s*0.5)); p2=(int(c[0]*s+math.sin(t)*r*s*1.25),int(c[1]*s-math.cos(t)*r*s*1.25))
    cv2.line(a,p1,p2,(255,0,255),2,cv2.LINE_AA)
    b=turned(key,v,a0,-135,size)[0]; d=turned(key,v,a0,135,size)[0]
    row=np.concatenate([a,b,d],axis=1)
    lab=np.full((16,row.shape[1],3),25,np.uint8)
    txt=f'{name[:16]} a{int(a0)}'+(f' c{conf:.0f}' if conf is not None else '')
    cv2.putText(lab,txt,(2,12),cv2.FONT_HERSHEY_SIMPLEX,0.38,(230,230,230),1,cv2.LINE_AA)
    return np.concatenate([row,lab],axis=0)
def sheets(items,out,cols=6,rows=9,size=96):
    """items: [(key,name,v,a0,conf)]"""
    n=0; per=cols*rows; tw=size*3+6; th=size+16+16
    for s0 in range(0,len(items),per):
        S=np.full((rows*th,cols*tw,3),45,np.uint8)
        for j,(key,name,v,a0,conf) in enumerate(items[s0:s0+per]):
            t=tile(key,name,v,a0,conf,size)
            y=(j//cols)*th; x=(j%cols)*tw
            cv2.putText(S,f'{s0+j} {key[-22:]}',(x+2,y+12),cv2.FONT_HERSHEY_SIMPLEX,0.38,(120,220,255),1,cv2.LINE_AA)
            S[y+16:y+16+t.shape[0],x:x+t.shape[1]]=t
        Image.fromarray(S).save(f'{out}-{n:02d}.jpg',quality=82); n+=1
    return n

def refine(key,v,reach=0.6,rlo=0.75,rhi=1.5):
    """best circle near the current one: (x%,y%,r%) and (new score, old score)."""
    im=photo(key); H,W=im.shape[:2]; cx,cy,r=px(key,v)
    g=cv2.GaussianBlur(cv2.cvtColor(im,cv2.COLOR_RGB2GRAY).astype(np.float32),(0,0),max(0.8,r/18))
    gx=cv2.Sobel(g,cv2.CV_32F,1,0,ksize=3); gy=cv2.Sobel(g,cv2.CV_32F,0,1,ksize=3)
    na=48; th=np.linspace(0,2*np.pi,na,endpoint=False); ct,st=np.cos(th),np.sin(th)
    reachp=int(round(reach*r)); step=max(1,int(r/20))
    dxs=np.arange(-reachp,reachp+1,step)
    CX,CY=np.meshgrid(cx+dxs,cy+dxs)
    def score(CX,CY,rad):
        X=np.clip(np.rint(CX[...,None]+rad*ct).astype(int),0,W-1); Y=np.clip(np.rint(CY[...,None]+rad*st).astype(int),0,H-1)
        d=np.abs(gx[Y,X]*ct+gy[Y,X]*st)
        return np.percentile(d,30,axis=-1)   # needs support round most of the circle
    best=(-1,cx,cy,r)
    for rad in np.arange(rlo*r,rhi*r+0.01,max(1,r/25)):
        s=score(CX,CY,rad)
        s=s*(1-0.3*np.hypot(CX-cx,CY-cy)/r)
        i=np.unravel_index(np.argmax(s),s.shape)
        if s[i]>best[0]: best=(float(s[i]),float(CX[i]),float(CY[i]),float(rad))
    old=float(score(np.array([[cx]]),np.array([[cy]]),r)[0,0])
    return [round(best[1]/W*100,3),round(best[2]/H*100,3),round(best[3]/W*100,3)],best[0],old


if __name__ == '__main__':
    cmd = sys.argv[1] if len(sys.argv) > 1 else ''
    if cmd == 'sheets':
        out = sys.argv[2]; only = set(sys.argv[3:]); os.makedirs(out, exist_ok=True)
        T = table(); items = []
        for key in sorted(T):
            if only and key not in only: continue
            for name, v in T[key].get('knobs', {}).items(): items.append((key, name, v[:3], v[3], None))
        print(len(items), 'knobs on', sheets(items, os.path.join(out, 'knobs')), 'sheets in', out)
    elif cmd == 'fit':
        key, name = sys.argv[2], sys.argv[3]; v = [float(x) for x in sys.argv[4:7]]
        nv, s, o = refine(key, v); a, conf = pointer(key, nv)
        print(json.dumps({name: nv + [a - 360 if a > 180 else a]}), 'fit', round(s, 1), 'was', round(o, 1), 'pointer confidence', round(conf, 1))
    else:
        print(__doc__)
