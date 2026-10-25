import { useCallback, useEffect, useRef, useState } from 'react'
import { connectEvents, type EventsConnection } from '@/api'
import { TOAST_COOLDOWN_MS, TOAST_VISIBLE_MS } from '@/lib/alerts'
import type { AlertDetail, AlertValue, EventsMessage, StateValue } from '@/types'

export interface Toast {
  id: number
  kind: AlertValue
  detail?: AlertDetail
}

// Subscribes to WS /events and keeps the live state the screens need:
// the last state value, whether the hand is raised, and alert toasts.
export function useLiveEvents() {
  const [state, setState] = useState<StateValue | null>(null)
  const [handRaised, setHandRaised] = useState(false)
  const [toasts, setToasts] = useState<Toast[]>([])
  const connection = useRef<EventsConnection | null>(null)
  // Keyed by behaviour when known (slouch, sway, ...), so one doesn't hide another.
  const lastShown = useRef<Partial<Record<string, number>>>({})
  const nextId = useRef(0)

  useEffect(() => {
    const timers = new Set<ReturnType<typeof setTimeout>>()

    const showToast = (kind: AlertValue, detail?: AlertDetail) => {
      const now = Date.now()
      const key = detail ?? kind
      const last = lastShown.current[key]
      if (last !== undefined && now - last < TOAST_COOLDOWN_MS) return // one per behaviour per 12 s
      lastShown.current[key] = now
      const id = nextId.current++
      setToasts((current) => [...current, { id, kind, detail }])
      const timer = setTimeout(() => {
        timers.delete(timer)
        setToasts((current) => current.filter((t) => t.id !== id))
      }, TOAST_VISIBLE_MS)
      timers.add(timer)
    }

    const onMessage = (message: EventsMessage) => {
      switch (message.type) {
        case 'state':
          setState(message.value)
          break
        case 'hand':
          setHandRaised(message.value === 'raise')
          break
        case 'alert':
          showToast(message.value, message.detail)
          break
      }
    }

    const conn = connectEvents(onMessage)
    connection.current = conn
    return () => {
      conn.close()
      connection.current = null
      timers.forEach(clearTimeout)
    }
  }, [])

  const send = useCallback((message: EventsMessage) => connection.current?.send(message), [])
  const dismissToast = useCallback(
    (id: number) => setToasts((current) => current.filter((t) => t.id !== id)),
    [],
  )

  return { state, handRaised, toasts, send, dismissToast }
}
