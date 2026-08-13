import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const facts = JSON.parse(await readFile(path.join(root, "seo/site-facts.json"), "utf8"));
const errors = [];
const warnings = [];

function read(file) {
  return readFile(path.join(root, file), "utf8");
}

function firstMatch(html, expression) {
  return html.match(expression)?.[1]?.trim() || "";
}

function countMatches(html, expression) {
  return [...html.matchAll(expression)].length;
}

function decodeXml(value) {
  return value.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}

for (const page of facts.pages) {
  const file = page.path === "/" ? "index.html" : `${page.path.slice(1)}index.html`;
  const filePath = path.join(root, file);
  if (!existsSync(filePath)) {
    errors.push(`${file}: file is missing`);
    continue;
  }

  const html = await read(file);
  const title = firstMatch(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
  const description = firstMatch(html, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["'][^>]*>/i);
  const canonical = firstMatch(html, /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["'][^>]*>/i);
  const lang = firstMatch(html, /<html[^>]+lang=["']([^"']+)["']/i);
  const h1Count = countMatches(html, /<h1\b/gi);
  const ogTitle = firstMatch(html, /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']*)["'][^>]*>/i);
  const ogDescription = firstMatch(html, /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']*)["'][^>]*>/i);
  const ogUrl = firstMatch(html, /<meta[^>]+property=["']og:url["'][^>]+content=["']([^"']*)["'][^>]*>/i);
  const ogImage = firstMatch(html, /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']*)["'][^>]*>/i);
  const jsonLdBlocks = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];

  if (!title || title.length < 10 || title.length > 65) errors.push(`${file}: title must be 10-65 characters`);
  if (!description || description.length < 70 || description.length > 170) errors.push(`${file}: description must be 70-170 characters`);
  if (canonical !== pageUrl(page.path)) errors.push(`${file}: canonical must be ${pageUrl(page.path)}`);
  if (!lang) errors.push(`${file}: html lang is missing`);
  if (h1Count !== 1) errors.push(`${file}: expected exactly one h1, found ${h1Count}`);
  if (!ogTitle || ogTitle !== title) warnings.push(`${file}: og:title does not exactly match title`);
  if (!ogDescription) errors.push(`${file}: og:description is missing`);
  if (ogUrl !== pageUrl(page.path)) errors.push(`${file}: og:url must be ${pageUrl(page.path)}`);
  if (!ogImage) errors.push(`${file}: og:image is missing`);
  if (ogImage.startsWith(facts.baseUrl) && !existsSync(path.join(root, new URL(ogImage).pathname.slice(1)))) {
    errors.push(`${file}: og:image points to a missing local asset`);
  }
  if (countMatches(html, /<meta[^>]+name=["']robots["']/gi) === 0) warnings.push(`${file}: robots meta is missing`);

  for (const block of jsonLdBlocks) {
    try {
      JSON.parse(block[1]);
    } catch (error) {
      errors.push(`${file}: invalid JSON-LD (${error.message})`);
    }
  }
}

const sitemap = await read("sitemap.xml");
const sitemapUrls = [...sitemap.matchAll(/<loc>(.*?)<\/loc>/g)].map((match) => decodeXml(match[1]));
const expectedUrls = facts.pages.map((page) => pageUrl(page.path));
for (const url of expectedUrls) if (!sitemapUrls.includes(url)) errors.push(`sitemap.xml: missing ${url}`);
for (const url of sitemapUrls) if (!expectedUrls.includes(url)) warnings.push(`sitemap.xml: unexpected URL ${url}`);
if (sitemapUrls.length !== new Set(sitemapUrls).size) errors.push("sitemap.xml: duplicate URLs found");

const llms = await read("llms.txt");
if (!llms.startsWith(`# ${facts.siteName}`)) errors.push("llms.txt: site heading is missing");
for (const url of expectedUrls) if (!llms.includes(url)) errors.push(`llms.txt: missing key page ${url}`);

if (warnings.length) console.warn(`SEO warnings (${warnings.length}):\n- ${warnings.join("\n- ")}`);
if (errors.length) {
  console.error(`SEO audit failed (${errors.length} errors):\n- ${errors.join("\n- ")}`);
  process.exit(1);
}

console.log(`SEO audit passed for ${facts.pages.length} pages.`);

function pageUrl(pagePath) {
  return pagePath === "/" ? `${facts.baseUrl}/` : `${facts.baseUrl}${pagePath}`;
}
