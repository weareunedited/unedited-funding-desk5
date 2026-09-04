import { fail } from './respond.mjs';

export function requireConfig(names) {
  const missing = names.filter((name) => !process.env[name]?.trim());
  if (missing.length) fail(
    `Server setup is incomplete: ${missing.join(', ')}. Add the missing variable${missing.length > 1 ? 's' : ''} in Netlify, then redeploy.`,
    503,
    'CONFIG_ERROR',
    missing.map((name) => ({ name, action: 'Add it under Project configuration → Environment variables, then clear cache and deploy.' })),
  );
}

export function openAIConfig() {
  requireConfig(['OPENAI_API_KEY']);
  const key = process.env.OPENAI_API_KEY.trim();
  if (!key.startsWith('sk-') || key.length < 30) fail('OPENAI_API_KEY is malformed. Replace it in Netlify, then redeploy.', 503, 'CONFIG_ERROR');
  return { key, model: process.env.OPENAI_MODEL || 'gpt-5-mini' };
}
