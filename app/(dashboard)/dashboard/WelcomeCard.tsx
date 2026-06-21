import Link from 'next/link'
import {
  MapPin,
  Mic,
  ListTodo,
  ArrowRight,
  CheckCircle2,
  Circle,
  type LucideIcon,
} from 'lucide-react'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { OnboardingProgress } from '@/lib/db/onboarding'

interface StepDef {
  key: keyof Omit<OnboardingProgress, 'allDone'>
  number: number
  icon: LucideIcon
  title: string
  description: string
  href: string
  cta: string
}

const STEPS: StepDef[] = [
  {
    key: 'hasSite',
    number: 1,
    icon: MapPin,
    title: 'Créer votre premier chantier',
    description:
      "Ajoutez un chantier : c'est le lieu où la mémoire s'accumule (réunions, photos, actions, décisions).",
    href: '/sites',
    cta: 'Aller aux chantiers',
  },
  {
    key: 'hasMeeting',
    number: 2,
    icon: Mic,
    title: 'Démarrer une réunion',
    description:
      "Capturez une réunion (voix ou notes) : MemorIA en tire le compte-rendu, les actions et les décisions.",
    href: '/meetings',
    cta: 'Aller aux réunions',
  },
  {
    key: 'hasAction',
    number: 3,
    icon: ListTodo,
    title: 'Suivre les actions',
    description:
      "Suivez ce qui reste à faire, confiez des actions aux entreprises (lien/QR) et préparez la prochaine réunion.",
    href: '/actions',
    cta: 'Voir les actions',
  },
]

export function WelcomeCard({ progress }: { progress: OnboardingProgress }) {
  // Premier index non franchi — c'est lui qu'on met en avant (CTA visible).
  const nextStepIndex = STEPS.findIndex((s) => !progress[s.key])
  const completedCount = STEPS.filter((s) => progress[s.key]).length

  return (
    <Card data-slot="welcome-card">
      <CardHeader>
        <CardTitle className="text-lg">Démarrer avec MemorIA</CardTitle>
        <CardDescription>
          {completedCount === 0
            ? 'Trois étapes pour lancer la mémoire de votre chantier.'
            : `${completedCount} / ${STEPS.length} étapes franchies. Plus que ${STEPS.length - completedCount} pour lancer la boucle.`}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ol className="space-y-3">
          {STEPS.map((step, idx) => {
            const done = progress[step.key]
            const isNext = idx === nextStepIndex
            const Icon = step.icon

            return (
              <li
                key={step.key}
                data-step={step.key}
                data-state={done ? 'done' : isNext ? 'next' : 'future'}
                className={`flex items-start gap-3 rounded-md p-3 transition-colors ${
                  done
                    ? 'bg-emerald-50/40'
                    : isNext
                    ? 'bg-card border border-border'
                    : 'bg-muted/20'
                }`}
              >
                <div className="shrink-0 mt-0.5">
                  {done ? (
                    <CheckCircle2
                      className="h-5 w-5 text-emerald-600"
                      strokeWidth={2}
                      data-testid={`step-${step.number}-done`}
                    />
                  ) : (
                    <Circle
                      className={`h-5 w-5 ${
                        isNext ? 'text-foreground' : 'text-muted-foreground/50'
                      }`}
                      strokeWidth={isNext ? 2 : 1.5}
                      data-testid={`step-${step.number}-${isNext ? 'next' : 'future'}`}
                    />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-0.5">
                    <Icon
                      className={`h-3.5 w-3.5 ${
                        done
                          ? 'text-emerald-700'
                          : isNext
                          ? 'text-foreground'
                          : 'text-muted-foreground'
                      }`}
                    />
                    <span
                      className={`text-sm font-medium ${
                        done
                          ? 'text-emerald-900'
                          : isNext
                          ? 'text-foreground'
                          : 'text-muted-foreground'
                      }`}
                    >
                      {step.title}
                    </span>
                  </div>
                  <p
                    className={`text-xs ${
                      done ? 'text-emerald-800/70' : 'text-muted-foreground'
                    }`}
                  >
                    {step.description}
                  </p>
                </div>
                {!done && isNext && (
                  <Link
                    href={step.href}
                    className={cn(
                      buttonVariants({ variant: 'outline', size: 'sm' }),
                      'shrink-0 self-center'
                    )}
                  >
                    {step.cta}
                    <ArrowRight className="h-3.5 w-3.5 ml-1" />
                  </Link>
                )}
              </li>
            )
          })}
        </ol>
      </CardContent>
    </Card>
  )
}
