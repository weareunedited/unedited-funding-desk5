import crypto from 'node:crypto';
import { getStore } from '@netlify/blobs';
import { login, logout, verifyRequestOrigin } from '@netlify/identity';
import { user } from './lib/auth.mjs';
import { rows, audited } from './lib/data.mjs';
import { send, problem, fail, text, uuid } from './lib/respond.mjs';
import { researchFunding, assignmentAlert, calendarHook } from './lib/integrations.mjs';
import { makeDocx, makePdf } from './lib/exports.mjs';

const OPPORTUNITY_FIELDS = new Set(['funder_name','programme_name','url','summary','deadline','amount_min','amount_max','status','score_breakdown','owner_email','research_notes','citations','last_checked_at']);
const PROJECT_FIELDS = new Set(['name','description','beneficiaries','geography','budget_total','outcomes']);
const EVIDENCE_FIELDS = new Set(['title','evidence_type','content','source_url','occurred_on','tags']);
const allowedStatus = new Set(['researching','review','go','no_go','drafting','submitted','won','lost']);
const pick = (source, fields) => Object.fromEntries(Object.entries(source).filter(([key, value]) => fields.has(key) && value !== undefined));
const json = async (request) => { try { return await request.json(); } catch { fail('Request body must be valid JSON.'); } };

function pathParts(request) {
  const pathname = new URL(request.url).pathname.replace(/^\/\.netlify\/functions\/api\/?/, '').replace(/^\/api\/?/, '');
  return pathname.split('/').filter(Boolean);
}

async function dashboard() {
  const [opportunities, projects, evidence, files, assignments, activity] = await Promise.all([
    rows('SELECT * FROM opportunities ORDER BY deadline ASC NULLS LAST, updated_at DESC LIMIT 150'),
    rows('SELECT * FROM projects ORDER BY updated_at DESC LIMIT 100'),
    rows('SELECT * FROM evidence ORDER BY updated_at DESC LIMIT 100'),
    rows('SELECT * FROM files ORDER BY created_at DESC LIMIT 100'),
    rows('SELECT a.*,o.programme_name FROM assignments a JOIN opportunities o ON o.id=a.opportunity_id ORDER BY a.completed_at NULLS FIRST,a.due_at ASC NULLS LAST LIMIT 150'),
    rows('SELECT id,actor_email,actor_role,action,entity_type,entity_id,created_at FROM audit_log ORDER BY created_at DESC LIMIT 100'),
  ]);
  return { opportunities, projects, evidence, files, assignments, activity };
}

async function createRecord(kind, body, actor, requestId) {
  const defs = {
    opportunities: { table: 'opportunities', fields: OPPORTUNITY_FIELDS, required: ['funder_name','programme_name'] },
    projects: { table: 'projects', fields: PROJECT_FIELDS, required: ['name'] },
    evidence: { table: 'evidence', fields: EVIDENCE_FIELDS, required: ['title'] },
  };
  const def = defs[kind]; if (!def) fail('Unknown record type.', 404, 'NOT_FOUND'); def.required.forEach((key) => text(body[key], key));
  const data = pick(body, def.fields); const keys = [...Object.keys(data), 'created_by']; const values = [...Object.values(data), actor.email];
  return audited({ actor, action: 'create', entityType: kind, entityId: 'new', after: data, requestId }, async (client) => (await client.query(`INSERT INTO ${def.table}(${keys.join(',')}) VALUES(${keys.map((_, i) => `$${i + 1}`).join(',')}) RETURNING *`, values)).rows[0]);
}

async function updateOpportunity(id, body, actor, requestId) {
  id = uuid(id); const before = (await rows('SELECT * FROM opportunities WHERE id=$1', [id]))[0]; if (!before) fail('Opportunity not found.', 404, 'NOT_FOUND');
  const data = pick(body, OPPORTUNITY_FIELDS); if (data.status && !allowedStatus.has(data.status)) fail('Invalid workflow status.');
  if (actor.role === 'contributor' && ['status','score_breakdown','owner_email'].some((key) => key in data)) fail('Contributors cannot change decisions, scores or ownership.', 403, 'FORBIDDEN');
  if (data.score_breakdown) { const keys = ['strategic_fit','eligibility','evidence','capacity','return']; data.score_breakdown = Object.fromEntries(keys.map((key) => [key, Math.max(0, Math.min(20, Number(data.score_breakdown[key]) || 0))])); data.score = Object.values(data.score_breakdown).reduce((sum, value) => sum + value, 0); }
  if (!Object.keys(data).length) fail('No editable fields supplied.'); const keys = Object.keys(data);
  return audited({ actor, action: 'update', entityType: 'opportunity', entityId: id, before, after: data, requestId }, async (client) => (await client.query(`UPDATE opportunities SET ${keys.map((key, i) => `${key}=$${i + 1}`).join(',')},updated_at=now() WHERE id=$${keys.length + 1} RETURNING *`, [...Object.values(data), id])).rows[0]);
}

