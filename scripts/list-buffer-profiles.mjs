const endpoint = process.env.BUFFER_GRAPHQL_ENDPOINT || "https://api.buffer.com";
const apiKey = process.env.BUFFER_API_KEY;

if (!apiKey) {
  console.error("Missing required environment variable: BUFFER_API_KEY");
  process.exit(1);
}

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

const response = await fetch(endpoint, {
  method: "POST",
  headers: {
    "Authorization": `Bearer ${apiKey}`,
    "Content-Type": "application/json"
  },
  body: JSON.stringify({ query })
});

const text = await response.text();
let data = null;

try {
  data = JSON.parse(text);
} catch {
  console.error(`Buffer GraphQL returned non-JSON response: ${text}`);
  process.exit(1);
}

if (!response.ok || data.errors?.length) {
  console.error(`Buffer GraphQL error ${response.status}: ${text}`);
  process.exit(1);
}

const organizations = data?.data?.account?.organizations || [];
const channels = organizations.flatMap((organization) =>
  (organization.channels || []).map((channel) => ({
    organizationId: organization.id,
    organizationName: organization.name,
    ...channel
  }))
);

console.log(JSON.stringify({
  organizations,
  channels
}, null, 2));
