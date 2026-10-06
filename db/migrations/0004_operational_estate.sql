BEGIN;
ALTER TABLE qm.tenants ALTER COLUMN synthetic SET DEFAULT false;
ALTER TABLE qm.tenants ADD COLUMN time_zone text NOT NULL DEFAULT 'America/Chicago';
ALTER TABLE qm.tenants ADD COLUMN deleted_at timestamptz;
ALTER TABLE qm.tenants ADD COLUMN version integer NOT NULL DEFAULT 1;
ALTER TABLE qm.assets DROP CONSTRAINT assets_asset_class_check;
ALTER TABLE qm.assets ADD CHECK (asset_class ~ '^[a-z][a-z0-9_]{0,59}$');
ALTER TABLE qm.assets DROP CONSTRAINT assets_status_check;
ALTER TABLE qm.assets ADD CHECK (status IN ('in_service','needs_attention','out_of_service','retired','disposed'));
ALTER TABLE qm.assets ADD COLUMN details jsonb NOT NULL DEFAULT '{}' CHECK (octet_length(details::text)<=16000);
ALTER TABLE qm.assets ADD COLUMN deleted_at timestamptz;
ALTER TABLE qm.drafts ADD COLUMN deleted_at timestamptz;
ALTER TABLE qm.deletion_metadata DROP CONSTRAINT deletion_metadata_entity_type_check;
ALTER TABLE qm.deletion_metadata ADD CHECK(entity_type IN ('asset','tenant','media','transcript','capture','draft','record'));
CREATE UNIQUE INDEX asset_tag_unique ON qm.assets(tenant_id,(details->>'assetTag')) WHERE deleted_at IS NULL AND coalesce(details->>'assetTag','')<>'';
ALTER TABLE qm.memberships ADD COLUMN email text;
ALTER TABLE qm.memberships DROP CONSTRAINT memberships_capabilities_check;
ALTER TABLE qm.memberships ADD CHECK(capabilities <@ ARRAY['assets:read','assets:write','maintenance:write','audit:read','assets:delete','records:write','finance:write','rules:write','exports:read','workspace:admin']::text[]);
-- The owner-only policy added in 0003 makes this bounded function independent
-- of caller RLS, avoiding recursive membership policies. It checks only the
-- current actor, current tenant, active membership and tenant lifecycle.
CREATE OR REPLACE FUNCTION qm.allowed(capability text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,qm AS $$
 SELECT EXISTS(SELECT 1 FROM qm.memberships m JOIN qm.tenants t ON t.id=m.tenant_id
 WHERE m.tenant_id=qm.current_tenant() AND m.actor_id=qm.current_actor()
 AND m.active AND (m.expires_at IS NULL OR m.expires_at>statement_timestamp())
 AND t.deleted_at IS NULL AND capability=ANY(m.capabilities))
$$;
DROP POLICY actor_scope ON qm.memberships;
CREATE POLICY member_read ON qm.memberships FOR SELECT TO qm_app USING (
 (actor_id=qm.current_actor() AND active AND (expires_at IS NULL OR expires_at>statement_timestamp()))
 OR (tenant_id=qm.current_tenant() AND qm.allowed('workspace:admin')));
CREATE POLICY member_insert ON qm.memberships FOR INSERT TO qm_app WITH CHECK(tenant_id=qm.current_tenant() AND qm.allowed('workspace:admin'));
CREATE POLICY member_update ON qm.memberships FOR UPDATE TO qm_app USING(tenant_id=qm.current_tenant() AND qm.allowed('workspace:admin')) WITH CHECK(tenant_id=qm.current_tenant() AND qm.allowed('workspace:admin'));
GRANT INSERT,UPDATE ON qm.memberships TO qm_app;
DROP POLICY member_scope ON qm.tenants;
CREATE POLICY member_scope ON qm.tenants FOR SELECT TO qm_app USING(deleted_at IS NULL AND EXISTS(SELECT 1 FROM qm.memberships WHERE tenant_id=id AND actor_id=qm.current_actor() AND active AND (expires_at IS NULL OR expires_at>statement_timestamp())));
CREATE POLICY owner_update ON qm.tenants FOR UPDATE TO qm_app USING(id=qm.current_tenant() AND qm.allowed('workspace:admin')) WITH CHECK(id=qm.current_tenant());
GRANT UPDATE(name,time_zone,version,deleted_at) ON qm.tenants TO qm_app;
DROP POLICY asset_read ON qm.assets;
CREATE POLICY asset_read ON qm.assets FOR SELECT TO qm_app USING(tenant_id=qm.current_tenant() AND deleted_at IS NULL AND qm.allowed('assets:read'));
ALTER TABLE qm.maintenance DROP CONSTRAINT maintenance_tenant_id_asset_id_fkey;
ALTER TABLE qm.maintenance ADD FOREIGN KEY(tenant_id,asset_id) REFERENCES qm.assets(tenant_id,id) ON DELETE CASCADE;
ALTER TABLE qm.readings DROP CONSTRAINT readings_tenant_id_asset_id_fkey;
ALTER TABLE qm.readings ADD FOREIGN KEY(tenant_id,asset_id) REFERENCES qm.assets(tenant_id,id) ON DELETE CASCADE;
ALTER TABLE qm.maintenance ADD COLUMN assignee_id uuid;
ALTER TABLE qm.maintenance ADD COLUMN estimated_minor bigint NOT NULL DEFAULT 0;
ALTER TABLE qm.maintenance ADD COLUMN completed_at timestamptz;
ALTER TABLE qm.maintenance ADD COLUMN plan_id uuid;
CREATE UNIQUE INDEX maintenance_plan_due ON qm.maintenance(tenant_id,plan_id,due_date) WHERE plan_id IS NOT NULL;
ALTER TABLE qm.audit_events DROP CONSTRAINT audit_events_action_check;
ALTER TABLE qm.audit_events ADD CHECK(action ~ '^[a-z_]+\.[a-z_]+$' AND length(action)<80);

CREATE TABLE qm.records(
 tenant_id uuid NOT NULL REFERENCES qm.tenants(id),id uuid NOT NULL,kind text NOT NULL,
 asset_id uuid,version integer NOT NULL DEFAULT 1,deleted_at timestamptz,content jsonb NOT NULL CHECK(octet_length(content::text)<=20000),
 updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(tenant_id,id),
 FOREIGN KEY(tenant_id,asset_id) REFERENCES qm.assets(tenant_id,id) ON DELETE CASCADE,
 CHECK(kind IN ('locations','types','components','valuations','policies','incidents','assessments','books','transactions','plans','work_logs','rules','views')));
CREATE INDEX records_kind ON qm.records(tenant_id,kind,id);
CREATE INDEX records_asset ON qm.records(tenant_id,asset_id,id);
CREATE TABLE qm.record_history(tenant_id uuid NOT NULL,id uuid NOT NULL,version integer NOT NULL,content jsonb NOT NULL,changed_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(tenant_id,id,version),FOREIGN KEY(tenant_id,id) REFERENCES qm.records(tenant_id,id) ON DELETE CASCADE);
CREATE TABLE qm.snapshot_items(tenant_id uuid NOT NULL,incident_id uuid NOT NULL,asset_id uuid NOT NULL,content jsonb NOT NULL,PRIMARY KEY(tenant_id,incident_id,asset_id),FOREIGN KEY(tenant_id,incident_id) REFERENCES qm.records(tenant_id,id) ON DELETE CASCADE,FOREIGN KEY(tenant_id,asset_id) REFERENCES qm.assets(tenant_id,id) ON DELETE CASCADE);
CREATE TABLE qm.media(
 tenant_id uuid NOT NULL,id uuid NOT NULL,asset_id uuid,conversation_id uuid,version integer NOT NULL DEFAULT 1,
 intent text NOT NULL,state text NOT NULL CHECK(state IN ('uploading','processing','ready','failed','deleting')),
 content_type text NOT NULL,expected_bytes integer NOT NULL,sha256 text NOT NULL CHECK(length(sha256)=64),
 source_version text,width integer,height integer,observation jsonb,created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,id),FOREIGN KEY(tenant_id,asset_id) REFERENCES qm.assets(tenant_id,id) ON DELETE CASCADE,CHECK((asset_id IS NULL)<>(conversation_id IS NULL)));
