# The Big Brain

A thinking partner for one person and their projects.

The Big Brain is a single-user system that organizes how you think across multiple coding and creative projects. It has three surfaces:

- **Project Managers** — a chat per project, embedded in that project's repo, where work happens
- **The Board** — a glance view of every active project's current state
- **The Brainstorm Room** — a thinking space with two AI voices (Brain 1, Brain 2) that see across everything

A persistent dropnote box at the bottom of the screen catches stray thoughts.

## Status

Greenfield. The full specification is in [`SPEC.md`](SPEC.md). System prompts for the manager and the two brains live in [`prompts/`](prompts/). Nothing is built yet — this repo is the spec and the build target.

## How to build it

Read `SPEC.md` start to finish. It's the source of truth. Build in the phases the spec defines, in order. Each phase ships a working state.

The infrastructure is Cloudflare Workers + Durable Objects + D1, a Vite + React frontend, and a local Node agent that executes Claude Code workers against the user's repos.

## Principles

- One person uses this. Single user, no accounts.
- A project is a GitHub repo with a `.ceo/` directory.
- The user is the only one who changes state on their work — managers and brains can read, draft, recommend, but never push code.
- Workers (the only path to user-data writes) require explicit user confirmation.
- The Brainstorm Room is for thinking, not for project work. Project work happens in the manager chats.
- Editorial restraint. Paper, ink, hairlines, Fraunces. No purple gradients.
