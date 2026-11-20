/* World coordinates: millimetres, right-handed meridional x,y. Each optic is drawn
 * using the same sag function as the tracer; glass thickness is never exaggerated. */
(() => {
  'use strict';
  const rad=Math.PI/180, clamp=(v,a,b)=>Math.max(a,Math.min(b,v)), num=Number.isFinite;
  const vec=(x,y)=>({x,y}), plus=(a,b)=>vec(a.x+b.x,a.y+b.y), minus=(a,b)=>vec(a.x-b.x,a.y-b.y);
  const dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y), dot=(a,b)=>a.x*b.x+a.y*b.y;
  const local=(e,x,y)=>{const t=e.angle*rad,c=Math.cos(t),s=Math.sin(t);return vec(e.x+c*x-s*y,e.y+s*x+c*y)};
  const aligned=(a,b)=>Math.abs(Math.sin((a-b)*rad))<1e-6&&Math.cos((a-b)*rad)>0;
  function segmentDistance(p,a,b){const d=minus(b,a),u=clamp(dot(minus(p,a),d)/(dot(d,d)||1),0,1);return dist(p,vec(a.x+d.x*u,a.y+d.y*u));}
  function spectral(w){const stops=[[380,132,106,240],[435,133,134,255],[480,89,179,255],[500,88,225,212],[540,124,232,151],[575,214,232,111],[600,251,188,104],[650,255,121,111],[780,190,95,124]];let j=1;while(j<stops.length-1&&w>stops[j][0])j++;const a=stops[j-1],b=stops[j],t=clamp((w-a[0])/(b[0]-a[0]),0,1);return 'rgb('+[1,2,3].map(i=>Math.round(a[i]+(b[i]-a[i])*t)).join(',')+')';}
  const fixed=(v,n=1)=>num(v)?v.toFixed(n).replace('-','−'):'—';
  // A refracting specimen is a finite plate. Draw and pick its physical outline
  // from the same signed wedge angle as the rear interface in the ray tracer.
  const solidSpecimen = e => e.type === 'object' && (e.interaction === 'refract' || e.interaction === 'mixed');
  function specimenEdges(e){const a=e.aperture/2,t=Math.tan((e.wedge||0)*rad);return [local(e,0,-a),local(e,0,a),local(e,e.thickness+a*t,a),local(e,e.thickness-a*t,-a)];}
  function groupInfo(scene){
    const groups=new Map();for(const e of scene.elements){if(e.type==='lens'&&e.group){if(!groups.has(e.group))groups.set(e.group,[]);groups.get(e.group).push(e);}}
    const results=[];for(const [name,lenses] of groups){if(lenses.length<2)continue;const ref=lenses[0],u=vec(Math.cos(ref.angle*rad),Math.sin(ref.angle*rad)),v=vec(-u.y,u.x),ok=lenses.every(e=>aligned(ref.angle,e.angle)&&Math.abs(dot(minus(e,ref),v))<.002);const ordered=lenses.slice().sort((a,b)=>dot(minus(a,b),u));const first=ordered[0],last=ordered.at(-1);let metrics=null;if(ok){const els=ordered.map(e=>({...e,x:dot(minus(e,first),u),y:0,angle:0}));metrics=AdvancedOptics.paraxial({source:{...scene.source,x:-1000,y:0,angle:0,type:'collimated'},elements:els},scene.source.wavelength);}results.push({name,lenses,first,last,ok,metrics});}return results;
  }
  function relayInfo(scene,result){
    const els=scene.elements.filter(e=>e.type==='lens');
    if(els.length!==2||scene.elements.some(e=>e.type==='mirror'||e.type==='grating'))return null;
    const t=els[0].angle*rad;els.sort((a,b)=>(a.x-b.x)*Math.cos(t)+(a.y-b.y)*Math.sin(t));
    const [a,b]=els;if(!aligned(a.angle,b.angle))return null;
    const ma=result.lensMetrics?.find(m=>m.id===a.id),mb=result.lensMetrics?.find(m=>m.id===b.id);
    if(!(ma?.efl>0&&mb?.efl>0))return null;
    const A=local(a,ma.backFocalX,0),B=local(b,mb.frontFocalX,0),objectPlane=local(a,ma.frontFocalX,0),imagePlane=local(b,mb.backFocalX,0);
    const u=vec(Math.cos(a.angle*rad),Math.sin(a.angle*rad)),v=vec(-u.y,u.x);
    if(Math.abs(dot(minus(b,a),v))>.01)return null;
    const gap=dot(minus(B,A),u),tolerance=Math.max(.02,Math.min(.25,Math.min(ma.efl,mb.efl)*.001)),confocal=Math.abs(gap)<=tolerance;
    const specimen=scene.elements.find(e=>e.type==='object');
    if(specimen&&specimen.interaction!=='scatter')return null;
    const object=specimen||scene.source,objectMatch=(specimen||scene.source.type!=='collimated')&&Math.abs(dot(minus(object,objectPlane),u))<=tolerance&&aligned(object.angle,a.angle);
    const detectorMatch=scene.elements.some(e=>e.type==='screen'&&aligned(e.angle,a.angle)&&Math.abs(dot(minus(e,imagePlane),u))<=tolerance);
    return {gap,confocal,complete:confocal&&objectMatch&&detectorMatch,A,B,angle:a.angle,objectPlane,imagePlane,tolerance};
  }
  function create(canvas,handlers) {
    const c=canvas.getContext('2d');let scene,result,rayIndex=0,stepIndex=-1,groups=[],relay=null;
    let w=1,h=1,scale=1,fitScale=1,cx=0,cy=0,mode='select',drag=null,measurement=[],pointer=null,frame=0,handle=null,snapNote='',labelBoxes=[];
    const P=p=>vec(w/2+(p.x-cx)*scale,h/2-(p.y-cy)*scale), W=p=>vec(cx+(p.x-w/2)/scale,cy-(p.y-h/2)/scale);
    const queue=()=>{if(!frame)frame=requestAnimationFrame(()=>{frame=0;draw()})};
    function set(s,r,ri,si){const changed=result!==r;scene=s;result=r;rayIndex=ri;stepIndex=si;if(changed){groups=groupInfo(s);relay=relayInfo(s,r);}queue();}
    function bounds(){const pts=[scene.source];for(const e of scene.elements){if(solidSpecimen(e)){pts.push(...specimenEdges(e));continue;}const a=(e.type==='stop'?e.outerDiameter||100:e.aperture)/2;for(const x of [0,e.type==='lens'?e.thickness:0])for(const y of [-a,a])pts.push(local(e,x,y));}for(const ray of result?.rays||[]){if(ray.points[0])pts.push(ray.points[0]);for(const v of ray.events)pts.push(v);}return pts.filter(v=>num(v.x)&&num(v.y));}
    function fit(){if(!scene)return;const pts=bounds();let x0=Infinity,x1=-Infinity,y0=Infinity,y1=-Infinity;for(const p of pts){x0=Math.min(x0,p.x);x1=Math.max(x1,p.x);y0=Math.min(y0,p.y);y1=Math.max(y1,p.y);}const im=result?.paraxial?.imageX,span=Math.max(30,x1-x0);if(num(im)&&(im>x0-span*1.1&&im<x1+span*1.1)){x0=Math.min(x0,im);x1=Math.max(x1,im);}cx=(x0+x1)/2;cy=(y0+y1)/2;scale=fitScale=clamp(Math.min((w-60)/Math.max(45,x1-x0+20),(h-110)/Math.max(32,y1-y0+10)),.00002,25);queue();handlers.zoom(100);}
    function resize(){const r=canvas.getBoundingClientRect(),d=window.devicePixelRatio||1;w=r.width;h=r.height;canvas.width=Math.max(1,Math.round(w*d));canvas.height=Math.max(1,Math.round(h*d));c.setTransform(d,0,0,d,0,0);fit();}
    function zoom(f,p=vec(w/2,h/2)){const at=W(p);scale=clamp(scale*f,.015,100);cx=at.x-(p.x-w/2)/scale;cy=at.y+(p.y-h/2)/scale;handlers.zoom(Math.round(100*scale/fitScale));queue();}
    function line(a,b,color,weight=1,dash=[]){if(!a||!b||![a.x,a.y,b.x,b.y].every(num))return;const x=P(a),y=P(b);c.beginPath();c.setLineDash(dash);c.strokeStyle=color;c.lineWidth=weight;c.moveTo(x.x,x.y);c.lineTo(y.x,y.y);c.stroke();c.setLineDash([]);}
    function loop(points,fill,stroke,width=1){const ps=points.filter(p=>p&&num(p.x)&&num(p.y)).map(P);if(!ps.length)return;c.beginPath();ps.forEach((p,i)=>i?c.lineTo(p.x,p.y):c.moveTo(p.x,p.y));if(fill){c.closePath();c.fillStyle=fill;c.fill();}if(stroke){c.lineWidth=width;c.strokeStyle=stroke;c.stroke();}}
    function circle(p,size,fill,stroke){const a=P(p);c.beginPath();c.arc(a.x,a.y,size,0,Math.PI*2);if(fill){c.fillStyle=fill;c.fill();}if(stroke){c.lineWidth=1.5;c.strokeStyle=stroke;c.stroke();}}
    function label(str,p,color,pos='above',collision=false){if(!p||!num(p.x)||!num(p.y))return;const q=P(p);if(q.x<-45||q.x>w+45||q.y<0||q.y>h)return;c.font='10px "Segoe UI","Microsoft YaHei",sans-serif';const tw=c.measureText(str).width+10;let tx=clamp(q.x-tw/2,3,Math.max(3,w-tw-3)),ty=clamp(q.y+(pos==='above'?-20:5),33,h-32);if(collision){for(let i=0;i<5&&labelBoxes.some(b=>tx<b.x+b.w&&tx+tw>b.x&&ty<b.y+15&&ty+15>b.y);i++)ty=clamp(ty+(pos==='above'?-16:16),33,h-32);labelBoxes.push({x:tx,y:ty,w:tw});}c.fillStyle=scene.canvas.theme==='light'?'#f5f8f0df':'#132c28dd';c.fillRect(tx,ty,tw,15);c.fillStyle=color;c.textAlign='left';c.fillText(str,tx+5,ty+11);}
    function edge(e,side){const a=e.aperture/2,points=[];for(let i=0;i<=64;i++){const y=-a+a*2*i/64,s=AdvancedOptics.sag(y,e['r'+side],e['k'+side]||0,e['a4'+side]||0);if(num(s))points.push(local(e,(side===2?e.thickness:0)+s,y));}return points;}
    function optic(e,light){const a=e.aperture/2,sel=scene.selected===e.id,hi=light?'#246c5e':'#b4e6d5',muted=light?'#5e9380':'#75a693',accent=sel?hi:muted;
      if(e.type==='lens'){loop([...edge(e,1),...edge(e,2).reverse()],light?'#549b923e':'#83d4c52a',accent,sel?1.8:1.2);}
      if(e.type==='object'){
        const ochre=light?'#9b6530':'#ddb884';
        if(solidSpecimen(e))loop(specimenEdges(e),light?'#bca1693e':'#deb3782b',ochre,sel?1.8:1.2);
        line(local(e,0,-a),local(e,0,a),ochre,sel?8:7);
        const n=e.pattern?.length??33;
        for(let i=0;i<n;i++){
          const y0=-a+i*2*a/n, y1=-a+(i+1)*2*a/n, width=sel?5:4;
          if(e.interaction==='mixed'&&e.channels){
            const fractions=AdvancedOptics.cellFractions(e,i);
            let offset=-width/2;
            for(const [key,color] of [['scatter','#508467'],['reflection','#ad8344'],['transmission','#477d9b'],['absorption','#77777d']]){
              const band=fractions[key]*width;
              if(band>0){const x=(offset+band/2)/scale;line(local(e,x,y0),local(e,x,y1),color,band);}
              offset+=band;
            }
          }else{
            const shade=Math.round(35+210*e.pattern[i]);
            line(local(e,0,y0),local(e,0,y1),'rgb('+shade+','+shade+','+shade+')',width);
          }
        }
        for(const s of [-1,1])line(local(e,-4/scale,a*s),local(e,4/scale,a*s),ochre,2);
      }
      if(e.type==='mirror'){line(local(e,0,-a),local(e,0,a),light?'#9b773e':'#e0c57e',3);const step=Math.max(7/scale,2*a/40);for(let y=-a;y<a;y+=step)line(local(e,0,y),local(e,4/scale,y+4/scale),accent,1);}
      if(e.type==='grating'){line(local(e,0,-a),local(e,0,a),light?'#87588c':'#cda1d8',3,[2,2]);}
      if(e.type==='polarizer'||e.type==='retarder'){
        // The drawn width identifies the ideal sheet. Its traced surface is x=0.
        const tint=e.type==='polarizer'?(light?'#186d90':'#7bd8f8'):(light?'#815a98':'#d8b1ec');
        line(local(e,0,-a),local(e,0,a),tint,sel?3:2);
        if(e.type==='polarizer'){
          const step=Math.max(8/scale,2*a/36);
          for(let y=-a+step/2;y<a;y+=step)line(local(e,-3/scale,y),local(e,3/scale,y),tint);
        }else{
          line(local(e,3/scale,-a),local(e,3/scale,a),tint,1);
          for(const y of [-a,a])line(local(e,0,y),local(e,3/scale,y),tint);
        }
      }
      if(e.type==='screen'){line(local(e,0,-a),local(e,0,a),light?'#63783f':'#c3d799',2,[4,3]);}
      if(e.type==='stop'){const out=(e.outerDiameter||Math.max(100,e.aperture+40))/2;for(const s of [-1,1]){line(local(e,0,s*a),local(e,0,s*out),light?'#874735':'#cd9276',4);line(local(e,-2/scale,s*a),local(e,2/scale,s*a),accent,2);}}
    }
    function grid(light){const v=scene.canvas,step=v.gridStep;let s=step;while(s*scale<13)s*=2;const lo=W(vec(0,h)),hi=W(vec(w,0));if(v.grid){c.beginPath();c.strokeStyle=light?'#57765122':'#99b19916';c.lineWidth=1;for(let x=Math.ceil(lo.x/s)*s;x<=hi.x;x+=s){let p=P(vec(x,0));c.moveTo(p.x,0);c.lineTo(p.x,h);}for(let y=Math.ceil(lo.y/s)*s;y<=hi.y;y+=s){let p=P(vec(0,y));c.moveTo(0,p.y);c.lineTo(w,p.y);}c.stroke();}
      line(vec(lo.x,0),vec(hi.x,0),light?'#6c8e752f':'#aad1b033',1,[4,6]);c.font='9px Consolas,monospace';c.fillStyle=light?'#627668':'#6e8b7c';c.textAlign='center';let tick=s;while(tick*scale<60)tick*=2;for(let x=Math.ceil(lo.x/tick)*tick;x<=hi.x;x+=tick){const p=P(vec(x,0));if(p.x>18&&p.x<w-18)c.fillText(String(Number(x.toFixed(2))),p.x,h-24);}
    }
    function marks(e,m,prefix,light){if(!m?.valid)return;const tone=light?'#4f7958':'#a0be8f';for(const [key,sym] of [['frontFocalX','F'],['backFocalX','F′'],['h1X','H'],['h2X','H′']]){if(!num(m[key]))continue;const x=m[key],p=local(e,x,0),len=(sym.startsWith('H')?10:6)/scale;line(local(e,x,-len),local(e,x,len),tone,1,[2,2]);if(sym.startsWith('F'))circle(p,2.5,tone);label(prefix+sym,p,tone,'below',true);}}
    function visibleMidpoint(a,b){
      // Clip the segment before placing its mark; escaped rays often extend off screen.
      let from=0,to=1;
      for(const [start,end,min,max] of [[a.x,b.x,12,w-12],[a.y,b.y,44,h-38]]){
        if(start===end){if(start<min||start>max)return null;continue;}
        const t0=(min-start)/(end-start),t1=(max-start)/(end-start);
        from=Math.max(from,Math.min(t0,t1));to=Math.min(to,Math.max(t0,t1));
      }
      if(to<=from)return null;
      const t=(from+to)/2;
      return vec(a.x+(b.x-a.x)*t,a.y+(b.y-a.y)*t);
    }
    function polarizationGlyph(x,y,stokes,light,selected){
      const {type,degree,azimuth,ellipticity}=Polarization.describe(stokes);
      c.save();c.translate(x,y);
      c.fillStyle=light?'#fffef8':'#112d30';
      c.strokeStyle=selected?(light?'#895e17':'#edcf8a'):(light?'#46727c':'#a0c5ca');
      c.lineWidth=1;
      if(degree>1e-6&&degree<1-1e-6)c.setLineDash([2,2]);
      c.beginPath();c.roundRect(-11,-9,22,18,4);c.fill();c.stroke();c.setLineDash([]);
      c.lineWidth=1.5;c.lineCap='round';c.beginPath();
      if(type==='unpolarized'){
        for(let i=0;i<4;i++){
          const dx=5.7*Math.cos(i*Math.PI/4),dy=5.7*Math.sin(i*Math.PI/4);
          c.moveTo(-dx,-dy);c.lineTo(dx,dy);
        }
      }else if(type==='linear'){
        const dx=7*Math.cos(azimuth*rad),dy=-7*Math.sin(azimuth*rad);
        c.moveTo(-dx,-dy);c.lineTo(dx,dy);
      }else{
        c.rotate(-(azimuth||0)*rad);
        const major=6.4,minor=Math.max(1,major*Math.tan(Math.abs(ellipticity)*rad));
        c.ellipse(0,0,major,minor,0,0,2*Math.PI);
        // At the right extremity an upward arrow means counterclockwise.
        const turn=stokes[2]>0?-1:1;
        c.moveTo(major-2.2,-turn*1.5);c.lineTo(major,turn*1.5);c.lineTo(major+1.7,-turn*1.5);
      }
      c.stroke();c.restore();
    }
    function polarizationMarks(rays,highlight,stride,light){
      const seen=new WeakSet(),boxes=labelBoxes.map(b=>({...b,h:15}));
      function markRay(ray,selected){
        for(let j=0;j<ray.points.length-1;j++){
          const end=ray.points[j+1],event=ray.events[j];
          if(seen.has(end)||(event?.weightIn??ray.weight)<=0)continue;
          seen.add(end);
          const a=P(ray.points[j]),b=P(end),center=visibleMidpoint(a,b);
          if(!center)continue;
          const length=dist(a,b);
          if(!length||(!selected&&length<24))continue;
          const nx=(a.y-b.y)/length,ny=(b.x-a.x)/length;
          // Closely spaced surfaces can still show the selected path using a leader.
          // For the rest of a dense bundle keep only marks with clear space.
          const offsets=selected?[0,18,-18,36,-36,54,-54]:[0];
          let badge=selected?center:null;
          for(const offset of offsets){
            const x=center.x+nx*offset,y=center.y+ny*offset;
            if(x<12||x>w-12||y<42||y>h-35)continue;
            const pad=selected?2:9;
            if(boxes.some(b=>x+11+pad>b.x&&x-11-pad<b.x+b.w&&y+9+pad>b.y&&y-9-pad<b.y+b.h))continue;
            badge=vec(x,y);
            break;
          }
          if(!badge)continue;
          if(badge.x!==center.x||badge.y!==center.y){
            c.beginPath();c.strokeStyle=light?'#916f3b':'#bea86c';c.lineWidth=.8;
            c.moveTo(center.x,center.y);c.lineTo(badge.x,badge.y);c.stroke();
          }
          polarizationGlyph(badge.x,badge.y,event?.stokesIn??ray.stokes,light,selected);
          boxes.push({x:badge.x-11,y:badge.y-9,w:22,h:18});
        }
      }
      if(highlight)markRay(highlight,true);
      for(let i=0;i<rays.length;i+=stride)if(rays[i]!==highlight)markRay(rays[i],false);
    }
    function draw(){if(!scene||!result)return;const v=scene.canvas,light=v.theme==='light',fg=light?'#305c46':'#b2ceb7';labelBoxes=[];handle=null;c.clearRect(0,0,w,h);c.fillStyle=light?'#f2f4ea':v.theme==='navy'?'#172336':'#102829';c.fillRect(0,0,w,h);grid(light);
      const es=scene.elements,source=scene.source;
      if(v.axis){for(const e of es.filter(e=>e.type==='lens')){const ext=Math.max(35/scale,Math.min(120,2*e.aperture));line(local(e,-ext,0),local(e,ext+e.thickness,0),light?'#5b94846b':'#78b99b6b',1,[7,4]);}for(const g of groups.filter(g=>g.ok)){const e=g.first,b=g.last;line(local(e,-20/scale,0),local(b,b.thickness+20/scale,0),light?'#7e8149':'#c5bb85',1,[10,6,2,6]);}}
      es.forEach(e=>optic(e,light));
      const rays=result.rays||[],highlight=rays[rayIndex],specimen=es.find(e=>e.type==='object');
      const weighted=!!specimen||es.some(e=>e.type==='polarizer');
      // Draw a shared incident trunk once, then its individual outgoing branches.
      // All numerical profiles use the weights themselves; opacity is only a visual cue.
      const stride=specimen?Math.max(1,Math.ceil(rays.length/850)):1,drawnEndpoints=new WeakSet();
      for(let i=0;i<rays.length;i+=stride){const r=rays[i];if(r===highlight)continue;const color=v.spectral?spectral(r.wavelength):light?'#5e826c':'#a4ceb1';
        if(!weighted){c.globalAlpha=v.opacity/100;loop(r.points,null,color,1.05);continue;}
        for(let j=1;j<r.points.length;j++){
          // Children share the actual prefix points, including after a second split.
          const end=r.points[j];
          if(drawnEndpoints.has(end))continue;
          drawnEndpoints.add(end);
          const pathWeight=r.events[j-2]?.weightOut??1;
          if(pathWeight<=0)continue;
          c.globalAlpha=v.opacity/100*clamp(Math.sqrt(pathWeight),.05,1);line(r.points[j-1],r.points[j],color,1.05);
        }
      }
      c.globalAlpha=1;
      const card=result.paraxial;
      if(v.imagePlane&&card.valid&&num(card.imageX)&&Math.abs(source.angle)<1e-7){
        const x=card.imageX,virt=x<card.lastX,tone=light?'#8b5e88':'#bc95bf',hit=highlight?.objectHits?.[0],sampleY=specimen?(hit?(specimen.y+hit.localY)*card.magnification:null):source.type==='collimated'?0:(source.y+(highlight?.field||0))*card.magnification;
        line(vec(x,W(vec(0,45)).y),vec(x,W(vec(0,h-35)).y),tone,1,[5,6]);
        label(virt?'近轴虚像面':'近轴像面',vec(x,W(vec(0,65)).y),tone,'below',true);
        if(num(sampleY))circle(vec(x,sampleY),3,null,tone);
        if(virt&&highlight){const lenses=es.filter(e=>e.type==='lens').sort((a,b)=>a.x-b.x),last=lenses.at(-1);for(const r of rays){
          if(r.field!==highlight.field||r.wavelength!==highlight.wavelength||(specimen&&(!hit||r.objectHits?.[0]?.localY!==hit.localY)))continue;const ex=r.events.filter(e=>e.type==='lens').at(-1);if(!ex||ex.elementId!==last?.id||ex.surface!=='S2'||ex.kind!=='refract'||ex.outDirection.x<=1e-9)continue;const d=ex.outDirection,dt=(x-ex.x)/d.x;if(dt<0)line(ex,plus(ex,vec(dt*d.x,dt*d.y)),tone,.8,[3,5]);
        }}
      }
      if(highlight){loop(highlight.points,null,light?'#8f6726':'#fae8b4',1.7);for(const e of highlight.events)circle(e,2,light?'#92713f':'#ddc78f');const event=highlight.events[stepIndex];if(event){const p=vec(event.x,event.y),n=event.normal;if(n){line(plus(p,vec(-n.x*23/scale,-n.y*23/scale)),plus(p,vec(n.x*23/scale,n.y*23/scale)),light?'#973e68':'#f1adcb',1.2,[3,3]);}circle(p,5,null,light?'#9e476b':'#efaac7');label('● '+(stepIndex+1)+' / '+event.surface,p,light?'#874267':'#edc5d7','above',true);}}
      for(const d of result.detectors||[]){for(const hit of d.hits){c.globalAlpha=weighted?clamp(Math.sqrt(hit.weight??1),0,1):1;if(num(hit.x)&&num(hit.globalY))circle(vec(hit.x,hit.globalY),2.2,v.spectral?spectral(hit.wavelength):fg);}}c.globalAlpha=1;
      const sy=source.type==='collimated'?source.width/2:source.type==='field'?source.height/2:0;line(local(source,0,-sy),local(source,0,sy),light?'#956727':'#e4c27a',2);circle(source,3,light?'#ac7d3d':'#f2ce84');label('光源',local(source,0,Math.max(sy,5/scale)),light?'#8e692a':'#e5cb92','above',true);
      for(const e of es){let y=e.type==='stop'?(e.outerDiameter||100)/2:e.aperture/2;label(e.name||e.id,local(e,0,y),light?'#405d48':fg,'above',true);}
      if(v.cardinal){for(const m of result.lensMetrics||[]){const e=es.find(o=>o.id===m.id);if(e&&(e.id===scene.selected||v.allMarks))marks(e,m,'',light);}for(const g of groups)if(g.ok&&(v.allMarks||g.lenses.some(e=>e.id===scene.selected)))marks(g.first,g.metrics,'组',light);if(relay?.confocal){line(local({...relay.A,angle:relay.angle},0,-25/scale),local({...relay.A,angle:relay.angle},0,25/scale),light?'#71783c':'#c1cb86',1,[3,3]);label(relay.complete?'4f · 共焦面':'共焦面',relay.A,light?'#687438':'#c3d18e','above',true);}}
      const sel=scene.selected==='source'?source:es.find(e=>e.id===scene.selected);if(sel&&mode==='select'){circle(sel,4,null,light?'#477765':'#9dd2bb');handle=local(sel,27/scale,-13/scale);line(sel,handle,light?'#678774':'#94bf9f',1,[3,3]);circle(handle,4.5,light?'#f0f4e7':'#264a3d','#92bd9d');}
      if(measurement.length){const a=measurement[0],b=measurement[1]||(mode==='ruler'&&pointer?W(pointer):null);circle(a,3,'#e4ad6c');if(b){circle(b,3,'#e4ad6c');line(a,b,'#dfac6b',1.5,[5,3]);label(fixed(dist(a,b),2)+' mm  ·  '+fixed(Math.atan2(b.y-a.y,b.x-a.x)/rad,1)+'°',vec((a.x+b.x)/2,(a.y+b.y)/2),light?'#94672f':'#e5bd88','above',true);}}
      if(snapNote&&drag){label(snapNote,W(vec(drag.last.x,drag.last.y-12)),light?'#4e785e':'#b9d9b6','above');}
      if(v.polarization)polarizationMarks(rays,highlight,stride,light);
    }
    function eventPoint(e){const r=canvas.getBoundingClientRect();return vec(e.clientX-r.left,e.clientY-r.top);}
    function objectAt(p){if(dist(p,P(scene.source))<12)return 'source';let best=Infinity,id=null;for(const e of scene.elements){const a=(e.type==='stop'?e.outerDiameter||100:e.aperture)/2;const d=e.type==='lens'?Math.min(...[...edge(e,1),...edge(e,2)].map(q=>dist(P(q),p)),segmentDistance(p,P(local(e,e.thickness/2,-a)),P(local(e,e.thickness/2,a)))):solidSpecimen(e)?Math.min(...specimenEdges(e).map((q,i,vs)=>segmentDistance(p,P(q),P(vs[(i+1)%vs.length])))):segmentDistance(p,P(local(e,0,-a)),P(local(e,0,a)));if(d<best&&d<11){best=d;id=e.id;}}return id;}
    function rayAt(p){let best=6,choice=null;for(const [i,r] of result.rays.entries()){for(let j=1;j<r.points.length;j++){const d=segmentDistance(p,P(r.points[j-1]),P(r.points[j]));if(d<best){best=d;choice=[i,Math.min(j-1,r.events.length-1)];}}}return choice;}
    function snapPos(e,world,bypass){snapNote='';if(!scene.canvas.snap||bypass)return world;const threshold=7/scale;const eligible=scene.elements.filter(a=>a.type==='lens'&&a.id!==e.id&&!(scene.canvas.groupLock&&e.group&&a.group===e.group)),m=result.lensMetrics.find(m=>m.id===e.id);let best=threshold,out=null;
      for(const a of eligible){const met=result.lensMetrics.find(z=>z.id===a.id);if(!met)continue;for(const k of ['frontFocalX','backFocalX']){if(!num(met[k]))continue;const f=local(a,met[k],0),ref=e.type==='lens'&&m&&num(m.frontFocalX)&&aligned(e.angle,a.angle)?local({...e,...world},k==='backFocalX'?m.frontFocalX:m.backFocalX,0):world;const d=dist(ref,f);if(d<best){best=d;out=plus(world,minus(f,ref));snapNote=e.type==='lens'?'焦平面重合':'对齐焦点';}}}
      if(out)return out;let candidate={...world};const step=scene.canvas.gridStep;for(const key of ['x','y']){const g=Math.round(candidate[key]/step)*step;if(Math.abs(g-candidate[key])<4/scale){candidate[key]=g;snapNote='网格';}}
      for(const a of eligible){const t=a.angle*rad,v=vec(-Math.sin(t),Math.cos(t)),off=dot(minus(candidate,a),v);if(Math.abs(off)<best){best=Math.abs(off);out=minus(candidate,vec(v.x*off,v.y*off));snapNote='对齐光轴';}}return out||candidate;
    }
    canvas.addEventListener('pointerdown',e=>{if(!scene||e.button!==0)return;const p=eventPoint(e),world=W(p);pointer=p;canvas.focus({preventScroll:true});if(mode==='ruler'){if(measurement.length===2)measurement=[];measurement.push(world);queue();return;}
      const rotating=mode==='select'&&handle&&dist(p,P(handle))<=8;const id=mode==='select'?(rotating?scene.selected:objectAt(p)):null;
      const obj=id==='source'?scene.source:scene.elements.find(o=>o.id===id);drag={p,last:p,cx,cy,id,obj:obj&&{...obj},rotating,offset:obj?minus(world,obj):null,initialAngle:obj?Math.atan2(world.y-obj.y,world.x-obj.x)/rad:0,moved:false};canvas.setPointerCapture(e.pointerId);
      if(id){handlers.select(id);handlers.begin();}canvas.style.cursor='grabbing';});
    canvas.addEventListener('pointermove',e=>{const p=eventPoint(e),world=W(p);pointer=p;handlers.coordinate(fixed(world.x)+' / '+fixed(world.y)+' mm');if(!drag){canvas.style.cursor=mode==='ruler'?'crosshair':mode==='pan'?'grab':handle&&dist(p,P(handle))<8?'crosshair':objectAt(p)?'move':'crosshair';if(mode==='ruler')queue();return;}
      drag.last=p;if(!drag.moved&&dist(p,drag.p)<2)return;drag.moved=true;
      if(!drag.id){cx=drag.cx-(p.x-drag.p.x)/scale;cy=drag.cy+(p.y-drag.p.y)/scale;queue();return;}
      const o=drag.obj;if(drag.rotating){let a=o.angle+Math.atan2(world.y-o.y,world.x-o.x)/rad-drag.initialAngle;if(scene.canvas.snap&&!e.altKey){a=Math.round(a/5)*5;snapNote='5° 角度磁吸';}a=((a+540)%360)-180;handlers.move(drag.id,{angle:Number(a.toFixed(3))});}else{const pos=snapPos(o,minus(world,drag.offset),e.altKey);handlers.move(drag.id,{x:Number(pos.x.toFixed(3)),y:Number(pos.y.toFixed(3))});}queue();});
    function finish(e){if(!drag)return;if(!drag.id&&!drag.moved&&mode==='select'&&e.type==='pointerup'){const hit=rayAt(drag.p);if(hit)handlers.ray(...hit);}if(drag.id)handlers.end();drag=null;snapNote='';queue();}
    for(const type of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(type,finish);
    canvas.addEventListener('wheel',e=>{e.preventDefault();zoom(Math.exp(-clamp(e.deltaY,-150,150)*.0018),eventPoint(e));},{passive:false});
    canvas.addEventListener('keydown',e=>{if(['+','=','-','0','Escape'].includes(e.key)){e.preventDefault();if(e.key==='0')fit();else if(e.key==='Escape'){measurement=[];queue();}else zoom(e.key==='-'?1/1.25:1.25);}});
    new ResizeObserver(resize).observe(canvas);resize();
    return {set,fit,zoom,draw,setMode(m){mode=m;queue();},clearMeasure(){measurement=[];queue();},getRelay:()=>relay,getGroups:()=>groups};
  }
  window.AdvCanvas={create};
})();
