import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const configPath = path.resolve(__dirname, "../social/automation-config.json");
const dailyPostsPath = path.resolve(__dirname, "../social/daily-buffer-posts.json");
const statePath = path.resolve(__dirname, "../social/buffer-automation-state.json");
const bufferEndpoint = process.env.BUFFER_GRAPHQL_ENDPOINT || "https://api.buffer.com";

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

async function saveJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function normalizeBaseUrl(value) {
  return value.endsWith("/") ? value : `${value}/`;
}

function buildTrackedUrl(baseUrl, post) {
  const url = new URL(post.path.replace(/^\//, ""), normalizeBaseUrl(baseUrl));
  url.searchParams.set("utm_source", post.platform);
  url.searchParams.set("utm_medium", "social");
  url.searchParams.set("utm_campaign", post.campaign);
  return url.toString();
}

function shanghaiDateParts(date = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  });

  const parts = formatter.formatToParts(date).reduce((accumulator, part) => {
    if (part.type !== "literal") {
      accumulator[part.type] = part.value;
    }
    return accumulator;
  }, {});

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second)
  };
}

function toUtcIsoForShanghai(localTime, options = {}) {
  const [hours, minutes] = localTime.split(":").map(Number);
  const now = options.now || new Date();
  const parts = shanghaiDateParts(now);

  let scheduledUtc = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, hours - 8, minutes, 0));
  if (scheduledUtc.getTime() <= now.getTime() + 2 * 60 * 1000) {
    scheduledUtc = new Date(scheduledUtc.getTime() + 24 * 60 * 60 * 1000);
  }

  return scheduledUtc.toISOString();
}

async function bufferGraphqlRequest({ apiKey, query, variables = {} }) {
  const response = await fetch(bufferEndpoint, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ query, variables })
  });

  const bodyText = await response.text();
  let data = null;

  try {
    data = JSON.parse(bodyText);
  } catch {
    throw new Error(`Buffer GraphQL returned non-JSON response: ${bodyText}`);
  }

  if (!response.ok || data.errors?.length) {
    throw new Error(`Buffer GraphQL error ${response.status}: ${bodyText}`);
  }

  return data.data;
}

async function fetchBufferChannels(apiKey) {
  const query = `
    query ListChannels {
      account {
        organizations {
          id
          name
          channels {
            id
            name
            service
          }
        }
      }
    }
  `;

  const data = await bufferGraphqlRequest({ apiKey, query });
  const organizations = data?.account?.organizations || [];

  return organizations.flatMap((organization) =>
    (organization.channels || []).map((channel) => ({
      organizationId: organization.id,
      organizationName: organization.name,
      ...channel
    }))
  );
}

function resolveChannelIds(channels) {
  const xChannel = channels.find((channel) => ["twitter", "x"].includes((channel.service || "").toLowerCase()));
  const linkedinChannel = channels.find((channel) => ["linkedin", "linkedinpage", "linkedin_company_page"].includes((channel.service || "").toLowerCase()));

  if (!xChannel) {
    throw new Error("Could not find an X channel in Buffer");
  }

  if (!linkedinChannel) {
    throw new Error("Could not find a LinkedIn channel in Buffer");
  }

  return {
    x: xChannel.id,
    linkedin: linkedinChannel.id,
    raw: channels
  };
}

async function createBufferPost({ apiKey, channelId, text, scheduledAt, shareNow }) {
  const mutation = `
    mutation CreatePost($input: CreatePostInput!) {
      createPost(input: $input) {
        __typename
        ... on PostActionSuccess {
          post {
            id
            status
            dueAt
          }
        }
        ... on InvalidInputError {
          message
        }
        ... on LimitReachedError {
          message
        }
        ... on UnauthorizedError {
          message
        }
        ... on NotFoundError {
          message
        }
        ... on UnexpectedError {
          message
        }
        ... on RestProxyError {
          message
        }
      }
    }
  `;

  const variables = {
    input: {
      channelId,
      text,
      schedulingType: "automatic",
      mode: shareNow ? "shareNow" : "customScheduled",
      ...(shareNow ? {} : { dueAt: scheduledAt })
    }
  };

  const data = await bufferGraphqlRequest({ apiKey, query: mutation, variables });
  const payload = data?.createPost;

  if (!payload) {
    throw new Error("Buffer createPost mutation returned an empty payload");
  }

  if (payload.__typename !== "PostActionSuccess") {
    throw new Error(`Buffer createPost failed with ${payload.__typename}: ${payload.message || "Unknown error"}`);
  }

  return payload.post || null;
}

function slicePosts(posts) {
  const limit = Number(process.env.BUFFER_POST_LIMIT || posts.length);
  if (!Number.isFinite(limit) || limit <= 0) {
    return posts;
  }
  return posts.slice(0, limit);
}

async function main() {
  const apiKey = requireEnv("BUFFER_API_KEY");
  const config = await loadJson(configPath);
  const daily = await loadJson(dailyPostsPath);
  const state = await loadJson(statePath);
  const baseUrl = config.brand.baseUrl;
  const dryRun = String(process.env.DRY_RUN || "false") === "true";
  const shareNow = String(process.env.POST_MODE || "scheduled_batch") === "share_now";

  const selectedPosts = slicePosts(daily.posts || []);
  if (selectedPosts.length === 0) {
    throw new Error("No generated posts found in social/daily-buffer-posts.json");
  }

  const channels = await fetchBufferChannels(apiKey);
  const resolved = resolveChannelIds(channels);
  const results = [];

  for (const post of selectedPosts) {
    const channelId = resolved[post.platform];
    const trackedUrl = buildTrackedUrl(baseUrl, post);
    const finalText = `${post.copy.trim()}\n\n${trackedUrl}`;
    const scheduledAt = shareNow ? null : toUtcIsoForShanghai(post.localTime);

    if (dryRun) {
      results.push({
        mode: "dry-run",
        platform: post.platform,
        postId: post.id,
        channelId,
        scheduledAt,
        shareNow,
        text: finalText
      });
      continue;
    }

    const createdPost = await createBufferPost({
      apiKey,
      channelId,
      text: finalText,
      scheduledAt,
      shareNow
    });

    results.push({
      platform: post.platform,
      postId: post.id,
      channelId,
      scheduledAt,
      bufferPostId: createdPost?.id || null,
      status: createdPost?.status || null
    });
  }

  const historyEntries = selectedPosts.map((post, index) => ({
    date: new Date().toISOString().slice(0, 10),
    postId: post.id,
    platform: post.platform,
    topicBucket: post.topicBucket,
    path: post.path,
    angle: post.angle,
    copy: post.copy,
    sourceTitles: post.sourceTitles || [],
    result: results[index] || null
  }));

  state.lastGeneratedDate = new Date().toISOString().slice(0, 10);
  state.history = [...historyEntries, ...(state.history || [])].slice(0, 120);
  await saveJson(statePath, state);

  console.log(JSON.stringify({
    selectedChannels: {
      x: resolved.x,
      linkedin: resolved.linkedin
    },
    results
  }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
