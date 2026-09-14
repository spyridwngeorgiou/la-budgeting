import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// This app is fully dynamic (auth-gated Server Components + Server Actions,
// no static/ISR pages worth caching), so the default in-memory cache is
// enough -- no R2 bucket needed just to deploy.
export default defineCloudflareConfig();
