import { createServer } from "node:http";

function json(res, statusCode, payload) {
  res.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function normalizeQueryValue(value) {
  return (value ?? "").toString().trim() || "e2e-query";
}

const RFC3339_SECONDS_OR_MILLIS =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})$/;

export async function startFixtureServer() {
  const server = createServer((req, res) => {
    if (!req.url) {
      json(res, 400, { error: "missing url" });
      return;
    }

    const url = new URL(req.url, "http://127.0.0.1");
    const path = url.pathname;

    if (req.method !== "GET") {
      json(res, 405, { error: "method not allowed" });
      return;
    }

    if (path.startsWith("/2/users/by/username/")) {
      const username = decodeURIComponent(path.slice("/2/users/by/username/".length));
      json(res, 200, {
        data: {
          id: `user-${username}`,
          username,
        },
      });
      return;
    }

    if (path.startsWith("/2/users/") && path.endsWith("/tweets")) {
      const startTime = url.searchParams.get("start_time");
      if (startTime && !RFC3339_SECONDS_OR_MILLIS.test(startTime)) {
        json(res, 400, {
          errors: [
            {
              parameters: {
                start_time: [startTime],
                "Field Validation Errors": [
                  `The \`start_time\` query parameter value [${startTime}] is not a valid RFC3339 date-time, must follow pattern 'yyyy-MM-dd'T'HH:mm:ss[.SSS]X.'`,
                ],
              },
              message: `The \`start_time\` query parameter value [${startTime}] is not a valid RFC3339 date-time, must follow pattern 'yyyy-MM-dd'T'HH:mm:ss[.SSS]X.'`,
            },
          ],
          title: "Invalid Request",
          detail: "One or more parameters to your request was invalid.",
          type: "https://api.twitter.com/2/problems/invalid-request",
        });
        return;
      }

      const userId = decodeURIComponent(path.slice("/2/users/".length, -"/tweets".length));
      const username = userId.replace(/^user-/, "");
      json(res, 200, {
        data: [
          {
            id: `tweet-${userId}`,
            text: `timeline from ${username}`,
            created_at: "2026-04-05T10:00:00Z",
            author_id: userId,
          },
        ],
        includes: {
          users: [
            {
              id: userId,
              username,
            },
          ],
        },
      });
      return;
    }

    if (path === "/2/tweets/search/recent") {
      const query = normalizeQueryValue(url.searchParams.get("query"));
      const queryId = query.replace(/[^a-zA-Z0-9]+/g, "-").toLowerCase();
      json(res, 200, {
        data: [
          {
            id: `search-${queryId}`,
            text: `search result for ${query}`,
            created_at: "2026-04-05T11:00:00Z",
            author_id: "search-author",
          },
        ],
        includes: {
          users: [
            {
              id: "search-author",
              username: "fixture",
            },
          ],
        },
      });
      return;
    }

    json(res, 404, { error: `no fixture route for ${path}` });
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Fixture server did not expose a numeric localhost port");
  }

  const baseUrl = `http://127.0.0.1:${address.port}`;

  return {
    baseUrl,
    async close() {
      await new Promise((resolve, reject) => {
        server.close((err) => {
          if (err) {
            reject(err);
            return;
          }
          resolve();
        });
      });
    },
  };
}
