import { useCallback, useState } from 'react'

const KEY = 'speech-coach.speaker'

function read(): string {
  try {
    return localStorage.getItem(KEY) ?? ''
  } catch {
    return ''
  }
}

// The speaker name is the key for GET /history/{speaker}, so it is remembered between visits.
export function useSpeaker() {
  const [speaker, setSpeakerState] = useState(read)
  const setSpeaker = useCallback((value: string) => {
    setSpeakerState(value)
    try {
      localStorage.setItem(KEY, value)
    } catch {
      // storage can be blocked; the name still works for this visit
    }
  }, [])
  return [speaker, setSpeaker] as const
}
