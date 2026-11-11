const providerNames = {
  openai: "OpenAI", anthropic: "Anthropic", google: "Google Gemini", azure: "Azure OpenAI",
  bedrock: "Amazon Bedrock", xai: "xAI", deepseek: "DeepSeek", qwen: "通义千问 · 国际",
  "qwen-cn": "通义千问 · 中国", glm: "智谱 GLM · 国际", "glm-cn": "智谱 GLM · 中国",
  minimax: "MiniMax · 国际", "minimax-cn": "MiniMax · 中国", openrouter: "OpenRouter",
  mistral: "Mistral AI", kimi: "Kimi", groq: "Groq", nvidia: "NVIDIA NIM",
  chatgpt: "ChatGPT 订阅", ollama: "Ollama", openai_compatible: "OpenAI 兼容服务",
};
const categoryNames = {
  core_stock_apis: "行情与成交量", technical_indicators: "技术指标", fundamental_data: "公司基本面",
  news_data: "新闻与内幕交易", macro_data: "宏观经济", prediction_markets: "预测市场",
};
const envNames = {
  AZURE_OPENAI_ENDPOINT: "Azure 资源地址", AZURE_OPENAI_DEPLOYMENT_NAME: "Azure 部署名称",
  OPENAI_API_VERSION: "Azure API 版本", OLLAMA_BASE_URL: "Ollama 服务地址", AWS_REGION: "AWS 区域",
  AWS_DEFAULT_REGION: "AWS 默认区域", AWS_PROFILE: "AWS 配置名称", SEC_EDGAR_USER_AGENT: "SEC EDGAR 联系人标识",
  TYPESAFE_DEFAULT_MODEL: "TypeSafe 内容筛选模型", TYPESAFE_BASE_URL: "TypeSafe 服务地址",
};
const otherKeys = {
  FRED_API_KEY: "FRED 宏观数据", ALPHA_VANTAGE_API_KEY: "Alpha Vantage", TYPESAFE_API_KEY: "TypeSafe",
  GEMINI_API_KEY: "Gemini 备用密钥", AWS_BEARER_TOKEN_BEDROCK: "Bedrock 访问令牌",
  AWS_ACCESS_KEY_ID: "AWS 访问密钥 ID", AWS_SECRET_ACCESS_KEY: "AWS 私有访问密钥", AWS_SESSION_TOKEN: "AWS 会话令牌",
};

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

async function request(url, method, payload) {
  const response = await fetch(url, method ? {
    method, headers: {"Content-Type": "application/json"}, body: JSON.stringify(payload || {}),
  } : {cache: "no-store"});
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "请求失败，请重试");
  return data;
}

function buildAccount(box, refreshModels) {
  const status = el("span", "st-account-status", "正在读取登录状态…");
  const actions = el("div", "st-actions");
  box.append(status, actions);
  let timer;
  let busy = false;
  let last;

  function action(text, handler) {
    const button = el("button", "st-ghost", text);
    button.type = "button";
    button.onclick = async () => {
      if (busy) return;
      busy = true;
      button.disabled = true;
      try {
        await handler();
        await update();
      } catch (error) {
        status.textContent = error.message;
      } finally {
        busy = false;
        button.disabled = false;
      }
    };
    actions.append(button);
  }
  async function update() {
    clearTimeout(timer);
    if (!box.isConnected) return;
    try {
      const state = await request("/api/auth");
      if (!box.isConnected) return;
      const signature = JSON.stringify([state.status, state.account, state.error, state.url]);
      if (state.status === "pending") timer = setTimeout(update, 1800);
      if (signature === last) return;
      last = signature;
      actions.replaceChildren();
      status.textContent = state.error || (state.account ? '当前账户 · ' + state.account : '当前未登录');
      if (state.account) {
        action("获取订阅模型", () => refreshModels());
        action("退出登录", () => request("/api/auth/logout", "POST"));
        return;
      }
      if (state.url) {
        const link = el("a", "st-ghost", "继续到 ChatGPT 登录 ↗");
        link.href = state.url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        actions.append(link);
        status.textContent = state.error || "等待浏览器授权，完成后返回本页。";
        const fallback = el("details", "st-callback");
        fallback.append(el("summary", "", "手动提交回调地址"));
        const input = el("input");
        input.type = "url";
        input.autocomplete = "off";
        input.placeholder = "粘贴登录后的完整回调地址";
        input.setAttribute("aria-label", input.placeholder);
        const submit = el("button", "st-ghost", "提交地址");
        submit.type = "button";
        submit.onclick = async () => {
          submit.disabled = true;
          try {
            await request("/api/auth/callback", "POST", {url: input.value.trim()});
            input.value = "";
          } catch (error) { status.textContent = error.message; }
          submit.disabled = false;
        };
        fallback.append(input, submit);
        actions.append(fallback);
      } else if (state.status === "pending") {
        status.textContent = "正在准备登录地址…";
      } else {
        action("登录 ChatGPT", () => request("/api/auth/login", "POST"));
      }
    } catch (error) {
      status.textContent = error.message;
    }
  }
  update();
}

