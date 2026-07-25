# Tender Engagement Provenance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist only demonstrable links between an engagement and a `tender_document`, with an optional reliable page number, while preserving cross-tender integrity and historical data.

**Architecture:** Add nullable structured provenance to `engagements`, enforce the document/tender relationship in PostgreSQL, and derive the three-state provenance value from the two nullable columns. During engagement extraction, the server validates the citation, resolves a uniquely matching document in the same tender, and writes the structured provenance; the audit read model only reads these persisted fields and never infers from `source_ref.page`.

**Boundary:** A future validator may carry `tender_document_id` directly, but this tranche must not depend on that contract or modify the validator for it. The current implementation resolves the uniquely matching filename deterministically at the server boundary.

**Tech Stack:** Supabase PostgreSQL migrations, TypeScript, Zod/AI extraction services, Vitest unit tests, Supabase integration tests.

---

## File map

- Create `supabase/migrations/240_tender_engagement_provenance.sql`: columns, checks, composite key, trigger, and RLS-compatible database objects.
- Modify `types/db.ts`: `DbEngagement` fields and provenance state types.
- Create `lib/tenders/engagement-provenance.ts`: pure state derivation and strict document-reference resolution helpers.
- Modify `services/ai/engagement-extraction.ts` only if the extracted result type needs an explicit provenance hand-off; do not make the model authoritative for document or page.
- Modify `app/(dashboard)/tenders/[id]/engagements-actions.ts`: pass the fully extracted tender corpus and documents through server-side provenance resolution before insertion.
- Modify `lib/db/engagements.ts`: accept and insert validated `tender_document_id`/`page_number` values, keeping the existing authorization boundary.
- Create `lib/db/tender-engagement-provenance.ts`: read model joining engagements to same-tender documents and deriving the state.
- Create `tests/lib/engagement-provenance.test.ts`: pure resolver/state tests, including ambiguity and legacy `source_ref` behavior.
- Create `tests/doctrine/tender-engagement-provenance.test.ts`: static guards against source guessing and use of `source_ref.page` as authoritative.
- Create `tests/lib/tender-engagement-provenance.integration.test.ts`: direct database constraints, cross-tender rejection, and deletion behavior.
- Modify `tests/integration-tests.ts`: register the new integration test so it is excluded from the unit project.

### Task 1: Add the failing pure-contract tests

**Files:**
- Create: `tests/lib/engagement-provenance.test.ts`
- Create: `lib/tenders/engagement-provenance.ts`

- [ ] **Step 1: Write tests for the three derived states.**

Use a pure function with this contract:

```ts
type EngagementProvenanceState = 'exact' | 'document_only' | 'unavailable'

deriveEngagementProvenanceState({
  tenderDocumentId: string | null,
  pageNumber: number | null,
}): EngagementProvenanceState
```

Assert:

```ts
expect(derive({ tenderDocumentId: 'doc-1', pageNumber: 12 })).toBe('exact')
expect(derive({ tenderDocumentId: 'doc-1', pageNumber: null })).toBe('document_only')
expect(derive({ tenderDocumentId: null, pageNumber: null })).toBe('unavailable')
expect(() => derive({ tenderDocumentId: null, pageNumber: 12 })).toThrow()
```

- [ ] **Step 2: Write tests for strict canonical resolution.**

Define a resolver that receives a located document reference and the documents
of the current tender. Its matching rule must be deterministic and exact after
the explicitly documented canonical normalization (Unicode normalization,
case folding, and whitespace normalization only). Test:

```ts
expect(resolve('CCAP.pdf', [doc('CCAP.pdf')])).toEqual({ documentId: 'd1' })
expect(resolve('ccap.pdf', [doc('CCAP.pdf')])).toEqual({ documentId: 'd1' })
expect(resolve('CCAP.pdf', [doc('CCAP.pdf'), doc('CCAP.PDF')])).toBeNull()
expect(resolve('missing.pdf', [doc('CCAP.pdf')])).toBeNull()
```

The resolver must never sort and select the first candidate.

- [ ] **Step 3: Run the tests and verify they fail for missing exports.**

Run:

```text
npx vitest run --project unit tests/lib/engagement-provenance.test.ts
```

Expected: FAIL because the provenance module and functions do not exist yet.

- [ ] **Step 4: Implement the pure functions.**

Implement only canonical normalization, unique matching, and state derivation
in `lib/tenders/engagement-provenance.ts`. Do not access Supabase, inspect PDF
text, or consult `source_ref` in this module.

