/* Two-dimensional geometric optics. World lengths are mm, wavelengths nm, public angles degrees.
 * Lens (x, y) is its front vertex. Local +y is 90 degrees CCW from the optical axis.
 * Sources: SCHOTT N-BK7 and F2 optical glass datasheets, Malitson JOSA 55 (1965) 1205,
 * Edmund Optics "All About Aspheric Lenses", MKS Diffraction Gratings Handbook.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./mie-phase.js'), require('./polarization.js'));
  else root.AdvancedOptics = factory(root.MiePhase, root.Polarization);
})(typeof globalThis === 'object' ? globalThis : this, function (phase, pol) {
  'use strict';

  const DEG = Math.PI / 180;
  const EPS = 1e-7;
  const clamp = (x, min, max) => Math.max(min, Math.min(max, x));
  const dot = (a, b) => a.x * b.x + a.y * b.y;
  const length = a => Math.hypot(a.x, a.y);
  const unit = a => { const m = length(a); return { x: a.x / m, y: a.y / m }; };
  const scale = (a, t) => ({ x: a.x * t, y: a.y * t });
  const along = (p, d, t) => ({ x: p.x + d.x * t, y: p.y + d.y * t });
  const angle = d => Math.atan2(d.y, d.x) / DEG;
  const direction = degrees => ({ x: Math.cos(degrees * DEG), y: Math.sin(degrees * DEG) });
  const normalOf = a => ({ x: -a.y, y: a.x });
  const finite = Number.isFinite;
  const coefficients = {
    BK7: [[1.03961212, 0.231792344, 1.01046945], [0.00600069867, 0.0200179144, 103.560653]],
    F2: [[1.34533359, 0.209073176, 0.937357162], [0.00997743871, 0.0470450767, 111.886764]],
    SILICA: [[0.6961663, 0.4079426, 0.8974794], [0.0684043 ** 2, 0.1162414 ** 2, 9.896161 ** 2]]
  };
  const materials = { BK7: 'SCHOTT N-BK7', F2: 'SCHOTT F2', SILICA: '熔融石英', CUSTOM: '恒定折射率' };

  function indexAt(material = 'BK7', wavelength = 550, customN = 1.5) {
    if (!finite(wavelength) || wavelength < 380 || wavelength > 780) return NaN;
    if (material === 'CUSTOM') return typeof customN === 'number' && customN > 0 ? customN : NaN;
    if (!Object.hasOwn(coefficients, material)) return NaN;
    const [B, C] = coefficients[material];
    const lambda2 = (wavelength / 1000) ** 2;
    return Math.sqrt(1 + B.reduce((sum, b, i) => sum + b * lambda2 / (lambda2 - C[i]), 0));
  }

  // Image-space focal length measured from a surface vertex along the local
  // optical axis. In the scene format R=0 means zero vertex curvature.
  const positiveIndex = n => finite(n) && n > 0;
  function surfaceFocalLength(radius, nBefore, nAfter) {
    if (!finite(radius) || !positiveIndex(nBefore) || !positiveIndex(nAfter)) return NaN;
    if (radius === 0 || nBefore === nAfter) return Infinity;
    return radius / ((nAfter - nBefore) / nAfter);
  }
  function radiusFromSurfaceFocus(focus, nBefore, nAfter) {
    if (!positiveIndex(nBefore) || !positiveIndex(nAfter)) return NaN;
    if (focus === Infinity || focus === -Infinity) return 0;
    if (!finite(focus) || focus === 0 || nBefore === nAfter) return NaN;
    return focus * ((nAfter - nBefore) / nAfter);
  }

  function sag(y, radius = 0, k = 0, a4 = 0) {
    if (radius === 0) return a4 * y ** 4;
    const radicand = 1 - (1 + k) * (y / radius) ** 2;
    if (radicand < -1e-13) return NaN;
    return (y * y / radius) / (1 + Math.sqrt(Math.max(0, radicand))) + a4 * y ** 4;
  }

  function surface(lens, i) {
    return { name: 'S' + i, vertex: i === 1 ? 0 : lens.thickness,
      r: lens['r' + i] ?? 0, k: lens['k' + i] ?? 0, a4: lens['a4' + i] ?? 0 };
  }
  const axial = (s, y) => s.vertex + (s.slope == null ? sag(y, s.r, s.k, s.a4) : s.slope*y);
  function axes(e) { const axis = direction(e.angle ?? 0); return { axis, transverse: normalOf(axis) }; }
  function world(a, b, lens) {
    return along(along(lens, lens.axis, a), lens.transverse, b);
  }
  function local(p, lens) {
    const v = { x: p.x - lens.x, y: p.y - lens.y };
    return { x: dot(v, lens.axis), y: dot(v, lens.transverse) };
  }
  function prepare(e) {
    const optic = { ...e, y: e.y ?? 0, ...axes(e), half: e.aperture / 2 };
    if (e.type === 'lens') optic.surfaces = [surface(e, 1), surface(e, 2)];
    if (isSolidObject(e)) {
      optic.surfaces = [{name:'S1', vertex:0, slope:0},
        {name:'S2', vertex:e.thickness, slope:Math.tan(e.wedge * DEG)}];
      optic.material = 'CUSTOM';
    }
    return optic;
  }

  const PATTERN_BINS = 33;
  const PAINT_CHANNELS = ['scatter', 'reflection', 'transmission'];
  const MIX_CHANNELS = [...PAINT_CHANNELS, 'absorption'];
  const isSolidObject = e => e.type === 'object' && ['refract', 'mixed'].includes(e.interaction);
  // New cells specify absolute power shares. Older mixed objects multiply one
  // gray mask by the same material fractions everywhere (including on return).
  function cellFractions(object, index) {
    let scatter, reflection, transmission;
    if (object.interaction !== 'mixed') {
      const gray = object.pattern[index];
      scatter = object.interaction === 'scatter' ? gray : 0;
      reflection = object.interaction === 'reflect' ? gray : 0;
      transmission = object.interaction === 'refract' ? gray : 0;
    } else if (object.channels) {
      scatter = object.channels.scatter[index];
      reflection = object.channels.reflection[index];
      transmission = object.channels.transmission[index];
    } else {
      const f = object.fractions;
      const scale = object.pattern[index] / (f.scatter + f.reflection + f.transmission + f.absorption);
      scatter = scale * f.scatter;
      reflection = scale * f.reflection;
      transmission = scale * f.transmission;
    }
    const sum = scatter + reflection + transmission;
    // Validation tolerates serialization roundoff. Never propagate more power
    // than arrived, even for a valid cell a few ulps above one.
    const divisor = Math.max(1, sum);
    return {scatter:scatter/divisor, reflection:reflection/divisor, transmission:transmission/divisor,
      absorption:Math.max(0, 1-sum)};
  }
  function patternAt(object, localY) {
    const index = clamp(Math.floor((localY / object.aperture + 0.5) * PATTERN_BINS), 0, PATTERN_BINS - 1);
    if (object.interaction === 'mixed' && object.channels) {
      const cell = cellFractions(object, index);
      return {index, value:1-cell.absorption};
    }
    return {index, value:object.pattern[index]};
  }
  function validPattern(values) {
    return Array.isArray(values) && values.length === PATTERN_BINS &&
      Array.from(values).every(value => finite(value) && value >= 0 && value <= 1);
  }
  function validateObject(object) {
    if (!validPattern(object.pattern)) {
      return '一维物体图案需要 33 个 0 至 1 的灰度值';
    }
    if (!finite(object.aperture) || object.aperture <= 0) return '物体宽度必须大于零';
    if (object.interaction === 'mixed') {
      const f = object.fractions;
      if (object.channels !== undefined) {
        const channels = object.channels;
        if (!channels || !PAINT_CHANNELS.every(key => validPattern(channels[key])))
          return '散射、镜面反射和透明介质通道各需要 33 个 0 至 1 的份额';
        for (let i=0; i<PATTERN_BINS; i++)
          if (PAINT_CHANNELS.reduce((sum,key) => sum+channels[key][i], 0) > 1+1e-9)
            return '第 '+(i+1)+' 格三通道合计超过 100%';
      } else if (!f || !MIX_CHANNELS.every(key => finite(f[key]) && f[key] >= 0 && f[key] <= 1) ||
          Math.abs(MIX_CHANNELS.reduce((sum, key) => sum + f[key], 0) - 1) > 1e-9)
        return '混合物体的四个能量份额必须非负且合计为 100%';
      const model=object.scatterModel??'diffuse';
      if (!['mie','hg','diffuse'].includes(model)) return '请选择有效的散射模型';
      if (model==='mie' && (!finite(object.mieDiameter) || object.mieDiameter<0.05 || object.mieDiameter>4 ||
          !finite(object.mieIndex) || object.mieIndex<1 || object.mieIndex>4))
        return '米氏散射需要 0.05 至 4 µm 的球直径与 1 至 4 的粒子折射率';
      if (model==='hg' && (!finite(object.scatterG) || object.scatterG<0 || object.scatterG>0.98))
        return 'HG 不对称因子应在 0 至 0.98 之间';
    }
    if (object.interaction === 'scatter' || object.interaction === 'mixed') {
      const particle = object.interaction === 'mixed' && ['mie','hg'].includes(object.scatterModel);
      if (!finite(object.scatterAngle) || object.scatterAngle <= 0 ||
          (particle ? object.scatterAngle > 180 : object.scatterAngle >= 90))
        return particle ? '散射半角须大于 0° 且不超过 180°' : '散射半角必须在 0° 与 90° 之间';
      const limit = particle ? 17 : 9;
      if (!Number.isInteger(object.scatterSamples) || object.scatterSamples<3 ||
          object.scatterSamples>limit || object.scatterSamples%2!==1) return '散射方向数应为 3 至 '+limit+' 的奇数';
    }
    if (isSolidObject(object)) {
      if (!finite(object.n) || object.n < 1 || object.n > 4) return '物体折射率应在 1 至 4 之间';
      if (!finite(object.wedge) || Math.abs(object.wedge) >= 89 || !finite(object.thickness)) return '楔角或厚度无效';
      if (object.thickness - Math.abs(Math.tan(object.wedge*DEG))*object.aperture/2 <= EPS) return '楔形物体边缘厚度需大于零，请增大厚度或减小楔角';
    } else if (!['reflect','scatter'].includes(object.interaction)) return '物体作用类型无效';
    return null;
  }

  function validateLens(e) {
    if (!(finite(e.aperture) && e.aperture > 0 && finite(e.thickness) && e.thickness > 0)) return '镜片口径与中心厚度必须大于零';
    if (!finite(indexAt(e.material, 550, e.n))) return '镜片材料或自定义折射率无效';
    const [front, rear] = [surface(e, 1), surface(e, 2)];
    if (![front, rear].every(s => [s.r, s.k, s.a4].every(finite))) return '曲面系数必须为有限数值';
    for (let i = 0; i <= 96; i++) {
      const y = e.aperture * i / 192;
      const x1 = axial(front, y), x2 = axial(rear, y);
      if (!finite(x1) || !finite(x2)) return '口径跨越圆锥曲面的定义域，请减小口径或增大曲率半径';
      if (x2 - x1 <= EPS) return '前后表面在通光口径内相交，请增大厚度或减小口径';
    }
    return null;
  }

  // Lens interiors are disjoint. A polygon is used only in this error check;
  // optical intersections below are evaluated against the analytic surfaces.
  function outline(e) {
    const poly = [];
    e.surfaces.forEach((s, j) => {
      for (let i = 0; i <= 48; i++) {
        const y = (j ? 1 - i / 24 : i / 24 - 1) * e.half;
        poly.push(world(axial(s, y), y, e));
      }
    });
    return poly;
  }
  function inside(p, lens) {
    const q = local(p, lens);
    return Math.abs(q.y) < lens.half && q.x > axial(lens.surfaces[0], q.y) + EPS &&
      q.x < axial(lens.surfaces[1], q.y) - EPS;
  }
  const cross3 = (a, b, c) => (b.x-a.x)*(c.y-a.y) - (b.y-a.y)*(c.x-a.x);
  function crossing(a, b, c, d) {
    return cross3(a,b,c)*cross3(a,b,d)<0 && cross3(c,d,a)*cross3(c,d,b)<0;
  }
  function validateScene(scene) {
    const errors = [], lenses = [];
    if (!scene || !Array.isArray(scene.elements) || !scene.source) return ['实验需要光源与器件列表'];
    const s = scene.source;
    if (!finite(s.x) || !finite(s.y ?? 0) || !finite(s.angle ?? 0) || !['point','field','collimated'].includes(s.type)) errors.push('光源类型或位置无效');
    if (!['mono','rgb','band'].includes(s.spectrum ?? 'mono') || !finite(s.wavelength ?? 550) || (s.wavelength ?? 550)<380 || (s.wavelength ?? 550)>780) errors.push('光谱无效，波长范围为 380–780 nm');
    if (![s.width??0,s.height??0,s.spread??0,s.bandwidth??0].every(x=>finite(x)&&x>=0) || !finite(s.rays??9)) errors.push('光源宽度、视场、角度或采样数无效');
    if (!['unpolarized','linear','left','right','elliptical'].includes(s.polarization??'unpolarized') ||
        !finite(s.polAngle??0) || !finite(s.ellipticity??0) || Math.abs(s.ellipticity??0)>45 ||
        !finite(s.polDegree??1) || (s.polDegree??1)<0 || (s.polDegree??1)>1)
      errors.push('光源偏振设置无效，椭圆率角须在 ±45° 以内，偏振度须在 0 至 1 之间');
    const ids = new Set();
    for (const e of scene.elements) {
      if (!e || ids.has(e.id) || e.id == null) { errors.push('每个器件需要独立编号'); continue; }
      ids.add(e.id);
      let why = null;
      if (!finite(e.x) || !finite(e.y??0) || !finite(e.angle??0) || !finite(e.aperture) || e.aperture<=0) why='器件位置、倾角或口径无效';
      else if (e.type === 'lens') why = validateLens(e);
      else if (e.type === 'object') why = validateObject(e);
      else if (e.type === 'grating' && (!(finite(e.lines) && e.lines>0) || !Number.isInteger(e.order))) why='刻线密度必须为正、级次必须为整数';
      else if (e.type === 'stop' && e.outerDiameter!=null && (!finite(e.outerDiameter)||e.outerDiameter<e.aperture)) why='光阑外径不能小于通光口径';
      else if (['polarizer','retarder'].includes(e.type) && !finite(e.axisAngle??0)) why='偏振光轴角须为有限角度';
      else if (e.type === 'retarder' && (!finite(e.retardance??90) || !finite(e.referenceWavelength??550) ||
          (e.referenceWavelength??550)<380 || (e.referenceWavelength??550)>780))
        why='波片相位延迟或设计波长无效，设计波长范围为 380–780 nm';
      else if (!['lens','screen','mirror','grating','stop','polarizer','retarder'].includes(e.type)) why='未知器件类型';
      if (why) errors.push(e.id + ' · ' + why);
      else if (e.type==='lens'||isSolidObject(e)) { const lens=prepare(e);lens.outline=outline(lens);lenses.push(lens); }
    }
    for(let i=0;i<lenses.length;i++) for(let j=i+1;j<lenses.length;j++) {
      const a=lenses[i], b=lenses[j];
      const bounds = axis => [Math.min(...a.outline.map(p=>p[axis])), Math.max(...a.outline.map(p=>p[axis])),
        Math.min(...b.outline.map(p=>p[axis])), Math.max(...b.outline.map(p=>p[axis]))];
      if (['x','y'].some(axis=>{ const [a0,a1,b0,b1]=bounds(axis);return a1<=b0-EPS||b1<=a0-EPS; })) continue;
      const cornersInside = a.outline.some(p=>inside(p,b)) || b.outline.some(p=>inside(p,a));
      const edgesCross = (p, k) => b.outline.some((q,l)=>crossing(p,a.outline[(k+1)%a.outline.length],q,b.outline[(l+1)%b.outline.length]));
      // A common axial plane has two discontinuous interfaces at identical distance.
      const touching = a.outline.some(p=>b.outline.some(q=>Math.hypot(p.x-q.x,p.y-q.y)<EPS));
      if (cornersInside || touching || a.outline.some(edgesCross)) errors.push(a.id+' / '+b.id+' · 镜片实体接触或重叠，请留出空气间隔');
    }
    return errors;
  }

  function quadratic(a, b, c) {
    if (Math.abs(a)<1e-15) return Math.abs(b)<1e-15?[]:[-c/b];
    const disc=b*b-4*a*c;
    if(disc<0)return [];
    const q=-0.5*(b+(b<0?-1:1)*Math.sqrt(disc));
    if(!q)return [-b/(2*a)];
    return [q/a,c/q];
  }
  const polyValue = (p,z) => p.reduceRight((value,c)=>value*z+c,0);
  function polyProduct(a,b) {
    const out=Array(a.length+b.length-1).fill(0);
    a.forEach((v,i)=>b.forEach((w,j)=>out[i+j]+=v*w));
    return out;
  }
  function polyAdd(a,b,factor=1) {
    return Array.from({length:Math.max(a.length,b.length)},(_,i)=>(a[i]??0)+factor*(b[i]??0));
  }
  // Derivative roots split a degree-eight polynomial into monotone intervals.
  // Scaling the ray parameter to [-1,1] keeps the coefficients well conditioned.
  function intervalRoots(coefficients) {
    const largest=Math.max(...coefficients.map(Math.abs));
    if(!largest) return [];
    const p=coefficients.map(v=>v/largest);
    while(p.length>1 && Math.abs(p.at(-1))<1e-15)p.pop();
    if(p.length===1)return [];
    if(p.length===2){const z=-p[0]/p[1];return z>=-1-EPS&&z<=1+EPS?[clamp(z,-1,1)]:[];}
    const extrema=intervalRoots(p.slice(1).map((v,i)=>v*(i+1))).sort((a,b)=>a-b);
    const stops=[-1,...extrema,1], roots=[];
    for (let i=0;i<stops.length;i++) {
      const z=stops[i], value=polyValue(p,z);
      if(Math.abs(value)<1e-12)roots.push(z);
      if(i===0)continue;
      let lo=stops[i-1],hi=z;
      const sign=Math.sign(polyValue(p,lo));
      if(sign*Math.sign(value)>=0)continue;
      for(let it=0;it<54;it++){const m=(lo+hi)/2; if(polyValue(p,m)*sign>0)lo=m;else hi=m;}
      roots.push((lo+hi)/2);
    }
    return roots;
  }
  function asphereRoots(p,d,s,half) {
    const base=sag(half,s.r,s.k,0),extra=s.a4*half**4;
    let lo=0,hi=Infinity;
    for(const [key,min,max] of [['x',s.vertex+Math.min(0,base)+Math.min(0,extra)-EPS,s.vertex+Math.max(0,base)+Math.max(0,extra)+EPS],['y',-half-EPS,half+EPS]]) {
      if(Math.abs(d[key])<1e-15){if(p[key]<min||p[key]>max)return [];continue;}
      const a=(min-p[key])/d[key],b=(max-p[key])/d[key];
      lo=Math.max(lo,Math.min(a,b)); hi=Math.min(hi,Math.max(a,b));
    }
    if(!(hi>lo))return [];
    const mid=(lo+hi)/2, span=(hi-lo)/2;
    const y=[p.y+d.y*mid,d.y*span], y2=polyProduct(y,y);
    const baseX=polyAdd([p.x+d.x*mid-s.vertex,d.x*span],polyProduct(y2,y2),-s.a4);
    const implicit=s.r===0?baseX:polyAdd(polyAdd(y2,baseX,-2*s.r),polyProduct(baseX,baseX),1+s.k);
    return intervalRoots(implicit).map(z=>mid+span*z);
  }

  // Implicit conic y² − 2Rz + (1+k)z² = 0, with z=x−vertex−A4*y⁴.
  // The sag residual rejects intersections on the other branch of the conic.
  function surfaceHit(p,d,s,half) {
    if (s.slope != null) {
      const denominator = d.x - s.slope*d.y;
      if (Math.abs(denominator)<1e-14) return null;
      const t=(s.vertex+s.slope*p.y-p.x)/denominator;
      const at=along(p,d,t);
      if(t<=EPS||Math.abs(at.y)>half+EPS)return null;
      return {t,at,normal:unit({x:1,y:-s.slope}),surface:s.name};
    }
    const z=p.x-s.vertex;
    let roots;
    if(s.a4!==0) roots=asphereRoots(p,d,s,half);
    else if(s.r===0) roots=Math.abs(d.x)>1e-14?[-z/d.x]:[];
    else {
      const q=1+s.k;
      roots=quadratic(d.y*d.y+q*d.x*d.x,2*(p.y*d.y-s.r*d.x+q*z*d.x),p.y*p.y-2*s.r*z+q*z*z);
    }
    let nearest=null;
    for (const t of roots) {
      if(!(t>EPS)|| (nearest && t>=nearest.t))continue;
      const at=along(p,d,t);
      if(Math.abs(at.y)>half+EPS)continue;
      const xSurface=axial(s,at.y);
      if(!finite(xSurface)||Math.abs(at.x-xSurface)>1e-6*Math.max(1,Math.abs(xSurface-s.vertex)))continue;
      const disc=s.r===0?1:Math.sqrt(Math.max(0,1-(1+s.k)*(at.y/s.r)**2));
      const transverse=(s.r===0?0:at.y/s.r)+4*s.a4*at.y**3*disc;
      nearest={t,at,normal:unit({x:disc,y:-transverse}),surface:s.name};
    }
    return nearest;
  }

  function intersect(p,d,optic) {
    const q=local(p,optic), v={x:dot(d,optic.axis),y:dot(d,optic.transverse)};
    let hit=null;
    if(optic.surfaces){
      for(const s of optic.surfaces){const candidate=surfaceHit(q,v,s,optic.half); if(candidate&&(!hit||candidate.t<hit.t))hit=candidate;}
      if(Math.abs(v.y)>1e-14)for(const side of [-1,1]){
        const y=side*optic.half,t=(y-q.y)/v.y;
        if(t<=EPS || (hit&&t>=hit.t))continue;
        const x=q.x+t*v.x;
        if(x>=axial(optic.surfaces[0],y)-EPS && x<=axial(optic.surfaces[1],y)+EPS)
          hit={t,at:{x,y},normal:{x:0,y:side},surface:'rim'};
      }
    }else if(Math.abs(v.x)>1e-14){
      const t=-q.x/v.x, y=q.y+t*v.y;
      const half=optic.type==='stop'?(optic.outerDiameter??Math.max(optic.aperture+40,100))/2:optic.half;
      if(t>EPS&&Math.abs(y)<=half+EPS)hit={t,at:{x:0,y},normal:{x:1,y:0},surface:'plane'};
    }
    if(!hit)return null;
    const n=hit.normal;
    return {t:hit.t,optic,surface:hit.surface,localY:hit.at.y,point:along(p,d,hit.t),
      normal:{x:n.x*optic.axis.x+n.y*optic.transverse.x,y:n.x*optic.axis.y+n.y*optic.transverse.y}};
  }

  function reflected(d,n) { return along(d,n,-2*dot(d,n)); }
  // n faces the incident medium. Tangential optical momentum is continuous.
  function refracted(d,n,n1,n2) {
    const tangent=normalOf(n), sinT=n1/n2*dot(d,tangent);
    if(Math.abs(sinT)>1+1e-12)return null;
    return along(scale(tangent,sinT),n,-Math.sqrt(Math.max(0,1-sinT*sinT)));
  }
  function latestMedium(optic,wavelength) {return optic?indexAt(optic.material,wavelength,optic.n):1;}
  // Integrate cos(theta) in angular cells in the 2D section. Each cell is
  // represented by its midpoint and sums to the selected cone's total power.
  function scatterLobe(halfAngle, samples) {
    const half=halfAngle*DEG, edges=Array.from({length:samples+1},(_,i)=>half*(2*i/samples-1));
    return edges.slice(1).map((right,i)=>({
      offset:(edges[i]+right)/(2*DEG),
      fraction:(Math.sin(right)-Math.sin(edges[i]))/(2*Math.sin(half))
    }));
  }
  // After the first split, deterministic inverse-CDF sampling bounds the
  // number of descendants per source, even in a multiply scattering cavity.
  function scatterVariate(sourceId, branch, depth) {
    return ((sourceId+1)*0.61803398875+(branch+0.5)*0.75487766625+depth*0.38196601125)%1;
  }
  function secondaryScatter(halfAngle, sourceId, branch, depth) {
    const u=scatterVariate(sourceId,branch,depth);
    return Math.asin((2*u-1)*Math.sin(halfAngle*DEG))/DEG;
  }
  // A first encounter distributes power among angular cells. At later visits
  // one deterministic quantile carries the entire scattered packet.
  function mixedAngles(optic, n1, wavelength, u, stokes) {
    const halfAngle=optic.scatterAngle, samples=optic.scatterSamples;
    if (optic.scatterModel==='mie') {
      const options={diameter:optic.mieDiameter,index:optic.mieIndex,medium:n1,wavelength,halfAngle,samples};
      return phase.scatterPolarized(options,stokes,u);
    }
    if (optic.scatterModel==='hg') {
      const options={g:optic.scatterG,halfAngle,samples};
      return u===null ? phase.sampleHG(options) : [{offset:phase.quantileHG(options,u),fraction:1}];
    }
    return u===null ? scatterLobe(halfAngle,samples) :
      [{offset:Math.asin((2*u-1)*Math.sin(halfAngle*DEG))/DEG, fraction:1}];
  }
  const bareSurface = {scatter:0, reflection:0, transmission:1, absorption:0};
  const objectEnergy = () => ({incident:0, absorbed:0, scattered:0, reflected:0, transmitted:0});
  const systemEnergy = () => ({emitted:0, absorbed:0, polarizerLoss:0, blocked:0, detected:0, escaped:0, unresolved:0});
  function mixedInterface(optic, incoming, n, medium, n1, wavelength, weight, cell, u, stokes) {
    const nextMedium = medium === optic ? null : optic;
    const n2 = latestMedium(nextMedium, wavelength);
    const transmitted = refracted(incoming, n, n1, n2);
    const boundary = pol.dielectric(stokes,n1,n2,Math.abs(dot(incoming,n)),transmitted && Math.abs(dot(transmitted,n)));
    const F = boundary.reflected.fraction;
    const f = cell ?? bareSurface;
    const mieMatched = f.scatter>0 && optic.scatterModel==='mie' && Math.abs(optic.mieIndex-n1)<1e-12;
    const clear = f.transmission + (mieMatched ? f.scatter : 0);
    const energy = {incident:weight, absorbed:weight*f.absorption,
      scattered:weight*(mieMatched ? 0 : f.scatter), reflected:weight*(f.reflection + clear*F),
      transmitted:weight*clear*(1-F)};
    const outputs = [];
    if (energy.reflected > 0) {
      // Specular paint and the dielectric portion are independent subareas of one cell.
      const reflectedState = pol.average([
        {weight:f.reflection,stokes:pol.reflect(stokes)}, {weight:clear*F,stokes:boundary.reflected.stokes}
      ]);
      outputs.push({kind:!transmitted && clear>0 ? 'tir' : 'reflect',
        direction:reflected(incoming,n), weight:energy.reflected, medium, stokes:reflectedState});
    }
    if (energy.transmitted > 0)
      outputs.push({kind:'refract', direction:transmitted, weight:energy.transmitted, medium:nextMedium, stokes:boundary.transmitted.stokes});
    if (energy.scattered > 0) {
      // Scattering is localized at the patterned surface. A particle lobe is
      // referenced to the incident propagation vector; an oblique lobe may
      // put different branches on opposite sides of the same interface.
      const axis = ['mie','hg'].includes(optic.scatterModel) ? angle(incoming) : angle(n);
      for (const {offset, fraction, stokes:scatteredState} of mixedAngles(optic,n1,wavelength,u,stokes)) {
        if (!(fraction>0)) continue;
        const d=direction(axis+offset), crosses=dot(d,n)<0;
        outputs.push({kind:'scatter', direction:d, weight:energy.scattered*fraction,
          medium:crosses?nextMedium:medium, scatterSide:crosses?'opposite':'incident',
          scatterOffset:offset, scatterFraction:fraction, stokes:scatteredState??pol.unpolarized});
      }
    }
    return {energy, outputs, F, n2, mieMatched};
  }
  function trace(seed, optics, tail, maxEvents, recordObject, ledger, pending, continuation) {
    let p=continuation?.point??seed.origin, d=continuation?.direction??unit(seed.direction);
    let totalOPL=continuation?.opl??0, weight=continuation?.weight??1;
    let stokes=continuation?.stokes??seed.sourceStokes;
    let medium=continuation ? continuation.medium : optics.find(o=>o.surfaces&&inside(p,o));
    const points=continuation?.points??[p], events=continuation?.events??[], objectHits=continuation?.objectHits??[];
    let status='limit', intercepted=0;
    for(let i=events.length;i<maxEvents;i++){
      let closest=null;
      for(const o of optics){const h=intersect(p,d,o);if(h&&(!closest||h.t<closest.t))closest=h;}
      if(!closest){points.push(along(p,d,tail));status='escaped';break;}
      const {optic,surface,point,localY,t}=closest;
      const n=dot(d,closest.normal)>0?scale(closest.normal,-1):closest.normal;
      const n1=latestMedium(medium,seed.wavelength);
      const weightIn=weight, stokesIn=stokes, isObject=optic.type==='object';
      let patternHit=null, scatter=null;
      if (isObject && (surface==='plane' || surface==='S1')) {
        const {index,value}=patternAt(optic,localY);
        patternHit={elementId:optic.id,localY,patternIndex:index,patternValue:value};
        objectHits.push(patternHit);
        if (optic.interaction!=='mixed') weight*=value;
      }
      if (isObject && optic.interaction==='mixed' && surface!=='rim') {
        const repeated = objectHits.length>1;
        const u = repeated ? scatterVariate(seed.sourceId,continuation?.branch??0,i) : null;
        const cell = patternHit ? cellFractions(optic,patternHit.patternIndex) : null;
        const {energy,outputs,F,n2,mieMatched} = mixedInterface(optic,d,n,medium,n1,seed.wavelength,weightIn,cell,u,stokes);
        if (patternHit) recordObject(optic.id,seed.wavelength,patternHit.patternIndex,energy);
        const opl=totalOPL+t*n1;
        const common={...point,elementId:optic.id,surface,localY,type:'object',interaction:'mixed',
          ...patternHit,cellFractions:cell,energy,fresnel:F,mieMatched,scatterModel:optic.scatterModel??'diffuse',
          n1,n2,normal:n,inDirection:d,inAngle:angle(d),
          incidence:Math.acos(clamp(-dot(d,n),-1,1))/DEG,wavelength:seed.wavelength,opl,stepLength:t,weightIn,stokesIn};
        if (!outputs.length) {
          events.push({...common,kind:'absorb',outDirection:null,outAngle:null,emergence:null,weightOut:0,stokesOut:null});
          points.push(point); totalOPL=opl; weight=0; status='blocked';
          break;
        }
        for (const [branch,output] of outputs.entries()) {
          const out=unit(output.direction);
          const event={...common,kind:output.kind,outDirection:out,outAngle:angle(out),
            emergence:Math.acos(clamp(Math.abs(dot(out,n)),0,1))/DEG,weightOut:output.weight,stokesOut:output.stokes};
          if (output.kind==='scatter') Object.assign(event,{scatterOffset:output.scatterOffset,
            scatterFraction:output.scatterFraction,scatterSide:output.scatterSide,secondaryScatter:repeated});
          pending.push({point,direction:out,medium:output.medium,weight:output.weight,stokes:output.stokes,opl,
            points:points.concat(point),events:events.concat(event),objectHits:objectHits.slice(),branch});
        }
        return [];
      }
      function recordLegacy(kind) {
        if (!patternHit) return;
        const energy=objectEnergy();
        energy.incident=weightIn;
        energy.absorbed=weightIn-weight;
        if (kind==='scatter') energy.scattered=weight;
        if (kind==='reflect'||kind==='tir') energy.reflected=weight;
        if (kind==='refract') energy.transmitted=weight;
        recordObject(optic.id,seed.wavelength,patternHit.patternIndex,energy);
      }
      let n2=n1, out=d, kind='pass';
      let plateEvent=null;
      if(weight===0||surface==='rim'||(optic.type==='stop'&&Math.abs(localY)>optic.half+EPS)){kind='blocked';out=null;status='blocked';intercepted=weight;weight=0;}
      else if(optic.type==='screen'){kind='detect';out=null;status='detected';}
      else if(optic.type==='mirror'||(isObject&&optic.interaction==='reflect')){
        kind='reflect';out=reflected(d,n);stokes=pol.reflect(stokes);
      }
      else if(optic.type==='polarizer'||optic.type==='retarder'){
        // Ideal thin elements act in each ray's transverse p/s basis. A reverse
        // traversal reverses p relative to the plate's marked in-plane axis.
        const axisAngle = Math.sign(dot(d,optic.axis)) * (optic.axisAngle??0);
        if (optic.type==='polarizer') {
          kind='polarize';
          const output=pol.polarize(stokes,axisAngle);
          stokes=output.stokes; weight*=output.fraction;
          plateEvent={axisAngle,polarizerLoss:weightIn-weight};
          ledger.polarizerLoss+=plateEvent.polarizerLoss;
          if (!weight) {out=null;status='blocked';}
        } else {
          kind='retard';
          const retardance=(optic.retardance??90)*(optic.referenceWavelength??550)/seed.wavelength;
          stokes=pol.retard(stokes,axisAngle,retardance);
          plateEvent={axisAngle,retardance};
        }
      }
      else if(isObject&&optic.interaction==='scatter'){
        kind='scatter';
        stokes=pol.unpolarized;
        const central=angle(scale(n,-1));
        if (!continuation) {
          recordLegacy(kind);
          // This prefix was traced once. Each child inherits a separate event
          // and weight, and subsequent propagation starts at the scatter point.
          const opl=totalOPL+t*n1;
          return scatterLobe(optic.scatterAngle,optic.scatterSamples).flatMap(({offset,fraction},branch)=>{
            const directionOut=direction(central+offset), nextWeight=weight*fraction;
            const event={...point,...patternHit,kind,surface,type:'object',interaction:'scatter',
              n1,n2,normal:n,inDirection:d,outDirection:directionOut,inAngle:angle(d),outAngle:angle(directionOut),
              incidence:Math.acos(clamp(-dot(d,n),-1,1))/DEG,emergence:Math.abs(offset),
              wavelength:seed.wavelength,opl,stepLength:t,scatterOffset:offset,scatterFraction:fraction,
              weightIn,weightOut:nextWeight,stokesIn,stokesOut:stokes};
            return trace(seed,optics,tail,maxEvents,recordObject,ledger,pending,{point,direction:directionOut,
              medium,weight:nextWeight,stokes,opl,points:points.concat(point),events:events.concat(event),
              objectHits:objectHits.slice(),branch});
          });
        }
        const offset=secondaryScatter(optic.scatterAngle,seed.sourceId,continuation.branch,i);
        scatter={scatterOffset:offset,scatterFraction:1,secondaryScatter:true};
        out=direction(central+offset);
      }
      else if(optic.type==='grating'){
        const tangential=dot(d,optic.transverse)+optic.order*seed.wavelength*1e-6*optic.lines/n1;
        if(Math.abs(tangential)>1+1e-12){kind='evanescent';out=null;status='evanescent';intercepted=weight;weight=0;}
        else{
          kind='diffract';
          const normalComponent=Math.sign(dot(d,optic.axis))*Math.sqrt(Math.max(0,1-tangential*tangential));
          out=along(scale(optic.axis,normalComponent),optic.transverse,tangential);
        }
      }else if(optic.surfaces){
        const nextMedium=(medium===optic)?null:optic;
        n2=latestMedium(nextMedium,seed.wavelength);
        out=refracted(d,n,n1,n2);
        if(out){kind='refract';medium=nextMedium;}
        else{
          kind='tir';out=reflected(d,n);
          stokes=pol.dielectric(stokes,n1,n2,Math.abs(dot(d,n)),null).reflected.stokes;
        }
      }
      recordLegacy(kind);
      if(out)out=unit(out);
      totalOPL+=t*n1;
      events.push({elementId:optic.id,type:optic.type,surface,kind,...point,localY,n1,n2,wavelength:seed.wavelength,
        ...(isObject?{interaction:optic.interaction}:{}),...patternHit,...scatter,...plateEvent,weightIn,weightOut:weight,
        ...(kind==='detect'?{forwardOnScreen:dot(d,optic.axis)>0}:{}),
        stokesIn,stokesOut:out?stokes:null,
        normal:n,inDirection:d,outDirection:out,inAngle:angle(d),outAngle:out?angle(out):null,
        incidence:Math.acos(clamp(-dot(d,n),-1,1))/DEG,
        emergence:out?Math.acos(clamp(Math.abs(dot(out,n)),0,1))/DEG:null,
        opl:totalOPL,stepLength:t});
      points.push(point);p=point;
      if(!out)break;
      d=out;
    }
    return [{...seed,direction:d,points,events,status,opl:totalOPL,weight,stokes,intercepted,objectHits}];
  }

  // Continue the brightest packets first. The undistributed power of every
  // stopped packet stays in the unresolved column instead of becoming loss.
  function traceFamily(seed,optics,tail,recordObject,ledger) {
    const pending=[];
    const rays=trace(seed,optics,tail,64,recordObject,ledger,pending);
    let continued=0;
    while (pending.length) {
      pending.sort((a,b)=>a.weight-b.weight);
      const next=pending.pop();
      if (continued>=96 || next.weight<1e-8) {
        for (const branch of [...pending,next]) {
          rays.push({...seed,direction:branch.direction,points:branch.points,events:branch.events,
            status:'limit',limitReason:'branch',opl:branch.opl,weight:branch.weight,stokes:branch.stokes,intercepted:0,
            objectHits:branch.objectHits});
        }
        break;
      }
      continued++;
      rays.push(...trace(seed,optics,tail,64,recordObject,ledger,pending,next));
    }
    return rays;
  }

  const matIdentity=()=>({A:1,B:0,C:0,D:1});
  function translated(m,d) {return {A:m.A+d*m.C,B:m.B+d*m.D,C:m.C,D:m.D};}
  function powered(m,phi){return {A:m.A,B:m.B,C:m.C-phi*m.A,D:m.D-phi*m.B};}
  function unavailable(reason) {
    return {valid:false,reason,matrix:null,efl:null,bfl:null,frontFocalX:null,backFocalX:null,h1X:null,h2X:null,
      imageX:null,magnification:null,firstX:null,lastX:null};
  }
  function paraxial(scene,wavelength=scene.source?.wavelength??550) {
    const elements=scene.elements??[];
    if(elements.some(e=>e.type==='mirror'||e.type==='grating'))return unavailable('折叠或衍射光路请使用实际光线读数');
    const lenses=elements.filter(e=>e.type==='lens').sort((a,b)=>a.x-b.x);
    if(!lenses.length)return unavailable('系统尚无折射透镜');
    if(lenses.some(e=>Math.abs(e.y??0)>EPS||Math.abs(e.angle??0)>EPS))return unavailable('当前器件不共用全局 x 轴，可查看各镜片局部近轴值');
    if(lenses.some(e=>validateLens(e)))return unavailable('镜片几何无效');
    const firstX=lenses[0].x;
    let lastX=firstX, m=matIdentity();
    for(const e of lenses){
      if(e.x<lastX-EPS)return unavailable('镜片顶点顺序或间距无效');
      const n=indexAt(e.material,wavelength,e.n);
      if(!finite(n))return unavailable('波长或折射率无效');
      m=translated(m,e.x-lastX);
      m=powered(m,e.r1?(n-1)/e.r1:0);
      m=translated(m,e.thickness/n);
      m=powered(m,e.r2?(1-n)/e.r2:0);
      lastX=e.x+e.thickness;
    }
    const power=Math.abs(m.C)>1e-12;
    const efl=power?-1/m.C:null;
    const bfl=power?-m.A/m.C:null;
    const frontFocalX=power?firstX+m.D/m.C:null,backFocalX=power?lastX+bfl:null;
    const objects=elements.filter(e=>e.type==='object');
    if(objects.length && (objects.length!==1||objects[0].interaction!=='scatter'||
        Math.abs(objects[0].angle??0)>EPS||objects[0].x>=firstX))
      return unavailable('当前物体光路请查看物面采样与探测屏实际落点');
    const s=objects.length?{type:'field',x:objects[0].x}:scene.source;
    let imageX=null,magnification=null;
    if(s?.type==='collimated'){imageX=backFocalX;}
    else if(s && finite(s.x) && s.x<firstX){
      const distance=firstX-s.x, B=m.A*distance+m.B, D=m.C*distance+m.D;
      if(Math.abs(D)>1e-12){imageX=lastX-B/D;magnification=1/D;}
    }
    return {valid:true,reason:'',matrix:m,efl,bfl,frontFocalX,backFocalX,h1X:power?frontFocalX+efl:null,
      h2X:power?backFocalX-efl:null,imageX,magnification,firstX,lastX,wavelength};
  }
  function lensParaxial(lens, wavelength=550) {
    const localLens = {...lens, x:0, y:0, angle:0};
    return {id:lens.id, ...paraxial({source:{type:'collimated'}, elements:[localLens]}, wavelength)};
  }
  function wavelengths(s) {
    if(s.spectrum==='rgb')return [486.1327,546.074,656.2725];
    const center=s.wavelength??550;
    if(s.spectrum!=='band'||!(s.bandwidth>0))return [center];
    const low=clamp(center-s.bandwidth/2,380,780),high=clamp(center+s.bandwidth/2,380,780);
    return Array.from({length:5},(_,j)=>low+(high-low)*j/4);
  }
  function simulate(scene) {
    const warnings=validateScene(scene);
    if(warnings.length)return {warnings,rays:[],wavelengths:[],detectors:[],objects:[],emittedCount:0,
      energy:systemEnergy(),energyByWavelength:[],lensMetrics:[],byWavelength:[],paraxial:unavailable(warnings[0])};
    const s=scene.source, optics=scene.elements.map(prepare), waves=wavelengths(s);
    const fields=s.type==='field'&&s.height>0?[-s.height/2,0,s.height/2]:[0];
    const {transverse}=axes(s),count=clamp(Math.round(s.rays??9),3,41);
    const sourceStokes=pol.sourceState(s);
    const rays=[],detectors=optics.filter(o=>o.type==='screen').map(o=>({id:o.id,hits:[],weight:0,centroid:null,rms:null,stokes:null}));
    const byId=new Map(detectors.map(d=>[d.id,d]));
    const bins=()=>({incident:Array(PATTERN_BINS).fill(0),outgoing:Array(PATTERN_BINS).fill(0),energy:objectEnergy()});
    const objects=optics.filter(o=>o.type==='object').map(o=>({id:o.id,...bins(),
      byWavelength:waves.map(wavelength=>({wavelength,...bins()}))}));
    const profiles=new Map(objects.map(o=>[o.id,o]));
    const energyByWavelength=waves.map(wavelength=>({wavelength,...systemEnergy()}));
    const spectralLedger=new Map(energyByWavelength.map(row=>[row.wavelength,row]));
    function recordObject(id,wavelength,index,atHit){
      const profile=profiles.get(id),line=profile.byWavelength.find(item=>item.wavelength===wavelength);
      for(const bucket of [profile,line]){
        bucket.incident[index]+=atHit.incident;
        bucket.outgoing[index]+=atHit.scattered+atHit.reflected+atHit.transmitted;
        for (const key of Object.keys(atHit)) bucket.energy[key]+=atHit[key];
      }
      spectralLedger.get(wavelength).absorbed+=atHit.absorbed;
    }
    let emittedCount=0;
    for(const field of fields)for(const wavelength of waves)for(let i=0;i<count;i++){
      const pupil=2*i/(count-1)-1;
      const offset=field+(s.type==='collimated'?pupil*(s.width??20)/2:0);
      const origin=along({x:s.x,y:s.y??0},transverse,offset);
      const rayAngle=(s.angle??0)+(s.type==='collimated'?0:pupil*(s.spread??5));
      const sourceId=emittedCount++;
      const ledger=spectralLedger.get(wavelength);
      ledger.emitted++;
      const paths=traceFamily({sourceId,origin,field,pupil,wavelength,sourceStokes,direction:direction(rayAngle)},optics,scene.tail??800,recordObject,ledger);
      for(const ray of paths){
        ray.id=rays.length;
        rays.push(ray);
        if (ray.status==='limit') ledger.unresolved+=ray.weight;
        else if (ray.status==='blocked'||ray.status==='evanescent') ledger.blocked+=ray.intercepted;
        else ledger[ray.status]+=ray.weight;
        if(ray.status==='detected'){
          const h=ray.events.at(-1);
          // Express each incident state against the screen's marked tangent
          // before summing beams arriving from opposite sides of the detector.
          const screenStokes=h.forwardOnScreen ? ray.stokes : pol.reflect(ray.stokes);
          byId.get(h.elementId).hits.push({rayId:ray.id,sourceId,x:h.x,globalY:h.y,y:h.localY,wavelength,field,pupil,
            weight:ray.weight,stokes:ray.stokes,screenStokes,objectHits:ray.objectHits});
        }
      }
    }
    for(const d of detectors){
      if(!d.hits.length)continue;
      d.weight=d.hits.reduce((sum,h)=>sum+h.weight,0);
      d.centroid=d.hits.reduce((sum,h)=>sum+h.weight*h.y,0)/d.weight;
      d.rms=Math.sqrt(d.hits.reduce((sum,h)=>sum+h.weight*(h.y-d.centroid)**2,0)/d.weight);
      d.stokes=pol.average(d.hits);
    }
    if(rays.some(r=>r.status==='limit' && r.limitReason!=='branch'))warnings.push('部分光线已达到 64 次交互上限，剩余权重计入未追完');
    const energy=systemEnergy();
    for (const row of energyByWavelength)
      for (const key of Object.keys(energy)) energy[key]+=row[key];
    const reference=s.wavelength??550;
    const lensMetrics=scene.elements.filter(e=>e.type==='lens').map(e=>lensParaxial(e,reference));
    return {warnings,rays,wavelengths:waves,paraxial:paraxial(scene,reference),lensMetrics,detectors,objects,emittedCount,energy,energyByWavelength,
      byWavelength:waves.map(wavelength=>({...paraxial(scene,wavelength),wavelength}))};
  }
  return {materials,indexAt,surfaceFocalLength,radiusFromSurfaceFocus,lensParaxial,sag,validateLens,validateObject,cellFractions,patternAt,validateScene,simulate,paraxial};
});
