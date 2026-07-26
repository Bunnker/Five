import type { MigrationBuilder } from "node-pg-migrate";

export function up(pgm: MigrationBuilder): void {
  // Issue #4 freezes the migration path without inventing business tables before their Tickets.
  pgm.sql("SELECT 1");
}

export function down(pgm: MigrationBuilder): void {
  pgm.sql("SELECT 1");
}
