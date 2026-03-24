import { Hono } from "hono";
import { cors } from "hono/cors";
import type { App } from "./lib/types";
import { contributor } from "./routes/contributor";
import { observations } from "./routes/observations";
import { products } from "./routes/products";
import { trends } from "./routes/trends";

const app = new Hono<App>();

// CORS — wildcard origin for browser extension compatibility
app.use(
  "/api/*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type"],
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
app.route("/api/observations", observations);
app.route("/api/products", products);
app.route("/api/trends", trends);
app.route("/api/contributor", contributor);

export default app;
