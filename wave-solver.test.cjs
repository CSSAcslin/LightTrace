const test = require('node:test');
const assert = require('node:assert/strict');
const solver = require('./wave-solver.js');
const src = {type:'collimated', width:1, wavelength:550, spectrum:'mono', polarization:'linear', polAngle:0, x:0};
const probe = (x, id='probe') => ({type:'probe', x, id});
const lens = (x,id='lens') => ({type:'thinLens',id,x,focalLength:50,aperture:9});
function run(elements,opts={},source={}) {
  const result=solver.run({source:{...src,...source},elements},{plane:elements.at(-1).id,side:'after',width:4,n:128,throughOnly:true,...opts});
  assert.ok(!result.blocked,result.blocked);
  return result;
}
const power = r => r.lines[0].i.reduce((a,b)=>a+b,0)*(r.width/r.n)**2;
test('zero-distance phase step changes projected phase without changing intensity',()=>{
  const width=1, size=2, map={width,height:width,size,t:[1,1,1,1],r:[0,0,0,0],s:[0,0,0,0],opd:[0,137.5,0,137.5]};
  const a=run([{type:'object',id:'o',x:0,map},probe(0)]);
  const j=64*128+60,k=j+8;
  assert.ok(Math.abs(a.phase[k]-a.phase[j]-Math.PI/2)<1e-5);
  assert.equal(a.lines[0].i[j],a.lines[0].i[k]);
  assert.ok(Math.abs(power(a)-1)<1e-6);
});
test('two-dimensional 4f inverts both object axes',()=>{
  const size=4, t=new Array(16).fill(0);t[6]=1;
  const map={size,width:1,height:1,t,r:t.map(()=>0),s:t.map(()=>0),opd:t.map(()=>0)};
  const result=run([{type:'object',id:'o',map,x:0},lens(50),lens(150,'l2'),probe(200)]);
  const {i}=result.lines[0];let y=0,z=0,total=0;
  i.forEach((v,j)=>{total+=v;y+=v*((j%128)+0.5-64);z+=v*(64-0.5-Math.floor(j/128));});
  assert.ok(Math.abs(y/total*result.width/128+.125)<.035);
  assert.ok(Math.abs(z/total*result.width/128+.125)<.035);
});
test('QWP sign agrees with workstation and crossed polarizers extinguish',()=>{
  const a=run([{id:'p',type:'retarder',axisAngle:0,retardance:90,referenceWavelength:550,x:0},probe(0)],{}, {polAngle:45});
  const j=64*128+64;
  assert.ok(Math.abs(a.lines[0].v[j]/a.lines[0].i[j]-1)<1e-5);
  const b=run([{id:'p',type:'polarizer',axisAngle:90,x:0},probe(0)]);
  assert.ok(power(b)<1e-12);
});

test('cell-centred Fourier pupil yields Airy first minimum within 2% and conserves power',()=>{
  const result=run([lens(0),probe(50)],{n:256,width:8});
  const {n}=result,dx=result.width/n,cut=result.lines[0].i.subarray((n/2)*n+n/2);
  let j=1;
  while(j<n/2 && cut[j+1]<cut[j])j++;
  const offset=.5*(cut[j-1]-cut[j+1])/(cut[j-1]-2*cut[j]+cut[j+1]);
  const radius=dx*Math.hypot(j+.5+offset,.5);
  assert.ok(Math.abs(radius/(1.21967*.00055*50)-1)<.02, 'Airy radius '+radius);
  assert.ok(Math.abs(power(result)-1)<1e-6);
});

test('inherited 30 mm thick lens reaches the Airy scale at its back focal distance',()=>{
  const {presets}=require('./advanced-editor.js'),optics=require('./advanced-optics.js');
  const inherited={...presets.relay.elements[0],x:0};
  const lambda=546.074, m=optics.lensParaxial(inherited,lambda);
  const result=run([inherited,probe(m.backFocalX)],{n:256,width:240},{wavelength:lambda,width:30});
  const n=result.n,dx=result.width/n,cut=result.lines[0].i.subarray(n*n/2+n/2);
  let k=1;while(k<n/2&&cut[k+1]<cut[k])k++;
  const delta=.5*(cut[k-1]-cut[k+1])/(cut[k-1]-2*cut[k]+cut[k+1]);
  const radius=dx*Math.hypot(k+.5+delta,.5);
  assert.ok(Math.abs(radius/(1.21967*lambda*1e-6*m.efl/30)-1)<.02);
  assert.ok(Math.abs(power(result)-1)<.01);
});