- [ ] **Step 5: Run the unit tests.**

Run the command above. Expected: all pure provenance tests pass.

- [ ] **Step 6: Commit the pure contract.**

```text
git add lib/tenders/engagement-provenance.ts tests/lib/engagement-provenance.test.ts
git commit -m "Add engagement provenance state contract"
```

### Task 2: Add the database schema and direct SQL tests

**Files:**
- Create: `supabase/migrations/240_tender_engagement_provenance.sql`
- Create: `tests/lib/tender-engagement-provenance.integration.test.ts`
- Modify: `tests/integration-tests.ts`

- [ ] **Step 1: Write integration tests before the migration.**

Create uniquely tagged test rows for two tenders, one document per tender, and
one engagement per tender. The tests must assert:

```text
document + page inserts successfully;
document without page inserts successfully;
page without document is rejected;
document from another tender is rejected;
page_number <= 0 is rejected;
```

- [ ] **Step 2: Add the migration.**

The migration must:

1. add nullable `tender_document_id` and `page_number` to `public.engagements`;
2. add `check (page_number is null or page_number > 0)`;
3. add `check (page_number is null or tender_document_id is not null)`;
4. add `unique (tender_id, id)` to `public.tender_documents` if absent;
5. add a composite foreign key from `(engagements.tender_id, engagements.tender_document_id)` to `(tender_documents.tender_id, tender_documents.id)`;
6. use `on update restrict`/`no action` so provenance cannot move across tenders;
7. create a `public`-qualified, `security definer`, `set search_path = ''` trigger function that nulls both provenance fields for exact `(OLD.tender_id, OLD.id)` references before a tender document is deleted;
8. keep the composite foreign key restrictive after the trigger has cleared references;
9. remain idempotent with `if not exists`/guarded constraint creation patterns used by this repository.

Do not use a direct composite `on delete set null` if PostgreSQL would null the
non-null `engagements.tender_id` column.

- [ ] **Step 3: Run the direct database tests.**

Run:

```text
npx vitest run --project integration tests/lib/tender-engagement-provenance.integration.test.ts
```

Expected:

```text
all constraint tests pass;
cross-tender reference is rejected;
deleting the source document keeps the engagement and sets both provenance fields to null.
```

- [ ] **Step 4: Commit the migration and SQL tests.**

```text
git add supabase/migrations/240_tender_engagement_provenance.sql tests/lib/tender-engagement-provenance.integration.test.ts tests/integration-tests.ts
git commit -m "Enforce tender engagement provenance integrity"
```

### Task 3: Extend application types and pure read helpers

**Files:**
- Modify: `types/db.ts`
- Modify: `lib/tenders/engagement-provenance.ts`
- Extend: `tests/lib/engagement-provenance.test.ts`

- [ ] **Step 1: Add nullable fields to `DbEngagement`.**

Add:

```ts
tender_document_id: string | null
page_number: number | null
```

Add the exported state type:

```ts
export type EngagementProvenanceState = 'exact' | 'document_only' | 'unavailable'
```

- [ ] **Step 2: Test and implement the read-model row shape.**

Define a returned row shape containing the engagement fields needed by the
audit, `documentId`, `filename`, `pageNumber`, and the derived state. The helper
must derive state only from structured fields and must return `unavailable` when
only `source_ref.page` is present.

- [ ] **Step 3: Run unit tests and commit.**

```text
npx vitest run --project unit tests/lib/engagement-provenance.test.ts
git add types/db.ts lib/tenders/engagement-provenance.ts tests/lib/engagement-provenance.test.ts
git commit -m "Type structured engagement provenance"
```

### Task 4: Persist provenance at engagement extraction time

**Files:**
- Modify: `app/(dashboard)/tenders/[id]/engagements-actions.ts`
- Modify: `lib/db/engagements.ts`
- Modify: `lib/tenders/engagement-provenance.ts`
- Extend: `tests/lib/engagement-provenance.test.ts`
- Extend: `tests/services/engagement-extraction.test.ts`

- [ ] **Step 1: Add a failing application test for provenance enrichment.**

Given the six documents and a server-located citation, assert that the insert
payload contains the unique matching `tender_document_id` and reliable
`page_number`. Given an ambiguous or missing document match, assert both fields
are null even when the legacy `source_ref.page` contains a number.

- [ ] **Step 2: Build the server-side enrichment boundary.**

