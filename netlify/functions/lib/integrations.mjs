import crypto from 'node:crypto';
import { openAIConfig } from './config.mjs';
import { fail } from './respond.mjs';

const strip = (value) => String(value || '').replace(/[<>&]/g, '');

export async function researchFunding(question) {
  const { key, model } = openAIConfig();
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      tools: [{ type: 'web_search', search_context_size: 'medium', user_location: { type: 'approximate', country: 'GB', city: 'London', timezone: 'Europe/London' } }],
      input: `You are a funding researcher for a small UK arts and social-impact organisation. Research: ${question}\n\nUse current official funder sources wherever possible. State eligibility, typical award, confirmed deadline or \"not confirmed\", strategic fit, material risks and a recommended next action. Be concise and never invent dates or eligibility.`,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const auth = response.status === 401;
    fail(auth ? 'OpenAI rejected the configured API key. Replace OPENAI_API_KEY in Netlify and redeploy.' : `Research provider failed (${response.status}): ${payload.error?.message || 'Unknown error'}`, 502, 'PROVIDER_ERROR');
  }
  const output = (payload.output || []).flatMap((item) => item.content || []);
  const answer = payload.output_text || output.filter((item) => item.type === 'output_text').map((item) => item.text).join('\n');
  const citations = [...new Map(output.flatMap((item) => item.annotations || []).filter((item) => item.url).map((item) => [item.url, { url: item.url, title: item.title || new URL(item.url).hostname }])).values()];
  return { answer, citations, lastCheckedAt: new Date().toISOString(), model };
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