CREATE INDEX media_asset ON qm.media(tenant_id,asset_id,id);
CREATE TABLE qm.jobs(
 tenant_id uuid NOT NULL,id uuid NOT NULL,actor_id uuid NOT NULL,kind text NOT NULL,
 state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','running','complete','failed')),
 payload jsonb NOT NULL CHECK(octet_length(payload::text)<=32000),result jsonb NOT NULL DEFAULT '{}',error_code text,
 created_at timestamptz NOT NULL DEFAULT now(),finished_at timestamptz,lease_until timestamptz,attempts integer NOT NULL DEFAULT 0,PRIMARY KEY(tenant_id,id));
CREATE TABLE qm.conversations(
 tenant_id uuid NOT NULL,id uuid NOT NULL,actor_id uuid NOT NULL,version integer NOT NULL DEFAULT 1,deleted_at timestamptz,
 draft jsonb NOT NULL DEFAULT '{}',proposal jsonb,proposal_expires_at timestamptz,review jsonb NOT NULL DEFAULT '{"maintenance":[],"readings":[]}',asset_id uuid,
 expires_at timestamptz NOT NULL DEFAULT now()+interval '15 days',updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,id),FOREIGN KEY(tenant_id,asset_id) REFERENCES qm.assets(tenant_id,id) ON DELETE CASCADE);
