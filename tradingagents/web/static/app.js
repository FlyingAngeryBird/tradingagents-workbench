const paths = {
  overview:'<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  analysis:'<path d="M3 20h18M5 15l4-6 4 3 6-8"/><path d="M15 4h4v4"/>',
  backtest:'<path d="M3 10a9 9 0 1 1 2 8M3 5v5h5M12 7v5l4 2"/>',
  history:'<rect x="3" y="5" width="18" height="4" rx="1"/><path d="M5 9v11h14V9M10 13h4"/>',
  memory:'<path d="M4 4h6a3 3 0 0 1 2 1 3 3 0 0 1 2-1h6v15h-6a3 3 0 0 0-2 1 3 3 0 0 0-2-1H4zM12 5v15"/>',
  settings:'<path d="M3 6h8m4 0h6M3 12h2m4 0h12M3 18h10m4 0h4"/><circle cx="13" cy="6" r="2"/><circle cx="7" cy="12" r="2"/><circle cx="15" cy="18" r="2"/>',
  terminal:'<path d="m5 7 5 5-5 5m8 0h6"/>',panel:'<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>',menu:'<path d="M3 6h18M3 12h18M3 18h18"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',arrow:'<path d="M4 12h15m-5-5 5 5-5 5"/>',chevron:'<path d="m9 5 7 7-7 7"/>',
  file:'<path d="M5 3h9l5 5v13H5zM14 3v6h5M8 13h8M8 17h6"/>',
  pulse:'<path d="M2 12h5l3-8 4 16 3-8h5"/>',layers:'<path d="m12 3 10 5-10 5L2 8zM2 12l10 5 10-5M2 16l10 5 10-5"/>',
};
function icon(name) {
  return '<svg class="icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round">'+paths[name]+'</svg>';
}
const escape = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const names = {overview:'工作台总览',analysis:'标的分析',backtest:'历史回测',history:'任务与报告',memory:'决策记忆',settings:'系统设置'};
const groups = [['研究空间',['overview','analysis','backtest']],['研究档案',['history','memory']],['偏好设置',['settings']]];
const main = document.querySelector('#content');
document.querySelectorAll('[data-icon]').forEach(e=>e.innerHTML=icon(e.dataset.icon));
document.querySelector('#sidebar-nav').innerHTML = groups.map(([label,items])=>'<div class="nav-group"><div class="nav-label">'+label+'</div>'+items.map(k=>'<a href="#'+k+'" data-view="'+k+'">'+icon(k)+names[k]+'</a>').join('')+'</div>').join('');
const menu = document.querySelector('#menu');
function toggleMenu(open) {
  document.querySelector('#rail').classList.toggle('open',open);
  document.querySelector('#shade').hidden=!open;
  menu.setAttribute('aria-expanded',String(open));
}
menu.onclick=()=>toggleMenu(menu.getAttribute('aria-expanded')!=='true');
document.querySelector('#shade').onclick=()=>toggleMenu(false);
document.addEventListener('keydown',e=>{if(e.key==='Escape') toggleMenu(false)});
document.querySelector('#rail').addEventListener('click',e=>{if(e.target.closest('a'))toggleMenu(false)});
document.querySelector('.skip').onclick=e=>{e.preventDefault();main.focus()};
const now=new Date();
document.querySelector('#today').textContent=now.toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'})+'  '+now.toLocaleDateString('zh-CN',{weekday:'short',timeZone:'Asia/Shanghai'});
function connection(online) {
  const badge=document.querySelector('#connection');
  badge.className=online?'connected':'offline';
  badge.innerHTML='<i></i>'+(online?'本地服务在线':'服务未连接');
}
async function api(url){
  const res=await fetch(url);
  if(!res.ok) throw new Error((await res.json()).error || '无法读取数据');
  return res.json();
}
async function heartbeat(){try{await api('/api/health');connection(true)}catch{connection(false)}}
heartbeat();
setInterval(()=>{if(!document.hidden)heartbeat()},30000);

