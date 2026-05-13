# Préparation chefs d'équipe — Cron auto (Sprint 4 PC)

## État actuel — MVP (Option C dans le sprint)

- Page `/preparation` (admin/manager) génère à la demande la préparation du
  lendemain pour chaque chef d'équipe ayant des interventions planifiées.
- Maeva ouvre la page vers 18h, ajuste les toggles + note libre 140 chars,
  et envoie individuellement via le bouton **« Envoyer dans WhatsApp »** qui
  ouvre un deep link `wa.me/<phone>?text=<message>`.
- Aucun cron n'est activé. Aucun timestamp d'envoi n'est persisté en DB
  (Verrou V6). Badge UI « ✓ envoyé ce soir » purgé naturellement (clé
  localStorage qui contient la date ciblée).

## Doctrine V5 — rappels critiques avant toute activation cron

- **Pilier 3 (frontières humaines)** : NetoIAge prépare, WhatsApp livre. Le
  cron prépare un message — l'envoi reste humain.
- **Pilier 4 (DG amplifié)** : Maeva reste auteur signataire. Un cron qui
  enverrait automatiquement les WhatsApp à sa place casserait la doctrine.
- **Maxim 9** : envois 1-à-1 uniquement. Ne JAMAIS construire un envoi vers
  un groupe collectif, même technique.
- **Verrou V6** : pas de `last_preparation_sent_at` en DB.

## Activation cron Vercel (post-pilote, si la demande terrain remonte)

Si Maeva demande explicitement un déclenchement automatique (notification
push à 18h00 par exemple), ce qui suit définit le périmètre tolérable.

### Schéma `vercel.json`

```json
{
  "crons": [
    {
      "path": "/api/cron/preparation",
      "schedule": "0 18 * * *"
    }
  ]
}
```

### Route à créer

`app/api/cron/preparation/route.ts` qui :

1. Vérifie l'origin Vercel cron (`x-vercel-cron-signature` ou header
   `authorization` avec `CRON_SECRET`).
2. Appelle `generateChefEquipePreparations(tomorrowUtcIso())`.
3. **Limite explicite** : ne fait PAS l'envoi WhatsApp. Le cron peut au
   maximum envoyer UN email/notification push à Maeva pour lui rappeler
   « La préparation est prête, ouvre /preparation ».

### Configuration

- `MAEVA_EMAIL=maeva@agp-nettoyage.nc` (env var server-only)
- `CRON_SECRET=...` pour signer l'origin du cron
- `APP_ORIGIN=https://app.netoiage.com`

## Format de la notification (si activée)

Sujet : `[NetoIAge] Préparation du soir prête — N chefs d'équipe`

Corps :

```
Maeva,

Demain (jeudi 14 mai), 3 chefs d'équipe ont des interventions prévues.

→ Ouvrir /preparation : {APP_ORIGIN}/preparation
```

Wording strictement passif descriptif. Pas d'urgence injonctive.

## Anti-pattern à NE PAS coder

- ❌ Envoi WhatsApp automatique « au nom de Maeva ».
- ❌ Persistance d'un timestamp `preparation_sent_at` sur user/intervention.
- ❌ Compteur « combien de préparations Maeva a envoyé cette semaine ».
- ❌ Notification push individuelle au chef d'équipe (Pilier 3 : NetoIAge
  ne se bat pas contre WhatsApp sur sa fonction émotionnelle).

## Coût

Vercel Cron : gratuit (1 cron Hobby, 100 Pro). Resend si email : 3000/mois
gratuits, suffisant pour 1 notification/jour à Maeva.
