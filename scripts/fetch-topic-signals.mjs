import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const outputPath = path.resolve(__dirname, "../social/topic-signals.json");

const feeds = [
  {
    bucket: "cross-border-payments",
    label: "Cross-border payments",
    url: "https://blog.google/products/google-pay/rss/"
  },
  {
    bucket: "ad-spend",
    label: "Ad spend and paid media",
    url: "https://blog.google/products/ads-commerce/rss/"
  },
  {
    bucket: "ai-subscriptions",
    label: "AI subscriptions",
    url: "https://openai.com/news/rss.xml"
  }
];

function decodeXml(text) {
  return text
    .replace(/<!\[CDATA\[(.*?)\]\]>/gs, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'");
}

function stripHtml(text) {
  return decodeXml(text).replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

function extractTag(block, tag) {
  const match = block.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? stripHtml(match[1]) : "";
}

function parseItems(xml) {
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].map((match) => match[1]);
  return items.map((item) => {
    const title = extractTag(item, "title");
    const link = extractTag(item, "link");
    const pubDate = extractTag(item, "pubDate");
    const sourceMatch = item.match(/<source[^>]*>([\s\S]*?)<\/source>/i);
    const source = sourceMatch ? stripHtml(sourceMatch[1]) : "";
    return { title, link, pubDate, source };
  });
}

async function fetchBucket(feed) {
  const response = await fetch(feed.url, {
    headers: {
      "User-Agent": "RichXPay-Automation/1.0"
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch RSS for ${feed.bucket}: ${response.status}`);
  }

  const xml = await response.text();
  const items = parseItems(xml).filter((item) => item.title && item.link).slice(0, 5);

  return {
    bucket: feed.bucket,
    label: feed.label,
    url: feed.url,
    items
  };
}

async function main() {
  const buckets = [];

  for (const feed of feeds) {
    buckets.push(await fetchBucket(feed));
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    buckets
  };

  await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(payload, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

