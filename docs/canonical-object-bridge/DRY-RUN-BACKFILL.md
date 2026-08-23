# Dry-run exhaustif — projection canonique sur les objets métier

**LECTURE SEULE. Aucune écriture émise.** Généré par `npx tsx scripts/_dryrun-canonical-projection.ts`,
qui appelle le helper de production `projectCanonicalSubjectOnObjects()` avec `dryRun: true` —
c'est donc bien le code qui s'exécuterait au backfill qui est observé ici, pas une réimplémentation d'audit.

Code projeté : `dd486f5f`. Date : 2026-08-24.

## Sortie brute intégrale

```text
◇ injected env (23) from .env.local // tip: ◈ encrypted .env [www.dotenvx.com]
DRY-RUN PROJECTION CANONIQUE — AUCUNE ÉCRITURE
Parc : 352 actions, 86 échéances.
FK déjà posée : 5 actions, 2 échéances.
Chantiers à balayer : 32

════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
LIGNES QUI SERAIENT ÉCRITES
════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

── OCEF Compostage (2c939e67) — 67 écriture(s) ──
  ACTION   09f5ee57 « Ne pas étaler les déblais sur la zone de travaux           »
      → sujet 1f818aec « Interdiction d'étaler les déblais »  [active]
      preuve=thread+materialization     winner: 1f818aec → 1f818aec  sauts=0
  ACTION   80e231b3 « Transmission rapport géotechnicien purge complémentaire    »
      → sujet 00f7763e « Rapport G3 Purge Complémentaire »  [active]
      preuve=thread+materialization     winner: 0d7d9d01 → 00f7763e  sauts=1
  ACTION   ab3eabfa « Balisage et couvertures provisoires regards ouverts        »
      → sujet 63cbf067 « Mise en place de balisage et couvertures provisoires »  [active]
      preuve=thread+materialization     winner: 63cbf067 → 63cbf067  sauts=0
  ACTION   de6f3245 « Évacuation des déblais de fouilles                         »
      → sujet 8c77d070 « Évacuation Déblais Fouilles »  [active]
      preuve=thread+materialization     winner: 8c77d070 → 8c77d070  sauts=0
  ACTION   64ef9737 « Avis G3 sur essais plateforme support de dalle             »
      → sujet 714cf080 « Avis G3 — essais plateforme support de dalle »  [active]
      preuve=thread+materialization     winner: 714cf080 → 714cf080  sauts=0
  ACTION   2f5cc3f5 « Maintien signalisation traversée de voirie                 »
      → sujet 0b1dc811 « Signalisation traversée de voirie »  [active]
      preuve=thread+materialization     winner: 0b1dc811 → 0b1dc811  sauts=0
  ACTION   b80c2f53 « Transmission fiches techniques matériaux et équipements    »
      → sujet 9e7bc5cb « Transmission FT Matériaux & Équipements »  [active]
      preuve=thread+materialization     winner: 0a326b45 → 9e7bc5cb  sauts=1
  ACTION   712b2bd2 « Essais béton (éprouvette ou carottage) – A prévoir         »
      → sujet 76bb60a9 « Essais béton (éprouvette ou carottage) »  [active]
      preuve=thread+materialization     winner: 76bb60a9 → 76bb60a9  sauts=0
  ACTION   6840da1c « Prévoir essais béton (éprouvette ou carottage)             »
      → sujet 76bb60a9 « Essais béton (éprouvette ou carottage) »  [active]
      preuve=thread+materialization     winner: 76bb60a9 → 76bb60a9  sauts=0
  ACTION   c4695ac0 « Transmettre FT Débitmètre                                  »
      → sujet 99c2ed5e « Demande de FT et plans – Débitmètre, Dégrilleur, Reg »  [active]
      preuve=thread+materialization     winner: 99c2ed5e → 99c2ed5e  sauts=0
  ACTION   09991085 « Réalisation essais panda pour validation compactage        »
      → sujet 10454287 « Compactage tranchée assainissement & Essais PANDA »  [active]
      preuve=thread+materialization     winner: a9610ccf → 10454287  sauts=1
  ACTION   51e313bc « Transmission photos et rapport G3 purge complémentaire     »
      → sujet 00f7763e « Rapport G3 Purge Complémentaire »  [active]
      preuve=thread+materialization     winner: 00f7763e → 00f7763e  sauts=0
  ACTION   e94e7345 « Transmission FT débourbeur déshuileur                      »
      → sujet ce73b108 « Zone déshuileur »  [active]
      preuve=thread+materialization     winner: ce73b108 → ce73b108  sauts=0
  ACTION   25ef3b27 « Demande de plan de reprise du réseau d’assainissement pour »
      → sujet 8803cfd5 « Demande de plan de reprise du réseau d’assainissemen »  [active]
      preuve=thread+materialization     winner: 8803cfd5 → 8803cfd5  sauts=0
  ACTION   3cb39044 « Prévoir essais béton (éprouvette ou carottage)             »
      → sujet 76bb60a9 « Essais béton (éprouvette ou carottage) »  [active]
      preuve=thread+materialization     winner: 76bb60a9 → 76bb60a9  sauts=0
  ACTION   95d824ff « Transmission des photos et rapport G3 pour purge complémen »
      → sujet 00f7763e « Rapport G3 Purge Complémentaire »  [active]
      preuve=thread+materialization     winner: 00f7763e → 00f7763e  sauts=0
  ACTION   dfe7b955 « FT Débitmètre à transmettre (RAPPEL)                       »
      → sujet 99c2ed5e « Demande de FT et plans – Débitmètre, Dégrilleur, Reg »  [active]
      preuve=thread+materialization     winner: 99c2ed5e → 99c2ed5e  sauts=0
  ACTION   655c79cc « Rapport pour purge complémentaire (RAPPELx6)               »
      → sujet 00f7763e « Rapport G3 Purge Complémentaire »  [active]
      preuve=thread+materialization     winner: d58dc26b → 00f7763e  sauts=1
  ACTION   b20c5557 « Avis G3 sur les essais de la plateforme support de dalle   »
      → sujet 714cf080 « Avis G3 — essais plateforme support de dalle »  [active]
      preuve=thread+materialization     winner: 714cf080 → 714cf080  sauts=0
  ACTION   a6a0c98e « Transmettre le plan de gestion des eaux                    »
      → sujet 8cf8b62d « Plan de gestion des eaux pluviales »  [active]
      preuve=thread+materialization     winner: 8cf8b62d → 8cf8b62d  sauts=0
  ACTION   52a250cb « Transmettre les fiches techniques des matériaux et équipem »
      → sujet 9e7bc5cb « Transmission FT Matériaux & Équipements »  [active]
      preuve=thread+materialization     winner: 9e7bc5cb → 9e7bc5cb  sauts=0
  ACTION   dc67823e « Transmettre les relevés météo                              »
      → sujet ae7e9bb3 « Transmettre les relevés météo »  [active]
      preuve=thread+materialization     winner: ae7e9bb3 → ae7e9bb3  sauts=0
  ACTION   423df152 « Transmission photos et rapport G3 pour purge complémentair »
      → sujet 00f7763e « Rapport G3 Purge Complémentaire »  [active]
      preuve=thread+materialization     winner: 237515c5 → 00f7763e  sauts=1
  ACTION   588fb103 « Demande de plans et FT pour Regards, Débitmètre, dégrilleu »
      → sujet 99c2ed5e « Demande de FT et plans – Débitmètre, Dégrilleur, Reg »  [active]
      preuve=thread+materialization     winner: 99c2ed5e → 99c2ed5e  sauts=0
  ACTION   787c3728 « Demande de plan de détail du dégrilleur et plan de détail  »
      → sujet 99c2ed5e « Demande de FT et plans – Débitmètre, Dégrilleur, Reg »  [active]
      preuve=thread+materialization     winner: f3e6d83d → 99c2ed5e  sauts=2
  ACTION   82096eb6 « Transmettre les fiches techniques des matériaux et équipem »
      → sujet 9e7bc5cb « Transmission FT Matériaux & Équipements »  [active]
      preuve=thread+materialization     winner: 9e7bc5cb → 9e7bc5cb  sauts=0
  ACTION   793b0ca1 « Contrôle particulier via caméra à prévoir pour zone déshui »
      → sujet ce73b108 « Zone déshuileur »  [active]
      preuve=thread+materialization     winner: ce73b108 → ce73b108  sauts=0
  ACTION   d64e93dc « Reprise du nivellement suivant plan annexé au VISA – zone  »
      → sujet cf50330e « Reprise du nivellement suivant plan annexé au VISA 0 »  [active]
      preuve=thread+materialization     winner: cf50330e → cf50330e  sauts=0
  ACTION   809a9e94 « FT débourbeur déshuileur à retransmettre (transmission non »
      → sujet ce73b108 « Zone déshuileur »  [active]
      preuve=thread+materialization     winner: ce73b108 → ce73b108  sauts=0
  ACTION   8f604337 « Transmettre FT Dégrilleur                                  »
      → sujet 99c2ed5e « Demande de FT et plans – Débitmètre, Dégrilleur, Reg »  [active]
      preuve=thread+materialization     winner: 99c2ed5e → 99c2ed5e  sauts=0
  ACTION   04b2741e « Fournir courrier et proposition pour rapport purge complém »
      → sujet 00f7763e « Rapport G3 Purge Complémentaire »  [active]
      preuve=thread+materialization     winner: 9a243bc5 → 00f7763e  sauts=1
  ACTION   60e83f6b « Fournir plans et FT pour Regards, Débitmètre, Dégrilleur e »
      → sujet 99c2ed5e « Demande de FT et plans – Débitmètre, Dégrilleur, Reg »  [active]
      preuve=thread+materialization     winner: 99c2ed5e → 99c2ed5e  sauts=0
  ACTION   886045fe « Reprise du nivellement suivant plan annexé au VISA         »
      → sujet cf50330e « Reprise du nivellement suivant plan annexé au VISA 0 »  [active]
      preuve=thread+materialization     winner: cf50330e → cf50330e  sauts=0
  ACTION   e3dc71b1 « Mise en place et maintien de la signalisation de chantier  »
      → sujet 062ccaea « Mise en place et maintien de la signalisation de cha »  [active]
      preuve=thread+materialization     winner: 062ccaea → 062ccaea  sauts=0
  ACTION   a1a271c2 « Mise en place de balisage et couvertures provisoires pour  »
      → sujet 63cbf067 « Mise en place de balisage et couvertures provisoires »  [active]
      preuve=thread+materialization     winner: 63cbf067 → 63cbf067  sauts=0
  ACTION   df63938a « Transmettre les fiches techniques des matériaux et équipem »
      → sujet 9e7bc5cb « Transmission FT Matériaux & Équipements »  [active]
      preuve=thread+materialization     winner: 9e7bc5cb → 9e7bc5cb  sauts=0
  ACTION   aebe22b1 « Fournir plan de reprise du réseau d'assainissement         »
      → sujet 8803cfd5 « Demande de plan de reprise du réseau d’assainissemen »  [active]
      preuve=thread+materialization     winner: 8803cfd5 → 8803cfd5  sauts=0
  ACTION   61ef8b97 « Fournir plan de détail du dégrilleur et du débitmètre      »
      → sujet 99c2ed5e « Demande de FT et plans – Débitmètre, Dégrilleur, Reg »  [active]
      preuve=thread+materialization     winner: 99743b54 → 99c2ed5e  sauts=2
  ACTION   af11a78a « Transmettre les fiches techniques des matériaux et équipem »
      → sujet 9e7bc5cb « Transmission FT Matériaux & Équipements »  [active]
      preuve=thread+materialization     winner: 4f473318 → 9e7bc5cb  sauts=1
  ACTION   6b5e9fb4 « Reprise du nivellement suivant plan annexé au VISA – zone  »
      → sujet 887f3a40 « Reprise du nivellement – zone hors tolérance »  [active]
      preuve=thread+materialization     winner: 887f3a40 → 887f3a40  sauts=0
  ACTION   44e36c69 « Transmettre les fiches techniques des matériaux et équipem »
      → sujet 9e7bc5cb « Transmission FT Matériaux & Équipements »  [active]
      preuve=thread+materialization     winner: 9e7bc5cb → 9e7bc5cb  sauts=0
  ACTION   3356f8ed « Retour des situations approuvées par le maître d'ouvrage   »
      → sujet 336cb0fb « Retour situations approuvées MOA »  [active]
      preuve=thread+materialization     winner: 336cb0fb → 336cb0fb  sauts=0
  ACTION   854b0d03 « Transmettre le plan de gestion des eaux                    »
      → sujet 8cf8b62d « Plan de gestion des eaux pluviales »  [active]
      preuve=thread+materialization     winner: 8cf8b62d → 8cf8b62d  sauts=0
  ACTION   2c3d493f « Transmettre les fiches techniques des matériaux et équipem »
      → sujet 9e7bc5cb « Transmission FT Matériaux & Équipements »  [active]
      preuve=thread+materialization     winner: 9e7bc5cb → 9e7bc5cb  sauts=0
  ACTION   929b4c9d « Rapport pour purge complémentaire                          »
      → sujet 00f7763e « Rapport G3 Purge Complémentaire »  [active]
      preuve=thread+materialization     winner: 237515c5 → 00f7763e  sauts=1
  ACTION   d8613781 « Avis G3 sur les essais de la plateforme support de dalle   »
      → sujet 714cf080 « Avis G3 — essais plateforme support de dalle »  [active]
      preuve=thread+materialization     winner: 714cf080 → 714cf080  sauts=0
  ACTION   3552a549 « Transmission des photos et rapport G3 pour purge complémen »
      → sujet 00f7763e « Rapport G3 Purge Complémentaire »  [active]
      preuve=thread+materialization     winner: 237515c5 → 00f7763e  sauts=1
  ACTION   ca9ac759 « Transmission date visite mairie pour réseaux               »
      → sujet 63cda5e8 « Transmission date visite mairie pour réseaux »  [active]
      preuve=thread+materialization     winner: 63cda5e8 → 63cda5e8  sauts=0
  ACTION   1399d34a « Confirmer visite mairie avant remblaiement busage          »
      → sujet 55a085d5 « Confirmer visite mairie avant remblaiement busage »  [active]
      preuve=thread+materialization     winner: 55a085d5 → 55a085d5  sauts=0
  ACTION   fdb31090 « Coordination LOT01 et LOT02 pour réseaux sous-dalle        »
      → sujet ef62540a « Coordination à faire entre LOT01 et LOT02 »  [active]
      preuve=thread+materialization     winner: ef62540a → ef62540a  sauts=0
  ACTION   7a5a7b63 « Enlever planche de coffrage regard                         »
      → sujet 6bd12a5b « Planche de coffrage regard à enlever »  [active]
      preuve=thread+materialization     winner: 6bd12a5b → 6bd12a5b  sauts=0
  ACTION   cc4598cd « Reprise du nivellement zone hors tolérance                 »
      → sujet cf50330e « Reprise du nivellement suivant plan annexé au VISA 0 »  [active]
      preuve=thread+materialization     winner: cf50330e → cf50330e  sauts=0
  ÉCHÉANCE 4909c6cf « Présentation des situations du mois                        »
      → sujet 08c0a346 « Présentation des situations mensuelles »  [active]
      preuve=materialization            winner: 08c0a346 → 08c0a346  sauts=0
  ÉCHÉANCE 0c3f5445 « Présentation des situations du mois                        »
      → sujet 08c0a346 « Présentation des situations mensuelles »  [active]
      preuve=materialization            winner: c05fa9c6 → 08c0a346  sauts=1
  ÉCHÉANCE b3485669 « Récolement pour réception du lot 02                        »
      → sujet 31676a77 « Réception du lot 02 (Récolement & Essais) »  [active]
      preuve=materialization            winner: 31676a77 → 31676a77  sauts=0
  ÉCHÉANCE 1898319c « Prochaine réunion de chantier                              »
      → sujet 9474c218 « Prochaine réunion de chantier »  [active]
      preuve=materialization            winner: 9474c218 → 9474c218  sauts=0
  ÉCHÉANCE a3b283a1 « Présentation des situations du mois en cours               »
      → sujet 08c0a346 « Présentation des situations mensuelles »  [active]
      preuve=materialization            winner: c05fa9c6 → 08c0a346  sauts=1
  ÉCHÉANCE 55dbb734 « Essais pour réception du lot 02                            »
      → sujet 31676a77 « Réception du lot 02 (Récolement & Essais) »  [active]
      preuve=materialization            winner: 94ca01a1 → 31676a77  sauts=1
  ÉCHÉANCE 9d187704 « Présentation des situations du mois en cours               »
      → sujet 08c0a346 « Présentation des situations mensuelles »  [active]
      preuve=materialization            winner: c05fa9c6 → 08c0a346  sauts=1
  ÉCHÉANCE 484c921a « Présentation des situations mensuelles                     »
      → sujet 08c0a346 « Présentation des situations mensuelles »  [active]
      preuve=materialization            winner: 2004d26d → 08c0a346  sauts=1
  ÉCHÉANCE 384a5523 « Prochaine réunion de chantier                              »
      → sujet 9474c218 « Prochaine réunion de chantier »  [active]
      preuve=materialization            winner: 9474c218 → 9474c218  sauts=0
  ÉCHÉANCE c32634d6 « Présentation des situations du mois en cours avant le 25 d »
      → sujet 08c0a346 « Présentation des situations mensuelles »  [active]
      preuve=materialization            winner: c05fa9c6 → 08c0a346  sauts=1
  ÉCHÉANCE 3081d9e3 « Présenter les situations du mois en cours                  »
      → sujet 08c0a346 « Présentation des situations mensuelles »  [active]
      preuve=materialization            winner: c05fa9c6 → 08c0a346  sauts=1
  ÉCHÉANCE 7c17ec33 « Présentation des situations du mois en cours avant le 25 d »
      → sujet 08c0a346 « Présentation des situations mensuelles »  [active]
      preuve=materialization            winner: 649b1987 → 08c0a346  sauts=1
  ÉCHÉANCE c955961c « Reprise du réseau pour problème regard R4 (manque chute) p »
      → sujet 4fb967c3 « Regard R4 »  [active]
      preuve=materialization            winner: 4fb967c3 → 4fb967c3  sauts=0
  ÉCHÉANCE 61e49fd7 « Prochaine réunion de chantier                              »
      → sujet 9474c218 « Prochaine réunion de chantier »  [active]
      preuve=materialization            winner: 9474c218 → 9474c218  sauts=0
  ÉCHÉANCE a4006fdb « Présentation des situations du mois en cours               »
      → sujet 08c0a346 « Présentation des situations mensuelles »  [active]
      preuve=materialization            winner: 649b1987 → 08c0a346  sauts=1

── OCEF Compostage (06c62e48) — 32 écriture(s) ──
  ACTION   a08a142a « Avis G3 sur les essais de la plateforme support de dalle   »
      → sujet fdac7034 « Terrassement et purge plateforme »  [active]
      preuve=materialization            winner: fdac7034 → fdac7034  sauts=0
  ACTION   b312a263 « Transmettre les fiches techniques des matériaux et équipem »
      → sujet 79e0509e « Assainissement sous plateforme (busages, regards, vi »  [active]
      preuve=materialization            winner: 79e0509e → 79e0509e  sauts=0
  ACTION   a054144a « Transmettre FT débourbeur déshuileur                       »
      → sujet 79e0509e « Assainissement sous plateforme (busages, regards, vi »  [active]
      preuve=materialization            winner: 79e0509e → 79e0509e  sauts=0
  ACTION   7f3b9b95 « Transmission photos et rapport G3 purge complémentaire     »
      → sujet fdac7034 « Terrassement et purge plateforme »  [active]
      preuve=materialization            winner: fdac7034 → fdac7034  sauts=0
  ACTION   7c3a32a9 « Assainissement : FT Débourbeur déshuileur à retransmettre  »
      → sujet 79e0509e « Assainissement sous plateforme (busages, regards, vi »  [active]
      preuve=materialization            winner: 79e0509e → 79e0509e  sauts=0
  ACTION   8c1a9451 « Avis G3 sur les essais de la plateforme support de dalle   »
      → sujet fdac7034 « Terrassement et purge plateforme »  [active]
      preuve=materialization            winner: fdac7034 → fdac7034  sauts=0
  ACTION   fbd8a691 « Transmission des photos et rapport G3 pour purge complémen »
      → sujet fdac7034 « Terrassement et purge plateforme »  [active]
      preuve=materialization            winner: fdac7034 → fdac7034  sauts=0
  ACTION   6702fa50 « Reprise du nivellement suivant plan annexé au VISA – zone  »
      → sujet 1077083e « Reprise nivellement général »  [active]
      preuve=materialization            winner: 1077083e → 1077083e  sauts=0
  ACTION   9c113aeb « Transmission des photos et rapport G3 pour purge complémen »
      → sujet fdac7034 « Terrassement et purge plateforme »  [active]
      preuve=materialization            winner: fdac7034 → fdac7034  sauts=0
  ACTION   3832f26f « Fournir Plan de reprise du réseau d’assainissement pour la »
      → sujet ff89bd59 « Plan de reprise réseau assainissement (dégrilleur/dé »  [active]
      preuve=materialization            winner: ff89bd59 → ff89bd59  sauts=0
  ACTION   ad1ba864 « Prévoir essais béton (éprouvette ou carottage)             »
      → sujet 44694719 « Essais béton (éprouvette, carottage, PANDA) sur tran »  [active]
      preuve=materialization            winner: 44694719 → 44694719  sauts=0
  ACTION   9d671ca5 « Transmettre les fiches techniques des matériaux et équipem »
      → sujet 79e0509e « Assainissement sous plateforme (busages, regards, vi »  [active]
      preuve=materialization            winner: 79e0509e → 79e0509e  sauts=0
  ACTION   a9be1009 « Reprise du nivellement suivant plan annexé au VISA – zone  »
      → sujet 1077083e « Reprise nivellement général »  [active]
      preuve=materialization            winner: 1077083e → 1077083e  sauts=0
  ACTION   cdb02b79 « Prévoir carottage si les éprouvettes ne sont pas effectuée »
      → sujet 44694719 « Essais béton (éprouvette, carottage, PANDA) sur tran »  [active]
      preuve=materialization            winner: 44694719 → 44694719  sauts=0
  ACTION   0e708268 « Fournir Plan de détail du dégrilleur et plan de détail du  »
      → sujet 015cc0af « FT et plans de détail du dégrilleur »  [active]
      preuve=materialization            winner: 015cc0af → 015cc0af  sauts=0
  ACTION   aefd1596 « Transmettre les fiches techniques des matériaux et équipem »
      → sujet 79e0509e « Assainissement sous plateforme (busages, regards, vi »  [active]
      preuve=materialization            winner: 79e0509e → 79e0509e  sauts=0
  ACTION   48e4681d « Plan de gestion des eaux à transmettre                     »
      → sujet 2356ba66 « Plan de gestion des eaux »  [active]
      preuve=materialization            winner: 2356ba66 → 2356ba66  sauts=0
  ACTION   72c204f8 « Transmettre les fiches techniques des matériaux et équipem »
      → sujet 69ccbbcb « Mise en place de la couche de forme »  [active]
      preuve=materialization            winner: 69ccbbcb → 69ccbbcb  sauts=0
  ACTION   6fbfe3a9 « Transmettre les fiches techniques des matériaux et équipem »
      → sujet 79e0509e « Assainissement sous plateforme (busages, regards, vi »  [active]
      preuve=materialization            winner: 79e0509e → 79e0509e  sauts=0
  ACTION   de954b0e « Transmettre les fiches techniques des matériaux et équipem »
      → sujet 69ccbbcb « Mise en place de la couche de forme »  [active]
      preuve=materialization            winner: 69ccbbcb → 69ccbbcb  sauts=0
  ACTION   59eb4e8d « Transmission des photos et rapport G3 pour purge complémen »
      → sujet fdac7034 « Terrassement et purge plateforme »  [active]
      preuve=materialization            winner: fdac7034 → fdac7034  sauts=0
  ACTION   a10356eb « Plan de gestion des eaux à transmettre par l’entreprise    »
      → sujet 2356ba66 « Plan de gestion des eaux »  [active]
      preuve=materialization            winner: 2356ba66 → 2356ba66  sauts=0
  ACTION   6ad24af5 « Transmettre les fiches techniques des matériaux et équipem »
      → sujet 79e0509e « Assainissement sous plateforme (busages, regards, vi »  [active]
      preuve=materialization            winner: 79e0509e → 79e0509e  sauts=0
  ACTION   259288e6 « Plan de gestion des eaux à transmettre                     »
      → sujet 2356ba66 « Plan de gestion des eaux »  [active]
      preuve=materialization            winner: 2356ba66 → 2356ba66  sauts=0
  ACTION   673948cc « Rapport G3 pour purge complémentaire                       »
      → sujet fdac7034 « Terrassement et purge plateforme »  [active]
      preuve=materialization            winner: fdac7034 → fdac7034  sauts=0
  ACTION   37e998ad « Reprise du nivellement                                     »
      → sujet 1077083e « Reprise nivellement général »  [active]
      preuve=materialization            winner: 1077083e → 1077083e  sauts=0
  ÉCHÉANCE 4e304c62 « Essais pour réception du lot 02                            »
      → sujet b3626ca3 « Coordination Réseaux sous-dalle LOT01 et LOT02 »  [active]
      preuve=materialization            winner: b3626ca3 → b3626ca3  sauts=0
  ÉCHÉANCE e705156c « Présentation des situations du mois en cours               »
      → sujet f9583feb « OECF »  [active]
      preuve=materialization            winner: f9583feb → f9583feb  sauts=0
  ÉCHÉANCE fd790106 « Présentation des situations du mois en cours avant le 25 d »
      → sujet f9583feb « OECF »  [active]
      preuve=materialization            winner: f9583feb → f9583feb  sauts=0
  ÉCHÉANCE 66295eb4 « Présentation des situations du mois en cours               »
      → sujet f9583feb « OECF »  [active]
      preuve=materialization            winner: f9583feb → f9583feb  sauts=0
  ÉCHÉANCE 4c811f96 « Présentation des situations du mois en cours               »
      → sujet f9583feb « OECF »  [active]
      preuve=materialization            winner: f9583feb → f9583feb  sauts=0
  ÉCHÉANCE 54acd830 « Présentation des situations du mois en cours avant le 25 d »
      → sujet f9583feb « OECF »  [active]
      preuve=materialization            winner: f9583feb → f9583feb  sauts=0

── Ocef4 (ba4f3567) — 8 écriture(s) ──
  ACTION   3f307a75 « Transmettre les relevés météo                              »
      → sujet 5be4b0e1 « DUMEZ »  [active]
      preuve=materialization            winner: 5be4b0e1 → 5be4b0e1  sauts=0
  ACTION   f4ec0f18 « Transmettre les fiches techniques des matériaux et équipem »
      → sujet 5be4b0e1 « DUMEZ »  [active]
      preuve=materialization            winner: 5be4b0e1 → 5be4b0e1  sauts=0
  ACTION   8d513dbe « Transmettre le plan de gestion des eaux                    »
      → sujet 5be4b0e1 « DUMEZ »  [active]
      preuve=materialization            winner: 5be4b0e1 → 5be4b0e1  sauts=0
  ACTION   6451eb59 « Transmettre les relevés météo                              »
      → sujet 5be4b0e1 « DUMEZ »  [active]
      preuve=materialization            winner: 5be4b0e1 → 5be4b0e1  sauts=0
  ACTION   241ddcdd « Transmettre les fiches techniques des matériaux et équipem »
      → sujet 5be4b0e1 « DUMEZ »  [active]
      preuve=materialization            winner: 5be4b0e1 → 5be4b0e1  sauts=0
  ACTION   61929abd « Transmettre le plan de gestion des eaux                    »
      → sujet 5be4b0e1 « DUMEZ »  [active]
      preuve=materialization            winner: 5be4b0e1 → 5be4b0e1  sauts=0
  ÉCHÉANCE 30ff3d55 « Présentation des situations du mois en cours               »
      → sujet 5be4b0e1 « DUMEZ »  [active]
      preuve=materialization            winner: 5be4b0e1 → 5be4b0e1  sauts=0
  ÉCHÉANCE 1837ae87 « Présentation des situations du mois en cours               »
      → sujet 5be4b0e1 « DUMEZ »  [active]
      preuve=materialization            winner: 5be4b0e1 → 5be4b0e1  sauts=0

── OCEF6 (655edb00) — 8 écriture(s) ──
  ACTION   29a92386 « Transmettre les fiches techniques des matériaux et équipem »
      → sujet 49cbc53c « Transmettre les fiches techniques des matériaux et é »  [active]
      preuve=thread+materialization     winner: 49cbc53c → 49cbc53c  sauts=0
  ACTION   97f156be « Mise en place balisage et couvertures provisoires regards  »
      → sujet e7ad2243 « Mise en place balisage et couvertures provisoires re »  [active]
      preuve=thread+materialization     winner: e7ad2243 → e7ad2243  sauts=0
  ACTION   def96752 « Sondage à effectuer au niveau du point de raccordement     »
      → sujet 5f548fce « Sondage à effectuer au niveau du point de raccordeme »  [active]
      preuve=thread+materialization     winner: 5f548fce → 5f548fce  sauts=0
  ACTION   22913bc5 « Demande de plan de détail du dégrilleur et du débitmètre   »
      → sujet d53fd16a « Demande de plan de détail du dégrilleur et du débitm »  [active]
      preuve=thread+materialization     winner: d53fd16a → d53fd16a  sauts=0
  ACTION   9f742417 « Demande de plans et fiches techniques (Regards, Débitmètre »
      → sujet 6be503ff « Demande de plans et fiches techniques (Regards, Débi »  [active]
      preuve=thread+materialization     winner: 6be503ff → 6be503ff  sauts=0
  ACTION   0aaab400 « Reprise du nivellement suivant plan annexé au VISA         »
      → sujet aa86078f « Reprise du nivellement suivant plan annexé au VISA »  [active]
      preuve=thread+materialization     winner: aa86078f → aa86078f  sauts=0
  ÉCHÉANCE 18dc61d5 « Prochaine réunion de chantier                              »
      → sujet 09a5f8a1 « Prochaine réunion de chantier »  [active]
      preuve=materialization            winner: 09a5f8a1 → 09a5f8a1  sauts=0
  ÉCHÉANCE 45968cd7 « Présentation des situations du mois en cours               »
      → sujet 7b6c09f2 « Présentation des situations du mois en cours »  [active]
      preuve=materialization            winner: 7b6c09f2 → 7b6c09f2  sauts=0

── OCEF — Recette Chemin B (fae6149d) — 6 écriture(s) ──
  ACTION   cb250b89 « Transmettre les fiches techniques des matériaux et équipem »
      → sujet a0ee79e7 « Transmettre les fiches techniques des matériaux et é »  [active]
      preuve=thread+materialization     winner: a0ee79e7 → a0ee79e7  sauts=0
  ACTION   c7fda08c « Plan de reprise du réseau d'assainissement                 »
      → sujet 7d977cb9 « Plan de reprise du réseau d'assainissement »  [active]
      preuve=thread+materialization     winner: 7d977cb9 → 7d977cb9  sauts=0
  ACTION   aca72586 « Plan de détail du dégrilleur et du débitmètre              »
      → sujet 889b2565 « Plan de détail du dégrilleur et du débitmètre »  [active]
      preuve=thread+materialization     winner: 889b2565 → 889b2565  sauts=0
  ACTION   8f3bae07 « Reprise du nivellement suivant plan annexé au VISA         »
      → sujet 1fde2ccb « Reprise du nivellement suivant plan annexé au VISA »  [active]
      preuve=thread+materialization     winner: 1fde2ccb → 1fde2ccb  sauts=0
  ACTION   9af11d04 « Demande de plans et fiches techniques                      »
      → sujet 9b1f74e5 « Demande de plans et fiches techniques »  [auto_archived]
      preuve=thread+materialization     winner: 9b1f74e5 → 9b1f74e5  sauts=0
  ÉCHÉANCE 3204888b « Présentation des situations du mois en cours               »
      → sujet dbd20ddf « Présentation des situations du mois en cours »  [active]
      preuve=materialization            winner: dbd20ddf → dbd20ddf  sauts=0

── Lycée PETRO ATTITI (75bd3d23) — 1 écriture(s) ──
  ACTION   50c306b1 « Présenter le cadenas à code lors de l'accueil sécurité     »
      → sujet 6801ce5c « Accès sécurisé au chantier (portail et cadenas à cod »  [active]
      preuve=promotion                  winner: 6801ce5c → 6801ce5c  sauts=0

════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
CONTRÔLES
════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
  A. ambiguïtés (conflicting_evidence)     : 0  ✔
  B. cibles encore merged après résolution : 0  ✔
  C. cibles introuvables en base          : 0  ✔
  D. chaînes de fusion non résolues        : 0  (laissées NULL, non bloquant)

════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
SYNTHÈSE
════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
  écritures : 96 actions + 26 échéances = 122
  par chemin de preuve :
       63  materialization+thread
       58  materialization
        1  promotion
  par nombre de sauts de fusion :
      102  0 saut(s)
       18  1 saut(s)
        2  2 saut(s)
  non projetés :
      309  no_structural_evidence

  couverture FK avant → après (si le backfill était appliqué) :
     actions   : 5/352 (1.4 %) → 101/352 (28.7 %)
     échéances : 2/86 (2.3 %) → 28/86 (32.6 %)

════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
SENTINELLES NOMMÉES
════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
  ✔ Cadenas (accueil sécurité)   50c306b1 PROJETÉ   → 6801ce5c via promotion (sauts=0)
      « Présenter le cadenas à code lors de l'accueil sécurité »
  ✔ Eau panneaux                 dbb63cef DÉJÀ LIÉ  → 1d41b3f1 (FK préexistante)
      « Nettoyer l'autre côté du mur où l'eau s'écoule derrière les panneaux en bois »
  ✔ Planning                     99c99021 NULL      motif=no_structural_evidence
      « Transmettre le planning d’aménagement au client »
  ✔ Démarrage du nettoyages      f0a18663 NULL      motif=no_structural_evidence
      « Démarrage du nettoyages »

DRY-RUN TERMINÉ — aucune écriture émise. HARD STOP.
```
