/* Optical Bench — first-order geometrical optics, millimetres and ray slope dy/dx.
 * Air on both sides of every ideal thin lens. Aperture means full clear diameter.
 * Reference: MIT 6.161 Geometric Optics, sections 2.2–2.2.2.
 * https://web.mit.edu/6.161/www/Geometric-Optics-9-07.pdf
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Optics = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const EPS = 1e-10;
  const identity = () => ({ A: 1, B: 0, C: 0, D: 1 });

  function finite(value, label) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new TypeError(label + ' must be a finite number');
    }
    return value;
  }

  function prepare(object, lenses) {
    finite(object.x, 'object.x');
    finite(object.height, 'object.height');
    return lenses.slice().sort((a, b) => a.x - b.x).map(lens => {
      finite(lens.x, 'lens.x');
      if (!(lens.x > object.x)) throw new RangeError('Lenses must be after the object');
      if (typeof lens.f !== 'number' || Number.isNaN(lens.f) || lens.f === 0) {
        throw new RangeError('Lens focal length must be nonzero (Infinity is allowed)');
      }
      finite(lens.aperture, 'lens.aperture');
      if (!(lens.aperture > 0)) throw new RangeError('Lens aperture must be positive');
      return lens;
    });
  }

  function translate(matrix, distance) {
    return {
      A: matrix.A + distance * matrix.C,
      B: matrix.B + distance * matrix.D,
      C: matrix.C,
      D: matrix.D
    };
  }

  function refract(matrix, focalLength) {
    return {
      A: matrix.A,
      B: matrix.B,
      C: matrix.C - matrix.A / focalLength,
      D: matrix.D - matrix.B / focalLength
    };
  }

  function imageFromMatrix(matrix, lensX, objectHeight) {
    if (Math.abs(matrix.D) < EPS) {
      return {
        imageX: null, imageHeight: null, magnification: null,
        imageDistance: null, imageType: 'infinity'
      };
    }
    const imageDistance = -matrix.B / matrix.D;
    // det(M)=1 in air; 1/D avoids catastrophic cancellation in A - BC/D.
    const magnification = 1 / matrix.D;
    return {
      imageX: lensX + imageDistance,
      imageHeight: objectHeight * magnification,
      magnification,
      imageDistance,
      imageType: imageDistance >= 0 ? 'real' : 'virtual'
    };
  }

  /**
   * Image calculations are first-order conjugates independent of aperture.
   * `stages` gives each prefix system's conjugate, assuming later lenses absent.
   * Null image coordinates denote infinity; null EFL denotes an afocal system.
   * `matrix` maps the object plane to immediately after the final lens.
   * `screenBlurRadius` is geometric half-width of the surviving tip-ray bundle.
   * `screenCenter` is its midpoint. Neither describes diffraction or aberration.
   */
  function analyzeSystem({ object, lenses, screenX }) {
    const ordered = prepare(object, lenses);
    let matrix = identity();
    let x = object.x;
    let low = -Infinity;
    let high = Infinity;
    const stages = [];

    for (const lens of ordered) {
      matrix = translate(matrix, lens.x - x);
      const offset = matrix.A * object.height;
      const radius = lens.aperture / 2;
      // y_at_aperture = A * objectHeight + B * initialSlope.
      // Intersect all aperture constraints to avoid sampling errors in blur.
      if (Math.abs(matrix.B) < EPS) {
        if (Math.abs(offset) > radius + EPS) { low = 1; high = 0; }
      } else {
        const s1 = (-radius - offset) / matrix.B;
        const s2 = (radius - offset) / matrix.B;
        low = Math.max(low, Math.min(s1, s2));
        high = Math.min(high, Math.max(s1, s2));
      }
      matrix = refract(matrix, lens.f);
      x = lens.x;
      stages.push({ lensId: lens.id, ...imageFromMatrix(matrix, x, object.height) });
    }

    const hasLight = ordered.length > 0 && low <= high + EPS;
    const acceptedSlopeRange = hasLight ? { min: low, max: Math.max(low, high) } : null;
    let screenBlurRadius = null;
    let screenCenter = null;
    if (hasLight && Number.isFinite(screenX) && screenX >= x) {
      const screenMatrix = translate(matrix, screenX - x);
      const middleSlope = (low + high) / 2;
      screenCenter = screenMatrix.A * object.height + screenMatrix.B * middleSlope;
      screenBlurRadius = Math.abs(screenMatrix.B) * Math.max(0, high - low) / 2;
      if (screenBlurRadius < EPS) screenBlurRadius = 0;
    }

    const image = ordered.length ? imageFromMatrix(matrix, x, object.height) : {
      imageX: null, imageHeight: null, magnification: null,
      imageDistance: null, imageType: 'none'
    };
    const isAfocal = Math.abs(matrix.C) < 1e-12;
    return {
      matrix,
      ...image,
      effectiveFocalLength: isAfocal ? null : -1 / matrix.C,
      backFocalX: isAfocal ? null : x - matrix.A / matrix.C,
      stages,
      screenBlurRadius,
      screenCenter,
      acceptedSlopeRange
    };
  }

  function tracePrepared(object, ordered, slope, endX) {
    let x = object.x;
    let y = object.height;
    let theta = slope;
    let lastPoint = { x, y };
    const points = [{ x, y }];
    for (const lens of ordered) {
      if (lens.x > endX) break;
      y += (lens.x - x) * theta;
      x = lens.x;
      lastPoint = { x, y };
      points.push(lastPoint);
      if (Math.abs(y) > lens.aperture / 2 + EPS) {
        return { points, blocked: true, blockedBy: lens.id, outgoingSlope: theta, lastPoint };
      }
      theta -= y / lens.f;
    }
    if (endX > x) points.push({ x: endX, y: y + (endX - x) * theta });
    return { points, blocked: false, blockedBy: null, outgoingSlope: theta, lastPoint };
  }

  /** lastPoint is the last optical intersection, not the final endX endpoint. */
  function traceRay({ object, lenses, slope, endX }) {
    finite(slope, 'slope');
    finite(endX, 'endX');
    if (endX < object.x) throw new RangeError('endX must not precede the object');
    return tracePrepared(object, prepare(object, lenses), slope, endX);
  }

  /** Uniform first-aperture sampling including both edges; count is capped at 201. */
  function sampleRays({ object, lenses, count = 13, endX }) {
    const ordered = prepare(object, lenses);
    finite(endX, 'endX');
    if (endX < object.x) throw new RangeError('endX must not precede the object');
    if (!ordered.length) return [];
    const n = Math.max(1, Math.min(201, Math.round(Number.isFinite(count) ? count : 13)));
    const first = ordered[0];
    return Array.from({ length: n }, (_, index) => {
      const fraction = n === 1 ? 0.5 : index / (n - 1);
      const target = (fraction - 0.5) * first.aperture;
      const slope = (target - object.height) / (first.x - object.x);
      return { slope, ...tracePrepared(object, ordered, slope, endX) };
    });
  }

  /**
   * Thin lens in air: 1/f = (n-1)(1/R1 - 1/R2).
   * Radius > 0 if its centre of curvature is to the right of the surface.
   * Use +/-Infinity for a plane surface. Result Infinity means zero power.
   */
  function lensmaker({ n, r1, r2 }) {
    finite(n, 'n');
    if (!(n > 0)) throw new RangeError('Refractive index must be positive');
    for (const radius of [r1, r2]) {
      if (typeof radius !== 'number' || Number.isNaN(radius) || radius === 0) {
        throw new RangeError('Radii must be nonzero (Infinity is allowed)');
      }
    }
    const power = (n - 1) * (1 / r1 - 1 / r2);
    return Math.abs(power) < 1e-12 ? Infinity : 1 / power;
  }

  return { analyzeSystem, traceRay, sampleRays, lensmaker };
});