export default async (request) => {
  const requestId = crypto.randomUUID(); const parts = pathParts(request); const route = parts.join('/');
  try {
    if (request.method === 'GET' && route === 'health') return send({ ok: true, version: '6.0.0', database: Boolean(process.env.NETLIFY_DB_URL), identity: true, research: Boolean(process.env.OPENAI_API_KEY), email: Boolean(process.env.RESEND_API_KEY && process.env.ALERT_FROM_EMAIL), calendar: Boolean(process.env.GOOGLE_CALENDAR_WEBHOOK_URL && process.env.CALENDAR_WEBHOOK_SECRET) });
    if (request.method === 'POST' && route === 'auth/login') { verifyRequestOrigin(request); const body = await json(request); await login(text(body.email, 'email', 320), text(body.password, 'password', 300)); return send({ ok: true }); }
    if (request.method === 'POST' && route === 'auth/logout') { verifyRequestOrigin(request); await logout(); return send({ ok: true }); }
    const actor = await user();
    if (request.method === 'GET' && route === 'me') return send({ user: actor });
    if (request.method === 'GET' && route === 'dashboard') return send(await dashboard());
    if (request.method === 'POST' && ['opportunities','projects','evidence'].includes(route)) return send(await createRecord(route, await json(request), actor, requestId), 201);
    if (request.method === 'PATCH' && parts[0] === 'opportunities' && parts.length === 2) { const body = await json(request); const record = await updateOpportunity(parts[1], body, actor, requestId); const calendar = 'deadline' in body ? await calendarHook(record) : { synced: false }; return send({ record, calendar }); }
    if (request.method === 'POST' && route === 'research') { const body = await json(request); const result = await researchFunding(text(body.question, 'question', 1200)); if (body.opportunityId) await updateOpportunity(body.opportunityId, { research_notes: result.answer, citations: result.citations, last_checked_at: result.lastCheckedAt }, actor, requestId); return send(result); }
    if (request.method === 'POST' && route === 'assignments') { const body = await json(request); uuid(body.opportunity_id); const assignment = await audited({ actor, action: 'assign', entityType: 'opportunity', entityId: body.opportunity_id, after: body, requestId }, async (client) => (await client.query('INSERT INTO assignments(opportunity_id,assignee_email,task,due_at,created_by) VALUES($1,$2,$3,$4,$5) RETURNING *', [body.opportunity_id,text(body.assignee_email,'assignee_email',320).toLowerCase(),text(body.task,'task'),body.due_at || null,actor.email])).rows[0]); const email = await assignmentAlert(assignment); return send({ assignment, email }, 201); }
    if (request.method === 'POST' && route === 'files') { const body = await json(request); const binary = Buffer.from(text(body.base64,'file data',5_900_000),'base64'); if (binary.length > 4_300_000) fail('Files must be 4 MB or smaller.',413,'FILE_TOO_LARGE'); const filename=text(body.filename,'filename',200); const category=text(body.category,'category',30); if(!['guidance','budget','evidence','application','other'].includes(category))fail('Invalid file category.'); const key=`${crypto.randomUUID()}-${filename.replace(/[^\w.-]/g,'_')}`; await getStore('funding-files').set(key,binary,{metadata:{filename,contentType:body.contentType||'application/octet-stream',uploadedBy:actor.email}}); const record=await audited({actor,action:'upload',entityType:'file',entityId:key,after:{filename,category},requestId},async(client)=>(await client.query('INSERT INTO files(blob_key,filename,content_type,size_bytes,category,linked_type,linked_id,uploaded_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',[key,filename,body.contentType||'application/octet-stream',binary.length,category,body.linkedType||null,body.linkedId||null,actor.email])).rows[0]); return send(record,201); }
    if (request.method === 'GET' && parts[0] === 'files' && parts.length === 2) { const file=(await rows('SELECT * FROM files WHERE id=$1',[uuid(parts[1])]))[0];if(!file)fail('File not found.',404,'NOT_FOUND');const blob=await getStore('funding-files').get(file.blob_key,{type:'arrayBuffer'});if(!blob)fail('Stored file is missing.',404,'NOT_FOUND');return new Response(blob,{headers:{'content-type':file.content_type,'content-disposition':`attachment; filename="${file.filename.replace(/["\r\n]/g,'')}"`}}); }
    if (request.method === 'GET' && parts[0] === 'export' && parts.length === 3) { const opportunity=(await rows('SELECT * FROM opportunities WHERE id=$1',[uuid(parts[1])]))[0];if(!opportunity)fail('Opportunity not found.',404,'NOT_FOUND');const isDocx=parts[2]==='docx';if(!isDocx&&parts[2]!=='pdf')fail('Export format must be docx or pdf.');const bytes=isDocx?await makeDocx(opportunity):await makePdf(opportunity);return new Response(bytes,{headers:{'content-type':isDocx?'application/vnd.openxmlformats-officedocument.wordprocessingml.document':'application/pdf','content-disposition':`attachment; filename="${opportunity.programme_name.replace(/[^\w -]/g,'').slice(0,60)}.${parts[2]}"`}}); }
    fail('API route not found.', 404, 'NOT_FOUND');
  } catch (error) { console.error(JSON.stringify({ requestId, route, message: error.message, code: error.code })); return problem(error, requestId); }
};

export const config = { path: ['/api/*'] };
