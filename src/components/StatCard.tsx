import { ReactNode } from 'react'
import './StatCard.css'

interface Props {
  label: string
  value: ReactNode
  sublabel?: string
  variant?: 'default' | 'glow'
}

export default function StatCard({ label, value, sublabel, variant = 'default' }: Props) {
  return (
    <div className={'statcard' + (variant === 'glow' ? ' is-glow' : '')}>
      <div className="statcard__label">{label}</div>
      <div className="statcard__value">{value}</div>
      {sublabel && <div className="statcard__sub">{sublabel}</div>}
    </div>
  )
}
