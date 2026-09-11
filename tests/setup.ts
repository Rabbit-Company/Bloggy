process.env.DATABASE_URL = "sqlite://:memory:";
process.env.STORAGE_DRIVER = "local";
process.env.STORAGE_PATH = "./data/test-media";

process.env.ENCRYPTION_KEY ??= "test-encryption-key-not-used-in-production";
process.env.ADMIN_TOKEN ??= "test-admin-token";
process.env.DOMAIN ??= "http://localhost:3000";
process.env.LOG_LEVEL ??= "0";
