import { AnimatePresence, motion } from 'framer-motion'
import { X } from 'lucide-react'
import { ALERT_DETAIL_MESSAGE, ALERT_MESSAGE } from '@/lib/alerts'
import type { Toast } from '@/hooks/useLiveEvents'

interface AlertToasterProps {
  toasts: Toast[]
  onDismiss: (id: number) => void
}

// Live alert toasts. Rate limiting (one per kind every 12 s) lives in useLiveEvents.
export function AlertToaster({ toasts, onDismiss }: AlertToasterProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 top-3 z-50 flex flex-col items-center gap-2 px-4"
    >
      <AnimatePresence>
        {toasts.map((toast) => (
          <motion.div
            key={toast.id}
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            className="pointer-events-auto flex max-w-sm items-center gap-3 rounded-full border-2 border-coral bg-card py-2 pr-2 pl-4 font-semibold text-plum shadow-[0_6px_0_0_rgba(43,33,64,0.08)]"
          >
            <span>{toast.detail ? ALERT_DETAIL_MESSAGE[toast.detail] : ALERT_MESSAGE[toast.kind]}</span>
            <button
              type="button"
              onClick={() => onDismiss(toast.id)}
              aria-label="Dismiss"
              className="flex size-7 items-center justify-center rounded-full hover:bg-foreground/10 focus-visible:outline-2 focus-visible:outline-ring"
            >
              <X className="size-4" aria-hidden />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}
