import {mountProgress} from './progress.js';
import {renderReport} from "./report.js";
// Research, evaluation and decision-log views of the local workbench.
let nextRequest;
const ANALYSTS = [
  ['market', '技术分析', '价格、成交量与技术指标'],
  ['news', '新闻分析', '公司新闻与宏观事件'],
  ['social', '情绪分析', '市场讨论与情绪信号'],
  ['fundamentals', '基本面分析', '财务报表与公司估值'],
];
const STATUS = {running: '运行中', completed: '已完成', failed: '运行失败', cancelled: '已取消'};
const RATINGS = {buy: '买入', overweight: '增持', hold: '持有', underweight: '减持', sell: '卖出', review: '待复核'};
const paths = {
  play: '<path d="m8 5 11 7-11 7z"/>',
  arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
  back: '<path d="M19 12H5m5 5-5-5 5-5"/>',
  file: '<path d="M6 3h8l4 4v14H6zM14 3v5h4M9 12h6m-6 4h6"/>',
  stack: '<path d="m3 7 9-4 9 4-9 4zM3 12l9 4 9-4M3 17l9 4 9-4"/>',
  search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/>',
  sliders: '<path d="M4 7h7m4 0h5M4 17h2m4 0h10"/><circle cx="13" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>',
  chart: '<path d="M4 4v16h16M8 15l4-6 3 3 5-7"/>',
  clock: '<circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2"/>',
  team: '<circle cx="9" cy="8" r="3"/><path d="M3 19v-2a6 6 0 0 1 12 0v2m2-13a3 3 0 0 1 0 6m1 2a5 5 0 0 1 3 5"/>',
  archive: '<path d="M3 4h18v5H3zM5 9v11h14V9m-10 4h6"/>',
  chevron: '<path d="m9 18 6-6-6-6"/>',
  download: '<path d="M12 3v11m-5-5 5 5 5-5M4 16v4h16v-4"/>',
};
const icon = name => '<svg class="wf-icon" aria-hidden="true" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round">' + paths[name] + '</svg>';
const escape = text => String(text ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const dateAt = (days = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return [d.getFullYear(), String(d.getMonth()+1).padStart(2,'0'), String(d.getDate()).padStart(2,'0')].join('-');
};
const timestamp = value => {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toLocaleString('zh-CN', {hour12: false});
};
const rating = value => RATINGS[String(value).toLowerCase()] || value || '—';
const encoded = id => encodeURIComponent(id);
const tag = status => '<span class="wf-status wf-' + escape(status) + '">' + escape(STATUS[status] || status) + '</span>';
const title = (heading, sub, action = '') => '<header class="wf-heading"><div><h1>' + escape(heading) + '</h1><p>' + escape(sub) + '</p></div>' + action + '</header>';
const panelHeading = (name, heading) => '<h2 class="wf-panel-title">' + icon(name) + escape(heading) + '</h2>';
const empty = (heading, text, link = '') => '<div class="wf-empty"><span class="wf-empty-icon">' + icon('archive') + '</span><h3>' + escape(heading) + '</h3><p>' + escape(text) + '</p>' + link + '</div>';
const alertBox = message => '<div class="wf-error" role="alert">' + escape(message) + '</div>';
const formLink = '<a class="wf-button wf-primary" href="#analysis">新建分析 ' + icon('arrow') + '</a>';
const field = (label, content, note = '') => '<label class="wf-field"><span>' + escape(label) + '</span>' + content + (note ? '<small>' + escape(note) + '</small>' : '') + '</label>';

async function request(url, options = {}) {
  const response = await fetch(url, {cache: 'no-store', ...options});
  if (!response.ok) {
    const body = await response.text();
    let message = body;
    try { const data = JSON.parse(body); message = data.error || data.detail || body; } catch {}
    throw new Error(message || '请求失败 (' + response.status + ')');
  }
  return response;
}
async function get(url, signal) { return (await request(url, {signal})).json(); }
async function post(url, data) {
  return (await request(url, {method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(data)})).json();
}
function saveText(filename, text, type) {
  const url = URL.createObjectURL(new Blob([text], {type}));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function mountWorkflow(view, root, options = {}) {
  const host = document.createElement('div');
  host.className = 'wf';
  root.replaceChildren(host);
  const life = new AbortController();
  const ctx = {host, signal: life.signal};
  let run;
  if (options.reportId) run = reportPage(ctx, options.reportId);
  else if (options.jobId) run = jobPage(ctx, options.jobId);
  else if (view === 'history') run = historyPage(ctx,options.tab);
  else if (view === 'memory') run = memoryPage(ctx);
  else run = formPage(ctx, view === 'backtest', options);
  Promise.resolve(run).catch(err => {
    if (!life.signal.aborted) {
      host.innerHTML = title('页面加载失败', '请检查本地服务连接。') + alertBox(err.message) + '<button class="wf-button" type="button">重新加载</button>';
      host.querySelector('button').onclick = () => location.reload();
    }
  });
  return () => life.abort();
}

function positionRow(position = {}) {
  return '<div class="wf-position">' +
    field('标的', '<input data-pos="ticker" required maxlength="64" placeholder="AAPL" value="' + escape(position.ticker) + '">') +
    field('持仓数量', '<input data-pos="quantity" type="number" required step="any" placeholder="100" value="' + escape(position.quantity) + '">') +
    field('平均成本', '<input data-pos="average_price" type="number" step="any" placeholder="选填" value="' + escape(position.average_price) + '">') +
    '<button class="wf-remove" type="button" data-remove aria-label="移除此笔持仓">×</button></div>';
}

async function formPage({host,signal}, backtest, options) {
  const kind = backtest ? 'backtest' : 'analysis';
  const name = backtest ? '历史回测' : '新建分析';
  const currentDate = dateAt();
  host.innerHTML = title(name, backtest ? '在历史日期上重复运行研究团队，按评级评估相对基准收益。' : '选择研究标的和分析师，生成含多空论证与风险评估的决策报告。') +
    '<form class="wf-layout"><div class="wf-main-col"><section class="wf-panel">' + panelHeading(backtest ? 'chart' : 'sliders',backtest ? '回测范围' : '分析参数') +
    '<div class="wf-fields">' +
    field(backtest ? '标的列表' : '标的代码', '<input name="symbols" required autocomplete="off" spellcheck="false" maxlength="' + (backtest ? 2500 : 64) + '" placeholder="' + (backtest ? 'NVDA, AAPL' : '如 NVDA、0700.HK') + '" value="' + escape(options.ticker) + '">', backtest ? '多个标的用逗号或空格分隔。' : '') +
    field('资产类别', '<select name="asset"><option value="auto">自动识别</option><option value="stock">股票及其他证券</option><option value="crypto">加密资产</option></select>') +
    (backtest ? field('开始日期', '<input name="start" type="date" required max="' + currentDate + '" value="' + dateAt(-28) + '">') +
      field('结束日期', '<input name="end" type="date" required max="' + currentDate + '" value="' + currentDate + '">') +
      field('采样间隔（自然日）','<input name="every" type="number" min="1" step="1" required value="7">') +
      field('续跑编号（选填）','<input name="run_id" placeholder="新回测留空" maxlength="32">') :
      field('分析日期','<input name="date" type="date" required max="' + currentDate + '" value="' + currentDate + '">')) +
    '</div></section><section class="wf-panel">' + panelHeading('team','分析师团队') +
    '<div class="wf-check-grid">' + ANALYSTS.map(([key,label,desc]) => '<label class="wf-check" data-team="' + key + '"><input type="checkbox" name="analysts" value="' + key + '" checked><span><b>' + label + '</b><small>' + desc + '</small></span></label>').join('') + '</div></section>' +
    '<section class="wf-panel"><label class="wf-toggle"><span><b>附上投资组合</b><small>让团队参考本次研究的现金及持仓。</small></span><input name="use_book" type="checkbox"></label>' +
    '<fieldset class="wf-book" hidden disabled><div class="wf-fields">' +
    field('可用现金（选填）', '<input name="cash" type="number" step="any" placeholder="如 10000">') +
    field('币种（选填）', '<input name="currency" maxlength="32" placeholder="如 USD">') + '</div><div class="wf-positions"></div><div class="wf-actions"><button type="button" class="wf-button" data-add>＋ 添加持仓</button><label class="wf-button wf-file">导入组合 JSON<input name="import_file" type="file" accept=".json,application/json"></label></div><small>持仓数量为负数表示做空。保留空持仓列表表示当前空仓。</small></fieldset></section>' +
    '</div><aside class="wf-side"><section class="wf-panel wf-preview">' + panelHeading('stack','运行预览') +
    '<div class="wf-preview-ticker" data-preview-symbol></div><p data-preview-date></p><dl class="wf-preview-grid"></dl><a href="#settings" class="wf-text-link">编辑运行配置 ' + icon('arrow') + '</a>' +
    '<div class="wf-form-message" role="status" aria-live="polite"></div><button type="submit" class="wf-button wf-primary wf-start">' + icon('play') + (backtest ? '开始回测' : '开始分析') + '</button><small class="wf-footnote">运行会调用当前配置的模型与数据源。</small></section>' +
    (!backtest ? '<details class="wf-maintenance"><summary>断点管理</summary><p>清空当前缓存目录中所有标的的分析断点。</p><button class="wf-button" type="button" data-clear>清空全部断点</button><small data-clear-result role="status"></small></details>' : '') +
    '</aside></form>';
  const form = host.querySelector('form');
  const f = form.elements;
  const errBox = form.querySelector('.wf-form-message');
  const positions = form.querySelector('.wf-positions');
  const message = (str='') => { errBox.innerHTML = str ? alertBox(str) : ''; };
  const symbols = () => [...new Set(f.symbols.value.trim().toUpperCase().split(/[\s,，、]+/).filter(Boolean))];
  const choices = () => [...form.querySelectorAll('[name="analysts"]:checked:not(:disabled)')].map(el => el.value);
  let config;
  let configError = '';
  let wasFundamentalChecked = true;
  let detected = '';
  const lookups = new Map();
  async function detectAsset() {
    const sym = symbols()[0];
    if (f.asset.value !== 'auto' || !sym) return;
    if (!lookups.has(sym)) lookups.set(sym, get('/api/asset-type?ticker=' + encoded(sym),signal));
    try {
      const result = await lookups.get(sym);
      if (sym === symbols()[0] && !signal.aborted) {
        detected = result.asset_type;
        updatePreview();
      }
    } catch(err) {
      lookups.delete(sym);
      throw err;
    }
  }
  function updatePreview() {
    const fundamental = form.querySelector('[value="fundamentals"]');
    const crypto = f.asset.value === 'crypto' || (f.asset.value === 'auto' && detected === 'crypto');
    f.asset.options[0].textContent = '自动识别' + (detected ? (detected === 'crypto' ? ' · 加密资产' : ' · 证券') : '');
    if (crypto && !fundamental.disabled) { wasFundamentalChecked = fundamental.checked; fundamental.checked = false; }
    if (!crypto && fundamental.disabled) fundamental.checked = wasFundamentalChecked;
    fundamental.disabled = crypto;
    fundamental.closest('label').hidden = crypto;
    if (backtest) f.end.min = f.start.value;
    const syms = symbols();
    form.querySelector('[data-preview-symbol]').textContent = syms.slice(0,2).join(' / ') + (syms.length > 2 ? ' +' + (syms.length-2) : '') || '待选标的';
    form.querySelector('[data-preview-date]').textContent = backtest ? f.start.value + ' — ' + f.end.value : f.date.value;
    const rows = [['分析师', choices().length + ' 位']];
    if (backtest) {
      const dates = Math.floor((f.end.valueAsNumber - f.start.valueAsNumber) / 86400000 / f.every.valueAsNumber) + 1;
      rows.push(['回测任务数', Number.isFinite(dates) && dates > 0 ? syms.length * dates : '—']);
    }
    if (config) {
      rows.push(['快速模型', config.quick_think_llm], ['深度模型', config.deep_think_llm], ['多空 / 风控轮数', config.max_debate_rounds + ' / ' + config.max_risk_discuss_rounds], ['报告语言', config.output_language]);
      if (!backtest) rows.push(['断点续跑', config.checkpoint_enabled ? '已开启' : '已关闭']);
    } else rows.push(['运行配置', configError || '读取中…']);
    form.querySelector('.wf-preview-grid').innerHTML = rows.map(([k,v]) => '<dt>' + escape(k) + '</dt><dd>' + escape(v) + '</dd>').join('');
  }
  form.addEventListener('input', ev => {
    if (ev.target === f.symbols) detected = '';
    updatePreview();
  });
  for (const control of [f.symbols, f.asset]) control.addEventListener('change', () => {
    detectAsset().catch(err => { if (!signal.aborted) message(err.message); });
  });
  f.use_book.onchange = () => {
    const book = form.querySelector('.wf-book');
    book.hidden = book.disabled = !f.use_book.checked;
  };
  form.querySelector('[data-add]').onclick = () => {
    positions.insertAdjacentHTML('beforeend', positionRow());
    positions.lastElementChild.querySelector('input').focus();
  };
  positions.onclick = ev => ev.target.closest('[data-remove]')?.closest('.wf-position')?.remove();
  f.import_file.onchange = async () => {
    try {
      const file = f.import_file.files[0];
      if (!file) return;
      const book = JSON.parse(await file.text());
      if (!book || typeof book !== 'object' || Array.isArray(book) ||
        (book.positions !== undefined && !Array.isArray(book.positions)) ||
        (book.positions ?? []).some(p => typeof p?.ticker !== 'string' || !p.ticker.trim() || !Number.isFinite(p.quantity) ||
          (p.average_price != null && !Number.isFinite(p.average_price))) ||
        (book.currency != null && typeof book.currency !== 'string') || (book.cash != null && !Number.isFinite(book.cash))) {
        throw new Error('请检查现金、币种和持仓格式。每一笔持仓都需要 ticker 和 quantity。');
      }
      f.cash.value = book.cash ?? '';
      f.currency.value = book.currency ?? '';
      positions.innerHTML = (book.positions ?? []).map(positionRow).join('');
      message();
    } catch (err) { message('组合导入失败。' + err.message); }
    finally { f.import_file.value = ''; }
  };
  const clear = form.querySelector('[data-clear]');
  if (clear) clear.onclick = async () => {
    if (!window.confirm('清空所有分析断点？下次运行将从头开始。')) return;
    clear.disabled = true;
    try {
      const data = await post('/api/checkpoints/clear', {});
      form.querySelector('[data-clear-result]').textContent = '已清除 ' + data.count + ' 个断点。';
    } catch(err) { message(err.message); }
    finally { clear.disabled = false; }
  };
  form.onsubmit = async ev => {
    ev.preventDefault();
    const startButton = form.querySelector('[type=submit]');
    if (startButton.disabled) return;
    message();
    const syms = symbols();
    if (!syms.length || (!backtest && syms.length !== 1)) { message(backtest ? '请填写回测标的。' : '请填写一个标的代码。'); return; }
    startButton.disabled = true;
    try { await detectAsset(); }
    catch(err) { message(err.message); startButton.disabled = false; return; }
    const analysts = choices();
    if (!analysts.length) { message('请至少选择一位分析师。'); startButton.disabled = false; return; }
    const payload = {kind, asset_type: f.asset.value, analysts};
    if (backtest) {
      Object.assign(payload,{tickers: syms, start: f.start.value, end: f.end.value, every: f.every.valueAsNumber});
      if (f.run_id.value.trim()) payload.run_id = f.run_id.value.trim();
    } else Object.assign(payload,{ticker: syms[0], date: f.date.value});
    if (f.use_book.checked) {
      payload.portfolio = {positions: [...positions.querySelectorAll('.wf-position')].map(row => {
        const inputs = row.querySelectorAll('input');
        const entry = {ticker: inputs[0].value.trim(), quantity: inputs[1].valueAsNumber};
        if (inputs[2].value !== '') entry.average_price = inputs[2].valueAsNumber;
        return entry;
      })};
      if (f.cash.value !== '') payload.portfolio.cash = f.cash.valueAsNumber;
      if (f.currency.value.trim()) payload.portfolio.currency = f.currency.value.trim();
    }
    startButton.disabled = true;
    try {
      const job = await post('/api/jobs', payload);
      if (!signal.aborted) location.hash = 'history/' + encoded(job.id);
    } catch(err) { message(err.message); }
    finally { startButton.disabled = false; }
  };
  if (nextRequest?.kind === kind) {
    const source = nextRequest;
    nextRequest = null;
    f.symbols.value = (backtest ? source.tickers?.join(', ') : source.ticker) || '';
    for (const key of (backtest ? ['start','end','every','run_id'] : ['date'])) {
      if (source[key] != null) f[key].value = source[key];
    }
    f.asset.value = source.asset_type || 'stock';
    for (const input of f.analysts) input.checked = source.analysts?.includes(input.value) ?? true;
    if (source.portfolio) {
      f.use_book.checked = true;
      f.use_book.onchange();
      f.cash.value = source.portfolio.cash ?? '';
      f.currency.value = source.portfolio.currency ?? '';
      positions.innerHTML = (source.portfolio.positions ?? []).map(positionRow).join('');
    }
  }
  updatePreview();
  detectAsset().catch(err => { if (!signal.aborted) message(err.message); });
  try { config = (await get('/api/settings',signal)).config; }
  catch(err) { configError = '读取失败'; }
  if (!signal.aborted) updatePreview();
}

function searchBox(label) {
  return '<label class="wf-search">' + icon('search') + '<input type="search" placeholder="' + escape(label) + '" aria-label="' + escape(label) + '"></label>';
}
function table(headers, body) {
  return '<div class="wf-table-wrap"><table class="wf-table"><thead><tr>' + headers.map(h => '<th>' + escape(h) + '</th>').join('') + '</tr></thead><tbody>' + body + '</tbody></table></div>';
}
function loading() { return '<div class="wf-loading" role="status">正在读取本地记录…</div>'; }

async function historyPage({host,signal},tab) {
  host.innerHTML = title('研究档案', '查看运行进度、回测结果与已保存的分析报告。', formLink) +
    '<section class="wf-panel wf-archive"><div class="wf-archive-tools"><div class="wf-tabs" aria-label="档案分类"><button class="wf-tab" type="button" data-tab="jobs">运行记录</button><button class="wf-tab" type="button" data-tab="reports">报告库</button></div>' +
    searchBox('搜索标的或日期') + '</div><div data-body>' + loading() + '</div></section>';
  const body = host.querySelector('[data-body]');
  const filter = host.querySelector('[type=search]');
  let current = tab === 'reports' ? 'reports' : 'jobs', jobs = [], reports = [];
  function render() {
    for (const btn of host.querySelectorAll('[data-tab]')) btn.setAttribute('aria-pressed', String(btn.dataset.tab === current));
    const query = filter.value.trim().toLowerCase();
    const isJobs = current === 'jobs';
    const items = (isJobs ? jobs : reports).filter(x => (x.ticker + ' ' + x.date).toLowerCase().includes(query));
    if (!items.length) {
      body.innerHTML = query ? empty('未找到匹配项', '试试其他代码或日期。') : empty(isJobs ? '暂无运行记录' : '暂无已保存的报告', isJobs ? '启动分析或回测后，在这里查看进度与结果。' : '分析完成后，完整报告会出现在这里。');
      return;
    }
    const rows = items.map(item => '<tr><td><a class="wf-ticker" href="#' + (isJobs ? 'history' : 'report') + '/' + encoded(item.id) + '">' + escape(item.ticker) + '</a></td><td>' +
      (isJobs ? (item.kind === 'backtest' ? '历史回测' : '单标的分析') : escape(rating(item.rating))) + '</td><td>' + escape(item.date || '—') + '</td><td>' +
      (isJobs ? tag(item.status) : escape(timestamp(item.modified_at))) + '</td><td><a class="wf-text-link" href="#' + (isJobs ? 'history' : 'report') + '/' + encoded(item.id) + '">查看 ' + icon('chevron') + '</a></td></tr>').join('');
    body.innerHTML = table(isJobs ? ['研究标的','任务类型','研究日期','运行状态','操作'] : ['研究标的','决策评级','分析日期','保存时间','操作'],rows);
  }
  async function refresh() {
    [jobs, reports] = await Promise.all([get('/api/jobs',signal),get('/api/reports',signal)]);
    if (signal.aborted) return;
    render();
    if (jobs.some(j => j.status === 'running')) window.setTimeout(() => { if (!signal.aborted) refresh().catch(err => { if (!signal.aborted) body.innerHTML = alertBox(err.message); }); }, 4000);
  }
  host.querySelector('.wf-tabs').onclick = ev => {
    const clicked = ev.target.closest('[data-tab]');
    if (clicked) { current = clicked.dataset.tab; render(); }
  };
  filter.oninput = render;
  await refresh();
}

function asPercent(value) { return value == null ? '—' : (Number(value) * 100).toFixed(1) + '%'; }
function backtestSummary(result) {
  const s = result.summary || {};
  const stats = [['本次完成',result.cells_run], ['跳过已有',result.skipped], ['已结算',s.resolved], ['待结算',s.pending], ['无法评分',s.unscored]];
  const scores = Object.entries(s.by_rating || {}).map(([r,score]) => '<tr><td>' + escape(rating(r)) + '</td><td>' + escape(score.count) + '</td><td>' + escape(asPercent(score.hit_rate)) + '</td><td>' + escape(asPercent(score.mean_alpha)) + '</td></tr>').join('');
  const failures = [...(result.failures || []), ...(result.settlement_failures || [])];
  return '<section class="wf-panel">' + panelHeading('chart','回测结果') + '<div class="wf-stats">' + stats.map(([l,v]) => '<div><small>' + l + '</small><strong>' + escape(v ?? 0) + '</strong></div>').join('') + '</div>' +
    (scores ? table(['评级','已结算样本','方向命中率','平均超额收益'],scores) : '<p class="wf-muted">暂无可评分的已结算样本。</p>') +
    (s.holding ? '<p class="wf-muted">持有窗口 · ' + escape(s.holding) + '</p>' : '') +
    (failures.length ? '<details class="wf-disclosure"><summary>查看失败明细（' + failures.length + '）</summary><ul>' + failures.map(parts => '<li>' + escape(parts.join(' · ')) + '</li>').join('') + '</ul></details>' : '') +
    '</section>';
}
function documentView(host, report, html, filename) {
  renderReport(host, report, html, filename, saveText);
}
async function reportPage({host,signal},id) {
  host.innerHTML = loading();
  const list = await get('/api/reports',signal);
  const r = list.find(item => item.id === id);
  if (!r) throw new Error('报告不存在或已移至其他结果目录。');
  const url = '/api/reports/' + encoded(id) + '?format=';
  const [md,html] = await Promise.all([request(url+'md',{signal}).then(v => v.text()), r.has_html ? request(url+'html',{signal}).then(v => v.text()) : '']);
  if (signal.aborted) return;
  host.innerHTML = title(r.title, [r.date,rating(r.rating)].filter(Boolean).join(' · '), '<a class="wf-button" href="#reports">' + icon('back') + '报告库</a>');
  documentView(host,md,html,id);
}

async function jobPage({host,signal},id) {
  const path = '/api/jobs/' + encoded(id);
  host.innerHTML = loading();
  let job;
  let previousSnapshot;
  let nextPoll;
  let progressView;
  function poll() {
    clearTimeout(nextPoll);
    if (job.status !== 'running' || signal.aborted) return;
    nextPoll = setTimeout(() => {
      if (!signal.aborted) update().catch(err => {
        if (!signal.aborted) {
          host.querySelector('[data-msg]').innerHTML = alertBox('刷新失败，正在重连。' + err.message);
          previousSnapshot = null;
          poll();
        }
      });
    }, 2000);
  }
  signal.addEventListener('abort', () => { clearTimeout(nextPoll); progressView?.(); }, {once:true});
  async function update() {
    job = await get(path,signal);
    if (signal.aborted) return;
    if (!progressView) {
      host.innerHTML = title(job.ticker + (job.kind === 'backtest' ? ' 回测' : ' 研究'), job.date, '<a class="wf-button" href="#history">' + icon('back') + '运行记录</a>') +
        '<div class="wf-stack"><div data-live-progress></div><div class="wf-stack" data-job-details></div></div>';
      progressView = mountProgress(host.querySelector('[data-live-progress]'),job,{autoPoll:false});
    } else progressView.update(job);
    const snapshot = JSON.stringify([job.status,job.stage,job.events?.at(-1),job.stats]);
    if (previousSnapshot === snapshot) { poll(); return; }
    previousSnapshot = snapshot;
    const opened = new Set([...host.querySelectorAll('.wf-event-detail[open]')].map(el => el.dataset.event));
    const backtest = job.kind === 'backtest';
    const result = job.result;
    const logOpen = host.querySelector('.pg-log')?.open;
    const detailHost = host.querySelector('[data-job-details]');
    detailHost.innerHTML = '<section class="wf-panel"><div class="wf-panel-bar">' + panelHeading('clock','任务状态') + tag(job.status) + '</div><div class="wf-job-meta"><div><small>当前阶段</small><b>' + escape(job.stage || '—') + '</b></div><div><small>启动时间</small><b>' + escape(timestamp(job.started_at)) + '</b></div>' +
      (job.finished_at ? '<div><small>结束时间</small><b>' + escape(timestamp(job.finished_at)) + '</b></div>' : '') +
      (result?.rating ? '<div><small>最终评级</small><b>' + escape(rating(result.rating)) + '</b></div>' : '') +
      (backtest && job.run_id ? '<div><small>续跑编号</small><code>' + escape(job.run_id) + '</code></div>' : '') + '</div>' +
      (job.stats ? '<div class="wf-counter-row">' + [['模型调用',job.stats.llm_calls],['工具调用',job.stats.tool_calls],['输入 tokens',job.stats.tokens_in],['输出 tokens',job.stats.tokens_out]].filter(([,v]) => v != null).map(([l,v])=> '<span>' + escape(l) + ' <b>' + escape(v.toLocaleString()) + '</b></span>').join('') + '</div>' : '') +
      (job.error ? alertBox(job.error) : '') + '<div class="wf-actions">' +
      (job.status === 'running' ? '<button class="wf-button wf-cancel" type="button" data-cancel>停止任务</button>' : (job.parameters ? '<button type="button" class="wf-button" data-again>' + (backtest ? '继续此回测' : '使用相同参数新建') + icon('arrow') + '</button>' : '')) +
      '</div><div data-msg role="status"></div></section>' +
      (result && backtest ? backtestSummary(result) : '') + '<details class="wf-panel pg-log"' + (logOpen ? ' open' : '') + '><summary>执行日志 <span>' + (job.events || []).length + '</span></summary>' +
      ((job.events || []).length ? '<ol class="wf-events">' + job.events.slice().reverse().map(e => {
        const key = e.time + ' ' + e.text;
        const content = e.detail ? '<details class="wf-event-detail" data-event="' + escape(key) + '"' + (opened.has(key) ? ' open' : '') + '><summary>' + escape(e.text) + '</summary><pre class="wf-prose">' + escape(e.detail) + '</pre></details>' : '<span>' + escape(e.text) + '</span>';
        return '<li><time>' + escape(timestamp(e.time)) + '</time>' + content + '</li>';
      }).join('') + '</ol>' : '<p class="wf-muted">等待研究进程返回首条记录。</p>') +
      '</details>';
    if (result?.report) documentView(detailHost,result.report,result.html,job.ticker + '_' + job.id);
    const cancel = host.querySelector('[data-cancel]');
    if (cancel) cancel.onclick = async () => {
      if (!confirm(backtest ? '停止当前回测？已完成的样本将保留。' : '停止这次研究任务？')) return;
      cancel.disabled = true;
      try { await post(path + '/cancel',{}); if (!signal.aborted) await update(); }
      catch(err) {
        if (!signal.aborted) { host.querySelector('[data-msg]').innerHTML = alertBox(err.message); cancel.disabled = false; }
      }
    };
    const again = host.querySelector('[data-again]');
    if (again) again.onclick = () => {
      nextRequest = {...job.parameters};
      location.hash = backtest ? 'backtest' : 'analysis';
    };
    poll();
  }
  await update();
}

async function memoryPage({host,signal}) {
  host.innerHTML = title('决策记忆','按标的回顾历史评级、已实现收益及结算后的复盘。') + '<section class="wf-panel wf-archive"><div class="wf-archive-tools">' +
    searchBox('搜索标的或评级') + '<select class="wf-select" aria-label="结算状态"><option value="all">全部状态</option><option value="pending">待结算</option><option value="settled">已结算</option></select></div><div data-memory>' + loading() + '</div></section>';
  const data = await get('/api/memory',signal);
  if (signal.aborted) return;
  const body = host.querySelector('[data-memory]');
  const filter = host.querySelector('[type=search]');
  const select = host.querySelector('select');
  const entries = (data.entries || []).slice().sort((a,b) => String(b.date).localeCompare(String(a.date)));
  function render() {
    const q = filter.value.toLowerCase().trim();
    const shown = entries.filter(e =>
      (e.ticker + ' ' + e.rating + ' ' + rating(e.rating)).toLowerCase().includes(q) &&
      (select.value === 'all' || e.pending === (select.value === 'pending')));
    if (!entries.length && data.text?.trim()) {
      body.innerHTML = '<pre class="wf-prose">' + escape(data.text) + '</pre>';
      return;
    }
    if (!shown.length) {
      body.innerHTML = entries.length ? empty('未找到匹配项','调整标的、评级或结算状态后再试。') : empty('暂无决策记忆','完成一次分析后，系统会记录评级并在持有期结束后结算。',formLink);
      return;
    }
    body.innerHTML = '<div class="wf-mem-list">' + shown.map(e=>'<details class="wf-mem"><summary><span class="wf-ticker">' + escape(e.ticker) + '</span><span>' + escape(rating(e.rating)) + '</span><time>' + escape(e.date) + '</time><span class="wf-status ' + (e.pending ? 'wf-neutral' : 'wf-completed') + '">' + (e.pending ? '待结算' : '已结算') + '</span>' + icon('chevron') + '</summary><div class="wf-mem-detail">' +
      (e.pending ? '' : '<div class="wf-job-meta">' + [['已实现收益',e.raw],['超额收益',e.alpha],['持有期',e.holding],['结算日期',e.resolved]].map(([l,v])=> '<div><small>' + l + '</small><b>' + escape(v ?? '—') + '</b></div>').join('') + '</div>') +
      '<h3>研究决策</h3><pre class="wf-prose">' + escape(e.decision || '—') + '</pre>' + (e.reflection ? '<h3>复盘</h3><pre class="wf-prose">' + escape(e.reflection) + '</pre>' : '') + '</div></details>').join('') + '</div>';
  }
  filter.oninput = select.onchange = render;
  render();
}
