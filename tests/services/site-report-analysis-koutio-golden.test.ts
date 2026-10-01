import { describe, it, expect, vi } from 'vitest'

// GOLDEN — incident réel meeting 5c31c717-641b-4dd4-afb4-33cf1251cd3a (Koutio
// Horizon, réunion #19, 2026-10-01). L'analyse échouait avec « Failed to parse
// output » : le transcript est intact et riche, le problème est uniquement
// TRANSCRIPT → ANALYSE STRUCTURÉE côté Gemini (schema natif absent + budget de
// sortie trop court). Appel RÉEL au provider configuré (pas de mock) : seul un
// vrai appel peut prouver que le correctif (geminiSchema + maxOutputTokens)
// fonctionne contre le vrai comportement du modèle. Ignoré si aucune clé API
// n'est configurée (CI sans secrets).

vi.mock('@/services/ai/tracking', () => ({
  withAITracking: vi.fn(async (_f: unknown, _u: unknown, fn: () => Promise<{ result: unknown }>) => {
    const r = await fn()
    return r.result
  }),
  logAIUsage: vi.fn(),
}))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

import { runSiteReportAnalysisAgent } from '@/services/ai/site-report-analysis'

// Transcription corrigée réelle (site_reports.transcript_corrected), récupérée
// depuis la base pour meeting 5c31c717-641b-4dd4-afb4-33cf1251cd3a.
const KOUTIO_TRANSCRIPT = `[2 oct. à 09-02.m4a · source principale · 5 min]
Réunion de chantier numéro 19, résidence Kucho Horizon. Date 2 octobre 17h à 18h25. Lieu base vie du chantier à Kucho. Présent David Bouvier, architecte mandataire, Sophie Martin, architecte projet, Mélanie Duron pour la SCI Kucho Horizon, Léa Mezo au PC, Marc Delmas, conducteur de travaux Pacifique BTP. Alain Cotreux, chef de chantier, Thomas Legrand pour STRUCT NC. Excusez Anaïs Robert, AluConcept. La réunion débute par un appel des trois points qui conditionnaient les OPR de la cage B lors de la réunion du 30 septembre. Le seuil PMR du commerce et reprise de peinture de la cage A et le contrôle final de la terrasse B302. Terrasse B302 est en étanchéité. Thierry Lopes indique que la dernière reprise d'étanchéité est terminée et qu'aucune stagnation n'a été constatée lors du contrôle du 30 juillet. David rappelle cependant que le même défaut avait été considéré comme traité fin mai avant de réapparaître lors de la visite du 18 juin. Il est donc décidé de ne pas clôturer définitivement le sujet B302 sur la seule déclaration de l'entreprise. Une nouvelle essai d'arrosage contradictoire sera réalisé le 8 octobre à 8h en présence de Hydro NC Pacifique BTP et de la maîtrise d'œuvre. Thierry doit réparer doit préparer la zone et vérifier que les évacuations sont dégagées avant l'essai. Si aucune stagnation n'est observée après l'essai, David donnera son accord pour clôturer le point. Dans le cas contraire, Hydro NC devra proposer une solution définitive avant les OPR. Seuil PMR du commerce RDC. Le seuil reste non conforme. La hauteur mesurée est encore supérieure à la tolérance attendue. Thomas Legrand confirme qu'une reprise locale est techniquement possible sans intervention structurelle lourde. Pacifique BTP propose de rabaisser le seuil et de reprendre le raccord avec le revêtement extérieur. Décision principe de reprise validée. Marc Delmas doit transmettre un croquis de la solution à David et Paul Garcia avant le 25 octobre. Les travaux devront être terminés au plus tard le 9 octobre. Paul Garcia précise qu'il contrôlera le point lors de sa prochaine visite et que le seuil ne pourra pas être considéré comme levé à moins de ce contrôle. Peinture cage A niveau 2. Jean-Paul Huvon indique que la reprise de la peinture a été faite sur la partie du mur mais Sophie constate encore deux zones présentant un défaut de planéité en lumière rasante. La reprise est donc considérée comme partielle non clôturée. JP Peinture doit reprendre les deux zones restantes avant le 6 octobre. Sophie fera le contrôle le lendemain matin. Appartement A204, tableau électrique. Éric conforme que confirme que le tableau électrique déplacé de 35 cm a été contrôlé et que le conflit avec la zone de cuisine est désormais résolu. Aucun défaut n'a été constaté sur ce point. David confirme la clôture définitive du sujet A204. Menuiserie extérieure. En l'absence d'Anaïs Robert, Marc signale que deux châssis du niveau R+3 présente encore des joints périphériques irréguliers. Ce défaut ressemble à celui constaté sur le prototype A101 en avril. David demande à AluConcept de contrôler l'ensemble des châssis R+3 et de ne pas se limiter aux deux fenêtres signalées. Léa doit transmettre cette demande à Anaïs avant la réunion. Retour attendu le 7 octobre. Carrelage hall. On passe planning OPR, on passe point restant sans responsabilité désignée. Une trace d'humidité légère a été signalée dans le local technique du sous-sol mur côté rampe. Son origine n'est pas connue à ce stade. Marc doit vérifier la zone mais l'entreprise qui devra intervenir n'est pas encore identifiée. Ce point devra être repris à la prochaine visite. Synthèse de fin de réunion. Les sujets A204 et choix du carrelage hall peuvent être considérés comme décidés, clôturés. B302 reste sous surveillance malgré la reprise annoncée comme terminée. Le seuil PMR et la peinture cage A reste ouvert. La fissure A301 est considérée non structurelle à ce stade mais reste sous surveillance. Une nouvelle anomalie est ouverte concernant la trace d'humidité du local technique. Prochaine visite de contrôle le 8 octobre 2026 à 8h. Principalement pour l'essai d'arrosage B302 et le suivi des réserves avant OPR.`

const hasApiKey = Boolean(process.env.GOOGLE_GENAI_API_KEY || process.env.ANTHROPIC_API_KEY)

describe.skipIf(!hasApiKey)('runSiteReportAnalysisAgent — golden Koutio (incident 5c31c717)', () => {
  it('produit des décisions/actions exploitables sur le vrai transcript (jamais 0/0)', async () => {
    const result = await runSiteReportAnalysisAgent({
      transcript: KOUTIO_TRANSCRIPT,
      textInput: null,
      attachmentNames: [],
      priorOpenActions: [],
      candidateSites: [],
      defaultSiteId: 'site-koutio-test',
      meetingDateLabel: '2 octobre 2026',
      userId: null,
    })

    // 0 décision/0 action est interdit pour ce transcript.
    expect(result.proposals.length).toBeGreaterThan(0)

    const haystack = [
      ...result.proposals.map((p) => `${p.short_label} ${p.rationale ?? ''}`),
      ...result.risks.map((r) => `${r.label} ${r.rationale ?? ''}`),
    ]
      .join(' ')
      .toLowerCase()

    const expectedSignals = [
      'b302',
      'pmr',
      'a204',
      'carrelage',
      'opr',
      'hydro',
      'a301',
      'r+3',
    ]
    const matched = expectedSignals.filter((s) => haystack.includes(s))

    // Pas de nombre exact exigé — mais plusieurs éléments du transcript réel
    // doivent être détectés, sinon l'analyse reste creuse malgré un parse OK.
    expect(matched.length).toBeGreaterThanOrEqual(4)
  }, 60_000)
})
