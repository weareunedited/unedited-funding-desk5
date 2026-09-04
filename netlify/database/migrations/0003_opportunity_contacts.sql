ALTER TABLE opportunities
  ADD COLUMN eligibility text NOT NULL DEFAULT '',
  ADD COLUMN contact_name text NOT NULL DEFAULT '',
  ADD COLUMN contact_email text NOT NULL DEFAULT '',
  ADD COLUMN contact_phone text NOT NULL DEFAULT '',
  ADD COLUMN contact_url text NOT NULL DEFAULT '',
  ADD COLUMN contact_notes text NOT NULL DEFAULT '',
  ADD COLUMN source_job uuid;

ALTER TABLE research_jobs
  ADD COLUMN created_opportunities jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN updated_opportunities jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX opportunities_funder_programme_idx ON opportunities (lower(funder_name), lower(programme_name));