const stages = ['分析师团队','多空研究','交易提案','风险评估','组合决策'];
const glyphs = [
 '<path d="M28 31v-8m6 11V20m6 11V14m6 13V9" stroke-width="4"/>',
 '<path d="m24 21 12-7 12 7-12 7zM24 21v8l7 4v5l6-4 11-6v-7m-5-9 8-4 9 5-7 4"/>',
 '<path d="m27 30 21-12 9 6-21 12zM27 26l21-12 9 6M27 22l21-12 9 6"/><path d="m38 21 9-5"/>',
 '<path d="m40 9 11 5-1 10c-1 7-6 11-10 14-5-3-10-8-11-14l-1-10z"/><path d="m34 22 4 4 8-9"/>',
 '<path d="m29 31 10-6 11 6-10 6zM39 25V9m1 1 15-1-4 6 4 3-15 1"/>',
];
function chip(index){
  const line='#a8bfb1';
  return '<svg class="chip" aria-hidden="true" viewBox="0 0 80 62" fill="none"><g stroke-linejoin="round"><path d="m7 38 33-17 33 17v6L40 61 7 44Z" fill="#1b372a" stroke="#517555"/><path d="m7 34 33-17 33 17v6L40 57 7 40Z" fill="#31533b" stroke="#8cac80"/><path d="M7 34 40 17l33 17-33 17Z" fill="#375d42" stroke="'+line+'"/><path d="M40 51v6" stroke="#9bbb8d"/><g stroke="'+line+'" stroke-width="1.65" stroke-linecap="round" fill="#355d3f">'+glyphs[index]+'</g></g></svg>';
}
function idleFlow() {
  const nodes = stages.map((label,i)=>'<div class="stage">'+chip(i)+
    '<span class="stage-title"><small>0'+(i+1)+'</small>'+label+'</span></div>').join('');
  return '<section class="flow"><div class="flow-head"><h2>多智能体决策流程</h2>'+
    '<span class="flow-key">等待任务</span></div><div class="stage-row">'+nodes+
    '</div><p class="flow-note">启动分析后，这里将实时展示各阶段的执行状态和已提交的结论。</p></section>';
}
const ratingNames={buy:'买入',overweight:'增持',hold:'持有',underweight:'减持',sell:'卖出',review:'待复核'};
function reportRows(reports){
  if(!reports.length)return '<p class="dash-empty">完成一次标的分析后，可在这里查看报告。</p>';
  return '<div class="report-cols report-th"><span>研究标的</span><span>分析日期</span><span>最终评级</span><span></span></div>'+reports.map(r=>{
    const rating=(r.rating||'review').toLowerCase();
    const tone=['buy','overweight'].includes(rating)?'bull':['sell','underweight'].includes(rating)?'bear':'';
    return '<a class="report-cols report-item" href="#report/'+encodeURIComponent(r.id)+'"><span class="ticker"><i class="ticker-avatar">'+escape(r.ticker[0])+'</i>'+escape(r.ticker)+'</span><time class="report-date">'+escape(r.date)+'</time><span class="rating '+tone+'">'+escape(ratingNames[rating] || r.rating)+'</span>'+icon('chevron')+'</a>';
  }).join('');
}
async function mountOverview(root) {
  const { mountProgress } = await import('./progress.js');
  let disposeProgress, shownId, countsKey, reportsKey, configKey, loading = false;
  root.innerHTML = '<div class="dash-head"><div><h1>研究工作台</h1><p>查看最新研究、运行状态与智能体配置。</p></div>'+
    '<a class="dash-action" href="#analysis">'+icon('plus')+'新建分析</a></div>'+
    '<div class="dash-metrics"></div><div class="overview-progress" aria-label="任务流程"></div>'+
    '<div class="dash-lower"><section class="dash-panel"><div class="panel-head"><h2>'+icon('file')+
    '最近研究报告</h2><a class="panel-link" href="#reports">查看全部'+icon('arrow')+'</a></div>'+
    '<div data-reports></div></section><section class="dash-panel"><div class="panel-head"><h2>'+
    icon('settings')+'运行配置</h2><a class="panel-link" href="#settings">管理'+icon('arrow')+
    '</a></div><div class="config-lines"></div></section></div>';

  function render(data) {
    const active = data.jobs.find(job=>job.status==='running');
    const featured = active || data.jobs[0];
    const id = featured?.id || null;
    // Keep the same progress view while a job advances. Its detail selection and
    // focused controls belong to the reader, independently of dashboard refreshes.
    if (id !== shownId) {
      disposeProgress?.();
      shownId = id;
      const slot = root.querySelector('.overview-progress');
      if (featured) {
        slot.replaceChildren();
        disposeProgress = mountProgress(slot, featured, {compact:true});
      } else {
        slot.innerHTML = idleFlow();
        disposeProgress = null;
      }
    }
    const metrics = [
      ['研究报告',data.report_count,'file','reports','#eaf3e7','#467549'],
      ['运行中任务',data.jobs.filter(j=>j.status==='running').length,'pulse',
        active?'history/'+encodeURIComponent(active.id):'history','#e6f2ef','#317d69'],
      ['回测任务',data.jobs.filter(j=>j.kind==='backtest').length,'backtest','history','#eaf0fa','#5975a0'],
      ['决策记忆',data.memory_count,'layers','memory','#f4efdf','#8d793e'],
    ];
    const metricSignature = JSON.stringify(metrics);
    if (countsKey !== metricSignature) {
      countsKey = metricSignature;
      root.querySelector('.dash-metrics').innerHTML = metrics.map(([label,n,ic,route,bg,fg]) =>
        '<a class="dash-metric" href="#'+route+'"><div><span class="metric-label">'+label+
        '</span><strong>'+n+'</strong></div><span class="metric-icon" style="--tone:'+bg+';--fg:'+fg+'">'+
        icon(ic)+'</span></a>').join('');
    }
    const reportSignature = JSON.stringify(data.reports);
    if (reportsKey !== reportSignature) {
      reportsKey = reportSignature;
      root.querySelector('[data-reports]').innerHTML = reportRows(data.reports);
    }
    const cfg = data.config;
    const configSignature = JSON.stringify(cfg);
    if (configKey === configSignature) return;
    configKey = configSignature;
    function tierName(tier) {
      const provider = cfg[tier+'_think_provider'];
      const model = cfg[tier+'_think_llm'];
      return provider && provider!==cfg.llm_provider ? provider+' / '+model : model;
    }
    const models = [['默认模型服务',cfg.llm_provider],['快速推理',tierName('quick')],['深度推理',tierName('deep')],
      ['断点续跑',cfg.checkpoint_enabled?'已启用':'已关闭']];
    root.querySelector('.config-lines').innerHTML = models.map(([label,value])=>
      '<div class="config-line"><span>'+label+'</span><b>'+escape(value||'默认')+'</b></div>').join('');
  }
  const data = await api('/api/overview');
  if (!root.isConnected) return;
  render(data);
  async function refresh() {
    if (!root.isConnected || document.hidden || loading) return;
    loading = true;
    try {
      const current = await api('/api/overview');
      if (root.isConnected) { render(current); connection(true); }
    } catch { connection(false); }
    finally { loading=false; }
  }
  const timer = setInterval(refresh,4000);
  document.addEventListener('visibilitychange',refresh);
  return () => {
    clearInterval(timer);
    document.removeEventListener('visibilitychange',refresh);
    disposeProgress?.();
  };
}
let cleanup;
async function route(){
  if(typeof cleanup==='function') cleanup();
  cleanup=null;
  const [key='overview',rawId]=location.hash.slice(1).split('/');
  const view=Object.hasOwn(names,key)?key:['report','reports'].includes(key)?'history':'overview';
  const root=document.createElement('div');
  main.replaceChildren(root);
  document.querySelector('#crumb-name').textContent=names[view];
  document.title=names[view]+' · TradingAgents';
  document.querySelectorAll('#rail [data-view]').forEach(a=>{
    a.classList.toggle('active',a.dataset.view===view);
    if(a.dataset.view===view)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');
  });
  window.scrollTo(0,0);
  try{
    const id=decodeURIComponent(rawId||'');
    if(view==='overview'){
      const dispose = await mountOverview(root);
      if(root.isConnected)cleanup=dispose;else dispose?.();
    }else if(view==='settings'){
      const {renderSettings}=await import('./settings.js');
      root.innerHTML='<div class="settings-head"><h1>系统设置</h1><p>管理模型服务、数据来源与研究参数。</p></div><div class="settings-mount"></div>';
      const dispose=await renderSettings(root.lastElementChild);
      if(root.isConnected)cleanup=dispose;else if(typeof dispose==='function')dispose();
    }else{
      const {mountWorkflow}=await import('./workflows.js');
      const dispose=await mountWorkflow(view,root,key==='report'?{reportId:id}:key==='reports'?{tab:'reports'}:{jobId:id});
      if(root.isConnected)cleanup=dispose;else if(typeof dispose==='function')dispose();
    }
  }catch(e){
    root.replaceChildren();
    const box=document.createElement('div'), retry=document.createElement('button');
    box.className='dash-panel dash-error';box.textContent='载入失败 · '+e.message;retry.textContent='重试';retry.onclick=route;
    box.append(retry);root.append(box);heartbeat();
  }
}
window.addEventListener('hashchange',route);
route();
