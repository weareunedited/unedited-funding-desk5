CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE members (
  email text PRIMARY KEY,
  display_name text NOT NULL DEFAULT '',
  role text NOT NULL CHECK (role IN ('owner','editor','contributor')),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE opportunities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  funder_name text NOT NULL,
  programme_name text NOT NULL,
  url text,
  summary text NOT NULL DEFAULT '',
  deadline date,
  amount_min numeric(12,2),
  amount_max numeric(12,2),
  status text NOT NULL DEFAULT 'researching' CHECK (status IN ('researching','review','go','no_go','drafting','submitted','won','lost')),
  score integer NOT NULL DEFAULT 0 CHECK (score BETWEEN 0 AND 100),
  score_breakdown jsonb NOT NULL DEFAULT '{"strategic_fit":0,"eligibility":0,"evidence":0,"capacity":0,"return":0}'::jsonb,
  owner_email text,
  citations jsonb NOT NULL DEFAULT '[]'::jsonb,
  last_checked_at timestamptz,
  research_notes text NOT NULL DEFAULT '',
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  beneficiaries text NOT NULL DEFAULT '',
  geography text NOT NULL DEFAULT '',
  budget_total numeric(12,2),
  outcomes jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  evidence_type text NOT NULL DEFAULT 'note',
  content text NOT NULL DEFAULT '',
  source_url text,
  occurred_on date,
  tags jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE project_evidence (
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  evidence_id uuid NOT NULL REFERENCES evidence(id) ON DELETE CASCADE,
  PRIMARY KEY (project_id, evidence_id)
);

CREATE TABLE files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  blob_key text UNIQUE NOT NULL,
  filename text NOT NULL,
  content_type text NOT NULL,
  size_bytes integer NOT NULL CHECK (size_bytes >= 0),
  category text NOT NULL CHECK (category IN ('guidance','budget','evidence','application','other')),
  linked_type text,
  linked_id uuid,
  uploaded_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id uuid NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  assignee_email text NOT NULL,
  task text NOT NULL,
  due_at date,
  completed_at timestamptz,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_log (
  id bigserial PRIMARY KEY,
  actor_email text NOT NULL,
  actor_role text NOT NULL,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  before_data jsonb,
  after_data jsonb,
  request_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX opportunities_deadline_idx ON opportunities(deadline);
CREATE INDEX opportunities_status_idx ON opportunities(status);
CREATE INDEX audit_log_entity_idx ON audit_log(entity_type, entity_id, created_at DESC);
CREATE INDEX assignments_assignee_idx ON assignments(assignee_email, completed_at);

INSERT INTO members(email, display_name, role)
VALUES ('bernard@weareunedited.com', 'Bernard', 'owner')
ON CONFLICT (email) DO NOTHING;
