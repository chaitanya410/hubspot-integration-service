// Runs before every test file. Provides fake-but-valid env vars so
// importing modules that transitively load src/config/env.ts (e.g. the
// logger) never crashes the test process - none of these values are
// used to make any real network/DB call in the unit tests themselves.
process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = "silent";
process.env.BASE_URL = "http://localhost:3000";
process.env.DATABASE_URL = "file:./test.db";
process.env.HUBSPOT_CLIENT_ID = "test-client-id";
process.env.HUBSPOT_CLIENT_SECRET = "test-client-secret";
process.env.HUBSPOT_REDIRECT_URI = "http://localhost:3000/auth/hubspot/callback";
