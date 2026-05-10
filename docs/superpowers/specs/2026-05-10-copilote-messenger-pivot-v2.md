# Copilote AO V2 — Pivot Messenger (Conversations persistantes par agent)

**Date :** 2026-05-10
**Statut :** SPEC DIFFÉRÉ — non implémenté, à réévaluer après QA/démo V1
**Décision :** *« Très bonne idée, mais V2 »* (validé 2026-05-10)
**Pré-requis :** Patches V1 livrés sur `feat/copilote-restructure` (commits `2104f08` → `d632157`)

---

## 1. Contexte de la décision

Lors de la session UX du 2026-05-10, l'utilisateur a soulevé une intuition produit forte :

> *« On est en train de dériver d'un simple "chat IA" vers quelque chose de plus proche d'un Messenger / salon de discussion intelligent avec experts IA persistants. »*

Après analyse honnête, la direction a été jugée **bonne mais structurelle** — c'est un changement de catégorie produit, pas un patch UX. Décision prise :

- ✅ Reconnaître la valeur du modèle Messenger
- ✅ Documenter la cible précisément (ce document)
- ❌ NE PAS implémenter avant QA/démo V1
- 🔄 Réévaluer après usage réel : si la friction est suffisamment forte, déclencher le pivot

---

## 2. Mental model cible

### Avant (V1 — actuel)

> *« Le Copilote AO permet de consulter 7 agents IA via un chat multi-experts, avec des analyses persistées générées à la demande. »*

Un thread unique. À chaque turn, l'utilisateur sélectionne les agents qui répondent.

### Après (V2 — proposé)

> *« Le Copilote AO est un workspace de 7 experts IA persistants, scopés à votre AO. Chacun a sa mémoire des échanges. Vous les consultez en privé ou les confrontez en débat. Leurs analyses structurées (one-shot) sont disponibles à tout moment. »*

Chaque expert a sa propre conversation persistante. Multi-experts = un débat-room déterministe nommé par participants.

### Phrase-test pour le dirigeant non-tech

> *« Sur cet AO, j'ai 7 experts IA dans mon équipe. Je peux discuter avec chacun en privé, ou les faire débattre quand je veux. Et si j'ai besoin d'un avis structuré complet, je leur demande une analyse. »*

---

## 3. Bornes strictes (non-négociables)

Pour éviter de dériver vers un Slack inutile, le pivot est **borné sur 4 axes** :

| Axe | Décision | Raison |
|---|---|---|
| **Scope** | Per-tender exclusivement | Garde la mémoire propre. Le tender est l'unité de travail. Pas de cross-tender. |
| **Granularité** | 1 thread privé par agent + N débats par combinaison d'agents | Déterministe, pas de threads ad-hoc à nommer |
| **Naming** | Auto-généré (« Débat Contradicteur · Financier · Terrain ») | Pas de UI pour renommer = pas de bruit |
| **Séparation** | Analyse persistée (one-shot structuré) ≠ conversation (free-flow) — **ne JAMAIS les fusionner** | Deux produits différents qui partagent la matière première |

### À REJETER catégoriquement

- ❌ Threads nommables par l'utilisateur — trop d'UI, trop de bruit
- ❌ Mémoire cross-tender — risque légal + complexité backend
- ❌ Threading-in-thread (réponses imbriquées) — ce n'est pas Discord
- ❌ Notifications inter-tenders — *« 3 messages non-lus dans 4 AOs »* = stress
- ❌ Recherche full-text dans toutes les conversations — pour V3+

---

## 4. Architecture cognitive cible

```
TENDER (le dossier — unité de travail)
│
├─ Vue Synthèse (overview rapide — read-only)
├─ Vue Analyse détaillée (drill-down constraints/risques/checklist)
├─ Vue Mémoire technique (export-ready)
│
└─ Vue Copilote AO  (le workspace conversationnel)
   │
   ├─ Rail des experts (toujours visible, 56px)
   │  └─ 7 icônes avec dots (✓/⚙/—/⚠) · click = ouvre conversation/popover
   │
   ├─ Liste des Débats (sous le rail, ou rail latéral 2)
   │  └─ « Débat ⚖·💰·🚧 » (3 messages) · « Débat ⚖·📋 » (12 messages)
   │
   ├─ Conversation active (zone centrale dominante)
   │  ├─ Header : « Vous parlez avec ⚖ Contradicteur · sa question : … »
   │  ├─ Thread historique (vide si nouvelle conversation)
   │  ├─ Composer (textarea + send)
   │  └─ ModeCard simplifié au-dessus du composer (montre les participants)
   │
   └─ Drawer analyses persistées (à droite, slide-in à la demande)
      └─ Indépendant de la conversation
```

### Les 3 surfaces et leur cohabitation

| Surface | Type | Quand elle apparaît | Persistance |
|---|---|---|---|
| **Conversation** | Free-flowing chat | Active dans la zone centrale | DB par tender + agents |
| **Analyse persistée** | Artifact structuré (summary + key_points + sources) | Drawer slide-in à droite | DB par tender + agent (1-to-1) |
| **Débat** | Conversation à participants multiples | Active dans la zone centrale | DB par tender + agent-set |

**Règle d'or** : un agent peut avoir une analyse persistée SANS conversation, et une conversation SANS analyse. Les deux sont indépendants.

---

## 5. Schéma de données proposé