test('broadband focal grids integrate each spectral slice without losing power',()=>{
  const a=run([lens(0),probe(50)],{width:8},{spectrum:'rgb'});
  const energies=a.lines.map(l=>l.i.reduce((a,b)=>a+b,0)*(a.width/a.n)**2);
  for(const e of energies)assert.ok(Math.abs(e-1)<1e-6);
  const peak=a.n*a.n/2+a.n/2;
  assert.ok(a.lines[0].i[peak]>a.lines[2].i[peak]); // shorter wavelength focuses tighter
});

test('double slit fringe period follows wavelength on one physical sensor grid',()=>{
  const size=64,t=Array.from({length:size*size},(_,j)=>[23,24,39,40].includes(j%size)?1:0);
  const map={size,width:1.28,height:1.28,t,r:t.map(()=>0),s:t.map(()=>0),opd:t.map(()=>0)};
  const result=run([{type:'object',id:'o',map,x:0},lens(0),probe(50)],{n:256,width:5.12},{spectrum:'rgb'});
  const periods=result.lines.map(line=>{
    const n=result.n,dx=result.width/n,cut=line.i.subarray(n*n/2+n/2);
    let j=1;while(j<n/2 && cut[j+1]<cut[j])j++;
    const off=.5*(cut[j-1]-cut[j+1])/(cut[j-1]-2*cut[j]+cut[j+1]);
    return 2*(j+.5+off)*dx;
  });
  for(let j=0;j<3;j++)assert.ok(Math.abs(periods[j]/(result.lines[j].wavelength*1e-6*50/.32)-1)<.035);
});

test('absorbing earlier cameras and non-invasive probes have distinct energy accounts',()=>{
  const screen={id:'screen',type:'screen',x:0,aperture:.5};
  const a=run([screen]), b=run([screen,probe(0)]);
  assert.ok(power(a)>0 && power(a)<1);
  assert.ok(Math.abs(power(a)+power(b)-1)<1e-6);
  assert.ok(Math.abs(a.ledger.detected-power(a))<1e-6);
  assert.ok(Math.abs(b.ledger.detected-power(a))<1e-6);
  const baseline=run([lens(50),lens(150,'l2'),probe(200)]);
  const intermediate=run([lens(50),probe(100,'p2'),lens(150,'l2'),probe(200)]);
  assert.deepEqual(baseline.lines[0].i,intermediate.lines[0].i);
});

test('mixed material power and two interface Fresnel passes are distinct',()=>{
  const map={size:1,width:2,height:2,t:[.5],r:[.1],s:[.2],opd:[0]};
  const a=run([{type:'object',id:'o',x:0,n:1.5,thickness:2,map}]);
  for(const [k,v] of Object.entries({remaining:.5*.96**2,absorbed:.2,reflected:.12,scattered:.2,internal:.5*.96*.04})){
    assert.ok(Math.abs(a.ledger[k]-v)<1e-6,k);
  }
  const b=run([{type:'object',id:'o',x:0,n:1,thickness:1,map,scatterModel:'mie',mieIndex:1}]);
  assert.ok(Math.abs(b.ledger.remaining-.7)<1e-6);
  assert.equal(b.ledger.scattered,0);
});

test('partial polarization adds coherency, masks global phase and obeys Malus',()=>{
  const a=run([{type:'polarizer',id:'p',x:0,axisAngle:0}],{}, {polDegree:.4});
  assert.ok(Math.abs(power(a)-.7)<1e-6);
  assert.ok(a.phase.every(Number.isNaN));
});

