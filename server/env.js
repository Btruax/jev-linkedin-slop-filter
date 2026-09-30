import { readFileSync } from 'node:fs';

// The key lives in the repo-root .env (gitignored) or the environment.
export const loadApiKey = () => {
  if (process.env.TYPESAFE_API_KEY) return process.env.TYPESAFE_API_KEY;
  try {
    const env = readFileSync(new URL('../.env', import.meta.url), 'utf8');
    const match = env.match(/^TYPESAFE_API_KEY=(.*)$/m);
    if (match) return match[1].trim();
  } catch {
    // fall through to the explicit error below
  }
  throw new Error('TYPESAFE_API_KEY not found in environment or .env');
};