export async function renderSettings(container) {
  const root = el("div", "ta-settings");
  root.setAttribute("aria-label", "系统设置");
  root.append(el("p", "st-info", "正在加载本机配置…"));
  container.replaceChildren(root);
  let loaded;
  try { loaded = await request("/api/settings"); }
  catch (error) { root.textContent = error.message; return; }
  if (!root.isConnected) return;

  const {config, environment, credentials, schema} = loaded;
  const changes = {config: {}, environment: {}, credentials: {}};
  const fields = [];
  const tabs = new Map();
  const panels = new Map();
  const toolbar = el("div", "st-toolbar");
  const nav = el("div", "st-tabs");
  nav.setAttribute("aria-label", "配置分类");
  const save = el("button", "st-save", "保存配置");
  save.type = "button";
  const feedback = el("span", "st-feedback", "已同步");
  feedback.setAttribute("role", "status");
  const saveArea = el("div", "st-save-area");
  saveArea.append(feedback, save);
  toolbar.append(nav, saveArea);
  root.replaceChildren(toolbar);
  function activate(name) {
    tabs.forEach((tab, key) => {
      tab.setAttribute("aria-pressed", String(key === name));
      panels.get(key).hidden = key !== name;
    });
  }
  function panel(name) {
    const tab = el("button", "st-tab", name);
    tab.type = "button";
    tab.onclick = () => activate(name);
    const section = el("section", "st-panel");
    tabs.set(name, tab);
    panels.set(name, section);
    nav.append(tab);
    root.append(section);
    return section;
  }
  const model = panel("模型服务");
  const strategy = panel("运行策略");
  const routing = panel("数据来源");
  const keys = panel("凭证管理");
  function card(parent, title, description, compact = false) {
    const node = el("section", "st-card" + (compact ? " st-compact" : ""));
    const header = el("div", "st-card-head");
    header.append(el("h3", "", title));
    if (description) header.append(el("p", "", description));
    const inner = el("div", "st-fields");
    node.append(header, inner);
    parent.append(node);
    return inner;
  }
  function details(parent, title) {
    const node = el("details", "st-details");
    node.append(el("summary", "", title));
    const inner = el("div", "st-fields");
    node.append(inner);
    parent.append(node);
    return inner;
  }

  function mark(group, key, value, original) {
    if (JSON.stringify(value) === JSON.stringify(original)) delete changes[group][key];
    else changes[group][key] = value;
    const dirty = Object.values(changes).some(part => Object.keys(part).length > 0);
    feedback.textContent = dirty ? "有未保存的更改" : "已同步";
    feedback.classList.remove("st-error");
    save.disabled = !dirty;
  }

  function field(parent, key, label, options = {}) {
    const {group = "config", kind = "text", choices, placeholder, wide, min = 1, hint, optional = false} = options;
    const original = (group === "environment" ? environment : config)[key];
    const wrap = el("label", "st-field" + (wide ? " st-wide" : ""));
    const input = el(choices ? "select" : ["json", "list"].includes(kind) ? "textarea" : "input");
    input.setAttribute("aria-label", label);
    if (choices) {
      for (const [value, text] of choices) input.add(new Option(text, value));
      if (original && !choices.some(([value]) => value === original)) input.add(new Option(original, original));
    } else if (kind === "checkbox") input.type = "checkbox";
    else if (kind === "number") { input.type = "number"; input.min = min; input.step = options.step || "1"; }
    else if (kind === "url") input.type = "url";
    if (options.max !== undefined) input.max = options.max;
    if (input.tagName === "TEXTAREA") input.rows = kind === "json" ? 7 : 4;
    input.autocomplete = "off";
    input.spellcheck = false;
    input.placeholder = loaded.hidden_endpoints?.includes(key) ? "已配置私有地址，输入新地址以替换" : placeholder || "";
    if (kind === "checkbox") input.checked = !!original;
    else if (kind === "json") input.value = JSON.stringify(original, null, 2);
    else if (kind === "list") input.value = original.join("\n");
    else input.value = original ?? "";
    input.required = !optional && kind !== "checkbox" && group !== "environment";
    function read() {
      if (kind === "json") return JSON.parse(input.value);
      if (kind === "list") return input.value.split("\n").map(s => s.trim()).filter(Boolean);
      if (kind === "checkbox") return input.checked;
      const s = input.value.trim();
      if (!s) return group === "config" ? null : "";
      return kind === "number" ? Number(s) : s;
    }
    function changed() {
      input.setCustomValidity("");
      try { mark(group, key, read(), original); }
      catch { input.setCustomValidity("请填写有效的 JSON 对象"); mark(group, key, input.value, original); }
    }
    input.oninput = changed;
    wrap.append(el("span", "st-label", label), input);
    if (hint) wrap.append(el("small", "", hint));
    parent.append(wrap);
    fields.push(input);
    return input;
  }

  const main = card(model, "默认模型服务", "快速与深度模型均可沿用此服务，也可分别指定。");
  const providers = schema.providers.map(key => [key, providerNames[key] || key]);
  const base = field(main, "llm_provider", "默认服务商", {choices: providers});
  const endpoint = field(main, "backend_url", "自定义接口地址", {
    kind: "url", optional: true, placeholder: "使用服务商默认地址",
  });
  const keyJump = el("button", "st-key-jump");
  keyJump.type = "button";
  const creds = new Map();
  keyJump.onclick = () => {
    activate("凭证管理");
    const input = creds.get(schema.provider_keys[base.value]);
    if (input) input.focus();
  };
  main.append(keyJump);

  const tiers = el("div", "st-tier-layout");
  model.append(tiers);
  function renderTier(tier, name, roles) {
    const prefix = tier + "_think_";
    const body = card(tiers, name, roles, true);
    const provider = field(body, prefix + "provider", "服务商", {
      choices: [["", "跟随默认服务商"], ...providers], optional: true,
    });
    const modelLabel = el("label", "st-field");
    const picker = el("select");
    picker.setAttribute("aria-label", "模型 ID");
    modelLabel.append(el("span", "st-label", "模型 ID"), picker);
    body.append(modelLabel);
    const id = field(body, prefix + "llm", "自定义模型 ID", {placeholder: "输入部署名或模型 ID"});
    const customLabel = id.closest("label");
    let customDraft = "";
    picker.onchange = () => {
      if (!customLabel.hidden) customDraft = id.value;
      customLabel.hidden = !!picker.value;
      id.value = picker.value || customDraft;
      id.oninput();
      if (!customLabel.hidden) id.focus();
    };
    const loadList = el("button", "st-key-jump", "读取 OpenRouter 模型列表");
    loadList.type = "button";
    body.append(loadList);
    loadList.onclick = async () => {
      loadList.disabled = true;
      try {
        const result = await request("/api/openrouter/models");
        const ids = result.models.map(model => model[1]);
        schema.models.openrouter = {quick: ids, deep: ids};
        quick.suggest();
        deep.suggest();
        loadList.textContent = ids.length ? "已读取 " + ids.length + " 个模型 · 刷新" : "暂未获取模型 · 重试";
      } catch (error) {
        loadList.textContent = error.message + " · 重试";
      } finally {
        loadList.disabled = false;
      }
    };
    const url = field(body, prefix + "backend_url", "独立接口地址", {kind: "url", optional: true, placeholder: "使用当前服务地址"});
    function suggest(reselect = false) {
      const active = provider.value || base.value;
      loadList.hidden = active !== "openrouter";
      const available = schema.models[active]?.[tier] || [];
      picker.replaceChildren(...available.map(modelId => new Option(modelId, modelId)),
        new Option("自定义模型 ID…", ""));
      if (reselect) {
        customDraft = "";
        if (!available.includes(id.value)) { id.value = available[0] || ""; id.oninput(); }
        url.value = "";
        url.oninput();
      }
      picker.value = available.includes(id.value) ? id.value : "";
      customLabel.hidden = !!picker.value;
      if (!customLabel.hidden) customDraft = id.value;
    }
    suggest();
    provider.addEventListener("change", () => suggest(true));
    return {provider, suggest};
  }
  const quick = renderTier("quick", "快速模型", "分析师、研究员、风险辩手与交易员使用。");
  const deep = renderTier("deep", "深度模型", "研究主管与投资组合经理使用。");
  function updateKeyJump() {
    const k = schema.provider_keys[base.value];
    keyJump.hidden = !k;
    if (k) keyJump.textContent = (credentials[k] ? "● 已配置服务凭证" : "○ 尚未配置凭证") + "　管理凭证 →";
  }
  updateKeyJump();
  base.addEventListener("change", () => {
    endpoint.value = ""; endpoint.oninput();
    for (const tier of [quick, deep]) if (!tier.provider.value) tier.suggest(true);
    updateKeyJump();
  });

  const tuning = details(model, "推理强度与调用限制");
  const effort = values => [["", "服务商默认"], ...values.map(v => [v, v])];
  field(tuning, "openai_reasoning_effort", "OpenAI 推理强度", {choices: effort(["low", "medium", "high", "xhigh"]), optional: true});
  field(tuning, "google_thinking_level", "Gemini 思考等级", {choices: effort(["minimal", "low", "medium", "high"]), optional: true});
  field(tuning, "anthropic_effort", "Anthropic 推理强度", {choices: effort(["low", "medium", "high", "max"]), optional: true});
  field(tuning, "temperature", "采样温度", {kind: "number", min: 0, max: 2, step: "any", optional: true, placeholder: "服务商默认"});
  field(tuning, "llm_max_retries", "失败重试次数", {kind: "number", min: 0, optional: true, placeholder: "SDK 默认"});
  field(tuning, "max_tokens", "最大输出 Token", {kind: "number", optional: true, placeholder: "模型默认"});

  const operation = card(strategy, "研究流程", "控制下一次分析的辩论深度、工具调用及报告语言。");
  const number = (p, key, label, opts) => field(p, key, label, {kind: "number", ...opts});
  number(operation, "max_debate_rounds", "多空辩论轮数");
  number(operation, "max_risk_discuss_rounds", "风险讨论轮数");
  number(operation, "max_tool_rounds", "每位分析师工具轮数");
  number(operation, "max_recur_limit", "决策图最大执行步数");
  field(operation, "output_language", "报告输出语言", {hint: "如 Chinese、English、Japanese"});
  field(operation, "checkpoint_enabled", "启用断点续跑", {kind: "checkbox", hint: "保存每一步状态，允许中断后继续。"});
  const memory = card(strategy, "反思与基准", "配置决策复盘的观察期和用于计算超额收益的对照指数。");
  number(memory, "holding_period_days", "持有期（交易日）");
  field(memory, "benchmark_ticker", "统一基准代码", {optional: true, placeholder: "按交易所匹配"});
  number(memory, "memory_log_max_entries", "已结算记忆条数上限", {optional: true, placeholder: "不限"});
  const mapping = details(strategy, "各交易所的默认基准");
  field(mapping, "benchmark_map", "交易所后缀 → 基准代码", {kind: "json", wide: true, hint: "空后缀匹配美国市场。"});
  const storage = details(strategy, "本机存储路径");
  for (const [key, label] of [["results_dir", "报告与运行结果目录"], ["data_cache_dir", "数据缓存目录"], ["memory_log_path", "交易记忆文件"]]) field(storage, key, label, {wide: true});

  const vendors = card(routing, "分类数据源", "按从左到右的顺序请求，可从列表选择或用英文逗号组合备用来源。");
  const routeFields = {data_vendors: {}, tool_vendors: {}};
  function routeField(p, group, key, label, options) {
    const wrap = el("label", "st-field");
    const input = el("input");
    const list = el("datalist");
    input.setAttribute("aria-label", label);
    const source = config[group];
    list.id = "st-route-" + key;
    for (const option of ["default", ...options]) list.append(new Option(option, option));
    input.setAttribute("list", list.id);
    input.value = source[key] || "";
    input.placeholder = group === "data_vendors" ? "default" : "沿用分类设置";
    input.spellcheck = false;
    input.oninput = () => {
      const next = Object.fromEntries(Object.entries(routeFields[group]).map(([name, item]) => [name, item.value.trim() || (group === "data_vendors" ? "default" : "")]).filter(([, v]) => v));
      mark("config", group, next, source);
    };
    routeFields[group][key] = input;
    wrap.append(el("span", "st-label", label), input, list, el("small", "", options.join(" / ")));
    p.append(wrap);
  }
  for (const [key, values] of Object.entries(schema.categories)) routeField(vendors, "data_vendors", key, categoryNames[key] || key, values);
  const toolRoutes = details(routing, "按单个工具覆盖数据源");
  for (const [key, values] of Object.entries(schema.tools)) routeField(toolRoutes, "tool_vendors", key, key, values);
  const news = details(routing, "新闻数量与宏观检索词");
  number(news, "news_article_limit", "标的新闻篇数");
  number(news, "global_news_article_limit", "全球新闻篇数");
  number(news, "global_news_lookback_days", "宏观新闻回看天数");
  field(news, "global_news_queries", "宏观新闻检索词（每行一条）", {kind: "list", wide: true});

  const keyList = card(keys, "服务凭证", "已有密钥仅显示配置状态。填写新值可替换密钥，保存后用于本机新任务。");
  const providersByKey = Object.fromEntries(Object.entries(schema.provider_keys).filter(([, k]) => k).map(([p, k]) => [k, providerNames[p] || p]));
  const activeKeys = new Set([base.value, quick.provider.value, deep.provider.value].map(p => schema.provider_keys[p]));
  const ordered = Object.keys(credentials).sort((a, b) => Number(activeKeys.has(b)) - Number(activeKeys.has(a)) || Number(credentials[b]) - Number(credentials[a]) || a.localeCompare(b));
  for (const k of ordered) {
    const wrapper = el("div", "st-field");
    const label = el("label", "st-label", providersByKey[k] || otherKeys[k] || k);
    const input = el("input");
    input.id = "st-secret-" + k;
    label.htmlFor = input.id;
    input.type = "password";
    input.autocomplete = "new-password";
    input.placeholder = credentials[k] ? "已配置 · 输入新值可替换" : "输入密钥";
    creds.set(k, input);
    const line = el("div","st-key-line");
    line.append(input);
    const clear = el("button", "st-remove", "清除");
    clear.type = "button";
    clear.setAttribute("aria-label", "清除 " + label.textContent + " 密钥");
    if (credentials[k]) line.append(clear);
    clear.onclick = () => {
      if (changes.credentials[k] === "") {
        input.placeholder = "已配置 · 输入新值可替换";
        mark("credentials", k, undefined, undefined);
        clear.textContent = "清除";
      } else {
        input.value = "";
        input.placeholder = "保存后清除";
        mark("credentials", k, "", undefined);
        clear.textContent = "撤销";
      }
    };
    input.oninput = () => {
      clear.textContent = "清除";
      mark("credentials", k, input.value || undefined, undefined);
    };
    wrapper.append(label, line, el("small", "", k));
    keyList.append(wrapper);
  }
  const account = card(model, "ChatGPT 订阅", "使用本机登录状态访问订阅所提供的模型。");
  account.classList.add("st-account");
  buildAccount(account, async () => {
    const data = await request("/api/auth/models");
    const ids = data.models.map(m => Array.isArray(m) ? m[1] : m).filter(m => typeof m === "string");
    schema.models.chatgpt = {quick: ids, deep: ids};
    quick.suggest();
    deep.suggest();
    feedback.textContent = "已读取 " + ids.length + " 个订阅模型";
  });
  const advanced = details(keys, "服务连接与云平台参数");
  for (const k of Object.keys(environment)) field(advanced, k, envNames[k] || k, {
    group: "environment", kind: /URL$|ENDPOINT$/.test(k) ? "url" : "text", hint: k,
  });

  save.disabled = true;
  save.onclick = async () => {
    const invalid = fields.find(input => !input.validity.valid);
    if (invalid) {
      const tab = [...panels].find(([, p]) => p.contains(invalid));
      if (tab) activate(tab[0]);
      if (invalid.closest("details")) invalid.closest("details").open = true;
      invalid.reportValidity();
      return;
    }
    const current = [...panels].find(([, p]) => !p.hidden)?.[0];
    save.disabled = true;
    feedback.textContent = "正在保存…";
    root.inert = true;
    try {
      await request("/api/settings", "PUT", changes);
      if (!root.isConnected) return;
      await renderSettings(container);
      const fresh = container.querySelector(".ta-settings");
      [...fresh.querySelectorAll(".st-tab")].find(t => t.textContent === current)?.click();
      const notice = fresh.querySelector(".st-feedback");
      if (notice) notice.textContent = "已保存 · 下次运行生效";
      window.dispatchEvent(new Event("tradingagents:settings-saved"));
    } catch (error) {
      root.inert = false;
      feedback.classList.add("st-error");
      feedback.textContent = error.message;
      save.disabled = false;
    }
  };
  activate("模型服务");
}
