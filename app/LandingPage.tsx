import Link from 'next/link'
import {
  AlertTriangle,
  ArrowRight,
  ArrowRightLeft,
  BriefcaseBusiness,
  Building2,
  Camera,
  Database,
  FileArchive,
  FileText,
  KeyRound,
  Layers3,
  MapPinned,
  Mic,
  ShieldCheck,
  Sparkles,
} from 'lucide-react'
import { HeroCardTilt } from './HeroCardTilt'

const demoHref = 'mailto:trouillatv@gmail.com?subject=Demande%20de%20d%C3%A9mo%20MemorIA'

// Comment ça marche — 3 temps qui expliquent le produit sans jargon.
const howItWorks = [
  {
    step: '01',
    title: 'Capter',
    icon: Mic,
    text: 'Sur le terrain, une photo, une note vocale ou un signalement suffit. L’équipe documente en quelques secondes, depuis son téléphone, sans ressaisie ni formulaire interminable.',
    example: 'Exemple : « Porte coupe-feu du local technique bloquée » + une photo, dictée en sortant du site.',
  },
  {
    step: '02',
    title: 'Conserver',
    icon: Database,
    text: 'Chaque trace est rattachée à son site et conservée durablement : accès, à-savoir, anomalies, preuves, passations. L’information ne dépend plus de la mémoire d’une personne.',
    example: 'Exemple : trois signalements de fuite, en octobre, janvier et mars, sont reliés au même point du hall.',
  },
  {
    step: '03',
    title: 'Faire remonter',
    icon: Sparkles,
    text: 'Au moment qui compte — une relève d’équipe, un litige client, un appel d’offres — MemorIA rassemble la mémoire utile du site et la rend lisible en un coup d’œil.',
    example: 'Exemple : un brief de passation prêt 18 jours avant la fin d’un contrat multi-sites.',
  },
]

const memoryItems = [
  {
    label: 'Accès',
    text: 'Badges, codes, points de contact et contraintes d’entrée propres à chaque site.',
    icon: KeyRound,
  },
  {
    label: 'À savoir',
    text: 'Consignes terrain, horaires sensibles, zones à traiter avec attention.',
    icon: FileText,
  },
  {
    label: 'Anomalies',
    text: 'Signalements, récurrence, contexte et état de traitement, dans le temps.',
    icon: AlertTriangle,
  },
  {
    label: 'Preuves',
    text: 'Photos, passages documentés, dossiers exportables et traces opposables.',
    icon: Camera,
  },
  {
    label: 'Passations',
    text: 'Ce qu’une équipe doit absolument savoir avant de reprendre un site.',
    icon: ArrowRightLeft,
  },
  {
    label: 'Références',
    text: 'Expériences comparables, interventions datées et preuves mobilisables pour un dossier.',
    icon: FileArchive,
  },
]

const surfacedSignals = [
  {
    icon: AlertTriangle,
    tone: 'border-amber-200 bg-amber-50 text-amber-700',
    title: 'Dumbéa Mall — Hall principal',
    text: 'Un robinet signalé en octobre, une fuite notée en janvier, une moisissure photographiée en mars. Trois signalements distincts, saisis par trois personnes, deviennent un seul problème relié et daté.',
    signal: 'Anomalie récurrente détectée',
  },
  {
    icon: ArrowRightLeft,
    tone: 'border-slate-300 bg-slate-100 text-slate-700',
    title: 'Équipe Nouméa Centre — relève à préparer',
    text: 'Un contrat se termine dans 18 jours. La mémoire de 4 sites, dont le Médipôle, repose encore sur cette seule équipe. Le brief de passation est assemblé avant qu’elle ne parte.',
    signal: 'Brief de passation prêt',
  },
  {
    icon: Layers3,
    tone: 'border-blue-200 bg-blue-50 text-blue-700',
    title: 'Appel d’offres — marché de services multi-sites',
    text: 'Le critère « traçabilité des passages » est exigé. MemorIA retrouve les interventions documentées sur des sites comparables et fournit des preuves datées à joindre au dossier.',
    signal: 'Références terrain disponibles',
  },
]

