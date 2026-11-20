/* Stokes vectors in the ray's right-handed (p,s,k) frame:
 * p = (-ky,kx,0), s = +z. For exp(-iωt), U+iV = 2 conj(Ep) Es / I.
 * V>0 is counterclockwise looking toward the source. Convention and Jones
 * to Mueller relations: https://pages.nist.gov/SCATMECH/docs/convent.htm
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Polarization = factory();
})(globalThis, function () {
  'use strict';
  const rad = Math.PI / 180;
  const unpolarized = Object.freeze([0, 0, 0]);

  function sourceState(source) {
    const mode = source.polarization ?? 'unpolarized';
    const degree = source.polDegree ?? 1;
    if (mode === 'unpolarized' || degree === 0) return unpolarized;
    if (mode === 'left' || mode === 'right') return [0, 0, mode === 'left' ? degree : -degree];
    const twiceAngle = 2 * (source.polAngle ?? 0) * rad;
    const twiceEllipticity = mode === 'elliptical' ? 2 * (source.ellipticity ?? 22.5) * rad : 0;
    const linear = degree * Math.cos(twiceEllipticity);
    return [linear * Math.cos(twiceAngle), linear * Math.sin(twiceAngle), degree * Math.sin(twiceEllipticity)];
  }

  function describe([q, u, v]) {
    const linear = Math.hypot(q, u);
    const degree = Math.min(1, Math.hypot(q, u, v));
    const type = degree < 1e-9 ? 'unpolarized' : linear < degree * 1e-8 ? 'circular' :
      Math.abs(v) < degree * 1e-8 ? 'linear' : 'elliptical';
    return {type, degree, azimuth: Math.atan2(u, q) / (2 * rad), ellipticity: Math.atan2(v, linear) / (2 * rad)};
  }

  function polarize([q, u], angle) {
    const c = Math.cos(2 * angle * rad), s = Math.sin(2 * angle * rad);
    const fraction = Math.min(1, (1 + q*c + u*s) / 2);
    // Treat crossed ideal axes at machine precision as complete extinction.
    return {fraction: fraction < 4 * Number.EPSILON ? 0 : fraction, stokes:[c, s, 0]};
  }

  function retard([q, u, v], axis, phaseDegrees) {
    const c = Math.cos(2 * axis * rad), s = Math.sin(2 * axis * rad);
    const phase = phaseDegrees * rad;
    const rotatedQ = q*c + u*s, rotatedU = -q*s + u*c;
    const outU = rotatedU*Math.cos(phase) - v*Math.sin(phase);
    return [rotatedQ*c - outU*s, rotatedQ*s + outU*c, rotatedU*Math.sin(phase) + v*Math.cos(phase)];
  }

  // Perfect conductor in the moving basis: characteristic amplitudes (+1,-1).
  const reflect = ([q, u, v]) => [q, -u, -v];

  function dividePowers([q,u,v], ap, as) {
    const pp = ap*ap*(1+q)/2, ps = as*as*(1-q)/2;
    const power = pp + ps;
    if (power <= 0) return {fraction:0, stokes:unpolarized};
    return {fraction:Math.min(1,power), stokes:[(pp-ps)/power, u*ap*as/power, v*ap*as/power]};
  }

  // Fresnel s/p amplitudes, using flux-normalized transmission in real dielectrics.
  // https://pbr-book.org/4ed/Reflection_Models/Specular_Reflection_and_Transmission
  function dielectric(stokes, n1, n2, ci, ct) {
    if (n1 === n2) return {reflected:{fraction:0,stokes:unpolarized}, transmitted:{fraction:1,stokes}};
    if (ct === null) {
      const gamma = Math.sqrt(Math.max(0, (n1/n2)**2 * (1-ci*ci) - 1));
      const phase = 2 * (Math.atan2(n1*gamma, n2*ci) - Math.atan2(n2*gamma, n1*ci));
      return {reflected:{fraction:1,stokes:retard(stokes,0,phase/rad)}, transmitted:{fraction:0,stokes:unpolarized}};
    }
    const rp = (n2*ci - n1*ct) / (n2*ci + n1*ct);
    const rs = (n1*ci - n2*ct) / (n1*ci + n2*ct);
    const reflected = dividePowers(stokes, rp, rs);
    const transmitted = dividePowers(stokes, Math.sqrt(Math.max(0,1-rp*rp)), Math.sqrt(Math.max(0,1-rs*rs)));
    return {reflected, transmitted};
  }

  // Incoherent average of independent ray packets in a common measurement frame.
  function average(hits) {
    let weight = 0;
    const sum = [0, 0, 0];
    for (const hit of hits) {
      const state = hit.screenStokes ?? hit.stokes;
      weight += hit.weight;
      for (let i=0;i<3;i++) sum[i] += hit.weight * state[i];
    }
    return weight > 0 ? sum.map(x => x / weight) : null;
  }

  return {unpolarized, sourceState, describe, polarize, retard, reflect, dielectric, average};
});
