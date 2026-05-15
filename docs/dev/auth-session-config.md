# Configuration session Supabase — durée JWT

## Contexte (Slice J3, doctrine V5)

Le default Supabase = **JWT expiry 1 heure**. Sur le terrain (Joseph, Tarek, Sandrine),
chaque re-login pendant la journée = friction cumulative qui décroche l'agent.

Solution : étendre la durée du JWT à **24 heures** côté Supabase Dashboard.

## Procédure

1. https://supabase.com/dashboard/project/_/settings/auth
2. Section **JWT Settings** (ou **Authentication > Settings** selon version)
3. **JWT expiry limit** : `86400` (= 24 × 3600 = 24h)
4. Save

## Risque CHT / hospitalier

Le CHT Magenta peut exiger des sessions plus courtes pour les agents qui interviennent
en zone sensible (bionettoyage pédiatrie). Si demande explicite client : descendre à
**8 heures** (`28800`) = couvre une journée de travail sans re-login mid-shift.

À arbitrer pendant le pilote, mardi-mercredi, après observation.

## Côté code

- `lib/supabase/client.ts` utilise `createBrowserClient` avec défauts `@supabase/ssr` :
  - `persistSession: true` (localStorage)
  - `autoRefreshToken: true` (refresh automatique avant expiry)
- Le login form (`app/(auth)/login/LoginForm.tsx`) affiche une case
  *« Garder ma session active sur cet appareil »* **cochée par défaut**.
  La case est cosmétique — la persistence est déjà active. Elle sert à rassurer
  l'agent terrain : *« Le système n'est pas en train de m'éjecter, je peux fermer
  l'onglet sans perdre ma session. »*

## Vérification post-config

Après changement :
1. Login en tant que `chef.noumea@memoria.local`
2. Ouvrir DevTools → Application → Local Storage
3. Chercher la clé `sb-*-auth-token`
4. Décoder le JWT (jwt.io) → vérifier `exp` à 24h dans le futur (`exp - iat = 86400`)
