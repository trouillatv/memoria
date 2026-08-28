# Relations — conservation de la causalité dans le pipeline visite (audit READ-ONLY)

**Statut : ANALYSÉ. Aucune écriture, aucun code/prompt/schéma/seuil modifié. HARD STOP.**
**Verdict : V2 — la preuve relationnelle existe et survit jusqu'aux propositions, mais ~69 % est perdue
à la MATÉRIALISATION de l'occurrence. Plus un point amont : la transcription brute n'est pas conservée.**

Question centrale : *quand une dépendance est réellement exprimée dans une visite, où est-elle conservée,
transformée ou perdue ?* Tracé sur toutes les visites `field_visit` réelles (`scripts/audit-visite-causalite.ts`).

---

## Étages du pipeline & lignée
`audio → transcription (transcript_raw/corrected) → debrief (site_reports.debrief_analysis: summary + rationale)
→ propositions (site_knowledge_proposals: title/body) → occurrence field_visit (label = title, note = body)`

## Mesure — phrases relationnelles conservées par étage (marqueurs + lecture des phrases)
| Étage | Phrases relationnelles (total, tous sites) | Taux vs étage précédent |
|---|---|---|
| 0 — transcription brute | **0** | — (colonnes transcript_* **vides partout**) |
| 1 — debrief (summary/rationale) | **22** | n/a (brut absent) |
| 2 — propositions | **29** | **132 %** (l'atomisation duplique, ne perd pas) |
| 3 — occurrence (label+note) | **9** | **31 %** ← ICI la perte (~69 %) |

Exemples de dépendances RÉELLES bien captées au debrief/proposition (donc pas un problème de matière) :
- « Le nettoyage général… **en remplacement du nettoyage du carrelage** » → *replaces* (2 sujets).
- « **AGP interviendra après la finalisation de la dépose** » → dépendance (mais AGP = acteur → hors périmètre, OK).
- « **Si les produits sont repris, cela empêcherait la revégétalisation** » → causal (2 sujets).
- « cadenas… **avant le démarrage du chantier** » → conservé jusqu'à l'occurrence (cas survivant).

---

## Où l'information est perdue — diagnostic
1. **Transcription brute non persistée** (`transcript_raw`/`transcript_corrected`/`text_input` = null sur les
   9+ visites). On ne peut donc PAS mesurer la perte audio→debrief. Si de vraies visites vocales stockaient
   la transcription, il faudrait re-mesurer cet étage. *(Observation amont, pas le cœur du problème ici.)*
2. **Debrief → propositions : pas de perte** (132 %). La synthèse Gemini conserve bien la clause relationnelle,
   dans le `summary` et les `rationale`/`body`.
3. **Propositions → occurrence : ~69 % perdu.** L'occurrence porte `note = body` de LA proposition réconciliée.
   Or la clause causale vit souvent (a) dans une proposition **`decision`/`knowledge`** distincte du sujet
   opérationnel, ou (b) dans un `rationale`/`summary` non recopié sur l'occurrence du sujet concerné. La clause
   n'est donc pas attachée à l'occurrence du bon sujet → le juge, qui lit les notes d'occurrences, ne la voit plus.

**Classification (grille Vincent) :**
- **A** (aucune dépendance exprimée) : POSTE 8, SIREIS, Bella, OCEF prod, OCEF Compostage prod → 0 partout. Normal.
- **B** (perdu au debrief) : **non** — debrief→propositions conserve (132 %).
- **C** (conservé dans l'occurrence, non exploité) : les 9 survivants → prêts pour la voie explicite, mais bloqués
  par cooc≥3 (cf. audit précédent).
- **D** (dépendance = acteur↔sujet) : « AGP après dépose » → acteur, correctement hors périmètre.
- **NOUVEAU (dominant)** : perte **propositions→occurrence** — la preuve existe mais ne s'attache pas à
  l'occurrence du sujet.

---

## Verdict : **V2** (+ note V1 amont)
La matière n'est PAS pauvre (contrairement à la 1re impression du comptage strict) : plusieurs visites portent
de vraies dépendances, bien formulées, conservées jusqu'aux propositions. **Le maillon qui casse est la
matérialisation de l'occurrence**, qui n'attache pas la clause relationnelle au sujet.

### Plus petit correctif proposé (À CONCEVOIR, PAS CODER dans ce lot)
Fidèle à ton architecture (« occurrence atomique + phrase source plus riche conservée en parallèle ») :
- **Conserver, au niveau de l'occurrence (ou d'une preuve rattachée), la phrase source relationnelle** quand
  la proposition/le debrief contient une clause reliant deux sujets — SANS créer de relation, SANS fusionner
  les sujets. Un champ « evidence relationnelle » (ou la préservation du `rationale`/de la phrase source dans
  la note) suffirait à rendre la preuve **cit-able** pour la future voie explicite.
- Ne PAS remettre en cause l'atomisation B2 : un document reste atomisé en sujets ; on ajoute seulement la
  **conservation parallèle** de la preuve inter-atomes.

### Séquence recommandée
1. **V2 d'abord** : préserver la preuve relationnelle à l'occurrence (petit correctif d'acquisition, aucune relation créée).
2. **Puis V3** : voie explicite (occurrence unique portant une clause relationnelle entre 2 sujets → candidat
   immédiat cooc=1 → même juge durci). Sans V2, la voie explicite manquerait la preuve à citer.
3. **Amont (V1, optionnel)** : vérifier que les futures visites vocales persistent bien `transcript_*` (aujourd'hui
   vides) — sinon l'audio riche est perdu avant même le debrief.

**Après cet audit : le prochain code doit être dans l'ACQUISITION de la preuve (V2), pas dans la détection.**
Coder la voie explicite maintenant serait prématuré (elle citerait une preuve souvent absente de l'occurrence).

---

## Garde-fous respectés
READ-ONLY intégral (`scripts/audit-visite-causalite.ts`, lectures + probe éphémère supprimé). Moteur PV/CR actif
et prompt validé NON touchés. Aucun changement de prompt/extraction/schéma/occurrence/relation/UX. Aucune écriture.
B2 non remis en cause. **HARD STOP après diagnostic.**