test('unsupported optics block only downstream observation planes',()=>{
  const scene={source:src,elements:[probe(0),{id:'m',x:5,type:'mirror'},probe(10,'end')]};
  assert.ok(!solver.run(scene,{n:64,width:4,plane:'probe'}).blocked);
  assert.ok(solver.run(scene,{n:64,width:4,plane:'end'}).blocked);
  const moved={source:{...src,x:2},elements:[{id:'m',x:0,type:'mirror'},probe(3)]};
  assert.ok(!solver.run(moved,{n:64,width:4,plane:'probe'}).blocked);
  assert.ok(solver.run(moved,{n:64,width:4,plane:'m'}).blocked);
});

test('offline worker runs the same dispersive thick-lens calculation from a cloneable packet',()=>{
  const sceneLib=require('./wave-scene.js'), advanced=require('./advanced-editor.js');
  const scene=sceneLib.fromPackage({format:'guangji.surface-workbench',version:1,scene:advanced.presets.relay});
  scene.source.spectrum='rgb';scene.source.type='collimated';scene.source.width=4;
  const options={...scene.settings,n:64,throughOnly:true};
  const expected=solver.run(scene,options);
  const nodeVM=require('node:vm');
  let message;
  const context={self:{postMessage:m=>message=m}};
  nodeVM.runInNewContext(solver.createWorkerScript(),context);
  context.self.onmessage({data:structuredClone(solver.workerPacket(scene,options))});
  assert.equal(expected.blocked,undefined);
  assert.equal(message.result.blocked,undefined);
  assert.equal(message.result.width,expected.width);
  assert.deepEqual([...message.result.lines[2].i],[...expected.lines[2].i]);
  assert.deepEqual({...message.result.ledger},expected.ledger);
});

test('four measured frames recover a pi/2 phase step; references illuminate dark sample pixels',()=>{
  const map={size:2,width:2,height:2,t:[1,1,1,1],r:[0,0,0,0],s:[0,0,0,0],opd:[0,137.5,0,137.5]};
  const sensor={id:'cam',type:'screen',x:0,aperture:2};
  const a=run([{id:'o',type:'object',map,x:0},sensor],{n:64,width:4,interferometer:true});
  const m=a.measurement, recovered=solver.reconstruct(m.frames);
  const l=32*64+29,r=l+6,dark=32*64+18;
  assert.ok(Math.abs(recovered.phase[l])<1e-6);
  assert.ok(Math.abs(recovered.phase[r]-Math.PI/2)<1e-5);
  assert.ok(m.frames.every(f=>f[dark]>.06 && f[0]===0));
  assert.equal(m.visibility[dark],0);
  assert.ok(Number.isNaN(m.phase[dark]));
  for(let k=0;k<4;k++)assert.ok(Math.abs(m.framePowers[k]+m.complementaryPowers[k]-1)<1e-6);
});
test('reference and sample OPD move the reconstructed phase with opposite signs',()=>{
  const plate={id:'p',type:'phase',x:20,opd:137.5};
  const base=run([{...plate,opd:0}],{n:64,interferometer:true});
  const shifted=run([plate],{n:64,interferometer:true});
  const match=run([plate],{n:64,interferometer:true,referenceOPD:137.5});
  const k=32*64+32;
  const diff=(a,b)=>Math.atan2(Math.sin(a-b),Math.cos(a-b));
  assert.ok(Math.abs(diff(shifted.measurement.phase[k],base.measurement.phase[k])-Math.PI/2)<1e-5);
  assert.ok(Math.abs(diff(match.measurement.phase[k],base.measurement.phase[k]))<1e-5);
  assert.ok(Math.abs(diff(shifted.phase[k]-shifted.measurement.referencePhaseRad,shifted.measurement.phase[k]))<1e-5);
});
test('PSI rejects mixed or spectrally integrated illumination but preserves ordinary outputs',()=>{
  for(const s of [{spectrum:'rgb'},{polarization:'unpolarized'},{type:'field',height:1,spread:2}]){
    const result=run([probe(0)],{n:64,interferometer:true},s);
    assert.ok(result.measurementReason);assert.equal(result.measurement,undefined);
    assert.ok(result.lines.length>0);
  }
});

