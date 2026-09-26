BEGIN;
ALTER TABLE qm.tenants ADD COLUMN synthetic boolean NOT NULL DEFAULT true;
CREATE FUNCTION qm.current_actor() RETURNS uuid
LANGUAGE sql STABLE PARALLEL SAFE AS
$$ SELECT NULLIF(current_setting('qm.actor_id', true), '')::uuid $$;
REVOKE ALL ON FUNCTION qm.current_actor() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION qm.current_actor() TO qm_app;

-- Only the operator migration role can grant/revoke membership. No public signup
-- or support bypass. Capabilities, not a client-supplied role, authorize access.
CREATE TABLE qm.memberships (
  tenant_id uuid NOT NULL REFERENCES qm.tenants(id),
  actor_id uuid NOT NULL,
  capabilities text[] NOT NULL CHECK (capabilities <@ ARRAY[
    'assets:read','assets:write','maintenance:write','audit:read']::text[]),
  active boolean NOT NULL DEFAULT true,
  expires_at timestamptz,
  PRIMARY KEY (tenant_id, actor_id)
);
ALTER TABLE qm.memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE qm.memberships FORCE ROW LEVEL SECURITY;
CREATE POLICY actor_scope ON qm.memberships TO qm_app USING (
  actor_id = qm.current_actor() AND active AND
  (expires_at IS NULL OR expires_at > statement_timestamp())
);
GRANT SELECT ON qm.memberships TO qm_app;
CREATE FUNCTION qm.allowed(capability text) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM qm.memberships
    WHERE tenant_id = qm.current_tenant() AND capability = ANY(capabilities))
$$;
REVOKE ALL ON FUNCTION qm.allowed(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION qm.allowed(text) TO qm_app;
DROP POLICY tenant_scope ON qm.tenants;
CREATE POLICY member_scope ON qm.tenants TO qm_app USING (
  EXISTS (SELECT 1 FROM qm.memberships WHERE tenant_id = id)
);
DROP POLICY tenant_scope ON qm.assets;
CREATE POLICY asset_read ON qm.assets FOR SELECT TO qm_app
  USING (tenant_id = qm.current_tenant() AND qm.allowed('assets:read'));
CREATE POLICY asset_insert ON qm.assets FOR INSERT TO qm_app
  WITH CHECK (tenant_id = qm.current_tenant() AND qm.allowed('assets:write'));
CREATE POLICY asset_update ON qm.assets FOR UPDATE TO qm_app
  USING (tenant_id = qm.current_tenant() AND qm.allowed('assets:write'))
  WITH CHECK (tenant_id = qm.current_tenant() AND qm.allowed('assets:write'));
-- Purge is a separate worker/policy gate, never a normal CRUD action.
REVOKE DELETE ON qm.assets FROM qm_app;
ALTER TABLE qm.audit_events ADD COLUMN actor_id uuid;
ALTER TABLE qm.audit_events ADD COLUMN operator_id text;
ALTER TABLE qm.audit_events DROP CONSTRAINT audit_events_action_check;
ALTER TABLE qm.audit_events ADD CHECK (action IN (
  'asset.created','asset.updated','asset.deleted','tenant.deleted',
  'maintenance.created','maintenance.updated','reading.created','draft.saved','draft.committed',
  'membership.granted','membership.revoked'
));
DROP POLICY tenant_read ON qm.audit_events;
CREATE POLICY tenant_read ON qm.audit_events FOR SELECT TO qm_app USING (
  tenant_id = qm.current_tenant() AND qm.allowed('audit:read') AND expires_at > statement_timestamp()
);
DROP POLICY tenant_insert ON qm.audit_events;
CREATE POLICY tenant_insert ON qm.audit_events FOR INSERT TO qm_app WITH CHECK (
  tenant_id=qm.current_tenant() AND qm.allowed('assets:read') AND actor_id=qm.current_actor() AND operator_id IS NULL
);
DROP POLICY tenant_scope ON qm.deletion_metadata;
CREATE POLICY tenant_read ON qm.deletion_metadata FOR SELECT TO qm_app USING (
  tenant_id=qm.current_tenant() AND qm.allowed('audit:read')
);
REVOKE INSERT ON qm.deletion_metadata FROM qm_app;

CREATE TABLE qm.maintenance (
  tenant_id uuid NOT NULL, id uuid NOT NULL, asset_id uuid NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 240),
  due_date date, status text NOT NULL CHECK (status IN ('open','in_progress','completed')),
  notes text NOT NULL CHECK (length(notes) <= 4000),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,id),
  FOREIGN KEY (tenant_id,asset_id) REFERENCES qm.assets(tenant_id,id)
);
CREATE INDEX maintenance_due ON qm.maintenance(tenant_id,status,due_date,id);
CREATE INDEX maintenance_asset ON qm.maintenance(tenant_id,asset_id,id);
CREATE TABLE qm.readings (
  tenant_id uuid NOT NULL, id uuid NOT NULL, asset_id uuid NOT NULL,
  label text NOT NULL CHECK (length(label) BETWEEN 1 AND 120),
  value double precision NOT NULL CHECK (value BETWEEN -1e12 AND 1e12),
  unit text NOT NULL CHECK (length(unit) BETWEEN 1 AND 40),
  observed_at timestamptz NOT NULL,
  notes text NOT NULL CHECK (length(notes) <= 2000),
  PRIMARY KEY (tenant_id,id),
  FOREIGN KEY (tenant_id,asset_id) REFERENCES qm.assets(tenant_id,id)
);
CREATE INDEX readings_asset ON qm.readings(tenant_id,asset_id,id);
CREATE TABLE qm.drafts (
  tenant_id uuid NOT NULL REFERENCES qm.tenants(id), id uuid NOT NULL,
  actor_id uuid NOT NULL, version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  content jsonb NOT NULL CHECK (octet_length(content::text) <= 12000),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,id)
);
-- Only fingerprints/opaque IDs, never cached response bodies containing content.
-- Mutation keys are retained until the associated tenant is purged; this also
-- prevents an ancient retry from silently creating a duplicate asset.
CREATE TABLE qm.mutations (
  tenant_id uuid NOT NULL, actor_id uuid NOT NULL, id uuid NOT NULL,
  fingerprint text NOT NULL CHECK (length(fingerprint) = 64),
  entity_id uuid NOT NULL, entity_type text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,actor_id,id)
);

