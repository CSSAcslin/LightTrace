/* Optical scene editor. Positions and surface radii are in mm, angles in degrees. */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./advanced-optics.js'));
  else root.AdvEditor = factory(root.AdvancedOptics);
})(globalThis, function (optics) {
  'use strict';

  const labels = {
    source: '光源', lens: '厚透镜', object: '图案物体', stop: '孔径光阑',
    mirror: '平面反光镜', grating: '透射光栅', screen: '探测屏'
  };
  const symbols = {source: '☼', lens: '()', object: '▤', stop: '┤├', mirror: '╱', grating: '▥', screen: '┆'};
  const materials = {BK7: 'N-BK7 · 冕玻璃', F2: 'F2 · 火石玻璃', SILICA: '熔融石英', CUSTOM: '自定义折射率'};
  const shapes = {plane: '平面', sphere: '球面', conic: '圆锥面', asphere: '偶次非球面'};
  const spatial = {collimated: '平行光束', point: '发散点光源', field: '多视场物点'};
  const spectra = {mono: '单色', rgb: '三条谱线', band: '宽谱采样'};
  const objectModes = {mixed: '混合材质 · 逐格绘制', scatter: '透射侧余弦散射（旧）', reflect: '镜面反射', refract: '楔片折射'};
  const fractionNames = {scatter: '散射', reflection: '镜面反射', transmission: '透明介质', absorption: '吸收'};
  const paintChannels = ['scatter', 'reflection', 'transmission'];
  const scatterModels = {mie:'米氏散射 · 均匀球', hg:'Henyey–Greenstein 近似', diffuse:'入射侧漫反射 · 余弦'};
  const defaultFractions = {scatter: 0.25, reflection: 0.25, transmission: 0.4, absorption: 0.1};
  const binCount = 33;
  const pattern = (name, fn) => ({name, values: Array.from({length: binCount}, (_, i) => fn(i))});
  const patternPresets = {
    bars: pattern('不对称条纹', i => (i >= 3 && i <= 5) || (i >= 21 && i <= 27) ? 1 : i >= 10 && i <= 14 ? 0.55 : 0),
    slits: pattern('双狭缝', i => (i >= 8 && i <= 10) || (i >= 22 && i <= 24) ? 1 : 0),
    ramp: pattern('灰度渐变', i => i / (binCount - 1)),
    steps: pattern('灰阶', i => Math.min(4, Math.floor(i / 7)) / 4),
    full: pattern('全亮', () => 1), empty: pattern('全黑', () => 0)
  };
  const defaults = {
    source: {x: 0, y: 0, angle: 0, type: 'collimated', height: 8, width: 28, spread: 5,
      spectrum: 'band', wavelength: 560, bandwidth: 180, rays: 13},
    lens: {aperture: 36, thickness: 7, material: 'BK7', n: 1.5,
      r1: 75, r2: -75, k1: 0, k2: 0, a41: 0, a42: 0, shape1: 'sphere', shape2: 'sphere', group: ''},
    object: {aperture: 16, interaction: 'mixed', pattern: patternPresets.bars.values,
      fractions: defaultFractions, scatterAngle: 3, scatterSamples: 5, n: 1.52, thickness: 4, wedge: 0},
    stop: {aperture: 14, outerDiameter: 72}, mirror: {aperture: 55},
    grating: {aperture: 45, lines: 600, order: 1}, screen: {aperture: 80}
  };
  function element(type, id, name, x, extras = {}) {
    return {id, type, name, x, y: 0, angle: 0, ...defaults[type], ...extras};
  }
  const source = (extras = {}) => ({...defaults.source, ...extras});
  const lens = (x, extras = {}) => element('lens', 'l1', '物镜 L1', x, extras);
  const screen = (x, extras = {}) => element('screen', 's1', '探测屏', x, extras);
  const preset = (name, description, emitter, elements) => ({name, description, source: emitter, elements});

  // Place the relay surfaces from the actual paraxial focal planes of the
  // symmetric thick lenses. Reference wavelength 546.074 nm (mercury e line).
  const relayIndex = optics.indexAt('BK7', 546.074);
  const power = (relayIndex - 1) / 65;
  const relayThickness = 6;
  const bfl = (1 - relayThickness * power / relayIndex) /
    (2 * power - relayThickness * power * power / relayIndex);
  const relayLens = {r1: 65, r2: -65, thickness: relayThickness, aperture: 30, group: '中继'};
  function patternedObject(extras = {}) {
    const obj = element('object', 'o1', '一维图案物体', 24, {
      ...extras, fractions:{...(extras.fractions || defaultFractions)},
      pattern:[...(extras.pattern || patternPresets.bars.values)]
    });
    if (obj.interaction === 'mixed') {
      Object.assign(obj, {scatterModel:'mie', mieDiameter:1, mieIndex:1.59, scatterG:0.8,
        scatterAngle:45, scatterSamples:9}, extras);
      obj.channels = extras.channels || Object.fromEntries(paintChannels.map(key =>
        [key, obj.pattern.map(value => value * obj.fractions[key])]));
      obj.pattern = totalPattern(obj.channels);
    }
    return obj;
  }
  function totalPattern(channels) {
    return channels.scatter.map((s,i) => Math.min(1, s + channels.reflection[i] + channels.transmission[i]));
  }
  // Sample the centres of the 33 bins. The oblique mirror's width as seen by
  // the incoming collimated light is its physical aperture times cos(45°).
  const objectLamp = (width = 16) => source({spectrum:'mono', wavelength:546.074,
    rays:binCount, width:width*(binCount-1)/binCount});
  const imagingLens = lens(126, {r1:48, r2:-48, thickness:9});
  const objectImage = optics.paraxial({source:source({type:'point',x:24}),elements:[imagingLens]},546.074);
  const presets = {
    singlet: preset('宽谱单透镜', '沿画布上的光线检查两次折射，比较各波长的焦距和探测落点。',
      source(), [lens(80), screen(157, {aperture: 56})]),
    objectMixed: preset('混合物体 · 双屏能量分配', '上屏接收镜面反射，右屏接收以入射方向为轴的米氏散射主瓣和透射光。选择绘图通道，比较两屏的通量。',
      objectLamp(20 / Math.sqrt(2)), [
        patternedObject({name:'混合材质试片', x:58, angle:-45, aperture:20, thickness:0.5,
          scatterAngle:30, pattern:patternPresets.full.values}),
        screen(43, {id:'s1', name:'反射侧探测屏', y:30, angle:90, aperture:88}),
        screen(110, {id:'s2', name:'透射侧探测屏', aperture:28})
      ]),
    objectMie: preset('米氏前向散射 · 分区图案', '绿区涂有散射颗粒，金区镜面反射，蓝区透明，未涂区域吸收。改变粒径或波长，观察散射角分布和前方屏上的光。',
      objectLamp(20 / Math.sqrt(2)), [
        patternedObject({name:'分区散射试片', x:58, angle:-45, aperture:20, thickness:.5, n:1,
          channels:{scatter:pattern('散射',i=>i>=2&&i<=10?1:0).values,
            reflection:pattern('反射',i=>i>=13&&i<=19?.85:0).values,
            transmission:pattern('透明',i=>i>=22&&i<=29?1:0).values}}),
        screen(110,{id:'s1',name:'前向探测屏',aperture:68}),
        screen(52,{id:'s2',name:'反射侧探测屏',y:32,angle:90,aperture:50})
      ]),
    objectScatter: preset('散射物体成像', '平行光照亮条纹，透镜把散射光投到探测屏。改变条纹左右两端的宽度，检查倒像。',
      objectLamp(), [patternedObject({interaction:'scatter'}), imagingLens, screen(objectImage.imageX,{aperture:18})]),
    objectReflect: preset('反射物体 · 折转图案', '斜置的反射条纹把光折向上方。灰度控制每格反射的光线权重。',
      objectLamp(20/Math.sqrt(2)), [patternedObject({interaction:'reflect',x:58,angle:-45,aperture:20}),
        screen(58,{y:65,angle:90,aperture:18})]),
    objectRefract: preset('折射物体 · 楔片偏移', '条纹楔片改变出射方向。比较零楔角与非零楔角时屏上条纹的位置。',
      objectLamp(), [patternedObject({interaction:'refract',x:42,wedge:6}),
        screen(120,{aperture:30})]),
    achromat: preset('空气间隔消色差双镜', '冕玻璃正镜与火石玻璃负镜使 F、C 两谱线的近轴后焦点重合。改变负镜半径，观察色差再现。',
      source({spectrum: 'rgb', wavelength: 546.074, width: 16, rays: 11}),
      [lens(80, {name: '正冕玻璃 L1', r1: 48, r2: -48, thickness: 6, aperture: 24, group: '消色差'}),
        element('lens', 'l2', '负火石玻璃 L2', 88, {material: 'F2',
          r1: -88.012157225574, r2: 88.012157225574, thickness: 3, aperture: 24, group: '消色差'}),
        screen(197.18, {aperture: 48})]),
    spherical: preset('大口径与球差', '平行光照满球面透镜。缩小入射束宽，比较边缘光与近轴光的会聚位置。',
      source({spectrum: 'mono', wavelength: 546.074, width: 38, rays: 21}),
      [lens(65, {name: '大口径球面镜片', r1: 44, r2: -44, thickness: 12, aperture: 40}), screen(114)]),
    aspheric: preset('圆锥面校正球差', '平面垂直入射，双曲面将平行束聚焦。把后表面切换为同半径球面，比较探测截距的 RMS。',
      source({spectrum: 'mono', wavelength: 546.074, width: 34, rays: 25}),
      [lens(60, {name: '平面入射 · 双曲面出射', r1: 0, shape1: 'plane', shape2: 'conic',
        r2: -80 * (relayIndex - 1), k2: -(relayIndex ** 2), thickness: 8}), screen(148)]),
    imaging: preset('有限物距成像', '三个物点以不同角度发光。移动探测屏，比较中心与离轴视场的截距分布。',
      source({type: 'field', spectrum: 'mono', height: 12, spread: 4, rays: 11, wavelength: 546.074}),
      [lens(145), screen(292)]),
    magnifier: preset('厚透镜放大镜', '三个物点都在前焦平面与镜片之间。比较正立虚像的反向延长线与右侧屏上仍在发散的光束。',
      source({type: 'field', spectrum: 'mono', wavelength: 546.074, height: 8, spread: 8, rays: 9}),
      [lens(40), screen(108, {aperture: 64})]),
    relay: preset('厚透镜 4f 中继', '两镜共用中间焦平面，物面和探测面落在外侧焦平面。沿轴移动一片镜可打破共焦。',
      source({type: 'field', spectrum: 'mono', wavelength: 546.074, height: 8, spread: 4, rays: 7}),
      [lens(bfl, {...relayLens, name: '中继镜 L1'}),
        element('lens', 'l2', '中继镜 L2', 3 * bfl + relayThickness, relayLens),
        screen(4 * bfl + 2 * relayThickness, {aperture: 46})]),
    spectrum: preset('透射光栅分光', '宽谱光垂直入射。改变刻线密度或衍射级次，观察不同波长在屏上的位置。',
      source({width: 8, wavelength: 550, bandwidth: 280, rays: 5}),
      [element('grating', 'g1', '透射光栅', 60), screen(160, {y: 37, aperture: 85})]),
    folded: preset('折叠成像光路', '反光镜将光束折转 90°，竖直放置的镜片将其聚焦。旋转反光镜检查反射方向。',
      source({spectrum: 'mono', wavelength: 546.074, width: 20}),
      [element('mirror', 'm1', '转向反光镜', 65, {angle: -45}),
        lens(65, {name: '折转后物镜', y: 42, angle: 90, r1: 55, r2: -55, aperture: 30}),
        screen(65, {y: 100, angle: 90, aperture: 56})]),
    stop: preset('光阑与截光', '调节光阑的通光直径，观察遮挡的光线、剩余通光束与屏上像差的变化。',
      source({spectrum: 'mono', width: 34, rays: 21, wavelength: 546.074}),
      [element('stop', 'p1', '入瞳光阑', 32), lens(80), screen(157)])
  };

  const commonLimits = {x: [-10000, 10000], y: [-10000, 10000], angle: [-360, 360]};
  const elementLimits = {
    ...commonLimits, aperture: [0.1, 1000], outerDiameter: [0.1, 2000],
    thickness: [0.01, 500], n: [1, 4], lines: [1, 10000], order: [-10, 10],
    r1: [-1e6, 1e6], r2: [-1e6, 1e6], k1: [-100, 100], k2: [-100, 100],
    a41: [-1, 1], a42: [-1, 1], scatterAngle: [0, 180], scatterSamples: [3, 17], scatterG: [0, .98],
    mieDiameter: [.05, 4], mieIndex: [1, 4], wedge: [-89, 89]
  };
  const sourceLimits = {
    ...commonLimits, height: [0.01, 1000], width: [0.01, 1000], spread: [0, 89],
    wavelength: [380, 780], bandwidth: [1, 400], rays: [3, 41]
  };
  const names = {
    x: '位置 x', y: '位置 y', angle: '轴向角', aperture: '通光直径', outerDiameter: '外径',
    thickness: '中心厚度', n: '折射率', r1: '前面半径 R₁', r2: '后面半径 R₂',
    k1: '前面圆锥系数', k2: '后面圆锥系数', a41: '前面 A₄', a42: '后面 A₄',
    lines: '刻线密度', order: '衍射级次', height: '全视场物高', width: '光束全宽',
    spread: '发散半角', wavelength: '参考波长', bandwidth: '光谱全宽', rays: '采样光线数',
    scatterAngle: '散射半角', scatterSamples: '散射采样数', wedge: '楔角'
  };
  function checkNumbers(value, limits, keys) {
    const errors = [];
    for (const key of keys) {
      const v = value[key], [min, max] = limits[key];
      if (!Number.isFinite(v) || v < min || v > max) {
        errors.push(`${names[key]}需为 ${min} 至 ${max} 的有限数值。`);
      }
    }
    return errors;
  }
  function validateSource(s) {
    if (!s || typeof s !== 'object') return ['缺少光源参数。'];
    const errors = checkNumbers(s, sourceLimits, Object.keys(sourceLimits));
    if (!Object.hasOwn(spatial, s.type)) errors.push('请选择支持的光源类型。');
    if (!Object.hasOwn(spectra, s.spectrum)) errors.push('请选择支持的光谱。');
    if (!Number.isInteger(s.rays) || s.rays % 2 !== 1) errors.push('每束光线数应为 3 至 41 的奇数，含一条中心光线。');
    return errors;
  }
  function surfaceShape(e, i) {
    if (Object.hasOwn(shapes, e['shape' + i])) return e['shape' + i];
    if (e['a4' + i]) return 'asphere';
    if (e['k' + i]) return 'conic';
    return e['r' + i] ? 'sphere' : 'plane';
  }
  function validateElement(e) {
    if (!e || !Object.hasOwn(defaults, e.type) || e.type === 'source') return ['器件类型无效。'];
    if (typeof e.id !== 'string' || !e.id || e.id.length > 80 || e.id === 'source') return ['器件标识无效。'];
    const errors = checkNumbers(e, elementLimits, ['x', 'y', 'angle', 'aperture']);
    if (typeof e.name !== 'string' || e.name.length > 64) errors.push('器件名最多 64 个字符。');
    if (e.group != null && (typeof e.group !== 'string' || e.group.length > 24)) errors.push('镜组名最多 24 个字符。');
    if (e.type === 'stop') {
      errors.push(...checkNumbers(e, elementLimits, ['outerDiameter']));
      if (e.outerDiameter < e.aperture) errors.push('光阑外径需大于或等于通光直径。');
    }
    if (e.type === 'grating') {
      errors.push(...checkNumbers(e, elementLimits, ['lines', 'order']));
      if (!Number.isInteger(e.order)) errors.push('衍射级次须为整数。');
    }
    if (e.type === 'object') {
      const error = optics.validateObject(e);
      if (error) errors.push(error);
      if (['refract','mixed'].includes(e.interaction)) errors.push(...checkNumbers(e, elementLimits, ['thickness']));
    }
    if (e.type !== 'lens') return errors;
    errors.push(...checkNumbers(e, elementLimits, ['thickness', 'r1', 'r2', 'k1', 'k2', 'a41', 'a42']));
    if (!Object.hasOwn(materials, e.material)) errors.push('请选择支持的材料。');
    if (e.material === 'CUSTOM') errors.push(...checkNumbers(e, elementLimits, ['n']));
    for (const i of [1, 2]) {
      const shape = surfaceShape(e, i);
      const r = e['r' + i], k = e['k' + i], a4 = e['a4' + i];
      if (e['shape' + i] != null && !Object.hasOwn(shapes, e['shape' + i])) errors.push('曲面类型无效。');
      if (shape === 'plane' && (r || k || a4)) errors.push('平面的曲率及非球面系数应为零。');
      if (shape === 'sphere' && (!r || k || a4)) errors.push('球面须使用非零半径，圆锥及高次项系数为零。');
      if (shape === 'conic' && (!r || a4)) errors.push('圆锥面的半径不可为零，A₄ 应为零。');
    }
    if (errors.length) return errors;
    const geometry = optics.validateLens(e);
    if (geometry) errors.push(geometry);
    return errors;
  }

  const views = new WeakMap();
  function node(tag, className, text) {
    const item = document.createElement(tag);
    if (className) item.className = className;
    if (text != null) item.textContent = text;
    return item;
  }
  function action(text, command, title) {
    const button = node('button', 'ae-action', text);
    button.type = 'button'; button.dataset.action = command;
    if (title) button.title = title;
    return button;
  }
  function numberField(key, caption, unit, limits, step = 'any') {
    const label = node('label', 'ae-field'), box = node('span', 'ae-input-wrap');
    const input = node('input');
    input.type = 'number'; input.step = String(step); input.min = limits[key][0]; input.max = limits[key][1];
    input.dataset.field = key;
    box.append(input);
    if (unit) box.append(node('small', 'ae-unit', unit));
    label.append(node('span', 'ae-caption', caption), box);
    return label;
  }
  function textField(key, caption, placeholder, maxLength) {
    const label = node('label', 'ae-field');
    const input = node('input');
    input.type = 'text'; input.dataset.field = key; input.placeholder = placeholder; input.maxLength = maxLength;
    label.append(node('span', 'ae-caption', caption), input);
    return label;
  }
  function menuField(key, caption, options) {
    const label = node('label', 'ae-field'), select = node('select');
    select.dataset.field = key;
    for (const [value, text] of Object.entries(options)) select.add(new Option(text, value));
    label.append(node('span', 'ae-caption', caption), select);
    return label;
  }
  function group(...children) {
    const grid = node('div', 'ae-grid');
    grid.append(...children);
    return grid;
  }
  function section(caption, ...children) {
    const item = node('section', 'ae-section');
    item.append(node('h4', '', caption), ...children);
    return item;
  }
  function note(text) { return node('p', 'ae-note', text); }
  function createFractionEditor(view) {
    const panel = section('图案层材质份额');
    const bar = node('div', 'ae-fraction-bar');
    bar.setAttribute('aria-hidden', 'true');
    const cells = {};
    const fields = {};
    const limits = Object.fromEntries(Object.keys(fractionNames).map(key => [key, [0, 100]]));
    for (const [key, title] of Object.entries(fractionNames)) {
      cells[key] = node('span', 'ae-channel-' + key);
      bar.append(cells[key]);
      fields[key] = numberField(key, title, '%', limits);
      const caption = fields[key].querySelector('.ae-caption');
      caption.prepend(node('i', 'ae-channel-dot ae-channel-' + key));
    }
    const balanceLabel = node('label', 'ae-balance-select');
    const balance = node('select');
    for (const [key, name] of Object.entries(fractionNames)) balance.add(new Option(name, key));
    balanceLabel.append(node('span', '', '自动补足至 100%'), balance);
    view.balanceChannel = view.balanceChannel || 'absorption';
    balance.value = view.balanceChannel;
    function sync(object) {
      for (const key of Object.keys(fractionNames)) {
        const field = fields[key].querySelector('input');
        field.readOnly = view.balanceChannel === key;
        field.title = field.readOnly ? '该项自动补足余量，可在下方切换。' : '';
        cells[key].style.width = (100 * object.fractions[key]) + '%';
      }
    }
    balance.onchange = () => {
      view.balanceChannel = balance.value;
      setMessage(view, '');
      sync(selectedObject(view.state));
    };
    panel.append(bar, group(...Object.values(fields)), balanceLabel,
      note('全亮格按上列份额分配。灰度降低时，三个出光通道等比例减弱，差额计入吸收。透明介质通道按菲涅耳系数分配反射与透射，透射方向由折射定律决定。'));
    return {panel, sync};
  }
  function sourceFields(container, s) {
    const number = (key, caption, unit, step) => numberField(key, caption, unit, sourceLimits, step);
    container.append(section('发光范围', menuField('type', '空间分布', spatial),
      group(number('x', '发光位置 x', 'mm'), number('y', '发光位置 y', 'mm')),
      group(number('angle', '主光线方向', '°'), s.type === 'collimated' ?
        number('width', '光束全宽', 'mm') : number('spread', '发散半角', '°'))));
    if (s.type === 'field') container.lastChild.append(number('height', '上下视场点间距', 'mm'),
      note('分别从下方、中心、上方三个物点发出光束。'));
    const spectrum = section('光谱与采样', menuField('spectrum', '波长分布', spectra));
    if (s.spectrum === 'rgb') spectrum.append(note('追迹 F、e、C 三条谱线（486.1、546.1、656.3 nm）。'));
    const count = number('rays', '每束光线数', '条', 2);
    if (s.spectrum === 'rgb') spectrum.append(count);
    else spectrum.append(group(number('wavelength', s.spectrum === 'band' ? '中心波长' : '波长 λ', 'nm'), count));
    if (s.spectrum === 'band') spectrum.append(number('bandwidth', '光谱全宽', 'nm'),
      note('在中心波长两侧均匀取五个样本，可见波段限于 380–780 nm。'));
    container.append(spectrum);
  }
  function lensSurface(i, e) {
    const shape = surfaceShape(e, i), panel = node('details', 'ae-surface');
    panel.open = true;
    panel.append(node('summary', '', i === 1 ? '前表面 S₁' : '后表面 S₂'));
    const content = node('div', 'ae-surface-fields');
    content.append(menuField('shape' + i, '曲面类型', shapes));
    if (shape !== 'plane') content.append(numberField('r' + i, '曲率半径 R', 'mm', elementLimits));
    if (shape === 'conic' || shape === 'asphere') content.append(numberField('k' + i, '圆锥系数 k', '', elementLimits));
    if (shape === 'asphere') content.append(numberField('a4' + i, '四阶系数 A₄', 'mm⁻³', elementLimits));
    panel.append(content);
    return panel;
  }
  function materialChannels(obj) {
    if (obj.channels) return obj.channels;
    const cells = obj.pattern.map((_, i) => optics.cellFractions(obj, i));
    return Object.fromEntries(paintChannels.map(key => [key, cells.map(cell => cell[key])]));
  }
  function createPatternEditor(view, mixed) {
    const box = section(mixed ? '一维材质图案' : '一维图案');
    const presetSelect = node('select');
    presetSelect.setAttribute('aria-label',mixed ? '当前通道图案预设' : '物体图案预设');
    const manual = new Option('手绘图案','custom');
    manual.hidden = true; presetSelect.add(manual);
    const paintNames = {full:'填满当前通道',empty:'清空当前通道',ramp:'份额渐变'};
    for (const [key,p] of Object.entries(patternPresets)) {
      presetSelect.add(new Option((mixed && paintNames[key]) || p.name, key));
    }
    const channelBar=node('div','ae-channel-tabs');
    channelBar.setAttribute('role','group'); channelBar.setAttribute('aria-label','绘图通道');
    let channel=view.paintChannel || 'scatter', cell=view.paintCell || 0;
    let mode='curve', drawing=null, current, draft=null;
    const modes=node('div','ae-paint-tools');
    modes.setAttribute('role','group'); modes.setAttribute('aria-label','绘图工具');
    const board=node('div','ae-pattern-board');
    board.tabIndex=0; board.setAttribute('role','slider');
    board.setAttribute('aria-valuemin','0'); board.setAttribute('aria-valuemax','100');

    const columns=Array.from({length:binCount},() => {
      const col=node('span','ae-pattern-bin'), level=node('i','ae-pattern-level');
      col.append(level); board.append(col); return [col,level];
    });
    const strip=node('div','ae-tone-strip'+(mixed?' ae-material-strip':''));
    strip.setAttribute('aria-hidden','true');
    const tiles=columns.map(() => {
      const tile=node('i'); strip.append(tile);
      if (mixed) for(const key of paintChannels) tile.append(node('span','ae-channel-'+key));
      return tile;
    });
    const extent=node('div','ae-pattern-axis'), low=node('span'), high=node('span');
    extent.append(low,node('span','','局部 y / mm'),high);
    function smallInput(caption,max,min) {
      const label=node('label','ae-precise-field'),input=node('input');
      input.type='number'; input.step='1'; input.min=min; input.max=max;
      label.append(node('span','',caption),input); return [label,input];
    }
    const [cellLabel,indexInput]=smallInput('格号',33,1);
    const [valueLabel,valueInput]=smallInput(mixed?'本格通道 %':'灰度 %',100,0);
    const [strengthLabel,strength]=smallInput('笔刷浓度 %',100,0);
    strengthLabel.hidden=true; strength.value=100;
    const precise=node('div','ae-pattern-precise'); precise.append(cellLabel,valueLabel);
    const composition=node('div','ae-cell-mix');
    const readings={};
    if (mixed) for(const [key,title] of Object.entries(fractionNames)) {
      const row=node('span'), value=node('b');
      row.append(node('i','ae-channel-dot ae-channel-'+key),node('span','',title),value);
      composition.append(row); readings[key]=value;
    }
    const same=(a,b)=>a.every((v,i)=>Math.abs(v-b[i])<1e-12);
    const pct=v=>Number((100*v).toFixed(2));
    function available(channels,i) {
      return Math.max(0,1-paintChannels.reduce((sum,key)=>sum+(key===channel?0:channels[key][i]),0));
    }
    function sourceValues() {
      return mixed ? materialChannels(current)[channel] : current.pattern;
    }
    function refresh() {
      const channels=mixed ? materialChannels(current) : null;
      const values=draft || (mixed ? channels[channel] : current.pattern);
      const caption=mixed?fractionNames[channel]:'灰度';
      board.setAttribute('aria-label',caption+'画板。左右切换格子，上下调节。');
      board.dataset.channel=mixed?channel:'gray';
      for(let i=0;i<binCount;i++) {
        const percent=pct(values[i]),tone=Math.round(values[i]*255);
        columns[i][1].style.height=percent+'%';
        columns[i][0].classList.toggle('selected',i===cell);
        if (mixed) {
          paintChannels.forEach((key,j) => {
            tiles[i].children[j].style.height=pct(key===channel?values[i]:channels[key][i])+'%';
          });
        } else tiles[i].style.backgroundColor='rgb('+[tone,tone,tone].join(',')+')';
      }
      if(mixed) {
        for (const b of channelBar.children) b.setAttribute('aria-pressed',String(channel===b.dataset.channel));
        let sum=0;
        for (const key of paintChannels) {
          const value=key===channel?values[cell]:channels[key][cell];
          readings[key].textContent=pct(value)+'%'; sum+=value;
        }
        readings.absorption.textContent=pct(Math.max(0,1-sum))+'%';
        valueInput.max=pct(available(channels,cell));
      }
      board.setAttribute('aria-valuenow',String(pct(values[cell])));
      board.setAttribute('aria-valuetext','第 '+(cell+1)+' 格，'+caption+' '+pct(values[cell])+'%');
      indexInput.value=cell+1; valueInput.value=pct(values[cell]);
      low.textContent=shortNumber(-current.aperture/2); high.textContent='+'+shortNumber(current.aperture/2);
      presetSelect.value=Object.keys(patternPresets).find(k=>same(patternPresets[k].values,values))||'custom';
      view.paintCell=cell;
    }
    function commit(values,clearAll=false) {
      const obj=selectedObject(view.state);
      if(obj.id!==current.id||obj.type!=='object')return;
      let updated;
      if(mixed) {
        const old=materialChannels(obj);
        const channels=clearAll ? Object.fromEntries(paintChannels.map(k=>[k,Array(binCount).fill(0)]))
          : {...old,[channel]:values.map((v,i)=>Math.min(v,available(old,i)))};
        if(paintChannels.some(k=>!same(old[k],channels[k]))) updated={...obj,channels,pattern:totalPattern(channels)};
      } else if(!same(obj.pattern,values)) {
        updated={...obj,pattern:[...values]};
        // A subsequent switch to mixed material will derive channels from this edited pure pattern.
        delete updated.channels;
      }
      if(updated) validatePatch(view,{elements:view.state.elements.map(e=>e.id===obj.id?updated:e)});
      current=selectedObject(view.state); draft=null; refresh();
    }
    if (mixed) for(const key of paintChannels) {
      const b=action(fractionNames[key],'paint-channel'); b.dataset.channel=key;
      b.prepend(node('i','ae-channel-dot ae-channel-'+key));
      b.onclick=()=>{if(drawing)return;channel=key;view.paintChannel=key;refresh();};
      channelBar.append(b);
    }
    const tools={curve:mixed?'画份额':'画灰度', light:mixed?'定值笔刷':'涂亮', erase:'擦除'};
    for (const [key,title] of Object.entries(tools)) {
      const b=action(title,'paint-tool'); b.setAttribute('aria-pressed',String(mode===key));
      b.onclick=()=>{mode=key;strengthLabel.hidden=!mixed||mode!=='light';
        for(const tool of modes.children)tool.setAttribute('aria-pressed',String(tool===b));};
      modes.append(b);
    }
    presetSelect.onchange=()=>{const p=patternPresets[presetSelect.value];if(p)commit(p.values);};
    const clear=action('清空全部通道','clear-material','全部格子恢复为 100% 吸收，可撤销');
    clear.onclick=()=>commit(null,true);
    function paint(event) {
      const rect=board.getBoundingClientRect();
      const index=Math.max(0,Math.min(binCount-1,Math.floor((event.clientX-rect.left)/rect.width*binCount)));
      const vertical=1-(event.clientY-rect.top)/rect.height;
      const brush=mixed ? (Number.isFinite(strength.valueAsNumber)?strength.valueAsNumber/100:1) : 1;
      const raw=mode==='erase'?0:mode==='light'?brush:vertical;
      const value=Math.max(0,Math.min(1,Math.round(100*raw)/100));
      const channels=mixed ? materialChannels(current) : null;
      const write=(i,v)=>{draft[i]=mixed?Math.min(available(channels,i),v):v;};
      if(drawing.lastIndex!==undefined&&drawing.lastIndex!==index) {
        const distance=index-drawing.lastIndex, direction=Math.sign(distance);
        for(let j=drawing.lastIndex+direction;j!==index;j+=direction) {
          const fraction=(j-drawing.lastIndex)/distance;
          write(j,Math.round(100*(drawing.lastValue+fraction*(value-drawing.lastValue)))/100);
        }
      }
      write(index,value);cell=index;drawing.lastIndex=index;drawing.lastValue=value;refresh();
    }
    board.onpointerdown=event=>{
      if(event.button!==0||drawing)return;
      event.preventDefault();board.focus({preventScroll:true});board.setPointerCapture(event.pointerId);
      drawing={id:event.pointerId};draft=sourceValues().slice();paint(event);
    };
    board.onpointermove=event=>{if(drawing?.id===event.pointerId)paint(event);};
    board.onpointerup=event=>{
      if(drawing?.id!==event.pointerId)return;
      paint(event);const values=draft;drawing=null;commit(values);
    };
    board.onpointercancel=board.onlostpointercapture=event=>{
      if(drawing?.id!==event.pointerId)return;
      drawing=null;draft=null;refresh();
    };
    board.onkeydown=event=>{
      if(drawing||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End','Delete','Backspace'].includes(event.key))return;
      event.preventDefault();
      if(event.key==='ArrowLeft')cell=Math.max(0,cell-1);
      else if(event.key==='ArrowRight')cell=Math.min(binCount-1,cell+1);
      else if(event.key==='Home')cell=0;
      else if(event.key==='End')cell=binCount-1;
      else {
        const values=sourceValues().slice(),step=event.shiftKey ? .01 : .05;
        values[cell]=event.key==='Delete'||event.key==='Backspace'?0:Math.max(0,Math.min(1,Math.round(100*(values[cell]+(event.key==='ArrowUp'?step:-step)))/100));
        commit(values);return;
      }
      refresh();
    };
    indexInput.onchange=()=>{if(Number.isInteger(indexInput.valueAsNumber))cell=Math.max(0,Math.min(32,indexInput.valueAsNumber-1));refresh();};
    valueInput.onchange=()=>{const v=valueInput.valueAsNumber;if(!Number.isFinite(v)){refresh();return;}
      const values=sourceValues().slice();values[cell]=Math.max(0,Math.min(100,v))/100;commit(values);};
    if(mixed)box.append(channelBar);
    box.append(presetSelect,modes,strengthLabel,board,strip,extent,precise);
    if(mixed)box.append(composition,clear,note('横轴选位置，纵轴画所选成分的份额。其他通道保留，画笔最多用满本格余量；未分配的部分吸收。'));
    else box.append(note('横向为物体位置，纵向为灰度。拖动画线，松开后更新光路。图案面上的黑格吸收全部入射光。'));
    return {box,sync(obj){current=obj;if(!drawing)refresh();}};
  }
  function elementFields(container, e, view) {
    const number = (key, caption, unit = 'mm', step) => numberField(key, caption, unit, elementLimits, step);
    if (e.type==='object') {
      container.append(menuField('interaction','物体属性',objectModes));
      const mixed = e.interaction === 'mixed';
      view.patternEditor=createPatternEditor(view,mixed);
      container.append(view.patternEditor.box);
      if (mixed && !e.channels) {
        const legacy = node('details','ae-surface');
        legacy.append(node('summary','','原实验的全局材质份额'));
        view.fractionEditor=createFractionEditor(view);
        legacy.append(view.fractionEditor.panel,note('各格按原图案灰度乘以全局份额显示。第一次绘制会把当前分布保存为独立通道。'));
        container.append(legacy);
      }
      if (mixed || e.interaction==='scatter') {
        const model=e.scatterModel || 'diffuse';
        const panel=section('散射角分布');
        if(mixed) panel.append(menuField('scatterModel','散射模型',scatterModels));
        if(mixed && model==='mie') panel.append(
          group(number('mieDiameter','球形粒子直径','µm'),number('mieIndex','粒子折射率','')),
          note('0° 沿入射光前进方向。粒径、粒子与介质折射率及波长决定角分布。'));
        if(mixed && model==='hg') panel.append(number('scatterG','各向异性参数 g',''),
          note('0° 沿入射光前进方向。g 越大，前向峰越集中。'));
        if(!mixed || model==='diffuse')panel.append(note(mixed ?
          '漫反射向入射侧半空间出射，以入射侧表面法线为中心。' : '透射侧余弦散射以透射侧表面法线为中心。'));
        const forward=mixed && model!=='diffuse';
        const angle=number('scatterAngle',forward?'采样角窗半角':'散射半角','°');
        const samples=number('scatterSamples','角度采样','条',2);
        if(!forward){angle.querySelector('input').max='89.999';samples.querySelector('input').max='9';}
        panel.append(group(angle,samples));
        if(forward)panel.append(note('分配给散射的能量归一化到所选角窗。半角设为 180° 可包含后向角度。'));
        if(mixed && model==='mie') {
          const plot=node('canvas','mie-phase-plot');
          plot.width=300;plot.height=100;plot.setAttribute('role','img');plot.setAttribute('aria-label','米氏散射角分布');
          view.phasePlot=plot;panel.append(plot,note('角分布图取空气中入射、光源参考波长。'));
        }
        container.append(panel);
      }
      if(mixed || e.interaction==='refract')container.append(section('折射楔片',
        group(number('thickness','中心厚度'),number('n','常数折射率','')),number('wedge','后表面楔角','°'),
        note('图案位于前表面。楔角为 0° 时两面平行，折射率在所有采样波长保持相同。')));
      if(e.interaction==='reflect')container.append(note('亮格按局部法线镜面反射。可将法线设为 −45°，使水平入射光向上折转。'));
    }
    const origin = e.type === 'lens' ? '前顶点' : e.type === 'object' ? '图案中心' : '中心位置';
    const pose = section('放置与尺寸', textField('name', '器件名称', labels[e.type], 64),
      group(number('x', origin + ' x'), number('y', origin + ' y')),
      group(number('angle', e.type === 'lens' ? '光轴角' : '法线角', '°'),
        number('aperture', e.type === 'screen' ? '接收宽度' : e.type === 'mirror' ? '有效镜宽' : e.type==='object' ? '图案全宽' : '通光直径')));
    container.append(pose);
    if (e.type === 'lens') {
      pose.append(textField('group', '所属镜组', '留空为独立镜片', 24));
      const body = section('镜体', group(menuField('material', '玻璃材料', materials), number('thickness', '中心厚度')));
      if (e.material === 'CUSTOM') body.append(number('n', '常数折射率 n', ''), note('该材料在所有采样波长使用相同折射率。'));
      container.append(body, lensSurface(1, e), lensSurface(2, e),
        note('R > 0 表示曲率中心在该表面沿局部光轴的正向。圆锥系数 k = 0 对应球面，k = −1 对应抛物面。'));
    } else if (e.type === 'stop') {
      pose.append(number('outerDiameter', '不透明光阑外径'),
        note('内孔和外径之外均可通光，两者之间遮光。'));
    } else if (e.type === 'grating') {
      container.append(section('光栅参数', group(number('lines', '刻线密度', '线/mm'), number('order', '衍射级次 m', '', 1)),
        note('m = 0 为直通方向；正负级次沿局部切向展开。')));
    } else if (e.type === 'mirror') {
      pose.append(note('以 +x 轴为 0°，逆时针为正。水平入射时，法线设为 −45° 可向上折转。'));
    } else if(e.type==='screen') {
      pose.append(note('探测截距以屏中心为零，沿探测屏的局部切向为正。'));
    }
  }
  function listTitle(e) { return e.name || labels[e.type]; }
  function shortNumber(v) { return Number.isFinite(v) ? String(Math.round(v * 10) / 10) : '—'; }
  function listRow(e, selected, s) {
    const button = node('button', 'ae-row');
    const emitter = !e;
    const type = emitter ? 'source' : e.type;
    button.type = 'button'; button.dataset.select = emitter ? 'source' : e.id;
    button.setAttribute('aria-pressed', String(selected === button.dataset.select));
    button.append(node('span', 'ae-symbol ae-' + type, symbols[type]));
    const label = node('span', 'ae-row-text');
    label.append(node('b', '', emitter ? '光源' : listTitle(e)));
    const detail = emitter ? spatial[s.type] : `x ${shortNumber(e.x)} · y ${shortNumber(e.y)} mm`;
    label.append(node('small', '', detail));
    button.append(label);
    if (!emitter && e.group) button.append(node('span', 'ae-group-tag', e.group));
    return button;
  }
  function setMessage(view, message) {
    view.error.textContent = message;
    view.error.hidden = !message;
  }
  function selectedObject(state) {
    return state.elements.find(e => e.id === state.selected) || state.source;
  }
  function newId(state, type) {
    const prefix = {object:'o',lens: 'l', stop: 'p', screen: 's', mirror: 'm', grating: 'g'}[type];
    let idx = 1;
    while (state.elements.some(e => e.id === prefix + idx)) idx++;
    return prefix + idx;
  }
  function makeObject(scene) {
    const s=scene.source, rad=s.angle*Math.PI/180, dx=Math.cos(rad), dy=Math.sin(rad);
    const ahead=scene.elements.map(e=>(e.x-s.x)*dx+(e.y-s.y)*dy).filter(distance=>distance>0);
    const distance=ahead.length?Math.min(Math.min(...ahead)*.45,24):24;
    const width=s.type==='collimated'?s.width*binCount/(binCount-1):
      Math.max(1,(s.type==='field'?s.height:0)+2*distance*Math.tan(s.spread*Math.PI/180));
    const clampPos=v=>Math.max(-10000,Math.min(10000,v));
    return patternedObject({id:newId(scene,'object'),x:clampPos(s.x+dx*distance),y:clampPos(s.y+dy*distance),
      angle:s.angle, thickness: Math.max(.01, Math.min(defaults.object.thickness, distance)),
      aperture:Math.max(.1,Math.min(1000,width)),pattern:patternPresets.empty.values});
  }
  function makeElement(state, type, copy) {
    if(type==='object')return makeObject(state);
    const current = selectedObject(state);
    const id = newId(state, type), name = copy ? listTitle(current).slice(0, 54) + ' 副本' :
      labels[type] + ' ' + id.toUpperCase();
    const angle = current.angle * Math.PI / 180;
    const distance = current.type === 'lens' ? current.thickness + 18 : 25;
    const x = current.x + distance * Math.cos(angle), y = current.y + distance * Math.sin(angle);
    if (copy) return {...current, id, name, x, y};
    return {...element(type, id, name, x), y, angle: type === 'mirror' ? current.angle - 45 : current.angle};
  }
  function revealSelection(view) {
    if (matchMedia('(max-width:760px)').matches) {
      requestAnimationFrame(() => view.formTitle.scrollIntoView({block: 'nearest'}));
    }
  }
  function validatePatch(view, patch) {
    const scene = {...view.state, ...patch};
    let errors = [];
    if (patch.source) errors = validateSource(patch.source);
    if (patch.elements) {
      for (const e of patch.elements) {
        errors = validateElement(e);
        if (errors.length) break;
      }
    }
    if (!errors.length) errors = optics.validateScene(scene);
    if (errors.length) {
      setMessage(view, errors[0]);
      return false;
    }
    setMessage(view, '');
    if (view.commit(patch) === false) return false;
    view.state = scene;
    return true;
  }
  function changeShape(e, key, shape) {
    const i = key.endsWith('1') ? 1 : 2;
    const r = 'r' + i, k = 'k' + i, a = 'a4' + i;
    const result = {...e, [key]: shape};
    result[r] = shape === 'plane' ? 0 : e[r] || (i === 1 ? 75 : -75);
    result[k] = ['conic', 'asphere'].includes(shape) ? e[k] || 0 : 0;
    result[a] = shape === 'asphere' ? e[a] || 0 : 0;
    return result;
  }
  function displayedValue(item, key) {
    if (key === 'shape1' || key === 'shape2') return surfaceShape(item, key.slice(-1));
    if (key === 'scatterModel') return item.scatterModel || 'diffuse';
    if (item.interaction === 'mixed' && Object.hasOwn(fractionNames, key)) {
      return Number((item.fractions[key] * 100).toFixed(8));
    }
    return item[key] ?? '';
  }
  function applyInput(view, input, final) {
    const key = input.dataset.field;
    if (!key) return;
    const item = selectedObject(view.state), original = displayedValue(item, key);
    let value = input.value;
    if (input.type === 'number') {
      if (value.trim() === '' || !Number.isFinite(input.valueAsNumber)) {
        if (final) { input.value = original; setMessage(view, '已恢复上次有效数值。'); }
        return;
      }
      value = input.valueAsNumber;
    }
    if (value === original) { setMessage(view, ''); return; }
    let updated;
    if (item.interaction === 'mixed' && Object.hasOwn(fractionNames, key)) {
      const balance = view.balanceChannel;
      if (key === balance) return;
      const fractions = {...item.fractions, [key]:value / 100};
      const fixed = Object.keys(fractionNames).filter(k => k !== balance && k !== key);
      const max = 1 - fixed.reduce((sum, k) => sum + fractions[k], 0);
      if (value < 0 || value > max * 100 + 1e-9) {
        setMessage(view, '其余两项已固定，本项可设为 0 至 ' +
          Number((Math.max(0, max) * 100).toFixed(6)) + '%。可先调低其他份额。');
        input.setAttribute('aria-invalid', 'true');
        if (final) { input.value = original; input.removeAttribute('aria-invalid'); }
        return;
      }
      fractions[balance] = Math.max(0, max - fractions[key]);
      updated = {...item, fractions};
    }
    else if (key.startsWith('shape')) updated = changeShape(item, key, value);
    else if (key==='scatterModel') {
      updated={mieDiameter:1,mieIndex:1.59,scatterG:.8,...item,scatterModel:value};
      if(value==='diffuse'){
        updated.scatterSamples=Math.min(updated.scatterSamples,9);
        if(updated.scatterAngle>=90)updated.scatterAngle=89;
      }
    }
    else if (item.type==='object' && key==='interaction') {
      // Imported scenes can omit properties that were inactive when saved.
      updated={...defaults.object,...item,interaction:value};
      if(value==='mixed' && !item.channels) {
        const soloChannel={scatter:'scatter',reflect:'reflection',refract:'transmission'}[item.interaction];
        if(soloChannel){
          updated.channels=Object.fromEntries(paintChannels.map(k=>[k,item.pattern.map(v=>k===soloChannel?v:0)]));
          Object.assign(updated,{scatterModel:'mie',mieDiameter:1,mieIndex:1.59,scatterG:.8,scatterAngle:45,scatterSamples:9});
        }
      }
      if(value==='scatter') {
        updated.scatterSamples=Math.min(updated.scatterSamples,9);
        if(updated.scatterAngle>=90)updated.scatterAngle=89;
      }
      if (['mixed','refract'].includes(value) && updated.thickness-Math.abs(Math.tan(updated.wedge*Math.PI/180))*updated.aperture/2<=1e-7) {
        updated.wedge=0;
      }
    } else updated={...item, [key]:value};
    const patch = item === view.state.source ? {source: updated} :
      {elements: view.state.elements.map(e => e.id === item.id ? updated : e)};
    const success = validatePatch(view, patch);
    if (!success) {
      input.setAttribute('aria-invalid', 'true');
      if (final || input.tagName === 'SELECT') {
        input.value = original;
        input.removeAttribute('aria-invalid');
      }
    } else input.removeAttribute('aria-invalid');
  }
  function createView(host) {
    host.classList.add('adv-editor');
    const heading = node('div', 'ae-heading');
    const list = node('div', 'ae-list'); list.setAttribute('aria-label', '场景器件');
    const count = node('small');
    heading.append(node('h3', '', '光学组件'), count);
    const addLine = node('div', 'ae-add-line');
    const addType = node('select');
    addType.setAttribute('aria-label', '添加器件类型');
    for (const [value, title] of Object.entries(labels)) {
      if (value !== 'source') addType.add(new Option(title, value));
    }
    addLine.append(addType, action('＋ 添加', 'add'));
    const formHeader = node('div', 'ae-form-header');
    const formTitle = node('h3');
    const actions = node('div', 'ae-actions');
    actions.append(action('复制', 'copy'), action('删除', 'delete'));
    formHeader.append(formTitle, actions);
    const error = node('p', 'ae-error'); error.hidden = true; error.setAttribute('role', 'status');
    const form = node('div', 'ae-form');
    host.replaceChildren(heading, list, addLine, formHeader, error, form);
    const view = {host, count, list, addType, formTitle, error, actions, form, listKey: '', formKey: ''};
    host.addEventListener('click', event => {
      const b = event.target.closest('button');
      if (!b || !host.contains(b)) return;
      const state = view.state;
      if (b.dataset.select) {
        view.commit({selected: b.dataset.select});
        revealSelection(view);
        return;
      }
      if (b.dataset.action === 'add' || b.dataset.action === 'copy') {
        const copy = b.dataset.action === 'copy';
        if (copy && !state.elements.some(e => e.id === state.selected)) return;
        const type = copy ? selectedObject(state).type : addType.value;
        const e = makeElement(state, type, copy);
        if (validatePatch(view, {elements: [...state.elements, e], selected: e.id})) revealSelection(view);
      }
      if (b.dataset.action === 'delete') {
        const i = state.elements.findIndex(e => e.id === state.selected);
        if (i < 0) return;
        const remaining = state.elements.filter(e => e.id !== state.selected);
        validatePatch(view, {elements: remaining, selected: remaining[Math.min(i, remaining.length - 1)]?.id || 'source'});
      }
    });
    host.addEventListener('input', event => {
      if (event.target.type === 'number') applyInput(view, event.target, false);
    });
    host.addEventListener('change', event => applyInput(view, event.target, true));
    host.addEventListener('focusout', event => {
      const input = event.target;
      if (input.dataset.field && input.type === 'number') {
        input.value = displayedValue(selectedObject(view.state), input.dataset.field);
        input.removeAttribute('aria-invalid');
      }
    });
    host.addEventListener('keydown', event => {
      const field = event.target;
      if (!field.dataset.field) return;
      if (event.key === 'Enter') { event.preventDefault(); field.blur(); }
      if (event.key === 'Escape') {
        field.value = displayedValue(selectedObject(view.state), field.dataset.field);
        field.removeAttribute('aria-invalid'); setMessage(view, ''); field.blur();
      }
    });
    return view;
  }
  function render(host, state, commit) {
    let view = views.get(host);
    if (!view) { view = createView(host); views.set(host, view); }
    view.state = state; view.commit = commit;
    const item = selectedObject(state), isSource = item === state.source;
    const selected = isSource ? 'source' : item.id;
    const listKey = JSON.stringify([selected, state.source.type,
      state.elements.map(e => [e.id, e.type, e.name, e.x, e.y, e.group])]);
    if (listKey !== view.listKey) {
      view.list.replaceChildren(listRow(null, selected, state.source),
        ...state.elements.map(e => listRow(e, selected, state.source)));
      view.count.textContent = state.elements.length + ' 件器件';
      view.listKey = listKey;
    }
    const hasObject=state.elements.some(e=>e.type==='object');
    const objectOption=Array.from(view.addType.options).find(o=>o.value==='object');
    objectOption.disabled=hasObject;
    objectOption.textContent=hasObject?'图案物体（已添加）':labels.object;
    if(hasObject && view.addType.value==='object')view.addType.value='lens';
    const copyButton=view.actions.querySelector('[data-action="copy"]');
    copyButton.disabled=item.type==='object';
    copyButton.title=item.type==='object'?'一个实验可使用一个图案物体。':'复制当前器件';
    const formKey = JSON.stringify([selected, item.type, item.interaction, item.scatterModel, !!item.channels, item.spectrum, item.material,
      item.type === 'lens' && surfaceShape(item, 1), item.type === 'lens' && surfaceShape(item, 2)]);
    if (formKey !== view.formKey) {
      view.form.replaceChildren(); view.actions.hidden = isSource; view.patternEditor=null; view.fractionEditor=null;view.phasePlot=null;
      if (isSource) sourceFields(view.form, item); else elementFields(view.form, item, view);
      setMessage(view, ''); view.formKey = formKey;
    }
    view.formTitle.textContent = isSource ? '光源设置' : listTitle(item);
    if(view.patternEditor)view.patternEditor.sync(item);
    if(view.fractionEditor)view.fractionEditor.sync(item);
    if(view.phasePlot)window.MiePhase?.draw(view.phasePlot,{diameter:item.mieDiameter,index:item.mieIndex,
      medium:1,wavelength:state.source.wavelength,halfAngle:item.scatterAngle,samples:item.scatterSamples});
    for (const input of view.form.querySelectorAll('[data-field]')) {
      const value = displayedValue(item, input.dataset.field);
      if (document.activeElement === input) {
        if (input.type === 'text' || input.getAttribute('aria-invalid') === 'true') continue;
        if (input.type === 'number' && input.valueAsNumber === value) continue;
      }
      if (input.value !== String(value)) input.value = value;
    }
  }
  return {render, presets, validateElement, validateSource,makeObject,patternPresets};
});
