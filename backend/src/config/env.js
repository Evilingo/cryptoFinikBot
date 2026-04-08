const required = [
  'DATABASE_URL',
  'REDIS_URL',
  'JWT_SECRET',
  'JWT_REFRESH_SECRET',
  'ENCRYPTION_KEY',
  'ANTHROPIC_API_KEY',
  'ADMIN_USERNAME',
  'ADMIN_PASSWORD',
];

export function validateEnv() {
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required env variables: ${missing.join(', ')}`);
  }
}

export const env = {
  get port() { return parseInt(process.env.PORT || '3001', 10); },
  get nodeEnv() { return process.env.NODE_ENV || 'development'; },
  get allowedOrigin() { return process.env.ALLOWED_ORIGIN || 'http://localhost:5173'; },
  get jwtSecret() { return process.env.JWT_SECRET; },
  get jwtRefreshSecret() { return process.env.JWT_REFRESH_SECRET; },
  get encryptionKey() { return process.env.ENCRYPTION_KEY; },
  get databaseUrl() { return process.env.DATABASE_URL; },
  get redisUrl() { return process.env.REDIS_URL; },
  get anthropicApiKey() { return process.env.ANTHROPIC_API_KEY; },
  get adminUsername() { return process.env.ADMIN_USERNAME; },
  get adminPassword() { return process.env.ADMIN_PASSWORD; },
};
