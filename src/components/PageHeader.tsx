import { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import './PageHeader.css'

interface Props {
  /* Small uppercase label above the title. Only worth setting when the title
   * slot is carrying something other than the page's name — Finance puts the
   * net-worth figure there, so the eyebrow is what names the page. */
  eyebrow?: string
  title: ReactNode
  subtitle?: ReactNode
  /* Replaces the Home pill. The Dashboard is home, so it passes its own nav. */
  actions?: ReactNode
}

export default function PageHeader({ eyebrow, title, subtitle, actions }: Props) {
  return (
    <header className="pagehead">
      <div className="pagehead__text">
        {eyebrow && <p className="pagehead__eyebrow">{eyebrow}</p>}
        <h1 className="pagehead__title">{title}</h1>
        {subtitle && <p className="pagehead__subtitle">{subtitle}</p>}
      </div>
      {actions ?? <Link to="/" className="pagehead__home">Home</Link>}
    </header>
  )
}