CREATE TABLE qm.turns(tenant_id uuid NOT NULL,id uuid NOT NULL,conversation_id uuid NOT NULL,actor_id uuid NOT NULL,role text NOT NULL CHECK(role IN ('user','assistant','transcript')),content text NOT NULL CHECK(length(content)<=8000),created_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz NOT NULL DEFAULT now()+interval '15 days',PRIMARY KEY(tenant_id,id),FOREIGN KEY(tenant_id,conversation_id) REFERENCES qm.conversations(tenant_id,id) ON DELETE CASCADE);
ALTER TABLE qm.media ADD FOREIGN KEY(tenant_id,conversation_id) REFERENCES qm.conversations(tenant_id,id) ON DELETE CASCADE;
CREATE TABLE qm.rule_effects(tenant_id uuid NOT NULL,rule_id uuid NOT NULL,asset_id uuid NOT NULL,rule_version integer NOT NULL,entity_id uuid NOT NULL,PRIMARY KEY(tenant_id,rule_id,asset_id,rule_version),FOREIGN KEY(tenant_id,rule_id) REFERENCES qm.records(tenant_id,id) ON DELETE CASCADE,FOREIGN KEY(tenant_id,asset_id) REFERENCES qm.assets(tenant_id,id) ON DELETE CASCADE);

CREATE ROLE qm_worker NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
GRANT USAGE ON SCHEMA qm TO qm_worker;
GRANT EXECUTE ON FUNCTION qm.current_tenant() TO qm_worker;
DO $migration$
DECLARE relation text;
BEGIN
 FOREACH relation IN ARRAY ARRAY['records','record_history','snapshot_items','media','jobs','conversations','turns','rule_effects'] LOOP
  EXECUTE format('ALTER TABLE qm.%I ENABLE ROW LEVEL SECURITY',relation);
  EXECUTE format('ALTER TABLE qm.%I FORCE ROW LEVEL SECURITY',relation);
  EXECUTE format('CREATE POLICY migration_owner ON qm.%I TO %I USING(true) WITH CHECK(true)',relation,current_user);
 END LOOP;
 FOREACH relation IN ARRAY ARRAY['memberships','assets','maintenance','readings','drafts','mutations','audit_events','deletion_metadata','records','record_history','snapshot_items','media','jobs','conversations','turns','rule_effects'] LOOP
  EXECUTE format('CREATE POLICY worker_scope ON qm.%I TO qm_worker USING(tenant_id=qm.current_tenant()) WITH CHECK(tenant_id=qm.current_tenant())',relation);
  EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON qm.%I TO qm_worker',relation);
 END LOOP;
