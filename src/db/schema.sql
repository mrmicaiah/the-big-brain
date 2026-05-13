-- The Big Brain — D1 schema
-- Source of truth: SPEC.md §"What lives in D1"
-- Applied via: npm run db:apply:local  (or :remote)

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,                  -- UUID, internal
  repo_full_name TEXT NOT NULL UNIQUE,  -- e.g., "mrmicaiah/the-big-brain"
  clone_url TEXT NOT NULL,
  default_branch TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS chats (
  id TEXT PRIMARY KEY,                  -- UUID
  surface TEXT NOT NULL,                -- 'manager' | 'brainstorm'
  project_id TEXT,                      -- NULL for brainstorm; FK for manager
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,                  -- UUID
  chat_id TEXT NOT NULL,
  role TEXT NOT NULL,                   -- 'user' | 'assistant' | 'system'
  brain TEXT,                           -- 'brain1' | 'brain2' | NULL (NULL for manager surfaces and user messages)
  content TEXT NOT NULL,
  attachments TEXT,                     -- JSON array of attachment metadata (paths, types)
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS dropnotes (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  archived_at TEXT
);

CREATE TABLE IF NOT EXISTS execution_jobs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  prompt TEXT NOT NULL,
  summary TEXT NOT NULL,
  status TEXT NOT NULL,                 -- queued | running | succeeded | failed
  output_stream TEXT,
  diff_summary TEXT,                    -- JSON: { summary, diffStat, diff, diffTruncated } or { error, stage }
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT,
  manager_seen_at TEXT,                 -- when the manager last folded this result into context
  message_id TEXT,                      -- assistant message id that emitted the dispatch fence (Phase 4)
  fence_index INTEGER                   -- which fence within that message, 0-indexed (Phase 4)
);

CREATE INDEX IF NOT EXISTS idx_projects_repo_full_name ON projects(repo_full_name);
CREATE INDEX IF NOT EXISTS idx_chats_project ON chats(project_id);
CREATE INDEX IF NOT EXISTS idx_chats_surface ON chats(surface);
CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id, created_at);
CREATE INDEX IF NOT EXISTS idx_dropnotes_unarchived ON dropnotes(archived_at, created_at);
CREATE INDEX IF NOT EXISTS idx_jobs_manager_unseen ON execution_jobs(project_id, status, manager_seen_at);
CREATE INDEX IF NOT EXISTS idx_jobs_message ON execution_jobs(message_id, fence_index);
