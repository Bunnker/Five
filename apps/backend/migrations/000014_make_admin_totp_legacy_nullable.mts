import type { MigrationBuilder } from "node-pg-migrate";

const LEGACY_TOTP_COLUMNS = [
  "totp_ciphertext",
  "totp_initialization_vector",
  "totp_authentication_tag",
  "totp_key_version",
  "totp_aad",
  "last_accepted_totp_counter",
] as const;

export function up(pgm: MigrationBuilder): void {
  pgm.dropConstraint("admin_operator_accounts", "admin_operator_accounts_totp_counter_check");
  for (const column of LEGACY_TOTP_COLUMNS) {
    pgm.alterColumn("admin_operator_accounts", column, { notNull: false });
  }
  pgm.sql(
    "ALTER TABLE admin_operator_accounts ALTER COLUMN last_accepted_totp_counter DROP DEFAULT",
  );
  pgm.addConstraint("admin_operator_accounts", "admin_operator_accounts_totp_counter_check", {
    check: "last_accepted_totp_counter IS NULL OR last_accepted_totp_counter >= -1",
  });
  pgm.addConstraint(
    "admin_operator_accounts",
    "admin_operator_accounts_totp_legacy_complete_check",
    {
      check: `(
        (
          totp_ciphertext IS NULL
          AND totp_initialization_vector IS NULL
          AND totp_authentication_tag IS NULL
          AND totp_key_version IS NULL
          AND totp_aad IS NULL
          AND last_accepted_totp_counter IS NULL
        )
        OR
        (
          totp_ciphertext IS NOT NULL
          AND totp_initialization_vector IS NOT NULL
          AND totp_authentication_tag IS NOT NULL
          AND totp_key_version IS NOT NULL
          AND totp_aad IS NOT NULL
          AND last_accepted_totp_counter IS NOT NULL
        )
      )`,
    },
  );
}

export function down(pgm: MigrationBuilder): void {
  pgm.sql(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
          FROM admin_operator_accounts
         WHERE totp_ciphertext IS NULL
            OR totp_initialization_vector IS NULL
            OR totp_authentication_tag IS NULL
            OR totp_key_version IS NULL
            OR totp_aad IS NULL
            OR last_accepted_totp_counter IS NULL
      ) THEN
        RAISE EXCEPTION
          'Cannot roll back password-only administrator accounts: legacy TOTP columns contain NULL';
      END IF;
    END;
    $$;
  `);
  pgm.dropConstraint(
    "admin_operator_accounts",
    "admin_operator_accounts_totp_legacy_complete_check",
  );
  pgm.dropConstraint("admin_operator_accounts", "admin_operator_accounts_totp_counter_check");
  for (const column of LEGACY_TOTP_COLUMNS) {
    pgm.alterColumn("admin_operator_accounts", column, { notNull: true });
  }
  pgm.sql(
    "ALTER TABLE admin_operator_accounts ALTER COLUMN last_accepted_totp_counter SET DEFAULT -1",
  );
  pgm.addConstraint("admin_operator_accounts", "admin_operator_accounts_totp_counter_check", {
    check: "last_accepted_totp_counter >= -1",
  });
}
