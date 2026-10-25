import { Gavel, Mic, Briefcase, type LucideIcon } from 'lucide-react'
import type { ModeId } from './types'

export interface ModeConfig {
  id: ModeId
  path: string
  title: string
  description: string
  Icon: LucideIcon
  /** Tailwind classes for the card accent, from the palette. */
  accent: string
}

// Each mode is a configuration of shared components, not its own page.
export const MODES: ModeConfig[] = [
  {
    id: 'presentation',
    path: '/presentation',
    title: 'Public speaking',
    description: 'Give a talk and I will listen. Then I will raise my paw with a question.',
    Icon: Mic,
    accent: 'bg-lavender',
  },
  {
    id: 'debate',
    path: '/debate',
    title: 'Debate',
    description: 'Pick a side and make your case. I will push back, politely.',
    Icon: Gavel,
    accent: 'bg-butter',
  },
  {
    id: 'interview',
    path: '/interview',
    title: 'Interview',
    description: 'Paste a job description and practice the questions you are likely to get.',
    Icon: Briefcase,
    accent: 'bg-mint',
  },
]
