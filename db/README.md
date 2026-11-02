# SQL-only data layer — Sprint 1

Use PostgreSQL with node-postgres (`pg`) and reviewed, versioned `.sql` migrations.
**No Prisma, Drizzle, TypeORM, Sequelize, or ORM adapter.**

Review the direct-PostgreSQL authentication schema before introducing user foreign keys.
Proposed entities: groups/members/invites, expenses/items/item_shares, obligations/
sources, settlements/allocations/events, notification inbox/outbox and audit logs.

Migration runner requirements: PostgreSQL advisory lock, transaction per migration,
schema_migrations registry with filename + SHA256 checksum + timestamp, reject edits
to previously applied migrations, least-privilege credentials and rollback strategy.
