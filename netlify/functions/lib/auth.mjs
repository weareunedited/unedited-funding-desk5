import { getUser } from '@netlify/identity';
import { fail } from './respond.mjs';

const ROLES = ['owner','editor','contributor'];
export async function user(required = true, allowed = ROLES) {
  let identityUser = await getUser();
  if (!identityUser && process.env.CONTEXT === 'dev' && process.env.DEV_AUTH_BYPASS === 'true') {
    identityUser = { email: process.env.DEV_USER_EMAIL || 'local@example.com', roles: [process.env.DEV_USER_ROLE || 'owner'] };
  }
  if (!identityUser) { if (required) fail('Please sign in to Funding Desk.', 401, 'AUTH_REQUIRED'); return null; }
  const role = ROLES.find((entry) => identityUser.roles?.includes(entry));
  if (!role || !allowed.includes(role)) fail('Your role does not allow this action.', 403, 'FORBIDDEN');
  return { email: identityUser.email.toLowerCase(), role, name: identityUser.name || identityUser.email };
}
