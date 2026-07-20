import { Hono } from "hono";
import { cors } from "hono/cors";
import type { App, Bindings } from "./lib/types";
import { cleanupRateLimits, cleanupRawObservations } from "./cron";
import { v2Contributors } from "./routes/v2-contributors";
import { v2Observations } from "./routes/v2-observations";
import { v2Contributor } from "./routes/v2-contributor";
import { v2Products } from "./routes/v2-products";
import { v2Snapshots } from "./routes/v2-snapshots";

const app = new Hono<App>();

function allowedOrigin(
  origin: string,
  allowedExtensionOrigins?: string,
): string {
  if (!origin) return "";
  const configured = new Set(
    (allowedExtensionOrigins ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
  if (configured.has(origin)) return origin;
  if (
    origin.startsWith("chrome-extension://") ||
    origin.startsWith("moz-extension://")
  ) {
    return origin;
  }
  return "";
}

app.use(
  "/api/*",
  cors({
    origin: (origin, c) =>
      allowedOrigin(origin, c.env.ALLOWED_EXTENSION_ORIGINS),
    allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
    allowHeaders: ["Authorization", "Content-Type", "If-None-Match"],
    exposeHeaders: ["ETag"],
  }),
);

// Global error handler
app.onError((err, c) => {
  console.error(err);
  return c.json(
    {
      error: "server_error",
      message: "An unexpected error occurred",
    },
    500,
  );
});

// Health check
app.get("/health", (c) => c.json({ status: "ok" }));

// Routes
app.all("/api/observations", (c) =>
  c.json(
    {
      error: "gone",
      message: "Unauthenticated v1 submissions are disabled; use /api/v2",
    },
    410,
  ),
);
app.all("/api/products", (c) =>
  c.json({ error: "gone", message: "The v1 API is retired; use /api/v2" }, 410),
);
app.all("/api/products/*", (c) =>
  c.json({ error: "gone", message: "The v1 API is retired; use /api/v2" }, 410),
);
app.all("/api/trends", (c) =>
  c.json({ error: "gone", message: "The v1 API is retired; use /api/v2" }, 410),
);
app.all("/api/contributor/*", (c) =>
  c.json(
    {
      error: "gone",
      message:
        "UUID-only deletion is disabled; use token-authenticated /api/v2",
    },
    410,
  ),
);
app.route("/api/v2/contributors", v2Contributors);
app.route("/api/v2/observations", v2Observations);
app.route("/api/v2/contributor", v2Contributor);
app.route("/api/v2/products", v2Products);
app.route("/api/v2/snapshots", v2Snapshots);

export default {
  fetch: app.fetch,
  scheduled: async (_controller, env) => {
    await Promise.all([
      cleanupRateLimits(env.DB),
      cleanupRawObservations(env.DB),
    ]);
  },
} satisfies ExportedHandler<Bindings>;