After `runEngagementExtractionAgent` returns and before
`bulkInsertEngagements`, use the already extracted document texts and the
server-side citation locator. For each engagement:

```text
source_excerpt
→ locateQuote in the current tender corpus
→ exact document-label match inside current tender documents
→ unique document id or null
→ page only when located with that document
```

The AI-provided page is never authoritative. A page is discarded when there is
no uniquely resolved document. No historical engagement is updated.

- [ ] **Step 3: Extend `bulkInsertEngagements` input and insert rows.**

Accept nullable `tender_document_id` and `page_number`, and pass them through
the existing service-role insert after the existing organization membership
check. Keep the existing `tender_id` and organization safeguards.

- [ ] **Step 4: Run application and extraction tests.**

Run:

```text
npx vitest run --project unit tests/lib/engagement-provenance.test.ts tests/services/engagement-extraction.test.ts tests/lib/engagements.test.ts
```

Expected: all prior engagement behavior remains green and the new ambiguity
cases remain `unavailable`.

- [ ] **Step 5: Commit the write-path change.**

```text
git add 'app/(dashboard)/tenders/[id]/engagements-actions.ts' lib/db/engagements.ts lib/tenders/engagement-provenance.ts tests/lib/engagement-provenance.test.ts tests/services/engagement-extraction.test.ts
git commit -m "Persist verified tender engagement provenance"
```

### Task 5: Add the audit read model

**Files:**
- Create: `lib/db/tender-engagement-provenance.ts`
- Create: `tests/lib/tender-engagement-provenance.test.ts`

- [ ] **Step 1: Write read-model tests.**

Mock or integration-test rows for the three states and assert:

```text
exact          → document id, filename, page, exact
document_only  → document id, filename, null page, document_only
unavailable    → null document, null filename, null page, unavailable
```

Assert that an old `source_ref.page` never changes `unavailable`.

- [ ] **Step 2: Implement the read model.**

Query `engagements` joined to `tender_documents` on both `tender_id` and
`tender_document_id`. Return only persisted structured provenance and derive
the state with the pure helper. Do not use `getTenderDocument()` and do not
fallback to the latest PDF.

- [ ] **Step 3: Run tests and commit.**

```text
npx vitest run --project unit tests/lib/tender-engagement-provenance.test.ts tests/lib/engagement-provenance.test.ts
git add lib/db/tender-engagement-provenance.ts tests/lib/tender-engagement-provenance.test.ts
git commit -m "Add tender engagement provenance read model"
```

### Task 6: Add doctrine guards and final verification

**Files:**
- Create: `tests/doctrine/tender-engagement-provenance.test.ts`

- [ ] **Step 1: Add static guards.**

Guard that:

- the read model does not read `source_ref.page` as its structured page;
- no audit provenance code calls `getTenderDocument()` as a fallback source;
- the write path only accepts provenance produced by the server-side resolver;
- no code performs fuzzy filename matching or first-candidate selection.

- [ ] **Step 2: Run the focused verification suite.**

```text
npx vitest run --project unit tests/lib/engagement-provenance.test.ts tests/lib/tender-engagement-provenance.test.ts tests/services/engagement-extraction.test.ts tests/lib/engagements.test.ts tests/doctrine/tender-engagement-provenance.test.ts
npx tsc --noEmit --pretty false
git diff --check
```

Expected: focused tests pass; TypeScript reports no new errors in the touched
files; `git diff --check` reports no whitespace errors.

- [ ] **Step 3: Run integration verification.**

Run:

```text
npx vitest run --project integration tests/lib/tender-engagement-provenance.integration.test.ts
```

Verify the cross-tender constraint and delete-trigger behavior against the
real database.

- [ ] **Step 4: Review scope.**

Confirm that this tranche did not modify:

- the global AI analysis pipeline;
- the generic `tender_analyses.document_sources` model;
- the PDF reader UI;
- any historical engagement provenance.

- [ ] **Step 5: Commit the final doctrine tests.**

```text
git add tests/doctrine/tender-engagement-provenance.test.ts
git commit -m "Guard tender engagement provenance rules"
```

## Rollout and verification notes

Apply migration 240 before deploying the application code. Existing
engagements receive `NULL` structured provenance and therefore present as
`unavailable`; no backfill job is permitted. Validate with a newly extracted
engagement whose quote is uniquely found in one LPCH document, and separately
with an ambiguous duplicate filename case.

The multipiece PDF reader belongs to a subsequent tranche. It may consume this
read model only after this provenance tranche has been deployed and its SQL
tests pass.
