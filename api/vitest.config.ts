import { defineConfig } from 'vitest/config';
// ADMIN_TOTP_SECRET is set empty so a secret in the developer's .env (npm run ops:totp writes one) never
// switches MFA on in tests; .env files do not override variables that are already set. Tests that want
// MFA pass their own secret.
export default defineConfig({ test: { testTimeout: 30000, hookTimeout: 60000, fileParallelism: false, env: { ADMIN_TOTP_SECRET: '' } } });
