/* One handbook for both simulators; plain scripts also work when opened as local files. */
(() => {
  'use strict';
  const intro = {
    id:'start', part:'阅读起点', title:'从一束光，开始理解成像',
    summary:'这既是一份操作指南，也是可以边读边做的光学入门课。先用基础实验室建立直觉，再到进阶工作站检查真实曲面、光谱与能量。',
    html:`
      <div class="m-path">
        <button data-manual-go="b-start"><strong>第一次接触光学</strong><span>从拖动一片凸透镜开始，认识物距、像距、焦距与实像。</span></button>
        <button data-manual-go="a-start"><strong>已经会用薄透镜</strong><span>进入曲面工作站，设置材料、光源、物体与探测器，逐步检查演算。</span></button>
      </div>
      <h2>读手册，也做实验</h2>
      <p>每章先说明要观察的现象，再解释控件与公式，最后给出实验步骤和思考题。建议一次只改变一个参数，先预测结果，再运行实验。遇到不认识的词，可以搜索整册内容，也可以到末尾查阅符号表。</p>
      <p>基础版和进阶版右上角都叫<strong>「实验手册」</strong>，打开的是同一本手册。关闭后继续当前实验；阅读、搜索与下面的小实验都不会更改实验台的配置。你也可以打开独立阅读页，将它与实验台并排使用。整册打印会包含各章正文及练习答案。</p>
      <h2>先看一个关键关系</h2>
      <p>将一片会聚薄透镜放在原点，物体在左侧，光向右传播。在这个小实验中，物距 u 是物体到透镜的正距离，焦距 f 为正；像距 v 向右为正。拖动滑块，观察物体跨过前焦点时，像发生了什么。</p>
      <div class="manual-equation">1/f = 1/u + 1/v<br>v = fu / (u − f)　　m = −v/u</div>
      <div class="m-lens-demo" data-lens-demo>
        <div class="m-demo-chart"><svg viewBox="0 0 680 270" role="img" aria-label="可交互薄透镜成像示意图"></svg></div>
        <div class="m-demo-legend"><span>物体</span><span>像</span></div>
        <div class="m-demo-controls">
          <label>物距 u <output id="m-u-value">200 mm</output><input id="m-u" aria-label="演示物距" type="range" min="40" max="300" step="5" value="200"></label>
          <label>焦距 f <output id="m-f-value">100 mm</output><input id="m-f" aria-label="演示焦距" type="range" min="40" max="150" step="5" value="100"></label>
        </div>
        <p class="m-demo-result" aria-live="polite"></p>
        <p class="m-demo-caption">近轴薄透镜示意，视野随像的位置自动缩放。虚线表示反向延长线，画出的线条数量不表示能量。</p>
      </div>
      <p>当 u = 2f，v = 2f，像与物体等大且倒立；当 u &gt; f，能在右侧找到实像；当 0 &lt; u &lt; f，像在物体同侧，是正立放大的虚像。恰好 u = f 时出射光平行，没有有限距离的共轭像面。</p>
      <h2>两套实验台各适合什么</h2>
      <div class="manual-table-wrap"><table><thead><tr><th>想回答的问题</th><th>从哪里开始</th><th>如何理解结果</th></tr></thead><tbody>
        <tr><td>物体移动后，像在哪里、多大、倒不倒立？</td><td>基础版：物像分析、观察屏</td><td>同轴、薄透镜、小角度的理想结果。</td></tr>
        <tr><td>多片透镜怎样接力成像？</td><td>基础版：4f 中继与系统矩阵</td><td>先理解共轭关系与放大率。</td></tr>
        <tr><td>光怎样穿过真实曲面？</td><td>进阶版：曲面、材料、逐面演算</td><td>在二维截面中寻找交点并按局部法线折射。</td></tr>
        <tr><td>不同波长为何不在同处聚焦？</td><td>进阶版：宽谱、材料与探测屏</td><td>几何色散与像差；不包含干涉衍射斑。</td></tr>
        <tr><td>物体的不同区域怎样反射、散射和透过？</td><td>进阶版：物体与图案、能量账本</td><td>逐格分配能量，再追踪各分支能否到达探测器。</td></tr>
      <tr><td>偏振片为何能消光，波片如何改变旋向？</td><td>进阶版：偏振标记、逐面追迹与偏振分析</td><td>对照每条光线的 Stokes 态与整块屏的功率加权读数。</td></tr>
      </tbody></table></div>
      <h2>贯穿全册的三个习惯</h2>
      <ol><li><strong>先认参考点。</strong>坐标 x、物距 u、像距 v、EFL 与 BFL 不是同一个量。读数前确认从哪里量起、正方向是什么。</li><li><strong>先看光有没有到达。</strong>没有像可能是焦面不对，也可能是物体吸收、光阑截断、光束转向或屏太小。沿光路逐步定位原因。</li><li><strong>区分物理结果与显示。</strong>光线数量、线条透明度、屏幕曝光和真正的能量权重是不同概念。比较亮暗时先统一曝光与采样。</li></ol>
      <div class="manual-callout">这里的实验是光学模型的交互演示。基础版强调理想成像关系；进阶版强调二维几何追迹。把两者的差异当作理解模型假设的机会。</div>`
  };
  const appendix = [
    {id:'faq',part:'查阅与排错',title:'为什么结果和预想不同？',summary:'从光源、物体、传输路径、共轭面和显示方式依次检查。先确认光走到了哪里，再判断成像好不好。',html:`
      <h2>探测屏为什么不像物体图案？</h2>
      <p>物体编辑器画的是各个位置的散射、镜面反射、透明介质份额。探测器统计的是到达各个位置的光线能量，两幅图本来就代表不同的量。只有在合适的物像共轭关系、充分照明和足够收光范围下，屏上才可能呈现图案的空间结构。</p>
      <ol><li><strong>照明：</strong>光束宽度是否覆盖物体？采样光线是否实际打到了每一条细纹？</li><li><strong>出射：</strong>物体上各格是向前散射、向后反射还是透明折射？这些分支并不都进入同一块屏。</li><li><strong>收光：</strong>有没有光阑、镜片口径或转折路径丢失了部分角度？</li><li><strong>共轭：</strong>屏位于真正的像面，还是某片透镜的后焦平面？对准焦点不等于对准物体的像。</li><li><strong>采样与显示：</strong>增加光源采样；检查屏宽、屏方向、曝光和峰值归一。屏太宽会把细节压在少数格中；固定曝光过亮会让结构看起来一样白。</li></ol>
      <div class="manual-callout"><strong>特别容易混淆：</strong>最后一片镜片后的一个焦距位置，主要把入射角度映射为位置。若多个物点以接近相同的方向入射，它们可能集中在同一个小区域。这不能单凭 BFL 判定为物体的像面。<button data-manual-go="a-cardinal">复习焦点、主面与 4f</button>。</div>
      <details><summary>基础版明明显示有像，观察屏却接不到？</summary><p>检查它是不是虚像。虚像来自出射光的反向延长线，不能直接由该出射光束投到观察屏上。还要检查口径：理想共轭读数可以存在，但实际示意光线可能被截断。基础版的屏上光束半径只针对物体尖端的近轴束。</p></details>
      <details><summary>缩小镜片通光口径，为什么基础版像的位置不变？</summary><p>基础版使用理想薄透镜矩阵，口径不改变屈光力。它改变通光范围，不改变理想共轭关系。进阶版包含真实曲面几何像差，缩小光阑可能改变边缘光线占比与几何光斑，但本程序不据此计算衍射极限。</p></details>
      <details><summary>前向散射为什么也有少量光向后走？</summary><p>前向散射表示角分布在前向更集中，并不保证所有角度都向前。米氏分布可以有侧向与后向瓣，HG 分布也有尾部。此外，透明介质前后界面的菲涅耳反射可产生反向分支。请在逐事件演算中区分散射与界面反射。旧混合材质配置未指定散射模型时保留入射侧漫反射行为；旧“透射侧余弦散射”则向透射侧出光；需要前向分布，请在散射模型中明确选择米氏或 HG。</p></details>
      <details><summary>没有绘制的区域为什么仍可能反光？</summary><p>逐格 S、R、T 全为零的<strong>图案面</strong>全吸收。物体有厚度：光从背面首先遇到透明基片后界面时，仍可能先发生菲涅耳反射，然后才到达图案面。请看光的入射侧和事件顺序。</p></details>
      <details><summary>能量守恒，为什么探测功率小于发出功率？</summary><p>能量可能被物体或偏振片吸收、被口径阻挡、逃出系统，或进入尚未继续追迹的微弱/高阶分支。全系统应比较发出与各个终态类别之和，不能只比较发出与探测。表面累计相遇量可能因多次往返大于发出量，它不是额外产生的能量。</p></details>
      <details><summary>进阶的矩阵读数与折转光路不一致？</summary><p>全系统 ABCD 摘要有同轴近轴的适用条件。转向镜、偏轴、旋转、遮拦与再入射需要查看真实交点追迹。单片镜片或局部同轴组的 EFL 仍可作为局部近轴参考，不能直接套用成全系统的物像关系。</p></details>
      <details><summary>预设切换后还能恢复？怎么保存？</summary><p>切换预设会更换当前场景，重要实验先用「保存实验」导出 JSON。进阶版可用撤销/重做回退场景编辑；基础版没有同等的通用撤销。浏览器自动保存只属于当前浏览器和页面来源，不等于导出的备份。换浏览器、换端口、从 file 页面切到 localhost 都可能看到不同的本地工作区。</p></details>
      <h2>推荐的排错顺序</h2><p>先保存场景，再选一条有代表性的光线。确认光源位置与传播方向，检查它是否打到物体和第一片镜片，逐事件向前追踪，最后看探测屏的交点与功率。每次只调整一个原因，避免同时改焦距、屏位置和曝光后不知道哪个变化起作用。</p>`},
    {id:'glossary',part:'查阅与排错',title:'符号、单位与模型边界',summary:'把常用量放在一起查阅。相同字母在不同公式中可能代表不同含义，请连同参考点与适用模型一起读。',html:`
      <h2>长度、角度与光谱</h2>
      <div class="manual-table-wrap"><table><thead><tr><th>符号 / 名称</th><th>含义与单位</th></tr></thead><tbody>
      <tr><td>x、y</td><td>世界坐标，单位 mm；x 向右，y 向上。旋转元件还有自己的局部轴。</td></tr>
      <tr><td>u、v</td><td>基础单薄透镜章节中，u 是左侧实物到镜片的正距离，v 以镜片向右为正；多镜片输出像距从最后一片镜片起量。</td></tr>
      <tr><td>f、EFL</td><td>焦距 / 有效焦距，mm。EFL 以主面为参考；会聚为正，发散为负。</td></tr>
      <tr><td>BFL、H / H′、F / F′</td><td>后焦距、前/后主面、前/后焦点。BFL 从后表面顶点量起，不是任意物体的像距。</td></tr>
      <tr><td>m</td><td>横向放大率（像高 / 物高），无量纲。基础同轴系统中负号表示倒立；光栅公式中的 m 则表示衍射级次。</td></tr>
      <tr><td>R₁、R₂</td><td>曲面半径，mm。沿器件固定的局部 +x 轴，曲率中心在顶点正方向为正，逆向入射不改变该符号。基础版平面填 ∞；进阶版直接选择“平面”。</td></tr>
      <tr><td>n、λ</td><td>折射率无量纲；光源波长 λ 使用 nm。材料的 n 可以随 λ 变化。</td></tr>
      <tr><td>θ、α</td><td>界面中的角度显示通常用度，矩阵与计算公式中的小角度采用弧度。入射角相对于局部法线定义。</td></tr>
      <tr><td>D、d</td><td>D 常用于口径直径；d 可表示传播距离或厚度，均用 mm。光栅周期与米氏粒径的单位需看各自控件。</td></tr>
      <tr><td>粒径、线密度</td><td>米氏球粒径用 μm；光栅线密度用线/mm，周期是其倒数。1 mm = 1000 μm = 10⁶ nm。</td></tr>
      </tbody></table></div>
      <h2>从光线到能量</h2>
      <div class="manual-table-wrap"><table><thead><tr><th>符号 / 名称</th><th>读法</th></tr></thead><tbody>
      <tr><td>A、B、C、D</td><td>系统的 2×2 光线传递矩阵元素。不要把此处 A 与吸收份额混淆。</td></tr>
      <tr><td>S、R、T、A</td><td>物体图案各格的散射、镜面反射、透明介质、剩余吸收份额；A = 1 − S − R − T。</td></tr>
      <tr><td>F</td><td>界面菲涅耳功率反射率，0 到 1；与焦点字母 F 的含义不同。</td></tr>
      <tr><td>W / 权重</td><td>每条光线携带的相对能量权重。本实验未标定为实际 W（瓦特）；不要把变量名与单位混淆。</td></tr>
      <tr><td>g</td><td>HG 散射参数。标准三维定义为平均散射余弦；本程序用其角函数进行二维角窗采样。</td></tr>
      <tr><td>I、Q、U、V</td><td>Stokes 参量。I 为相对功率，Q、U、V 分别为正交线偏振、对角线偏振与圆偏振的功率差。偏振分析中的小写 q、u、v 已除以 I。</td></tr>
      <tr><td>几何光斑 / RMS</td><td>射线落点的几何分布及其统计宽度，不是艾里斑、相干干涉图或完整三维点扩散函数。</td></tr>
      </tbody></table></div>
      <h2>这份模拟可以回答到哪一层</h2>
      <p><strong>基础版：</strong>同轴薄透镜、近轴成像、口径截光和矩阵组合。无厚度传播、材料色散或物体能量分支；光线颜色用于区分路径。</p>
      <p><strong>进阶版：</strong>二维子午面内的曲面交点、折射、反射、全反射、选定光栅级次方向、材料色散、几何像差、物体多分支能量分配、理想偏振片与波片、逐段 Stokes 态和一维探测分布。光源宽谱是有限波长采样，空间图案也是有限格点采样。</p>
      <p><strong>尚未包括：</strong>完整三维场曲和弧矢焦面、不同光线间的相干相位、干涉图、波动衍射斑、晶体双折射分束、镀膜、多粒子电磁耦合，以及从真实粒子浓度推导散射总功率。光栅的各级效率也不是当前模型的计算结果。</p>
      <div class="manual-callout">学习顺序可以是：理想成像 → 孔径与采样 → 厚透镜与主面 → 波长与几何像差 → 物体能量与角分布 → 偏振变换与探测。每提高一层模型精度，都要重新检查之前默认成立的假设。</div>
      <h2>进一步阅读</h2><p>各章末尾列有与该章相对应的开放教材、光学厂商技术说明或算法文档。公式的符号约定可能随资料变化，阅读时先对齐坐标方向与参考平面，再比较数值。</p>`}
  ];
  const chapters = [intro,...(globalThis.OpticsManualBasic || []),...(globalThis.OpticsManualAdvanced || []),...appendix];
  const escape = value => String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const plain = html => { const template=document.createElement('template');template.innerHTML=html;return template.content.textContent.replace(/\s+/g,' ').trim(); };
  const corpus = chapters.map(c=>({...c,text:plain(c.html)}));
  const standalone = !!document.getElementById('manual-root');
  const host = document.getElementById('manual-root') || document.body.appendChild(document.createElement('dialog'));
  host.id=standalone?'manual-root':'opticsManual';host.className='optics-manual';
  if(!standalone)host.setAttribute('aria-labelledby','m-title');
  host.innerHTML=`<div class="m-shell"><header class="m-header"><div class="m-brand"><span class="m-mark" aria-hidden="true"><svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.2"><path d="M3 25 29 7M3 7l26 18M16 3c-7 8-7 18 0 26 7-8 7-18 0-26Z"/></svg></span><div><strong id="m-title">光迹 · 实验手册</strong><small>LEARN BY EXPLORING</small></div></div><div class="m-header-actions">${standalone?'<a class="m-lab-link" href="index.html">基础实验室</a><a href="advanced.html">进阶工作站</a>':'<a class="m-open-page" href="manual.html" target="_blank" rel="noopener">独立阅读</a>'}<button class="m-print" type="button">打印整册</button>${standalone?'':'<button class="m-close" type="button">返回实验</button>'}</div><button class="m-mobile-toc" type="button" aria-expanded="false" aria-controls="m-sidebar">目录与搜索</button></header><div class="m-layout"><aside id="m-sidebar" class="m-sidebar"><div class="m-search-wrap"><label for="m-search">查找章节与知识点</label><input id="m-search" type="search" placeholder="搜索：4f、散射、物距…" autocomplete="off"><p class="m-search-status" role="status"></p></div><nav class="m-toc" aria-label="手册目录"></nav></aside><div class="m-reader" tabindex="0" aria-label="章节正文"><article class="m-article"><div class="m-chapter-meta"></div><h1 tabindex="-1"></h1><p class="m-lead"></p><div class="m-content"></div><nav class="m-chapter-nav" aria-label="章节翻页"><button type="button" data-step="-1"></button><button type="button" data-step="1"></button></nav><p class="m-reading-note">光迹实验手册 · 基础与进阶共用 · 阅读不会更改当前实验配置</p></article></div></div><div class="m-reading-track" aria-hidden="true"><span></span></div></div>`;
  const $=s=>host.querySelector(s);
  let current='start', opener=null;
  try{const saved=localStorage.getItem('optics-handbook-chapter');if(chapters.some(c=>c.id===saved))current=saved;}catch{}
  const hash=standalone?decodeURIComponent(location.hash.slice(1)):'';
  if(chapters.some(c=>c.id===hash))current=hash;
  function toggleToc(open){$('.m-layout').classList.toggle('m-show-toc',open);$('.m-mobile-toc').setAttribute('aria-expanded',String(open));$('.m-mobile-toc').textContent=open?'返回正文':'目录与搜索';if(open)$('#m-search').focus();}
  function highlight(text,query){if(!query)return escape(text);const lower=text.toLocaleLowerCase(),start=lower.indexOf(query.toLocaleLowerCase());return start<0?escape(text):escape(text.slice(0,start))+'<mark>'+escape(text.slice(start,start+query.length))+'</mark>'+escape(text.slice(start+query.length));}
  function renderToc(){
    const query=$('#m-search').value.trim(),terms=query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
    const matches=corpus.filter(c=>terms.every(term=>(c.title+' '+c.summary+' '+c.text).toLocaleLowerCase().includes(term)));
    let part='';$('.m-toc').innerHTML=matches.map(c=>{const heading=part!==c.part?`<h2>${escape(c.part)}</h2>`:'';part=c.part;let excerpt='';if(query){const index=c.text.toLocaleLowerCase().indexOf(terms[0]);const start=Math.max(0,index-22);excerpt=`<small>${start?'…':''}${highlight(c.text.slice(start,start+94),terms[0])}…</small>`;}return `${heading}<button type="button" data-chapter="${c.id}" ${c.id===current?'aria-current="page"':''}>${highlight(c.title,query)}${excerpt}</button>`;}).join('') || '<p class="m-toc-empty">没有找到相关章节。试试更短的词，例如「焦距」「曝光」「能量」。</p>';
    $('.m-search-status').textContent=query?`找到 ${matches.length} 章 · 搜索范围为整册正文`:`${chapters.length} 章 · 从基础操作到曲面与能量`;
  }
  function progress(){const reader=$('.m-reader'),range=reader.scrollHeight-reader.clientHeight;$('.m-reading-track span').style.width=(range>1?100*reader.scrollTop/range:100)+'%';}
  function show(id,{focus=true}={}){
    const i=chapters.findIndex(c=>c.id===id);if(i<0)return;current=id;const c=chapters[i];
    $('.m-chapter-meta').innerHTML=`<span>${escape(c.part)}</span><span>第 ${i+1} / ${chapters.length} 章</span><span>约 ${Math.max(2,Math.ceil(plain(c.html).length/320))} 分钟</span>`;
    $('.m-article h1').textContent=c.title;$('.m-lead').textContent=c.summary;$('.m-content').innerHTML=c.html;
    for(const step of [-1,1]){const button=$(`[data-step="${step}"]`),next=chapters[i+step];button.disabled=!next;button.innerHTML=next?`<small>${step<0?'上一章':'下一章'}</small>${escape(next.title)}`:'';}
    $('.m-open-page')?.setAttribute('href',`manual.html#${id}`);
    if(standalone){document.title=c.title+' · 光迹实验手册';try{history.replaceState(null,'','#'+id);}catch{}}
    try{localStorage.setItem('optics-handbook-chapter',id);}catch{}
    renderToc();toggleToc(false);$('.m-reader').scrollTop=0;
    if(focus)$('.m-article h1').focus({preventScroll:true});
    lensDemo();requestAnimationFrame(progress);
  }
  function lensDemo(){
    const demo=$('[data-lens-demo]');if(!demo)return;
    const draw=()=>{
      const u=Number($('#m-u').value),f=Number($('#m-f').value),v=u===f?Infinity:f*u/(u-f),m=-v/u;
      $('#m-u-value').value=`${u} mm`;$('#m-f-value').value=`${f} mm`;
      const minX=Math.min(-u,-f,Number.isFinite(v)?v:0)-35,maxX=Math.max(f,Number.isFinite(v)?v:2*f)+35;
      const scaleX=590/(maxX-minX),scaleY=Math.min(2.4,93/Math.max(25,Number.isFinite(m)?Math.abs(m*25):25));
      const X=x=>45+(x-minX)*scaleX,Y=y=>135-y*scaleY,point=(x,y)=>`${X(x).toFixed(2)},${Y(y).toFixed(2)}`;
      const line=(x1,y1,x2,y2,color,dash='')=>`<line x1="${X(x1)}" y1="${Y(y1)}" x2="${X(x2)}" y2="${Y(y2)}" stroke="${color}" stroke-width="1.5" ${dash?'stroke-dasharray="'+dash+'"':''}/>`;
      const arrow=(x,h,color)=>line(x,0,x,h,color)+`<path d="M ${X(x)-5} ${Y(h)+(h>0?8:-8)} L ${X(x)} ${Y(h)} L ${X(x)+5} ${Y(h)+(h>0?8:-8)}" fill="none" stroke="${color}" stroke-width="2"/>`;
      let svg=`<title>物距 ${u} 毫米，焦距 ${f} 毫米，${Number.isFinite(v)?(v>0?'右侧实像':'左侧虚像'):'出射光平行'}</title><defs><clipPath id="m-diagram-clip"><rect x="20" y="18" width="640" height="230"/></clipPath></defs><line x1="25" y1="135" x2="655" y2="135" stroke="#99ad9b" stroke-dasharray="4 5"/><g clip-path="url(#m-diagram-clip)">`;
      svg+=`<path d="M ${X(0)} 29 Q ${X(0)-17} 135 ${X(0)} 241 Q ${X(0)+17} 135 ${X(0)} 29Z" fill="#cce4d8" stroke="#639d86"/>`;
      svg+=line(-u,25,0,25,'#b08045')+line(0,25,maxX,25-maxX*25/f,'#b08045')+line(-u,25,maxX,-maxX*25/u,'#5b9074');
      if(v<0){svg+=line(v,m*25,0,25,'#b08045','5 5')+line(v,m*25,0,0,'#5b9074','5 5');}
      svg+=arrow(-u,25,'#ae682e');if(Number.isFinite(v))svg+=arrow(v,m*25,'#24695b');svg+='</g>';
      for(const [x,label] of [[-f,'F'],[f,'F′']])svg+=`<circle cx="${X(x)}" cy="135" r="3" fill="#657c4c"/><text x="${X(x)}" y="154" text-anchor="middle" fill="#52664d" font-size="13">${label}</text>`;
      svg+=`<text x="${X(0)}" y="258" text-anchor="middle" fill="#496956" font-size="13">薄透镜</text>`;
      demo.querySelector('svg').innerHTML=svg;
      $('.m-demo-result').innerHTML=!Number.isFinite(v)?'<strong>物体位于前焦点：出射光平行。</strong>没有有限像距，不能把无穷远当作屏的位置。':`<strong>${v>0?'倒立实像':'正立虚像'}</strong>　像距 v = ${v.toFixed(1)} mm，放大率 m = ${m.toFixed(2)}。${v>0?'将屏放在透镜右侧相应距离可接到理想实像。':'像位于物体一侧；右侧的屏不能直接接到这个虚像。'}`;
    };
    $('#m-u').addEventListener('input',draw);$('#m-f').addEventListener('input',draw);draw();
  }
  host.addEventListener('click',e=>{
    const chapter=e.target.closest('[data-chapter],[data-manual-go]');if(chapter){show(chapter.dataset.chapter || chapter.dataset.manualGo);return;}
    const step=e.target.closest('[data-step]');if(step){const next=chapters[chapters.findIndex(c=>c.id===current)+Number(step.dataset.step)];if(next)show(next.id);}
  });
  $('#m-search').addEventListener('input',renderToc);
  $('.m-mobile-toc').onclick=()=>toggleToc(!$('.m-layout').classList.contains('m-show-toc'));
  $('.m-reader').addEventListener('scroll',progress,{passive:true});window.addEventListener('resize',progress);
  function close(){if(standalone)return;host.close();}
  if(!standalone){$('.m-close').onclick=close;host.addEventListener('close',()=>{document.documentElement.style.overflow=previousOverflow;opener?.focus({preventScroll:true});});host.addEventListener('click',e=>{if(e.target===host){const r=host.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)close();}});}
  let previousOverflow='';
  globalThis.OpticsManual={open(id){if(!standalone&&!host.open){opener=document.activeElement;previousOverflow=document.documentElement.style.overflow;document.documentElement.style.overflow='hidden';host.showModal();}show(chapters.some(c=>c.id===id)?id:current);},close,get isOpen(){return standalone||host.open;}};
  $('.m-print').onclick=()=>window.print();
  window.addEventListener('beforeprint',()=>{
    document.querySelector('.manual-print')?.remove();const printable=document.createElement('div');printable.className='manual-print';printable.innerHTML='<header><h1>光迹 · 光学入门实验手册</h1><p>基础实验室与进阶工作站 · 操作、原理与练习</p><ol>'+chapters.map(c=>`<li>${escape(c.part)} · ${escape(c.title)}</li>`).join('')+'</ol></header>'+chapters.map(c=>`<section><p>${escape(c.part)}</p><h1>${escape(c.title)}</h1><p>${escape(c.summary)}</p>${c.html}</section>`).join('');for(const d of printable.querySelectorAll('details'))d.open=true;document.body.appendChild(printable);
  });
  window.addEventListener('afterprint',()=>document.querySelector('.manual-print')?.remove());
  window.addEventListener('hashchange',()=>{if(standalone){const id=location.hash.slice(1);if(chapters.some(c=>c.id===id))show(id);}});
  show(current,{focus:false});
})();