const fragileMoments = [
  {
    title: 'Un départ',
    text: 'Une personne expérimentée quitte l’entreprise et emporte tout ce qu’elle savait du site — les accès, les pièges, l’historique.',
  },
  {
    title: 'Une reprise',
    text: 'Une équipe reprend une zone sensible sans contexte exploitable et refait les mêmes erreurs que la précédente.',
  },
  {
    title: 'Un litige',
    text: 'Un client conteste une prestation et les preuves sont dispersées entre des téléphones, des e-mails et des têtes.',
  },
]

const gains = [
  {
    title: 'Continuité d’exploitation',
    text: 'Les départs, fins de contrat et changements d’équipe ne créent plus de page blanche. Le site garde sa mémoire.',
    icon: Building2,
  },
  {
    title: 'Dossiers de preuves',
    text: 'Passages documentés, photos et signalements restent mobilisables en quelques secondes, prêts à être exportés.',
    icon: ShieldCheck,
  },
  {
    title: 'Appels d’offres argumentés',
    text: 'Les références terrain datées ressortent au moment où un marché exige de la traçabilité — sans fouiller des mois d’archives.',
    icon: BriefcaseBusiness,
  },
]

export default function LandingPage() {
  return (
    <div className="force-light-theme min-h-screen bg-[#eef1f3] text-[#26313b] [--ease-out-landing:cubic-bezier(0.23,1,0.32,1)]">
      {/* Couche d'animations — moderne, sobre, hardware-accelerée.
          - .landing-fadeup       : entrée fade+translate (520ms ease-out fort)
          - .landing-reveal       : même chose mais déclenchée au scroll via
                                    animation-timeline:view() (Chrome/Edge/Safari
                                    récents). Fallback navigateurs anciens : joue
                                    une fois au load, élément se stabilise visible.
          - .landing-pulse-soft   : pulse lente (opacité + scale très léger) pour
                                    un détail vivant (icône hero, badge état).
          - Tout est désactivé sous prefers-reduced-motion. */}
      <style>{`
        @keyframes landing-fadeup {
          from { opacity: 0; transform: translateY(12px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes landing-pulse-soft {
          0%, 100% { opacity: 1; transform: scale(1); }
          50%      { opacity: 0.55; transform: scale(0.92); }
        }
        .landing-fadeup {
          animation: landing-fadeup 520ms var(--ease-out-landing) backwards;
        }
        .landing-reveal {
          animation: landing-fadeup linear both;
          animation-timeline: view();
          animation-range: entry 0% cover 30%;
        }
        @supports not (animation-timeline: view()) {
          .landing-reveal {
            animation: landing-fadeup 520ms var(--ease-out-landing) both;
          }
        }
        .landing-pulse-soft {
          animation: landing-pulse-soft 2.8s ease-in-out infinite;
        }
        @media (prefers-reduced-motion: reduce) {
          .landing-fadeup,
          .landing-reveal,
          .landing-pulse-soft { animation: none; }
        }
      `}</style>
      <header className="sticky top-0 z-50 border-b border-slate-200/80 bg-[#f8fafb]/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/icons/icon-192.png"
              alt="MemorIA"
              className="h-8 w-8 rounded-md object-cover ring-1 ring-slate-900/10"
            />
            <span className="text-base font-semibold tracking-tight text-slate-950">
              MemorIA
            </span>
          </div>
          <div className="flex items-center gap-5">
            <a
              href={demoHref}
              className="hidden text-sm font-medium text-slate-600 transition-colors duration-200 hover:text-slate-950 sm:inline"
            >
              Demander une démo
            </a>
            <Link
              href="/login"
              className="group inline-flex items-center gap-1.5 rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white transition-[background-color,transform] duration-200 hover:bg-slate-800 motion-safe:active:scale-[0.97]"
            >
              Se connecter
              <ArrowRight className="h-4 w-4 transition-transform duration-200 ease-[var(--ease-out-landing)] motion-safe:group-hover:translate-x-0.5" />
            </Link>
          </div>
        </div>
      </header>

      <main>
        <section className="mx-auto grid max-w-6xl gap-12 px-5 py-16 md:grid-cols-[1.02fr_0.98fr] md:items-center md:py-24">
          <div className="max-w-2xl">
            <div
              className="landing-fadeup mb-6 inline-flex items-center gap-2 border border-slate-300 bg-white/70 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-slate-600"
              style={{ animationDelay: '0ms' }}
            >
              <MapPinned className="landing-pulse-soft h-3.5 w-3.5" />
              Mémoire opérationnelle · Nouvelle-Calédonie
            </div>
            <h1
              className="landing-fadeup text-4xl font-semibold leading-[0.98] tracking-tight text-slate-950 md:text-6xl"
              style={{ animationDelay: '80ms' }}
            >
              La mémoire des lieux ne doit plus partir avec les personnes.
            </h1>
            <p
              className="landing-fadeup mt-6 text-lg leading-8 text-slate-600"
              style={{ animationDelay: '180ms' }}
            >
              MemorIA conserve les accès, consignes, anomalies, preuves et
              passations de chaque site. Quand une équipe change, qu’un contrat
              se termine ou qu’un nouveau marché arrive, l’information utile
              remonte au bon moment — sans dépendre de qui était là avant.
            </p>
            <div
              className="landing-fadeup mt-8 flex flex-wrap gap-3"
              style={{ animationDelay: '280ms' }}
            >
              <a
                href={demoHref}
                className="group inline-flex items-center gap-2 rounded-lg bg-slate-950 px-5 py-3 text-sm font-semibold text-white shadow-sm transition-[background-color,transform,box-shadow] duration-200 ease-[var(--ease-out-landing)] hover:bg-slate-800 hover:shadow-md motion-safe:active:scale-[0.97]"
              >
                Demander une démo
                <ArrowRight className="h-4 w-4 transition-transform duration-200 ease-[var(--ease-out-landing)] motion-safe:group-hover:translate-x-0.5" />
              </a>
              <Link
                href="/login"
                className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white/70 px-5 py-3 text-sm font-semibold text-slate-700 transition-[background-color,color,border-color,transform] duration-200 ease-[var(--ease-out-landing)] hover:bg-white hover:text-slate-950 hover:border-slate-400 motion-safe:active:scale-[0.97]"
              >
                Accéder à l’app
              </Link>
            </div>
            <p
              className="landing-fadeup mt-6 text-sm text-slate-500"
              style={{ animationDelay: '360ms' }}
            >
              Conçu pour les entreprises multi-sites : propreté, maintenance,
              services et BTP.
            </p>
          </div>

          <HeroCardTilt className="landing-fadeup" >
            <div
              className="border border-slate-300 bg-[#fbfcfc] shadow-2xl shadow-slate-400/20"
              style={{ animationDelay: '120ms' } as React.CSSProperties}
            >
              <div className="border-b border-slate-200 px-5 py-4">
                <div className="flex items-center justify-between gap-4 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                  <span>Brief de passation</span>
                  <span className="inline-flex items-center gap-1.5 text-emerald-700">
                    <span className="landing-pulse-soft inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
                    Mémoire prête à transmettre
                  </span>
                </div>
              </div>
              <div className="p-5 md:p-7">
                <div className="flex items-start justify-between gap-5 border-b border-slate-200 pb-5">
                  <div>
                    <p className="text-xl font-semibold text-slate-950">
                      Médipôle — Blocs opératoires
                    </p>
                    <p className="mt-1 text-sm text-slate-500">
                      Équipe sortante : Nouméa Centre
                    </p>
                  </div>
                  <div className="shrink-0 border border-slate-300 bg-slate-50 px-3 py-2 text-right">
                    <p className="text-xs uppercase tracking-[0.14em] text-slate-500">
                      Relève
                    </p>
                    <p className="text-sm font-semibold text-slate-900">
                      Prévue dans 18 jours
                    </p>
                  </div>
                </div>

                <div className="mt-5 grid gap-3">
                  {[
                    {
                      label: 'Accès',
                      text: 'Badge au PC sécurité, niveau -1, vestiaire dédié.',
                      icon: KeyRound,
                    },
                    {
                      label: 'À savoir',
                      text: 'Zone à accès réglementé. Intervention avant ouverture.',
                      icon: FileText,
                    },
                    {
                      label: 'Anomalie récente',
                      text: 'Porte coupe-feu signalée bloquée, local technique.',
                      icon: AlertTriangle,
                    },
                    {
                      label: 'Preuves disponibles',
                      text: 'Photos de passage et rapport mensuel exportables.',
                      icon: ShieldCheck,
                    },
                  ].map((item, i) => {
                    const Icon = item.icon
                    return (
                      <div
                        key={item.label}
                        className="landing-fadeup grid grid-cols-[2.25rem_1fr] gap-3 border border-slate-200 bg-white/80 p-3 transition-colors duration-200 hover:bg-white"
                        style={{ animationDelay: `${260 + i * 70}ms` }}
                      >
                        <div className="flex h-9 w-9 items-center justify-center rounded-md bg-slate-100 text-slate-600">
                          <Icon className="h-4 w-4" />
                        </div>
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                            {item.label}
                          </p>
                          <p className="mt-1 text-sm leading-6 text-slate-700">{item.text}</p>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          </HeroCardTilt>
        </section>

        {/* ── Le problème ─────────────────────────────────────────────── */}
        <section className="border-y border-slate-200 bg-[#f8fafb] py-16">
          <div className="mx-auto max-w-6xl px-5">
            <div className="landing-reveal max-w-2xl">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                Le problème
              </p>
              <h2 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">
                La connaissance d’un site tient dans quelques têtes
              </h2>
              <p className="mt-5 text-base leading-7 text-slate-600">
                Dans les métiers multi-sites, l’essentiel ne s’écrit nulle part :
                il se transmet à l’oral, de chef à chef. Le jour où la chaîne se
                rompt, l’entreprise repart de zéro. Trois moments suffisent à
                faire mal.
              </p>
            </div>
            <div className="mt-8 grid gap-5 md:grid-cols-3">
              {fragileMoments.map((moment, index) => (
                <div
                  key={moment.title}
                  className="landing-reveal border border-slate-200 bg-white/80 p-5 text-slate-700 transition-[transform,border-color,box-shadow] duration-200 ease-[var(--ease-out-landing)] hover:border-slate-300 hover:shadow-md motion-safe:hover:-translate-y-0.5"
                  style={{ animationDelay: `${index * 70}ms` }}
                >
                  <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
                    Situation 0{index + 1}
                  </span>
                  <h3 className="mt-3 text-base font-semibold text-slate-950">{moment.title}</h3>
                  <p className="mt-2 text-sm leading-7">{moment.text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Comment ça marche ───────────────────────────────────────── */}
        <section className="mx-auto max-w-6xl px-5 py-16">
          <div className="landing-reveal max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
              Comment ça marche
            </p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">
              Trois temps, aucun effort de saisie en plus
            </h2>
            <p className="mt-5 text-base leading-7 text-slate-600">
              MemorIA s’appuie sur ce que les équipes font déjà. On capte sur le
              terrain, on conserve sans rien perdre, et on fait remonter
              l’information au moment exact où elle sert.
            </p>
          </div>

          <div className="mt-10 grid gap-5 md:grid-cols-3">
            {howItWorks.map((step, i) => {
              const Icon = step.icon
              return (
                <div
                  key={step.step}
                  className="landing-reveal relative flex flex-col border border-slate-200 bg-white/80 p-6 transition-[transform,border-color,box-shadow] duration-200 ease-[var(--ease-out-landing)] hover:border-slate-300 hover:shadow-lg motion-safe:hover:-translate-y-1"
                  style={{ animationDelay: `${i * 80}ms` }}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-slate-950 text-white">
                      <Icon className="h-5 w-5" />
                    </div>
                    <span className="text-3xl font-semibold tabular-nums text-slate-200">
                      {step.step}
                    </span>
                  </div>
                  <h3 className="mt-5 text-lg font-semibold text-slate-950">{step.title}</h3>
                  <p className="mt-2 text-sm leading-7 text-slate-600">{step.text}</p>
                  <p className="mt-4 border-l-2 border-slate-200 pl-3 text-xs italic leading-6 text-slate-500">
                    {step.example}
                  </p>
                </div>
              )
            })}
          </div>
        </section>

        {/* ── Registre de mémoire ─────────────────────────────────────── */}
        <section className="border-y border-slate-200 bg-[#f8fafb] py-16">
          <div className="mx-auto max-w-6xl px-5">
            <div className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:items-start">
              <div className="landing-reveal">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                  Registre de mémoire
                </p>
                <h2 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">
                  Ce que MemorIA garde de chaque site
                </h2>
                <p className="mt-5 text-base leading-7 text-slate-600">
                  La mémoire ne se limite pas à une note. Elle relie les traces
                  opérationnelles qui permettent de reprendre un site, de
                  documenter un passage ou de retrouver une référence utile —
                  sans dépendre de la personne qui était là.
                </p>
              </div>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {memoryItems.map((item, i) => {
                  const Icon = item.icon
                  return (
                    <div
                      key={item.label}
                      className="landing-reveal group border border-slate-200 bg-white/80 p-4 transition-[background-color,border-color,transform,box-shadow] duration-200 ease-[var(--ease-out-landing)] hover:bg-white hover:border-slate-300 hover:shadow-md motion-safe:hover:-translate-y-0.5"
                      style={{ animationDelay: `${i * 60}ms` }}
                    >
                      <div className="mb-5 flex h-9 w-9 items-center justify-center rounded-md bg-slate-100 text-slate-600 transition-[background-color,transform] duration-200 ease-[var(--ease-out-landing)] group-hover:bg-slate-200 motion-safe:group-hover:scale-110">
                        <Icon className="h-4 w-4" />
                      </div>
                      <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-slate-950">
                        {item.label}
                      </h3>
                      <p className="mt-2 text-sm leading-6 text-slate-600">{item.text}</p>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        </section>

        {/* ── Apparition utile ────────────────────────────────────────── */}
        <section className="bg-[#dfe5e9] py-16">
          <div className="mx-auto max-w-5xl px-5">
            <div className="landing-reveal max-w-3xl">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-600">
                Apparition utile
              </p>
              <h2 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">
                Au bon moment, MemorIA fait remonter ce qui compte
              </h2>
              <p className="mt-5 text-base leading-7 text-slate-700">
                Ce que les équipes vivent au quotidien se transforme en signaux
                exploitables : un problème relié, une relève à préparer, une
                preuve réutilisable. Voici trois cas réels.
              </p>
            </div>

            <div className="mt-8 divide-y divide-slate-200 border border-slate-300 bg-[#fbfcfc]">
              {surfacedSignals.map((item, i) => {
                const Icon = item.icon
                return (
                  <div
                    key={item.title}
                    className="landing-reveal group grid gap-4 p-5 transition-colors duration-200 hover:bg-white md:grid-cols-[13rem_1fr] md:p-6"
                    style={{ animationDelay: `${i * 90}ms` }}
                  >
                    <div>
                      <div
                        className={`inline-flex items-center gap-2 border px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] transition-transform duration-200 ease-[var(--ease-out-landing)] motion-safe:group-hover:scale-[1.04] ${item.tone}`}
                      >
                        <Icon className="h-3.5 w-3.5" />
                        {item.signal}
                      </div>
                    </div>
                    <div>
                      <h3 className="text-lg font-semibold text-slate-950">{item.title}</h3>
                      <p className="mt-2 text-sm leading-7 text-slate-600">{item.text}</p>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </section>

        {/* ── Valeur direction ────────────────────────────────────────── */}
        <section className="mx-auto max-w-6xl px-5 py-16">
          <div className="grid gap-10 lg:grid-cols-[0.85fr_1.15fr] lg:items-start">
            <div className="landing-reveal">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                Valeur direction
              </p>
              <h2 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">
                Ce que la direction y gagne
              </h2>
              <p className="mt-5 text-base leading-7 text-slate-600">
                Moins de dépendance aux personnes, plus de continuité entre les
                équipes, et des preuves disponibles quand une décision doit être
                prise — ou défendue — rapidement.
              </p>
            </div>
            <div className="grid gap-5 md:grid-cols-3">
              {gains.map((gain, i) => {
                const Icon = gain.icon
                return (
                  <div
                    key={gain.title}
                    className="landing-reveal group border border-slate-200 bg-white/80 p-5 transition-[transform,border-color,box-shadow] duration-200 ease-[var(--ease-out-landing)] hover:border-slate-300 hover:shadow-lg motion-safe:hover:-translate-y-1"
                    style={{ animationDelay: `${i * 80}ms` }}
                  >
                    <div className="mb-5 flex h-10 w-10 items-center justify-center rounded-md bg-slate-950 text-white transition-transform duration-200 ease-[var(--ease-out-landing)] motion-safe:group-hover:scale-110 motion-safe:group-hover:-rotate-3">
                      <Icon className="h-4 w-4" />
                    </div>
                    <h3 className="text-base font-semibold text-slate-950">{gain.title}</h3>
                    <p className="mt-3 text-sm leading-6 text-slate-600">{gain.text}</p>
                  </div>
                )
              })}
            </div>
          </div>
        </section>

        {/* ── CTA final ───────────────────────────────────────────────── */}
        <section className="border-y border-slate-200 bg-[#f8fafb] py-14">
          <div className="mx-auto flex max-w-6xl flex-col gap-6 px-5 md:flex-row md:items-center md:justify-between">
            <div className="landing-reveal max-w-2xl">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                Parlons-en
              </p>
              <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">
                Voyez comment votre mémoire opérationnelle peut survivre aux
                départs et aux passations.
              </h2>
              <p className="mt-3 text-sm leading-7 text-slate-600">
                Une démonstration de 30 minutes, à partir d’un de vos sites.
              </p>
            </div>
            <a
              href={demoHref}
              className="landing-reveal group inline-flex w-fit items-center gap-2 rounded-lg bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition-[background-color,transform,box-shadow] duration-200 ease-[var(--ease-out-landing)] hover:bg-slate-800 hover:shadow-md motion-safe:active:scale-[0.97]"
            >
              Demander une démo
              <ArrowRight className="h-4 w-4 transition-transform duration-200 ease-[var(--ease-out-landing)] motion-safe:group-hover:translate-x-0.5" />
            </a>
          </div>
        </section>
      </main>

      <footer className="border-t border-slate-200 bg-[#eef1f3] py-8">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-5 text-xs text-slate-500 sm:flex-row">
          <span>© {new Date().getFullYear()} MemorIA · Mémoire opérationnelle</span>
          <Link
            href="/login"
            className="group inline-flex items-center gap-1 transition-colors duration-200 hover:text-slate-950"
          >
            Se connecter
            <ArrowRight className="h-3 w-3 transition-transform duration-200 ease-[var(--ease-out-landing)] motion-safe:group-hover:translate-x-0.5" />
          </Link>
        </div>
      </footer>
    </div>
  )
}
