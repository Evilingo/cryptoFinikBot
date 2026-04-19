-- Partial unique index: enforce one OPEN trade per symbol at DB level.
-- Prisma does not support partial indexes natively — apply this manually
-- via psql or Railway console.
--
-- Wraps cleanup + index creation in a single transaction:
-- if the UPDATE fails (constraint, permissions, etc.) the index is NOT created.

BEGIN;

-- Deduplicate existing OPEN trades: keep oldest per symbol, close the rest.
UPDATE "Trade"
SET status = 'CLOSED', "closedAt" = NOW()
WHERE id NOT IN (
  SELECT MIN(id) FROM "Trade" WHERE status = 'OPEN' GROUP BY symbol
) AND status = 'OPEN';

-- Now safe to create the partial unique index — no duplicate OPEN rows remain.
CREATE UNIQUE INDEX IF NOT EXISTS "trade_one_open_per_symbol"
ON "Trade" (symbol)
WHERE status = 'OPEN';

COMMIT;
