import { motion } from 'framer-motion'
import { Hand } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface TakeQuestionButtonProps {
  onTake: () => void
}

// Shown while the hand is raised ("Robot has a question"). Calls on the mascot.
export function TakeQuestionButton({ onTake }: TakeQuestionButtonProps) {
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col items-center gap-2 md:items-start">
      <p className="font-semibold">Earnest has a question.</p>
      <Button
        onClick={onTake}
        className="h-11 gap-2 rounded-full bg-mode-strong px-5 text-base font-semibold text-on-mode-strong hover:bg-mode-strong/90"
      >
        <Hand className="size-5" aria-hidden />
        Take question
      </Button>
    </motion.div>
  )
}
