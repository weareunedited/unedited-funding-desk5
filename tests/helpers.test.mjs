import test from 'node:test';
import assert from 'node:assert/strict';
import { text, uuid, problem } from '../netlify/functions/lib/respond.mjs';

test('required text is trimmed and bounded', () => { assert.equal(text('  hello  ', 'name'), 'hello'); assert.equal(text('abcdef', 'name', 3), 'abc'); });
test('invalid IDs are rejected before database access', () => { assert.throws(() => uuid('not-an-id'), /Invalid record ID/); });
test('valid IDs pass through unchanged', () => { const id = '025ccbab-3d59-45a4-91e8-b030630457b5'; assert.equal(uuid(id), id); });
test('provider errors expose a safe actionable message', async () => { const response = problem(Object.assign(new Error('Provider failed'), { status: 502, code: 'PROVIDER_ERROR' }), 'request-1'); assert.equal(response.status, 502); assert.equal((await response.json()).requestId, 'request-1'); });
test('unknown server errors do not leak details', async () => { const response = problem(new Error('password=secret'), 'request-2'); assert.equal((await response.json()).message, 'Funding Desk could not complete this request.'); });
