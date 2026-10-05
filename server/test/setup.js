// Must be imported first: points the app at the throw-away test database.
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://postgres@localhost:5432/explorer_test';
process.env.AUTH_DEV_LOGIN = 'true';
process.env.NODE_ENV = 'test';
process.env.STATIC_DIR = '/nonexistent';