test('fixed detector field of view crops its display independently of physical capture',()=>{
  const scene=[{id:'cam',type:'screen',x:0,aperture:1.6}];
  const full=run(scene),crop=run(scene,{outputWidth:.5});
  assert.equal(crop.width,.5);assert.equal(crop.pixelPitch,.5/128);
  assert.equal(crop.nativePitchMax,full.width/128);
  assert.equal(crop.ledger.detected,full.ledger.detected);
  assert.ok(.3<crop.viewPower && crop.viewPower<.35);
  assert.ok(Math.abs(crop.outsideViewPower+crop.viewPower-full.ledger.detected)<1e-6);
  assert.ok(Math.abs(full.viewPower-full.ledger.detected)<1e-6);
  const psi=run(scene,{outputWidth:.5,interferometer:true});
  assert.equal(psi.measurement.referenceWidth,.5);
  for(let k=0;k<4;k++)assert.ok(Math.abs(psi.measurement.framePowers[k]+psi.measurement.complementaryPowers[k]-(1+psi.viewPower)/2)<1e-5);
});

test('coincident and partly overlapping square cameras consume disjoint subpixel areas',()=>{
  const screen={id:'first',type:'screen',x:0,aperture:.52},opts={n:64,width:2,interferometer:true};
  const first=run([screen],opts), same=run([screen,{...screen,id:'second'}],opts);
  assert.ok(same.viewPower<1e-10);
  assert.ok(Math.abs(same.ledger.detected-first.viewPower)<1e-6);
  assert.ok(same.measurement.phase.every(Number.isNaN));
  const shifted=run([screen,{...screen,id:'second',y:.1}],opts);
  assert.ok(Math.abs(shifted.viewPower/first.viewPower-.1/.52)<1e-6);
  assert.ok(Math.abs(shifted.ledger.detected-(shifted.viewPower+first.viewPower))<1e-6);
});
test('380 nm material table endpoint survives propagation and offline packaging',()=>{
  const {presets}=require('./advanced-editor.js');
  for(const source of [{wavelength:380,spectrum:'mono'},{wavelength:400,bandwidth:80,spectrum:'band'}]){
    const result=run([{...presets.relay.elements[0],x:0},probe(20)],{n:64},source);
    assert.equal(result.lines[0].wavelength,380);
    const scene={source:{...src,...source},elements:[{...presets.relay.elements[0],x:0}]};
    const packet=solver.workerPacket(scene,{n:64});
    assert.ok(Object.values(packet.dependencies.indices).every(Number.isFinite));
  }
});
test('off-axis forward light hitting a thick plate rim is blocked inside the glass',()=>{
  const plate={id:'lens',type:'lens',x:0,aperture:1,thickness:10,material:'CUSTOM',n:1.5,r1:0,r2:0};
  const screen={id:'cam',type:'screen',x:11,y:.7,aperture:4};
  const r=run([plate,screen],{n:128,width:.6},{y:.3,width:.1,angle:3});
  // Finite-beam diffraction leaves a small halo inside the rear clear aperture.
  assert.ok(r.ledger.blocked>.98);
  assert.ok(r.ledger.detected<.02);
  assert.equal(r.ledger.bypass,0);
  assert.ok(Math.abs(r.ledger.blocked+r.ledger.numerical+r.ledger.detected+r.ledger.remaining-1)<1e-6);
});
test('unobserved identity optics preserve the original relay sampling exactly',()=>{
  const ws=require('./wave-scene.js'), scene=ws.createDefault();
  const opts={...scene.settings,n:128,outputWidth:3.2};
  const baseline=solver.run(scene,opts);
  for(const e of [{type:'phase',opd:0},{type:'retarder',retardance:0},{type:'object',n:1,map:ws.makeMap('clear')}]){
    const changed={...scene,elements:[...scene.elements,{id:'noop',x:161,...e}]};
    const r=solver.run(changed,opts);
    assert.equal(r.blocked,baseline.blocked);
    assert.deepEqual(r.lines[0].i,baseline.lines[0].i);
    assert.deepEqual(r.phase,baseline.phase);
    assert.ok(solver.run(changed,{...opts,plane:'noop',throughOnly:true}).lines.length);
  }
});
