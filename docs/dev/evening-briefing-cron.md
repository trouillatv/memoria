# Briefing du soir — Cron auto (Slice M2)

## État actuel

Page `/briefing` accessible aux admin/manager. Affiche le briefing du
**lendemain** par défaut, ou de la date passée en query param `?date=YYYY-MM-DD`.

**Maeva bookmark la page**, l'ouvre à 18h chaque soir. Pas d'envoi auto pour le pilote.

## Activation cron Vercel (post-pilote)

1. `vercel.json` à la racine :
   ```json
   {
     "crons": [
       {
         "path": "/api/cron/evening-briefing",
         "schedule": "0 18 * * *"
       }
     ]
   }
   ```
2. Créer la route `app/api/cron/evening-briefing/route.ts` qui :
   - Vérifie l'origin Vercel cron (`x-vercel-cron-signature` ou header `authorization`)
   - Calcule le briefing pour `tomorrowUtcIso()`
   - Envoie un email via Resend / SendGrid / autre service à `MAEVA_EMAIL` (env var)
3. Service mail : recommandation **Resend** (free tier 3k mails/mois, simple SDK).

## Format email

Sujet : `[MemorIA] Briefing — jeudi 14 mai 2026`

Corps (texte simple, sans HTML lourd) :
```
Maeva,

Demain (jeudi 14 mai) :
  • 23 interventions prévues
  • 4 équipes mobilisées
  • 0 site sans couverture
  • 1 intervention non-affectée

→ Voir la page complète : {APP_ORIGIN}/briefing?date=2026-05-14

Tu peux te coucher en paix.
```

Pas d'emoji bavard. Pas de "URGENT". Doctrine V5 Pilier 3 : préparation calme.

## Configuration

- `MAEVA_EMAIL=maeva@agp-nettoyage.nc` (env var, server-only)
- `RESEND_API_KEY=re_xxx` (si Resend)
- `CRON_SECRET=...` pour vérifier l'origin du cron (si pas Vercel)

## Coût

Vercel Cron : gratuit jusqu'à 1 cron job sur le plan Hobby. Pro : 100 jobs.
Resend : 3000 mails/mois gratuits, suffisant pour 1 mail/jour × 30j = 30 mails.
