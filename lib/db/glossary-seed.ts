// Vocabulaire métier de DÉMARRAGE (BTP / VRD + MOE chantier) — données PURES,
// aucune dépendance serveur (importable client & serveur). Sert deux buts :
//   1. Donner un glossaire utile dès le départ (la page le promettait sans le livrer).
//   2. Nourrir les corrections de transcription (alias = fautes/variantes fréquentes).
//
// Doctrine : référentiel manuel, à adapter par chaque organisation. Les `term`
// sont la forme canonique (ce que MemorIA écrit) ; les `aliases` sont les
// variantes/fautes que la transcription produit (« finisher » → « Finisseur »).
// On NE mappe PAS les formes longues vers les sigles (on corrige des fautes, on
// ne réécrit pas le style). Catégories : engin / matériau / document / processus
// / contrôle / acteur.

export interface GlossarySeedTerm {
  term: string
  definition: string
  category: string
  aliases: string[]
}

export const DEFAULT_GLOSSARY: GlossarySeedTerm[] = [
  // ── Documents ──────────────────────────────────────────────────────────────
  { term: 'DOE', category: 'document', definition: 'Dossier des Ouvrages Exécutés — le dossier remis en fin de chantier (plans conformes, notices, garanties).', aliases: ['d.o.e', 'doé'] },
  { term: 'DGD', category: 'document', definition: 'Décompte Général Définitif — le solde financier définitif du marché.', aliases: ['d.g.d'] },
  { term: 'GPA', category: 'document', definition: 'Garantie de Parfait Achèvement — un an après réception, l’entreprise reprend les désordres signalés.', aliases: ['g.p.a'] },
  { term: 'PAQ', category: 'document', definition: 'Plan d’Assurance Qualité — l’organisation qualité que l’entreprise s’engage à tenir.', aliases: ['p.a.q', 'pac'] },
  { term: 'OPR', category: 'processus', definition: 'Opérations Préalables à la Réception — la visite où la MOE relève les réserves avant de réceptionner.', aliases: ['o.p.r'] },
  { term: 'PV', category: 'document', definition: 'Procès-Verbal — compte-rendu officiel et opposable (réunion, réception, OPR…).', aliases: ['p.v', 'pévé', 'procès verbal', 'proces verbal'] },
  { term: 'CR', category: 'document', definition: 'Compte-Rendu — relevé des échanges et décisions d’une réunion de chantier.', aliases: ['c.r', 'compte rendu', 'compte-rendu'] },
  { term: 'CCTP', category: 'document', definition: 'Cahier des Clauses Techniques Particulières — les exigences techniques du marché.', aliases: ['c.c.t.p'] },
  { term: 'CCAP', category: 'document', definition: 'Cahier des Clauses Administratives Particulières — les règles administratives du marché.', aliases: ['c.c.a.p'] },
  { term: 'DICT', category: 'document', definition: 'Déclaration d’Intention de Commencement de Travaux — déclaration aux concessionnaires de réseaux avant de creuser.', aliases: ['d.i.c.t'] },
  { term: 'OS', category: 'document', definition: 'Ordre de Service — instruction écrite du maître d’œuvre (démarrer, arrêter, modifier).', aliases: ['o.s', 'ordre de service'] },
  { term: 'PPSPS', category: 'document', definition: 'Plan Particulier de Sécurité et de Protection de la Santé — le plan sécurité de l’entreprise sur le chantier.', aliases: ['p.p.s.p.s'] },

  // ── Acteurs ────────────────────────────────────────────────────────────────
  { term: 'MOE', category: 'acteur', definition: 'Maître d’Œuvre — conçoit et dirige l’exécution des travaux pour le compte du maître d’ouvrage.', aliases: ['m.o.e', 'maitre d’oeuvre', 'maître d’oeuvre', 'maitre d’œuvre'] },
  { term: 'MOA', category: 'acteur', definition: 'Maître d’Ouvrage — le client donneur d’ordre, propriétaire de l’ouvrage.', aliases: ['m.o.a', 'maitre d’ouvrage', 'maître d’ouvrage'] },
  { term: 'OPC', category: 'acteur', definition: 'Ordonnancement, Pilotage, Coordination — coordonne le planning des différents corps d’état.', aliases: ['o.p.c'] },
  { term: 'CSPS', category: 'acteur', definition: 'Coordonnateur Sécurité et Protection de la Santé — prévient les risques liés à la coactivité.', aliases: ['c.s.p.s', 'coordonnateur sps'] },
  { term: 'Bureau de contrôle', category: 'acteur', definition: 'Organisme agréé qui vérifie la conformité technique et la solidité de l’ouvrage.', aliases: ['bureau de controle', 'bureau contrôle'] },

  // ── Engins ─────────────────────────────────────────────────────────────────
  { term: 'Finisseur', category: 'engin', definition: 'Engin qui répand et règle l’enrobé en couche régulière sur la chaussée.', aliases: ['finisher', 'finiseur', 'finisseuse'] },
  { term: 'Niveleuse', category: 'engin', definition: 'Engin à lame (grader) qui règle finement les niveaux de la plateforme.', aliases: ['grader', 'gradeur'] },
  { term: 'Compacteur', category: 'engin', definition: 'Rouleau qui compacte les couches (remblai, grave, enrobé) pour atteindre la densité requise.', aliases: ['rouleau compresseur', 'rouleau compacteur', 'compacteuse'] },
  { term: 'Pelle hydraulique', category: 'engin', definition: 'Engin de terrassement à godet (excavation, chargement, tranchées).', aliases: ['pelleteuse', 'pelle mécanique'] },

  // ── Matériaux ──────────────────────────────────────────────────────────────
  { term: 'Grave-bitume', category: 'matériau', definition: 'Matériau de couche de base : graves liées au bitume (GB).', aliases: ['grave bitume', 'grave bitumineux'] },
  { term: 'GNT', category: 'matériau', definition: 'Grave Non Traitée — graves non liées, utilisées en couche de fondation/base.', aliases: ['g.n.t', 'grave non traitée', 'grave non traitee'] },
  { term: 'Enrobé', category: 'matériau', definition: 'Mélange de granulats et de bitume pour la couche de roulement (ex. BBSG).', aliases: ['enrobe', 'enrobé bitumineux', 'bbsg'] },
  { term: 'BPE', category: 'matériau', definition: 'Béton Prêt à l’Emploi — béton livré par toupie depuis une centrale.', aliases: ['b.p.e', 'béton prêt à l’emploi'] },

  // ── Processus ──────────────────────────────────────────────────────────────
  { term: 'Terrassement', category: 'processus', definition: 'Travaux de modification du relief : déblais, remblais, mise à niveau de la plateforme.', aliases: ['terassement'] },
  { term: 'Compactage', category: 'processus', definition: 'Densification d’une couche par passage de compacteur jusqu’à la portance visée.', aliases: ['compactation'] },
  { term: 'Réception', category: 'processus', definition: 'Acte par lequel le maître d’ouvrage accepte l’ouvrage, avec ou sans réserves. Point de départ des garanties.', aliases: ['réception des travaux', 'reception'] },
  { term: 'Levée de réserves', category: 'processus', definition: 'Correction et validation d’une réserve émise à la réception. Vocabulaire « levée », jamais « résolu ».', aliases: ['levée de réserve', 'levee de reserves', 'levee de reserve'] },
  { term: 'Retenue de garantie', category: 'processus', definition: 'Part du paiement conservée (souvent 5 %) en garantie de la bonne exécution, libérée après la GPA.', aliases: ['retenue garantie'] },

  // ── Propreté / nettoyage (tertiaire, industriel, santé) ──────────────────────
  { term: 'Autolaveuse', category: 'engin', definition: 'Machine de lavage mécanisé des sols (brossage + aspiration en un passage).', aliases: ['auto-laveuse', 'auto laveuse'] },
  { term: 'Monobrosse', category: 'engin', definition: 'Machine rotative mono-disque pour décaper, lustrer ou shampouiner les sols.', aliases: ['mono-brosse', 'mono brosse'] },
  { term: 'Injection-extraction', category: 'processus', definition: 'Nettoyage en profondeur des moquettes/textiles par pulvérisation puis aspiration immédiate.', aliases: ['injection extraction'] },
  { term: 'Décapage', category: 'processus', definition: 'Retrait des couches d’émulsion/protection usées d’un sol dur avant remise en protection.', aliases: ['decapage'] },
  { term: 'Bionettoyage', category: 'processus', definition: 'Nettoyage + désinfection en milieu sensible (santé, agroalimentaire) selon un protocole.', aliases: ['bio-nettoyage', 'bio nettoyage'] },
  { term: 'Rémanence', category: 'processus', definition: 'Durée pendant laquelle un produit reste actif après son application.', aliases: ['remanence'] },
  { term: 'Plan de prévention', category: 'document', definition: 'Document de coordination sécurité entre l’entreprise utilisatrice et l’entreprise extérieure (PDP).', aliases: ['plan de prevention', 'p.d.p'] },

  // ── Électricité (courants forts / faibles) ───────────────────────────────────
  { term: 'TGBT', category: 'équipement', definition: 'Tableau Général Basse Tension — l’armoire électrique principale qui distribue le bâtiment.', aliases: ['t.g.b.t'] },
  { term: 'CFO', category: 'lot', definition: 'Courant Fort — distribution de la puissance électrique (éclairage, prises, force).', aliases: ['c.f.o', 'courant fort'] },
  { term: 'CFA', category: 'lot', definition: 'Courant Faible — réseaux d’information (téléphonie, données, contrôle d’accès, alarmes).', aliases: ['c.f.a', 'courant faible'] },
  { term: 'GTB', category: 'équipement', definition: 'Gestion Technique du Bâtiment — supervision centralisée des équipements (CVC, éclairage, énergie).', aliases: ['g.t.b'] },
  { term: 'Consignation', category: 'contrôle', definition: 'Mise en sécurité d’un circuit ou équipement (séparation, condamnation) avant intervention.', aliases: [] },
  { term: 'Consuel', category: 'contrôle', definition: 'Attestation de conformité d’une installation électrique délivrée avant mise sous tension.', aliases: [] },
  { term: 'BAES', category: 'équipement', definition: 'Bloc Autonome d’Éclairage de Sécurité — balisage qui s’allume en cas de coupure.', aliases: ['b.a.e.s'] },

  // ── CVC / plomberie ──────────────────────────────────────────────────────────
  { term: 'CVC', category: 'lot', definition: 'Chauffage, Ventilation, Climatisation — le lot génie climatique.', aliases: ['c.v.c'] },
  { term: 'VMC', category: 'équipement', definition: 'Ventilation Mécanique Contrôlée — renouvellement mécanisé de l’air du bâtiment.', aliases: ['v.m.c'] },
  { term: 'CTA', category: 'équipement', definition: 'Centrale de Traitement d’Air — équipement qui filtre, chauffe/refroidit et souffle l’air.', aliases: ['c.t.a'] },
  { term: 'ECS', category: 'équipement', definition: 'Eau Chaude Sanitaire — production et distribution d’eau chaude.', aliases: ['e.c.s'] },
  { term: 'PAC', category: 'équipement', definition: 'Pompe À Chaleur — équipement de chauffage/rafraîchissement par transfert thermique.', aliases: ['p.a.c'] },
  { term: 'Désembouage', category: 'processus', definition: 'Nettoyage hydraulique d’un réseau de chauffage pour retirer les boues qui réduisent les échanges.', aliases: ['desembouage'] },
  { term: 'Équilibrage', category: 'processus', definition: 'Réglage des débits d’un réseau hydraulique ou aéraulique pour une diffusion homogène.', aliases: ['equilibrage'] },

  // ── Sécurité incendie (SSI) ──────────────────────────────────────────────────
  { term: 'SSI', category: 'équipement', definition: 'Système de Sécurité Incendie — détecte l’incendie et met le bâtiment en sécurité.', aliases: ['s.s.i'] },
  { term: 'SDI', category: 'équipement', definition: 'Système de Détection Incendie — la partie détection (détecteurs, déclencheurs) du SSI.', aliases: ['s.d.i'] },
  { term: 'CMSI', category: 'équipement', definition: 'Centralisateur de Mise en Sécurité Incendie — pilote les dispositifs de sécurité en cas d’alarme.', aliases: ['c.m.s.i'] },
  { term: 'DAS', category: 'équipement', definition: 'Dispositif Actionné de Sécurité — porte coupe-feu, clapet, exutoire actionné par le SSI.', aliases: ['d.a.s'] },
  { term: 'Désenfumage', category: 'processus', definition: 'Évacuation des fumées et de la chaleur en cas d’incendie (naturel ou mécanique).', aliases: ['desenfumage'] },
  { term: 'Coupe-feu', category: 'contrôle', definition: 'Degré de résistance au feu d’un ouvrage, exprimé en durée (ex. CF 1 h).', aliases: ['coupe feu'] },
]
