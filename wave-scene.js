/* The editable wave experiment owns its copy of the advanced optical layout.
 * World dimensions are mm, optical path differences and wavelengths are nm. */
(function(root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports=factory(require('./advanced-optics.js'));
  else root.WaveScene=factory(root.AdvancedOptics);
})(globalThis, function(optics) {
  'use strict';
  const advancedFormat='guangji.surface-workbench', waveFormat='guangji.wave-workbench';
  const names={object:'二维物体', thinLens:'理想薄透镜', phase:'均匀移相片', probe:'观察截面',
    stop:'孔径光阑', polarizer:'线偏振片', retarder:'波片', screen:'探测屏'};
  const presets=['letter','slits','step','clear','blank','pinhole'];
  const sampling=[64,128,256,512];
  const sourceDefaults={x:0,y:0,z:0,angle:0,type:'collimated',width:2.8,height:1,spread:4,
    spectrum:'mono',wavelength:550,bandwidth:120,polarization:'linear',polDegree:1,polAngle:0,ellipticity:0};
  const settingsDefaults={n:256,width:4,outputWidth:0,referenceOPD:0,plane:'source',side:'before',phaseLine:0,phaseAxis:'y',mode:0,throughOnly:false};
  const copy=v=>JSON.parse(JSON.stringify(v));
  const numberIn=(v,lo,hi)=>Number.isFinite(v)&&v>=lo&&v<=hi;
  const validId=id=>typeof id==='string' && /^[a-zA-Z0-9_-]{1,64}$/.test(id);
  function check(ok,message) { if (!ok) throw Error(message); }
  function mapShape(size,width,height) {
    check(Number.isInteger(size)&&size>=2&&size<=256,'绘图网格每边需要 2 至 256 格。');
    check([width,height].every(x=>numberIn(x,0.000001,10000)),'物体宽高必须是有效的物理尺寸（mm）。');
  }
  function makeMap(preset='blank', size=64, width=3, height=width, referenceWavelength=550) {
    check(presets.includes(preset),'未知的物体图案。');
    mapShape(size,width,height);
    check(numberIn(referenceWavelength,380,780),'相位参考波长范围是 380 至 780 nm。');
    const cells=size*size, map={size,width,height,t:Array(cells).fill(0),r:Array(cells).fill(0),
      s:Array(cells).fill(0),opd:Array(cells).fill(0)};
    for(let row=0;row<size;row++) for(let col=0;col<size;col++) {
      const y=(col+0.5)/size-0.5, z=0.5-(row+0.5)/size, i=row*size+col;
      let open=false;
      if (preset==='letter') {
        const stem=y>=-.23 && y<=-.12 && Math.abs(z)<=.32;
        const top=y>=-.23 && y<=.24 && z>=.21 && z<=.32;
        const middle=y>=-.23 && y<=.14 && z>=-.015 && z<=.085;
        open=stem||top||middle;
      } else if(preset==='slits') open=Math.abs(Math.abs(y)-.135)<.024 && Math.abs(z)<.30;
      else if(preset==='pinhole') open=Math.hypot(y,z)<.12;
      else if(preset==='clear'||preset==='step') open=true;
      map.t[i]=Number(open);
      if(preset==='step'&&y>=0) map.opd[i]=referenceWavelength/4;
    }
    return map;
  }
  function validMap(m) {
    check(m&&typeof m==='object','缺少二维物体图案。');
    mapShape(m.size,m.width,m.height);
    const len=m.size*m.size;
    for(const key of ['t','r','s','opd']) check(Array.isArray(m[key]) && m[key].length===len,'图案通道的尺寸不一致。');
    for(let i=0;i<len;i++) {
      check(numberIn(m.t[i],0,1)&&numberIn(m.r[i],0,1)&&numberIn(m.s[i],0,1)&&m.t[i]+m.r[i]+m.s[i]<=1+1e-9,'物体像素的功率份额无效。');
      check(numberIn(m.opd[i],-1e10,1e10),'物体像素的光程差无效。');
    }
  }

  function wavelengths(source) {
    const center=source.wavelength??550;
    if(source.spectrum==='rgb') return [486.1327,546.074,656.2725].map(wavelength=>({wavelength,weight:1/3}));
    if(source.spectrum!=='band'||!source.bandwidth) return [{wavelength:center,weight:1}];
    const low=Math.max(380,center-source.bandwidth/2), high=Math.min(780,center+source.bandwidth/2);
    // Trapezoidal integration for a flat density in the retained spectral band.
    return [1,2,2,2,1].map((w,i)=>({wavelength:low+(high-low)*i/4,weight:w/8}));
  }
  function elementStatus(e) {
    if(e.type==='mirror') return {state:'blocked',reason:'此镜面需要折返光路和旋转后的局部坐标。'};
    if(e.type==='grating') return {state:'blocked',reason:'继承的光栅只指定了级次，尚缺二维振幅／相位效率模型。'};
    if(Math.abs((e.angle??0)%360)>1e-9) return {state:'blocked',reason:'倾斜器件需要倾斜面传播。'};
    if(['lens','thinLens'].includes(e.type) && (Math.abs(e.y??0)>1e-9 || Math.abs(e.z??0)>1e-9))
      return {state:'blocked',reason:'偏心镜片需要离轴瞳面传播。'};
    if(e.type==='lens') return {state:'approx',reason:'按当前波长的主平面与有效焦距做近轴传播。'};
    if(e.type==='object') {
      if(Math.abs(e.wedge??0)>1e-9) return {state:'blocked',reason:'楔片的倾斜出射面需要折射传播。'};
      if(e.interaction) return {state:'approx',reason:'原图每格沿 z 拉伸。图中给出直透分量，散射与反射独立记账。'};
      return {state:'mapped',reason:'二维材料功率份额与光程差。'};
    }
    return Object.hasOwn(names,e.type) ? {state:'mapped',reason:names[e.type]} : {state:'blocked',reason:'该器件尚无二维模型。'};
  }
  let serial=0;
  function createElement(type,x=0) {
    check(Object.hasOwn(names,type),'不能创建这个类型的器件。');
    check(numberIn(x,-10000,10000),'器件轴向坐标超出范围。');
    const id='w-'+Date.now().toString(36)+'-'+(++serial).toString(36);
    const e={id,type,name:names[type],x,y:0,z:0,angle:0,aperture:8};
    if(type==='thinLens') e.focalLength=80;
    if(type==='object') Object.assign(e,{map:makeMap('blank'),n:1,thickness:0,wedge:0,aperture:3});
    if(type==='phase') e.opd=137.5;
    if(type==='stop') Object.assign(e,{aperture:1.4,outerDiameter:8});
    if(type==='retarder') Object.assign(e,{axisAngle:0,retardance:90,referenceWavelength:550});
    if(type==='polarizer') e.axisAngle=0;
    return e;
  }
  function createDefault() {
    const plane=(type,x,id,name)=>({...createElement(type,x),id,name});
    const object=plane('object',0,'o1','字母 F');
    object.map=makeMap('letter');
    const screen={...plane('screen',320,'s1','像面相机'),aperture:4};
    return {name:'4f 中继 · 字母 F',source:{...sourceDefaults},elements:[object,plane('thinLens',80,'l1','物镜 L₁'),
      {...plane('probe',160,'fourier','公共焦面'),focusOf:'l1'},plane('thinLens',240,'l2','物镜 L₂'),screen],
      settings:{...settingsDefaults,plane:screen.id,side:'after'}};
  }
  function focalPlanes(lens,wavelength) {
    if(!lens || elementStatus(lens).state==='blocked')return null;
    if(lens.type==='thinLens')return {front:lens.x-lens.focalLength,back:lens.x+lens.focalLength};
    if(lens.type!=='lens')return null;
    const m=optics.lensParaxial(lens,wavelength);
    if(!m.valid || !Number.isFinite(m.frontFocalX) || !Number.isFinite(m.backFocalX))return null;
    return {front:lens.x+m.frontFocalX,back:lens.x+m.backFocalX};
  }
  function updateFocalProbes(scene) {
    for(const p of scene.elements.filter(e=>e.type==='probe' && e.focusOf)) {
      const lens=scene.elements.find(e=>e.id===p.focusOf), wavelength=scene.source.wavelength;
      const f=focalPlanes(lens,wavelength);
      if(!f || f.back<scene.source.x || Math.abs(f.back)>10000) {
        delete p.focusOf;p.name='固定观察截面';continue;
      }
      const next=scene.elements.filter(e=>['lens','thinLens'].includes(e.type)&&e.x>lens.x).sort((a,b)=>a.x-b.x)[0];
      const other=focalPlanes(next,wavelength);
      const common=other && Math.abs(other.front-f.back)<1e-6*Math.max(1,Math.abs(f.back-lens.x));
      p.x=f.back;p.name=common?'公共焦面':(lens.name.slice(0,70)+' 后焦面');
    }
  }

  function validateSource(s) {
    check(s&&['collimated','point','field'].includes(s.type),'未知的光源类型。');
    check([s.x,s.y??0,s.z??0].every(v=>numberIn(v,-10000,10000))&&numberIn(s.angle??0,-360,360),'光源位置或角度无效。');
    check(numberIn(s.width,s.type==='collimated'?0.000001:0,10000)&&numberIn(s.height,0,10000)&&numberIn(s.spread,0,89),'光束宽度、视场或发散角无效。');
    check(['mono','rgb','band'].includes(s.spectrum)&&numberIn(s.wavelength,380,780)&&numberIn(s.bandwidth,0,400),'光源波长或光谱范围无效。');
    check(['unpolarized','linear','left','right','elliptical'].includes(s.polarization)&&numberIn(s.polDegree,0,1)&&
      numberIn(s.ellipticity,-45,45)&&numberIn(s.polAngle,-360,360),'光源偏振参数无效。');
  }
  function validateElement(e,ids) {
    check(e&&validId(e.id)&&!ids.has(e.id),'每个器件需要独立编号。');
    ids.add(e.id);
    check(typeof e.name==='string'&&e.name.length<=80 && (e.group==null || (typeof e.group==='string'&&e.group.length<=24)),'器件名或组名无效。');
    check([e.x,e.y??0,e.z??0].every(v=>numberIn(v,-10000,10000))&&numberIn(e.angle??0,-360,360),'器件位置超出范围。');
    check(numberIn(e.aperture,0.000001,10000),'口径必须是正数。');
    check(Object.hasOwn(names,e.type)||['lens','mirror','grating'].includes(e.type),'未知的器件类型。');
    if(e.type==='lens') {
      const error=optics.validateLens(e);
      check(!error,error);
    }
    if(e.type==='thinLens') check(numberIn(e.focalLength,-1e6,1e6)&&Math.abs(e.focalLength)>1e-6,'薄透镜焦距无效。');
    if(e.type==='phase') check(numberIn(e.opd,-1e10,1e10),'移相片光程差无效。');
    if(e.type==='stop') check(numberIn(e.outerDiameter,e.aperture,20000),'光阑外径必须大于或等于通光直径。');
    if(['polarizer','retarder'].includes(e.type)) check(numberIn(e.axisAngle??0,-360,360),'偏振轴角无效。');
    if(e.type==='retarder') check(numberIn(e.retardance??90,-3600,3600)&&numberIn(e.referenceWavelength??550,380,780),'波片延迟或设计波长无效。');
    if(e.type==='object') {
      validMap(e.map);
      check(numberIn(e.n??1,1,4)&&numberIn(e.thickness??0,0,1000)&&numberIn(e.wedge??0,-89,89),'物体材料参数无效。');
    }
  }
  function validateWave(scene) {
    check(scene&&Array.isArray(scene.elements)&&scene.elements.length<=32,'二维实验最多容纳 32 个器件。');
    check(typeof scene.name==='string'&&scene.name.length<=120,'实验名称最长 120 个字符。');
    validateSource(scene.source);
    const ids=new Set(['source']);
    let mapCells=0;
    for(const e of scene.elements) {
      if(e?.type==='object') {
        mapCells+=(e.map?.size??0)**2;
        check(mapCells<=262144,'所有物体绘图合计最多 262144 个材料格。');
      }
      validateElement(e,ids);
    }
    const s=scene.settings;
    check(s&&sampling.includes(s.n)&&numberIn(s.width,0.000001,100000),'计算网格或输入视场无效。');
    check((s.outputWidth===undefined||numberIn(s.outputWidth,0,10000)) &&
      (s.referenceOPD===undefined||numberIn(s.referenceOPD,-1e7,1e7)),'观察视场或参考光程差超出范围。');
    check(ids.has(s.plane)&&['before','after'].includes(s.side),'请选择实际存在的观察面。');
    check(['y','z'].includes(s.phaseAxis)&&Number.isInteger(s.mode)&&s.mode>=0&&s.mode<3&&Number.isInteger(s.phaseLine)&&
      s.phaseLine>=0&&s.phaseLine<5&&typeof s.throughOnly==='boolean','观察模式或相位设置无效。');
    if(scene.origin!=null) validateAdvanced(scene.origin);
  }
  function validateAdvanced(pkg) {
    check(pkg?.format===advancedFormat&&pkg.version===1,'源快照格式无效。');
    const old=pkg.scene;
    check(old?.source&&Array.isArray(old.elements)&&old.elements.length<=24,'进阶实验结构无效。');
    const ids=new Set(['source']);
    for(const e of old.elements) {
      check(e&&validId(e.id)&&!ids.has(e.id),'进阶器件编号无效。');
      ids.add(e.id);
    }
    const errors=optics.validateScene(old);
    check(!errors.length,errors[0]);
  }
  function fromAdvanced(pkg) {
    validateAdvanced(pkg);
    const old=pkg.scene;
    const source={...sourceDefaults,width:20,height:0,spread:5,bandwidth:0,polarization:'unpolarized',ellipticity:22.5,...old.source};
    const elements=old.elements.map(original=>{
      const e={y:0,z:0,angle:0,name:names[original.type]??original.id,...copy(original)};
      if(e.type==='stop'&&e.outerDiameter==null) e.outerDiameter=Math.max(e.aperture+40,100);
      if(['polarizer','retarder'].includes(e.type)) e.axisAngle??=0;
      if(e.type==='retarder') {e.retardance??=90;e.referenceWavelength??=550;}
      if(e.type!=='object') return e;
      const size=33, map=makeMap('blank',size,e.aperture,e.aperture);
      for(let column=0;column<size;column++) {
        const f=optics.cellFractions(e,column);
        for(let row=0;row<size;row++) {
          const index=row*size+column;
          map.t[index]=f.transmission; map.r[index]=f.reflection; map.s[index]=f.scatter;
        }
      }
      e.map=map;
      return e;
    });
    const screen=elements.filter(e=>e.type==='screen').at(-1);
    const plane=screen?.id??elements.at(-1)?.id??'source';
    const width=Math.max(source.type==='collimated'?source.width:source.height,1);
    const scene={name:old.name??'进阶光路 · 二维实验',source:copy(source),elements,
      settings:{...settingsDefaults,width:Math.max(1,width+2*Math.abs(source.y))*1.5,plane,side:screen?'after':'before'},origin:copy(pkg)};
    validateWave(scene);
    return scene;
  }
  function fromPackage(pkg) {
    check(pkg&&pkg.version===1,'不支持的实验文件版本。');
    if(pkg.format===advancedFormat) return fromAdvanced(pkg);
    check(pkg.format===waveFormat,'请选择二维或进阶工作站的实验文件。');
    validateWave(pkg.scene);
    return copy(pkg.scene);
  }
  function exportPackage(scene) {
    validateWave(scene);
    return {format:waveFormat,version:1,scene:copy(scene)};
  }
  return {fromPackage,exportPackage,createDefault,createElement,makeMap,wavelengths,elementStatus,focalPlanes,updateFocalProbes,validate:validateWave};
});
