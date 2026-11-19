/* Live analysis for the meridional workstation. The geometry and event history
   come from AdvancedOptics.simulate; readouts never re-trace model surfaces. */
(function (root) {
  'use strict';
  const views = new WeakMap();
  const tabs = { object: '物体成像', ray: '逐面追迹', cardinal: '近轴基准', detector: '探测屏', aberration: '像差与色散' };
  const objectModes = {scatter:'透射散射', reflect:'镜面反射', refract:'双界面折射', mixed:'混合物体'};
  const kinds = { scatter:'散射', absorb:'吸收', refract: '折射', reflect: '反射', tir: '全内反射', diffract: '衍射', blocked: '遮挡', pass: '通过', detect: '探测', evanescent: '无传播级次' };
  const statuses = { escaped: '已离开系统', blocked: '已遮挡', detected: '已探测', evanescent: '无传播级次', limit: '到达追迹上限' };
  const surfaceNames = { S1: '前面 S1', S2: '后面 S2', rim: '实体边缘', plane: '器件面' };
  const finite = Number.isFinite;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[ch]);

  function num(value, decimals = 3) {
    if (!finite(value)) return '—';
    if (value === 0 || Math.abs(value) < 1e-12) return '0';
    if (Math.abs(value) > 1e6 || Math.abs(value) < 10 ** -decimals * 0.5) return value.toExponential(2).replace('-','−');
    return String(Number(value.toFixed(decimals))).replace('-','−');
  }
  function unit(value, suffix, digits) {
    return finite(value) ? num(value, digits) + ' ' + suffix : '—';
  }
  function scalar(value, suffix = 'mm') { return unit(value, suffix); }
  function fluxNumber(value,digits=6) {
    if(value!==0 && finite(value) && Math.abs(value)<10**(-digits)) return value.toExponential(2).replace('e-','e−');
    return num(value,digits);
  }
  function share(value,total) {
    return total>0 ? fluxNumber(value/total*100,3)+'%' : '—';
  }
  function mean(values) {
    return values.length ? values.reduce((sum,value) => sum + value, 0) / values.length : null;
  }
  const sampleWeight = hit => finite(hit.weight) ? Math.max(0,hit.weight) : 1;
  const summedWeight = hits => hits.reduce((sum,hit)=>sum + sampleWeight(hit),0);
  function statistics(hits) {
    const samples = hits.filter(hit => finite(hit.y) && sampleWeight(hit) > 0);
    const weight = summedWeight(samples);
    if (!weight) return { count:0, weight:0, center:null, rms:null, span:null };
    const center = samples.reduce((sum,hit)=>sum + hit.y * sampleWeight(hit),0)/weight;
    const variance = samples.reduce((sum,hit)=>sum + (hit.y-center)**2 * sampleWeight(hit),0)/weight;
    const values = samples.map(hit=>hit.y);
    return { count:samples.length, weight, center, rms:Math.sqrt(variance), span:Math.max(...values)-Math.min(...values) };
  }
  function spectralColor(wavelength) {
    // This scale distinguishes traces. Detector values are geometric coordinates.
    const hue = Math.max(0,Math.min(275,(680 - wavelength) / 260 * 275));
    return 'hsl(' + hue.toFixed(1) + ' 58% 42%)';
  }
  function bandDot(wavelength) {
    return '<i class="awi-dot" aria-hidden="true" style="background:' + spectralColor(wavelength) + '"></i>';
  }
  function option(value,label,selected) {
    return '<option value="'+esc(value)+'"'+(String(value)===String(selected)?' selected':'')+'>'+esc(label)+'</option>';
  }
  function pick(control,label,options) {
    return '<label class="awi-picker"><span>'+esc(label)+'</span><select data-awi-select="'+control+'">'+options+'</select></label>';
  }
  function metric(label,value,note = '') {
    return '<div class="awi-metric"><span>'+esc(label)+'</span><strong>'+esc(value)+'</strong>'+(note?'<small>'+esc(note)+'</small>':'')+'</div>';
  }
  function matrixMarkup(matrix) {
    return '<div class="awi-matrix" aria-label="ABCD 矩阵">'+['A','B','C','D'].map(key => '<div><span>'+key+'</span> '+num(matrix?.[key],key==='C'?6:4)+'</div>').join('')+'</div>';
  }
  function formulaRows(rows) {
    return '<dl class="awi-equations">'+rows.map(([label,value])=>'<div><dt>'+esc(label)+'</dt><dd>'+esc(value)+'</dd></div>').join('')+'</dl>';
  }
  function details(title,body) {
    return '<details class="awi-details"><summary>'+esc(title)+'</summary>'+body+'</details>';
  }
  function table(headers,rows) {
    return '<div class="awi-table-scroll"><table class="awi-table"><thead><tr>'+headers.map(h=>'<th scope="col">'+esc(h)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map(cell=>'<td>'+esc(cell)+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
  }
  function empty(message) { return '<p class="awi-empty">'+esc(message)+'</p>'; }
  function nameOf(scene,id) { return scene.elements.find(e=>e.id===id)?.name || String(id); }
  function vector(v) { return v ? '('+num(v.x,5)+', '+num(v.y,5)+')' : '—'; }
  function fieldLabel(scene,field) {
    return scene.source.type==='field' ? '物点 '+num(field)+' mm' : scene.source.type==='collimated' ? '平行束' : '点光源';
  }
  function collectFields(scene,rays) {
    const values = [...new Set(rays.map(ray=>ray.field).filter(finite))].sort((a,b)=>a-b);
    return values.length ? values : [0];
  }
  const scatterModels = {mie:'Lorenz–Mie 球散射', hg:'Henyey–Greenstein 相函数', diffuse:'入射侧余弦漫反射'};
  const materialChannels = [
    {key:'scatter',label:'散射'}, {key:'reflection',label:'镜面反射'},
    {key:'transmission',label:'透明介质'}, {key:'absorption',label:'吸收'}
  ];
  function scatteringRows(object,event) {
    const model=event.scatterModel ?? object.scatterModel;
    const phase=model==='mie' || model==='hg';
    const azimuth=event.outAngle-event.inAngle;
    const deflection=((azimuth+540)%360)-180;
    const rows=[['相对入射方向的散射角 θ', unit(Math.abs(deflection),'°')+'（前向 0°，后向 180°）']];
    if (phase) {
      rows.push(['相函数',scatterModels[model]]);
      if(event.scatterSide) rows.push(['本散射分支走向',event.scatterSide==='opposite'?'穿过物面，进入另一侧介质':'位于入射侧，仍在原介质中传播']);
      if(model==='mie'){
        const diameter=object.mieDiameter, x=Math.PI*event.n1*diameter/(event.wavelength*0.001);
        rows.push(['球直径 d · 粒子折射率',unit(diameter,'μm')+' · '+num(object.mieIndex,5)],
          ['尺寸参数 x = π n₁ d / λ₀',num(x,5)+'　·　真空波长 '+unit(event.wavelength,'nm')+'，入射侧折射率 '+num(event.n1,5)]);
      }else rows.push(['HG 各向异性参数 g', num(object.scatterG,4)]);
    } else {
      const incidentSide=object.interaction==='mixed';
      rows.push(['散射模型',incidentSide?scatterModels.diffuse:'透射侧余弦散射'],
        ['相对'+(incidentSide?'入射侧':'透射侧')+'法线的偏角',unit(event.scatterOffset,'°')]);
    }
    rows.push(['角域半角',unit(object.scatterAngle,'°')]);
    if(event.secondaryScatter) rows.push(['重复命中时的方向采样','从所选角分布取一个方向，本次散射权重全部随该分支继续传播。']);
    else rows.push(['此方向采样所占散射功率',share(event.scatterFraction,1)]);
    return rows;
  }
  function eventDetails(scene, ray, event) {
    const lens = scene.elements.find(e=>e.id===event.elementId);
    const angle = value => unit(value,'°',3);
    const rows = [
      ['交点 P · 全局 (x, y)', '('+num(event.x)+', '+num(event.y)+') mm'],
      ['器件局部截高 h',scalar(event.localY)],
      ['入射方向 αin → 出射方向 αout',angle(event.inAngle)+' → '+angle(event.outAngle)],
      ['入射单位向量 i',vector(event.inDirection)],
      ['单位法线 N（朝向入射侧）',vector(event.normal)]
    ];
    if (event.outDirection) rows.push(['出射单位向量 o',vector(event.outDirection)]);
    if (lens?.type==='object') {
      rows.push(['物面作用',objectModes[lens.interaction]]);
      if (Number.isInteger(event.patternIndex)) {
        if(lens.interaction==='mixed'){
          const fractions=event.cellFractions ?? root.AdvancedOptics.cellFractions(lens,event.patternIndex);
          rows.push(['物面采样格',String(event.patternIndex+1)+' / 33'],
            ['本格材质份额',materialChannels.map(({key,label})=>label+' '+share(fractions[key],1)).join(' · ')]);
        }else rows.push(['物面采样格 · 灰度',(event.patternIndex+1)+' / '+lens.pattern.length+'　·　'+num(event.patternValue,4)]);
      }
      if(event.energy){
        const {incident,absorbed,scattered,reflected,transmitted}=event.energy;
        rows.push(['此界面入射 / 吸收',fluxNumber(incident)+' / '+fluxNumber(absorbed)]);
        rows.push(['同一交点的散射 / 镜面反射 / 透射', [scattered,reflected,transmitted].map(value=>fluxNumber(value)).join(' / ')]);
      }
      if(finite(event.fresnel))rows.push(['非偏振界面功率反射率 F',share(event.fresnel,1)]);
      if(event.mieMatched)rows.push(['粒子与入射介质折射率匹配','球散射功率为零，本格的散射份额并入透明介质通道，经界面反射和透射分配。']);
      if(event.kind==='scatter')rows.push(...scatteringRows(lens,event));
      if((lens.interaction==='refract' || lens.interaction==='mixed') && event.surface==='S2'){
        rows.push(['后面交点的局部轴向坐标 x = t + h tan β',scalar(lens.thickness+event.localY*Math.tan(lens.wedge*Math.PI/180))+'　·　β = '+angle(lens.wedge)]);
      }
    }
    if(scene.elements.some(e=>e.type==='object') && finite(event.weightIn)){
      if(event.kind==='detect')rows.push(['屏面接收的相对权重',num(event.weightIn,6)]);
      else rows.push(['交点入射权重 → 当前路径出射权重',num(event.weightIn,6)+' → '+num(event.weightOut,6)]);
    }
    if (event.kind==='refract' || event.kind==='tir') {
      rows.push(['波长 λ · 折射率 n₁ → n₂',num(ray.wavelength,2)+' nm · '+num(event.n1,6)+' → '+num(event.n2,6)]);
      rows.push(['入射角 i（与法线夹角）',angle(event.incidence)]);
      const sine = Math.sin(event.incidence * Math.PI / 180);
      if (event.kind==='refract') {
        rows.push(['n₁ sin(i) = n₂ sin(r)',num(event.n1,5)+' × sin('+num(event.incidence)+'°) = '+num(event.n1*sine,6)]);
        rows.push(['r = asin[(n₁/n₂) sin(i)]',angle(event.emergence)]);
      } else {
        rows.push(['临界角 ic = asin(n₂/n₁)',angle(Math.asin(event.n2/event.n1)*180/Math.PI)]);
        rows.push(['全内反射 · r = i',angle(event.emergence)]);
      }
      if (lens?.type==='lens' && (event.surface==='S1'||event.surface==='S2')) {
        const j = event.surface==='S1'?1:2;
        const radius = lens['r'+j], conic = lens['k'+j]??0, a4 = lens['a4'+j]??0;
        const curvature = radius ? 1/radius : 0;
        const h = event.localY;
        const radical = 1 - (1 + conic) * (curvature*h)**2;
        if (finite(h) && radical>=0) {
          const sag = curvature*h*h/(1+Math.sqrt(radical)) + a4*h**4;
          rows.push(['面矢高 z = ch² / [1 + √(1 − (1+k)c²h²)] + A₄h⁴',scalar(sag)+'，c = '+num(curvature,6)+' mm⁻¹，k = '+num(conic)+'，A₄ = '+num(a4,9)+' mm⁻³']);
        }
      }
    }
    if (event.kind==='reflect') {
      rows.push(['镜面反射 · o = i − 2(i·N)N','入射 '+angle(event.incidence)+'，反射 '+angle(event.emergence)]);
    }
    if ((event.kind==='diffract' || event.kind==='evanescent') && lens) {
      const alpha = (lens.angle || 0)*Math.PI/180;
      const incoming = event.inAngle*Math.PI/180;
      const tangential = Math.sin(incoming-alpha);
      const increment = (lens.order || 0) * ray.wavelength * 1e-6 * lens.lines / event.n1;
      rows.push(['光栅周期 d = 1 / 线密度',unit(1/lens.lines,'mm',7)+'（'+num(1000/lens.lines,4)+' μm）']);
      rows.push(['栅面切向分量 s出 = s入 + mλ₀/(nd)，n = '+num(event.n1,5),num(tangential,6)+' + ('+num(increment,6)+') = '+num(tangential+increment,6)]);
      rows.push(['传播条件 |sout| ≤ 1',event.kind==='evanescent'?'超出范围，该级次无传播光线':'m = '+num(lens.order)+'，出射方向 '+angle(event.outAngle)]);
    }
    if (event.kind==='pass' || event.kind==='blocked') {
      if(lens && lens.type!=='object' && event.surface!=='rim') rows.push(['孔径判定 · |h| 与 D/2',scalar(Math.abs(event.localY))+' / '+scalar(lens.aperture/2)]);
      rows.push(['追迹结果',event.kind==='pass'?'透过通光区域，传播方向延续。':'光线到此终止。']);
    }
    if (event.kind==='detect') rows.push(['探测记录 · 屏面局部坐标',scalar(event.localY)+'，波长 '+num(ray.wavelength)+' nm']);
    if(finite(event.stepLength)) rows.push(['上一交点至此的几何路程 Δs',scalar(event.stepLength)]);
    if(finite(event.opl)) rows.push(['累计光程 OPL = Σ nⱼ Δsⱼ',scalar(event.opl)]);
    return formulaRows(rows);
  }

  function rayPanel(opts) {
    const {scene,result} = opts;
    const rays = result.rays || [];
    if (!rays.length) return empty('当前布置没有可追迹的光线。');
    const index = Math.min(rays.length-1, Math.max(0,Math.trunc(opts.selectedRayIndex)||0));
    const ray = rays[index];
    const events = ray.events || [];
    const step = Math.min(events.length-1, Math.max(0,Math.trunc(opts.selectedStepIndex)||0));
    let rayPicker;
    if(rays.length>150) {
      rayPicker='<label class="awi-picker"><span>路径编号</span><input type="number" min="1" max="'+rays.length+'" step="1" data-awi-select="rayNumber" value="'+(index+1)+'"><span>/ '+rays.length+'</span></label>';
    } else {
      const choices = rays.map((r,i)=>option(i,'#'+(i+1)+' · '+num(r.wavelength,2)+' nm · '+fieldLabel(scene,r.field)+' · ρ '+num(r.pupil,2),index)).join('');
      rayPicker=pick('ray','追迹光线',choices);
    }
    const lastEvent=events.at(-1);
    let statusText=statuses[ray.status] || ray.status;
    if(lastEvent?.kind==='absorb'||(ray.status==='blocked' && lastEvent?.patternValue===0))statusText='图案已吸收';
    if(ray.limitReason==='branch')statusText='分支余量计入未追完';
    let html = '<div class="awi-toolbar">'+rayPicker+'<span class="awi-state">'+esc(statusText)+'</span></div>';
    if(scene.elements.some(e=>e.type==='object') && Number.isInteger(ray.sourceId)){
      html+='<p class="awi-note awi-path-source">源样本 #'+(ray.sourceId+1)+' · '+num(ray.wavelength,2)+' nm · '+esc(fieldLabel(scene,ray.field))+' · 终点权重 '+num(ray.weight,6)+'</p>';
    }
    if (!events.length) return html+empty('这条光线未命中任何器件。检查光源方向和器件位置，或选择另一条光线。');
    html += '<div class="awi-step-layout"><div class="awi-steps" aria-label="光线经过的界面">';
    events.forEach((event,i)=>{
      html += '<button type="button" class="awi-step'+(i===step?' is-active':'')+'" data-awi-step="'+i+'" aria-pressed="'+(i===step)+'"><span class="awi-index">'+String(i+1).padStart(2,'0')+'</span><span><strong>'+esc(nameOf(scene,event.elementId))+' · '+esc(surfaceNames[event.surface]||event.surface)+'</strong><small>'+esc(kinds[event.kind]||event.kind)+'　'+unit(event.inAngle,'°')+' → '+unit(event.outAngle,'°')+'</small></span></button>';
    });
    const event = events[step];
    html += '</div><div class="awi-step-body"><div class="awi-content-title"><h4>'+esc(nameOf(scene,event.elementId))+' · '+esc(surfaceNames[event.surface]||event.surface)+'</h4><span>'+esc(kinds[event.kind]||event.kind)+'</span></div>'+eventDetails(scene,ray,event)+'</div></div>';
    return html+'<p class="awi-note">方向角从全局 +x 逆时针量取。入射角和折、反射角相对于界面法线量取。ρ 是光源光束或角锥的归一化采样位置。</p>';
  }

  function cardinalPanel(opts,view) {
    const {scene,result} = opts;
    const records = result.byWavelength || [];
    const wave = byChoice(records, view.cardinalLambda) || result.paraxial;
    const ref = wave?.wavelength ?? scene.source.wavelength;
    const fieldOpt = records.map(item=>option(item.wavelength,num(item.wavelength,2)+' nm',ref)).join('');
    let html = '<div class="awi-toolbar">'+(records.length?pick('cardinalLambda','参考波长',fieldOpt):'')+'<span class="awi-note">正方向沿系统 +x，长度单位 mm。</span></div>';
    if (!wave?.valid) {
      html += empty(wave?.reason || '当前光轴布置不满足同轴折射系统的近轴基准条件。');
    } else {
      const fflSigned = finite(wave.frontFocalX) && finite(wave.firstX) ? wave.frontFocalX-wave.firstX : null;
      html += '<div class="awi-metrics">'+
        metric('系统有效焦距 EFL',finite(wave.efl)?scalar(wave.efl):'∞','从像方主面量取')+
        metric('后焦截距 BFL',scalar(wave.bfl),'从最后面顶点至后焦点')+
        metric('前焦截距 FFL（有符号）',scalar(fflSigned),'从首面顶点至前焦点')+
        metric('近轴像面 x′',scalar(wave.imageX),finite(wave.magnification)?'横向倍率 '+num(wave.magnification,5)+' ×':'')+'</div>';
      html += '<div class="awi-cardinal-body"><div><h4>顶点到顶点的传递矩阵</h4>'+matrixMarkup(wave.matrix)+'<p class="awi-note">A、D 无量纲，B 以 mm 计，C 以 mm⁻¹ 计。</p></div>'+
        table(['基准面 / 焦点','物方 x / mm','像方 x / mm'],[['镜片组顶点',num(wave.firstX),num(wave.lastX)],['主面 H，H′',num(wave.h1X),num(wave.h2X)],['焦点 F，F′',num(wave.frontFocalX),num(wave.backFocalX)]])+'</div>';
      const C=wave.matrix?.C;
      html += details('展开顶点、主面与焦点的换算',formulaRows([
        ['EFL = −1/C',finite(C)&&Math.abs(C)>1e-14?scalar(wave.efl):'无焦系统'],
        ['BFL = −A/C，FFL(有符号) = D/C',scalar(wave.bfl)+'，'+scalar(fflSigned)],
        ['xH = xF + EFL，xH′ = xF′ − EFL',scalar(wave.h1X)+'，'+scalar(wave.h2X)],
        ['矩阵适用条件','两侧介质为空气，光线在共轴系统内作一阶近似。']
      ]));
    }
    const locals = result.lensMetrics || [];
    if(locals.length) html += '<h4 class="awi-subtitle">各镜片的近轴基准</h4><p class="awi-note">波长 '+num(locals[0].wavelength??scene.source.wavelength)+' nm。每片沿自己的局部轴量取，前顶点为 0。</p>'+table(['镜片','EFL / mm','BFL / mm','H / mm','H′ / mm'],locals.map(l=>[nameOf(scene,l.id),num(l.efl),num(l.bfl),num(l.h1X),num(l.h2X)]));
    return html;
  }
  function byChoice(rows,value) {
    return rows.find(row=>String(row.wavelength)===String(value)) || rows[Math.floor(rows.length/2)];
  }
  function detectorContext(scene,result,view) {
    const screens=result.detectors || [];
    const detector=screens.find(d=>String(d.id)===String(view.screen)) || screens[0];
    const fields=collectFields(scene,result.rays||[]);
    const field=fields.find(f=>String(f)===String(view.field)) ?? fields.reduce((best,f)=>Math.abs(f)<Math.abs(best)?f:best,fields[0]);
    const waveValues=result.wavelengths || [];
    const wavelength=waveValues.find(w=>String(w)===String(view.wavelength)) ?? 'all';
    const hits=detector?.hits || [];
    const fieldHits=hits.filter(hit=>hit.field===field);
    const spectralHits=hits.filter(hit=>wavelength==='all'||hit.wavelength===wavelength);
    const selectedHits=fieldHits.filter(hit=>wavelength==='all'||hit.wavelength===wavelength);
    return {screens,detector,fields,field,waveValues,wavelength,hits,fieldHits,spectralHits,selectedHits};
  }
  function detectorPickers(scene,context,showSpectrum=true) {
    const {screens,detector,fields,field,waveValues,wavelength}=context;
    const screensList=screens.map(d=>option(d.id,nameOf(scene,d.id),detector.id)).join('');
    let controls=pick('screen','探测屏',screensList);
    if(fields.length>1)controls+=pick('field','场点',fields.map(f=>option(f,fieldLabel(scene,f),field)).join(''));
    if(showSpectrum && waveValues.length>1)controls+=pick('wavelength','谱线',option('all','所有谱线',wavelength)+waveValues.map(w=>option(w,num(w,2)+' nm',wavelength)).join(''));
    return '<div class="awi-toolbar">'+controls+'</div>';
  }
  function histograms(hits,selectedWaves,weighted) {
    let min=Math.min(...hits.map(h=>h.y)), max=Math.max(...hits.map(h=>h.y));
    // A finite interval is needed to display perfectly coincident hits.
    const padding=Math.max((max-min)*.05,Math.abs(max)*1e-7,.001);
    min-=padding;max+=padding;
    const bucketCount=40;
    const data=selectedWaves.map(w=>{
      const counts=Array(bucketCount).fill(0);
      hits.filter(h=>h.wavelength===w).forEach(h=>{
        const b=Math.max(0,Math.min(bucketCount-1,Math.floor((h.y-min)/(max-min)*bucketCount)));
        counts[b]+=weighted?sampleWeight(h):1;
      });
      return {w,counts};
    });
    const maxCount=Math.max(...data.flatMap(group=>group.counts)) || 1;
    const bands=data.map(({w,counts})=>'<div class="awi-hist-row"><span>'+bandDot(w)+num(w,1)+' nm</span><div class="awi-bars">'+counts.map((n,i)=>'<i title="'+num(min+i/bucketCount*(max-min))+' 至 '+num(min+(i+1)/bucketCount*(max-min))+' mm · '+num(n,5)+(weighted?' 相对通量':' 条')+'" style="height:'+100*n/maxCount+'%;background:'+spectralColor(w)+'"></i>').join('')+'</div></div>').join('');
    return '<figure class="awi-hist"><figcaption>屏面命中分布 <small>'+(weighted?'相对通量':'条数')+' / 分箱 · 各谱线共用尺度</small></figcaption>'+bands+'<div class="awi-hist-axis"><span>'+num(min,4)+'</span><span>屏面局部坐标 u / mm</span><span>'+num(max,4)+'</span></div></figure>';
  }
  function fieldMapGraphic(mapping,selectedField) {
    // Draw both local transverse coordinates with the same origin and scale.
    const levels=[0,...mapping.map(row=>row.f)];
    for(const row of mapping){
      if(row.count)levels.push(row.center-row.rms,row.center+row.rms);
    }
    const extent=Math.max(.001,...levels.map(Math.abs));
    const zero=81, y=value=>zero-51*value/extent;
    const palette=['#a55f38','#498c72','#6671ac'];
    let lines='',markers='';
    mapping.forEach((row,i)=>{
      const color=palette[i%palette.length], sy=y(row.f), active=row.f===selectedField;
      if(row.count) {
        const ey=y(row.center),upper=y(row.center+row.rms),lower=y(row.center-row.rms);
        lines+='<path d="M 82 '+sy+' L 278 '+ey+'" fill="none" stroke="'+color+'" stroke-width="'+(active?1.8:1.1)+'" opacity=".7"/>';
        markers+='<path d="M 291 '+upper+' V '+lower+' M 287 '+upper+' H 295 M 287 '+lower+' H 295" fill="none" stroke="'+color+'" stroke-width="1.4"/>'+
          '<circle cx="278" cy="'+ey+'" r="3.5" fill="'+color+'"/>';
      }
      markers+='<circle cx="82" cy="'+sy+'" r="3.5" fill="'+color+'"/><text x="72" y="'+(sy+3)+'" text-anchor="end">'+num(row.f,3)+'</text>';
    });
    // Source labels may be tightly spaced when a detector is far from focus.
    // Keep these heights in the numeric table instead of overlapping labels.
    if(mapping.some((row,i)=>i>0 && Math.abs(y(row.f)-y(mapping[i-1].f))<12)){
      markers=markers.replace(/<text[^>]*>[^<]*<\/text>/g,'');
    }
    return '<figure class="awi-field-map"><figcaption>场点与屏面质心 <small>同一长度比例 · 竖线段为质心 ±1σ</small></figcaption>'+
      '<svg viewBox="0 0 360 146" role="img" aria-label="物面三点和屏面质心的位置对应图，同一场点以同色线连接。">'+
      '<text x="82" y="13" text-anchor="middle">物面 h / mm</text><text x="278" y="13" text-anchor="middle">屏面 u / mm</text>'+
      '<path d="M 82 22 V 140 M 278 22 V 140" stroke="#b4c7b1" fill="none"/><path d="M 82 '+zero+' H 278" stroke="#c2cdbd" stroke-dasharray="3 4" fill="none"/>'+
      lines+markers+'</svg></figure>';
  }
  function fieldMapping(scene,context) {
    const {fields,spectralHits,detector}=context;
    if(scene.source.type!=='field'||fields.length<2)return '';
    const mapping=fields.map(f=>({f,...statistics(spectralHits.filter(hit=>hit.field===f))}));
    const first=mapping[0],last=mapping.at(-1);
    let summary='端点均命中探测屏时显示质心跨度与局部横向倍率。';
    if(finite(first.center)&&finite(last.center)&&last.f!==first.f){
      const span=last.center-first.center, ratio=span/(last.f-first.f);
      summary='首末物点相距 '+scalar(last.f-first.f)+'，在该屏的质心间距为 '+scalar(Math.abs(span))+'。局部坐标倍率 Δu/Δh = '+num(ratio,4)+' ×'+(Math.abs(ratio)<1e-8?'。':ratio<0?'，场点顺序反向。':'，场点顺序同向。');
    }
    return '<h4 class="awi-subtitle">各物点在'+esc(nameOf(scene,detector.id))+'的映射</h4>'+fieldMapGraphic(mapping,context.field)+table(['源局部 h / mm','屏上质心 u / mm','单场点 RMS / mm','命中'],mapping.map(group=>[num(group.f),num(group.center,5),num(group.rms,5),String(group.count)]))+'<p class="awi-note">'+esc(summary)+' 屏面离焦、倾斜和截光均会影响这项读数。</p>';
  }
  function detectorPanel(opts,view) {
    const {scene,result}=opts;
    const context=detectorContext(scene,result,view);
    if(!context.detector)return empty('添加探测屏，并将其放在光路上，即可读取屏面交点。');
    const {selectedHits,field,wavelength,waveValues}=context;
    const stats=statistics(selectedHits);
    const paths=(result.rays||[]).filter(ray=>ray.field===field && (wavelength==='all'||ray.wavelength===wavelength));
    const weighted=scene.elements.some(e=>e.type==='object');
    const launched=weighted ? new Set(paths.map(ray=>ray.sourceId)).size : paths.length;
    let html=detectorPickers(scene,context);
    const countMetric=weighted
      ? metric('到屏通量 / 发射通量',num(stats.weight,4)+' / '+launched,stats.count+' 条命中路径，共 '+paths.length+' 条终止路径')
      : metric('命中 / 发射',stats.count+' / '+launched,fieldLabel(scene,field));
    html+='<div class="awi-metrics">'+countMetric+metric('质心 ū',unit(stats.center,'mm',5))+metric('一维 RMS 半宽 σ',unit(stats.rms,'mm',5))+metric('全宽 umax − umin',unit(stats.span,'mm',5))+'</div>';
    html+=selectedHits.length?histograms(selectedHits,wavelength==='all'?waveValues:[wavelength],weighted):empty('当前场点和波长没有命中记录。可选择其他谱线，或移动探测屏。');
    html+=fieldMapping(scene,context);
    return html+details('屏面读数与采样方式',formulaRows([
      ['探测坐标 u','u = (P − P屏) · t屏，t屏 沿器件局部 +y。'],
      ['样本权重与质心','ū = Σ(wᵢuᵢ) / Σwᵢ。每个源样本初始权重为 1，图案损耗和散射分支改变到屏权重。'],
      ['一维几何 RMS 半宽','σ = √[Σ wᵢ(uᵢ − ū)² / Σwᵢ]。按场点分别统计。'],
      ['采样范围','本图为子午截面，显示几何落点。采样数、孔径与截光都会影响统计量。']
    ]));
  }
  function binSeries(count) { return Array(count).fill(0); }
  function binIndex(position,width,count) {
    return Math.min(count-1,Math.max(0,Math.floor((position/width+.5)*count)));
  }
  function binRange(index,width,count) {
    const start=width*(index/count-.5);
    return num(start,3)+' 至 '+num(start+width/count,3)+' mm';
  }
  function specimenSignals(result,object,wavelength,detector,count) {
    const atWave=sample=>wavelength==='all' || sample.wavelength===wavelength;
    const info=result.objects?.find(o=>o.id===object.id);
    const energy=wavelength==='all'?info:info?.byWavelength.find(atWave);
    const systemEnergy=wavelength==='all'?result.energy:result.energyByWavelength?.find(atWave);
    const seedCount=systemEnergy?.emitted ?? new Set(result.rays.filter(atWave).map(ray=>ray.sourceId)).size;
    const incident=energy?.incident ?? binSeries(count);
    const outgoing=energy?.outgoing ?? binSeries(count);
    const hits=(detector?.hits ?? []).filter(atWave);
    const tagged=[],background=[];
    for(const hit of hits){
      const tags=hit.objectHits ?? result.rays[hit.rayId]?.objectHits ?? [];
      (tags.some(tag=>tag.elementId===object.id)?tagged:background).push(hit);
    }
    return {seedCount,incident,outgoing,tagged,background,flux:binSeries(count),objectEnergy:energy?.energy,systemEnergy};
  }
  function energyAccount(title,referenceLabel,total,entries,note) {
    const accounted=entries.reduce((sum,entry)=>sum+entry.value,0);
    const difference=total-accounted;
    const residual=difference===0?'0':difference.toExponential(2).replace('e-','e−');
    const segments=entries.filter(entry=>entry.value>0 && total>0).map(entry=>
      '<i class="awi-energy-'+entry.key+'" style="width:'+Math.min(100,100*entry.value/total)+'%"></i>').join('');
    const lines=entries.map(entry=>'<tr><th scope="row"><i class="awi-energy-key awi-energy-'+entry.key+'" aria-hidden="true"></i>'+
      entry.label+'</th><td>'+fluxNumber(entry.value)+'</td><td>'+share(entry.value,total)+'</td></tr>').join('');
    return '<section class="awi-energy-account"><h4>'+title+'</h4><div class="awi-energy-total"><span>'+referenceLabel+'</span><strong>'+
      fluxNumber(total)+'</strong></div><div class="awi-energy-bar" aria-hidden="true">'+segments+'</div>'+
      '<table aria-label="'+title+'"><thead><tr><th scope="col">分量</th><th scope="col">相对通量</th><th scope="col">占比</th></tr></thead><tbody>'+
      lines+'</tbody></table><div class="awi-energy-difference"><span>守恒差额</span><output>'+residual+'</output></div><p class="awi-note">'+note+'</p></section>';
  }
  function energyLedger(object,signals) {
    const local=signals.objectEnergy,system=signals.systemEnergy;
    if(!local || !system)return '';
    const localEntries=[
      {key:'scatter',label:'散射',value:local.scattered},
      {key:'reflect',label:'镜面反射',value:local.reflected},
      {key:'transmit',label:'透射',value:local.transmitted},
      {key:'absorb',label:'图案吸收',value:local.absorbed}
    ];
    const systemEntries=[
      {key:'detect',label:'所有屏接收',value:system.detected},
      {key:'escape',label:'离开系统',value:system.escaped},
      {key:'block',label:'截光／无传播级次',value:system.blocked},
      {key:'absorb',label:'图案吸收',value:system.absorbed},
      {key:'pending',label:'未追完',value:system.unresolved}
    ];
    const localNote=(object.interaction==='mixed'?'S1 镜面反射包含界面反射，透射分量沿折射方向传播。':'')+'返回图案面的光在每次到达时重新计入。';
    const scatterModel=object.scatterModel ?? 'diffuse';
    const angularLaw={
      mie:'非偏振光照射均匀透明球，P(θ) ∝ (|S₁(θ)|² + |S₂(θ)|²) / 2。粒径、波长与相对折射率决定角分布。',
      hg:'P(θ) ∝ (1 − g²) / (1 + g² − 2g cos θ)^(3/2)。g 控制前向集中程度。',
      diffuse:'P(δ) ∝ cos δ，δ 从入射侧法线量起。只有正入射时，这个法线方向才对应 180° 后向。'
    }[scatterModel];
    const angularNote=scatterModel==='diffuse'?'散射分支返回入射侧。':'θ 从光的入射传播方向量起，θ = 0° 表示向前。';
    const model=object.interaction==='mixed'?details('物面分光与散射公式',formulaRows([
      ['每格 S + R + T + A = 1','S 为散射，R 为直接镜面反射，T 为透明介质，余量 A = 1 − S − R − T 归入吸收。W 为此次入射功率。'],
      ['非偏振界面反射率  F = (Rₛ + Rₚ) / 2','F 由两侧折射率和入射角决定。全内反射时 F = 1。'],
      ['散射  Wₛ = WS','S 由物格给定，各方向分支的功率合计为 Wₛ。'],
      [scatterModels[scatterModel],angularLaw+' '+angularNote],
      ['角度采样','在指定半角的子午截面内，对 P 按平面角积分并归一。粒子浓度、散射截面与传播厚度不参与本格 S 的计算。'],
      ...(scatterModel==='mie'?[['折射率匹配','当粒子与入射介质折射率相等时，计算中将 T 换为 T + S，并令 S 为 0。']]:[]),
      ['镜面反射  Wᵣ = W(R + TF)','直接反射和透明部分的界面反射沿同一镜面方向传播。'],
      ['折射透射  Wₜ = WT(1 − F)','出射方向满足 n₁ sin θ₁ = n₂ sin θ₂。'],
      ['吸收  Wₐ = WA','W = Wₛ + Wᵣ + Wₜ + Wₐ。']
    ])):'';
    return '<div class="awi-energy-ledger">'+
      energyAccount('物面能量分配','图案面累计入射',local.incident,localEntries,localNote)+
      energyAccount('系统能量收支','光源发射',system.emitted,systemEntries,'含绕过物体的光。未追完表示达到计算限额后剩余的权重。差额为输入减去各分量之和。')+'</div>'+model;
  }
  function specimenProfile(object,incident,outgoing) {
    if(object.interaction==='mixed')return materialProfile(object,incident,outgoing);
    const cells=object.pattern.map((g,i)=>{
      const shade=Math.round(255*g);
      const tip=binRange(i,object.aperture,object.pattern.length)+' · 灰度 '+num(g,3)+' · 入射权重 '+num(incident[i],4)+' · 出射权重 '+num(outgoing[i],4);
      return '<i title="'+esc(tip)+'" style="background:rgb('+[shade,shade,shade].join(',')+')"></i>';
    }).join('');
    const edge=num(object.aperture/2,3);
    return '<figure class="awi-profile"><figcaption>物面图案 <small>黑 0 → 白 1</small></figcaption>'+
      '<div class="awi-profile-strip" role="img" aria-label="'+object.pattern.length+' 格物面灰度">'+cells+'</div>'+
      '<div class="awi-profile-axis"><span>−'+edge+'</span><span>物体局部 h / mm</span><span>+'+edge+'</span></div></figure>';
  }
  function materialProfile(object,incident,outgoing) {
    const cells=incident.map((input,index)=>{
      const fractions=root.AdvancedOptics.cellFractions(object,index);
      const tip=['第 '+(index+1)+' 格 · '+binRange(index,object.aperture,incident.length),
        ...materialChannels.map(({key,label})=>label+' '+share(fractions[key],1)),
        '图案面通量 '+fluxNumber(input)+' → '+fluxNumber(outgoing[index])].join(' · ');
      const stack=materialChannels.map(({key})=>
        '<b class="awi-material-'+key+'" style="height:'+100*fractions[key]+'%"></b>').join('');
      return '<span title="'+esc(tip)+'">'+stack+'</span>';
    });
    const legend=materialChannels.map(({key,label})=>
      '<span><i class="awi-material-'+key+'"></i>'+label+'</span>').join('');
    const edge=num(object.aperture/2,3);
    return '<figure class="awi-profile"><figcaption>物面材质分布 <small>每列一格，色带高度表示该成分的份额</small></figcaption>'+
      '<div class="awi-material-legend">'+legend+'</div><div class="awi-material-profile" role="img" aria-label="33 个物格的散射、镜面反射、透明介质和吸收份额">'+cells.join('')+'</div>'+
      '<div class="awi-profile-axis"><span>−'+edge+'</span><span>物体局部 h / mm</span><span>+'+edge+'</span></div></figure>';
  }
  function screenProfile(screen,signals,view) {
    const bins=signals.flux, count=bins.length;
    for(const hit of signals.tagged)bins[binIndex(hit.y,screen.aperture,count)]+=sampleWeight(hit);
    const peak=Math.max(...bins);
    const fixedExposure=view.exposure!=='peak';
    const exposure=fixedExposure?signals.seedCount/count:peak;
    const values=bins.map(flux=>Math.max(0,Math.min(1,exposure>0?flux/exposure:0)));
    const selected=Math.max(0,Math.min(count-1,view.objectBin??Math.floor(count/2)));
    const cells=values.map((v,i)=>{
      const shade=Math.round(255*v);
      const tip=binRange(i,screen.aperture,count)+' · 权重 '+num(bins[i],5);
      return '<i title="'+esc(tip)+'" style="background:rgb('+[shade,shade,shade].join(',')+')"></i>';
    }).join('');
    const plotWidth=480, plotHeight=44, base=46;
    const points=values.map((v,i)=>{
      const y=base-v*plotHeight;
      return (i*plotWidth/count)+','+y+' '+((i+1)*plotWidth/count)+','+y;
    }).join(' ');
    const current=signals.tagged.filter(hit=>binIndex(hit.y,screen.aperture,count)===selected);
    const strongest=current.reduce((best,hit)=>!best||sampleWeight(hit)>sampleWeight(best)?hit:best,null);
    const cursor=(selected+.5)*plotWidth/count;
    const edge=num(screen.aperture/2,3);
    let html='<figure class="awi-profile awi-screen-profile"><figcaption>屏面实测图案 <small>按到屏权重分为 '+count+' 格</small></figcaption>'+
      '<div class="awi-profile-strip" data-awi-strip="'+count+'" role="img" aria-label="探测屏相对通量灰度带。点击一格或用下方滑块读取通量。">'+cells+'</div>'+
      '<svg viewBox="0 0 480 48" preserveAspectRatio="none" aria-label="屏面相对通量曲线" role="img"><polyline points="'+points+'" fill="none" stroke="#307a5f" stroke-width="1.6" vector-effect="non-scaling-stroke"/>'+
      '<line x1="'+cursor+'" x2="'+cursor+'" y1="1" y2="47" stroke="#9d6a36" stroke-dasharray="3 3" vector-effect="non-scaling-stroke"/></svg>'+
      '<div class="awi-profile-axis"><span>−'+edge+'</span><span>探测屏局部 u / mm</span><span>+'+edge+'</span></div></figure>';
    html+='<div class="awi-bin-controls"><label>检查屏格 <input type="range" data-awi-select="objectBin" min="1" max="'+count+'" value="'+(selected+1)+'"></label>'+
      '<output>第 '+(selected+1)+' 格 · '+binRange(selected,screen.aperture,count)+' · Σw = '+num(bins[selected],5)+' · '+current.length+' 条路径</output>'+
      (strongest?'<button class="awi-sample-link" type="button" data-awi-inspect-ray="'+strongest.rayId+'">跟踪此格光线 ↗</button>':'')+'</div>';
    html+='<p class="awi-note">'+(fixedExposure?'固定参考白值 = 本次筛选的源通量 / 屏格数。超过白值的亮度截为白色。':'白值随当前屏面最亮一格调整。比较图案变暗时可选择固定曝光。')+' 白值 Σw = '+num(exposure,5)+'，峰值 Σw = '+num(peak,5)+'。</p>';
    return html;
  }
  function objectPanel({scene,result},view) {
    const object=scene.elements.find(e=>e.type==='object');
    if(!object)return '';
    const detectors=result.detectors??[],waves=result.wavelengths??[];
    const detector=detectors.find(d=>d.id===view.screen)||detectors[0];
    const screen=scene.elements.find(e=>e.id===detector?.id);
    const wavelength=waves.find(w=>String(w)===view.objectWave)??'all';
    let controls=detector?pick('screen','探测屏',detectors.map(d=>option(d.id,nameOf(scene,d.id),detector.id)).join('')):'';
    if(waves.length>1)controls+=pick('objectWave','谱线',option('all','所有谱线',wavelength)+waves.map(w=>option(w,num(w,2)+' nm',wavelength)).join(''));
    if(detector)controls+=pick('exposure','屏面曝光',option('full','固定参考白值',view.exposure??'full')+option('peak','按峰值显示',view.exposure));
    const signals=specimenSignals(result,object,wavelength,detector,33);
    const incident=signals.incident.reduce((sum,v)=>sum+v,0),outgoing=signals.outgoing.reduce((sum,v)=>sum+v,0);
    const flux=summedWeight(signals.tagged);
    let html='<div class="awi-toolbar">'+controls+'</div>';
    html+='<div class="awi-metrics">'+metric('源发射通量',num(signals.seedCount),'每个初始样本权重 1')+
      metric('图案作用前 → 后',num(incident,3)+' → '+num(outgoing,3),object.interaction==='mixed'?scatterModels[object.scatterModel??'diffuse']:objectModes[object.interaction])+
      metric('物体光到屏',num(flux,5),signals.tagged.length+' 条命中路径')+
      metric('直接光到屏',num(summedWeight(signals.background),5),'未经过图案的通量')+'</div>';
    html+=specimenProfile(object,signals.incident,signals.outgoing);
    if(!screen)return html+energyLedger(object,signals)+empty('添加探测屏并将其放在出射光路上，即可比较物面与屏面图案。');
    html+=screenProfile(screen,signals,view);
    if(!flux) {
      const reason=incident===0?'所选光谱的光线未照到图案面。':outgoing===0?'被照亮的图案格吸收了全部入射权重。':'图案出射光未命中所选探测屏。';
      html+=empty(reason+' 检查光源宽度、物体位置、作用方向和屏的位置。');
    }
    return html+energyLedger(object,signals)+details('坐标与通量',formulaRows([
      ['物面横坐标',object.interaction==='mixed'?'h 沿物体局部 +y。色带表示每格设定的份额，散射、直接反射与透明介质之和以外的份额归入吸收。':'h 沿物体局部 +y。灰度调节该格沿所选方向出射的权重，余量计入吸收。'],
      ['屏面横坐标','u 沿探测屏局部 +y。屏面横轴范围为屏的有效宽度，分箱宽度为 '+scalar(screen.aperture/signals.flux.length)+'。'],
      ['读数','各格通量为同格内所有经过图案并命中该屏的光线权重之和。绕过图案的光在直接光读数中单独统计。'],
      ['采样','各波长、场点与光源采样位置初始权重相同。角度和位置采样越稀，空格与离散条纹越明显。图案作用前后按实际遇到图案面的次数累计。']
    ]));
  }
  function referencePlane(scene,wave,field) {
    if(!wave.valid)return null;
    if(scene.elements.some(e=>e.type==='object'))return wave.imageX;
    if(scene.source.type==='collimated')return wave.backFocalX;
    // Rotation of the source also rotates its field plane; use the actual x
    // of this emitter for its conjugate.
    const alpha=(scene.source.angle||0)*Math.PI/180;
    const objectX=scene.source.x-field*Math.sin(alpha);
    const {A,B,C,D}=wave.matrix, gap=wave.firstX-objectX;
    const denominator=C*gap+D;
    return gap>0 && Math.abs(denominator)>1e-12 ? wave.lastX-(A*gap+B)/denominator : null;
  }
  // For an axial source, compare each wavelength's outermost transmitted
  // meridional sample against its own paraxial conjugate.
  function marginalCrossings(scene,result,field) {
    if(scene.elements.some(e=>e.type==='object'))return [];
    const lenses=scene.elements.filter(e=>e.type==='lens').sort((a,b)=>a.x-b.x);
    if(!lenses.length || !result.paraxial?.valid)return [];
    const last=lenses.at(-1), axisY=last.y || 0;
    const alpha=(scene.source.angle||0)*Math.PI/180;
    const sourceY=scene.source.y + field*Math.cos(alpha);
    const collimated=scene.source.type==='collimated';
    const axial=collimated?Math.cos(alpha)>0 && Math.abs(Math.sin(alpha))<1e-9 && Math.abs(sourceY-axisY)<1e-7:Math.abs(sourceY-axisY)<1e-7;
    if(!axial)return [];
    const records=[];
    for(const wave of result.byWavelength||[]) {
      const reference=referencePlane(scene,wave,field);
      if(!wave.valid||!finite(reference))continue;
      const candidates=[];
      for(const ray of result.rays) {
        if(ray.wavelength!==wave.wavelength||ray.field!==field)continue;
        if(['blocked','evanescent','limit'].includes(ray.status))continue;
        const events=ray.events||[];
        if(events.some(e=>['tir','reflect','diffract'].includes(e.kind)))continue;
        // Exclude rays that bypass any lens rim and alternate ray branches.
        const refractions=events.filter(e=>e.kind==='refract');
        const inOrder=lenses.every((lens,i)=>
          refractions[2*i]?.elementId===lens.id&&refractions[2*i].surface==='S1'&&
          refractions[2*i+1]?.elementId===lens.id&&refractions[2*i+1].surface==='S2');
        if(!inOrder||refractions.length!==2*lenses.length)continue;
        const exit=refractions.at(-1), dir=exit.outDirection;
        if(!dir||dir.x<=0||Math.abs(dir.y)<1e-10)continue;
        const crossX=exit.x+(axisY-exit.y)*dir.x/dir.y;
        if(!finite(crossX))continue;
        candidates.push({crossX,height:Math.abs(refractions[0].localY)});
      }
      if(!candidates.length)continue;
      candidates.sort((a,b)=>b.height-a.height);
      const maxHeight=candidates[0].height;
      if(maxHeight < 1e-6)continue;
      const outer=candidates.filter(c=>Math.abs(c.height-maxHeight)<Math.max(1e-7,maxHeight*1e-6));
      const x=mean(outer.map(c=>c.crossX));
      records.push({wavelength:wave.wavelength,reference,h:maxHeight,x,difference:x-reference});
    }
    return records;
  }
  function focusPlot(rows,crossings) {
    if(!rows.length)return '';
    const edgeByWave=new Map(crossings.map(r=>[r.wavelength,r.x]));
    const values=[...rows.map(r=>r.x),...crossings.map(r=>r.x)];
    let min=Math.min(...values),max=Math.max(...values);
    // Magnify the range of measured intercepts independently of the layout.
    const pad=Math.max((max-min)*.08,Math.abs(max)*1e-9,.00001);
    min-=pad;max+=pad;
    const x=v=>75+(v-min)/(max-min)*345;
    const baseline=28+rows.length*22;
    let drawing='';
    for(const [i,row] of rows.entries()){
      const y=21+i*22, color=spectralColor(row.w), focal=x(row.x), edge=edgeByWave.get(row.w);
      drawing+='<text x="2" y="'+(y+3)+'">'+num(row.w,2)+' nm</text><path d="M75 '+y+' H420" stroke="#e4ebdf"/>';
      if(finite(edge)){
        const end=x(edge);
        drawing+='<path d="M '+focal+' '+y+' H '+end+'" stroke="'+color+'" opacity=".6"/>'+
          '<path d="M '+end+' '+(y-3.5)+' l 3.5 3.5 -3.5 3.5 -3.5 -3.5 z" fill="'+color+'"><title>边缘交轴 '+num(edge,6)+' mm</title></path>';
      }
      drawing+='<circle cx="'+focal+'" cy="'+y+'" r="4.5" fill="none" stroke="'+color+'" stroke-width="1.5"><title>近轴 '+num(row.x,6)+' mm</title></circle>';
    }
    const tick=xp=>'M '+xp+' '+(baseline-2)+' v 5 ';
    drawing+='<path d="M75 '+baseline+' H420 '+[75,247.5,420].map(tick).join('')+'" stroke="#9eaf9b" fill="none"/>'+
      '<text x="75" y="'+(baseline+15)+'" text-anchor="start">'+num(min,6)+'</text>'+
      '<text x="247.5" y="'+(baseline+15)+'" text-anchor="middle">全局 x / mm</text>'+
      '<text x="420" y="'+(baseline+15)+'" text-anchor="end">'+num(max,6)+'</text>';
    return '<figure class="awi-focus-plot"><figcaption>各谱线的轴向交点 <small>○ 近轴参考面　'+(crossings.length?'◆ 边缘光线交轴':'')+'</small></figcaption>'+
      '<svg viewBox="0 0 428 '+(baseline+20)+'" role="img" aria-label="各谱线焦面沿全局 x 的横向比较，所有谱线共用毫米刻度。">'+drawing+'</svg></figure>';
  }
  function aberrationPanel(opts,view) {
    const {scene,result}=opts;
    const object=scene.elements.find(e=>e.type==='object');
    const context=detectorContext(scene,result,view);
    const {field,fieldHits,detector,waveValues}=context;
    let html=detector?detectorPickers(scene,context,false):'';
    if(!detector&&context.fields.length>1)html+='<div class="awi-toolbar">'+pick('field','场点',context.fields.map(f=>option(f,fieldLabel(scene,f),field)).join(''))+'</div>';
    html+='<h4 class="awi-subtitle">'+(object?'图案物面的近轴色移':'轴向焦移与球差')+'</h4>';
    const paraxial=(result.byWavelength||[]).filter(w=>w.valid);
    const point=object || scene.source.type!=='collimated';
    const referenceLabel=object?'图案物面的近轴像面':point?'该物方平面的近轴像面':'轴上平行入射的后焦面';
    const crossings=marginalCrossings(scene,result,field);
    if(paraxial.length) {
      const rows=paraxial.map(w=>({w:w.wavelength,x:referencePlane(scene,w,field)})).filter(row=>finite(row.x)).sort((a,b)=>a.w-b.w);
      if(rows.length) {
        const low=rows[0], high=rows.at(-1);
        const focusShift=rows.length>=2?high.x-low.x:null;
        html+='<div class="awi-metrics awi-metrics-pair">'+
          metric('近轴参考位置',scalar(rows[Math.floor(rows.length/2)].x),num(rows[Math.floor(rows.length/2)].w)+' nm · '+referenceLabel)+
          metric('近轴轴向色移 Δx',scalar(focusShift),focusShift===null?'选择多谱线光源比较':num(high.w)+' − '+num(low.w)+' nm，对应位置之差')+'</div>'+focusPlot(rows,crossings);
      }else html+=empty('该配置没有有限近轴焦面。');
    }else html+=empty(result.paraxial?.reason||'该配置不满足同轴折射系统的近轴焦移分析条件。');
    if(crossings.length) {
      html+=table(['λ / nm','首面 |h| / mm','近轴 x / mm','边缘光线交轴 x / mm','纵向球差 Δx / mm'],crossings.map(r=>[num(r.wavelength,2),num(r.h,4),num(r.reference,5),num(r.x,5),num(r.difference,5)]));
      html+='<p class="awi-note">同一谱线中，取完整通过镜片组的最大首面截高样本。Δx = 边缘光线出射直线与光轴的交点 − 该波长近轴位置。对称上下样本取平均。</p>';
    } else {
      html+='<p class="awi-note">'+(object?'图案包含多个出射位置，以下按各谱线统计图样在屏面上的整体分布。':'比较边缘光线交轴位置需要轴上物点或同轴平行束、有限近轴焦面，以及完整通过镜组的非轴线样本。')+'</p>';
      if(paraxial.length>1)html+=table(['λ / nm','EFL / mm',referenceLabel+' x / mm'],paraxial.map(w=>[num(w.wavelength,2),num(w.efl,4),num(referencePlane(scene,w,field),4)]));
    }
    html+='<h4 class="awi-subtitle">'+(object?'图样在探测屏上的分色与宽度':'探测屏上的分色与光斑宽度')+'</h4>';
    if(!detector) return html+empty('添加探测屏以比较各波长的实际落点。');
    const hits=object?fieldHits.filter(hit=>hit.objectHits?.some(tag=>tag.elementId===object.id)):fieldHits;
    const colors=waveValues.map(w=>({w,...statistics(hits.filter(h=>h.wavelength===w))}));
    html+=table(['λ / nm','命中条数','屏面质心 ū / mm',object?'图样 RMS / mm':'点斑 RMS / mm'],colors.map(s=>[num(s.w,2),s.count,num(s.center,5),num(s.rms,5)]));
    if(colors.length>1){
      const a=colors[0],b=colors.at(-1);
      html+='<p class="awi-note">同场点谱线质心位移 Δū（'+num(b.w)+' − '+num(a.w)+' nm） = '+(finite(a.center)&&finite(b.center)?unit(b.center-a.center,'mm',5):'—')+'。改变屏的位置、光栅级次或孔径均可能影响这个差值。</p>';
    }
    return html+details('模型与报告口径',formulaRows([
      ['空间与光谱','扩展物体用多个空间场点采样。谱线或波段独立设置，可比较同一空间场点的色移。'],
      ['几何分析','追迹子午截面中的实际曲面与选定光栅级次，报告轴向交点和屏面落点。'],
      ['二维范围','场曲、弧矢与子午像散的完整评价需要三维视场与光瞳采样。当前读数不包含衍射点扩散函数和辐射强度。']
    ]));
  }
  const panels={object:objectPanel,ray:rayPanel,cardinal:cardinalPanel,detector:detectorPanel,aberration:aberrationPanel};
  function drawView(host,view) {
    const opts=view.opts;
    if(!opts.result||!Array.isArray(opts.result.rays)){
      host.innerHTML=empty('请先配置有效的光学系统。');
      return;
    }
    const hasObject=opts.scene.elements.some(e=>e.type==='object');
    if(view.tab==='object'&&!hasObject)view.tab='ray';
    const rayIndex=Math.max(0,Math.trunc(opts.selectedRayIndex)||0);
    const selected=opts.result.rays[rayIndex];
    const header='<div class="awi-heading"><h3>光学分析</h3><span>'+ (selected?'光线 #'+(rayIndex+1)+'　'+esc(num(selected.wavelength,2))+' nm':'无光线')+'</span></div>';
    const tabbar='<div class="awi-tabs" role="group" aria-label="分析视图">'+
      Object.entries(tabs).filter(([key])=>key!=='object'||hasObject).map(([key,label])=>'<button data-awi-tab="'+key+'" type="button" aria-pressed="'+(view.tab===key)+'">'+esc(label)+'</button>').join('')+'</div>';
    const openDetails=[...host.querySelectorAll('.awi-details[open] summary')].map(el=>el.textContent);
    host.innerHTML='<div class="awi">'+header+tabbar+'<section class="awi-content" aria-label="'+tabs[view.tab]+'">'+panels[view.tab](opts,view)+'</section></div>';
    host.querySelectorAll('.awi-details').forEach(el=>{el.open=openDetails.includes(el.querySelector('summary').textContent);});
  }
  function render(host,opts) {
    if(!host || !opts?.scene)return;
    let view=views.get(host);
    if(!view){
      view={tab:'ray',opts};
      views.set(host,view);
      host.addEventListener('click',e=>{
        const strip=e.target.closest('[data-awi-strip]');
        if(strip && view.tab==='object') {
          const rect=strip.getBoundingClientRect(), count=Number(strip.dataset.awiStrip);
          view.objectBin=Math.max(0,Math.min(count-1,Math.floor((e.clientX-rect.left)/rect.width*count)));
          drawView(host,view);
          return;
        }
        const target=e.target.closest('button');
        if(!target||!host.contains(target))return;
        if(target.dataset.awiTab && panels[target.dataset.awiTab]){
          view.tab=target.dataset.awiTab;
          drawView(host,view);
          host.querySelector('[data-awi-tab="'+view.tab+'"]')?.focus({preventScroll:true});
        }
        if(target.dataset.awiInspectRay!==undefined) {
          const index=Number(target.dataset.awiInspectRay);
          view.tab='ray';
          if(typeof view.opts.onRay==='function') view.opts.onRay(index);
          else {view.opts.selectedRayIndex=index;view.opts.selectedStepIndex=0;drawView(host,view);}
        }
        if(target.dataset.awiStep!==undefined) {
          const index=Number(target.dataset.awiStep);
          if(typeof view.opts.onStep==='function') view.opts.onStep(index);
          else {view.opts.selectedStepIndex=index;drawView(host,view);}
        }
      });
      host.addEventListener('change',e=>{
        const key=e.target.dataset.awiSelect;
        if(!key)return;
        if(key==='ray'||key==='rayNumber'){
          const raw=key==='rayNumber'?Number(e.target.value)-1:Number(e.target.value);
          const index=Math.max(0,Math.min(view.opts.result.rays.length-1,Math.round(raw)||0));
          if(typeof view.opts.onRay==='function') view.opts.onRay(index);
          else {view.opts.selectedRayIndex=index;view.opts.selectedStepIndex=0;drawView(host,view);}
        }else if(['cardinalLambda','screen','field','wavelength','objectWave','exposure','objectBin'].includes(key)){
          view[key]=key==='objectBin'?Number(e.target.value)-1:e.target.value;
          drawView(host,view);
          host.querySelector('[data-awi-select="'+key+'"]')?.focus({preventScroll:true});
        }
      });
    }
    view.opts=opts;
    drawView(host,view);
  }
  function showObject(host){
    const view=views.get(host);
    if(view && view.opts.scene.elements.some(e=>e.type==='object')){
      view.tab='object';drawView(host,view);
    }
  }
  root.AdvInspector = {render,showObject};
})(typeof globalThis === 'undefined' ? window : globalThis);
