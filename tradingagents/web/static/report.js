// Read the saved TradingAgents report without running another model. Only the
// portfolio manager's own fields can populate the decision at the top.
const TEAMS = [
  ["I. Analyst Team Reports", "分析师报告", {"Market Analyst":"技术分析", "Sentiment Analyst":"情绪分析", "News Analyst":"新闻分析", "Fundamentals Analyst":"基本面分析"}],
  ["II. Research Team Decision", "多空研究", {"Bull Researcher":"多头研究员", "Bear Researcher":"空头研究员", "Research Manager":"研究主管"}],
  ["III. Trading Team Plan", "交易计划", {"Trader":"交易员"}],
  ["IV. Risk Management Team Decision", "风险评估", {"Aggressive Analyst":"进取型风险分析师", "Conservative Analyst":"保守型风险分析师", "Neutral Analyst":"中性风险分析师"}],
  ["V. Portfolio Manager Decision", "最终决策", {"Portfolio Manager":"投资组合经理"}],
];
const RATINGS = {buy:"买入", overweight:"增持", hold:"持有", underweight:"减持", sell:"卖出", review:"待复核"};
const FIELD_NAMES = {
  "rating":"rating", "final rating":"rating", "评级":"rating", "最终评级":"rating",
  "executive summary":"summary", "决策摘要":"summary", "执行摘要":"summary",
  "investment thesis":"thesis", "投资逻辑":"thesis", "投资论点":"thesis",
  "key risks":"risk", "risks":"risk", "风险因素":"risk", "主要风险":"risk",
  "action plan":"action", "execution plan":"action", "执行计划":"action", "行动计划":"action",
  "price target":"target", "目标价":"target", "time horizon":"horizon", "持有期限":"horizon",
  "final transaction proposal":"proposal",
};
function plain(value) {
  return String(value || "").replace(/\*\*([^\n]*?)\*\*/g,"$1").replace(/\x60([^\x60\n]+)\x60/g,"$1").trim();
}
function managerFields(text) {
  const fields = {};
  let current = "", fence = "";
  for (const line of text.split("\n")) {
    const marker = line.match(/^\s*(`{3,}|~{3,})/);
    if (marker) {
      if (!fence) fence = marker[1];
      else if (marker[1].startsWith(fence)) fence = "";
      continue;
    }
    if (!fence) {
      const cleaned = line.trim().replace(/^#{1,6}\s+|^[-*]\s+/g, "").replace(/\*\*/g, "");
      const m = cleaned.match(/^([^:：]{1,30})(?:[:：](.*))?$/);
      const label = m && m[1].trim().toLowerCase();
      const key = label && Object.hasOwn(FIELD_NAMES,label) && FIELD_NAMES[label];
      if (key) {
        current = key;
        fields[key] = m[2]?.trim() || "";
        continue;
      }
      // Other titled fields terminate the previous field.
      if (/^(?:#{1,6}\s|\*\*[^*\n]{1,60}\*\*\s*[:：])/.test(line)) current = "";
    }
    if (current) fields[current] += "\n" + line;
  }
  return Object.fromEntries(Object.entries(fields).map(([key,value]) => [key,value.trim()]));
}

export function parseReport(markdown) {
  const lines = String(markdown ?? "").replace(/\r\n?/g,"\n").split("\n");
  const teams = [], header = [];
  let team, agent, fence = "";
  for (const line of lines) {
    const mark = line.match(/^\s*(`{3,}|~{3,})/);
    const inCode = !!fence || !!mark;
    if (mark) {
      if (!fence) fence = mark[1];
      else if (mark[1].startsWith(fence)) fence = "";
    }
    const heading = !inCode && line.match(/^##\s+(.+?)\s*$/);
    const known = heading && TEAMS.find(t => t[0].toLowerCase() === heading[1].toLowerCase());
    if (known) {
      team = {name:known[1], index:TEAMS.indexOf(known), agents:[]};
      teams.push(team);
      agent = null;
      continue;
    }
    if (!team) { header.push(line); continue; }
    const role = !inCode && line.match(/^###\s+(.+?)\s*$/);
    const names = TEAMS[team.index][2];
    if (role && Object.hasOwn(names, role[1])) {
      agent = {role:role[1], name:names[role[1]], lines:[]};
      team.agents.push(agent);
    } else if (agent || line.trim()) {
      if (!agent) {
        agent = {role:"", name:team.name, lines:[]};
        team.agents.push(agent);
      }
      agent.lines.push(line);
    }
  }
  for (const t of teams) for (const a of t.agents) {
    a.text = a.lines.join("\n").trim();
    delete a.lines;
  }
  const pm = teams.find(t => t.index === 4)?.agents.find(a => a.role === "Portfolio Manager" || !a.role);
  const fields = managerFields(pm?.text || "");
  const headerRating = header.map(l => l.match(/^-\s*Rating\s*:\s*(.+?)\s*$/i)).find(Boolean)?.[1];
  return {teams:teams.filter(t => t.agents.length), pm, fields, header:header.join("\n").trim(), rating:plain(headerRating || fields.rating).split("\n")[0]};
}

// Every excerpt consists of complete source sentences, preserving conditional
// clauses and surrounding qualifiers inside each sentence.
export function decisionExcerpts(fields) {
  const sentences = (fields.summary || "").match(/[^。！？!?\n]+(?:[。！？!?]+[”」’]?|$)|[^\n]+/g) || [];
  const units = sentences.flatMap(line => line.trim().split(/(?<=\.)\s+(?=[A-Z])/)).map(s=>s.trim()).filter(Boolean);
  const action = /加仓|减仓|建仓|敞口|仓位|空仓|对冲|分批|\b(?:position|allocation|entry|sizing|hedge|trim|exposure)\b/i;
  const risk = /风险|止损|回撤|红线|降级|退出触发|\b(?:risk|stop.loss|downgrade|drawdown|invalidation)\b/i;
  const opening = plain(units[0]).replace(/[。.!！]$/, "").trim();
  const ratingOnly = /^(?:(?:对\s*[\w.^-]+\s*的)?(?:本次)?(?:最终)?(?:交易)?(?:决策|评级|建议|结论)\s*(?:是|为|[:：])?\s*|(?:our |the )?(?:final )?(?:rating|decision|recommendation)(?: for [\w.^-]+)?\s*(?:is|remains|[:：])?\s*)?(?:buy|overweight|hold|underweight|sell|持有|增持|减持|买入|卖出)(?:\s*[（(](?:buy|overweight|hold|underweight|sell|持有|增持|减持|买入|卖出)[)）])?$/i;
  const leadIndex = units.length > 1 && ratingOnly.test(opening) ? 1 : 0;
  const lead = units[leadIndex] || "";
  const rest = units.slice(leadIndex + 1);
  const actionText = fields.action || rest.find(s => action.test(s) && !risk.test(s)) ||
    (!action.test(lead) && rest.find(s => action.test(s))) || "";
  const riskText = fields.risk || rest.find(s => s !== actionText && risk.test(s)) || "";
  return {lead, action:actionText === lead ? "" : actionText, risk:riskText === lead ? "" : riskText};
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function button(label, className, click) {
  const node = element("button", className, label);
  node.type = "button";
  node.onclick = click;
  return node;
}

function inline(node, line) {
  // Report content is data. Never attach report HTML to the workbench DOM.
  const pattern = /\*\*([^*]+)\*\*|\x60([^\x60]+)\x60|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/gi;
  let offset = 0;
  for (const match of line.matchAll(pattern)) {
    node.append(line.slice(offset, match.index));
    if (match[1]) node.append(element("strong","",match[1]));
    else if (match[2]) node.append(element("code","",match[2]));
    else {
      const link = element("a", "", match[3]);
      link.href = match[4]; link.target = "_blank"; link.rel = "noopener noreferrer";
      node.append(link);
    }
    offset = match.index + match[0].length;
  }
  node.append(line.slice(offset));
}

function prose(text) {
  const body = element("div","rp-prose");
  const lines = text.split("\n");
  let paragraph = [], list, fence = "", code = [];
  const flush = () => {
    if (paragraph.length) {
      const p = element("p");
      inline(p,paragraph.join("\n"));
      body.append(p); paragraph = [];
    }
    list = null;
  };
  for (let i=0; i<lines.length; i++) {
    const line = lines[i], trimmed = line.trim();
    const mark = trimmed.match(/^(`{3,}|~{3,})/);
    if (fence) {
      if (mark?.[1].startsWith(fence)) { body.append(element("pre","",code.join("\n"))); fence = ""; code = []; }
      else code.push(line);
      continue;
    }
    if (mark) { flush(); fence = mark[1]; continue; }
    if (!trimmed) { flush(); continue; }
    if (/^(?:-{3,}|\*{3,})$/.test(trimmed)) { flush(); body.append(element("hr")); continue; }
    if (trimmed.includes("|") && /^\s*\|?\s*:?-{3,}:?\s*\|/.test(lines[i+1] || "")) {
      flush();
      const table = element("table");
      const cells = row => row.trim().replace(/^\||\|$/g,"").split("|");
      function row(line, cell) {
        const tr = element("tr");
        for (const value of cells(line)) { const td = element(cell); inline(td,value.trim()); tr.append(td); }
        table.append(tr);
      }
      row(trimmed,"th"); i++;
      while (i+1<lines.length && lines[i+1].trim().includes("|")) row(lines[++i],"td");
      const frame = element("div","rp-table"); frame.append(table); body.append(frame);
      continue;
    }
    const heading = trimmed.match(/^#{1,6}\s+(.+)/);
    if (heading) { flush(); const h = element("h4"); inline(h,heading[1]); body.append(h); continue; }
    const item = trimmed.match(/^(?:([-*+])|([0-9]+)[.)])\s+(.+)/);
    if (item) {
      const tag = item[2] ? "ol" : "ul";
      if (!list || list.localName !== tag) { flush(); list = element(tag); if (item[2]) list.start = Number(item[2]); body.append(list); }
      const li = element("li"); inline(li,item[3]); list.append(li);
    } else {
      list = null;
      paragraph.push(trimmed);
    }
  }
  flush();
  if (fence) body.append(element("pre","",code.join("\n")));
  return body;
}

function disclosure(title, render, className = "") {
  const details = element("details", "rp-disclosure " + className);
  details.append(element("summary","",title));
  details.addEventListener("toggle", () => {
    if (details.open && details.children.length === 1) details.append(render());
  });
  return details;
}
function paragraphExcerpt(text) {
  return (text || "").split(/\n\s*\n/).find(s => s.trim()) || "";
}

export function renderReport(host, markdown, html, filename, saveText) {
  const parsed = parseReport(markdown);
  const root = element("section","rp-reader");
  const fragments = decisionExcerpts(parsed.fields);
  const teams = parsed.teams;
  let showManager;
  function compact(text, container) {
    text.classList.add("rp-clipped");
    requestAnimationFrame(() => {
      if (!text.isConnected || text.scrollHeight <= text.clientHeight + 1) {
        text.classList.remove("rp-clipped");
        return;
      }
      const toggle = button("展开摘录","rp-link",()=>{
        const clipped = text.classList.toggle("rp-clipped");
        toggle.textContent = clipped ? "展开摘录" : "收起摘录";
        toggle.setAttribute("aria-expanded",String(!clipped));
      });
      toggle.setAttribute("aria-expanded","false");
      container.prepend(toggle);
    });
  }
  if (parsed.pm || parsed.rating) {
    const decision = element("section","rp-decision");
    const header = element("div","rp-decision-head");
    header.append(element("h2","","组合经理决策"));
    if (parsed.rating) {
      const key = parsed.rating.toLowerCase();
      const badge = element("span","rp-rating " + (Object.hasOwn(RATINGS,key) ? "rp-"+key : ""),RATINGS[key] || parsed.rating);
      if (RATINGS[key] && key !== "review") badge.append(element("small","",parsed.rating));
      header.append(badge);
    }
    decision.append(header);
    const lead = fragments.lead || paragraphExcerpt(parsed.pm?.text).replace(/^\*\*Rating\*\*:\s*[^\n]+$/i,"").trim();
    if (lead) {
      const p = element("p","rp-lead"), control = element("div","rp-buttons");
      inline(p,lead); decision.append(p,control); compact(p,control);
    }
    if (parsed.fields.summary && lead !== parsed.fields.summary)
      decision.append(disclosure("完整决策摘要",() => prose(parsed.fields.summary),"rp-quiet"));
    const facts = [["目标价",parsed.fields.target],["持有期限",parsed.fields.horizon]].filter(([,v])=>v);
    if (facts.length) {
      const dl = element("dl","rp-facts");
      for (const [k,v] of facts) { const div=element("div"); div.append(element("dt","",k),element("dd","",/^not provided$/i.test(v) ? "未提供" : plain(v))); dl.append(div); }
      decision.append(dl);
    }
    if (parsed.pm) decision.append(button("查看组合经理原文 →","rp-link",()=>showManager?.()));
    root.append(decision);

    const cards = [
      ["决策依据", paragraphExcerpt(parsed.fields.thesis)],
      ["执行条件摘录", fragments.action],
      ["风险条件摘录", fragments.risk],
    ].filter(([,text])=>text);
    if (cards.length) {
      const grid = element("div","rp-cards");
      for (const [label, text] of cards) {
        const card=element("article","rp-extract");
        card.append(element("h3","",label));
        const p=element("p"), controls=element("div","rp-buttons");
        inline(p,text); card.append(p,controls);
        controls.append(button("定位原文","rp-link",()=>showManager?.(text)));
        compact(p,controls);
        grid.append(card);
      }
      root.append(grid);
    }
  }
  if (teams.length) {
    const panel = element("section","rp-evidence");
    const heading = element("div","rp-evidence-head");
    heading.append(element("h2","","研究过程与证据"),element("span","",teams.reduce((n,t)=>n+t.agents.length,0)+" 份记录"));
    const nav = element("div","rp-team-nav");
    nav.setAttribute("aria-label","按团队查看报告");
    const evidence = element("div","rp-agents");
    const tabs = [];
    function select(index, target) {
      tabs.forEach((tab,n) => tab.setAttribute("aria-pressed",String(n===index)));
      evidence.replaceChildren();
      for (const agent of teams[index].agents) {
        const details=disclosure(agent.name,() => prose(agent.text),"rp-agent");
        const summary=details.querySelector("summary");
        if (agent.role) summary.append(element("small","",agent.role));
        const preview = agent.text.split("\n").map(line => line.trim()).find(line =>
          line.length > 16 && !/^(?:#|\||---|\*\*报告日期|\*\*Rating)/i.test(line));
        if (preview) summary.append(element("span","rp-preview",plain(preview)));
        if (agent===target) {
          details.append(prose(agent.text));
          details.open=true;
        }
        evidence.append(details);
      }
    }
    teams.forEach((team,i)=>{
      const tab=button(team.name,"rp-tab",()=>select(i));
      tabs.push(tab);nav.append(tab);
    });
    select(0);
    showManager=needle=>{
      const i=teams.findIndex(t=>t.agents.includes(parsed.pm));
      if (i<0) return;
      select(i,parsed.pm);
      const details=evidence.querySelector("details[open]");
      if (!details) return;
      const normalize = text => plain(text).replace(/\s+/g," ").trim();
      const search = normalize(needle);
      const found = search && [...details.querySelectorAll("p, li")].find(p => normalize(p.textContent).includes(search));
      const target = found || details.querySelector("summary");
      if (found) { found.classList.add("rp-matched"); found.tabIndex=-1; }
      target.focus({preventScroll:true});
      target.scrollIntoView({block:"start"});
    };
    panel.append(heading,nav,evidence);root.append(panel);
  } else {
    const fallback=element("section","rp-evidence");
    fallback.append(element("h2","","报告正文"),prose(markdown || "报告未包含文本正文。"));
    root.append(fallback);
  }
  const source=element("section","rp-source");
  const tools=element("div","rp-source-actions");
  tools.append(element("h2","","报告原件"));
  if (markdown) tools.append(button("下载 Markdown","wf-button",()=>saveText(filename+".md",markdown,"text/markdown;charset=utf-8")));
  if (html) tools.append(button("下载 HTML","wf-button",()=>saveText(filename+".html",html,"text/html;charset=utf-8")));
  source.append(tools);
  if (teams.length && parsed.header) source.append(disclosure("生成信息与模型配置",()=>prose(parsed.header)));
  if (markdown) source.append(disclosure("查看完整 Markdown 原文",()=>element("pre","rp-original",markdown)));
  root.append(source);host.append(root);
}
