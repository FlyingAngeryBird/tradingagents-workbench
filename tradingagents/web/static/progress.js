// The graph and its inspector share one snapshot. Inspecting a prior step never
// changes the execution cursor, which is determined only by the worker.
const phases = [
  {id:'analysts',title:'分析师团队',members:['market','social','news','fundamentals','memory']},
  {id:'research',title:'多空研究',members:['bull','bear','research_manager']},
  {id:'trading',title:'交易提案',members:['trader']},
  {id:'risk',title:'风险评估',members:['aggressive','conservative','neutral']},
  {id:'decision',title:'组合决策',members:['portfolio_manager']},
];
const people = {
  market:'技术分析师',social:'情绪分析师',news:'新闻分析师',fundamentals:'基本面分析师',memory:'决策记忆',
  bull:'多头研究员',bear:'空头研究员',research_manager:'研究经理',trader:'交易员',
  aggressive:'激进风控',conservative:'保守风控',neutral:'中性风控',portfolio_manager:'组合经理',
};
const states = {
  pending:'待执行',running:'执行中',completed:'已完成',failed:'失败',cancelled:'已停止',
  interrupted:'已中断',unknown:'未记录',observed:'已有记录',latest:'最近记录',upcoming:'未执行',
};
const jobStates = {running:'运行中',completed:'已完成',failed:'运行失败',cancelled:'已取消'};
const symbols = [
  '<path d="M23 33v-8m6 5V18m6 9V12m6 12v-9"/>',
  '<path d="m18 21 11-6 11 6-11 6zM18 21v7l5 3v4l6-3 11-6v-5m-3-9 6-4 8 5-6 4"/>',
  '<path d="m21 28 17-10 9 5-17 10zM21 24l17-10 9 5M21 20l17-10 9 5"/>',
  '<path d="m32 9 9 4v8c0 6-4 11-9 14-5-3-9-8-9-14v-8z"/><path d="m27 21 3 3 7-8"/>',
  '<path d="m23 31 9-5 9 5-9 5zM32 26V9m0 0 13-2-3 6 3 3-13 2"/>',
];
const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clock = value => {
  const d = new Date(value);
  return !value || isNaN(d.getTime()) ? '—' : d.toLocaleTimeString('zh-CN',{hour12:false});
};
function duration(start,end=Date.now()) {
  const seconds = Math.max(0,Math.floor((new Date(end)-new Date(start))/1000));
  if (!start || !Number.isFinite(seconds)) return '—';
  const h = Math.floor(seconds/3600), m = Math.floor(seconds/60)%60, s = seconds%60;
  return (h ? h+'时 ' : '') + (m || h ? m+'分 ' : '') + s+'秒';
}
function ticking(start,end) {
  return '<span data-duration="'+esc(start)+'"'+(end ? ' data-until="'+esc(end)+'"' : '')+'>'+esc(duration(start,end || Date.now()))+'</span>';
}
function chip(index) {
  return '<svg class="pg-chip" width="66" height="50" viewBox="0 0 64 52" aria-hidden="true" fill="none" stroke-linejoin="round">'+
    '<path class="pg-chip-base" d="m4 31 28-14 28 14v5L32 50 4 36z"/><path class="pg-chip-top" d="m4 29 28-14 28 14-28 14z"/>'+
    '<path d="M32 43v6" stroke="currentColor" opacity=".4"/><g stroke="currentColor" fill="var(--chip-fill)" stroke-width="2.2" stroke-linecap="round">'+symbols[index]+'</g></svg>';
}
const legacyEventTypes = [
  [/市场技术报告/,'market'],[/情绪分析报告/,'social'],[/新闻报告|新闻分析报告/,'news'],[/基本面报告/,'fundamentals'],
  [/研究主管已/,'research_manager'],[/交易员已/,'trader'],[/组合经理已/,'portfolio_manager'],
];
function identify(event) {
  let agent = event.agent_id;
  if (!people[agent]) agent = legacyEventTypes.find(([match])=>match.test(event.text))?.[1];
  if (!agent && /多空论证|风险评议/.test(event.text) && typeof event.detail==='string') {
    const speaker=event.detail.trim().match(/^(?:\*\*)?(Bull|Bear|Aggressive|Conservative|Neutral) (?:Analyst|Researcher)[:：]/i);
    if (speaker) agent=speaker[1].toLowerCase();
  }
  const phase = phases.find(p=>p.members.includes(agent))?.id ||
    (/多空论证/.test(event.text) ? 'research' : /风险评议/.test(event.text) ? 'risk' :
      /分析师|调用数据工具/.test(event.text) ? 'analysts' : '');
  return {...event,agent,phase};
}
function legacyAgents(job,events) {
  const selected = job.parameters?.analysts;
  const ids = new Set(events.map(e=>e.agent).filter(Boolean));
  for (const a of selected || []) ids.add(a === 'sentiment' ? 'social' : a);
  return [...ids].map(id=>{
    const event = events.filter(e=>e.agent===id).at(-1);
    return {id,label:people[id] || id,phase:phases.find(p=>p.members.includes(id))?.id,
      status:event ? 'observed' : 'unknown',finished_at:event?.time,active_calls:[]};
  });
}
function graph(job) {
  const events = (job.events || []).map(identify);
  const fresh = job.progress?.mode==='agents' && Array.isArray(job.progress.agents) && job.progress.agents.length>0;
  const agents = fresh ? job.progress.agents : legacyAgents(job,events);
  const lastPhase = events.filter(e=>e.phase).at(-1)?.phase || '';
  const active = agents.filter(a=>a.status==='running');
  let focus = active.at(-1)?.phase || lastPhase;
  if (!focus && fresh) focus = [...phases].reverse().find(p=>agents.some(a=>a.phase===p.id && a.started_at))?.id;
  const lastIndex=phases.findIndex(p=>p.id===lastPhase);
  const nodes = phases.map((p,index)=>{
    const group = agents.filter(a=>a.phase===p.id);
    const activity = events.filter(e=>e.phase===p.id);
    const done = group.filter(a=>a.status==='completed').length;
    let status;
    if (fresh) {
      status = ['failed','interrupted','cancelled','running'].find(s=>group.some(a=>a.status===s));
      if (!status) status = done && done===group.length ? 'completed' : (done ? 'observed' : 'pending');
      if (status==='pending' && job.status!=='running') status='upcoming';
    } else if (!activity.length) status='unknown';
    else if (index<lastIndex || (p.id==='decision' && activity.some(e=>e.agent==='portfolio_manager' && e.detail))) status='completed';
    else status=lastPhase===p.id ? 'latest' : 'observed';
    return {...p,group,activity,done,status};
  });
  return {nodes,events,fresh,active,focus:focus || 'analysts',last:events.at(-1)};
}
function stateText(agent) {
  if (agent.restored && agent.status==='completed') return '已从断点恢复';
  if (agent.rounds_total && agent.round>0) {
    const round=agent.status==='pending' ? Math.min(agent.rounds_total,agent.round+1) : agent.round;
    return (states[agent.status] || agent.status)+' · 第 '+round+'/'+agent.rounds_total+' 轮';
  }
  return states[agent.status] || agent.status || '未记录';
}
function nodeLabel(node,fresh) {
  if (!fresh) return states[node.status];
  const moving = node.group.filter(a=>a.status==='running').length;
  if (moving>1) return moving+' 个并行';
  if (['failed','cancelled','interrupted'].includes(node.status)) return states[node.status];
  if (node.done && node.group.length>1 && node.status!=='running') return node.done+'/'+node.group.length+' 已完成';
  return states[node.status] || '待执行';
}
function callSummary(agent) {
  const calls = (agent.active_calls || []).map(c=>c.kind==='tool' ? '工具 · '+c.name : '模型 · '+c.name);
  return calls.join(' / ') || agent.activity || '';
}
function eventKey(e) { return [e.time,e.agent,e.text].join('|'); }
function findingPreview(text) {
  const lines=text.split(/\r?\n/).map(line=>line.trim()).filter(Boolean);
  function clean(line) {
    return line.replace(/^#{1,6}\s+|^>\s*|^[-*]\s+/g,'')
      .replace(/\[([^\]]+)\]\([^)]*\)/g,'$1').replace(/\*\*|__|`/g,'')
      .replace(/^(Bull|Bear|Aggressive|Conservative|Neutral) (?:Analyst|Researcher)[:：]\s*/i,'').trim();
  }
  const summary=lines.findIndex(l=>/^(?:[#*\s]*)(Executive Summary|执行摘要|决策摘要)(?![a-z])/i.test(l));
  if (summary>=0) {
    const content=clean(lines[summary]).replace(/^(?:Executive Summary|执行摘要|决策摘要)[:：]?\s*/i,'');
    if (content) return content;
    if (lines[summary+1]) return clean(lines[summary+1]);
  }
  const prose=lines.find(l=>!/^#{1,6}\s|^\||^[-=_]{3,}|^(?:\*\*)?(?:Rating|Action|Recommendation)\**[:：]/i.test(l) && clean(l).length>8);
  return clean(prose || lines[0] || '');
}
function findings(events,openKeys) {
  const outputs = events.filter(e=>typeof e.detail==='string' && e.detail.trim()).reverse();
  if (!outputs.length) return '';
  return '<div class="pg-findings"><h4>阶段产出 <span>'+outputs.length+'</span></h4>'+
    outputs.map(e=>{
      const key=eventKey(e);
      const preview=findingPreview(e.detail);
      return '<details class="pg-finding" data-key="'+esc(key)+'"'+(openKeys.has(key)?' open':'')+'><summary><span><b>'+esc(e.text)+'</b><small>'+esc(preview.slice(0,160))+'</small></span><time>'+clock(e.time)+'</time><i aria-hidden="true">⌄</i></summary><pre>'+esc(e.detail)+'</pre></details>';
    }).join('')+'</div>';
}
function inspector(model,node,selected,job,openKeys) {
  const chosen=node.group.find(a=>a.id===selected);
  const events = chosen ? node.activity.filter(e=>e.agent===chosen.id) : node.activity;
  const outcomes = findings(events,openKeys);
  const latest = events.at(-1);
  let blurb;
  if (!model.fresh) {
    blurb = latest ? '最近记录于 '+clock(latest.time)+' · '+latest.text : '此阶段尚无可核实的运行记录。';
  } else if (!node.group.length) blurb='此阶段暂无节点记录。';
  else if (chosen) {
    blurb=[chosen.started_at ? '开始 '+clock(chosen.started_at) : '',chosen.finished_at ? '结束 '+clock(chosen.finished_at) : '',
      chosen.round>1 ? '第 '+chosen.round+' 次执行' : '',
      chosen.llm_calls!=null ? '模型调用 '+chosen.llm_calls+' 次' : '', chosen.tool_calls!=null ? '工具调用 '+chosen.tool_calls+' 次' : ''].filter(Boolean).join(' · ');
  } else {
    blurb=latest ? clock(latest.time)+' · '+latest.text : (node.status==='pending' ? '等待前置阶段完成。' : '等待节点回传活动。');
  }
  const agents = node.group.map(a=>{
    const call=callSummary(a);
    const time = model.fresh && a.started_at ? ticking(a.started_at,a.finished_at || (job.status==='running' && a.status==='running' ? null : (job.finished_at || job.progress?.updated_at))) : '';
    return '<button type="button" class="pg-agent" data-agent="'+esc(a.id)+'" data-state="'+esc(a.status)+'" aria-pressed="'+(chosen?.id===a.id)+'">'+
      '<span class="pg-agent-title"><i></i><b>'+esc(a.label || people[a.id])+'</b></span>'+
      '<span class="pg-agent-state">'+esc(stateText(a))+(time?' · '+time:'')+'</span>'+
      (call ? '<small title="'+esc(call)+'">'+esc(call)+'</small>' : '')+'</button>';
  }).join('');
  const calls = chosen?.active_calls || [];
  return '<div class="pg-inspect"><div class="pg-inspect-head"><h3>'+esc(node.title)+'</h3>'+
    '<span>'+esc(chosen?.label || nodeLabel(node,model.fresh))+'</span></div>'+
    (agents ? '<div class="pg-agents" aria-label="阶段成员">'+agents+'</div>' : '')+
    '<p class="pg-activity">'+esc(blurb || stateText(chosen || {}))+'</p>'+
    (calls.length ? '<ul class="pg-calls">'+calls.map(c=>'<li>'+esc(c.kind==='tool'?'调用工具':'模型推理')+' · <b>'+esc(c.name)+'</b>'+(c.started_at?' · '+ticking(c.started_at):'')+'</li>').join('')+'</ul>' : '')+
    outcomes+'</div>';
}
function backtestGraph(job) {
  const last = job.events?.at(-1);
  const grid = job.progress?.grid;
  const header = grid ? '样本 '+grid.index+' / '+grid.total : '样本进度';
  const label = grid ? [grid.ticker,grid.date].filter(Boolean).join(' · ') : '';
  const ratio=job.status==='completed' ? 1 : grid?.total>0 ? Math.max(0,Math.min(1,(grid.index-1)/grid.total)) : 0;
  return '<div class="pg-grid"><h3>'+esc(header)+'</h3><div class="pg-track"><i style="width:'+Math.round(ratio*100)+'%"></i></div><b>'+esc(label)+'</b><p>'+esc(last?.text || job.stage)+'</p></div>';
}

// The return value disposes timers/fetches. A caller polling for other parts of
// the page can feed the same results to update() and disable the internal poller.
export function mountProgress(container,initial,{compact=false,autoPoll=compact}={}) {
  const panel=document.createElement('section');
  panel.className='pg-panel'+(compact?' pg-compact':'');
  container.replaceChildren(panel);
  const abort=new AbortController();
  let job=initial, pinned='', selected='', timer, trouble='', signature='';
  let openKeys=new Set();
  function render(force=false) {
    const progress=job.progress;
    const events=job.events || [];
    const stamp=JSON.stringify([job.status,job.stage,progress,events.length,events.at(-1),job.error,job.finished_at,trouble]);
    if (!force && signature===stamp) return;
    signature=stamp;
    const focus=document.activeElement;
    const focusKey=panel.contains(focus) && (focus.dataset.phase || focus.dataset.agent || focus.closest('.pg-finding')?.dataset.key);
    // Keep expanded reports and reading position through independent polling.
    const scrolls=new Map([...panel.querySelectorAll('.pg-finding[open]')].map(el=>[el.dataset.key,el.querySelector('pre').scrollTop]));
    for (const el of panel.querySelectorAll('.pg-finding')) {
      if (el.open) openKeys.add(el.dataset.key); else openKeys.delete(el.dataset.key);
    }
    const model=graph(job);
    const current=model.nodes.find(n=>n.id===(pinned || model.focus)) || model.nodes[0];
    const running=job.status==='running';
    const grid=job.kind==='backtest';
    const recent=progress?.updated_at || model.last?.time;
    let info='';
    if (model.fresh && model.active.length) info='当前执行 · '+model.active.map(a=>a.label || people[a.id]).join(' / ');
    else if (recent) info=(model.fresh ? '最近更新 ' : '最近记录 ')+clock(recent);
    else info=job.stage || '正在读取节点状态';
    const link=compact ? '<a class="pg-link" href="#history/'+encodeURIComponent(job.id)+'">查看任务详情 ↗</a>' : '';
    const nodes=model.nodes.map((n,i)=>{
      const active=n.status==='running';
      const state=n.status;
      return '<button type="button" class="pg-node" data-phase="'+n.id+'" data-state="'+state+'" aria-pressed="'+(n.id===current.id)+'"'+(active?' aria-current="step"':'')+'>'+
        '<span class="pg-visual">'+chip(i)+'</span><b>'+n.title+'</b><span class="pg-node-state"><i></i>'+nodeLabel(n,model.fresh)+'</span></button>';
    }).join('');
    const follow=pinned ? '<button type="button" class="pg-follow" data-follow>'+ (running?'跟随最新进度':'返回最后阶段')+'</button>' : '';
    panel.innerHTML='<div class="pg-graph"><header class="pg-head"><div><div class="pg-title"><h2>'+(grid?'回测进度':'多智能体决策流程')+'</h2><span class="pg-jobstate" data-state="'+esc(job.status)+'"><i></i>'+esc(jobStates[job.status] || job.status)+'</span></div>'+
      '<p><b>'+esc(job.ticker)+'</b><span>'+esc(job.date)+'</span></p></div>'+link+'</header>'+
      (grid ? backtestGraph(job) : '<div class="pg-stages" aria-label="研究步骤">'+nodes+'</div>')+
      '<div class="pg-under"><span class="pg-now" aria-live="polite">'+esc(info)+'</span>'+
      (running && recent && !model.fresh ? '<span>距上次记录 '+ticking(recent)+'</span>' : '')+
      (job.started_at ? '<span>任务用时 '+ticking(job.started_at,job.finished_at || (running ? null : recent || job.started_at))+'</span>' : '')+
      follow+'</div></div>'+
      (!grid ? inspector(model,current,selected,job,openKeys) : '')+
      (job.error && compact ? '<div class="pg-error">'+esc(job.error)+'</div>' : '')+
      (trouble ? '<div class="pg-error" role="status">'+esc(trouble)+'</div>' : '');
    if (focusKey) {
      const next=[...panel.querySelectorAll('[data-phase],[data-agent],.pg-finding')].find(e=>[e.dataset.phase,e.dataset.agent,e.dataset.key].includes(focusKey));
      (next?.matches('.pg-finding')?next.querySelector('summary'):next)?.focus({preventScroll:true});
    }
    for (const el of panel.querySelectorAll('.pg-finding[open]')) el.querySelector('pre').scrollTop=scrolls.get(el.dataset.key) || 0;
  }
  panel.onclick=e=>{
    const node=e.target.closest('button[data-phase]');
    const agent=e.target.closest('button[data-agent]');
    const follow=e.target.closest('[data-follow]');
    if (node) { pinned=node.dataset.phase; selected=''; }
    else if (agent) {
      pinned=graph(job).nodes.find(n=>n.group.some(a=>a.id===agent.dataset.agent))?.id;
      selected=selected===agent.dataset.agent ? '' : agent.dataset.agent;
    } else if (follow) { pinned=''; selected=''; }
    else return;
    render(true);
  };
  function update(data) { job=data; render(); }
  async function read() {
    if (abort.signal.aborted) return;
    try {
      const res=await fetch('/api/jobs/'+encodeURIComponent(job.id)+'?view=progress',{signal:abort.signal,cache:'no-store'});
      if (!res.ok) throw new Error('读取任务详情失败');
      const next=await res.json();
      if (abort.signal.aborted) return;
      trouble='';
      update(next);
    } catch {
      if (abort.signal.aborted) return;
      trouble='进度暂时无法刷新，正在重连。';
      render();
    }
    if (job.status==='running' || trouble) timer=setTimeout(read,2000);
  }
  const tick=setInterval(()=>{
    if (!panel.isConnected || document.hidden) return;
    for (const span of panel.querySelectorAll('[data-duration]:not([data-until])')) span.textContent=duration(span.dataset.duration);
  },1000);
  render();
  if (autoPoll && (!Array.isArray(job.events) || job.status==='running')) read();
  const dispose=()=>{ abort.abort();clearTimeout(timer);clearInterval(tick); };
  dispose.update=update;
  return dispose;
}
