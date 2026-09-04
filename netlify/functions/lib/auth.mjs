import { getUser } from '@netlify/identity';
import { rows } from './data.mjs';
import { fail } from './respond.mjs';

const ROLES = ['owner','editor','contributor'];

// A role can come from either place: the Netlify Identity user's roles (set in the Netlify dashboard), or the
// members table seeded by the database migration. Identity wins when both are present.
async function resolveRole(identityUser, email) {
  const fromIdentity = ROLES.find((entry) => identityUser.roles?.includes(entry));
  if (fromIdentity) return fromIdentity;
  try {
    const member = (await rows('SELECT role FROM members WHERE lower(email)=$1 AND active', [email]))[0];
    if (member && ROLES.includes(member.role)) return member.role;
  } catch (error) { console.error(JSON.stringify({ message: 'members lookup failed', detail: error.message })); }
  return null;
}

export async function user(required = true, allowed = ROLES) {
  let identityUser = await getUser();
  if (!identityUser && process.env.CONTEXT === 'dev' && process.env.DEV_AUTH_BYPASS === 'true') {
    identityUser = { email: process.env.DEV_USER_EMAIL || 'local@example.com', roles: [process.env.DEV_USER_ROLE || 'owner'] };
  }
  if (!identityUser) { if (required) fail('Please sign in to Funding Desk.', 401, 'AUTH_REQUIRED'); return null; }
  const email = identityUser.email.toLowerCase();
  const role = await resolveRole(identityUser, email);
  if (!role) fail(`Your account (${email}) is signed in but has no Funding Desk role yet. An owner needs to add you as an owner, editor or contributor.`, 403, 'FORBIDDEN');
  if (!allowed.includes(role)) fail('Your role does not allow this action.', 403, 'FORBIDDEN');
  return { email, role, name: identityUser.name || identityUser.email };
}
