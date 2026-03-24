import type { Bindings } from "../src/lib/types";

declare module "cloudflare:test" {
  interface ProvidedEnv extends Bindings {}
}
