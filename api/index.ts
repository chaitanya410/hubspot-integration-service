// Vercel serverless entrypoint. Vercel's Node.js runtime treats any
// exported (req, res) handler under /api as a serverless function - an
// Express app instance satisfies that signature directly, so we just
// construct and export the same app used by src/server.ts for local/Docker
// runs. No separate serverless-specific routing logic needed.
//
// Not used by `npm run dev` / `npm start` (see src/server.ts for those) -
// this file only matters when deployed on Vercel.
import { createApp } from "../src/expressApp";

const app = createApp();

export default app;