ALTER TABLE qm.maintenance ENABLE ROW LEVEL SECURITY;
ALTER TABLE qm.maintenance FORCE ROW LEVEL SECURITY;
CREATE POLICY read_scope ON qm.maintenance FOR SELECT TO qm_app USING (tenant_id=qm.current_tenant() AND qm.allowed('assets:read'));
CREATE POLICY insert_scope ON qm.maintenance FOR INSERT TO qm_app WITH CHECK (tenant_id=qm.current_tenant() AND qm.allowed('maintenance:write'));
CREATE POLICY update_scope ON qm.maintenance FOR UPDATE TO qm_app USING (tenant_id=qm.current_tenant() AND qm.allowed('maintenance:write')) WITH CHECK (tenant_id=qm.current_tenant() AND qm.allowed('maintenance:write'));
GRANT SELECT,INSERT,UPDATE ON qm.maintenance TO qm_app;
ALTER TABLE qm.readings ENABLE ROW LEVEL SECURITY;
ALTER TABLE qm.readings FORCE ROW LEVEL SECURITY;
CREATE POLICY read_scope ON qm.readings FOR SELECT TO qm_app USING (tenant_id=qm.current_tenant() AND qm.allowed('assets:read'));
CREATE POLICY insert_scope ON qm.readings FOR INSERT TO qm_app WITH CHECK (tenant_id=qm.current_tenant() AND qm.allowed('assets:write'));
GRANT SELECT,INSERT ON qm.readings TO qm_app;
ALTER TABLE qm.drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE qm.drafts FORCE ROW LEVEL SECURITY;
CREATE POLICY draft_scope ON qm.drafts TO qm_app
  USING (tenant_id=qm.current_tenant() AND actor_id=qm.current_actor() AND qm.allowed('assets:write'))
  WITH CHECK (tenant_id=qm.current_tenant() AND actor_id=qm.current_actor() AND qm.allowed('assets:write'));
GRANT SELECT,INSERT,UPDATE,DELETE ON qm.drafts TO qm_app;
ALTER TABLE qm.mutations ENABLE ROW LEVEL SECURITY;
ALTER TABLE qm.mutations FORCE ROW LEVEL SECURITY;
CREATE POLICY mutation_scope ON qm.mutations TO qm_app
  USING (tenant_id=qm.current_tenant() AND actor_id=qm.current_actor() AND qm.allowed('assets:read'))
  WITH CHECK (tenant_id=qm.current_tenant() AND actor_id=qm.current_actor() AND qm.allowed('assets:read'));
GRANT SELECT,INSERT ON qm.mutations TO qm_app;
COMMIT;
