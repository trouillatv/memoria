# MemorIA

> **Mémoire opérationnelle de chantier** — multi-métier (BTP/VRD, nettoyage, MOE…).

MemorIA capte ce qui se passe sur un chantier (réunions, photos, actions,
décisions, preuves), s'en souvient, et ramène la bonne information au bon moment.
Le moat n'est pas de générer du texte, c'est de **contextualiser la mémoire** et
de **survivre aux ruptures humaines** (départ, absence, passation).

La boucle de valeur :

**Réunion → Compte-rendu → Actions → (QR) Entreprise → Déclaration + Preuve →
Visite ciblée → Prochain CR pré-rempli**

👉 Manuel utilisateur complet (page par page) : [`docs/MODE_EMPLOI.md`](docs/MODE_EMPLOI.md) (rendu dans l'app sur `/manuel`).

## Doctrine

Principes immuables qui gouvernent le produit :

1. **La mémoire d'abord, jamais la notation des personnes.** Aucun score, aucun
   classement d'agents. Les chiffres parlent du lieu et de la mémoire.
2. **IA propose, humain valide.** L'artefact brut (audio, transcription) n'est
   jamais détruit ; la correction est une couche.
3. **Capter une déclaration, pas gérer le travail.** Le QR/lien entreprise capte
   un fait signé (Fait/Bloqué + photo), il ne pilote pas l'entreprise (anti-ERP).
4. **Déclaration ≠ vérité terrain.** La déclaration d'une entreprise et la
   validation MOE restent deux vérités distinctes.
5. **Sobriété calme.** Pas d'alerte rouge dramatisante, pas de gamification.
6. **Test d'admission de toute feature :** aide-t-elle à *mémoriser, démontrer
   ou transmettre* ? Sinon → on ne construit pas (anti usine à gaz).

Doctrines détaillées : [`docs/superpowers/doctrines/`](docs/superpowers/doctrines/).

## Stack

- Next.js (App Router, Server Actions, Server Components) — voir `AGENTS.md` (lire les guides `node_modules/next/dist/docs/` avant de coder)
- TypeScript 5 · Tailwind v4 (@theme) · shadcn/ui + base-ui
- Supabase Cloud (Postgres + Auth + Storage)
- vitest 4 + @testing-library/react
- exceljs (exports), pizzip + docxtemplater (Word), @react-pdf/renderer (PDF)

## Setup local

```bash
git clone https://github.com/trouillatv/memoria.git && cd memoria && npm install
# copier .env.example → .env.local et remplir (Supabase + provider IA)
npm run db:push            # applique les migrations supabase/migrations/*.sql
npm run db:bootstrap-admin # crée l'admin initial
npm run dev                # http://localhost:3001
```

Variables clés de `.env.local` : `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
`AI_PROVIDER` (`mock` par défaut, ou `gemini`/`anthropic` + la clé associée),
`INITIAL_ADMIN_EMAIL`, `INITIAL_ADMIN_PASSWORD`.

## Commandes utiles

```bash
npm run typecheck   # tsc --noEmit (0 erreur attendu)
npm run lint
npm test            # vitest — le projet `unit` (CI) ; les tests d'intégration lib/db frappent une vraie Supabase (.env.local)
npm run build       # next build (seul juge fiable de la frontière client/serveur)
```

## Cartographie des routes

| Zone | Routes | Rôle |
|---|---|---|
| Cockpit | `/dashboard` `/aujourdhui` `/semaine` `/briefing` `/actions` | admin/manager |
| Chantiers | `/sites` `/sites/[id]` (+ journal, photos, reserves, subjects, obligations, preuves, qr, scopes) | admin/manager |
| Réunions & CR | `/meetings` `/meetings/[id]` `/meetings/[id]/pv/validation` `/meetings/[id]/briefing` | admin/manager |
| Contrats/équipes | `/clients` `/contracts` `/missions` `/equipes` `/intervenants` | admin/manager |
| Continuité | `/handovers` (`/continuite` redirige ici) | admin/manager |
| Mémoire/recherche | `/recherche` `/memoire` | admin/manager |
| AO & biblio | `/tenders` `/tenders/[id]` `/library` `/documents` `/glossaire` | admin/manager |
| Preuves | `/preuves` `/litige` | admin/manager |
| Terrain (mobile) | `/m` …  | chef_equipe |
| Publics (sans login) | `/a/[token]` (actions entreprise) · `/i/[token]` (intervention) · `/h/[token]` (passation) · `/qr/[token]` · `/p/[token]` | public |
| Manuel | `/manuel` (rendu de `docs/MODE_EMPLOI.md`) | admin/manager |

## Structure dossier

- `app/(dashboard)/` — écrans desktop superviseur · `app/(field)/` — mobile terrain (`/m`)
- `app/a|i|h|qr|p/[token]/` — routes publiques tokenisées (sans login)
- `lib/db/` — helpers DB par entité · `lib/tenders/` — pipeline d'analyse AO
- `services/ai/` — providers IA (mock/gemini/anthropic) + agents + orchestrateur
- `supabase/migrations/` — schéma DB (appliquées via `npm run db:push`)
- `docs/MODE_EMPLOI.md` — manuel utilisateur (rendu sur `/manuel`)
- `docs/superpowers/` — doctrines, plans, notes, specs

## Sécurité

- **Aucun secret réel commité.** `.env.local` est gitignored. Un token exposé →
  le révoquer et le régénérer immédiatement.
- `INITIAL_ADMIN_PASSWORD` / mot de passe temporaire `memoria2026` : forcé à être
  changé à la première connexion (`must_change_password`).

## License

Propriétaire — usage interne MemorIA.
