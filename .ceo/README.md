# .ceo/

This directory is the project's memory for The Big Brain.

A manager is bound to this repo through these files. They're committed to git, so the project's memory survives if the system's database is reset.

- `goal.md` — what this project is for, in your words
- `context.md` — what the manager needs to know to be useful here
- `decisions.md` — log of significant decisions, with dates
- `board.md` — current state snapshot (goal, state, next, blockers) with YAML frontmatter

The manager reads all of these at the start of every session. The manager can update them as housekeeping in its own workspace — you'll see those updates land as commits.

The `uploads/` directory is created lazily when you drag files into the manager chat.
