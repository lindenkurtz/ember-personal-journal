import { ReactNode } from 'react'
import './StatCard.css'

interface Props {
  label: string
  value: ReactNode
  sublabel?: string
  best?: number
  variant?: 'default' | 'glow'
}

export default function StatCard({ label, value, sublabel, best, variant = 'default' }: Props) {
  return (
    <div className={'statcard' + (variant === 'glow' ? ' is-glow' : '')}>
      <div className="statcard__label">{label}</div>
      <div className="statcard__value">{value}</div>
      {sublabel && <div className="statcard__sub">{sublabel}</div>}
      {best !== undefined && (
        <div className="statcard__best">Best: {best} {best === 1 ? 'day' : 'days'}</div>
      )}
    </div>
  )
}
