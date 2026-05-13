-- Phase 4 migration: link each execution_jobs row to the assistant message
-- that proposed it. The (message_id, fence_index) pair lets the frontend match
-- dispatch fences in historical messages to their backing jobs on history
-- reload. Wrangler's `d1 migrations apply DB` runner manages bookkeeping.

ALTER TABLE execution_jobs ADD COLUMN message_id TEXT;
ALTER TABLE execution_jobs ADD COLUMN fence_index INTEGER;

CREATE INDEX IF NOT EXISTS idx_jobs_message ON execution_jobs(message_id, fence_index);
