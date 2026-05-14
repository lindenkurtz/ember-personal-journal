import './ProgressDots.css'

interface Props {
  total: number
  current: number // 0-indexed
}

export default function ProgressDots({ total, current }: Props) {
  return (
    <div className="dots" role="progressbar" aria-valuemin={1} aria-valuemax={total} aria-valuenow={current + 1}>
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className={'dots__dot' + (i === current ? ' is-current' : i < current ? ' is-done' : '')} />
      ))}
    </div>
  )
}
