/* Lorenz–Mie angular scattering of an isolated homogeneous nonabsorbing sphere.
 * Bohren & Huffman, Absorption and Scattering of Light by Small Particles,
 * eqs. 4.47, 4.62 and 4.74. Angles below are signed meridional degrees.
 * The bench models a plane cut of S11, integrated in dθ rather than dΩ. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MiePhase = api;
})(globalThis, function () {
  'use strict';
  const rad = Math.PI / 180;
  const cache = new Map();

  function sphereCoefficients(x, m) {
    const order = Math.ceil(x + 4.05 * Math.cbrt(x) + 2);
    const z = m * x;
    // Start far above both turning points. The real logarithmic derivative
    // is stable downwards for the supported particle sizes and real indices.
    const derivatives = new Float64Array(order + 1);
    let derivative = 0;
    for (let n = Math.ceil(Math.max(z, order)) + 42; n > 0; --n) {
      derivative = n / z - 1 / (derivative + n / z);
      if (n - 1 <= order) derivatives[n - 1] = derivative;
    }
    let psiPrev = Math.sin(x), psi = psiPrev / x - Math.cos(x);
    let chiPrev = Math.cos(x), chi = chiPrev / x + Math.sin(x);
    const terms = [];
    for (let n = 1; n <= order; ++n) {
      const aFactor = derivatives[n] / m + n / x;
      const bFactor = derivatives[n] * m + n / x;
      // Re and Im of the lossless Mie coefficient u/(u - iv).
      const factor = (2*n + 1) / (n * (n+1));
      const component = f => {
        const u = f * psi - psiPrev, v = f * chi - chiPrev;
        const norm = Math.hypot(u, v);
        return [factor*(u/norm)**2, factor*(u/norm)*(v/norm)];
      };
      terms.push([...component(aFactor), ...component(bFactor)]);
      const k = (2*n + 1) / x;
      [psiPrev, psi] = [psi, k * psi - psiPrev];
      [chiPrev, chi] = [chi, k * chi - chiPrev];
    }
    return terms;
  }

  function angularMueller(terms, theta) {
    const mu = Math.cos(theta * rad);
    let pPrev = 0, p = 1;
    let s1r = 0, s1i = 0, s2r = 0, s2i = 0;
    for (let j = 0; j < terms.length; ++j) {
      const n = j + 1, tau = n * mu * p - (n + 1) * pPrev;
      const [ar, ai, br, bi] = terms[j];
      s1r += ar*p + br*tau; s1i += ai*p + bi*tau;
      s2r += ar*tau + br*p; s2i += ai*tau + bi*p;
      [pPrev, p] = [p, ((2*n + 1) * mu * p - (n + 1) * pPrev) / n];
    }
    const pPower = s2r*s2r + s2i*s2i, sPower = s1r*s1r + s1i*s1i;
    // Jones diag(S2,S1) in the moving (p,s) basis, with exp(-iωt).
    // U+iV = 2 conj(Ep) Es, so its multiplier is conj(S2) S1.
    return [(pPower+sPower)/2, (pPower-sPower)/2,
      s2r*s1r + s2i*s1i, s2r*s1i - s2i*s1r];
  }

  function distribution({diameter, index, medium, wavelength, halfAngle}) {
    const key = [diameter, index, medium, wavelength, halfAngle].join('/');
    if (cache.has(key)) return cache.get(key);
    const x = Math.PI * diameter * medium * 1000 / wavelength;
    const terms = sphereCoefficients(x, index / medium);
    const count = Math.max(360, Math.ceil(20 * x * halfAngle * rad));
    const rows = Array.from({length:count+1}, (_,i) =>
      index === medium ? [0,0,0,0] : angularMueller(terms, i*halfAngle/count));
    const matrix = [0,1,2,3].map(j => tabulate(halfAngle, count, (_,i) => rows[i][j]));
    return remember(key, {...matrix[0], matrix});
  }

  function hgDistribution({g, halfAngle}) {
    const key = 'HG/' + g + '/' + halfAngle;
    if (cache.has(key)) return cache.get(key);
    const count = Math.max(360, Math.ceil(16 * halfAngle * rad / (1-g)));
    return remember(key, tabulate(halfAngle, count, theta => {
      const denominator = (1-g)**2 + 4*g*Math.sin(theta*rad/2)**2;
      return (1-g*g) / denominator**1.5;
    }));
  }

  function tabulate(halfAngle, count, intensity) {
    const step = halfAngle / count;
    const values = new Float64Array(count + 1), integral = new Float64Array(count + 1);
    for (let i = 0; i <= count; ++i) {
      values[i] = intensity(i * step, i);
      if (i) integral[i] = integral[i-1] + (values[i-1] + values[i]) * step / 2;
    }
    return {values, integral, step, halfAngle, samplesByCount:new Map()};
  }

  function remember(key, law) {
    if (cache.size >= 32) cache.delete(cache.keys().next().value);
    cache.set(key, law);
    return law;
  }

  function integralAt(law, angle) {
    const pos = Math.min(Math.abs(angle), law.halfAngle) / law.step;
    const i = Math.min(Math.floor(pos), law.values.length - 2), t = pos - i;
    const partial = t * law.step * (law.values[i] + t * (law.values[i+1] - law.values[i]) / 2);
    return Math.sign(angle) * (law.integral[i] + partial);
  }

  function inverse(law, target) {
    const mass = Math.abs(target);
    let lo = 0, hi = law.integral.length - 1;
    while (hi - lo > 1) {
      const mid = (hi + lo) >> 1;
      if (law.integral[mid] < mass) lo = mid; else hi = mid;
    }
    // Invert the linearly interpolated intensity in this angular interval.
    const v0 = law.values[lo], dv = law.values[hi] - v0;
    const area = Math.max(0, mass - law.integral[lo]) / law.step;
    const denom = v0 + Math.sqrt(Math.max(0, v0*v0 + 2*dv*area));
    const t = denom > 0 ? Math.min(1, 2*area/denom) : 0;
    return Math.sign(target) * (lo + t) * law.step;
  }

  function quantile(law, u) {
    return inverse(law, (2*u - 1) * law.integral.at(-1));
  }

  function sample(law, n) {
    if (law.samplesByCount.has(n)) return law.samplesByCount.get(n);
    const total = 2 * law.integral.at(-1);
    if (!total) return [];
    const bins = Array.from({length:n}, (_, i) => {
      const left = integralAt(law, law.halfAngle * (2*i/n - 1));
      const right = integralAt(law, law.halfAngle * (2*(i+1)/n - 1));
      return {offset:2*i+1 === n ? 0 : inverse(law, (left+right)/2), fraction:(right-left)/total};
    });
    law.samplesByCount.set(n, bins);
    return bins;
  }

  // Sum Stokes powers across each angular bin. On repeat visits, the
  // existing single-quantile sampler instead represents one resolved angle.
  function scatterPolarized(options, [q,u,v], quantileValue=null) {
    const base = distribution(options);
    if (!base.integral.at(-1)) return [];
    const matrix = base.matrix;
    let law = base;
    if (q !== 0) {
      if (base.lastQ !== q) {
        base.lastQ = q;
        base.polarizedLaw = tabulate(base.halfAngle, base.values.length-1, (_,i) =>
          Math.max(0, base.values[i] + q*matrix[1].values[i]));
      }
      law = base.polarizedLaw;
    }
    const bins = quantileValue === null ? sample(law, options.samples)
      : [{offset:quantile(law, quantileValue), fraction:1}];
    return bins.map(({offset,fraction},i) => {
      const [a,b,c,d] = matrix.map(component => {
        if (quantileValue === null) {
          const left = base.halfAngle*(2*i/options.samples-1);
          const right = base.halfAngle*(2*(i+1)/options.samples-1);
          return integralAt(component,right) - integralAt(component,left);
        }
        const pos = Math.abs(offset)/base.step;
        const j = Math.min(Math.floor(pos), base.values.length-2);
        return component.values[j] + (pos-j)*(component.values[j+1]-component.values[j]);
      });
      const intensity = a+b*q;
      return {offset,fraction,stokes:intensity>0
        ? [(b+a*q)/intensity,(c*u-d*v)/intensity,(d*u+c*v)/intensity] : [0,0,0]};
    });
  }

  function draw(canvas, options) {
    if (!canvas) return;
    const ctx = canvas.getContext('2d'), width = canvas.width, height = canvas.height;
    const law = distribution(options), peak = Math.max(...law.values), pad = 10, base = height - 22;
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#eef4ef'; ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = '#b7cbbe'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(width/2, 6); ctx.lineTo(width/2, base);
    ctx.moveTo(pad, base); ctx.lineTo(width-pad, base); ctx.stroke();
    ctx.strokeStyle = '#297b63'; ctx.lineWidth = 2; ctx.beginPath();
    for (let px = pad; px <= width-pad; ++px) {
      const t = Math.abs(2*(px-pad)/(width-2*pad) - 1);
      const value = law.values[Math.round(t*(law.values.length-1))];
      const y = base - (peak ? value/peak : 0)*(base-7);
      if (px === pad) ctx.moveTo(px, y); else ctx.lineTo(px, y);
    }
    ctx.stroke(); ctx.fillStyle = '#496457'; ctx.font = '12px sans-serif';
    [['left',pad,'−'+options.halfAngle+'°'],['center',width/2,'0°'],['right',width-pad,'+'+options.halfAngle+'°']].forEach(([align,x,label])=>{
      ctx.textAlign=align; ctx.fillText(label,x,height-5);
    });
  }
  return {distribution, draw, scatterPolarized,
    sample: options => sample(distribution(options), options.samples),
    sampleHG: options => sample(hgDistribution(options), options.samples),
    quantile: (options,u) => quantile(distribution(options),u),
    quantileHG: (options,u) => quantile(hgDistribution(options),u)};
});
