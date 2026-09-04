import { rows, audited } from './lib/data.mjs';
import { researchFunding } from './lib/integrations.mjs';
import { uuid } from './lib/respond.mjs';

// Background function: Netlify answers the caller with 202 immediately and lets this run for up to 15 minutes,
// which is what live web research needs. Synchronous functions time out after roughly 10 seconds (HTTP 504).
// It only ever processes a job that the authenticated API has already queued, and a job runs once.
export default async (request) => {
  let jobId;
  try { ({ jobId } = await request.json()); uuid(jobId); } catch { return new Response(null, { status: 202 }); }
  const claimed = await rows("UPDATE research_jobs SET status='running', started_at=now() WHERE id=$1 AND status='queued' RETURNING *", [jobId]);
  const job = claimed[0];
  if (!job) return new Response(null, { status: 202 });
  try {
    const result = await researchFunding(job.question);
    await rows("UPDATE research_jobs SET status='done', answer=$2, citations=$3, model=$4, finished_at=now() WHERE id=$1", [jobId, result.answer, JSON.stringify(result.citations), result.model]);
    if (job.opportunity_id) {
      const actor = { email: job.created_by, role: job.created_role };
      const data = { research_notes: result.answer, citations: JSON.stringify(result.citations), last_checked_at: result.lastCheckedAt };
      await audited({ actor, action: 'research', entityType: 'opportunity', entityId: job.opportunity_id, after: { research_job: jobId }, requestId: jobId }, async (client) => (await client.query('UPDATE opportunities SET research_notes=$1, citations=$2, last_checked_at=$3, updated_at=now() WHERE id=$4 RETURNING id', [data.research_notes, data.citations, data.last_checked_at, job.opportunity_id])).rows[0]);
    }
  } catch (error) {
    console.error(JSON.stringify({ jobId, message: error.message, code: error.code }));
    const message = error.code === 'CONFIG_ERROR' || error.code === 'PROVIDER_ERROR' ? error.message : 'Research could not be completed. Please try again.';
    await rows("UPDATE research_jobs SET status='failed', error=$2, finished_at=now() WHERE id=$1", [jobId, message]);
  }
  return new Response(null, { status: 202 });
};

export const config = { background: true };
