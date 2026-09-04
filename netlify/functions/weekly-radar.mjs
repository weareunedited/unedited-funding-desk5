import { rows } from './lib/data.mjs';
import { assignmentAlert } from './lib/integrations.mjs';

export default async () => {
  const recipients = (process.env.RADAR_RECIPIENTS || '').split(',').map((value) => value.trim()).filter(Boolean);
  if (!recipients.length) return Response.json({ skipped: true, reason: 'RADAR_RECIPIENTS is empty.' });
  const opportunities = await rows("SELECT funder_name,programme_name,deadline,score,status FROM opportunities WHERE status NOT IN ('no_go','submitted','won','lost') AND (deadline IS NULL OR deadline >= current_date) ORDER BY score DESC,deadline ASC NULLS LAST LIMIT 20");
  const task = `Weekly Funding Radar: ${opportunities.length} active opportunities. Top priorities: ${opportunities.slice(0,5).map((item)=>`${item.programme_name} (${item.score}/100)`).join(', ') || 'none'}`;
  const results = await Promise.all(recipients.map((assignee_email) => assignmentAlert({ assignee_email, task, due_at: new Date().toISOString().slice(0,10) })));
  return Response.json({ opportunities: opportunities.length, recipients: recipients.length, results });
};

export const config = { schedule: '0 8 * * 1' };
