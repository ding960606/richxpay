import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const facts = JSON.parse(await readFile(path.join(root, "seo/site-facts.json"), "utf8"));
const signals = JSON.parse(await readFile(path.join(root, "social/topic-signals.json"), "utf8").catch(() => '{"buckets":[]}'));
const generatedAt = new Date().toISOString();

const templates = [
  {
    intent: "教育 / 比较",
    title: "USDT 充值虚拟卡怎么选：网络、费用、额度与商户兼容性检查清单",
    query: "USDT 充值虚拟卡",
    page: "/usdt-to-virtual-card/",
    faq: ["USDT 充值虚拟卡和普通虚拟卡有什么区别？", "充值前应该核对哪些网络和费用信息？", "为什么支付成功率不能被保证？"]
  },
  {
    intent: "问题解决",
    title: "ChatGPT Plus 虚拟卡支付失败：余额、账单资料与商户风控排查指南",
    query: "ChatGPT Plus 虚拟卡支付失败",
    page: "/chatgpt-plus-virtual-card/",
    faq: ["ChatGPT Plus 扣款失败应该先检查什么？", "账单地址为什么会影响支付？", "如何为多个订阅做预算隔离？"]
  },
  {
    intent: "场景指南",
    title: "Apple Pay 绑定虚拟卡前要检查什么：设备、地区、卡状态与钱包兼容",
    query: "Apple Pay 绑定虚拟卡",
    page: "/apple-pay-virtual-card/",
    faq: ["Apple Pay 绑定失败的常见原因是什么？", "设备和地区为什么会影响绑定？", "绑定后哪些支付场景仍可能受商户限制？"]
  },
  {
    intent: "商业 / 工具",
    title: "团队如何管理 SaaS 和广告支付：虚拟卡、预算隔离与失败排查",
    query: "SaaS 广告支付 虚拟卡",
    page: "/crypto-virtual-card/",
    faq: ["为什么团队要按用途拆分虚拟卡？", "广告账户支付需要关注哪些卡片信息？", "如何避免把支付成功率写成绝对承诺？"]
  }
];

function recentSignals() {
  return (signals.buckets || []).flatMap((bucket) => (bucket.items || []).slice(0, 2).map((item) => ({
    bucket: bucket.label || bucket.bucket,
    title: item.title,
    link: item.link
  })));
}

const signalRows = recentSignals();
const lines = [
  "# Weekly SEO/GEO content brief",
  "",
  `Generated: ${generatedAt}`,
  "",
  "> Review every product, pricing, compliance, availability, and payment-rail claim against the official product interface before publishing.",
  "",
  "## Publishing rules",
  "",
  "- Answer the query in the first paragraph with a qualified, source-backed explanation.",
  "- Use one clear H1, descriptive H2 sections, a short FAQ, and a visible last-reviewed date.",
  "- Link to the relevant product page and to the official product interface; do not use doorway pages or keyword stuffing.",
  "- Avoid guaranteed acceptance, guaranteed settlement times, invented fees, or unsupported regulatory claims.",
  "- Add FAQPage only when the exact questions and answers are visible on the published page.",
  "",
  "## Recommended briefs",
  ""
];

for (const [index, brief] of templates.entries()) {
  lines.push(`### ${index + 1}. ${brief.title}`);
  lines.push("");
  lines.push(`- Search intent: ${brief.intent}`);
  lines.push(`- Primary query: ${brief.query}`);
  lines.push(`- Suggested canonical page: ${facts.baseUrl}${brief.page}`);
  lines.push(`- Internal-link target: ${facts.baseUrl}${brief.page}`);
  lines.push("- Answer outline: define the workflow, state what varies by account/region/merchant, give a verification checklist, then explain the relevant RICHXPAY use case.");
  lines.push("- Suggested FAQ:");
  for (const question of brief.faq) lines.push(`  - ${question}`);
  lines.push("");
}

lines.push("## Current external signals to review");
lines.push("");
if (signalRows.length === 0) {
  lines.push("- No RSS signals were available during generation.");
} else {
  for (const signal of signalRows) lines.push(`- ${signal.bucket}: [${signal.title}](${signal.link})`);
}
lines.push("");

await writeFile(path.join(root, "seo/content-brief.md"), `${lines.join("\n")}\n`, "utf8");
console.log(`Generated ${templates.length} SEO/GEO content briefs.`);
