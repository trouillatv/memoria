# Deadline Micro-Correctif: Sentinel Validation Results

**Date**: 2026-08-21  
**Status**: PASS (ready to commit)  
**Methodology**: 7-document sentinel corpus vs frozen baseline references

---

## Summary

The deadline micro-correctif successfully improves deadline extraction recall from 30.4% to 47.8% (+17.4 percentage points) without introducing false positives.

| Metric | Baseline | Sentinel | Δ |
|--------|----------|----------|---|
| Deadline Recall | 30.4% (7/23) | 47.8% (11/23) | **+17.4 pts** ✓ |
| Matched | 7 | 11 | +4 real deadlines |
| Misclassified | — | 10 | (real content, wrong family from baseline absorption) |
| **False Positives** | — | **0** | **✓ Zero fabrication** |
| Proposals Generated | — | 21 | — |

---

## Per-Document Results

| Document | Baseline Recall | Sentinel Recall | Gain | Notes |
|----------|---|---|---|---|
| **JAR_CR04** | 11.1% (1/9) | 33.3% (3/9) | +22.2 pts ⭐ | Primary test case, strong improvement |
| **MEL_CR03** | 0% (0/2) | 50% (1/2) | +50 pts ⭐ | Baseline completely missed these deadlines |
| **HER_CR01** | 0% (0/4) | 50% (2/4) | +50 pts ⭐ | Significant gain from zero baseline |
| **JAR_01** | 85.7% (6/7) | 71.4% (5/7) | −14.3 pts ⚠️ | **REGRESSION** — control point for final benchmark |
| QHSE_004 | — | — | — | No baseline deadline references |
| EAU_001 | — | — | — | No baseline deadline references |
| VRD_005 | — | — | — | No baseline deadline references |

---

## Quality Verification

✅ **Zero false positives**: All 21 sentinel deadline proposals verified against document source text — zero fabricated dates  
✅ **No new hallucination**: The 10 "misclassified" items represent content correctly extracted but placed in wrong family by baseline (absorption into knowledge_fact)  
✅ **Genuine recall improvement**: Not just proposal volume increase, but documented recovery of real deadline elements  
✅ **Isolated change**: Modification is one-line addition to deadline definition; no other family rules altered  

---

## Change Verification

**File modified**: `lib/documents/historical-visit-extractor.ts`  
**Line**: 196 (deadline family definition)  
**Change**: Added explicit clause for planning sections (PRÉVISIONS/PROGRAMME) and date priority rule

```diff
- **deadline** : échéance chiffrée ou datée, spécifique à ce chantier. 
+ **deadline** : échéance chiffrée ou datée, spécifique à ce chantier — 
+ y compris un jalon de planning (« semaine X », date de reprise, date de prochaine réunion) 
+ même situé dans une section "PRÉVISIONS" ou "PROGRAMME" : 
+ toute date ou échéance précise l'emporte toujours sur un classement en knowledge_fact.forecast.
```

**Typecheck**: ✅ PASS (no TypeScript errors)  

---

## Acceptance Criteria Met

| Criterion | Result | Status |
|-----------|--------|--------|
| Recall gain ≥ +10 pts | +17.4 pts | ✅ PASS |
| No new fabrication | 0 FP | ✅ PASS |
| Multiple documents improved | 3/4 with refs | ✅ PASS |
| Isolated change (no cross-family modification) | One-line addition | ✅ PASS |

---

## Control Point

**JAR_01 regression (-14.3 pts)** documented as a control point. This regression must be verified in the final 25-document benchmark:
- If regression persists in full corpus: may indicate unintended side effect
- If regression is artifact of this small sample: cleared for production
- Decision on deadline micro-correctif final status deferred to 25-doc run

---

## Next Steps

1. **Commit** this micro-correctif with sentinel results documented
2. **Do NOT declare production-ready** until final 25-doc benchmark confirms absence of systematic regression
3. **Proceed to Observation micro-correctif** using identical sentinel protocol
4. **Defer Decision micro-correctif** until after Observation passes sentinel threshold
5. **Run full 25-doc benchmark only** after all three micro-correctifs individually validated on sentinels

---

## Sentinel Corpus Details

- **7 documents scored**: JAR_CR04, MEL_CR03, QHSE_004, JAR_01, HER_CR01, EAU_001, VRD_005
- **Reference files used**: Frozen baseline comparison.json from `docs/qualification-runs/`
- **Extraction date**: 2026-08-20 (using deadline micro-correctif)
- **Scoring date**: 2026-08-21
- **Scoring methodology**: Element-by-element comparison against baseline reference.json for deadline family

---

**Prepared for**: Vincent  
**Status**: Ready for commit to main branch
