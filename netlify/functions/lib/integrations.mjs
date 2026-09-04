import crypto from 'node:crypto';
import { openAIConfig } from './config.mjs';
import { fail } from './respond.mjs';

const strip = (value) => String(value || '').replace(/[<>&]/g, '');

const RESEARCH_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    narrative: { type: 'string', description: 'The full research answer in plain prose for the reader: eligibility, typical award, confirmed deadline or "not confirmed", strategic fit, material risks and a recommended next action.' },
    opportunities: {
      type: 'array', description: 'Every distinct, currently open or recurring funding programme identified during the research. Empty if none.',
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          funder_name: { type: 'string' },
          programme_name: { type: 'string' },
          url: { type: 'string', description: 'Official programme page URL, or empty string.' },
          summary: { type: 'string', description: 'One or two sentences on what the programme funds.' },
          eligibility: { type: 'string', description: 'Who can apply, in plain terms. Empty if unknown.' },
          deadline: { type: 'string', description: 'Next confirmed closing date as YYYY-MM-DD, or empty string if rolling or not confirmed.' },
          amount_min: { type: 'number', description: 'Minimum award in GBP, or 0 if unknown.' },
          amount_max: { type: 'number', description: 'Maximum award in GBP, or 0 if unknown.' },
          contact_name: { type: 'string', description: 'Named contact, team or department for enquiries, or empty string.' },
          contact_email: { type: 'string', description: 'Enquiry email address from an official source, or empty string.' },
          contact_phone: { type: 'string', description: 'Enquiry phone number from an official source, or empty string.' },
          contact_url: { type: 'string', description: 'Contact or enquiry page URL, or empty string.' },
          contact_notes: { type: 'string', description: 'How best to get more information, e.g. enquiry form, office hours, webinar dates. Empty if none.' },
        },
        required: ['funder_name','programme_name','url','summary','eligibility','deadline','amount_min','amount_max','contact_name','contact_email','contact_phone','contact_url','contact_notes'],
      },
    },
  },
  required: ['narrative','opportunities'],
};

async function callResponses(key, body) {
  const response = await fetch('https://api.openai.com/v1/responses', { method: 'POST', signal: AbortSignal.timeout(12 * 60 * 1000), headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

export async function researchFunding(question) {
  const { key, model } = openAIConfig();
  const body = {
    model,
    tools: [{ type: 'web_search', search_context_size: 'medium', user_location: { type: 'approximate', country: 'GB', city: 'London', timezone: 'Europe/London' } }],
    text: { format: { type: 'json_schema', name: 'funding_research', strict: true, schema: RESEARCH_SCHEMA } },
    input: `You are a funding researcher for a small UK arts and social-impact organisation. Research: ${question}\n\nUse current official funder sources wherever possible. In the narrative, state eligibility, typical award, confirmed deadline or "not confirmed", strategic fit, material risks and a recommended next action. Be concise and never invent dates, amounts, eligibility or contact details: only include a contact email, phone number or contact page if it appears on an official funder source, otherwise leave it empty. List each distinct funding programme you identified in the opportunities array with clear contact details for finding out more.`,
  };
  let { response, payload } = await callResponses(key, body);
  if (response.status === 400 && /format|schema/i.test(payload.error?.message || '')) {
    // Structured output rejected for this model: fall back to plain prose so research still works.
    console.warn(JSON.stringify({ message: 'structured research output unavailable, retrying as prose', detail: payload.error?.message }));
    const { text, ...plain } = body; ({ response, payload } = await callResponses(key, plain));
  }
  if (!response.ok) {
    const auth = response.status === 401;
    fail(auth ? 'OpenAI rejected the configured API key. Replace OPENAI_API_KEY in Netlify and redeploy.' : `Research provider failed (${response.status}): ${payload.error?.message || 'Unknown error'}`, 502, 'PROVIDER_ERROR');
  }
  const output = (payload.output || []).flatMap((item) => item.content || []);
  const raw = payload.output_text || output.filter((item) => item.type === 'output_text').map((item) => item.text).join('\n');
  const citations = [...new Map(output.flatMap((item) => item.annotations || []).filter((item) => item.url).map((item) => [item.url, { url: item.url, title: item.title || new URL(item.url).hostname }])).values()];
  let answer = raw; let opportunities = [];
  try { const parsed = JSON.parse(raw); if (parsed && typeof parsed.narrative === 'string') { answer = parsed.narrative; opportunities = Array.isArray(parsed.opportunities) ? parsed.opportunities : []; } } catch { /* fall back to the raw text */ }
  opportunities = opportunities.filter((item) => item && item.funder_name?.trim() && item.programme_name?.trim()).map((item) => ({
    funder_name: item.funder_name.trim().slice(0, 200), programme_name: item.programme_name.trim().slice(0, 200), url: String(item.url || '').trim().slice(0, 500),
    summary: String(item.summary || '').trim().slice(0, 2000), eligibility: String(item.eligibility || '').trim().slice(0, 2000),
    deadline: /^\d{4}-\d{2}-\d{2}$/.test(item.deadline || '') ? item.deadline : null,
    amount_min: Number(item.amount_min) > 0 ? Math.round(Number(item.amount_min)) : null, amount_max: Number(item.amount_max) > 0 ? Math.round(Number(item.amount_max)) : null,
    contact_name: String(item.contact_name || '').trim().slice(0, 200), contact_email: String(item.contact_email || '').trim().slice(0, 320), contact_phone: String(item.contact_phone || '').trim().slice(0, 60),
    contact_url: String(item.contact_url || '').trim().slice(0, 500), contact_notes: String(item.contact_notes || '').trim().slice(0, 1000),
  }));
  return { answer, opportunities, citations, lastCheckedAt: new Date().toISOString(), model };
}

export async function assignmentAlert(assignment) {
  if (!process.env.RESEND_API_KEY || !process.env.ALERT_FROM_EMAIL) return { sent: false, reason: 'Email alerts are not configured.' };
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST', headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from: process.env.ALERT_FROM_EMAIL, to: [assignment.assignee_email], subject: `Funding Desk: ${strip(assignment.task)}`, html: `<p>You have a new Funding Desk assignment.</p><p><strong>${strip(assignment.task)}</strong></p><p>Due: ${strip(assignment.due_at || 'No date set')}</p><p><a href="${process.env.APP_BASE_URL || '/'}">Open Funding Desk</a></p>` }),
  });
  if (!response.ok) fail(`The assignment was saved, but the email provider returned ${response.status}.`, 502, 'PROVIDER_ERROR');
  return { sent: true };
}

export async function calendarHook(opportunity) {
  if (!process.env.GOOGLE_CALENDAR_WEBHOOK_URL) return { synced: false, reason: 'Calendar sync is not configured.' };
  if (!process.env.CALENDAR_WEBHOOK_SECRET) fail('Calendar webhook exists but CALENDAR_WEBHOOK_SECRET is missing.', 503, 'CONFIG_ERROR');
  const body = JSON.stringify({ event: 'opportunity.deadline.updated', opportunity });
  const signature = crypto.createHmac('sha256', process.env.CALENDAR_WEBHOOK_SECRET).update(body).digest('hex');
  const response = await fetch(process.env.GOOGLE_CALENDAR_WEBHOOK_URL, { method: 'POST', headers: { 'content-type': 'application/json', 'x-funding-desk-signature': signature }, body });
  if (!response.ok) fail(`Calendar automation returned ${response.status}.`, 502, 'PROVIDER_ERROR');
  return { synced: true };
}
