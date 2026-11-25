/* UI for the two-dimensional transverse wave experiment. Lengths in mm, OPD in nm. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const names = {source:'光源',object:'二维物体',lens:'曲面厚透镜',thinLens:'理想薄透镜',phase:'均匀移相片',
    stop:'圆形光阑',polarizer:'线偏振片',retarder:'波片',screen:'探测屏',probe:'观察截面',mirror:'平面镜',grating:'光栅'};
  const symbols = {source:'☼',object:'▤',lens:'()',thinLens:'↕',phase:'φ',stop:'◉',polarizer:'P',retarder:'λ',screen:'▥',probe:'┆',mirror:'╱',grating:'▧'};
  const measured=()=>['frame0','frame1','frame2','frame3','recovered','visibility','phaseError'].includes(layer);
  const ledgerNames = {incident:'入射',absorbed:'吸收',reflected:'反射待追踪',scattered:'散射待追踪',internal:'内部返回',blocked:'实体截光',bypass:'镜外旁路',detected:'截获',numerical:'数值窗口损失',remaining:'余下传播'};
  let scene, experimentId, selected, objectId, tool='brush', layer='intensity', lockedMax=null;
  let result=null, rendered=null, worker=null, job=0, runTimer, saveTimer, noticeTimer, lastRead=null;
  let workersAvailable = typeof Worker !== 'undefined', offlineWorkerUrl;
  const planeCache=new Map();
  function invalidateFrom(x=-Infinity) {
    for(const [key,entry] of planeCache) if(entry.x>=x) planeCache.delete(key);
  }
  function cachePlane(key,data) {
    if(data.blocked || !data.lines?.length) return;
    const target=byId(scene.settings.plane);
    const x=target ? target.x+(scene.settings.side==='after' && target.type==='lens'?target.thickness:0) : scene.source.x;
    const arrays=[data.phase,...data.lines.flatMap(l=>[l.i,l.q,l.u,l.v])];
    if(data.measurement)arrays.push(...data.measurement.frames,data.measurement.phase,data.measurement.visibility);
    planeCache.set(key,{x,data,bytes:arrays.reduce((s,a)=>s+(a?.byteLength || 0),0)});
    let bytes=Array.from(planeCache.values()).reduce((s,e)=>s+e.bytes,0);
    for(const [id,entry] of planeCache) {
      if(planeCache.size<=6 && bytes<=48*1024*1024) break;
      planeCache.delete(id);bytes-=entry.bytes;
    }
  }
  const fmt = x => Number.isFinite(x) ? Number(x.toPrecision(5)).toString() : '—';
  const byId = id => scene.elements.find(el => el.id === id);
  const options = (el, pairs, value) => {
    el.replaceChildren(...pairs.map(([id,label]) => new Option(label, String(id))));
    el.value = String(value);
    if (el.selectedIndex < 0 && el.options.length) el.selectedIndex = 0;
  };
  function notice(message) {
    clearTimeout(noticeTimer);
    $('notice').textContent=message;
    $('notice').hidden=!message;
    if (message) noticeTimer=setTimeout(()=>{$('notice').hidden=true;},11000);
  }
  function download(blob,name) {
    const url=URL.createObjectURL(blob), a=document.createElement('a');
    a.href=url; a.download=name; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1500);
  }
  function storeSoon() {
    clearTimeout(saveTimer);
    saveTimer=setTimeout(()=>storeCurrent(),350);
  }
  async function storeCurrent() {
    clearTimeout(saveTimer);
    if (!scene) return;
    try {await WaveStorage.save(experimentId,scene);}
    catch {notice('浏览器未能保存这份实验。可用「保存实验」下载完整 JSON。');}
  }
  async function listRecent() {
    try {
      const rows=await WaveStorage.recent();
      options($('recent'),[['','选择记录…'],...rows.map(r=>[r.id,r.name+' · '+new Date(r.updated).toLocaleString('zh-CN')])],'');
    } catch { $('recent').disabled=true; }
  }
  function openScene(next, id) {
    planeCache.clear();
    scene=next;
    experimentId=id || globalThis.crypto?.randomUUID?.() || ('wave-'+Date.now()+'-'+Math.random().toString(36).slice(2,8));
    objectId=scene.elements.find(e=>e.map)?.id;
    selected=objectId || 'source';
    lockedMax=null; $('lockScale').checked=false; $('line').replaceChildren(); layer='intensity';
    if (!byId(scene.settings.plane) && scene.settings.plane!=='source') scene.settings.plane=scene.elements.at(-1)?.id || 'source';
    try { history.replaceState(null,'','#work='+encodeURIComponent(experimentId)); } catch {}
    painter.resetHistory(); probe.clear(); notice('');
    refresh(); storeSoon(); runSoon(0);
  }
  function refresh() {
    WaveScene.updateFocalProbes(scene);
    $('experimentName').textContent=scene.name;
    $('routeCount').textContent=scene.elements.length+' 个元件';
    const route=[{id:'source',type:'source',name:'照明光源',x:scene.source.x},...scene.elements.slice().sort((a,b)=>a.x-b.x)];
    $('route').replaceChildren(...route.map(e=>{
      const b=document.createElement('button'), icon=document.createElement('span'), title=document.createElement('strong'), pos=document.createElement('small');
      b.setAttribute('aria-current', String(e.id===selected));
      b.dataset.blocked=String(e.type!=='source' && WaveScene.elementStatus(e).state==='blocked');
      icon.className='w-symbol'; icon.textContent=symbols[e.type]||'◇'; title.textContent=e.name||names[e.type]||e.type;
      pos.textContent=fmt(e.x)+' mm'; b.append(icon,title,pos); b.title=title.textContent+' · x = '+pos.textContent;
      b.onclick=()=>{selected=e.id;if (e.map) selectObject(e.id);refresh();};return b;
    }));
    const objects=scene.elements.filter(e=>e.map);
    if (!byId(objectId)?.map) objectId=objects[0]?.id;
    options($('objectChoice'),objects.map(e=>[e.id,e.name||'二维物体']),objectId);
    options($('plane'),route.map(e=>[e.id,(e.name||names[e.type])+' · '+fmt(e.x)+' mm']),scene.settings.plane);
    const camera=byId(scene.settings.plane)?.type==='screen';
    options($('side'),[['before',camera?'屏前入射场':'元件入射面'],['after',camera?'相机记录':'元件出射面']],scene.settings.side);
    $('side').disabled=scene.settings.plane==='source';
    const lines=WaveScene.wavelengths(scene.source);
    const prev=$('line').value;
    const single=layer==='phase'||measured();
    options($('line'),[...(single?[]:[['all','全谱积分']]),...lines.map((l,i)=>[i,fmt(l.wavelength)+' nm'])],
      single?Math.min(scene.settings.phaseLine??0,lines.length-1):prev || 'all');
    scene.settings.phaseLine=Math.min(scene.settings.phaseLine??0,lines.length-1);
    const modes=scene.source.type==='field' && scene.source.height>0 ? 3:1;
    scene.settings.mode=Math.min(scene.settings.mode??0,modes-1);
    options($('phaseMode'),Array.from({length:modes},(_,i)=>[i,modes===1?'单一照明模式':('视场物点 '+(i+1))]),scene.settings.mode);
    $('phaseAxis').value=scene.settings.phaseAxis || 'y';
    $('inputWidth').value=scene.settings.width;$('gridSize').value=scene.settings.n;
    $('outputWidth').value=scene.settings.outputWidth || 0;$('referenceOPD').value=scene.settings.referenceOPD || 0;
    $('throughOnly').checked=!!scene.settings.throughOnly;
    const map=byId(objectId)?.map;
    $('emptyObject').hidden=!!map;
    $('objectCanvas').style.visibility=map?'visible':'hidden';
    document.querySelectorAll('.w-field:first-child .w-controls :is(input,button,select)').forEach(el=>el.disabled=!map);
    $('objectChoice').disabled=!map;
    $('objectScale').textContent=map?fmt(map.width)+' × '+fmt(map.height)+' mm　·　'+map.size+'² 格':'尚未放置';
    if (map) painter.render();
    renderInspector(); updateLayerControls();
  }
  function selectObject(id) { if (objectId!==id) {objectId=id; painter.resetHistory();} }
  function updateLayerControls() {
    const interferometer=measured(), polar=['ellipse','q','u','v','dop'].includes(layer);
    $('phaseOptions').hidden=layer!=='phase' && !interferometer;
    $('interferenceOptions').hidden=!interferometer;
    $('polOptions').hidden=!polar; $('intensityOptions').hidden=layer!=='intensity';
    document.querySelectorAll('[data-layer]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.layer===(interferometer?'interference':polar?'ellipse':layer))));
  }
  function renderInspector() {
    const isSource=selected==='source', item=isSource?scene.source:byId(selected);
    if (!item) {selected='source';return renderInspector();}
    const box=$('inspector');box.replaceChildren();
    $('inspectorHeading').textContent=isSource?'照明光源':names[item.type] || '元件参数';
    function paragraph(message,style='w-hint') {const el=document.createElement('p');el.className=style;el.textContent=message;box.append(el);}
    function field(label,obj,key,limits,choices) {
      const row=document.createElement('label');row.append(label);
      const el=document.createElement(choices?'select':'input');
      if (choices) options(el,choices,obj[key]);
      else {
        el.type=limits?'number':'text';el.value=obj[key]??'';
        if (limits) {el.min=limits[0];el.max=limits[1];el.step='any';} else el.maxLength=100;
      }
      el.onchange=()=>{
        let value=el.value;
        if (limits) {value=el.valueAsNumber;if (!el.checkValidity() || !Number.isFinite(value)) {el.reportValidity();el.value=obj[key]??'';return;}}
        if (key==='focalLength' && value===0) {notice('透镜焦距须为非零值。');el.value=obj[key];return;}
        if ((key==='outerDiameter' && value<obj.aperture)||(key==='aperture' && obj.type==='stop' && value>obj.outerDiameter)) {notice('光阑外径须大于或等于通光口径。');el.value=obj[key];return;}
        if (el.type==='text' && !value.trim()) {el.value=obj[key];return;}
        const previous=obj[key];obj[key]=value;
        try {WaveScene.validate(scene);} catch(error) {obj[key]=previous;el.value=previous;notice(error.message);return;}
        if(item.focusOf && ['x','name'].includes(key)){delete item.focusOf;if(key==='x')item.name='固定观察截面';}
        invalidateFrom(isSource?-Infinity:Math.min(item.x,key==='x'?previous:item.x));
        refresh();storeSoon();runSoon();
      };
      row.append(el);box.append(row);return el;
    }
    const pos=[-10000,10000], len=[.001,10000], ang=[-180,180], nm=[380,780];
    if (isSource) {
      field('实验名称',scene,'name');
      field('照明类型',item,'type',null,[['collimated','圆形平行束'],['point','发散点源'],['field','三个独立视场物点']]);
      field('轴向位置 x（mm）',item,'x',pos);
      field('横向中心 y（mm）',item,'y',pos);
      field('横向中心 z（mm）',item,'z',pos);field('入射角（°）',item,'angle',[-20,20]);
      if (item.type==='collimated') field('光束直径（mm）',item,'width',len);
      else {field('发散半角（°）',item,'spread',[.001,89]);if (item.type==='field') field('视场高度（mm）',item,'height',[0,1000]);}
      field('光谱',item,'spectrum',null,[['mono','单色'],['rgb','三条谱线'],['band','连续谱采样']]);
      field('参考波长（nm）',item,'wavelength',nm);
      if (item.spectrum==='band') field('光谱全宽（nm）',item,'bandwidth',[1,400]);
      field('偏振态',item,'polarization',null,[['linear','线偏振'],['unpolarized','非偏振'],['left','左旋圆偏振'],['right','右旋圆偏振'],['elliptical','椭圆偏振']]);
      if (item.polarization!=='unpolarized') {
        if (['linear','elliptical'].includes(item.polarization)) field('偏振方位角（°）',item,'polAngle',ang);
        if (item.polarization==='elliptical') field('椭圆率角（°）',item,'ellipticity',[-45,45]);
        field('偏振度',item,'polDegree',[0,1]);
      }
      return;
    }
    field('元件名称',item,'name');field('轴向位置 x（mm）',item,'x',pos);
    if(item.group) paragraph('镜组 · '+item.group);
    if(item.focusOf) paragraph('随物镜后焦面定位 · '+fmt(scene.source.wavelength)+' nm。手动移动可改为固定截面。');
    const status=WaveScene.elementStatus(item);if (status.reason) paragraph(status.reason,status.state==='blocked'?'w-warning':'w-hint');
    if(item.type!=='probe' || item.y || item.z) {field('中心 y（mm）',item,'y',pos);field('中心 z（mm）',item,'z',pos);}
    if(item.angle) field('法线角（°）',item,'angle',[-180,180]);
    if (item.map) {field('图案宽度 y（mm）',item.map,'width',len);field('图案高度 z（mm）',item.map,'height',len);if(item.wedge)field('楔角（°）',item,'wedge',[-89,89]);}
    else if (item.aperture!==undefined && item.type!=='probe') field(item.type==='screen'?'相机有效面边长（mm）':'有效口径（mm）',item,'aperture',len);
    if (item.type==='thinLens') field('焦距（mm）',item,'focalLength',pos);
    if (item.type==='lens') {
      const calc=AdvancedOptics.lensParaxial(item,scene.source.wavelength || 550);
      paragraph(item.material+'　·　EFL '+fmt(calc.efl)+' mm　·　BFL '+fmt(calc.bfl)+' mm');
    }
    if(['thinLens','lens'].includes(item.type)) {
      const f=WaveScene.focalPlanes(item,scene.source.wavelength);
      if(f && f.back>=scene.source.x && Math.abs(f.back)<=10000) {
        const focus=document.createElement('button');focus.textContent='观察后焦面 · '+fmt(f.back)+' mm';
        focus.onclick=()=>{
          let p=scene.elements.find(e=>e.type==='probe' && e.focusOf===item.id);
          if(!p){
            if(scene.elements.length>=32){notice('二维实验最多容纳 32 个元件。');return;}
            p=WaveScene.createElement('probe',f.back);p.focusOf=item.id;scene.elements.push(p);
          }
          selected=p.id;setPlane(p.id);
        };box.append(focus);
      }
    }
    if (item.type==='phase') field('均匀光程差（nm）',item,'opd',[-1e7,1e7]);
    if (item.type==='stop') field('实体外径（mm）',item,'outerDiameter',len);
    if (['polarizer','retarder'].includes(item.type)) field(item.type==='retarder'?'快轴角（°）':'透光轴角（°）',item,'axisAngle',ang);
    if (item.type==='retarder') {field('相对延迟（°）',item,'retardance',[-3600,3600]);field('设计波长（nm）',item,'referenceWavelength',nm);}
    const observe=document.createElement('button');observe.textContent='在此观察光场';observe.onclick=()=>setPlane(item.id);box.append(observe);
    const remove=document.createElement('button');remove.textContent='移除此元件';remove.onclick=()=>{
      if (item.map && !confirm('移除此物体及其绘制的图案？')) return;
      scene.elements=scene.elements.filter(e=>e!==item);selected='source';
      invalidateFrom(item.x);
      if (scene.settings.plane===item.id) scene.settings.plane=scene.elements.at(-1)?.id || 'source';
      if (objectId===item.id) selectObject(scene.elements.find(e=>e.map)?.id);
      refresh();storeSoon();runSoon();
    };box.append(remove);
  }
  function setPlane(id) {
    scene.settings.plane=id;scene.settings.side=byId(id)?.type==='screen'?'after':'before';
    refresh();storeSoon();runSoon();
  }
  function addElement(type, atSource=false) {
    if(scene.elements.length>=32){notice('二维实验最多容纳 32 个元件。');return;}
    const base=selected==='source'?scene.source:byId(selected) || scene.source;
    const at=atSource?scene.source.x:base.x;
    const item=WaveScene.createElement(type,at);
    const index=scene.elements.findIndex(e=>e.id===selected);
    scene.elements.splice(index+1,0,item);
    try {WaveScene.validate(scene);} catch(e){scene.elements.splice(index+1,1);notice(e.message);return;}
    invalidateFrom(item.x);
    selected=item.id;
    if (item.map) selectObject(item.id);
    if (type==='probe' || type==='screen') setPlane(item.id);
    else {refresh();storeSoon();runSoon();}
  }
  const painter=WaveViews.attachPainter($('objectCanvas'),{
    getMap:()=>scene && byId(objectId)?.map,
    getBrush:()=>({tool,channel:$('paintChannel').value,value:!$('paintValue').checkValidity()?NaN:$('paintValue').valueAsNumber*($('paintChannel').value==='opd' && $('opdUnit').value==='rad'?scene.source.wavelength/(2*Math.PI):1),
      radius:Math.min(64,Math.max(1,$('brushRadius').valueAsNumber || 1))}),
    onChange:()=>{invalidateFrom(byId(objectId).x);storeSoon();runSoon();}
  });
  const displayOptions=()=>({layer,line:$('line').value==='all'?'all':Number($('line').value),
    log:$('logScale').checked,lockedMax:$('lockScale').checked?lockedMax:undefined,probe:$('probeMode').value,
    phaseAxis:scene.settings.phaseAxis,mode:scene.settings.mode});
  const probe=WaveViews.attachProbe($('resultCanvas'),{getResult:()=>result,getOptions:displayOptions,onRead:showRead});
  function showRead(read) {
    lastRead=read;$('saveRead').disabled=!read;
    $('probeOutput').textContent=read ? read.text+'\n'+(read.kind==='line'?'纵轴 · '+(rendered?.label || '')+'（'+read.unit+'）':'纵轴 · 每条谱线的相对功率') : '';
    const canvas=$('probeChart'), ctx=canvas.getContext('2d');
    canvas.width=Math.max(250,Math.round(canvas.clientWidth*1.5));canvas.height=135;
    const w=canvas.width,h=canvas.height;ctx.clearRect(0,0,w,h);if (!read) return;
    const profile=read.kind==='line';
    const pts=(profile?read.profile:read.spectrum)?.map(v=>profile?[v.distance,v.value]:[v.wavelength,v.power]) || [];
    const finite=pts.filter(p=>p.every(Number.isFinite));if (!finite.length) return;
    const xs=finite.map(p=>p[0]),ys=finite.map(p=>p[1]);
    const x0=Math.min(...xs),x1=Math.max(...xs),y0=Math.min(0,...ys),y1=Math.max(...ys);
    const X=x=>x1===x0?w/2:54+(x-x0)/(x1-x0)*(w-75),Y=y=>h-31-(y-y0)/(y1-y0||1)*(h-53);
    ctx.strokeStyle='#c0cfc1';ctx.beginPath();ctx.moveTo(53,14);ctx.lineTo(53,h-30);ctx.lineTo(w-13,h-30);ctx.stroke();
    ctx.fillStyle='#526c5a';ctx.font='13px sans-serif';ctx.fillText(fmt(y1),2,17);
    ctx.fillText(fmt(x0),49,h-8);ctx.textAlign='right';ctx.fillText(fmt(x1)+(profile?' mm':' nm'),w-8,h-8);
    ctx.strokeStyle='#378363';ctx.fillStyle='#378363';ctx.lineWidth=2;
    if (profile) {ctx.beginPath();let open=false;for(const [x,y] of pts){if(!Number.isFinite(y)){open=false;continue;}if(open)ctx.lineTo(X(x),Y(y));else ctx.moveTo(X(x),Y(y));open=true;}ctx.stroke();}
    else for(const [x,y] of finite) {ctx.beginPath();ctx.moveTo(X(x),Y(0));ctx.lineTo(X(x),Y(y));ctx.stroke();ctx.beginPath();ctx.arc(X(x),Y(y),3.5,0,Math.PI*2);ctx.fill();}
  }
  function clearResult(message) {
    result=null;rendered=null;
    $('resultOverlay').textContent=message;$('resultOverlay').hidden=false;
    $('resultScale').textContent='';$('gridLabel').textContent='';
    $('saveData').disabled=$('saveImage').disabled=true;probe.clear();
  }
  function renderResult() {
    updateLayerControls();if (!result) return;
    rendered=WaveViews.renderResult($('resultCanvas'),result,displayOptions());
    const unavailable=(measured() && !result.measurement && (result.measurementReason || '正在准备移相测量。')) ||
      (layer==='phase' && !rendered.hasFinite && (result.phaseReason || '此偏振投影在当前照明下没有可读相位。'));
    $('resultOverlay').hidden=!unavailable;
    if (unavailable) $('resultOverlay').textContent=unavailable;
    $('saveData').disabled=$('saveImage').disabled=!!unavailable;
    $('resultScale').textContent='视场 '+fmt(result.width)+' mm　·　Δ '+fmt(result.width*1000/result.n)+' µm';
    $('gridLabel').textContent=result.n+' × '+result.n;
    probe.refresh();
  }
  function diagnostics(data) {
    const box=$('diagnosticBody');box.replaceChildren();
    const warnings=[...new Set([...(data.warnings || []),...(data.phaseReason?[data.phaseReason]:[]),...(data.measurementReason?[data.measurementReason]:[]),...(data.blocked?[data.blocked]:[])])];
    $('diagCount').textContent=warnings.length?' · '+warnings.length+' 条提示':'';
    if(warnings.length){const list=document.createElement('ul');for(const warning of warnings){const li=document.createElement('li');li.textContent=warning;list.append(li);}box.append(list);}
    const ledger=document.createElement('div');ledger.className='w-ledger';
    for (const [key,val] of Object.entries(data.ledger || {})) if(Number.isFinite(val)&&ledgerNames[key]) {
      const el=document.createElement('span');el.textContent=ledgerNames[key]+' '+fmt(val*100)+'%';ledger.append(el);
    }
    box.append(ledger);
    if(data.measurement) {
      const ports=document.createElement('p');
      ports.textContent='四步移相 · 测量端功率 '+data.measurement.framePowers.map(v=>fmt(v*100)+'%').join(' / ')+
        '，互补端 '+data.measurement.complementaryPowers.map(v=>fmt(v*100)+'%').join(' / ')+'。';
      box.append(ports);
    }
    if(Number.isFinite(data.viewPower)){
      const view=document.createElement('p');view.textContent='当前视场内的相对功率 '+fmt(data.viewPower*100)+'%　·　视场外 '+fmt(data.outsideViewPower*100)+'%';box.append(view);
    }
    if(scene.origin) {
      const receipt=document.createElement('details'), title=document.createElement('summary'), list=document.createElement('ul');
      title.textContent='进阶配置映射';receipt.append(title,list);
      for(const e of scene.elements) {
        const s=WaveScene.elementStatus(e), row=document.createElement('li');
        row.textContent=(e.name || names[e.type])+' · '+({mapped:'已映射',approx:'近似',blocked:'需要其他模型'}[s.state])+' · '+s.reason;list.append(row);
      }
      box.append(receipt);
    }
    const info=document.createElement('p');info.textContent='输入总功率归一为 1。曲面厚透镜采用逐波长近轴模型。相位按单色相干模式和偏振投影读取。';box.append(info);
  }
  function runSoon(delay=100) {
    const version=++job;
    clearTimeout(runTimer);if(worker){worker.terminate();worker=null;}
    clearResult('正在计算光场…');$('status').textContent='正在传播';
    $('runStats').textContent='';$('diagnosticBody').replaceChildren();$('diagCount').textContent='';
    $('status').parentElement.parentElement.dataset.busy='true';
    runTimer=setTimeout(()=>{
      const started=performance.now(), opts={...scene.settings,interferometer:measured()};
      const key=JSON.stringify([opts,byId(opts.plane)?.x ?? scene.source.x]);
      function finish(data,cached=false) {
        if(version!==job) return;
        if(worker){worker.terminate();worker=null;}
        $('status').parentElement.parentElement.dataset.busy='false'; diagnostics(data);
        if(data.blocked || !data.lines?.length) {
          clearResult(data.blocked || '此面没有可用结果。');$('status').textContent='此截面无法定量求解';$('diagnostics').open=true;return;
        }
        if(!cached) cachePlane(key,data);
        result=data;$('status').textContent=data.warnings?.length?'已计算 · 查看传播提示':'传播完成';
        $('runStats').textContent=data.lines.length+' 条谱线　·　'+(cached?'已缓存':((performance.now()-started)/1000).toFixed(2)+' s');
        renderResult();
      }
      if(planeCache.has(key)){finish(planeCache.get(key).data,true);return;}
      function local() {
        if(version!==job) return;
        try {finish(WaveSolver.run(scene,opts));} catch(e) {finish({blocked:e.message});}
      }
      if(workersAvailable) try {
        const offline=location.protocol==='file:';
        if(offline && !offlineWorkerUrl) offlineWorkerUrl=URL.createObjectURL(new Blob([WaveSolver.createWorkerScript()],{type:'text/javascript'}));
        worker=new Worker(offline?offlineWorkerUrl:'wave-worker.js');
        worker.onmessage=e=>finish(e.data.result || {blocked:e.data.error});
        worker.onerror=()=>{if(version!==job)return;worker?.terminate();worker=null;workersAvailable=false;setTimeout(local,0);};
        const opticalScene={source:scene.source,elements:scene.elements,settings:opts};
        worker.postMessage(offline?WaveSolver.workerPacket(opticalScene,opts):{scene:opticalScene,options:opts});return;
      } catch {workersAvailable=false;worker?.terminate();worker=null;}
      local();
    },delay);
  }
  $('manualOpen').onclick=()=>OpticsManual.open('w-start');
  $('addElement').onclick=()=>addElement($('newType').value);$('addObject').onclick=()=>addElement('object',true);
  $('objectChoice').onchange=()=>{selectObject($('objectChoice').value);selected=objectId;refresh();};
  $('plane').onchange=()=>setPlane($('plane').value);
  for (const [id,key] of [['side','side'],['gridSize','n'],['inputWidth','width'],['outputWidth','outputWidth'],['throughOnly','throughOnly'],['phaseAxis','phaseAxis'],['phaseMode','mode'],['referenceOPD','referenceOPD']]) {
    $(id).onchange=()=>{const el=$(id);if(el.type==='number' && (!el.checkValidity() || !Number.isFinite(el.valueAsNumber))) {el.reportValidity();el.value=scene.settings[key];return;}
      scene.settings[key]=el.type==='checkbox'?el.checked:['width','mode','n','outputWidth','referenceOPD'].includes(key)?Number(el.value):el.value;storeSoon();runSoon();};
  }
  document.querySelectorAll('[data-tool]').forEach(b=>b.onclick=()=>{
    tool=b.dataset.tool;document.querySelectorAll('[data-tool]').forEach(btn=>btn.setAttribute('aria-pressed',String(btn===b)));
  });
  $('undoPaint').onclick=()=>painter.undo();
  $('paintChannel').onchange=()=>{
    const phase=$('paintChannel').value==='opd', val=$('paintValue');
    $('opdUnits').hidden=!phase;const radians=$('opdUnit').value==='rad';
    $('paintValueLabel').firstElementChild.textContent=phase?(radians?'参考相位（rad）':'光程差（nm）'):'功率份额';
    val.min=phase?-1e7:0;val.max=phase?1e7:1;val.step=phase?'any':'.05';val.value=phase?(radians?Math.PI/2:scene.source.wavelength/4):1;painter.render();
  };
  $('opdUnit').onchange=()=>{
    const radians=$('opdUnit').value==='rad',factor=2*Math.PI/scene.source.wavelength;
    $('paintValue').value=Number(($('paintValue').valueAsNumber*(radians?factor:1/factor)).toPrecision(10));
    $('paintValueLabel').firstElementChild.textContent=radians?'参考相位（rad）':'光程差（nm）';
  };
  $('pattern').onchange=()=>{
    const key=$('pattern').value, obj=byId(objectId);if(!key || !obj?.map)return;
    const m=obj.map;
    painter.applyPattern(WaveScene.makeMap(key,m.size,m.width,m.height,scene.source.wavelength));
    $('pattern').value='';
  };
  document.querySelectorAll('[data-layer]').forEach(b=>b.onclick=()=>{
    layer=b.dataset.layer==='ellipse'?$('polLayer').value:b.dataset.layer==='interference'?$('measurementLayer').value:b.dataset.layer;
    if(layer==='phase' && $('line').value!=='all') scene.settings.phaseLine=Number($('line').value);
    refresh();
    if((measured() && !result?.measurement) || (layer==='phase' && (!result || result.phaseLine!==scene.settings.phaseLine || result.phaseAxis!==scene.settings.phaseAxis || result.mode!==scene.settings.mode))) runSoon();else renderResult();
  });
  $('measurementLayer').onchange=()=>{layer=$('measurementLayer').value;renderResult();};
  $('polLayer').onchange=()=>{layer=$('polLayer').value;renderResult();};
  $('line').onchange=()=>{
    if(layer==='phase'||measured()){scene.settings.phaseLine=Number($('line').value);storeSoon();runSoon();}else renderResult();
  };
  $('logScale').onchange=renderResult;
  $('lockScale').onchange=()=>{lockedMax=$('lockScale').checked?rendered?.max:null;renderResult();};
  $('probeMode').onchange=()=>{
    $('probeHint').textContent={point:'在观察面点击一个像素读取光谱。',roi:'在观察面拖出矩形，读取区域功率和光谱。',line:'在观察面拖出线段，读取沿线的分布。'}[$('probeMode').value];
    probe.clear();renderResult();
  };
  $('saveExperiment').onclick=()=>{
    try {download(new Blob([JSON.stringify(WaveScene.exportPackage(scene))],{type:'application/json'}),'光迹二维-'+scene.name+'.json');}
    catch(e){notice(e.message);}
  };
  $('openExperiment').onclick=()=>$('experimentFile').click();
  $('experimentFile').onchange=async e=>{
    const file=e.target.files[0];if(!file)return;
    try {
      if(file.size>48*1024*1024)throw Error('实验文件超过 48 MB。');
      const next=WaveScene.fromPackage(JSON.parse(await file.text()));await storeCurrent();openScene(next);
    }catch(error){notice('打开失败。'+error.message);}finally{e.target.value='';}
  };
  $('computeSettings').ontoggle=()=>{if($('computeSettings').open)listRecent();};
  $('recent').onchange=async()=>{
    const id=$('recent').value;if(!id)return;
    try {await storeCurrent();const record=await WaveStorage.get(id);if(record)openScene(record.scene,id);}catch(e){notice(e.message);}
  };
  $('defaultExperiment').onclick=async()=>{await storeCurrent();openScene(WaveScene.createDefault());};
  function metadata() {
    const target=byId(scene.settings.plane);
    return {name:scene.name,plane:(target?.name || '光源')+' · '+$('side').selectedOptions[0].textContent,
      mode:$('phaseMode').selectedOptions[0].textContent,reference:'光源发射相位',
      model:['正向传播 · 近轴镜组',...(result.warnings || []),...(layer==='phase' && result.phaseReason?[result.phaseReason]:[])].join('。')};
  }
  $('saveData').onclick=()=>{if(!rendered)return;
    const csv=WaveViews.toCSV(result,displayOptions(),metadata());
    download(new Blob(['\uFEFF',csv],{type:'text/csv;charset=utf-8'}),'光迹-'+layer+'.csv');
  };
  $('saveImage').onclick=()=>{
    if(!rendered)return;
    const out=WaveViews.figureCanvas($('resultCanvas'),result,displayOptions(),metadata());
    out.toBlob(blob=>{if(blob)download(blob,'光迹-'+layer+'.png');});
  };
  $('saveRead').onclick=()=>{
    if(!lastRead || !result)return;
    const line=lastRead.kind==='line', rows=line?lastRead.profile.map(p=>[p.distance,p.value]):lastRead.spectrum.map(s=>[s.wavelength,s.power]);
    const notes=metadata(),headers=[notes.name,notes.plane,notes.model,lastRead.text];
    const csv=[...headers.map(s=>'"# '+s.replaceAll('"','""')+'"'),line?'distance_mm,value ('+rendered.unit+')':'wavelength_nm,relative_power',...rows.map(r=>r.map(v=>Number.isFinite(v)?v:'').join(','))].join('\r\n');
    download(new Blob(['\uFEFF',csv],{type:'text/csv;charset=utf-8'}),'光迹-测量.csv');
  };
  window.addEventListener('resize',()=>{if(scene){if(byId(objectId)?.map)painter.render();if(result)renderResult();}});
  window.addEventListener('pagehide',()=>{if(scene)storeCurrent();});
  async function start() {
    const hash=location.hash.slice(1);
    try {
      if(hash==='import'){openScene(WaveScene.createDefault());notice('请点「打开实验」，选择刚从进阶工作站下载的 JSON。');return;}
      if (hash.startsWith('scene=')) {
        const payload=JSON.parse(decodeURIComponent(hash.slice(6)));
        openScene(WaveScene.fromPackage(payload));return;
      }
      const id=hash.startsWith('work=')?decodeURIComponent(hash.slice(5)):(await WaveStorage.recent())[0]?.id;
      const record=id && await WaveStorage.get(id);
      if(record) {openScene(record.scene,record.id);return;}
    } catch(e) {openScene(WaveScene.createDefault());notice('未能恢复传入的实验，可通过「打开实验」读取 JSON。'+e.message);return;}
    openScene(WaveScene.createDefault());
  }
  start();
})();
