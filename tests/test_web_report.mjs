import assert from "node:assert/strict";
import test from "node:test";
import {parseReport, decisionExcerpts} from "../tradingagents/web/static/report.js";

test("only the final team determines the PM excerpts, report rating precedes proposal",()=>{
  const md = [
    "# Trading Analysis Report: ABC","- Rating: Overweight","## I. Analyst Team Reports",
    "### Market Analyst", "First line", "## Market outlook", "### Counterpoint",
    "~~~","## V. Portfolio Manager Decision","### Portfolio Manager","**Rating**: Sell","~~~",
    "## III. Trading Team Plan","### Trader","**Action**: Sell",
    "## V. Portfolio Manager Decision","### Portfolio Manager","**Rating**: Overweight",
    "**Executive Summary**  ","方向偏多。已有仓位者不追高。若红线触发则回撤。",
    "**Investment Thesis**: 研究依据。","**Price Target**: not provided",
    "FINAL TRANSACTION PROPOSAL: **BUY**",
  ].join("\r\n");
  const parsed = parseReport(md);
  assert.deepEqual(parsed.teams.map(t=>t.agents.length),[1,1,1]);
  assert.equal(parsed.rating,"Overweight");
  assert.equal(parsed.fields.thesis,"研究依据。");
  assert.equal(parsed.fields.target,"not provided");
  assert.equal(parsed.fields.proposal,"BUY");
  assert.deepEqual(decisionExcerpts(parsed.fields), {
    lead:"方向偏多。", action:"已有仓位者不追高。", risk:"若红线触发则回撤。",
  });
});

test("supports English same-line fields and Chinese mixed action/risk sentences",()=>{
  const pm = parseReport("## V. Portfolio Manager Decision\n### Portfolio Manager\n**Rating**: Hold\n**Executive Summary**: Hold. Keep position size below 2.5%. Reassess the risk if credit deteriorates.\n**Investment Thesis**: Mixed evidence.\n**Time Horizon**: 3 months");
  assert.equal(pm.rating, "Hold");
  assert.equal(pm.fields.horizon,"3 months");
  assert.deepEqual(decisionExcerpts(pm.fields),{lead:"Keep position size below 2.5%.",action:"",risk:"Reassess the risk if credit deteriorates."});
  assert.deepEqual(decisionExcerpts({summary:"对 INTC 的最终交易决策是 Hold。空仓者保持零仓位。价格缺失，无法衡量仓位的风险回报。"}), {
    lead:"空仓者保持零仓位。", action:"", risk:"价格缺失，无法衡量仓位的风险回报。",
  });
  assert.deepEqual(decisionExcerpts({summary:"维持评级。持有者控制仓位与风险。价格数据缺失，无法计算止损。"}), {
    lead:"维持评级。", action:"持有者控制仓位与风险。", risk:"价格数据缺失，无法计算止损。",
  });
});

test("fallback text and missing manager preserve source without invented recommendations",()=>{
  const doc = "# Old report\n\nSome buy-side analysts expect expansion.";
  const parsed = parseReport(doc);
  assert.equal(parsed.teams.length,0);
  assert.equal(parsed.header,doc);
  assert.equal(parsed.rating,"");
  assert.deepEqual(decisionExcerpts(parsed.fields),{lead:"", action:"", risk:""});
  const partial = parseReport("## I. Analyst Team Reports\n### Market Analyst\n**Rating**: Buy");
  assert.equal(partial.rating, "");
  assert.equal(partial.pm,undefined);
});

test("explicit review rating stays intact when proposal or body says Buy",()=>{
  const report = parseReport("- Rating: REVIEW\n## V. Portfolio Manager Decision\n### Portfolio Manager\n**Rating**: Buy\nFINAL TRANSACTION PROPOSAL: **BUY**");
  assert.equal(report.rating,"REVIEW");
});
