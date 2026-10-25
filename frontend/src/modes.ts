import { Gavel, Mic, Briefcase, type LucideIcon } from 'lucide-react'
import type { ModeId } from './types'

export interface ModeConfig {
  id: ModeId
  path: string
  title: string
  description: string
  Icon: LucideIcon
  /** Wording for the topic field on the practice session setup step. */
  topicLabel: string
  topicPlaceholder: string
}

// Each mode is a configuration of shared components, not its own page.
export const MODES: ModeConfig[] = [
  {
    id: 'presentation',
    path: '/presentation',
    title: 'Public speaking',
    description: 'Give a talk and I will listen. Then I will raise my paw with a question.',
    Icon: Mic,
    topicLabel: 'What is your talk about?',
    topicPlaceholder: 'Why sleep matters',
  },
  {
    id: 'debate',
    path: '/debate',
    title: 'Debate',
    description: 'Pick a side and make your case. I will push back, politely.',
    Icon: Gavel,
    topicLabel: 'What is the motion?',
    topicPlaceholder: 'This house believes homework should be banned',
  },
  {
    id: 'interview',
    path: '/interview',
    title: 'Interview',
    description: 'Paste a job description and practice the questions you are likely to get.',
    Icon: Briefcase,
    topicLabel: 'What role or topic are you practicing for?',
    topicPlaceholder: 'Product manager at a startup',
  },
]
