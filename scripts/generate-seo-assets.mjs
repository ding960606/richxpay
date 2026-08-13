import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(__filename), "..");
const factsPath = path.join(root, "seo/site-facts.json");
const baseUrl = "https://www.richxpay.com";

const facts = JSON.parse(await readFile(factsPath, "utf8"));

function lastModified(filePath) {
  try {
    return execFileSync("git", ["log", "-1", "--format=%cs", "--", path.relative(root, filePath)], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim() || new Date().toISOString().slice(0, 10);
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function xmlEscape(value) {
  return value.replace(/[<>&'\"]/g, (character) => ({
    "<": "&lt;",
    ">": "&gt;",
    "&": "&amp;",
    "'": "&apos;",
    '"': "&quot;"
  }[character]));
}

function markdownEscape(value) {
  return value.replace(/\r?\n/g, " ").trim();
}

function pageUrl(pagePath) {
  return pagePath === "/" ? `${baseUrl}/` : `${baseUrl}${pagePath}`;
}

const pageEntries = facts.pages.map((page) => {
  const filePath = page.path === "/" ? path.join(root, "index.html") : path.join(root, page.path, "index.html");
  return { ...page, url: pageUrl(page.path), lastmod: lastModified(filePath) };
});

const sitemap = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  ...pageEntries.map((page) => [
    "  <url>",
    `    <loc>${xmlEscape(page.url)}</loc>`,
    `    <lastmod>${page.lastmod}</lastmod>`,
    "    <changefreq>weekly</changefreq>",
    `    <priority>${page.path === "/" ? "1.0" : "0.8"}</priority>`,
    "  </url>"
  ].join("\n")),
  "</urlset>",
  ""
].join("\n");

const llms = [
  `# ${facts.siteName}`,
  "",
  `> ${facts.description}`,
  "",
  "## Canonical source",
  "",
  `- Official website: ${baseUrl}/`,
  `- Product interface: ${facts.officialLinks.product}`,
  `- Support: ${facts.officialLinks.support}`,
  `- Sitemap: ${facts.officialLinks.sitemap}`,
  "",
  "## What this site covers",
  "",
  `- Positioning: ${facts.positioning}`,
  ...facts.audiences.map((audience) => `- Audience: ${audience}`),
  "",
  "## Stable product facts",
  "",
  ...facts.facts.map((fact) => `- ${fact}`),
  "",
  "## Important interpretation rules",
  "",
  ...facts.policies.map((policy) => `- ${policy}`),
  "",
  "## Key pages",
  "",
  ...pageEntries.map((page) => `- [${markdownEscape(page.title)}](${page.url}): ${markdownEscape(page.summary)}`),
  "",
  "## Brand aliases",
  "",
  `- ${facts.alternateNames.join("; ")}`,
  ""
].join("\n");

await writeFile(path.join(root, "sitemap.xml"), sitemap, "utf8");
await writeFile(path.join(root, "llms.txt"), llms, "utf8");

console.log(`Generated sitemap.xml (${pageEntries.length} URLs) and llms.txt.`);
