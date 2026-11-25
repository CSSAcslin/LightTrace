/* Independent local workspace; basic-v1 storage and exports are never overwritten. */
(() => {
  'use strict';
  const $=id=>document.getElementById(id), clone=o=>JSON.parse(JSON.stringify(o));
  const KEY='guangji-advanced-workstation-v1', FORMAT='guangji.surface-workbench', fmt=(v,d=2)=>Number.isFinite(v)?v.toFixed(d).replace('-','−'):'∞';
  const defaults={axis:true,cardinal:true,snap:true,grid:true,gridStep:10,opacity:68,theme:'dark',spectral:true,allMarks:false,groupLock:true,imagePlane:true,polarization:true};
  const canvasToggles=['axis','cardinal','snap','grid','spectral','allMarks','groupLock','imagePlane','polarization'];
  const registry=AdvEditor.presets,firstKey=Object.keys(registry)[0],undo=[],redo=[];
  let state, result, rayIndex=0, stepIndex=0, pending=0, opticalDirty=true,editorDirty=true,inspectorDirty=true,fitNext=true,saveTimer,noticeTimer,dragSnapshot=null,lastEdit=null;
  let analysisToOpen=null;
  const isPolarizationElement=e=>e.type==='polarizer'||e.type==='retarder';
  function analysisForSelection(scene){
    const selected=scene.elements.find(e=>e.id===scene.selected);
    if(selected?.type==='object')return 'object';
    return selected&&isPolarizationElement(selected)?'polarization':null;
  }
  function fromPreset(key){const p=clone(registry[key]);return {source:p.source,elements:p.elements,canvas:{...defaults},selected:p.selected||p.elements.find(e=>e.type==='object')?.id||p.elements.find(e=>e.type==='lens')?.id||'source',preset:key};}
  function notify(msg){$('notice').textContent=msg;$('notice').hidden=false;clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>$('notice').hidden=true,4000);}
  function optErrors(s){
    if(!s.source||!Array.isArray(s.elements)||s.elements.length>24)return ['需要有效光源，且器件数不可超过 24 个。'];
    if(s.elements.filter(e=>e?.type==='object').length>1)return ['每个工作站实验支持一个图案物体。'];
    const ids=new Set(['source']),errs=[];
    for(const e of s.elements){if(!e||typeof e.id!=='string'||!/^[\w-]{1,64}$/.test(e.id)||ids.has(e.id))return ['器件编号无效或重复。'];ids.add(e.id);if((e.name!=null&&(typeof e.name!=='string'||e.name.length>80))||(e.group!=null&&(typeof e.group!=='string'||e.group.length>24)))return ['元件名称或组名长度无效。'];}
    if(AdvEditor.validateSource)errs.push(...AdvEditor.validateSource(s.source));
    for(const e of s.elements)if(AdvEditor.validateElement)errs.push(...AdvEditor.validateElement(e));
    return errs.length?errs:AdvancedOptics.validateScene(s);
  }
  function config(input){
    if(!input||typeof input!=='object'||input.format!==FORMAT||input.version!==1)throw Error('请选择从进阶工作站导出的实验 JSON。');
    const s=input.scene;if(!s||typeof s!=='object'||!s.source||!Array.isArray(s.elements))throw Error('实验结构不完整。');
    const v={...defaults};for(const k of canvasToggles)if(typeof s.canvas?.[k]==='boolean')v[k]=s.canvas[k];
    if([5,10,25,50].includes(s.canvas?.gridStep))v.gridStep=s.canvas.gridStep;if(['dark','navy','light'].includes(s.canvas?.theme))v.theme=s.canvas.theme;if(Number.isFinite(s.canvas?.opacity))v.opacity=Math.max(15,Math.min(100,s.canvas.opacity));
    const out={source:s.source,elements:s.elements,canvas:v,selected:s.elements.some(e=>e?.id===s.selected)?s.selected:'source',preset:Object.hasOwn(registry,s.preset)?s.preset:'custom'};
    if(out.preset==='objectMixed' && !out.elements.find(e=>e?.type==='object')?.scatterModel)out.preset='custom';
    const errors=optErrors(out);if(errors.length)throw Error(errors[0]);return out;
  }
  const serialize=()=>({format:FORMAT,version:1,scene:state});
  function persistNow(){try{localStorage.setItem(KEY,JSON.stringify(serialize()));$('saveStatus').textContent='● 已本地保存';}catch{$('saveStatus').textContent='请导出 JSON 保存';}}
  function persist(){clearTimeout(saveTimer);saveTimer=setTimeout(persistNow,300);}
  function pushUndo(prev){if(!undo.length||JSON.stringify(undo.at(-1))!==JSON.stringify(prev)){undo.push(clone(prev));if(undo.length>45)undo.shift();}redo.length=0;buttons();}
  function buttons(){$('undo').disabled=!undo.length;$('redo').disabled=!redo.length;}
  function schedule(opt=false,edit=false,inspect=false){opticalDirty||=opt;editorDirty||=edit;inspectorDirty||=inspect; if(!pending)pending=requestAnimationFrame(render);}
  function patch(data,opts={}){
    const prev=state,next={...state,...data};const changesOpt='source'in data||'elements'in data;
    if(changesOpt&&!opts.preset)next.preset='custom';
    if(next.selected!=='source'&&!next.elements.some(e=>e.id===next.selected))next.selected=next.elements[0]?.id||'source';
    if(changesOpt){const errs=optErrors(next);if(errs.length){if(!opts.drag||$('statusLine').textContent!==errs[0]){$('statusLine').textContent=errs[0];$('statusLine').classList.add('warn');if(!opts.drag)notify(errs[0]);}return false;}}
    if(JSON.stringify(prev)===JSON.stringify(next))return true;
    if(!opts.drag&&!opts.noUndo&&(changesOpt||'canvas'in data)){
      const now=performance.now(),active=document.activeElement;
      const patternChange=data.elements?.some(e=>{
        if(e.type!=='object')return false;
        const old=prev.elements.find(o=>o.id===e.id);
        return JSON.stringify(e.pattern)!==JSON.stringify(old?.pattern) ||
          JSON.stringify(e.channels)!==JSON.stringify(old?.channels);
      });
      const coalesce=!patternChange&&active?.matches('input[type=number],input[type=range],input[type=text]')&&lastEdit?.el===active&&now-lastEdit.time<1400;
      if(!coalesce)pushUndo(prev);
      lastEdit=patternChange?null:{el:active,time:now};
    }
    if(next.selected!==prev.selected)analysisToOpen=analysisForSelection(next);
    if(prev.source.polarization!==next.source.polarization)analysisToOpen='polarization';
    state=next;if(opts.fit)fitNext=true;
    schedule(changesOpt,true,true);persist();return true;
  }
  function apply(s,withUndo=true){if(withUndo)pushUndo(state);lastEdit=null;state=clone(s);rayIndex=0;stepIndex=0;fitNext=true;analysisToOpen=analysisForSelection(s);schedule(true,true,true);persist();}
  function setRay(i,j=0){rayIndex=i;stepIndex=j;schedule(false,false,true);}
  function selectCanvasRay(i,step){
    analysisToOpen='ray';
    setRay(i,step);
  }
  function select(id){if(state.selected===id)return;patch({selected:id},{noUndo:true});}
  function move(id,changes){const o=id==='source'?state.source:state.elements.find(e=>e.id===id);if(!o)return;const opts={drag:true};if(id==='source'){patch({source:{...o,...changes}},opts);return;}
    const theta=((changes.angle??o.angle)-o.angle)*Math.PI/180,cs=Math.cos(theta),sn=Math.sin(theta),dx=(changes.x??o.x)-o.x,dy=(changes.y??o.y)-o.y;
    const elements=state.elements.map(e=>{if(e.id===id)return {...e,...changes};if(!o.group||!state.canvas.groupLock||e.group!==o.group)return e;const x=e.x-o.x,y=e.y-o.y;return {...e,x:o.x+dx+cs*x-sn*y,y:o.y+dy+sn*x+cs*y,angle:((e.angle+theta*180/Math.PI+540)%360)-180};});
    patch({elements},opts);
  }
  const view=AdvCanvas.create($('layoutCanvas'),{select,move,ray:selectCanvasRay,coordinate:t=>$('cursorPos').textContent=t,zoom:p=>$('zoomPct').textContent=p+'%',begin(){dragSnapshot=clone(state);},end(){if(dragSnapshot&&JSON.stringify(dragSnapshot)!==JSON.stringify(state)){pushUndo(dragSnapshot);lastEdit=null;}dragSnapshot=null;}});
  function render(){
    pending=0;const recalc=opticalDirty,ed=editorDirty,ins=inspectorDirty;opticalDirty=editorDirty=inspectorDirty=false;
    if(recalc||!result)result=AdvancedOptics.simulate(state);
    if(analysisToOpen==='object'){const i=result.rays.findIndex(r=>r.status==='detected'&&r.objectHits?.length);if(i>=0){rayIndex=i;stepIndex=Math.max(0,result.rays[i].events.findIndex(e=>e.type==='object'));}}
    rayIndex=Math.min(Math.max(0,rayIndex),Math.max(0,result.rays.length-1));stepIndex=Math.min(Math.max(0,stepIndex),(result.rays[rayIndex]?.events.length||0)-1);
    view.set(state,result,rayIndex,stepIndex);
    if(ed)AdvEditor.render($('editor'),state,patch,result);
    if(recalc||ed||ins)AdvInspector.render($('inspection'),{scene:state,result,selectedRayIndex:rayIndex,selectedStepIndex:stepIndex,onRay:i=>setRay(i,0),onStep:j=>setRay(rayIndex,j),onCardinalWavelength:view.setImageReference});
    if(analysisToOpen==='object')AdvInspector.showObject($('inspection'));
    if(analysisToOpen==='polarization')AdvInspector.showPolarization($('inspection'));
    if(analysisToOpen==='ray')AdvInspector.showRay($('inspection'));
    analysisToOpen=null;
    if(fitNext){fitNext=false;view.fit();}
    const count=result.detectors.reduce((a,d)=>a+d.hits.length,0),specimen=state.elements.find(e=>e.type==='object');
    const seeds=result.emittedCount??result.rays.length;
    $('traceBadge').textContent=specimen?seeds+' 条入射采样 / '+result.rays.length+' 条追迹路径':result.rays.length+' 条光线　/　'+result.wavelengths.length+' λ';
    $('preset').value=state.preset;$('presetDescription').textContent=registry[state.preset]?.description||'自定义实验 · 场景和参数自动保存在当前浏览器。';
    const rr=view.getRelay(),gs=view.getGroups();const info=[count+' / '+result.rays.length+(specimen?' 条路径命中探测屏':' 条光线到达探测屏')];
    if(specimen){
      const binCoverage=result.objects.find(p=>p.id===specimen.id)?.incident.filter(power=>power>0).length||0;
      const interactionLabel={mixed:'混合材质',scatter:'透射散射',reflect:'镜面反射',refract:'双界面折射'};
      info.push(interactionLabel[specimen.interaction]+' · 已照亮 '+binCoverage+' / 33 格');
      if(!binCoverage)info.push('当前照明未落到图案面，可调整光源或物体位置');
      else if(!count)info.push('可检查图案灰度、出光方向和探测屏位置');
      if(result.rays.length>850)info.push('画布抽样显示路径；统计使用全部路径');
    }
    if(rr){
      const reference='（'+rr.wavelength+' nm）';
      if(rr.complete)info.push('4f 近轴中继'+reference+' · 有限物面成像于探测面');
      else if(rr.confocal)info.push('两镜近轴共焦'+reference+' · 平行束入射时近轴平行出射');
      else {
        const gap=Math.abs(rr.gap)<.01?Number((rr.gap*1000).toPrecision(3))+' µm':fmt(rr.gap,3)+' mm';
        info.push((rr.nearlyConfocal?'接近共焦':'两镜内侧焦面')+reference+' · 轴向差 F₂ − F₁′ = '+gap);
      }
    }
    const g=gs.find(g=>g.lenses.some(e=>e.id===state.selected));if(g)info.push(g.name+(g.ok?(g.metrics?.valid?' · 共轴组 EFL '+fmt(g.metrics.efl)+' mm':' · 镜组近轴基准不可用'):' · 镜片不共轴，显示各自光轴'));
    else if(state.selected==='source')info.push('当前选择：光源');else{const m=result.lensMetrics.find(v=>v.id===state.selected);if(m)info.push('选中镜片：EFL '+fmt(m.efl)+' mm　BFL '+fmt(m.bfl)+' mm');}
    if(state.canvas.cardinal&&result.wavelengths.length>1&&result.lensMetrics.length)
      info.push('F、H 标记按光源参考波长 '+(state.source.wavelength??550)+' nm');
    const warning=result.warnings[0];$('statusLine').classList.toggle('warn',!!warning);$('statusLine').textContent=warning||info.join('　·　');
    for(const k of canvasToggles)$(k).checked=state.canvas[k];
    for(const k of ['gridStep','opacity','theme'])$(k).value=state.canvas[k];buttons();
  }
  function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),5000);}
  const presetGroups=[
    ['图案物体实验',p=>p.elements.some(e=>e.type==='object')],
    ['偏振实验',p=>p.elements.some(isPolarizationElement)],
    ['光学系统实验',p=>!p.elements.some(e=>e.type==='object'||isPolarizationElement(e))]
  ];
  for(const [label,filter] of presetGroups){const group=document.createElement('optgroup');group.label=label;for(const [k,v] of Object.entries(registry))if(filter(v))group.append(new Option(v.name,k));if(group.children.length)$('preset').append(group);}const custom=new Option('自定义实验','custom');custom.hidden=true;$('preset').add(custom);
  $('preset').onchange=e=>{if(Object.hasOwn(registry,e.target.value))apply(fromPreset(e.target.value));};
  $('objectTool').onclick=()=>{
    const current=state.elements.find(e=>e.type==='object');
    if(current){select(current.id);analysisToOpen='object';schedule(false,true,true);}
    else{const e=AdvEditor.makeObject(state);if(!patch({elements:[...state.elements,e],selected:e.id},{fit:true}))return;notify('已加入空白物体。选一个材质通道开始绘制，未涂区域吸收全部入射光。');}
    if(matchMedia('(max-width:760px)').matches)mobile(true);
    requestAnimationFrame(()=>{const board=$('editor').querySelector('.ae-pattern-board');board?.closest('section')?.scrollIntoView({block:'nearest'});});
  };
  $('exportScene').onclick=()=>download(new Blob([JSON.stringify(serialize(),null,2)],{type:'application/json'}),'光迹Pro-光学实验.json');
  $('savePng').onclick=()=>{view.draw();$('layoutCanvas').toBlob(b=>{if(b)download(b,'光迹Pro-曲面追迹.png');},'image/png');};
  $('importScene').onclick=()=>$('sceneFile').click();$('sceneFile').onchange=async e=>{try{const f=e.target.files[0];if(!f)return;if(f.size>250000)throw Error('配置超过 250 KB 限制。');apply(config(JSON.parse(await f.text())));notify('进阶实验已载入');}catch(err){notify('导入失败：'+err.message);}finally{e.target.value='';}};
  $('undo').onclick=()=>{if(!undo.length)return;redo.push(clone(state));const old=undo.pop();apply(old,false);buttons();};
  $('redo').onclick=()=>{if(!redo.length)return;undo.push(clone(state));apply(redo.pop(),false);buttons();};
  document.addEventListener('keydown',e=>{if(e.target?.matches('input,textarea,select')||OpticsManual.isOpen)return;if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();$(e.shiftKey?'redo':'undo').click();}if(e.key==='Escape')mobile(false);});
  for(const [key,id] of [['select','toolSelect'],['pan','toolPan'],['ruler','toolRuler']])$(id).onclick=()=>{view.setMode(key);for(const b of ['toolSelect','toolPan','toolRuler'])$(b).setAttribute('aria-pressed',String(b===id));$('toolHint').textContent=key==='ruler'?'依次点两点测距 · Esc 清除':key==='pan'?'拖动平移视窗 · 滚轮缩放':'拖动元件定位 · 滚轮缩放';};
  $('fit').onclick=()=>view.fit();$('zoomIn').onclick=()=>view.zoom(1.25);$('zoomOut').onclick=()=>view.zoom(.8);
  $('canvasSettings').onclick=()=>{const el=$('viewOptions');el.hidden=!el.hidden;$('canvasSettings').setAttribute('aria-expanded',String(!el.hidden));};
  for(const k of Object.keys(defaults))$(k).addEventListener(k==='opacity'?'input':'change',e=>{const value=e.target.type==='checkbox'?e.target.checked:['opacity','gridStep'].includes(k)?Number(e.target.value):e.target.value;patch({canvas:{...state.canvas,[k]:value}});});
  $('guideOpen').onclick=()=>OpticsManual.open();
  function mobile(open){$('designPanel').classList.toggle('open',open);$('mobileTools').setAttribute('aria-expanded',String(open));if(open)$('plot').scrollIntoView({block:'start'});}
  $('mobileTools').onclick=()=>mobile(!$('designPanel').classList.contains('open'));$('closeTools').onclick=()=>mobile(false);
  state=fromPreset(firstKey);
  try{const stored=localStorage.getItem(KEY);if(stored)state=config(JSON.parse(stored));}catch{notify('未载入旧配置，已打开默认实验。');}
  analysisToOpen=analysisForSelection(state);
  window.addEventListener('pagehide',persistNow);render();
})();
