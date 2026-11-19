/* 光迹 · All distances are millimetres. Canvas lens outlines are schematic. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const clone = value => JSON.parse(JSON.stringify(value));
  const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
  const fmt = (v, digits = 1) => v == null || !Number.isFinite(v) ? '∞' : (Math.abs(v) < .5 * 10 ** -digits ? 0 : v).toFixed(digits).replace('-', '−');
  const presets = {
    convex: { name: '单凸透镜成像', note: '物体位于一倍与二倍焦距之间，形成倒立、放大的实像。', object: {x:0,height:36}, lenses:[{id:'l1',x:200,f:120,aperture:150}], screenX:500 },
    virtual: { name: '放大镜 · 正立虚像', note: '物体移入焦距以内，透过会聚透镜观察正立、放大的虚像。', object:{x:100,height:25},lenses:[{id:'l1',x:200,f:160,aperture:140}],screenX:420 },
    concave: {name:'凹透镜 · 发散光路',note:'发散透镜让光束散开，反向延长线相交于正立、缩小的虚像。',object:{x:0,height:45},lenses:[{id:'l1',x:220,f:-120,aperture:150}],screenX:450},
    relay: {name:'双透镜 · 4f 中继',note:'物体与像面分别位于两端焦平面，得到等大倒立像。系统等效焦距为无穷大。',object:{x:0,height:30},lenses:[{id:'l1',x:100,f:100,aperture:150},{id:'l2',x:300,f:100,aperture:150}],screenX:400},
    telescope: {name:'开普勒式望远镜',note:'两片凸透镜相隔 f₁ + f₂。这里以远处有限距离物体演示；角放大率约为 −f₁/f₂。',object:{x:-600,height:25},lenses:[{id:'l1',x:100,f:150,aperture:130},{id:'l2',x:300,f:50,aperture:80}],screenX:450},
    microscope: {name:'复合显微镜',note:'物镜先形成放大的中间实像，目镜再把它放大为最终虚像。',object:{x:-50,height:8},lenses:[{id:'l1',x:0,f:40,aperture:65},{id:'l2',x:250,f:80,aperture:140}],screenX:400}
  };
  let state = {...clone(presets.convex), preset:'convex', selected:'l1', rayCount:9, showGrid:true, showFoci:true, showVirtual:true, playing:true};
  let analysis, rays = [], view = {cx:250,cy:0,scale:1}, baseScale = 1, width = 900, height = 420, drag = null, toastTimer, saveTimer, nextId=2;
  const canvas = $('opticalCanvas'), ctx = canvas.getContext('2d'), imageCanvas = $('imageCanvas'), imageCtx = imageCanvas.getContext('2d');
  let lastTime=0, phase=0, needsDraw=true;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reducedMotion) state.playing=false;

  function sorted() { return [...state.lenses].sort((a,b)=>a.x-b.x); }
  function toast(message) { $('toast').textContent=message; $('toast').hidden=false; clearTimeout(toastTimer); toastTimer=setTimeout(()=>$('toast').hidden=true,3200); }
  function serializable() { const {object,lenses,screenX,rayCount,showGrid,showFoci,showVirtual,preset} = state; return {version:1,object,lenses,screenX,rayCount,showGrid,showFoci,showVirtual,preset}; }
  function validateConfig(data) {
    if (!data || data.version !== 1 || !Array.isArray(data.lenses) || data.lenses.length<1 || data.lenses.length>8) throw Error('配置需要包含 1–8 片透镜，版本号为 1。');
    const number = (value,min,max) => typeof value==='number' && Number.isFinite(value) && value>=min && value<=max;
    if (!data.object || !number(data.object.x,-1000,1795) || !number(data.object.height,5,150) || !number(data.screenX,-990,4000)) throw Error('物体或观察屏参数超出范围。');
    const lenses=data.lenses.map((l,i)=>{
      if (!l || !number(l.x,-995,1800) || typeof l.f!=='number' || !number(Math.abs(l.f),5,2000) || !number(l.aperture,10,300)) throw Error('镜片位置、焦距或口径参数无效。');
      return {id:'l'+(i+1),x:l.x,f:l.f,aperture:l.aperture};
    }).sort((a,b)=>a.x-b.x);
    if (lenses[0].x-data.object.x<5 || lenses.some((l,i)=>i && l.x-lenses[i-1].x<5) || data.screenX-lenses.at(-1).x<5) throw Error('物体、镜片与观察屏需要沿 x 方向排列，间距至少 5 mm。');
    const preset=Object.hasOwn(presets,data.preset)?data.preset:'custom';
    return {version:1,object:{x:data.object.x,height:data.object.height},lenses,screenX:data.screenX,preset,rayCount:number(data.rayCount,3,31)?clamp(Math.round(data.rayCount/2)*2-1,3,31):9,showGrid:data.showGrid!==false,showFoci:data.showFoci!==false,showVirtual:data.showVirtual!==false};
  }
  function applyConfig(config) { state={...state,...config,selected:config.lenses[0].id}; nextId=Math.max(...state.lenses.map(l=>Number(l.id.slice(1))))+1; renderLenses(); syncControls(); update(); fit(); }
  // Local persistence is optional (e.g. file:// or restrictive privacy settings).
  function persist() { clearTimeout(saveTimer); saveTimer=setTimeout(()=>{try{localStorage.setItem('guangji-optical-bench-v1',JSON.stringify(serializable()));}catch{document.querySelector('.local-badge').textContent='本地运行 · 请手动保存';}},250); }
  function setCustom() {state.preset='custom';$('presetSelect').value=$('quickPreset').value='custom';$('presetNote').textContent='自定义镜片组合，实时探索参数与成像之间的关系。';$('systemName').textContent='自定义光学系统';}
  function syncControls() {
    $('presetSelect').value=$('quickPreset').value=state.preset;
    $('presetNote').textContent=presets[state.preset]?.note || '自定义镜片组合，实时探索参数与成像之间的关系。';
    $('systemName').textContent=presets[state.preset]?.name || '自定义光学系统';
    const first=sorted()[0], last=sorted().at(-1);
    $('objectX').max=first.x-5; $('objectXRange').max=first.x-5; $('objectXRange').min=Math.min(-400,state.object.x); $('screenX').min=last.x+5;
    for(const [id,value] of [['objectX',state.object.x],['objectXRange',state.object.x],['objectHeight',state.object.height],['objectHeightRange',state.object.height],['screenX',state.screenX],['rayCount',state.rayCount]]) if(document.activeElement!==$(id)) $(id).value=value;
    $('rayCountValue').textContent=state.rayCount;
    for (const key of ['showGrid','showFoci','showVirtual']) $(key).checked=state[key];
    $('playButton').textContent=state.playing?'Ⅱ':'▷';$('playButton').title=state.playing?'暂停光线动画':'播放光线动画';$('playButton').setAttribute('aria-label',$('playButton').title);
  }
  function lensField(l,key,label,symbol,min,max,step=1) {
    return `<div class="field"><label for="${l.id}-${key}">${label} <span>${symbol}</span></label><div class="number-wrap"><input id="${l.id}-${key}" data-key="${key}" type="number" min="${key==='f'?-2000:min}" max="${key==='f'?2000:max}" step="any" value="${l[key]}"><span>mm</span></div></div><input type="range" aria-label="${label}滑块" data-key="${key}" min="${Math.min(min,l[key])}" max="${Math.max(max,l[key])}" step="${step}" value="${l[key]}">`;
  }
  function renderLenses() {
    $('lensList').innerHTML=sorted().map((l,i)=>`<div class="lens-card ${state.selected===l.id?'selected':''}" data-id="${l.id}"><div class="lens-header"><button class="lens-select" data-select="${l.id}" aria-label="选择镜片 L${i+1}"><span class="lens-icon">${l.f>0?'()':')('}</span><span class="lens-title">镜片 L${i+1}</span><span class="lens-chip">${l.f>0?'会聚':'发散'}</span></button><button class="lens-delete" data-delete="${l.id}" aria-label="删除镜片 L${i+1}" ${state.lenses.length===1?'disabled':''}>×</button></div><div class="lens-mini">x = ${fmt(l.x)} · f = ${fmt(l.f)} mm</div><div class="lens-body"><div class="lens-type-buttons"><button data-type="1" class="${l.f>0?'active':''}">凸透镜</button><button data-type="-1" class="${l.f<0?'active':''}">凹透镜</button></div>${lensField(l,'f','焦距','f',-500,500)}${lensField(l,'x','轴向位置','x',state.object.x+5,1800)}${lensField(l,'aperture','通光口径','D',10,300)}<details class="curvature"><summary>由曲率计算焦距</summary><div class="field"><label for="${l.id}-n">折射率 n</label><div class="number-wrap"><input id="${l.id}-n" data-curve="n" type="number" min="1.01" max="3" step=".01" value="1.5"></div></div><div class="field"><label for="${l.id}-r1">前表面 R₁</label><div class="number-wrap"><input id="${l.id}-r1" data-curve="r1" type="text" value="120"><span>mm</span></div></div><div class="field"><label for="${l.id}-r2">后表面 R₂</label><div class="number-wrap"><input id="${l.id}-r2" data-curve="r2" type="text" value="-120"><span>mm</span></div></div><p class="curvature-note">曲率中心向右为正，平面可填 ∞。应用后可继续手动调整焦距。</p><button class="button secondary" data-lensmaker="${l.id}">计算并应用焦距</button></details></div></div>`).join('');
    $('lensCount').textContent=state.lenses.length+' / 8';$('addConvex').disabled=$('addConcave').disabled=state.lenses.length>=8;
  }
  function update() {
    analysis=Optics.analyzeSystem(state);
    const infinity=analysis.imageType==='infinity', real=analysis.imageType==='real', m=analysis.magnification;
    $('imageType').textContent=infinity?'无穷远像':(m<0?'倒立':'正立')+(real?'实像':'虚像');
    $('imageTypeNote').textContent=infinity?'出射光束互相平行':real?'可在观察屏上接收':'由出射光线反向延长得到';
    $('imageDistance').innerHTML=`${fmt(analysis.imageDistance)} <small>mm</small>`;
    $('magnification').innerHTML=`${m==null?'—':fmt(m,2)} <small>×</small>`;
    $('magnificationNote').textContent=m==null?'无有限横向放大率':`${m<0?'倒立':'正立'} · ${Math.abs(Math.abs(m)-1)<.005?'等大':Math.abs(m)>1?'放大':'缩小'}`;
    $('effectiveFocal').innerHTML=`${fmt(analysis.effectiveFocalLength)} <small>mm</small>`;
    $('eflNote').textContent=analysis.effectiveFocalLength==null?'无焦系统 · 平行入射仍平行出射':'组合系统的光焦度';
    $('imageHeightLabel').textContent=analysis.imageHeight==null?'':`${fmt(analysis.imageHeight)} mm`;
    $('screenDefocus').textContent=real?`${fmt(state.screenX-analysis.imageX)} mm`:'不适用';
    $('screenBlur').textContent=analysis.screenBlurRadius==null?'无透射光':`${fmt(analysis.screenBlurRadius,2)} mm`;
    $('focusScreen').disabled=!real || analysis.imageX>4000 || analysis.imageX<sorted().at(-1).x+5;
    $('infinityNotice').hidden=!infinity;
    for(const key of ['A','B','C','D']) $('matrix'+key).textContent=fmt(analysis.matrix[key],key==='C'?5:3);
    $('stageTable').innerHTML=analysis.stages.map((s,i)=>`<div class="stage-row"><span><span class="legend-dot" style="background:#89ad9a"></span>L${i+1} · ${s.imageType==='real'?'实像':s.imageType==='infinity'?'无穷远':'虚像'}</span><span>${fmt(s.imageX)} mm / ${s.magnification==null?'—':fmt(s.magnification,2)+'×'}</span></div>`).join('');
    recomputeRays();
    const maxAngle=Math.max(...rays.flatMap(ray=>[Math.abs(ray.outgoingSlope),...ray.points.slice(1).map((p,i)=>Math.abs((p.y-ray.points[i].y)/(p.x-ray.points[i].x)))]));
    const message=analysis.screenBlurRadius==null?'通光孔径遮挡了全部尖端光束；读数为理想共轭像。':maxAngle>.3?'当前部分光线超出小角度范围，结果按近轴近似展示。':'实线表示传播光路，虚线表示虚像反向延长线。';
    $('opticsMessage').textContent=message;$('opticsMessage').classList.toggle('warning',analysis.screenBlurRadius==null||maxAngle>.3);
    drawImage();needsDraw=true;persist();
  }
  function recomputeRays() {
    const endX=Math.max(state.screenX,view.cx+width/2/view.scale)+30/view.scale;
    rays=Optics.sampleRays({...state,count:state.rayCount,endX});
    const accepted=analysis?.acceptedSlopeRange;
    if(accepted && rays.every(ray=>ray.blocked)) {
      const middle=Math.floor(rays.length/2);
      [accepted.min,(accepted.min+accepted.max)/2,accepted.max].forEach((slope,i)=>{rays[middle-1+i]={slope,...Optics.traceRay({...state,slope,endX})};});
    }
  }
  function fit() {
    const ls=sorted(), xs=[state.object.x,...ls.map(l=>l.x),state.screenX];
    const span=Math.max(...xs)-Math.min(...xs);
    if(Number.isFinite(analysis?.imageX) && analysis.imageX>Math.min(...xs)-span*.6 && analysis.imageX<Math.max(...xs)+span*.6) xs.push(analysis.imageX);
    const minX=Math.min(...xs), maxX=Math.max(...xs), yMax=Math.max(85,state.object.height,...ls.map(l=>l.aperture/2),Number.isFinite(analysis?.imageHeight)?Math.min(Math.abs(analysis.imageHeight),250):0);
    view={cx:(minX+maxX)/2,cy:0,scale:Math.max(.07,Math.min((width-100)/(maxX-minX+70),(height-120)/(yMax*2)))};
    baseScale=view.scale;recomputeRays();needsDraw=true;$('zoomValue').textContent='100%';
  }
  function resize() {
    const rect=canvas.getBoundingClientRect(), dpr=devicePixelRatio||1;
    width=rect.width;height=rect.height;canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);
    const ir=imageCanvas.getBoundingClientRect();imageCanvas.width=Math.round(ir.width*dpr);imageCanvas.height=Math.round(ir.height*dpr);imageCtx.setTransform(dpr,0,0,dpr,0,0);
    if(analysis){fit();drawImage();}
  }
  const px=x=>width/2+(x-view.cx)*view.scale, py=y=>height/2-(y-view.cy)*view.scale;
  const wx=x=>view.cx+(x-width/2)/view.scale, wy=y=>view.cy-(y-height/2)/view.scale;
  function line(points,color,lineWidth=1,dash=[]) { if(points.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y)))return;ctx.beginPath();ctx.setLineDash(dash);ctx.strokeStyle=color;ctx.lineWidth=lineWidth;points.forEach((p,i)=>{const x=clamp(px(p.x),-1e6,1e6),y=clamp(py(p.y),-1e6,1e6);i?ctx.lineTo(x,y):ctx.moveTo(x,y);});ctx.stroke();ctx.setLineDash([]); }
  function text(label,x,y,color='#97b4a2',size=10,align='center') { ctx.font=`${size}px "Segoe UI","Microsoft YaHei",sans-serif`;ctx.textAlign=align;ctx.fillStyle=color;ctx.fillText(label,x,y); }
  function drawArrow(x,y,color,label,dashed=false) {
    if(!Number.isFinite(x)||!Number.isFinite(y)||Math.abs(px(x))>width+200||Math.abs(py(y))>height+500)return;
    line([{x,y:0},{x,y}],color,2.3,dashed?[4,3]:[]);
    const xx=px(x), yy=py(y), sign=y>=0?1:-1;
    ctx.beginPath();ctx.moveTo(xx,yy);ctx.lineTo(xx-5,yy+sign*9);ctx.lineTo(xx+5,yy+sign*9);ctx.closePath();ctx.fillStyle=color;ctx.fill();
    ctx.beginPath();ctx.arc(xx,py(0),3,0,Math.PI*2);ctx.fill();
    text(label,xx,yy-sign*15,color,10);
  }
  function draw(time) {
    ctx.clearRect(0,0,width,height);ctx.fillStyle='#102427';ctx.fillRect(0,0,width,height);
    const left=wx(0), right=wx(width), bottom=wy(height), top=wy(0);
    if(state.showGrid) {
      const raw=50/view.scale, power=10**Math.floor(Math.log10(raw)), step=[1,2,5,10].map(v=>v*power).find(v=>v>=raw)||power*10;
      ctx.strokeStyle='#91c3a20c';ctx.lineWidth=1;ctx.beginPath();
      for(let x=Math.ceil(left/step)*step;x<right;x+=step){ctx.moveTo(px(x),0);ctx.lineTo(px(x),height);}
      for(let y=Math.ceil(bottom/step)*step;y<top;y+=step){ctx.moveTo(0,py(y));ctx.lineTo(width,py(y));}ctx.stroke();
      for(let x=Math.ceil(left/step)*step;x<right;x+=step) { if(px(x)<22||px(x)>width-25)continue;text(String(Math.round(x)),px(x),py(0)+19,'#527466',8);line([{x,y:-2/view.scale},{x,y:2/view.scale}],'#5a7b6b',1); }
    }
    line([{x:left,y:0},{x:right,y:0}],'#8baf973d',1,[5,6]);text('光轴 x / mm',width-17,py(0)-10,'#668877',8,'right');
    const ls=sorted(), last=ls.at(-1), imageVisible=analysis.imageX!=null;
    if(state.showFoci) ls.forEach((l,i)=>{[-1,1].forEach(sign=>{const x=l.x+sign*l.f;if(px(x)>20&&px(x)<width-20){ctx.beginPath();ctx.arc(px(x),py(0),2.6,0,2*Math.PI);ctx.fillStyle='#87ad9244';ctx.fill();text(`${sign<0?'F':'F′'}${i+1}`,px(x),py(0)-9,'#72957c',9);}});});
    // Translucent lenses sit underneath the rays.
    ls.forEach((l,i)=>{
      const x=px(l.x), half=l.aperture/2*view.scale, center=py(0), bulge=clamp(10+180/Math.abs(l.f),10,22), selected=l.id===state.selected;
      if(x<-50||x>width+50)return;
      ctx.beginPath();
      if(l.f>0){ctx.moveTo(x,center-half);ctx.bezierCurveTo(x-bulge,center-half*.35,x-bulge,center+half*.35,x,center+half);ctx.bezierCurveTo(x+bulge,center+half*.35,x+bulge,center-half*.35,x,center-half);}else{ctx.moveTo(x-9,center-half);ctx.quadraticCurveTo(x+4,center,x-9,center+half);ctx.lineTo(x+9,center+half);ctx.quadraticCurveTo(x-4,center,x+9,center-half);ctx.closePath();}
      const gradient=ctx.createLinearGradient(x-15,0,x+15,0);gradient.addColorStop(0,'#78d4d318');gradient.addColorStop(.5,'#99e5d833');gradient.addColorStop(1,'#78d4d318');ctx.fillStyle=gradient;ctx.fill();ctx.strokeStyle=selected?'#8acdc3':'#579d99';ctx.lineWidth=selected?1.6:1;ctx.stroke();
      line([{x:l.x,y:-l.aperture/2},{x:l.x,y:l.aperture/2}],'#8dcec23a',1,[3,4]);
      text(`L${i+1}`,x,center-half-26,'#b2d6c3',11);text(`f = ${fmt(l.f,0)} mm`,x,center-half-12,'#6f9c8b',8);
      ctx.fillStyle=selected?'#91c6b4':'#4d7c6a';ctx.fillRect(x-7,center+half+7,14,3);
    });
    const colors=['#e6b66b','#91c8ac','#7cb8c0'];
    rays.forEach((ray,i)=>{
      const color=colors[i%3];ctx.globalAlpha=.59;line(ray.points,color,1.1);ctx.globalAlpha=1;
      if(ray.blocked){const p=ray.points.at(-1),x=px(p.x),y=py(p.y);ctx.fillStyle='#d28d64';ctx.fillRect(x-2,y-2,4,4);}
      if(!ray.blocked&&analysis.imageType==='virtual'&&state.showVirtual&&imageVisible){ctx.globalAlpha=.3;line([ray.lastPoint,{x:analysis.imageX,y:ray.lastPoint.y+(analysis.imageX-ray.lastPoint.x)*ray.outgoingSlope}],color,1,[4,5]);ctx.globalAlpha=1;}
      if(state.playing&&ray.points.length>1){
        const lengths=ray.points.slice(1).map((p,k)=>Math.hypot((p.x-ray.points[k].x)*view.scale,(p.y-ray.points[k].y)*view.scale)), total=lengths.reduce((a,b)=>a+b,0);
        let distance=(phase*95+i*37)%Math.max(1,total);
        for(let k=0;k<lengths.length;k++){if(distance<=lengths[k]){const t=distance/lengths[k],a=ray.points[k],b=ray.points[k+1];ctx.beginPath();ctx.arc(px(a.x+(b.x-a.x)*t),py(a.y+(b.y-a.y)*t),1.8,0,Math.PI*2);ctx.fillStyle=color;ctx.fill();break;}distance-=lengths[k];}
      }
    });
    // Screen and its transmitted object-tip bundle.
    const sx=px(state.screenX), screenHalf=Math.max(75,Math.min(150,height*.34/view.scale));
    line([{x:state.screenX,y:-screenHalf},{x:state.screenX,y:screenHalf}],'#d4dbb985',2,[3,3]);
    ctx.fillStyle='#b9c8ab14';ctx.fillRect(sx-4,py(screenHalf),8,screenHalf*2*view.scale);
    if(analysis.screenBlurRadius!=null){line([{x:state.screenX,y:analysis.screenCenter-analysis.screenBlurRadius},{x:state.screenX,y:analysis.screenCenter+analysis.screenBlurRadius}],'#cde6b2cc',4);}
    text('观察屏',sx,py(screenHalf)-14,'#a0b29a',9);text(`x = ${fmt(state.screenX,0)}`,sx,py(-screenHalf)+17,'#658775',8);
    drawArrow(state.object.x,state.object.height,'#ecc078','物体');
    if(imageVisible) drawArrow(analysis.imageX,analysis.imageHeight,'#99d8a8',analysis.imageType==='real'?'实像':'虚像',analysis.imageType==='virtual');
    // Keep useful labels on the canvas when a conjugate falls outside the viewport.
    if(imageVisible&&(px(analysis.imageX)<15||px(analysis.imageX)>width-15||py(analysis.imageHeight)<15||py(analysis.imageHeight)>height-15))text(`像位于画布外 · x = ${fmt(analysis.imageX)} mm`,width/2,height-40,'#94bea1',10);
  }
  function drawImage() {
    const w=imageCanvas.clientWidth,h=imageCanvas.clientHeight,c=imageCtx;if(!w)return;c.clearRect(0,0,w,h);
    const axisY=h*.51, maxHeight=Math.max(state.object.height,Math.abs(analysis.imageHeight||0),30), scale=Math.min(1.15,42/maxHeight);
    c.strokeStyle='#e3e9df';c.lineWidth=1;c.setLineDash([3,4]);c.beginPath();c.moveTo(23,axisY);c.lineTo(w-23,axisY);c.stroke();c.setLineDash([]);
    function glyph(x,mag,color) {const size=state.object.height*scale*mag;if(!Number.isFinite(size))return;c.save();c.translate(x,axisY);c.scale(size,size);c.fillStyle=color;c.fillRect(-.04,-.82,.08,.82);c.beginPath();c.moveTo(0,-1);c.lineTo(-.125,-.80);c.lineTo(.125,-.80);c.fill();c.fillRect(0,-.72,.37,.067);c.fillRect(0,-.46,.25,.058);c.restore();}
    glyph(w*.25,1,'#c69d5d');if(analysis.magnification!=null){c.globalAlpha=analysis.imageType==='virtual'?.65:1;glyph(w*.75,analysis.magnification,'#62997c');c.globalAlpha=1;}else{c.font='25px Georgia';c.fillStyle='#9eb19d';c.textAlign='center';c.fillText('∞',w*.75,axisY-14);}
    c.fillStyle='#b5c0ae';c.font='8px "Segoe UI","Microsoft YaHei",sans-serif';c.textAlign='center';c.fillText(`${fmt(state.object.height,0)} mm`,w*.25,h-11);c.fillText(analysis.imageType==='infinity'?'无有限像面':`${analysis.imageType==='real'?'实像':'虚像'} · ${fmt(analysis.magnification,2)} ×`,w*.75,h-11);
    c.fillStyle='#bcc9b5';c.font='15px Segoe UI';c.fillText('→',w*.5,h*.43);
  }
  function setLensValue(id,key,value) {
    const l=state.lenses.find(l=>l.id===id); if(!l||!Number.isFinite(value))return;
    value=Math.round(value*100)/100;
    if(key==='f')value=clamp((Math.abs(value)<5?(value<0?-5:5):value),-2000,2000);
    if(key==='aperture')value=clamp(value,10,300);
    if(key==='x'){const ls=sorted(),i=ls.findIndex(l=>l.id===id);value=clamp(value,i?ls[i-1].x+5:state.object.x+5,i<ls.length-1?ls[i+1].x-5:1800);state.screenX=Math.max(state.screenX,value+5);}
    l[key]=value;
    const card=$('lensList').querySelector(`[data-id="${id}"]`);
    card.querySelectorAll(`[data-key="${key}"]`).forEach(input=>{if(input.type==='range'&&key==='f'){input.min=Math.min(-500,l.f);input.max=Math.max(500,l.f);}if(input.type==='range'||document.activeElement!==input)input.value=l[key];});
    card.querySelector('.lens-icon').textContent=l.f>0?'()':')(';card.querySelector('.lens-chip').textContent=l.f>0?'会聚':'发散';card.querySelectorAll('[data-type]').forEach(b=>b.classList.toggle('active',Number(b.dataset.type)===Math.sign(l.f)));
    card.querySelector('.lens-mini').textContent=`x = ${fmt(l.x)} · f = ${fmt(l.f)} mm`;
    setCustom();syncControls();update();
  }
  function addLens(sign){if(state.lenses.length>=8)return;const last=sorted().at(-1);if(last.x>=1795){toast('镜片已接近位置上限，请先向左移动。');return;}const x=Math.min(last.x+130,1800),id='l'+nextId++;state.lenses.push({id,x,f:sign*100,aperture:130});state.selected=id;state.screenX=Math.max(state.screenX,x+160);setCustom();renderLenses();syncControls();update();fit();}
  function zoom(factor,cx=width/2,cy=height/2){const x=wx(cx),y=wy(cy);view.scale=clamp(view.scale*factor,.04,15);view.cx=x-(cx-width/2)/view.scale;view.cy=y+(cy-height/2)/view.scale;$('zoomValue').textContent=Math.round(view.scale/baseScale*100)+'%';recomputeRays();needsDraw=true;}
  function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),5000);}

  $('lensList').addEventListener('click',e=>{
    const button=e.target.closest('button');if(!button)return;const id=button.closest('[data-id]')?.dataset.id;
    if(button.dataset.select){state.selected=id;renderLenses();needsDraw=true;}
    if(button.dataset.delete&&state.lenses.length>1){state.lenses=state.lenses.filter(l=>l.id!==id);if(state.selected===id)state.selected=state.lenses[0].id;setCustom();renderLenses();syncControls();update();}
    if(button.dataset.type)setLensValue(id,'f',Number(button.dataset.type)*Math.abs(state.lenses.find(l=>l.id===id).f));
    if(button.dataset.lensmaker){const card=button.closest('[data-id]'),get=key=>card.querySelector(`[data-curve="${key}"]`).value.trim(),radius=s=>/^[+−-]?(∞|infinity|inf)$/i.test(s)?(s.startsWith('-')||s.startsWith('−')?-Infinity:Infinity):s!==''?Number(s):NaN;const n=Number(get('n')),r1=radius(get('r1')),r2=radius(get('r2'));if(!Number.isFinite(n)||n<1.01||n>3||Number.isNaN(r1)||Number.isNaN(r2)||r1===0||r2===0){toast('请输入 n = 1.01–3，曲率半径不能为 0；平面填 ∞。');return;}const f=Optics.lensmaker({n,r1,r2});if(!Number.isFinite(f)||Math.abs(f)<5||Math.abs(f)>2000){toast('计算结果超出可调焦距范围（|f| = 5–2000 mm）。');return;}setLensValue(id,'f',f);toast(`已应用焦距 ${fmt(f,2)} mm`);}
  });
  $('lensList').addEventListener('input',e=>{const input=e.target,key=input.dataset.key;if(!key||input.value.trim()==='')return;const v=Number(input.value);if(input.type==='number'&&(!input.validity.valid||(key==='f'&&Math.abs(v)<5)))return;setLensValue(input.closest('[data-id]').dataset.id,key,v);});
  $('lensList').addEventListener('change',e=>{if(e.target.dataset.key){if(e.target.value.trim()===''){renderLenses();return;}const id=e.target.closest('[data-id]').dataset.id,key=e.target.dataset.key;setLensValue(id,key,Number(e.target.value));e.target.value=state.lenses.find(l=>l.id===id)[key];}});
  for(const id of ['objectX','objectXRange','objectHeight','objectHeightRange','screenX']) {
    const input=$(id);
    function handle(e){if(input.value.trim()===''||!Number.isFinite(Number(input.value))){if(e.type==='change'){input.value=id.startsWith('objectX')?state.object.x:id.startsWith('objectHeight')?state.object.height:state.screenX;}return;}if(e.type==='input'&&input.type==='number'&&!input.validity.valid)return;const v=Number(input.value);if(id.startsWith('objectX'))state.object.x=clamp(v,-1000,sorted()[0].x-5);else if(id.startsWith('objectHeight'))state.object.height=clamp(v,5,150);else state.screenX=clamp(v,sorted().at(-1).x+5,4000);setCustom();syncControls();if(e.type==='change')input.value=id.startsWith('objectX')?state.object.x:id.startsWith('objectHeight')?state.object.height:state.screenX;update();}
    input.addEventListener('input',handle);input.addEventListener('change',handle);
  }
  $('quickPreset').innerHTML=$('presetSelect').innerHTML;
  for(const id of ['presetSelect','quickPreset'])$(id).addEventListener('change',e=>{if(presets[e.target.value])applyConfig({...clone(presets[e.target.value]),preset:e.target.value});});
  function mobilePanel(open){$('controlPanel').classList.toggle('mobile-open',open);$('mobileConfigure').setAttribute('aria-expanded',String(open));if(open)$('canvasWrap').scrollIntoView({block:'start'});else $('mobileConfigure').focus({preventScroll:true});}
  $('mobileConfigure').onclick=()=>mobilePanel(!$('controlPanel').classList.contains('mobile-open'));$('mobileDone').onclick=()=>mobilePanel(false);
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&$('controlPanel').classList.contains('mobile-open'))mobilePanel(false);});
  $('addConvex').onclick=()=>addLens(1);$('addConcave').onclick=()=>addLens(-1);
  $('focusScreen').onclick=()=>{if(analysis.imageType==='real'){state.screenX=analysis.imageX;setCustom();syncControls();update();fit();toast('观察屏已与实像面重合');}};
  $('rayCount').oninput=e=>{state.rayCount=Number(e.target.value);$('rayCountValue').textContent=state.rayCount;update();};
  for(const key of ['showGrid','showFoci','showVirtual']) $(key).onchange=e=>{state[key]=e.target.checked;needsDraw=true;persist();};
  $('playButton').onclick=()=>{state.playing=!state.playing;syncControls();needsDraw=true;};
  $('zoomIn').onclick=()=>zoom(1.2);$('zoomOut').onclick=()=>zoom(1/1.2);$('fitButton').onclick=fit;
  $('snapshotButton').onclick=()=>{draw(performance.now());canvas.toBlob(blob=>{if(blob){download(blob,'光迹-光路图.png');toast('已导出当前光路图');}},'image/png');};
  $('exportButton').onclick=()=>{download(new Blob([JSON.stringify(serializable(),null,2)],{type:'application/json'}),'光迹-光学实验.json');toast('实验配置已导出');};
  $('importButton').onclick=()=>$('importFile').click();
  $('importFile').onchange=async e=>{const file=e.target.files[0];if(!file)return;try{if(file.size>100000)throw Error('文件过大，请选择光迹导出的实验 JSON。');const config=validateConfig(JSON.parse(await file.text()));applyConfig(config);toast('实验已导入');}catch(error){toast('导入失败：'+(error instanceof SyntaxError?'不是有效的 JSON 文件。':error.message));}finally{e.target.value='';}};
  $('resetButton').onclick=()=>{applyConfig({...clone(presets.convex),preset:'convex',rayCount:9,showGrid:true,showFoci:true,showVirtual:true});toast('已恢复初始实验');};
  $('helpButton').onclick=()=>OpticsManual.open();
  $('detailsButton').onclick=()=>OpticsManual.open('b-matrix');
  function pointer(e){const r=canvas.getBoundingClientRect();return {x:e.clientX-r.left,y:e.clientY-r.top};}
  function hit(p){if(Math.abs(p.x-px(state.object.x))<16&&p.y>py(state.object.height)-18&&p.y<py(0)+12)return {type:'object'};const lens=sorted().find(l=>Math.abs(p.x-px(l.x))<18&&Math.abs(p.y-py(0))<l.aperture/2*view.scale+38);if(lens)return {type:'lens',id:lens.id};if(Math.abs(p.x-px(state.screenX))<12)return {type:'screen'};return {type:'pan'};}
  canvas.addEventListener('pointerdown',e=>{if(e.button!==0)return;const p=pointer(e),target=hit(p);drag={...target,pointerId:e.pointerId,start:p,cx:view.cx,cy:view.cy,offsetX:wx(p.x)-(target.type==='object'?state.object.x:target.type==='screen'?state.screenX:target.type==='lens'?state.lenses.find(l=>l.id===target.id).x:0),offsetY:wy(p.y)-state.object.height};canvas.setPointerCapture(e.pointerId);canvas.style.cursor='grabbing';if(target.type==='lens'){state.selected=target.id;renderLenses();needsDraw=true;}});
  canvas.addEventListener('pointermove',e=>{const p=pointer(e);$('coordinates').textContent=`x ${fmt(wx(p.x))} · y ${fmt(wy(p.y))} mm`;if(!drag){canvas.style.cursor=hit(p).type==='pan'?'grab':'ew-resize';return;}if(drag.type==='pan'){view.cx=drag.cx-(p.x-drag.start.x)/view.scale;view.cy=drag.cy+(p.y-drag.start.y)/view.scale;recomputeRays();needsDraw=true;}else if(drag.type==='lens')setLensValue(drag.id,'x',Math.round(wx(p.x)-drag.offsetX));else{if(drag.type==='object'){state.object.x=clamp(Math.round(wx(p.x)-drag.offsetX),-1000,sorted()[0].x-5);state.object.height=clamp(Math.round(wy(p.y)-drag.offsetY),5,150);}else state.screenX=clamp(Math.round(wx(p.x)-drag.offsetX),sorted().at(-1).x+5,4000);setCustom();syncControls();update();}});
  for(const event of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(event,()=>{drag=null;canvas.style.cursor='grab';});
  canvas.addEventListener('wheel',e=>{e.preventDefault();const p=pointer(e);zoom(Math.exp(-clamp(e.deltaY,-150,150)*.0018),p.x,p.y);},{passive:false});
  canvas.addEventListener('keydown',e=>{if(['+','=','-','0',' '].includes(e.key))e.preventDefault();if(e.key==='+'||e.key==='=')zoom(1.2);if(e.key==='-')zoom(1/1.2);if(e.key==='0')fit();if(e.key===' ')$('playButton').click();});
  try{const stored=localStorage.getItem('guangji-optical-bench-v1');if(stored){const config=validateConfig(JSON.parse(stored));state={...state,...config,selected:config.lenses[0].id};nextId=config.lenses.length+1;}}catch{ /* A corrupt saved experiment must not prevent opening the lab. */ }
  renderLenses();syncControls();update();resize();new ResizeObserver(resize).observe($('canvasWrap'));
  function frame(time){if(time-lastTime>30){phase+=Math.min((time-lastTime)/1000,.08);lastTime=time;if(state.playing||needsDraw){draw(time);needsDraw=false;}}requestAnimationFrame(frame);}requestAnimationFrame(frame);
})();
