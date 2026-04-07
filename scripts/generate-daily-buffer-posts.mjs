import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const configPath = path.resolve(__dirname, "../social/automation-config.json");
const promptPath = path.resolve(__dirname, "../social/gemini-prompt.md");
const signalsPath = path.resolve(__dirname, "../social/topic-signals.json");
const statePath = path.resolve(__dirname, "../social/buffer-automation-state.json");
const outputPath = path.resolve(__dirname, "../social/daily-buffer-posts.json");

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

async function loadJson(filePath) {
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw);
}

function extractTextFromGeminiResponse(data) {
  const parts = data?.candidates?.[0]?.content?.parts || [];
  const text = parts.map((part) => part.text || "").join("\n").trim();
  if (!text) {
    throw new Error("Gemini response did not contain text output");
  }
  return text;
}

function parseJsonBlock(text) {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return JSON.parse(trimmed);
  }

  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first === -1 || last === -1 || last <= first) {
    throw new Error(`Gemini response did not contain JSON: ${text}`);
  }

  return JSON.parse(trimmed.slice(first, last + 1));
}

function recentHistory(state) {
  return (state.history || []).slice(0, 20);
}

function compactSignals(signals) {
  return signals.buckets.map((bucket) => ({
    bucket: bucket.bucket,
    items: bucket.items.slice(0, 3).map((item) => ({
      title: item.title,
      source: item.source,
      pubDate: item.pubDate,
      link: item.link
    }))
  }));
}

function pickLandingPage(config, bucket, offset) {
  const pages = config.landingPages.filter((page) => page.buckets.includes(bucket));
  if (pages.length === 0) {
    throw new Error(`No landing pages configured for bucket: ${bucket}`);
  }
  return pages[offset % pages.length];
}

function pickBucketAngle(config, bucket, offset) {
  const strategy = config.bucketStrategy[bucket];
  if (!strategy) {
    throw new Error(`No bucket strategy configured for: ${bucket}`);
  }

  return {
    angle: strategy.angles[offset % strategy.angles.length],
    hook: strategy.hooks[offset % strategy.hooks.length]
  };
}

function maxCharsForPlatform(config, platform) {
  const strategy = config.platformStrategy[platform];
  if (!strategy) {
    throw new Error(`No platform strategy configured for: ${platform}`);
  }
  return strategy.maxCharsBeforeUrl;
}

async function callGemini({ apiKey, model, userPrompt }) {
  const endpoint = process.env.GEMINI_API_ENDPOINT || `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const payload = {
    contents: [
      {
        parts: [
          {
            text: userPrompt
          }
        ]
      }
    ],
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 900,
      responseMimeType: "application/json"
    }
  };

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "x-goog-api-key": apiKey,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const bodyText = await response.text();
  let data = null;

  try {
    data = JSON.parse(bodyText);
  } catch {
    throw new Error(`Gemini API returned non-JSON response: ${bodyText}`);
  }

  if (!response.ok) {
    throw new Error(`Gemini API error ${response.status}: ${bodyText}`);
  }

  return data;
}

async function generateStructuredJson({ apiKey, model, userPrompt }) {
  let lastError = null;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const data = await callGemini({ apiKey, model, userPrompt });
      const rawText = extractTextFromGeminiResponse(data);
      return parseJsonBlock(rawText);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("Gemini generation failed");
}

function validateGeneratedPost(post, platform, maxChars) {
  if (!post.copy || typeof post.copy !== "string") {
    throw new Error("Generated post is missing copy");
  }
  if (post.copy.length > maxChars) {
    throw new Error(`Generated ${platform} copy is too long: ${post.copy.length} > ${maxChars}`);
  }
}

async function generateOnePost({ apiKey, model, promptTemplate, config, signals, state, slot, slotIndex }) {
  const history = recentHistory(state);
  const landingPage = pickLandingPage(config, slot.bucket, history.length + slotIndex);
  const selectedAngle = pickBucketAngle(config, slot.bucket, history.length + slotIndex);
  const maxChars = maxCharsForPlatform(config, slot.platform);

  const userPrompt = [
    promptTemplate.trim(),
    "",
    "Selected slot:",
    JSON.stringify(slot, null, 2),
    "",
    "Selected landing page:",
    JSON.stringify(landingPage, null, 2),
    "",
    "Selected angle and hook:",
    JSON.stringify(selectedAngle, null, 2),
    "",
    "Character limit before URL:",
    String(maxChars),
    "",
    "Recent signals:",
    JSON.stringify(compactSignals(signals), null, 2),
    "",
    "Recent publishing history:",
    JSON.stringify(history, null, 2)
  ].join("\n");

  const generated = await generateStructuredJson({ apiKey, model, userPrompt });
  validateGeneratedPost(generated, slot.platform, maxChars);

  return {
    id: `${slot.platform}-${slot.slot}-${Date.now()}-${slotIndex}`,
    platform: slot.platform,
    localTime: slot.localTime,
    topicBucket: slot.bucket,
    angle: generated.angle || selectedAngle.angle,
    hook: generated.hook || selectedAngle.hook,
    copy: generated.copy,
    sourceTitles: generated.sourceTitles || [],
    path: landingPage.path,
    landingTitle: landingPage.title,
    landingSummary: landingPage.summary,
    campaign: `${slot.platform}_${slot.bucket}_${new Date().toISOString().slice(0, 10)}_slot${slot.slot}`
  };
}

async function main() {
  const apiKey = requireEnv("GEMINI_API_KEY");
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";

  const config = await loadJson(configPath);
  const signals = await loadJson(signalsPath);
  const state = await loadJson(statePath);
  const promptTemplate = await readFile(promptPath, "utf8");

  const posts = [];
  for (let i = 0; i < config.dailyPlan.length; i += 1) {
    const slot = config.dailyPlan[i];
    const post = await generateOnePost({
      apiKey,
      model,
      promptTemplate,
      config,
      signals,
      state,
      slot,
      slotIndex: i
    });
    posts.push(post);
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    timezone: config.brand.timezone,
    posts
  };

  await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(payload, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
