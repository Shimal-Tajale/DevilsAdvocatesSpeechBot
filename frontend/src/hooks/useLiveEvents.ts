import { useCallback, useEffect, useRef, useState } from 'react'
import { connectEvents, type EventsConnection } from '@/api'
import { TOAST_COOLDOWN_MS, TOAST_VISIBLE_MS } from '@/lib/alerts'
import type { AlertValue, EventsMessage, StateValue } from '@/types'

export interface Toast {
  id: number
  kind: AlertValue
}

// Subscribes to WS /events and keeps the live state the screens need:
// the last state value, whether the hand is raised, and alert toasts.
export function useLiveEvents() {
  const [state, setState] = useState<StateValue | null>(null)
  const [handRaised, setHandRaised] = useState(false)
  const [toasts, setToasts] = useState<Toast[]>([])
  const connection = useRef<EventsConnection | null>(null)
  const lastShown = useRef<Partial<Record<AlertValue, number>>>({})
  const nextId = useRef(0)

  useEffect(() => {
    const timers = new Set<ReturnType<typeof setTimeout>>()

    const showToast = (kind: AlertValue) => {
      const now = Date.now()
      const last = lastShown.current[kind]
      if (last !== undefined && now - last < TOAST_COOLDOWN_MS) return // one per kind per 12 s
      lastShown.current[kind] = now
      const id = nextId.current++
      setToasts((current) => [...current, { id, kind }])
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
          showToast(message.value)
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
