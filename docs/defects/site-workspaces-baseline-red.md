# Défaut de baseline — `site-workspaces.test.tsx` (CI main rouge)

**Statut : DETTE DE BASELINE — ouvert.** La branche `main` est techniquement rouge
sur ce seul test. Il ne doit PAS servir d'exception permanente aux lots suivants :
tant qu'il n'est pas corrigé, chaque lot doit démontrer que son diff est vert et
que ce rouge-ci est le même, antérieur et hors périmètre.

## Symptôme

Échec unique, reproductible en CI :

```
FAIL  unit tests/components/site-workspaces.test.tsx
  > site workspaces
  > makes documents a workspace for finding and receiving proofs without turning QR into a shortcut
Test Files  1 failed | 195 passed (196)
      Tests  1 failed | 1646 passed (1647)
```

## Domaine propriétaire

**Mémoire / documents / QR** (espaces de travail du chantier, preuves reçues par QR).
Rien à voir avec la télémétrie IA (lots 5.1A-*).

## Reproduction CI

- Run `29778995903` (commit `a7a83000`, lot 5.1A-1) — `build-and-test` → `Run npm run test:unit` : 1 failed / 1645 passed.
- Run `29792025561` (commit `78d387a9`, lot 5.1A-2) — même échec : 1 failed / 1646 passed.

Le job « DB schema reproducibility » est VERT sur ces mêmes commits : la
migration n'est pas en cause.

## Non causé par les lots 5.1A

Vérifié : `site-workspaces.test.tsx` n'importe rien du diff télémétrie (aucune
référence à `ai-outcome`, `trackAiOutcome`, `trackDebrief`, `MemoriaRetained`).
Domaine orthogonal. Le slice local des lots (`tests/lib tests/memory
tests/doctrine`) ne couvre pas `tests/components`, d'où la découverte tardive
via la CI.

## Dernier commit vert — à bisecter

- Le fichier de test a été touché pour la dernière fois par `9f442704`
  (« Mémoire — lot de finition », 2026-07-19). Ce n'est PAS forcément le dernier
  état vert : le test peut avoir cassé à cause d'un changement de SOURCE
  postérieur, pas du test lui-même.
- L'historique CI de `9f442704` n'est plus disponible (`gh run list --commit`
  renvoie vide — runs élagués). Le dernier vert exact n'est donc pas retrouvable
  à faible coût.
- **Ouvert** : bisecter localement entre `9f442704` et `a7a83000` sur ce seul
  fichier (`vitest run tests/components/site-workspaces.test.tsx`) pour isoler le
  commit fautif et son domaine — quand une machine avec assez de mémoire est
  disponible (les tests jsdom OOM sur la machine actuelle saturée).

## Sortie attendue

Correction par le propriétaire du domaine documents/QR, puis retour à une
baseline `main` entièrement verte — après quoi ce fichier est supprimé.
