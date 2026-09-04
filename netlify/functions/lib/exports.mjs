import { Document, HeadingLevel, Packer, Paragraph, TextRun } from 'docx';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

function content(opportunity) {
  return [
    { text: `${opportunity.funder_name} — ${opportunity.programme_name}`, heading: true },
    { text: `Decision: ${opportunity.status.replace('_', ' ').toUpperCase()} · Score: ${opportunity.score}/100` },
    { text: `Deadline: ${opportunity.deadline || 'Not confirmed'}` },
    { text: `Funding range: £${opportunity.amount_min || 0}–£${opportunity.amount_max || 0}` },
    { text: 'Opportunity summary', heading: true }, { text: opportunity.summary || 'No summary yet.' },
    ...(opportunity.eligibility ? [{ text: `Eligibility: ${opportunity.eligibility}` }] : []),
    { text: 'Contact for more information', heading: true },
    ...([['Contact', opportunity.contact_name], ['Email', opportunity.contact_email], ['Phone', opportunity.contact_phone], ['Enquiries', opportunity.contact_url], ['Programme page', opportunity.url], ['How to enquire', opportunity.contact_notes]].filter(([, value]) => value).map(([label, value]) => ({ text: `${label}: ${value}` }))),
    ...(!opportunity.contact_name && !opportunity.contact_email && !opportunity.contact_phone && !opportunity.contact_url && !opportunity.url ? [{ text: 'No contact details recorded yet.' }] : []),
    { text: 'Research notes', heading: true }, { text: opportunity.research_notes || 'No research notes yet.' },
    { text: 'Sources', heading: true }, ...(opportunity.citations || []).map((source) => ({ text: `${source.title || source.url}: ${source.url}` })),
  ];
}

export async function makeDocx(opportunity) {
  const document = new Document({ sections: [{ children: [new Paragraph({ text: 'Funding Desk', heading: HeadingLevel.TITLE }), ...content(opportunity).map((line) => new Paragraph({ children: [new TextRun({ text: line.text, bold: line.heading })], ...(line.heading ? { heading: HeadingLevel.HEADING_2 } : {}) }))] }] });
  return Packer.toBuffer(document);
}

export async function makePdf(opportunity) {
  const document = await PDFDocument.create(); const regular = await document.embedFont(StandardFonts.Helvetica); const bold = await document.embedFont(StandardFonts.HelveticaBold);
  let page = document.addPage([595, 842]); let y = 790;
  for (const line of content(opportunity)) {
    const font = line.heading ? bold : regular; const size = line.heading ? 15 : 10; const words = String(line.text).split(/\s+/); let row = '';
    for (const word of words) { const candidate = `${row} ${word}`.trim(); if (font.widthOfTextAtSize(candidate, size) > 500) { if (y < 55) { page = document.addPage([595, 842]); y = 790; } page.drawText(row, { x: 48, y, font, size, color: rgb(.07,.15,.13) }); y -= size + 6; row = word; } else row = candidate; }
    if (y < 55) { page = document.addPage([595, 842]); y = 790; } page.drawText(row, { x: 48, y, font, size, color: rgb(.07,.15,.13) }); y -= size + (line.heading ? 12 : 7);
  }
  return document.save();
}
