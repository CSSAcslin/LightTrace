/* Transverse Jones fields, lengths in mm. Time convention exp(-i omega t).
 * Each component is a complex envelope on cell-centred samples. A shared
 * spherical carrier is kept analytically to avoid sampling a lens chirp.
 */
(function(root,factory){
  if(typeof module==='object' && module.exports) module.exports=factory(require('./advanced-optics.js'),require('./polarization.js'),()=>require('./wave-scene.js'));
  else root.WaveSolver=factory(root.AdvancedOptics,root.Polarization,()=>root.WaveScene);
})(globalThis,function createSolver(optics,polarization,getScene){
  'use strict';
  const TAU=2*Math.PI, rad=Math.PI/180;
  const keys=['incident','absorbed','reflected','internal','scattered','blocked','bypass','detected','numerical','remaining'];
  const ledger=()=>Object.fromEntries(keys.map(k=>[k,0]));
  const cache=new Map();

  function fftPlan(n){
    if(cache.has(n)) return cache.get(n);
    const rev=new Int32Array(n), cos=new Float64Array(n/2), sin=new Float64Array(n/2);
    for(let j=1;j<n;j++)rev[j]=(rev[j>>1]>>1)|((j%2)*(n>>1));
    for(let j=0;j<n/2;j++){cos[j]=Math.cos(TAU*j/n);sin[j]=Math.sin(TAU*j/n);}
    const p={rev,cos,sin};cache.set(n,p);return p;
  }
  function fft2(a,n,inverse=false){
    const {rev,cos,sin}=fftPlan(n);
    for(const stride of [1,n]){
      for(let line=0;line<n;line++){
        const start=stride===1?line*n:line;
        for(let j=0;j<n;j++)if(j<rev[j]){
          const k=2*(start+j*stride), l=2*(start+rev[j]*stride);
          const r=a[k],i=a[k+1];a[k]=a[l];a[k+1]=a[l+1];a[l]=r;a[l+1]=i;
        }
        for(let len=2;len<=n;len*=2){
          const half=len/2, step=n/len;
          for(let base=0;base<n;base+=len)for(let j=0;j<half;j++){
            const k=2*(start+(base+j)*stride),l=k+2*half*stride;
            const c=cos[j*step],s=(inverse?1:-1)*sin[j*step];
            const r=c*a[l]-s*a[l+1],i=s*a[l]+c*a[l+1];
            a[l]=a[k]-r;a[l+1]=a[k+1]-i;a[k]+=r;a[k+1]+=i;
          }
        }
      }
    }
    if(inverse) for(let j=0;j<a.length;j++)a[j]/=n*n;
  }
  function rotate(a,k,c,s){
    const r=a[k],i=a[k+1];a[k]=r*c-i*s;a[k+1]=r*s+i*c;
  }
  // Cell-centred 2-D Fourier transform including both half-pixel phase ramps.
  function centeredFFT(a,n,backward){
    const sign=backward?1:-1, o=(n-1)/2, c=[],s=[];
    for(let j=0;j<2*n;j++){const h=-sign*TAU*o*j/n;c.push(Math.cos(h));s.push(Math.sin(h));}
    for(let y=0;y<n;y++)for(let x=0;x<n;x++)rotate(a,2*(y*n+x),c[x+y],s[x+y]);
    fft2(a,n,backward);
    const gain=backward?n*n:1;
    for(let j=0;j<2*n;j++){
      const h=sign*TAU*(2*o*o-o*j)/n;c[j]=gain*Math.cos(h);s[j]=gain*Math.sin(h);
    }
    for(let y=0;y<n;y++)for(let x=0;x<n;x++)rotate(a,2*(y*n+x),c[x+y],s[x+y]);
  }
  function intensity(a,b,j){return a[j]**2+a[j+1]**2+b[j]**2+b[j+1]**2;}
  function power(g){
    let p=0;for(let j=0;j<g.a.length;j+=2)p+=intensity(g.a,g.b,j);
    return p*(g.width/g.n)**2;
  }
  const occupied=a=>a.some(v=>v!==0);
  function translateEnvelope(g,d,exact){
    const {n,lambda}=g, m=2*n, pitch=g.width/n, span=m*pitch;
    const before=power(g);
    const H=new Float64Array(2*m*m);
    const axisLimit=1/(lambda*Math.hypot(1,2*d/span));
    for(let r=0;r<m;r++)for(let c=0;c<m;c++){
      const fy=(c<m/2?c:c-m)/span, fz=(r<m/2?r:r-m)/span;
      const f2=fy*fy+fz*fz, t=lambda*lambda*f2, k=2*(r*m+c);
      if(t>=1 || Math.abs(fy)>axisLimit || Math.abs(fz)>axisLimit)continue;
      // Rationalized sqrt(1-t)-1 retains precision near the optical axis.
      const h=exact?-TAU*d*lambda*f2/(1+Math.sqrt(1-t)):-Math.PI*d*lambda*f2;
      H[k]=Math.cos(h);H[k+1]=Math.sin(h);
    }
    for(const a of [g.a,g.b]){
      if(!occupied(a))continue;
      const t=new Float64Array(2*m*m);
      for(let r=0;r<n;r++)t.set(a.subarray(2*r*n,2*(r+1)*n),2*((r+n/2)*m+n/2));
      fft2(t,m);
      for(let k=0;k<t.length;k+=2)rotate(t,k,H[k],H[k+1]);
      fft2(t,m,true);
      for(let r=0;r<n;r++){
        const j=2*((r+n/2)*m+n/2);a.set(t.subarray(j,j+2*n),2*r*n);
      }
    }
    g.book.numerical+=Math.max(0,before-power(g));
  }

  function propagate(g,d,axial=d){
    if(!d){g.opl+=axial;return;}
    g.shadows=[];
    const {n,width,lambda,K}=g, m=1+d*K, natural=lambda*Math.abs(d)*n/width;
    if(Math.abs(m)*width<=natural){
      // Single scaled Fresnel transform. Only the residual pupil chirp is sampled.
      if(g.a){
        const coeff=Math.PI*(K+1/d)/lambda, dx=width/n, norm=dx*dx/(lambda*d);
        for(const a of [g.a,g.b]){
          if(!occupied(a))continue;
          for(let r=0;r<n;r++)for(let c=0;c<n;c++){
            const h=coeff*dx*dx*((r+.5-n/2)**2+(c+.5-n/2)**2);
            rotate(a,2*(r*n+c),Math.cos(h),Math.sin(h));
          }
          centeredFFT(a,n,d<0);
          for(let j=0;j<a.length;j+=2)rotate(a,j,0,-norm);
        }
      }
      g.width=natural;g.K=1/d;
    }else{
      if(g.a){
        translateEnvelope(g,d/m,K===0 && g.slope===0);
        for(const a of [g.a,g.b]){
          if(m<0)for(let k=0;k<a.length/2;k+=2){
            const l=a.length-2-k, re=a[k],im=a[k+1];a[k]=a[l];a[k+1]=a[l+1];a[l]=re;a[l+1]=im;
          }
          if(m!==1)for(let k=0;k<a.length;k++)a[k]/=m;
        }
      }
      g.width=width*Math.abs(m);g.K=K/m;
    }
    g.opl+=axial+d*g.slope*g.slope/2;
    g.cy+=d*g.slope;
  }
  function refract(g,p,y){
    const dy=g.cy-y;
    g.opl-=.5*p*dy*dy;g.slope-=p*dy;g.K-=p;
  }
  function modes(source){
    const [q,u,v]=polarization.sourceState(source),P=Math.min(1,Math.hypot(q,u,v));
    let a=1,b=0,c=0;
    if(P>0){
      a=Math.sqrt(Math.max(0,(1+q/P)/2));
      if(a>1e-12){b=u/(2*P*a);c=v/(2*P*a);}else b=1;
    }
    const out=[{a:[a,0],b:[b,c],weight:(1+P)/2}];
    if(1-P>1e-12)out.push({a:[-b,c],b:[a,0],weight:(1-P)/2});
    return out;
  }
  function input(source,n,width,wavelength,offset,pol,real){
    const lambda=wavelength*1e-6, point=source.type==='point'||source.type==='field';
    const na=Math.sin((source.spread??5)*rad);
    if(point&&(!(na>0)||na>.35))throw Error('点源发散半角需大于零且位于近轴范围（约 20° 以内）。');
    // A point emitter has a uniformly filled angular pupil with the inherited NA.
    // Sample it on its own fine grid; downstream scaled diffraction sets its footprint.
    if(point)width=n*lambda/(2.5*na);
    const g={n,width,lambda,wavelength,K:0,cy:(source.y??0)+offset,cz:source.z??0,slope:Math.tan((source.angle??0)*rad),opl:0,book:ledger(),samplingNotes:new Set(),shadows:[]};
    if(!real)return g;
    g.a=new Float64Array(2*n*n);g.b=new Float64Array(2*n*n);
    const radius=point?na/lambda:(source.width??1)/2;
    if(!point && 2*radius>width*(1+1e-12))throw Error('光源直径超过输入计算视场，请增大视场。');
    const step=point?1/width:width/n;
    for(let r=0;r<n;r++)for(let c=0;c<n;c++){
      if(((c+.5-n/2)**2+(r+.5-n/2)**2)*step*step<=radius*radius)g.a[2*(r*n+c)]=1;
    }
    if(point)centeredFFT(g.a,n,true);
    const total=power(g);
    if(!total)throw Error('输入网格未分辨出光源，请缩小视场或增加采样。');
    const scale=1/Math.sqrt(total);
    for(let j=0;j<g.a.length;j+=2){
      g.b[j]=g.a[j];g.b[j+1]=g.a[j+1];
      rotate(g.a,j,pol.a[0]*scale,pol.a[1]*scale);rotate(g.b,j,pol.b[0]*scale,pol.b[1]*scale);
    }
    return g;
  }

  function surface(g,e,capture,opts){
    if(!g.a || e.type==='probe')return;
    const {a,b,n,book}=g,pitch=g.width/n,cell=pitch*pitch,ap=(e.aperture??Infinity)/2;
    const axis=(e.axisAngle??0)*rad, ca=Math.cos(axis),sa=Math.sin(axis);
    const retard=(e.retardance??90)*rad*(e.referenceWavelength??550)/g.wavelength;
    const cr=Math.cos(retard),sr=Math.sin(retard);
    const map=e.map, index=e.n??1, depth=e.thickness??0;
    const F=depth>0?((index-1)/(index+1))**2:0;
    const beforeBypass=book.bypass;
    const rect=e.type==='screen'?square(e.y??0,e.z??0,ap):null;
    if(map && Math.min(map.width,map.height)/map.size<pitch*.95)
      g.samplingNotes.add('物体「'+(e.name??e.id)+'」的材料格比传播采样更细，细节可能混叠。可缩小输入视场或提高网格分辨率。');
    if(2*ap<4*pitch)
      g.samplingNotes.add('「'+(e.name??e.id)+'」的口径不足四个采样点，截光量与衍射形状仅供预览。');
    for(let row=0;row<n;row++)for(let col=0;col<n;col++){
      const j=2*(row*n+col),y=g.cy-(e.y??0)+(col+.5-n/2)*pitch;
      const z=g.cz-(e.z??0)+(n/2-row-.5)*pitch,r2=y*y+z*z;
      const inc=intensity(a,b,j)*cell;
      if(!inc)continue;
      let amp=1,h=0;
      switch(e.type){
        case 'thinLens':case 'lens':
          if(r2>ap*ap){book.bypass+=inc;amp=0;}break;
        case 'rim':
          if(r2>ap*ap){book.blocked+=inc;amp=0;}break;
        case 'stop':{
          const outer=(e.outerDiameter??Math.max(2*ap+40,100))/2;
          if(r2>ap*ap&&r2<=outer*outer){book.blocked+=inc;amp=0;}break;
        }
        case 'screen':{
          let hit=squareCoverage(y,z,pitch,ap);
          if(hit>0 && g.shadows.length){
            const cellRect=square(y+(e.y??0),z+(e.z??0),pitch/2);
            const free=visibleArea(cellRect,g.shadows),fresh=visibleArea(intersection(cellRect,rect),g.shadows);
            hit=free>0?Math.min(1,fresh/free):0;
          }
          book.detected+=inc*hit;
          if(capture)book.remaining+=inc*(1-hit);
          amp=Math.sqrt(capture?hit:1-hit);break;
        }
        case 'phase':
          if(r2<=ap*ap)h=TAU*(e.opd??0)*1e-6/g.lambda;
          break;
        case 'object':{
          const c=Math.floor((y/map.width+.5)*map.size),r=Math.floor((.5-z/map.height)*map.size);
          if(c<0||c>=map.size||r<0||r>=map.size)break;
          const i=c+r*map.size;
          // An index-matched Mie particle has no scattering contrast.
          const matched=e.scatterModel==='mie' && Math.abs((e.mieIndex??0)-1)<1e-12;
          const t=map.t[i]+(matched?map.s[i]:0),s=matched?0:map.s[i],refl=map.r[i];
          book.absorbed+=inc*Math.max(0,1-t-s-refl);book.scattered+=inc*s;
          book.reflected+=inc*(refl+t*F);book.internal+=inc*t*(1-F)*F;
          amp=Math.sqrt(t)*(1-F);
          h=TAU*((map.opd[i]??0)*1e-6+(index-1)*depth)/g.lambda;break;
        }
        case 'polarizer':case 'retarder':{
          if(r2>ap*ap)break;
          const fr=ca*a[j]+sa*b[j],fi=ca*a[j+1]+sa*b[j+1];
          const slowR=-sa*a[j]+ca*b[j], slowI=-sa*a[j+1]+ca*b[j+1];
          const tr=e.type==='polarizer'?0:cr*slowR-sr*slowI;
          const ti=e.type==='polarizer'?0:sr*slowR+cr*slowI;
          a[j]=ca*fr-sa*tr;a[j+1]=ca*fi-sa*ti;
          b[j]=sa*fr+ca*tr;b[j+1]=sa*fi+ca*ti;
          if(e.type==='polarizer')book.absorbed+=(slowR*slowR+slowI*slowI)*cell;
          break;
        }
      }
      if(amp!==1||h!==0){const c=amp*Math.cos(h),s=amp*Math.sin(h);rotate(a,j,c,s);rotate(b,j,c,s);}
    }
    if(rect){
      if(capture)g.activeCamera=rect;
      else g.shadows.push(rect);
    }
    if(book.bypass-beforeBypass>1e-6&&!opts.throughOnly)
      throw Error((e.name??e.id)+' 孔径外存在旁路光。可添加光阑，或勾选仅计算过镜分量。');
  }
  function trace(g,scene,opts){
    const target=opts.plane;
    if(target==='source')return;
    const sourceX=scene.source.x??0;
    let x=sourceX;
    for(const e of [...scene.elements].sort((a,b)=>a.x-b.x)){
      const selected=e.id===target;
      if(e.type==='probe'&&!selected)continue;
      if(!selected && isIdentity(e))continue;
      const extent=(e.thickness??0)+Math.abs(Math.sin((e.angle??0)*rad))*(e.aperture??0)/2;
      if(e.x+extent<sourceX-1e-8&&!selected)continue;
      if(e.x<x-1e-8)throw Error((e.name??e.id)+' 位于光源后方或与上一件厚元件重叠，顺序传播模型无法到达。');
      propagate(g,Math.max(0,e.x-x));x=e.x;
      if(selected && opts.side==='before'){
        if(Math.abs((e.angle??0)%360)>1e-9)throw Error('倾斜观察面需要在旋转坐标中取样，请在器件之前插入正交截面。');
        return;
      }
      const status=getScene()?.elementStatus?.(e);
      if(status?.state==='blocked')throw Error((e.name??e.id)+'：'+(status.detail||status.reason||'该器件需要折叠或非共轴传播。'));
      if(!['lens','thinLens','phase','object','stop','polarizer','retarder','screen','probe'].includes(e.type))
        throw Error((e.name??e.id)+' 的二维传播尚未支持。');
      if(e.type==='object'&&!e.map)throw Error('物体缺少二维材料图。');
      const capture=selected&&e.type==='screen';
      surface(g,e,capture,opts);
      if(e.type==='thinLens')refract(g,1/e.focalLength,e.y??0);
      if(e.type==='lens'){
        // Equivalent to the principal-plane ABCD pair, including the two
        // vertex planes and the physical carrier optical path inside glass.
        const nGlass=optics.indexAt(e.material,g.wavelength,e.n);
        if(e.r1)refract(g,(nGlass-1)/e.r1,e.y??0);
        propagate(g,e.thickness/nGlass,e.thickness*nGlass);
        surface(g,{...e,type:'rim'},false,opts);
        if(e.r2)refract(g,(1-nGlass)/e.r2,e.y??0);
        x+=e.thickness;
      }
      if(selected){g.captured=capture;return;}
    }
    throw Error('未找到观察截面。');
  }
  function isIdentity(e){
    if(e.angle||e.wedge)return false;
    if(e.type==='phase')return (e.opd??0)===0;
    if(e.type==='retarder')return e.retardance===0;
    return e.type==='object' && (e.n??1)===1 && e.map &&
      e.map.t.every(x=>x===1) && e.map.opd.every(x=>x===0) &&
      e.map.s.every(x=>x===0) && e.map.r.every(x=>x===0);
  }
  // Exact overlap of source and detector pixel intervals. All spectral
  // slices accumulate on ONE physical grid; the integral survives resizing.
  function overlaps(n,pitch,offset,outPitch){
    const list=[];
    for(let j=0;j<n;j++){
      const lo=((j-n/2)*pitch+offset)/outPitch+n/2,hi=lo+pitch/outPitch,parts=[];
      for(let k=Math.max(0,Math.floor(lo));k<Math.min(n,Math.ceil(hi));k++){
        const fraction=Math.min(k+1,hi)-Math.max(k,lo);
        if(fraction>0)parts.push([k,fraction]);
      }
      list.push(parts);
    }
    return list;
  }
  function accumulate(g,out,line,weight,wantPhase,axis,viewY,viewZ){
    const {a,b,n}=g,dx=g.width/n,pitch=out.width/n;
    const ys=overlaps(n,dx,g.cy-viewY,pitch),zs=overlaps(n,dx,viewZ-g.cz,pitch);
    for(let r=0;r<n;r++)for(let c=0;c<n;c++){
      const j=2*(r*n+c), py=a[j]**2+a[j+1]**2,pz=b[j]**2+b[j+1]**2;
      if(py+pz===0)continue;
      const U=2*(a[j]*b[j]+a[j+1]*b[j+1]),V=2*(a[j]*b[j+1]-a[j+1]*b[j]);
      const y=g.cy+(c+.5-n/2)*dx,z=g.cz+(n/2-r-.5)*dx;
      const clipped=pixelSupport(g,y,z,dx);
      for(const [r2,h] of zs[r])for(const [c2,w] of ys[c]){
        let fraction=h*w;
        if(clipped){
          const pixel=square(viewY+(c2+.5-n/2)*pitch,viewZ+(n/2-r2-.5)*pitch,pitch/2);
          fraction=supportedOverlap(clipped,pixel,pitch);
        }
        const k=r2*n+c2,kWeight=fraction*weight;
        line.i[k]+=(py+pz)*kWeight;line.q[k]+=(py-pz)*kWeight;
        line.u[k]+=U*kWeight;line.v[k]+=V*kWeight;
      }
    }
    if(g.width/n<pitch/2)
      g.samplingNotes.add('输出像素比局部传播采样宽两倍以上，细节已按像素面积合并。');
    if(pitch<dx*.75)
      g.samplingNotes.add('显示像素小于传播网格采样，放大仅能查看已有采样。请加密网格检验细节。');
    if(!wantPhase)return;
    const field=axis==='z'?b:a;
    let peak=0;for(let j=0;j<a.length;j+=2)peak=Math.max(peak,intensity(a,b,j));
    let aliased=false;
    for(let r=0;r<n;r++)for(let c=0;c<n;c++){
      const y=(c+.5-n/2)*pitch+viewY-g.cy,z=(n/2-r-.5)*pitch+viewZ-g.cz;
      const contains=r=>g.cy+y>=r[0]&&g.cy+y<=r[1]&&g.cz+z>=r[2]&&g.cz+z<=r[3];
      if((g.activeCamera&&!contains(g.activeCamera))||g.shadows.some(contains))continue;
      const py=y/dx+n/2-.5,pz=n/2-.5-z/dx;
      if(py<-.5||py>n-.5||pz<-.5||pz>n-.5)continue;
      const left=Math.floor(py),top=Math.floor(pz);let re=0,im=0;
      for(let dr=0;dr<2;dr++)for(let dc=0;dc<2;dc++){
        const cc=Math.max(0,Math.min(n-1,left+dc)),rr=Math.max(0,Math.min(n-1,top+dr));
        const j=2*(rr*n+cc),w=(dc?py-left:1-py+left)*(dr?pz-top:1-pz+top);
        re+=field[j]*w;im+=field[j+1]*w;
      }
      if(re*re+im*im<=peak*1e-12)continue;
      if(Math.max(Math.abs(g.K*y+g.slope),Math.abs(g.K*z))*pitch>g.lambda*.5){
        aliased=true;continue;
      }
      const opl=g.opl+g.slope*y+.5*g.K*(y*y+z*z), phase=Math.atan2(im,re)+TAU*((opl/g.lambda)%1);
      out.phase[r*n+c]=Math.atan2(Math.sin(phase),Math.cos(phase));
    }
    if(aliased)out.phaseReason='参考波前局部斜率超过显示采样，相应相位像素已遮罩。';
  }

  // Four-step demodulation receives only measured intensities. Phase is the
  // argument of O conj(R) when the controlled reference shift is +delta.
  function reconstruct(frames){
    const [i0,i90,i180,i270]=frames;
    const phase=new Float32Array(i0.length).fill(NaN), visibility=new Float32Array(i0.length);
    for(let j=0;j<i0.length;j++){
      const re=i0[j]-i180[j],im=i90[j]-i270[j],dc=i0[j]+i180[j];
      if(dc<=0)continue;
      visibility[j]=Math.min(1,Math.hypot(re,im)/dc);
      if(visibility[j]>=.01)phase[j]=Math.atan2(im,re);
    }
    return {phase,visibility};
  }
  const sinc=x=>Math.abs(x)<1e-8?1:Math.sin(x)/x;
  const square=(y,z,half)=>[y-half,y+half,z-half,z+half];
  const area=r=>(r[1]-r[0])*(r[3]-r[2]);
  function intersection(a,b){
    const r=[Math.max(a[0],b[0]),Math.min(a[1],b[1]),Math.max(a[2],b[2]),Math.min(a[3],b[3])];
    return r[0]<r[1]&&r[2]<r[3]?r:null;
  }
  // Disjoint rectangle fragments after subtracting the earlier cameras at
  // this axial position. A propagation step begins a fresh observation plane.
  function visiblePieces(rect,shadows){
    if(!rect)return [];
    let pieces=[rect];
    for(const cut of shadows){
      const next=[];
      for(const p of pieces){
        const k=intersection(p,cut);
        if(!k){next.push(p);continue;}
        if(p[0]<k[0])next.push([p[0],k[0],p[2],p[3]]);
        if(k[1]<p[1])next.push([k[1],p[1],p[2],p[3]]);
        if(p[2]<k[2])next.push([k[0],k[1],p[2],k[2]]);
        if(k[3]<p[3])next.push([k[0],k[1],k[3],p[3]]);
      }
      pieces=next;
      if(!pieces.length)break;
    }
    return pieces;
  }
  const visibleArea=(rect,shadows)=>visiblePieces(rect,shadows).reduce((sum,r)=>sum+area(r),0);
  function pixelSupport(g,y,z,dx){
    if(!g.activeCamera&&!g.shadows.length)return null;
    const rect=square(y,z,dx/2);
    const pieces=visiblePieces(g.activeCamera?intersection(rect,g.activeCamera):rect,g.shadows);
    const fraction=pieces.reduce((sum,p)=>sum+area(p),0)/(dx*dx);
    return fraction>=1-1e-10?null:{pieces,fraction};
  }
  function supportedOverlap(support,pixel,pitch){
    if(!support.fraction)return 0;
    let covered=0;
    for(const piece of support.pieces){
      const part=intersection(piece,pixel);
      if(part)covered+=area(part);
    }
    return covered/(pitch*pitch*support.fraction);
  }
  function squareCoverage(y,z,dx,half){
    const cover=u=>Math.max(0,Math.min(dx/2,half-u)-Math.max(-dx/2,-half-u))/dx;
    return cover(y)*cover(z);
  }
  function measure(g,out,scene,opts,target){
    const {n}=g, count=n*n, pitch=out.width/n, dx=g.width/n;
    const yCenter=out.centerY,zCenter=out.centerZ;
    const refWidth=g.captured?Math.min(out.width,target.aperture):out.width;
    const refA=1/refWidth;
    const sourceX=scene.source.x??0;
    const screenX=target?(target.x+(target.type==='lens'&&opts.side==='after'?target.thickness:0)):sourceX;
    const refOpl=screenX-sourceX+(opts.referenceOPD??0)*1e-6;
    const offset=TAU*((refOpl/g.lambda)%1);
    const referencePhaseRad=Math.atan2(Math.sin(offset),Math.cos(offset));
    const rows=overlaps(n,dx,zCenter-g.cz,pitch),cols=overlaps(n,dx,g.cy-yCenter,pitch);
    const sample=new Float64Array(count),crossR=new Float64Array(count),crossI=new Float64Array(count);
    const undersampled=new Uint8Array(count),field=opts.phaseAxis==='z'?g.b:g.a;
    for(let r=0;r<n;r++)for(let c=0;c<n;c++){
      const j=2*(r*n+c),re=field[j],im=field[j+1],p=re*re+im*im;
      if(!p)continue;
      const y=(c+.5-n/2)*dx,z=(n/2-r-.5)*dx;
      const yLo=g.cy+y-dx/2,zLo=g.cz+z-dx/2;
      const support=pixelSupport(g,g.cy+y,g.cz+z,dx);
      const inputAmp=support?Math.sqrt(support.fraction):1;
      if(!inputAmp)continue;
      for(const [row,h] of rows[r])for(const [col,w] of cols[c]){
        const k=row*n+col,area=w*h;
        const pixel=square(yCenter+(col+.5-n/2)*pitch,zCenter+(n/2-row-.5)*pitch,pitch/2);
        sample[k]+=p*(support?supportedOverlap(support,pixel,pitch):area);
        // Integrate the carrier tilt over the pixel overlap. The envelope is
        // piecewise constant on native cells; mask large unresolved curvature.
        const yl=Math.max(yLo,yCenter+(col-n/2)*pitch,yCenter-refWidth/2);
        const yh=Math.min(yLo+dx,yCenter+(col+1-n/2)*pitch,yCenter+refWidth/2);
        const zl=Math.max(zLo,zCenter+(n/2-row-1)*pitch,zCenter-refWidth/2);
        const zh=Math.min(zLo+dx,zCenter+(n/2-row)*pitch,zCenter+refWidth/2);
        if(yl>=yh||zl>=zh)continue;
        for(const rect of visiblePieces([yl,yh,zl,zh],g.shadows)){
          const [y0,y1,z0,z1]=rect,ym=(y0+y1)/2-g.cy,zm=(z0+z1)/2-g.cz;
          const gy=(g.slope+g.K*ym)/g.lambda,gz=g.K*zm/g.lambda;
          const carrier=TAU*(((g.opl-refOpl+g.slope*ym+g.K*(ym*ym+zm*zm)/2)/g.lambda)%1);
          const cos=Math.cos(carrier),sin=Math.sin(carrier);
          const gain=(refA/inputAmp)*(y1-y0)*(z1-z0)/(pitch*pitch)*sinc(Math.PI*gy*(y1-y0))*sinc(Math.PI*gz*(z1-z0));
          crossR[k]+=(re*cos-im*sin)*gain;crossI[k]+=(re*sin+im*cos)*gain;
          if(Math.max(Math.abs(gy),Math.abs(gz))*pitch>.5||Math.abs(g.K)*dx*dx/g.lambda>.5)undersampled[k]=1;
        }
      }
    }
    const frames=Array.from({length:4},()=>new Float32Array(count));
    const framePowers=[0,0,0,0],complementaryPowers=[0,0,0,0];
    for(let row=0;row<n;row++)for(let col=0;col<n;col++){
      const j=row*n+col;
      const fraction=k=>Math.max(0,Math.min((k+1-n/2)*pitch,refWidth/2)-Math.max((k-n/2)*pitch,-refWidth/2))/pitch;
      const refI=refA**2*fraction(row)*fraction(col);
      const dc=(sample[j]+refI)/4, quadratures=[crossR[j],crossI[j],-crossR[j],-crossI[j]];
      for(let step=0;step<4;step++){
        const ac=quadratures[step]/2;
        frames[step][j]=Math.max(0,dc+ac);
        framePowers[step]+=frames[step][j]*pitch*pitch;
        complementaryPowers[step]+=Math.max(0,dc-ac)*pitch*pitch;
      }
    }
    const {phase,visibility}=reconstruct(frames);
    for(let j=0;j<count;j++)if(undersampled[j])phase[j]=NaN;
    return {frames,phase,visibility,referenceOPD:opts.referenceOPD??0,referencePhaseRad,referenceWidth:refWidth,
      framePowers,complementaryPowers,visibilityThreshold:.01};
  }

  function run(scene,options={}){
    const opts={n:256,width:4,plane:scene.elements.at(-1)?.id??'source',side:'after',phaseLine:0,phaseAxis:'y',mode:0,...options};
    const {n}=opts;
    const out={n,width:opts.width,lines:[],phase:null,phaseLine:opts.phaseLine,phaseAxis:opts.phaseAxis,mode:opts.mode,warnings:[],ledger:ledger(),
      viewPower:0,outsideViewPower:0,fullPlanePower:0};
    try{
      if(!Number.isInteger(n)||n<32||n>512||(n&(n-1))||!(opts.width>0)||!Number.isFinite(opts.width))
        throw Error('网格需为 32 至 512 之间的二次幂，输入视场需为有限正数。');
      if(!Number.isFinite(opts.outputWidth??0)||(opts.outputWidth??0)<0)throw Error('观察视场需为有限正数，自动取景填零。');
      const source=scene.source, wavelengths=getScene().wavelengths(source), pols=modes(source),notes=new Set();
      if(Math.abs(source.angle??0)>20)throw Error('光源方向超过正向近轴模型范围。');
      const offsets=source.type==='field'&&source.height>0?[-source.height/2,0,source.height/2]:[0];
      const target=scene.elements.find(e=>e.id===opts.plane);
      const viewY=target?.y??source.y??0,viewZ=target?.z??source.z??0;
      out.centerY=viewY;out.centerZ=viewZ;
      out.width=0;
      let minPitch=Infinity,maxPitch=0;
      for(const {wavelength} of wavelengths)for(const offset of offsets){
        const g=input(source,n,opts.width,wavelength,offset,null,false);
        trace(g,scene,opts);out.width=Math.max(out.width,g.width+2*Math.max(Math.abs(g.cy-viewY),Math.abs(g.cz-viewZ)));
        minPitch=Math.min(minPitch,g.width/n);maxPitch=Math.max(maxPitch,g.width/n);
      }
      if(!(out.width>0)||!Number.isFinite(out.width))throw Error('光路产生了无效的采样范围。');
      out.autoWidth=out.width;
      if(opts.outputWidth>0)out.width=opts.outputWidth;
      out.nativePitchMin=minPitch;out.nativePitchMax=maxPitch;out.pixelPitch=out.width/n;
      out.phase=new Float32Array(n*n).fill(NaN);
      if(pols.length>1)out.phaseReason='混合偏振照明没有唯一的 Jones 复场相位。请选择完全偏振照明查看投影相位。';
      else if(!wavelengths[opts.phaseLine]||opts.mode<0||opts.mode>=offsets.length)
        out.phaseReason='选定谱线或空间模式不在当前照明中。';
      if(opts.interferometer){
        if(wavelengths.length!==1||offsets.length!==1||pols.length!==1)
          out.measurementReason='四步移相检测需要单色、完全偏振的单一空间模式照明。';
        else if(!Number.isFinite(opts.referenceOPD??0))out.measurementReason='参考臂光程差无效。';
      }
      for(const [li,{wavelength,weight}] of wavelengths.entries()){
        const line={wavelength,weight};
        for(const name of ['i','q','u','v'])line[name]=new Float32Array(n*n);
        for(const [mode,offset] of offsets.entries())for(const pol of pols){
          const g=input(source,n,opts.width,wavelength,offset,pol,true);
          g.book.incident=1;trace(g,scene,opts);
          if(!g.captured)g.book.remaining=power(g);
          const share=pol.weight/offsets.length;
          out.fullPlanePower+=share*weight*(g.captured?power(g):g.book.remaining);
          accumulate(g,out,line,share,li===opts.phaseLine&&mode===opts.mode&&pols.length===1,opts.phaseAxis,viewY,viewZ);
          if(opts.interferometer&&!out.measurementReason)out.measurement=measure(g,out,scene,opts,target);
          for(const note of g.samplingNotes)notes.add(note);
          for(const k of keys)out.ledger[k]+=g.book[k]*share*weight;
        }
        out.viewPower+=line.i.reduce((sum,value)=>sum+value,0)*(out.width/n)**2*weight;
        out.lines.push(line);
      }
      out.outsideViewPower=Math.max(0,out.fullPlanePower-out.viewPower);
      const b=out.ledger;
      if(b.bypass>1e-6)out.warnings.push('仅显示过镜分量，透镜外旁路功率单独记账。');
      if(b.scattered+b.reflected+b.internal>1e-8)out.warnings.push('当前图为直透分量，反射和散射支路单独记账。');
      if(b.numerical>.001)out.warnings.push('有限计算窗口或传播带限损失 '+(100*b.numerical).toFixed(2)+'%，请扩大输入视场并加密网格比较。');
      out.warnings.push(...notes);
      return out;
    }catch(error){out.blocked=error.message;out.lines=[];out.phase=null;return out;}
  }
  // Local file pages cannot import sibling scripts from a worker on all
  // browsers. Supply the identical numerical kernel as a blob, alongside
  // a small structured-clone table of the already evaluated shared models.
  function workerPacket(scene,options){
    const shared=getScene(),wavelengths=shared.wavelengths(scene.source);
    const indices={};
    for(const e of scene.elements.filter(e=>e.type==='lens'))for(const {wavelength} of wavelengths){
      indices[JSON.stringify([e.material,wavelength,e.n])]=optics.indexAt(e.material,wavelength,e.n);
    }
    return {scene,options,dependencies:{wavelengths,indices,stokes:polarization.sourceState(scene.source),
      status:Object.fromEntries(scene.elements.map(e=>[e.id,shared.elementStatus(e)]))}};
  }
  function acceptPacket(event){
    try{
      const {scene,options,dependencies:d}=event.data;
      const solver=createSolver({indexAt:(m,w,n)=>d.indices[JSON.stringify([m,w,n])]},
        {sourceState:()=>d.stokes},()=>({wavelengths:()=>d.wavelengths,elementStatus:e=>d.status[e.id]}));
      const result=solver.run(scene,options),buffers=[];
      for(const line of result.lines)for(const k of ['i','q','u','v'])buffers.push(line[k].buffer);
      if(result.phase)buffers.push(result.phase.buffer);
      if(result.measurement)for(const a of [...result.measurement.frames,result.measurement.phase,result.measurement.visibility])buffers.push(a.buffer);
      self.postMessage({result},buffers);
    }catch(error){self.postMessage({error:error.message});}
  }
  function createWorkerScript(){
    return "'use strict';\n"+createSolver.toString()+"\nself.onmessage="+acceptPacket.toString()+";";
  }
  return {run,workerPacket,createWorkerScript,reconstruct};
});
