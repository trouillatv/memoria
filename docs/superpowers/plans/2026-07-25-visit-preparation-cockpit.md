# Visit Preparation Cockpit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Turn the existing “Préparer ma visite” brief into a deterministic 30-second preparation cockpit without creating a second synthesis engine.

**Architecture:** Keep `getSiteBriefAction` as the single server-side aggregation boundary. Add a small pure read-model helper for phase and “En une minute” wording, extend the existing serializable brief with recent changes and preparation sections, and render the sections inside the existing client panel. The IA objective remains an explicit, confirmed action only.

**Tech Stack:** Next.js App Router, TypeScript, React client/server components, existing Supabase read helpers, Vitest, Tailwind.

---

## Tasks

- [ ] Add failing unit tests for phase selection and deterministic minute summary.
- [ ] Implement the pure preparation read-model helpers and extend `SiteBrief` with phase, summary, urgent items, blocked items, and recent field activity.
- [ ] Render the new preparation hierarchy in `SiteBriefButton` while preserving the existing on-demand AI objective flow.
- [ ] Run targeted tests, typecheck, diff checks, and inspect the final diff.
- [ ] Commit only scoped files, push `main`, and verify the production deployment status.
