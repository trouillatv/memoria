# Test de validation — Cron cleanup-orphaned-uploads

## Objectif
Vérifier que le cron nettoie correctement les uploads orphelins sans toucher aux uploads confirmés.

## Pré-requis
- Migration 270 appliquée
- Variable `CRON_SECRET` configurée
- Accès Supabase Studio (pour insérer des données de test)

---

## Scénario 1 — Upload `pending` > 72h

### Setup
```sql
INSERT INTO historical_pv_uploads (
  id,
  site_id,
  user_id,
  storage_path,
  original_filename,
  file_size,
  status,
  created_at
) VALUES (
  'test-pending-old-001'::uuid,
  '<SITE_ID>'::uuid,
  '<USER_ID>'::uuid,
  'historical-pv/<SITE_ID>/test-pending-old.pdf',
  'test-pending-old.pdf',
  1000000,
  'pending',
  now() - interval '73 hours'
);
```

### Upload manuel d'un fichier Storage (optionnel)
Via Supabase Storage UI ou CLI :
- Bucket : `documents`
- Path : `historical-pv/<SITE_ID>/test-pending-old.pdf`
- Contenu : n'importe quel fichier test

### Exécution
```bash
curl -X GET https://memorianc.vercel.app/api/cron/cleanup-orphaned-uploads \
  -H "Authorization: Bearer $CRON_SECRET"
```

### Attendu
- Réponse JSON : `{ ok: true, cleaned: 1, ... }`
- Upload `test-pending-old-001` : `status='failed'`, `error_message` contient "Nettoyage automatique"
- Fichier Storage supprimé (ou message "déjà absent" loggé)

---

## Scénario 2 — Upload `uploaded` > 72h (utilisateur a fermé la page)

### Setup
```sql
INSERT INTO historical_pv_uploads (
  id,
  site_id,
  user_id,
  storage_path,
  original_filename,
  file_size,
  status,
  created_at,
  uploaded_at
) VALUES (
  'test-uploaded-old-002'::uuid,
  '<SITE_ID>'::uuid,
  '<USER_ID>'::uuid,
  'historical-pv/<SITE_ID>/test-uploaded-old.pdf',
  'test-uploaded-old.pdf',
  2000000,
  'uploaded',
  now() - interval '74 hours',
  now() - interval '73 hours 30 minutes'
);
```

Uploader un vrai fichier à ce path dans Storage.

### Exécution
```bash
curl -X GET https://memorianc.vercel.app/api/cron/cleanup-orphaned-uploads \
  -H "Authorization: Bearer $CRON_SECRET"
```

### Attendu
- Réponse JSON : `{ ok: true, cleaned: 1, ... }`
- Upload `test-uploaded-old-002` : `status='failed'`
- Fichier Storage supprimé

---

## Scénario 3 — Upload `confirmed` > 72h (ne doit PAS être touché)

### Setup
```sql
INSERT INTO historical_pv_uploads (
  id,
  site_id,
  user_id,
  storage_path,
  original_filename,
  file_size,
  status,
  document_id,
  created_at,
  confirmed_at
) VALUES (
  'test-confirmed-old-003'::uuid,
  '<SITE_ID>'::uuid,
  '<USER_ID>'::uuid,
  'historical-pv/<SITE_ID>/test-confirmed-old.pdf',
  'test-confirmed-old.pdf',
  3000000,
  'confirmed',
  '<DOCUMENT_ID>'::uuid,
  now() - interval '100 hours',
  now() - interval '99 hours'
);
```

Uploader un vrai fichier à ce path dans Storage.

### Exécution
```bash
curl -X GET https://memorianc.vercel.app/api/cron/cleanup-orphaned-uploads \
  -H "Authorization: Bearer $CRON_SECRET"
```

### Attendu
- Réponse JSON : `{ ok: true, cleaned: 0, ... }` (aucun nettoyage)
- Upload `test-confirmed-old-003` : **inchangé** (`status='confirmed'`)
- Fichier Storage : **intact**

---

## Scénario 4 — Upload `pending` récent (< 72h, ne doit PAS être touché)

### Setup
```sql
INSERT INTO historical_pv_uploads (
  id,
  site_id,
  user_id,
  storage_path,
  original_filename,
  file_size,
  status,
  created_at
) VALUES (
  'test-pending-recent-004'::uuid,
  '<SITE_ID>'::uuid,
  '<USER_ID>'::uuid,
  'historical-pv/<SITE_ID>/test-pending-recent.pdf',
  'test-pending-recent.pdf',
  500000,
  'pending',
  now() - interval '24 hours'
);
```

### Exécution
```bash
curl -X GET https://memorianc.vercel.app/api/cron/cleanup-orphaned-uploads \
  -H "Authorization: Bearer $CRON_SECRET"
```

### Attendu
- Réponse JSON : `{ ok: true, cleaned: 0, ... }`
- Upload `test-pending-recent-004` : **inchangé** (`status='pending'`)

---

## Scénario 5 — Idempotence (fichier déjà absent)

### Setup
Reprendre `test-pending-old-001` déjà nettoyé au Scénario 1 (status='failed', fichier supprimé).

Forcer manuellement le retour à `pending` :
```sql
UPDATE historical_pv_uploads
SET status = 'pending', error_message = NULL
WHERE id = 'test-pending-old-001'::uuid;
```

**Ne PAS** réuploader le fichier Storage.

### Exécution
```bash
curl -X GET https://memorianc.vercel.app/api/cron/cleanup-orphaned-uploads \
  -H "Authorization: Bearer $CRON_SECRET"
```

### Attendu
- Réponse JSON : `{ ok: true, cleaned: 1, ... }`
- Log serveur : warning "Storage removal warning" (fichier déjà absent)
- Upload : `status='failed'` (marqué quand même)
- **Pas d'erreur bloquante** (idempotent)

---

## Cleanup des données de test

```sql
DELETE FROM historical_pv_uploads
WHERE id IN (
  'test-pending-old-001'::uuid,
  'test-uploaded-old-002'::uuid,
  'test-confirmed-old-003'::uuid,
  'test-pending-recent-004'::uuid
);
```

---

## Validation complète

✓ Tous les scénarios passent  
✓ Les uploads `confirmed` ne sont jamais touchés  
✓ Les uploads `pending` et `uploaded` > 72h sont nettoyés  
✓ L'idempotence fonctionne (fichier déjà absent = succès)  
✓ Les erreurs ne bloquent pas le lot

→ **Cron production-ready**
