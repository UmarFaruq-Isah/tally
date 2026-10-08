// Imported FIRST by every test file: ES module imports are hoisted, so env vars must be set in a module, not inline.
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
process.env.GOOGLE_CLIENT_ID = 'test-client-id';
process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
process.env.SESSION_SECRET = 'test-secret';
process.env.BASE_URL = 'https://tally.example.com';
