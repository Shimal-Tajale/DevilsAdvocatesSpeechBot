import { Camera, Mic } from 'lucide-react'
import { useState } from 'react'
import { features } from '@/features'
import { Button } from '@/components/ui/button'

export type PermissionState = 'idle' | 'asking' | 'granted' | 'denied' | 'unavailable'

interface PermissionPromptProps {
  onChange?: (state: PermissionState) => void
}

// Asks the browser for mic (and camera, if enabled) access, then releases the
// devices straight away. Real recording happens later in the session screen.
export function PermissionPrompt({ onChange }: PermissionPromptProps) {
  const [state, setState] = useState<PermissionState>('idle')
  const wantsCamera = features.cameraPreview

  const update = (next: PermissionState) => {
    setState(next)
    onChange?.(next)
  }

  const ask = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      update('unavailable')
      return
    }
    update('asking')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: wantsCamera })
      stream.getTracks().forEach((t) => t.stop())
      update('granted')
    } catch {
      update('denied')
    }
  }

  const copy: Record<PermissionState, string> = {
    idle: wantsCamera
      ? 'To listen and watch while you practice, I need your microphone and camera. Nothing leaves this page for now.'
      : 'To listen while you practice, I need your microphone.',
    asking: 'Your browser is asking. Choose Allow when it pops up.',
    granted: 'All set. I can hear you loud and clear.',
    denied: 'No problem. You can change this in your browser settings whenever you like.',
    unavailable: 'This page needs a secure connection (https) to use the microphone. Try the shared ngrok link.',
  }

  return (
    <section
      aria-labelledby="permission-heading"
      className="flex flex-col gap-4 rounded-3xl bg-plum p-5 text-warm dark:border-2 dark:border-lavender/40 dark:bg-secondary sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex items-start gap-3">
        <span className="flex shrink-0 gap-1 pt-1 text-mint" aria-hidden>
          <Mic className="size-5" />
          {wantsCamera && <Camera className="size-5" />}
        </span>
        <div>
          <h2 id="permission-heading" className="text-lg font-semibold">
            {wantsCamera ? 'Mic and camera check' : 'Mic check'}
          </h2>
          <p role="status" className="text-warm/80">
            {copy[state]}
          </p>
        </div>
      </div>
      {state !== 'granted' && (
        <Button
          size="lg"
          onClick={ask}
          disabled={state === 'asking'}
          className="h-11 shrink-0 rounded-full bg-mint px-5 text-base font-semibold text-plum hover:bg-mint/85"
        >
          {state === 'denied' || state === 'unavailable'
            ? 'Try again'
            : wantsCamera
              ? 'Allow mic and camera'
              : 'Allow microphone'}
        </Button>
      )}
    </section>
  )
}