END $migration$;
CREATE POLICY worker_scope ON qm.tenants TO qm_worker USING(id=qm.current_tenant()) WITH CHECK(id=qm.current_tenant());
GRANT SELECT,UPDATE,DELETE ON qm.tenants TO qm_worker;
CREATE POLICY record_read ON qm.records FOR SELECT TO qm_app USING(tenant_id=qm.current_tenant() AND qm.allowed('assets:read') AND (asset_id IS NULL OR EXISTS(SELECT 1 FROM qm.assets a WHERE a.id=asset_id)));
CREATE FUNCTION qm.record_write(kind text) RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog,qm AS $$ SELECT qm.allowed(CASE WHEN kind IN ('valuations','policies','books','transactions','assessments') THEN 'finance:write' WHEN kind='rules' THEN 'rules:write' ELSE 'records:write' END) $$;
REVOKE ALL ON FUNCTION qm.record_write(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION qm.record_write(text) TO qm_app;
CREATE POLICY record_insert ON qm.records FOR INSERT TO qm_app WITH CHECK(tenant_id=qm.current_tenant() AND qm.record_write(kind));
CREATE POLICY record_update ON qm.records FOR UPDATE TO qm_app USING(tenant_id=qm.current_tenant() AND qm.record_write(kind)) WITH CHECK(tenant_id=qm.current_tenant() AND qm.record_write(kind));
CREATE POLICY record_delete ON qm.records FOR DELETE TO qm_app USING(tenant_id=qm.current_tenant() AND qm.record_write(kind));
GRANT SELECT,INSERT,UPDATE,DELETE ON qm.records TO qm_app;
DO $migration$
DECLARE relation text;
BEGIN
 FOREACH relation IN ARRAY ARRAY['record_history','snapshot_items','media','jobs','rule_effects'] LOOP
  EXECUTE format('CREATE POLICY read_scope ON qm.%I FOR SELECT TO qm_app USING(tenant_id=qm.current_tenant() AND qm.allowed(''assets:read''))',relation);
  EXECUTE format('CREATE POLICY write_scope ON qm.%I TO qm_app USING(tenant_id=qm.current_tenant() AND qm.allowed(''assets:write'')) WITH CHECK(tenant_id=qm.current_tenant() AND qm.allowed(''assets:write''))',relation);
  EXECUTE format('GRANT SELECT,INSERT,UPDATE ON qm.%I TO qm_app',relation);
 END LOOP;
 FOREACH relation IN ARRAY ARRAY['conversations','turns'] LOOP
  EXECUTE format('CREATE POLICY private_scope ON qm.%I TO qm_app USING(tenant_id=qm.current_tenant() AND actor_id=qm.current_actor() AND qm.allowed(''assets:write'')) WITH CHECK(tenant_id=qm.current_tenant() AND actor_id=qm.current_actor() AND qm.allowed(''assets:write''))',relation);
  EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON qm.%I TO qm_app',relation);
 END LOOP;
END $migration$;
-- API deletion marks records inaccessible; the worker performs version-aware
DROP POLICY read_scope ON qm.media;
DROP POLICY write_scope ON qm.media;
CREATE POLICY media_read ON qm.media FOR SELECT TO qm_app USING(tenant_id=qm.current_tenant() AND qm.allowed('assets:read') AND (EXISTS(SELECT 1 FROM qm.assets a WHERE a.id=asset_id) OR EXISTS(SELECT 1 FROM qm.conversations c WHERE c.id=conversation_id AND c.actor_id=qm.current_actor())));
CREATE POLICY media_insert ON qm.media FOR INSERT TO qm_app WITH CHECK(tenant_id=qm.current_tenant() AND qm.allowed('assets:write') AND (EXISTS(SELECT 1 FROM qm.assets a WHERE a.id=asset_id) OR EXISTS(SELECT 1 FROM qm.conversations c WHERE c.id=conversation_id AND c.actor_id=qm.current_actor())));
CREATE POLICY media_update ON qm.media FOR UPDATE TO qm_app USING(tenant_id=qm.current_tenant() AND qm.allowed('assets:write') AND (EXISTS(SELECT 1 FROM qm.assets a WHERE a.id=asset_id) OR EXISTS(SELECT 1 FROM qm.conversations c WHERE c.id=conversation_id AND c.actor_id=qm.current_actor()))) WITH CHECK(tenant_id=qm.current_tenant() AND qm.allowed('assets:write'));
DROP POLICY read_scope ON qm.jobs;
DROP POLICY write_scope ON qm.jobs;
CREATE POLICY job_read ON qm.jobs FOR SELECT TO qm_app USING(tenant_id=qm.current_tenant() AND actor_id=qm.current_actor() AND qm.allowed('assets:read'));
CREATE POLICY job_insert ON qm.jobs FOR INSERT TO qm_app WITH CHECK(tenant_id=qm.current_tenant() AND actor_id=qm.current_actor() AND (qm.allowed('assets:write') OR qm.allowed('assets:delete') OR qm.allowed('exports:read') OR qm.allowed('rules:write') OR qm.allowed('records:write') OR qm.allowed('finance:write') OR qm.allowed('workspace:admin')));
CREATE POLICY job_update ON qm.jobs FOR UPDATE TO qm_app USING(tenant_id=qm.current_tenant() AND actor_id=qm.current_actor() AND qm.allowed('assets:read')) WITH CHECK(tenant_id=qm.current_tenant() AND actor_id=qm.current_actor());
REVOKE UPDATE ON qm.jobs FROM qm_app;
GRANT UPDATE(state,error_code) ON qm.jobs TO qm_app;
CREATE POLICY job_kind_permission ON qm.jobs AS RESTRICTIVE FOR INSERT TO qm_app WITH CHECK(
 CASE
 WHEN kind IN ('media','image_analysis','conversation','asset_rules','purge_capture','purge_draft') THEN qm.allowed('assets:write')
 WHEN kind='export' THEN qm.allowed('exports:read')
 WHEN kind IN ('purge_asset','purge_media') THEN qm.allowed('assets:delete')
 WHEN kind='purge_tenant' THEN qm.allowed('workspace:admin')
 WHEN kind='purge_record' THEN EXISTS(SELECT 1 FROM qm.records r WHERE r.id=(payload->>'recordId')::uuid AND qm.record_write(r.kind))
 WHEN kind='rule_run' THEN qm.allowed('rules:write')
 ELSE false END);
DROP POLICY write_scope ON qm.record_history;
CREATE POLICY history_insert ON qm.record_history FOR INSERT TO qm_app WITH CHECK(tenant_id=qm.current_tenant() AND EXISTS(SELECT 1 FROM qm.records r WHERE r.id=record_history.id AND qm.record_write(r.kind)));
REVOKE UPDATE ON qm.record_history FROM qm_app;
DROP POLICY write_scope ON qm.snapshot_items;
CREATE POLICY snapshot_insert ON qm.snapshot_items FOR INSERT TO qm_app WITH CHECK(tenant_id=qm.current_tenant() AND qm.allowed('records:write'));
REVOKE UPDATE ON qm.snapshot_items FROM qm_app;
DROP POLICY write_scope ON qm.rule_effects;
CREATE POLICY effect_insert ON qm.rule_effects FOR INSERT TO qm_app WITH CHECK(tenant_id=qm.current_tenant() AND qm.allowed('rules:write'));
REVOKE UPDATE ON qm.rule_effects FROM qm_app;
-- A soft-deleted asset is inaccessible immediately, including its children.
DROP POLICY read_scope ON qm.maintenance;
CREATE POLICY read_scope ON qm.maintenance FOR SELECT TO qm_app USING(tenant_id=qm.current_tenant() AND qm.allowed('assets:read') AND EXISTS(SELECT 1 FROM qm.assets a WHERE a.id=asset_id));
DROP POLICY read_scope ON qm.readings;
CREATE POLICY read_scope ON qm.readings FOR SELECT TO qm_app USING(tenant_id=qm.current_tenant() AND qm.allowed('assets:read') AND EXISTS(SELECT 1 FROM qm.assets a WHERE a.id=asset_id));
DROP POLICY read_scope ON qm.record_history;
CREATE POLICY read_scope ON qm.record_history FOR SELECT TO qm_app USING(tenant_id=qm.current_tenant() AND qm.allowed('assets:read') AND EXISTS(SELECT 1 FROM qm.records r WHERE r.id=record_history.id));
DROP POLICY read_scope ON qm.snapshot_items;
CREATE POLICY read_scope ON qm.snapshot_items FOR SELECT TO qm_app USING(tenant_id=qm.current_tenant() AND qm.allowed('assets:read') AND EXISTS(SELECT 1 FROM qm.assets a WHERE a.id=asset_id));
CREATE POLICY transcript_deadline ON qm.turns AS RESTRICTIVE FOR SELECT TO qm_app USING(expires_at>statement_timestamp());
CREATE POLICY deletion_deadline ON qm.deletion_metadata AS RESTRICTIVE FOR SELECT TO qm_app USING(deleted_at>statement_timestamp()-interval '90 days');
CREATE POLICY record_visible ON qm.records AS RESTRICTIVE FOR SELECT TO qm_app USING(deleted_at IS NULL);
CREATE POLICY draft_visible ON qm.drafts AS RESTRICTIVE FOR SELECT TO qm_app USING(deleted_at IS NULL);
CREATE POLICY capture_visible ON qm.conversations AS RESTRICTIVE FOR SELECT TO qm_app USING(deleted_at IS NULL);
-- API deletion marks records inaccessible; the worker performs version-aware
-- purge and writes the independent deletion ledger before removing SQL content.
CREATE FUNCTION qm.request_asset_deletion(target uuid, expected integer) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,qm AS $$
BEGIN
 IF NOT qm.allowed('assets:delete') THEN RAISE EXCEPTION 'denied'; END IF;
 UPDATE qm.assets SET deleted_at=now(),version=version+1 WHERE tenant_id=qm.current_tenant() AND id=target AND version=expected AND deleted_at IS NULL;
 RETURN FOUND;
END $$;
CREATE FUNCTION qm.request_tenant_deletion() RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,qm AS $$
BEGIN
 IF NOT qm.allowed('workspace:admin') THEN RAISE EXCEPTION 'denied'; END IF;
 UPDATE qm.tenants SET deleted_at=now(),version=version+1 WHERE id=qm.current_tenant() AND deleted_at IS NULL;
 RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION qm.request_asset_deletion(uuid,integer),qm.request_tenant_deletion() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION qm.request_asset_deletion(uuid,integer),qm.request_tenant_deletion() TO qm_app;
CREATE FUNCTION qm.request_record_deletion(target uuid,expected integer) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,qm AS $$
BEGIN
 UPDATE qm.records SET deleted_at=now(),version=version+1 WHERE tenant_id=qm.current_tenant() AND id=target AND version=expected AND deleted_at IS NULL AND qm.record_write(kind);
 RETURN FOUND;
END $$;
CREATE FUNCTION qm.request_private_deletion(kind text,target uuid,expected integer) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,qm AS $$
BEGIN
 IF NOT qm.allowed('assets:write') THEN RAISE EXCEPTION 'denied'; END IF;
 IF kind='draft' THEN
  UPDATE qm.drafts SET deleted_at=now(),version=version+1 WHERE tenant_id=qm.current_tenant() AND actor_id=qm.current_actor() AND id=target AND version=expected AND deleted_at IS NULL;
 ELSIF kind='capture' THEN
  UPDATE qm.conversations SET deleted_at=now(),version=version+1 WHERE tenant_id=qm.current_tenant() AND actor_id=qm.current_actor() AND id=target AND version=expected AND deleted_at IS NULL;
 ELSE RAISE EXCEPTION 'denied'; END IF;
 RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION qm.request_record_deletion(uuid,integer),qm.request_private_deletion(text,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION qm.request_record_deletion(uuid,integer),qm.request_private_deletion(text,uuid,integer) TO qm_app;
COMMIT;