### Modification minimale — un champ ajouté

Table `tender_chat_messages` actuelle (déjà en place) :

```sql
tender_id           uuid
user_id             uuid | null
agent_name          text | null
role                text                    -- 'user' | 'agent'
content             text
metadata            jsonb                   -- { turn_id, challenge_round, sources, ... }
created_at          timestamptz
```

V2 — un seul ajout :

```sql
ALTER TABLE tender_chat_messages
  ADD COLUMN conversation_id uuid NOT NULL DEFAULT gen_random_uuid();
CREATE INDEX idx_tender_chat_conversation ON tender_chat_messages(tender_id, conversation_id);
```

### Dérivation déterministe du `conversation_id`

Pour rester simple : pas besoin d'une nouvelle table `conversations`. Le `conversation_id` est dérivé déterministiquement du tender + de la composition d'agents :

```ts
function deriveConversationId(tenderId: string, agents: ChatAgentName[]): string {
  const sortedAgents = [...agents].sort().join(',')
  // UUID v5 namespace-based, deterministic
  return uuidv5(`${tenderId}:${sortedAgents}`, NETOIAGE_NAMESPACE_UUID)
}
```

**Conséquence forte** : `[Contradicteur]` toujours = même conversation. `[Contradicteur, Financier]` = autre conversation. `[Financier, Contradicteur]` = même conversation que la précédente (tri).

Pas de listing à maintenir : `SELECT DISTINCT conversation_id, agents FROM messages WHERE tender_id = ?` donne les conversations actives.

### Migration des données existantes

Les messages V1 existants doivent recevoir un `conversation_id` cohérent. Stratégie :

```sql
UPDATE tender_chat_messages m
SET conversation_id = (
  -- Each turn_id becomes its own conversation in V2 (clean break)
  -- OR: group by sorted agents within a turn
  -- DECISION: 1 turn = 1 conversation_id (preserves legacy linearity)
  COALESCE((m.metadata->>'turn_id')::uuid, gen_random_uuid())
);
```

Risque : tous les anciens messages V1 deviennent une suite de "mini-conversations" séparées. Acceptable pour la transition (pas de perte de données, pas de confusion d'historique).

---

## 6. Frontend — composants à modifier ou créer

### Composants impactés

| Composant | Modification |
|---|---|
| `AtelierIATab` | State `activeConversation` (au lieu de `selectedAgents`). Filtrage des messages par `conversation_id`. |
| `AgentPanel` (rail) | Click ready icon → switch active conversation to that agent (pas drawer). Drawer accessible via second action. |
| `ModeCard` | Devient indicator « Vous parlez avec X » / « Débat avec X·Y·Z ». Sélecteur d'agents pour CRÉER une nouvelle conversation. |
| `AtelierMessageThread` | Reçoit messages déjà filtrés par conversation. Header conversation. |

### Composants à créer

- `ConversationsList.tsx` — sous le rail, liste des débats actifs sur ce tender
- `ConversationHeader.tsx` — en haut du thread chat, affiche participants + question signature
- `ConversationEmptyState.tsx` — quand l'utilisateur ouvre une conversation sans historique : « Vous n'avez pas encore parlé avec X sur cet AO. Posez-lui votre première question. »

### Server actions à modifier

- `sendChatMessageAction` — calcule conversation_id depuis agents + tender_id + persist
- Nouveau : `listConversationsByTender(tender_id)` — retourne `[{ conversation_id, agents[], lastMessageAt, messageCount }]`

---

## 7. Coût d'implémentation estimé

**Total : 2-3 jours pleins de travail soigné.**

Découpage :
1. Migration DB + dérivation conversation_id (½ jour)
2. Server actions ajustées (½ jour)
3. Frontend state lift de `selectedAgents` → `activeConversation` (1 jour)
4. UI ConversationsList + Header + EmptyState (½ jour)
5. Tests E2E des flows multi-conversations (½ jour)

Risque principal : régression UX sur la démo. À tester rigoureusement avant déploiement.

---

## 8. Critères de déclenchement du pivot

Le pivot V2 sera déclenché si **au moins 2 des 3 conditions** sont rencontrées en QA/démo V1 :

1. **Friction observée** : ≥ 30% des testeurs perdent le fil entre questions sur le même agent (« j'ai déjà demandé ça à Contradicteur, mais où est sa réponse ? »)
2. **Demande utilisateur explicite** : retours mentionnent l'envie de retrouver une conversation par expert
3. **Limitation produit ressentie** : la mémoire conversationnelle apparaît comme un manque vs un agrément

Si AUCUNE de ces conditions n'est rencontrée, le V1 est suffisant. Le pivot est **différé sans regret**.

---

## 9. Hors scope du pivot V2

Listé pour traçabilité, à replanifier en V3+ :

- Mémoire cross-tender (« souvenir global » de Contradicteur sur tous tes AOs)
- Recherche full-text dans les conversations
- Notifications de réponse asynchrone (« Contradicteur a réfléchi pendant la nuit »)
- Threading dans une conversation (réponses imbriquées)
- Conversations partagées entre managers d'une même org
- Pin / archive des conversations
- Rename de conversations

---

## 10. Validation

Spec validé pour différement par l'utilisateur le 2026-05-10 sur les bornes du § 3.

Décision actée : **patch UX-clarification (V1, livré commit `d632157`) avant pivot V2.** Réévaluation après QA/démo.
