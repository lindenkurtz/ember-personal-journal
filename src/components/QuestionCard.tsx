import { motion } from 'framer-motion'
import { ReactNode } from 'react'
import './QuestionCard.css'

interface Props {
  /** Stable key per question — drives the fade/slide transition. */
  stepKey: string
  question: string
  hint?: string
  children: ReactNode
}

export default function QuestionCard({ stepKey, question, hint, children }: Props) {
  return (
    <motion.section
      key={stepKey}
      className="qcard"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
    >
      <h2 className="qcard__question">{question}</h2>
      {hint && <p className="qcard__hint">{hint}</p>}
      <div className="qcard__body">{children}</div>
    </motion.section>
  )
}
