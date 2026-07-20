import type { Bindings } from "../src/lib/types";

declare global {
  namespace Cloudflare {
    // Cloudflare's test environment uses global Env augmentation for bindings.
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface Env extends Bindings {}
  }
}
