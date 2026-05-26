import Link from 'next/link'
import {
  Shield, Camera, FileText, Users, TrendingUp,
  CheckCircle2, ArrowRight, ArrowRightLeft, HardHat, Briefcase,
  AlertTriangle, Layers, KeyRound,
} from 'lucide-react'

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-white text-gray-900">

      {/* HEADER */}
      <header className="sticky top-0 z-50 border-b border-gray-100 bg-white/90 backdrop-blur-sm">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="MemorIA" className="h-8 w-8 rounded-lg object-cover ring-1 ring-black/5" />
            <span className="text-lg font-semibold tracking-tight">MemorIA</span>
          </div>
          <Link
            href="/login"
            className="flex items-center gap-1.5 text-sm font-medium text-brand-600 hover:text-brand-700 transition-colors"
          >
            Se connecter <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </header>

      {/* HERO */}
      <section className="mx-auto max-w-6xl px-6 py-20 md:py-28">
        <div className="grid gap-12 md:grid-cols-2 md:items-center">
          <div className="space-y-6">
            <div className="inline-flex items-center gap-2 rounded-full border border-brand-100 bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-700">
              Mémoire opérationnelle · Entreprises de nettoyage · Nouvelle-Calédonie
            </div>
            <h1 className="text-4xl font-bold leading-tight tracking-tight text-gray-900 md:text-5xl">
              Quand quelqu'un s'en va,<br />
              <span className="text-brand-600">le savoir du terrain reste.</span>
            </h1>
            <p className="text-lg text-gray-500 leading-relaxed">
              MemorIA garde la mémoire opérationnelle de chaque site — accès, à-savoir,
              anomalies, passations — et la fait apparaître au bon moment, à la bonne
              personne. Les départs, fins de contrat et changements d'équipe ne vous
              coûtent plus votre mémoire.
            </p>
            <div className="flex flex-wrap gap-3">
              <a
                href="mailto:trouillatv@gmail.com?subject=Demande%20de%20d%C3%A9mo%20MemorIA"
                className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-brand-700 active:scale-95"
              >
                Demander une démo
              </a>
              <Link
                href="/login"
                className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-5 py-2.5 text-sm font-medium text-gray-700 transition-all hover:bg-gray-50 active:scale-95"
              >
                Accéder à l'app
              </Link>
            </div>
          </div>

          {/* Aperçu : un passage de témoin — la mémoire d'un lieu transmise à la relève */}
          <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-lg shadow-gray-100/80">
            <div className="mb-4 flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-gray-400">
                <ArrowRightLeft className="h-3.5 w-3.5" /> Passage de témoin
              </span>
              <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">Lu par la relève</span>
            </div>
            <p className="mb-3 text-sm font-semibold text-gray-900">Médipôle — Blocs opératoires</p>
            <p className="mb-4 text-xs text-gray-400">Équipe Nouméa Centre reprend le site</p>
            {[
              { icon: <KeyRound className="h-4 w-4 text-brand-600" />, label: 'Accès', text: 'Badge au PC sécurité · niveau -1, vestiaire dédié' },
              { icon: <FileText className="h-4 w-4 text-brand-600" />, label: 'À savoir', text: 'Protocole d\'asepsie strict · bionettoyage avant 6h' },
              { icon: <AlertTriangle className="h-4 w-4 text-amber-500" />, label: 'Anomalie 30j', text: 'Produit désinfectant rationné dans le local technique' },
            ].map((item) => (
              <div key={item.label} className="mb-2.5 flex items-start gap-3 rounded-xl border border-gray-100 p-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gray-50">
                  {item.icon}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">{item.label}</p>
                  <p className="text-sm text-gray-700">{item.text}</p>
                </div>
              </div>
            ))}
            <div className="mt-4 flex items-center gap-2 rounded-xl border border-brand-100 bg-brand-50 p-3">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-brand-600" />
              <p className="text-xs text-brand-700 font-medium">Mémoire transmise · rien ne s'est perdu au changement d'équipe</p>
            </div>
          </div>
        </div>
      </section>

      {/* AVANT / APRÈS */}
      <section className="bg-gray-50 py-20">
        <div className="mx-auto max-w-6xl px-6">
          <h2 className="mb-10 text-center text-2xl font-bold text-gray-900">Le changement concret</h2>
          <div className="grid gap-6 md:grid-cols-2">
            <div className="rounded-2xl border border-red-100 bg-white p-6">
              <span className="mb-4 inline-block rounded-full bg-red-50 px-3 py-1 text-xs font-bold text-red-600 uppercase tracking-wider">Avant</span>
              <ul className="space-y-3 text-sm text-gray-600">
                {[
                  'Une personne expérimentée s\'en va — tout ce qu\'elle savait du site part avec elle',
                  'Nouvelle équipe sur un site : personne pour transmettre l\'essentiel',
                  'La passation se résume à un coup de fil pressé, et beaucoup de chance',
                  'Litige client : impossible de prouver que l\'équipe est bien passée',
                ].map((item) => (
                  <li key={item} className="flex items-start gap-2">
                    <span className="mt-0.5 text-red-400">✕</span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-2xl border border-emerald-100 bg-white p-6">
              <span className="mb-4 inline-block rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-600 uppercase tracking-wider">Avec MemorIA</span>
              <ul className="space-y-3 text-sm text-gray-600">
                {[
                  'La mémoire du lieu survit aux départs, aux fins de contrat, aux changements d\'équipe',
                  'Un brief de passation prêt en un clic : accès, à-savoir, anomalies, équipes relais',
                  'La bonne information apparaît au bon moment — avant d\'agir, directement sur le terrain',
                  'Dossier de preuves exportable en PDF en 30 secondes',
                ].map((item) => (
                  <li key={item} className="flex items-start gap-2">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* POUR QUI */}
      <section className="py-20">
        <div className="mx-auto max-w-6xl px-6">
          <h2 className="mb-3 text-center text-2xl font-bold text-gray-900">Fait pour toute votre entreprise</h2>
          <p className="mb-12 text-center text-gray-500">Un seul outil, trois regards sur votre activité.</p>
          <div className="grid gap-6 md:grid-cols-3">
            {[
              {
                icon: <Briefcase className="h-6 w-6 text-brand-600" />,
                title: 'Dirigeant',
                desc: 'Gagnez les appels d\'offres avec une mémoire terrain réelle — interventions, preuves et références datées. Et ne perdez plus le savoir d\'un site quand une personne-clé s\'en va.',
              },
              {
                icon: <Users className="h-6 w-6 text-brand-600" />,
                title: 'Responsable d\'exploitation',
                desc: 'Pilotez la continuité : qui porte la mémoire de quel site, quelles passations anticiper, où ça se fragilise. Préparez un passage de témoin avant qu\'un contrat se termine.',
              },
              {
                icon: <HardHat className="h-6 w-6 text-brand-600" />,
                title: 'Chef d\'équipe terrain',
                desc: 'Sur votre téléphone : la journée, ce qu\'il faut savoir avant d\'entrer sur un site, les briefs reçus et la preuve de chaque passage — sans formation, en quelques secondes.',
              },
            ].map((p) => (
              <div key={p.title} className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
                <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50">
                  {p.icon}
                </div>
                <h3 className="mb-2 font-semibold text-gray-900">{p.title}</h3>
                <p className="text-sm text-gray-500 leading-relaxed">{p.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* COMMENT ÇA MARCHE */}
      <section className="bg-gray-50 py-20">
        <div className="mx-auto max-w-6xl px-6">
          <h2 className="mb-3 text-center text-2xl font-bold text-gray-900">Comment ça marche</h2>
          <p className="mb-12 text-center text-gray-500">La mémoire se construit toute seule, à partir du travail réel.</p>
          <div className="grid gap-6 md:grid-cols-3">
            {[
              { n: '1', icon: <Camera className="h-6 w-6 text-brand-600" />, title: 'Le terrain documente', desc: 'Vos équipes notent, photographient et signalent depuis leur téléphone, au fil des interventions. Sans ressaisie.' },
              { n: '2', icon: <Layers className="h-6 w-6 text-brand-600" />, title: 'MemorIA garde et relie', desc: 'Chaque trace nourrit la mémoire du lieu. Rien ne se perd — même quand les équipes changent ou qu\'une personne s\'en va.' },
              { n: '3', icon: <ArrowRightLeft className="h-6 w-6 text-brand-600" />, title: 'Elle apparaît au bon moment', desc: 'La mémoire utile remonte d\'elle-même : avant une intervention, lors d\'une passation, quand un appel d\'offres arrive.' },
            ].map((step) => (
              <div key={step.n} className="relative rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
                <div className="mb-4 flex items-center gap-3">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-600 text-sm font-bold text-white">{step.n}</span>
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50">{step.icon}</div>
                </div>
                <h3 className="mb-2 font-semibold text-gray-900">{step.title}</h3>
                <p className="text-sm text-gray-500 leading-relaxed">{step.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CE QUE MEMORIA RÉVÈLE */}
      <section className="py-20">
        <div className="mx-auto max-w-4xl px-6">
          <div className="mb-10 text-center">
            <h2 className="text-2xl font-bold text-gray-900">Ce que MemorIA fait remonter</h2>
            <p className="mt-3 text-gray-500">Ce que vos équipes vivent, mais que personne n'a le temps de relier.</p>
          </div>

          <div className="rounded-2xl border border-gray-100 bg-white shadow-sm divide-y divide-gray-100">

            <div className="flex items-start gap-4 p-6">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-50">
                <AlertTriangle className="h-5 w-5 text-amber-500" />
              </div>
              <div>
                <p className="font-semibold text-gray-900 mb-1">Dumbéa Mall · Parties communes</p>
                <p className="text-sm text-gray-500 leading-relaxed">
                  Robinet signalé en <span className="font-medium text-gray-900">octobre</span>,
                  fuite notée en <span className="font-medium text-gray-900">janvier</span>,
                  moisissure photographiée en <span className="font-medium text-gray-900">mars</span>.
                  Trois signalements distincts, par trois personnes.{' '}
                  <span className="font-semibold text-amber-600">Un seul problème, jamais relié.</span>
                </p>
              </div>
            </div>

            <div className="flex items-start gap-4 p-6">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-red-50">
                <ArrowRightLeft className="h-5 w-5 text-red-500" />
              </div>
              <div>
                <p className="font-semibold text-gray-900 mb-1">Équipe Nouméa Centre · fin de contrat proche</p>
                <p className="text-sm text-gray-500 leading-relaxed">
                  Un contrat se termine dans <span className="font-medium text-gray-900">18 jours</span>.
                  La mémoire de <span className="font-medium text-gray-900">4 sites</span> — dont le Médipôle —
                  repose aujourd'hui sur cette équipe.{' '}
                  <span className="font-semibold text-red-600">Préparez la relève avant que le savoir parte.</span>
                </p>
              </div>
            </div>

            <div className="flex items-start gap-4 p-6">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-50">
                <Layers className="h-5 w-5 text-brand-600" />
              </div>
              <div>
                <p className="font-semibold text-gray-900 mb-1">Appel d'offres · bionettoyage hospitalier</p>
                <p className="text-sm text-gray-500 leading-relaxed">
                  Critère « traçabilité des passages » exigé.{' '}
                  <span className="font-medium text-gray-900">Des interventions documentées</span> sur des sites comparables,
                  déjà dans votre mémoire.{' '}
                  <span className="font-semibold text-brand-600">Dossier de références assemblé au bon moment.</span>
                </p>
              </div>
            </div>
          </div>

          <p className="mt-5 text-center text-xs text-gray-400">
            Pas un chatbot. Pas un ERP de plus. Une mémoire opérationnelle qui survit aux départs —
            elle rapproche et fait apparaître, vous décidez.
          </p>
        </div>
      </section>

      {/* BÉNÉFICES */}
      <section className="bg-gray-50 py-20">
        <div className="mx-auto max-w-6xl px-6">
          <h2 className="mb-12 text-center text-2xl font-bold text-gray-900">Ce que vous y gagnez</h2>
          <div className="grid gap-6 md:grid-cols-3">
            {[
              { icon: <ArrowRightLeft className="h-6 w-6 text-brand-600" />, title: 'La mémoire ne part plus avec les gens', desc: 'Départ, CDD qui finit, changement d\'équipe : le savoir du site reste. La relève prend le relais avec un brief prêt, pas une page blanche.' },
              { icon: <TrendingUp className="h-6 w-6 text-brand-600" />, title: 'Appels d\'offres gagnés', desc: 'Vos références terrain sont réelles, datées et exportables. La mémoire utile s\'assemble au moment où l\'AO arrive.' },
              { icon: <Shield className="h-6 w-6 text-brand-600" />, title: 'Zéro litige sans réponse', desc: 'Chaque passage est documenté. Fini les contestations sans fondement : le dossier de preuves est prêt en 30 secondes.' },
            ].map((b) => (
              <div key={b.title} className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
                <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50">{b.icon}</div>
                <h3 className="mb-2 font-semibold text-gray-900">{b.title}</h3>
                <p className="text-sm text-gray-500 leading-relaxed">{b.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA FINAL */}
      <section className="bg-brand-600 py-20">
        <div className="mx-auto max-w-2xl px-6 text-center">
          <h2 className="mb-4 text-3xl font-bold text-white">Prêt à ne plus perdre la mémoire de vos lieux ?</h2>
          <p className="mb-8 text-brand-100">Sans engagement · Sans carte bancaire · Déploiement en 1 jour</p>
          <a
            href="mailto:trouillatv@gmail.com?subject=Demande%20de%20d%C3%A9mo%20MemorIA"
            className="inline-flex items-center gap-2 rounded-xl bg-white px-6 py-3 text-sm font-semibold text-brand-600 shadow-sm transition-all hover:bg-brand-50 active:scale-95"
          >
            Demander une démo <ArrowRight className="h-4 w-4" />
          </a>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="border-t border-gray-100 py-8">
        <div className="mx-auto max-w-6xl px-6 flex items-center justify-between text-xs text-gray-400">
          <span>© {new Date().getFullYear()} MemorIA</span>
          <Link href="/login" className="hover:text-gray-600 transition-colors">Se connecter</Link>
        </div>
      </footer>

    </div>
  )
}
