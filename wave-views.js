/* Scientific maps use row 0 at +z, column 0 at −y. Lengths are in mm. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WaveViews = factory();
})(globalThis, () => {
  'use strict';
  const channels = ['t','r','s','opd'];
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
  const fmt = x => !Number.isFinite(x) ? '—' : Number(x.toPrecision(4)).toString();
  const density = '相对功率/mm²';
  const layers = {
    intensity:['强度',density], ellipse:['偏振椭圆 · 强度',density], phase:['相对相位','rad'],
    q:['S₁/S₀','1'], u:['S₂/S₀','1'], v:['S₃/S₀','1'], dop:['偏振度','1'],
    frame0:['参考移相 0 · 合束端强度',density], frame1:['参考移相 π/2 · 合束端强度',density],
    frame2:['参考移相 π · 合束端强度',density], frame3:['参考移相 3π/2 · 合束端强度',density],
    recovered:['四步重建 · 相对参考臂相位','rad'], visibility:['干涉条纹可见度','1'],
    phaseError:['重建相位圆周误差','rad']
  };
  const signed = key => key === 'q' || key === 'u' || key === 'v';
  const isFrame = key => ['frame0','frame1','frame2','frame3'].includes(key);
  const phaseMap = key => key === 'phase' || key === 'recovered';
  const isMeasurement = key => isFrame(key)||['recovered','visibility','phaseError'].includes(key);
  const intensityLike = layer => layer === 'intensity' || layer === 'ellipse' || isFrame(layer);
  function selectedLines(result, line) {
    if (line == null || line === 'all') return result.lines.map(l => ({l,w:l.weight}));
    const l = result.lines[Number(line)];
    return l ? [{l,w:l.weight}] : [];
  }

  function derive(result, opts = {}) {
    const {n,width} = result, count = n*n;
    const layer = Object.hasOwn(layers,opts.layer) ? opts.layer : 'intensity';
    const values = new Float32Array(count);
    const lines = selectedLines(result,opts.line);
    let peak = 0, rawMax = -Infinity, rawMin = Infinity, finiteCount = 0;
    const needStokes = signed(layer) || layer === 'dop' || layer === 'ellipse';
    const sums = {i:new Float64Array(count)};
    const measured = isMeasurement(layer), frame = isFrame(layer)?Number(layer.slice(-1)):-1;
    if (needStokes) for (const k of ['q','u','v']) sums[k] = new Float64Array(count);
    if (!measured) for (const {l,w} of lines) {
      for (const k of Object.keys(sums)) {
        const dest = sums[k], src = l[k];
        for (let p=0;p<count;p++) dest[p] += w*src[p];
      }
    }
    const activeLine = result.lines.indexOf(lines[0]?.l);
    const matchedLine = result.phaseLine == null || result.phaseLine === activeLine;
    const matchedAxis = !opts.phaseAxis || !result.phaseAxis || opts.phaseAxis === result.phaseAxis;
    const matchedMode = opts.mode == null || result.mode == null || Number(opts.mode) === result.mode;
    const matches = lines.length === 1 && matchedLine && matchedAxis && matchedMode;
    const phase = matches ? result.phase : null;
    const acq = matches && measured ? result.measurement : null;
    if (acq) {
      if (frame>=0) sums.i.set(acq.frames[frame]);
      else for (const image of acq.frames) for(let j=0;j<count;j++) sums.i[j]+=image[j]/4;
    }
    for (const i of sums.i) peak = Math.max(peak,i);
    const epsilon = peak * 1e-10;
    for (let p=0;p<count;p++) {
      const i = sums.i[p];
      if (measured && !acq) values[p] = NaN;
      else if (intensityLike(layer)) values[p] = i;
      else if (layer === 'visibility') values[p] = acq.visibility[p];
      else if (layer === 'recovered') values[p] = acq.phase[p];
      else if (layer === 'phaseError') {
        const delta=acq.phase[p]-(phase?.[p]-acq.referencePhaseRad);
        values[p]=Math.atan2(Math.sin(delta),Math.cos(delta));
      }
      else if (i <= epsilon) values[p] = NaN;
      else if (layer === 'phase') values[p] = phase ? phase[p] : NaN;
      else if (layer === 'dop') values[p] = clamp(Math.hypot(sums.q[p],sums.u[p],sums.v[p])/i,0,1);
      else values[p] = clamp(sums[layer][p]/i,-1,1);
      if (Number.isFinite(values[p])) {
        finiteCount++;
        rawMax = Math.max(rawMax,values[p]);rawMin = Math.min(rawMin,values[p]);
      }
    }
    let min = 0, max = 1;
    if (phaseMap(layer) || layer==='phaseError') { min = -Math.PI; max = Math.PI; }
    else if (signed(layer)) min = -1;
    else if (intensityLike(layer)) max = opts.lockedMax > 0 ? opts.lockedMax : finiteCount?rawMax:0;
    return {values,n,width,layer,min,max,peak,unit:layers[layer][1],label:layers[layer][0],sums,
      actualMin:finiteCount?rawMin:null,actualMax:finiteCount?rawMax:null,hasFinite:finiteCount>0,finiteCount,
      centerY:result.centerY??0,centerZ:result.centerZ??0};
  }

  function inBounds(p,n) {
    return {col:clamp(Math.round(p.col),0,n-1),row:clamp(Math.round(p.row),0,n-1)};
  }
  function inspect(result, opts, kind, start, end = start, view = derive(result,opts)) {
    const {n,width,values,unit,label} = view, pitch = width/n, area = pitch*pitch;
    const a = inBounds(start,n), b = inBounds(end,n);
    const lo = kind === 'roi' ? {col:Math.min(a.col,b.col),row:Math.min(a.row,b.row)} : b;
    const hi = kind === 'roi' ? {col:Math.max(a.col,b.col),row:Math.max(a.row,b.row)} : b;
    const spectrum = isMeasurement(view.layer) ? [] : result.lines.map(({wavelength,weight,i}) => {
      let sum = 0;
      for (let row=lo.row;row<=hi.row;row++)
        for (let col=lo.col;col<=hi.col;col++) sum += i[row*n+col];
      return {wavelength,power:weight*sum*area};
    });
    const endIndex = b.row*n+b.col, value = values[endIndex];
    const y = view.centerY+(b.col+.5-n/2)*pitch, z = view.centerZ+(n/2-b.row-.5)*pitch;
    let power = 0;
    for (let row=lo.row;row<=hi.row;row++)
      for (let col=lo.col;col<=hi.col;col++) power += view.sums.i[row*n+col]*area;
    if (isMeasurement(view.layer) && result.measurement)
      spectrum.push({wavelength:result.lines[result.phaseLine??0].wavelength,power});
    const profile = [];
    let text;
    if (kind === 'line') {
      const dx = b.col-a.col, dz = b.row-a.row, steps = Math.max(Math.abs(dx),Math.abs(dz));
      const length = Math.hypot(dx,dz)*pitch;
      for (let j=0;j<=steps;j++) {
        const t = steps ? j/steps : 0;
        const index = Math.round(a.row+t*dz)*n+Math.round(a.col+t*dx);
        profile.push({distance:length*t,value:values[index]});
      }
      text = '剖面长 '+fmt(length)+' mm · '+(steps+1)+' 个采样点';
    } else if (kind === 'roi') {
      const prefix=isMeasurement(view.layer)&&!isFrame(view.layer)?'四帧平均功率':'区域相对功率';
      text = (hi.col-lo.col+1)+' × '+(hi.row-lo.row+1)+' 像素 · '+prefix+' '+fmt(power);
    } else {
      text = 'y '+fmt(y)+' mm · z '+fmt(z)+' mm · '+label+' '+fmt(value)+(unit==='1'?'':' '+unit);
    }
    return {kind,text,y,z,value,unit,spectrum,profile,power};
  }

  function figureNotes(result,opts,metadata) {
    const band = selectedLines(result,opts.line).map(({l,w}) => fmt(l.wavelength)+' nm × '+fmt(w)).join(' / ');
    const notes = [
      [metadata.name,metadata.plane].filter(Boolean).join(' · '),
      '波长与权重 '+band,
      '视场 '+fmt(result.width)+' mm · '+result.n+' × '+result.n+' · 像素间距 '+fmt(1000*result.width/result.n)+' µm',
      '源总功率为 1 · 各谱线强度按其入射权重计入 · 向右 +y，向上 +z'
    ];
    if (opts.layer === 'phase' || isMeasurement(opts.layer)) {
      const axis = opts.phaseAxis === 'z' ? 'E𝓏' : 'Eᵧ';
      const reference=isMeasurement(opts.layer)?'同源参考臂，相位 '+fmt(result.measurement?.referencePhaseRad)+' rad':(metadata.reference||'光源发射相位');
      notes.push(axis+' · 空间模式 '+(metadata.mode??opts.mode??0)+' · 参考 '+reference);
      if(opts.layer==='phaseError')notes.push('误差等于重建值减去理论样品臂与参考臂的相位差，包裹到 ±π。');
    }
    if (metadata.model) notes.push(String(metadata.model));
    return notes.filter(Boolean);
  }
  function toCSV(result,opts = {},metadata = {}) {
    const {values,n,width,unit,label,centerY,centerZ} = derive(result,opts);
    const rows = ['# '+label+', '+unit,...figureNotes(result,opts,metadata).map(s=>'"# '+s.replace(/"/g,'""')+'"'),
      'y_mm,z_mm,value'];
    for (let j=0;j<n;j++) {
      const z = centerZ+(n/2-j-.5)*width/n;
      for (let k=0;k<n;k++) {
        const val = values[j*n+k];
        rows.push([centerY+(k+.5-n/2)*width/n,z,Number.isFinite(val)?val:''].join(','));
      }
    }
    return rows.join('\r\n');
  }

  // Precompute continuous colour tables once. Opposite phase limits have identical colours.
  const colors = {
    intensity:['100d27','3a1b60','71356b','ac4865','dc7154','f2a95b','f7dd8b','fff6c2'],
    signed:['264783','4778ab','98b8cf','f2eee7','e7b398','be6b51','893c40'],
    cyclic:['a7d7d1','7789bd','6a4a82','7e3a52','ad624c','cbaa74','a7d7d1'],
    material:['0d2025','164047','216467','33918a','73bdaa','bcdeca','eff4d9']
  };
  const tables = Object.fromEntries(Object.entries(colors).map(([key,stops]) => {
    const rgb = stops.map(hex=>[0,2,4].map(offset=>parseInt(hex.slice(offset,offset+2),16)));
    return [key,Array.from({length:256},(_,i) => {
      const idx = i*(rgb.length-1)/255, a=Math.floor(idx), b=Math.min(rgb.length-1,a+1);
      return rgb[a].map((v,k)=>Math.round(v+(rgb[b][k]-v)*(idx-a)));
    })];
  }));
  const frames = new WeakMap();
  function makeFrame(canvas,width,height,dimensions) {
    const bounds = dimensions||canvas.getBoundingClientRect();
    const w = Math.max(32,bounds.width), h = Math.max(32,bounds.height);
    const ratio = dimensions?.ratio||Math.min(3,globalThis.devicePixelRatio||1);
    const bw = Math.round(w*ratio), bh = Math.round(h*ratio);
    if (canvas.width!==bw) canvas.width = bw;
    if (canvas.height!==bh) canvas.height = bh;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(bw/w,0,0,bh/h,0,0);
    ctx.fillStyle='#102128'; ctx.fillRect(0,0,w,h);
    const left=22, right=15, top=19, bottom=52;
    const scale=Math.min(Math.max(1,w-left-right)/width,Math.max(1,h-top-bottom)/height);
    const pw=scale*width,ph=scale*height;
    const frame = {ctx,w,h,pw,ph,x:left+(w-left-right-pw)/2,y:top+(h-top-bottom-ph)/2,
      width,height};
    frames.set(canvas,frame);
    return frame;
  }
  function drawMap(frame,n,values,min,max,palette,log) {
    const {ctx,x,y,pw,ph}=frame;
    const bitmap = document.createElement('canvas'); bitmap.width=bitmap.height=n;
    const scratch = bitmap.getContext('2d'), image = scratch.createImageData(n,n);
    const table=tables[palette], range=max-min, scale=range>0?1/range:0;
    for (let j=0;j<values.length;j++) {
      const v=values[j], index=4*j;
      let t=clamp((v-min)*scale,0,1);
      // In log mode a fixed four-decade range ends at the same physical maximum.
      if (log) t=clamp(1+Math.log10(Math.max(t,1e-4))/4,0,1);
      const rgb=Number.isFinite(v)?table[Math.round(t*255)]:[38,51,57];
      image.data[index]=rgb[0]; image.data[index+1]=rgb[1]; image.data[index+2]=rgb[2]; image.data[index+3]=255;
    }
    scratch.putImageData(image,0,0); ctx.imageSmoothingEnabled=false;
    ctx.drawImage(bitmap,x,y,pw,ph);
  }
  const axisFont='10px Consolas, ui-monospace, monospace';
  function axes(frame,palette,min,max,scaleUnit,log,phase=false,centerY=0,centerZ=0) {
    const {ctx,x,y,pw,ph,width,height,w,h}=frame;
    ctx.strokeStyle='#587179'; ctx.lineWidth=1;
    ctx.strokeRect(x-.5,y-.5,pw+1,ph+1);
    ctx.fillStyle='#bdcacf'; ctx.font=axisFont; ctx.textBaseline='alphabetic';
    ctx.textAlign='left';ctx.fillText('+z ↑   '+fmt(centerZ+height/2)+' mm',x,Math.max(11,y-5));
    ctx.fillText(fmt(centerY-width/2),x,y+ph+14);
    ctx.textAlign='right';ctx.fillText(fmt(centerY+width/2)+' mm  → +y',x+pw,y+ph+14);
    const barW=Math.max(15,Math.min(w*.36,140)), start=(w-barW)/2, barY=h-18;
    const grad=ctx.createLinearGradient(start,0,start+barW,0);
    colors[palette].forEach((v,i)=>grad.addColorStop(i/(colors[palette].length-1),'#'+v));
    ctx.fillStyle=grad;ctx.fillRect(start,barY,barW,5);
    ctx.fillStyle='#bdcacf';ctx.textAlign='right';ctx.fillText(phase?'−π':fmt(log?max*1e-4:min),start-4,barY+6);
    ctx.textAlign='left';ctx.fillText(phase?'+π':fmt(max),start+barW+4,barY+6);
    ctx.textAlign='center';ctx.font='9px system-ui,sans-serif';ctx.fillText(scaleUnit+(log?' · 对数':''),w/2,h-2);
    ctx.textAlign='start';
  }
  function ellipses(frame,view) {
    const {n,peak,sums}=view, {ctx,x,y,pw,ph}=frame;
    const step=Math.max(1,Math.ceil(n/Math.max(3,Math.min(15, Math.floor(pw/20)))));
    const radius=step*pw/n*.31;
    for (let j=Math.floor(step/2);j<n;j+=step) for (let k=Math.floor(step/2);k<n;k+=step) {
      const p=j*n+k, i=sums.i[p], q=sums.q[p],u=sums.u[p],v=sums.v[p];
      const polarized=Math.hypot(q,u,v);
      if (i<=peak*1e-4 || polarized<=i*.015) continue;
      const angle=.5*Math.atan2(u,q), chi=.5*Math.asin(clamp(v/polarized,-1,1));
      const cx=x+(k+.5)*pw/n,cy=y+(j+.5)*ph/n,minor=radius*Math.abs(Math.tan(chi));
      ctx.save();ctx.translate(cx,cy);ctx.rotate(-angle);
      ctx.beginPath();
      if (minor<.5) {ctx.moveTo(-radius,0);ctx.lineTo(radius,0);}
      else {
        ctx.ellipse(0,0,radius,minor,0,0,Math.PI*2);
        // In the (+y,+z) view V+ circulates anticlockwise. Mark the tangent at the right end.
        const arrow=Math.min(2.4,minor*.75), sense=v>0?-1:1;
        ctx.moveTo(radius-arrow,-sense*arrow);ctx.lineTo(radius,0);ctx.lineTo(radius+arrow,-sense*arrow);
      }
      ctx.strokeStyle='#14262c';ctx.lineWidth=2.9;ctx.stroke();
      ctx.strokeStyle='#f7f6e7';ctx.lineWidth=1.15;ctx.stroke();ctx.restore();
    }
  }
  const resultCaches = new WeakMap();
  function drawView(frame,view,opts) {
    const {layer,min,max}=view;
    const palette=phaseMap(layer)?'cyclic':signed(layer)||layer==='phaseError'?'signed':'intensity';
    const log=!!opts.log&&intensityLike(layer)&&max>0;
    drawMap(frame,view.n,view.values,min,max,palette,log);
    if (layer==='ellipse') ellipses(frame,view);
    axes(frame,palette,min,max,view.unit,log,phaseMap(layer)||layer==='phaseError',view.centerY,view.centerZ);
  }
  function renderResult(canvas,result,opts={}) {
    const view=derive(result,opts), frame=makeFrame(canvas,view.width,view.width);
    drawView(frame,view,opts);
    const base=document.createElement('canvas');
    base.width=canvas.width;base.height=canvas.height;
    base.getContext('2d').drawImage(canvas,0,0);
    resultCaches.set(canvas,{result,view,base});
    return view;
  }
  function figureCanvas(canvas,result,opts={},metadata={}) {
    const view=derive(result,opts), paper=canvas.ownerDocument.createElement('canvas');
    const plot=canvas.ownerDocument.createElement('canvas');
    drawView(makeFrame(plot,view.width,view.width,{width:520,height:520,ratio:2}),view,opts);
    const notes=figureNotes(result,opts,metadata);
    const ctx=paper.getContext('2d'), margin=34, lines=[];
    ctx.font='21px system-ui,sans-serif';
    for(const note of notes) {
      let line='';
      for(const letter of Array.from(note)) {
        if(ctx.measureText(line+letter).width>plot.width-2*margin){lines.push(line);line='';}
        line+=letter;
      }
      if(line)lines.push(line);
    }
    paper.width=plot.width;paper.height=plot.height+78+lines.length*31+margin;
    ctx.fillStyle='#102128';ctx.fillRect(0,0,paper.width,paper.height);
    ctx.fillStyle='#e2eeea';ctx.font='600 31px system-ui,sans-serif';ctx.fillText(view.label,margin,47);
    ctx.drawImage(plot,0,65);ctx.fillStyle='#c5d4d1';ctx.font='21px system-ui,sans-serif';
    lines.forEach((line,i)=>ctx.fillText(line,margin,plot.height+96+31*i));
    return paper;
  }
  function sampleAt(canvas,event,n,allowOutside=false) {
    const frame=frames.get(canvas);
    if (!frame || !n) return null;
    const bounds=canvas.getBoundingClientRect();
    const u=((event.clientX-bounds.left)*frame.w/bounds.width-frame.x)/frame.pw;
    const v=((event.clientY-bounds.top)*frame.h/bounds.height-frame.y)/frame.ph;
    if (!allowOutside && (u<0||u>1||v<0||v>1)) return null;
    return inBounds({col:Math.floor(u*n),row:Math.floor(v*n)},n);
  }
  function selection(frame,n,a,b,tool) {
    const {ctx,x,y,pw,ph}=frame, sx=pw/n, sy=ph/n;
    const ax=x+(a.col+.5)*sx,ay=y+(a.row+.5)*sy,bx=x+(b.col+.5)*sx,by=y+(b.row+.5)*sy;
    ctx.save();ctx.beginPath();ctx.rect(x,y,pw,ph);ctx.clip();ctx.beginPath();
    if (tool==='point') {
      ctx.moveTo(bx-10,by);ctx.lineTo(bx+10,by);ctx.moveTo(bx,by-10);ctx.lineTo(bx,by+10);
    } else if (tool==='rect'||tool==='roi') {
      ctx.rect(Math.min(ax,bx)-sx/2,Math.min(ay,by)-sy/2,Math.abs(ax-bx)+sx,Math.abs(ay-by)+sy);
    } else {ctx.moveTo(ax,ay);ctx.lineTo(bx,by);}
    ctx.strokeStyle='#0a1920';ctx.lineWidth=3;ctx.stroke();ctx.strokeStyle='#edffff';ctx.lineWidth=1;
    if (tool!=='point') ctx.setLineDash([4,3]);ctx.stroke();ctx.restore();
  }

  function attachProbe(canvas,{getResult,getOptions,onRead}) {
    let chosen=null,drag=null;
    const getCache=()=>{const c=resultCaches.get(canvas);return c?.result===getResult()?c:null;};
    const paint=(cache,pick)=>{
      const frame=frames.get(canvas);
      frame.ctx.drawImage(cache.base,0,0,frame.w,frame.h);
      if (pick) selection(frame,cache.view.n,pick.a,pick.b,pick.kind);
    };
    function refresh() {
      const cache=getCache();
      if (cache) paint(cache,chosen);
      onRead(chosen&&cache?inspect(cache.result,getOptions(),chosen.kind,chosen.a,chosen.b,cache.view):null);
    }
    function clear(){chosen=null;drag=null;refresh();}
    canvas.style.touchAction='none';
    canvas.addEventListener('pointerdown',e=>{
      if (drag||e.button!==0) return;
      const cache=getCache(),a=cache&&sampleAt(canvas,e,cache.view.n);
      if (!a) return;
      const kind=getOptions().probe||'point';
      drag={a,b:a,kind,id:e.pointerId};
      canvas.setPointerCapture(e.pointerId);paint(cache,drag);
    });
    function move(e) {
      if (!drag||e.pointerId!==drag.id) return;
      const cache=getCache();
      if (!cache){drag=null;return;}
      drag.b=sampleAt(canvas,e,cache.view.n,true);
      paint(cache,drag);
    }
    canvas.addEventListener('pointermove',move);
    canvas.addEventListener('pointerup',e=>{
      if (!drag||drag.id!==e.pointerId) return;
      move(e);chosen=drag;drag=null;refresh();
    });
    canvas.addEventListener('pointercancel',()=>{drag=null;refresh();});
    return {refresh,clear};
  }

  function stroke(map,brush,start,end,changes=new Map()) {
    const {size:n}=map, {tool,channel}=brush;
    if (!channels.includes(channel)||!Number.isFinite(brush.value)) return changes;
    function set(col,row) {
      if(col<0||row<0||col>=n||row>=n)return;
      const index=row*n+col;
      if(!changes.has(index)) changes.set(index,channels.map(k=>map[k][index]));
      if(tool==='erase'){for(const key of channels)map[key][index]=0;return;}
      if(channel==='opd'){map.opd[index]=brush.value;return;}
      const allowed=1-(channel==='t'?0:map.t[index])-(channel==='r'?0:map.r[index])-(channel==='s'?0:map.s[index]);
      map[channel][index]=clamp(brush.value,0,Math.max(0,allowed));
    }
    const a=inBounds(start,n),b=inBounds(end,n);
    if (tool==='rect') {
      for(let j=Math.min(a.row,b.row);j<=Math.max(a.row,b.row);j++)
        for(let k=Math.min(a.col,b.col);k<=Math.max(a.col,b.col);k++)set(k,j);
      return changes;
    }
    const radius=clamp(brush.radius||0,0,n);
    const ry=radius*Math.min(map.width,map.height)/map.height;
    const rx=radius*Math.min(map.width,map.height)/map.width;
    const steps=Math.max(Math.abs(b.col-a.col),Math.abs(b.row-a.row));
    for(let j=0;j<=steps;j++){
      const t=steps?j/steps:0,cx=Math.round(a.col+t*(b.col-a.col)),cy=Math.round(a.row+t*(b.row-a.row));
      for(let dy=-Math.floor(ry);dy<=Math.floor(ry);dy++)for(let dx=-Math.floor(rx);dx<=Math.floor(rx);dx++){
        if(dx*dx/(rx*rx||1)+dy*dy/(ry*ry||1)<=1)set(cx+dx,cy+dy);
      }
    }
    return changes;
  }
  function attachPainter(canvas,{getMap,getBrush,onChange}) {
    let history=[],drag=null;
    function render(){
      const map=getMap();
      if(!map){makeFrame(canvas,1,1);return;}
      const key=getBrush().channel||'t', values=map[key], frame=makeFrame(canvas,map.width,map.height);
      if (!values) return;
      let min=0,max=1,palette='material',unit='功率份额';
      if(key==='opd'){
        for(let j=0;j<values.length;j++)max=Math.max(max,Math.abs(values[j]));
        min=-max;palette='signed';unit='光程差 / nm';
      }
      drawMap(frame,map.size,values,min,max,palette,false);
      axes(frame,palette,min,max,unit,false);
      if(drag?.map===map&&['line','rect'].includes(drag.brush.tool))
        selection(frame,map.size,drag.a,drag.b,drag.brush.tool);
    }
    function restore(entry){
      for(const [index,old] of entry.changes){
        for(let k=0;k<channels.length;k++)entry.map[channels[k]][index]=old[k];
      }
    }
    function remember(map,changes) {
      if(!changes.size)return;
      history.push({map,changes});
      let total=history.reduce((sum,entry)=>sum+entry.changes.size,0);
      while(history.length>1 && (history.length>24||total>131072))total-=history.shift().changes.size;
    }
    function applyPattern(next) {
      const map=getMap();if(!map || next.size!==map.size)return;
      if(drag)cancel();
      const changes=new Map();
      for(let j=0;j<map.size*map.size;j++) {
        if(channels.every(k=>map[k][j]===next[k][j]))continue;
        changes.set(j,channels.map(k=>map[k][j]));
        for(const k of channels)map[k][j]=next[k][j];
      }
      remember(map,changes);render();onChange();
    }
    function undo(){
      const entry=history.pop();
      if(!entry||entry.map!==getMap())return false;
      restore(entry);render();onChange();return true;
    }
    function cancel(){
      if(drag) restore(drag);
      drag=null;render();
    }
    function resetHistory(){history=[];if(drag)cancel();}
    canvas.style.touchAction='none';
    canvas.addEventListener('pointerdown',e=>{
      if(drag||e.button!==0)return;
      const map=getMap(),a=map&&sampleAt(canvas,e,map.size);
      if(!a)return;
      drag={id:e.pointerId,map,a,b:a,brush:{...getBrush()},changes:new Map()};
      canvas.setPointerCapture(e.pointerId);
      if (['brush','erase'].includes(drag.brush.tool))stroke(map,drag.brush,a,a,drag.changes);
      render();
    });
    canvas.addEventListener('pointermove',e=>{
      if(!drag||e.pointerId!==drag.id)return;
      if(drag.map!==getMap()){cancel();return;}
      const b=sampleAt(canvas,e,drag.map.size,true);
      if(['brush','erase'].includes(drag.brush.tool))stroke(drag.map,drag.brush,drag.b,b,drag.changes);
      drag.b=b;render();
    });
    canvas.addEventListener('pointerup',e=>{
      if(!drag||e.pointerId!==drag.id)return;
      if(drag.map!==getMap()){cancel();return;}
      const b=sampleAt(canvas,e,drag.map.size,true);
      stroke(drag.map,drag.brush,['rect','line'].includes(drag.brush.tool)?drag.a:drag.b,b,drag.changes);
      remember(drag.map,drag.changes);
      drag=null;render();onChange();
    });
    canvas.addEventListener('pointercancel',cancel);
    return {render,undo,resetHistory,applyPattern};
  }
  return {derive,inspect,toCSV,figureCanvas,renderResult,attachProbe,attachPainter,stroke};
});
