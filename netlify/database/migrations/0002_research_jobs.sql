CREATE TABLE research_jobs (
  id uuid PRIMARY KEY,
  question text NOT NULL,
  opportunity_id uuid REFERENCES opportunities(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','done','failed')),
  answer text,
  citations jsonb,
  model text,
  error text,
  created_by text NOT NULL,
  created_role text NOT NULL DEFAULT 'contributor',
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz
);

CREATE INDEX research_jobs_created_idx ON research_jobs(created_by, created_at DESC);
