BEGIN;
-- Aurora's migration owner is not a superuser/BYPASSRLS role. Permit only the
-- exact owner to provision/recover data; runtime must never inherit that role.
DO $migration$
DECLARE relation text;
BEGIN
  FOREACH relation IN ARRAY ARRAY['tenants','memberships','assets','maintenance','readings','drafts','mutations','audit_events','deletion_metadata']
  LOOP
    EXECUTE format('CREATE POLICY migration_owner ON qm.%I TO %I USING (true) WITH CHECK (true)',relation,current_user);
  END LOOP;
END
$migration$;
COMMIT;
