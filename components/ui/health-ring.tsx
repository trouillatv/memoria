// Anneau de santé (proportion vert/orange/rouge) — déterministe, pas de lib.
// Doctrine UI : donut réservé aux proportions (≤ 3 catégories ici), caps
// arrondis + petit espace entre segments pour un rendu propre.

interface Props {
  green: number
  orange: number
  red: number
  total: number
  /** Libellé sous le chiffre central (ex : « missions », « sites »). */
  unit?: string
  size?: number
}

export function HealthRing({ green, orange, red, total, unit = '', size = 96 }: Props) {
  const stroke = Math.round(size * 0.115)
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const segs = [
    { v: green, color: '#10b981' },
    { v: orange, color: '#f59e0b' },
    { v: red, color: '#ef4444' },
  ].filter((s) => s.v > 0)
  const gap = segs.length > 1 ? c * 0.03 : 0
  let acc = 0
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0" role="img"
      aria-label={`${total} au total : ${green} en rythme, ${orange} à surveiller, ${red} critiques`}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#eef0f2" strokeWidth={stroke} />
      {segs.map((s, i) => {
        const frac = total > 0 ? s.v / total : 0
        const dash = Math.max(0.5, frac * c - gap)
        const offset = -acc * c - gap / 2
        acc += frac
        return (
          <circle key={i} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={s.color} strokeWidth={stroke}
            strokeLinecap="round" strokeDasharray={`${dash} ${c - dash}`} strokeDashoffset={offset}
            transform={`rotate(-90 ${size / 2} ${size / 2})`} />
        )
      })}
      <text x={size / 2} y={size / 2 - (unit ? 2 : -6)} textAnchor="middle" className="fill-foreground"
        fontSize={size * 0.25} fontWeight="700">{total}</text>
      {unit && (
        <text x={size / 2} y={size / 2 + size * 0.14} textAnchor="middle" className="fill-muted-foreground"
          fontSize={size * 0.095} letterSpacing="0.5">{unit}</text>
      )}
    </svg>
  )
}
