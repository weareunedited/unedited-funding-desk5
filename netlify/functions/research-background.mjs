import { rows, audited } from './lib/data.mjs';
import { researchFunding } from './lib/integrations.mjs';
import { uuid } from './lib/respond.mjs';

// Background function: Netlify answers the caller with 202 immediately and lets this run for up to 15 minutes,
// which is what live web research needs. Synchronous functions time out after roughly 10 seconds (HTTP 504).
// It only ever processes a job that the authenticated API has already queued, and a job runs once.

const CONTACT_FIELDS = ['contact_name','contact_email','contact_phone','contact_url','contact_notes'];

function notesFor(item) {
  const lines = [item.summary, item.eligibility ? `Eligibility: ${item.eligibility}` : '', item.url ? `Programme page: ${item.url}` : ''];
  return lines.filter(Boolean).join('\n\n');
}

// Every programme the research identified becomes an opportunity. An existing record with the same funder and
// programme name is enriched rather than duplicated: blank fields are filled in, nothing a person typed is overwritten.
async function recordOpportunities(job, result) {
  const actor = { email: job.created_by, role: job.created_role };
  const created = []; const updated = [];
  for (const item of result.opportunities) {
    const existing = (await rows('SELECT * FROM opportunities WHERE lower(funder_name)=lower($1) AND lower(programme_name)=lower($2) ORDER BY created_at LIMIT 1', [item.funder_name, item.programme_name]))[0];
    const citations = JSON.stringify(result.citations);
    if (!existing) {
      const record = await audited({ actor, action: 'create', entityType: 'opportunities', entityId: 'new', after: { ...item, research_job: job.id }, requestId: job.id }, async (client) => (await client.query(
        'INSERT INTO opportunities(funder_name,programme_name,url,summary,eligibility,deadline,amount_min,amount_max,status,contact_name,contact_email,contact_phone,contact_url,contact_notes,research_notes,citations,last_checked_at,source_job,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING id,funder_name,programme_name',
        [item.funder_name, item.programme_name, item.url, item.summary, item.eligibility, item.deadline, item.amount_min, item.amount_max, 'researching', item.contact_name, item.contact_email, item.contact_phone, item.contact_url, item.contact_notes, notesFor(item), citations, result.lastCheckedAt, job.id, job.created_by],
      )).rows[0]);
      created.push(record);
      continue;
    }
    const patch = {};
    for (const field of ['url','summary','eligibility',...CONTACT_FIELDS]) if (!existing[field] && item[field]) patch[field] = item[field];
    if (!existing.deadline && item.deadline) patch.deadline = item.deadline;
    if (existing.amount_min == null && item.amount_min) patch.amount_min = item.amount_min;
    if (existing.amount_max == null && item.amount_max) patch.amount_max = item.amount_max;
    if (!existing.research_notes) patch.research_notes = notesFor(item);
    patch.citations = citations; patch.last_checked_at = result.lastCheckedAt;
    const keys = Object.keys(patch);
    await audited({ actor, action: 'research', entityType: 'opportunity', entityId: existing.id, before: existing, after: patch, requestId: job.id }, async (client) => (await client.query(`UPDATE opportunities SET ${keys.map((key, i) => `${key}=$${i + 1}`).join(',')},updated_at=now() WHERE id=$${keys.length + 1} RETURNING id`, [...Object.values(patch), existing.id])).rows[0]);
    updated.push({ id: existing.id, funder_name: existing.funder_name, programme_name: existing.programme_name });
  }
  return { created, updated };
}

export default async (request) => {
  let jobId;
  try { ({ jobId } = await request.json()); uuid(jobId); } catch { return new Response(null, { status: 202 }); }
  const claimed = await rows("UPDATE research_jobs SET status='running', started_at=now() WHERE id=$1 AND status='queued' RETURNING *", [jobId]);
  const job = claimed[0];
  if (!job) return new Response(null, { status: 202 });
  try {
    const result = await researchFunding(job.question);
    const actor = { email: job.created_by, role: job.created_role };
    if (job.opportunity_id) {
      // Research attached to a specific opportunity: save the narrative there, and fill in blank contact details if the
      // research found a programme from the same funder.
      const target = (await rows('SELECT * FROM opportunities WHERE id=$1', [job.opportunity_id]))[0];
      const match = target && result.opportunities.find((item) => item.funder_name.toLowerCase() === target.funder_name.toLowerCase()) || (result.opportunities.length === 1 ? result.opportunities[0] : null);
      const patch = { research_notes: result.answer, citations: JSON.stringify(result.citations), last_checked_at: result.lastCheckedAt };
      if (target && match) for (const field of ['url','eligibility',...CONTACT_FIELDS]) if (!target[field] && match[field]) patch[field] = match[field];
      const keys = Object.keys(patch);
      await audited({ actor, action: 'research', entityType: 'opportunity', entityId: job.opportunity_id, after: { research_job: jobId, ...patch }, requestId: jobId }, async (client) => (await client.query(`UPDATE opportunities SET ${keys.map((key, i) => `${key}=$${i + 1}`).join(',')},updated_at=now() WHERE id=$${keys.length + 1} RETURNING id`, [...Object.values(patch), job.opportunity_id])).rows[0]);
    }
    let created = []; let updated = [];
    try { ({ created, updated } = await recordOpportunities(job, result)); }
    catch (error) { console.error(JSON.stringify({ jobId, message: 'saving researched opportunities failed', detail: error.message })); }
    await rows("UPDATE research_jobs SET status='done', answer=$2, citations=$3, model=$4, created_opportunities=$5, updated_opportunities=$6, finished_at=now() WHERE id=$1", [jobId, result.answer, JSON.stringify(result.citations), result.model, JSON.stringify(created), JSON.stringify(updated)]);
  } catch (error) {
    console.error(JSON.stringify({ jobId, message: error.message, code: error.code }));
    const message = error.code === 'CONFIG_ERROR' || error.code === 'PROVIDER_ERROR' ? error.message : 'Research could not be completed. Please try again.';
    await rows("UPDATE research_jobs SET status='failed', error=$2, finished_at=now() WHERE id=$1", [jobId, message]);
  }
  return new Response(null, { status: 202 });
};

export const config = { background: true };
