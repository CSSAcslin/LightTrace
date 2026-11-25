'use strict';
importScripts('mie-phase.js','polarization.js','advanced-optics.js','wave-scene.js','wave-solver.js');
self.onmessage = ({data}) => {
  try {
    const result = WaveSolver.run(data.scene, data.options);
    const buffers = new Set();
    for (const line of result.lines || []) {
      for (const field of ['i','q','u','v']) if (line[field]?.buffer) buffers.add(line[field].buffer);
    }
    if (result.phase?.buffer) buffers.add(result.phase.buffer);
    if (result.measurement) {
      for (const array of [...result.measurement.frames,result.measurement.phase,result.measurement.visibility]) buffers.add(array.buffer);
    }
    self.postMessage({result}, [...buffers]);
  } catch (error) {
    self.postMessage({error:error.message});
  }
};
