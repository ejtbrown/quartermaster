-- Run once as the migration owner. No app login/password is created here.
BEGIN;
CREATE SCHEMA qm;
REVOKE ALL ON SCHEMA qm FROM PUBLIC;
CREATE ROLE qm_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
GRANT USAGE ON SCHEMA qm TO qm_app;

CREATE FUNCTION qm.current_tenant() RETURNS uuid
LANGUAGE sql STABLE PARALLEL SAFE AS
$$ SELECT NULLIF(current_setting('qm.tenant_id', true), '')::uuid $$;
REVOKE ALL ON FUNCTION qm.current_tenant() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION qm.current_tenant() TO qm_app;

CREATE TABLE qm.tenants (
  id uuid PRIMARY KEY,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 160),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE qm.assets (
  tenant_id uuid NOT NULL REFERENCES qm.tenants(id),
  id uuid NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 160),
  asset_class text NOT NULL CHECK (asset_class IN ('air_conditioner', 'appliance')),
  status text NOT NULL CHECK (status IN ('in_service', 'needs_attention', 'out_of_service')),
  location text NOT NULL CHECK (length(location) BETWEEN 1 AND 240),
  manufacturer text,
  model text,
  serial_number text,
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);
CREATE INDEX assets_tenant_status ON qm.assets(tenant_id, status, id);

-- No FK to deleted content, arbitrary JSON, names, before/after values, or URLs.
CREATE TABLE qm.deletion_metadata (
  tenant_id uuid NOT NULL,
  entity_id uuid NOT NULL,
  entity_type text NOT NULL CHECK (entity_type IN ('asset', 'tenant', 'media', 'transcript')),
  deleted_at timestamptz NOT NULL,
  policy_version text NOT NULL CHECK (policy_version = '2026-09-07'),
  PRIMARY KEY (tenant_id, entity_type, entity_id)
);

CREATE TABLE qm.audit_events (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  entity_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('asset.created', 'asset.updated', 'asset.deleted', 'tenant.deleted')),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, id),
  CHECK (expires_at > occurred_at AND expires_at <= occurred_at + interval '1 year')
);
CREATE INDEX audit_expiry ON qm.audit_events(expires_at);

ALTER TABLE qm.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE qm.tenants FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON qm.tenants TO qm_app USING (id = qm.current_tenant());
ALTER TABLE qm.assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE qm.assets FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON qm.assets TO qm_app
  USING (tenant_id = qm.current_tenant()) WITH CHECK (tenant_id = qm.current_tenant());
ALTER TABLE qm.deletion_metadata ENABLE ROW LEVEL SECURITY;
ALTER TABLE qm.deletion_metadata FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON qm.deletion_metadata TO qm_app
  USING (tenant_id = qm.current_tenant()) WITH CHECK (tenant_id = qm.current_tenant());
ALTER TABLE qm.audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE qm.audit_events FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_read ON qm.audit_events FOR SELECT TO qm_app
  USING (tenant_id = qm.current_tenant() AND expires_at > statement_timestamp());
CREATE POLICY tenant_insert ON qm.audit_events FOR INSERT TO qm_app
  WITH CHECK (tenant_id = qm.current_tenant());

GRANT SELECT ON qm.tenants TO qm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON qm.assets TO qm_app;
GRANT SELECT, INSERT ON qm.deletion_metadata TO qm_app;
GRANT SELECT, INSERT ON qm.audit_events TO qm_app;
COMMIT;
