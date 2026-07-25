# Audit Documentaire Multipieces UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans`. This tranche is UI-only and consumes the structured provenance read model built in the prior tranche.

**Goal:** Branch the tender audit and engagement screens onto the persisted provenance read model so the UI can display the true source PDF, the reliable page when available, and the explicit fallback state when provenance is unavailable.

**Architecture:** Keep provenance authority in the backend read model. The UI must only render persisted structured provenance and must never reconstruct source identity from `source_ref.page`, filename similarity, document order, or any other inference. The audit screen becomes the first multipiece consumer; the engagement curation screen follows in a second sub-tranche once audit navigation is validated.

**Boundary:** No changes to the extraction pipeline, no new provenance matching logic in components, no retro-imputation of historical engagements, and no display work in the IA synthesis yet. The new read model is a consumer contract, not a place to infer or repair provenance.

**Tech Stack:** Next.js, TypeScript, Supabase read queries, Vitest, existing PDF audit components.

---

## File map

- Modify `app/(dashboard)/tenders/[id]/audit/page.tsx`: load the full tender document list and the provenance read model for the current tender.
- Modify `app/(dashboard)/tenders/[id]/audit/DocumentAudit.tsx`: render the six document selector, the selected PDF, and the engagement provenance states.
- Create or modify audit helpers as needed in `app/(dashboard)/tenders/[id]/audit/` to keep the page thin.
- Modify `app/(dashboard)/tenders/[id]/engagement-curation-view.tsx` in a second sub-tranche after audit validation.
- Add focused tests for the audit read model consumer and the provenance-driven navigation.
- Add doctrine guards for any residual UI use of `source_ref.page` as authoritative provenance.

### Task 1: Define the audit consumer contract

**Files:**
- Modify `app/(dashboard)/tenders/[id]/audit/page.tsx`
- Modify `app/(dashboard)/tenders/[id]/audit/DocumentAudit.tsx`
- Add or extend focused tests under `tests/`

- [ ] **Step 1: Write tests for the audit consumer shape.**

Cover the three provenance states as they must appear in the audit UI:

```text
exact          → document label + page number + exact badge/state
document_only  → document label + no forced page + document_only badge/state
unavailable    → explicit "Source non localisée" + no arbitrary document selection
```

Add a test that proves legacy `source_ref.page` alone does not promote an engagement to a navigable source.

- [ ] **Step 2: Branch the audit page onto the structured read model.**

The audit page must read:

- the tender metadata;
- the full document list for the tender;
- `listTenderEngagementProvenance(tenderId)`.

It must pass the read-model rows to the audit component instead of the legacy raw engagement rows.

- [ ] **Step 3: Render the six documents as a selector.**

The audit UI must display the six tender documents as a first-class list and allow manual selection of a document even when no engagement is selected.

Selection should be explicit and stable:

```text
document list
→ selected document
→ selected page if provenance is exact
```

- [ ] **Step 4: Navigate from provenance states without inventing anything.**

Behavior:

- `exact` → select the matching PDF and open the verified page;
- `document_only` → select the matching PDF without forcing a page;
- `unavailable` → leave the current PDF unchanged and show “Source non localisée”.

Never pick a fallback PDF by recency, order, or filename similarity.

- [ ] **Step 5: Verify the audit consumer tests.**

Run the focused audit tests that exercise the read-model consumption and the three provenance states.

- [ ] **Step 6: Commit the audit consumer contract.**

Commit only the audit read-model consumer changes and tests once they pass.

### Task 2: Remove legacy UI authority from `source_ref.page`

**Files:**
- Modify `app/(dashboard)/tenders/[id]/audit/page.tsx`
- Modify `app/(dashboard)/tenders/[id]/audit/DocumentAudit.tsx`
- Modify `app/(dashboard)/tenders/[id]/engagement-curation-view.tsx`
- Add doctrine coverage if needed

- [ ] **Step 1: Identify every UI read of `source_ref.page` that acts as authority.**

The UI may still display `source_ref` as historical context in non-source-critical places, but it must not use it as the source of truth for page navigation or source selection.

- [ ] **Step 2: Replace authoritative `source_ref.page` reads with structured provenance.**

Display the persisted provenance state and structured page from the read model. Keep `source_ref` only as legacy context where it is not used for navigation.

- [ ] **Step 3: Add doctrine guards for UI authority.**

Guard that the audit UI and curation UI do not treat `source_ref.page` as the authoritative source of navigation.

- [ ] **Step 4: Verify no residual UI dependency remains.**

Run the focused audit and curation tests that cover the visible provenance states and navigation behaviors.

- [ ] **Step 5: Commit the UI authority cleanup.**

Commit only the UI authority cleanup and its tests once validated.

### Task 3: Add curation screen provenance display

**Files:**
- Modify `app/(dashboard)/tenders/[id]/engagement-curation-view.tsx`
- Add or extend tests for the curation screen

- [ ] **Step 1: Show the structured source on each engagement.**

Render the human-readable source from the provenance read model:

```text
Source : CCAP.pdf — page 12
Source : CCAP.pdf — page non localisée
Source non localisée
```

- [ ] **Step 2: Keep curation behavior unchanged.**

Do not change grouping, editing, bulk actions, or status transitions. This sub-tranche is display-only.

- [ ] **Step 3: Verify the curation screen tests.**

Ensure the rendered labels come from structured provenance and not from legacy page heuristics.

- [ ] **Step 4: Commit the curation display update.**

Commit only the display changes and tests after verification.

### Task 4: Final recipe and rollout

**Files:**
- Add a focused recipe or smoke test under `tests/` if needed

- [ ] **Step 1: Create a recipe on a fresh tender with structured provenance.**

Use a newly extracted tender where at least one engagement has `exact` provenance and at least one has `document_only` or `unavailable`.

- [ ] **Step 2: Verify audit navigation end to end.**

Confirm:

```text
engagement click
→ matching PDF selected
→ exact page opened when available
→ no arbitrary fallback when unavailable
```

- [ ] **Step 3: Verify the curation screen reflects the same read model.**

The curation page must show the same structured source labels as the audit page.

- [ ] **Step 4: Confirm this tranche stays out of IA synthesis.**

No display work in the AI synthesis screens yet.

- [ ] **Step 5: Commit the final UI tranche notes or smoke test.**

Commit only the files introduced for this tranche.

## Rollout and verification notes

This tranche consumes the provenance read model built previously and does not create new provenance rules.

Expected final UI behavior:

```text
Structured provenance available  → exact source PDF and page visible
Structured provenance partial    → source PDF visible, page omitted
Structured provenance unavailable → explicit “Source non localisée”
```

The audit multipiece reader is the first consumer. The curation screen is a second, smaller sub-tranche after audit validation. IA synthesis display remains out of scope for this tranche.
