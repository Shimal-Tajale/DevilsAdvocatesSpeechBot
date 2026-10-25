const MAX_DECODE_MB = 150 // decoding holds the whole clip in memory, so very large files are not retried

function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const view = new DataView(new ArrayBuffer(44 + samples.length * 2))
  const text = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i))
  }
  text(0, 'RIFF')
  view.setUint32(4, 36 + samples.length * 2, true)
  text(8, 'WAVE')
  text(12, 'fmt ')
  view.setUint32(16, 16, true) // fmt chunk size
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true) // bytes per second
  view.setUint16(32, 2, true) // bytes per sample frame
  view.setUint16(34, 16, true) // bits per sample
  text(36, 'data')
  view.setUint32(40, samples.length * 2, true)
  samples.forEach((sample, i) => {
    const clamped = Math.max(-1, Math.min(1, sample))
    view.setInt16(44 + i * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true)
  })
  return new Blob([view], { type: 'audio/wav' })
}

// Decodes a recording or the sound of a video in the browser and returns it as a plain
// 16 kHz mono WAV, which the speech-to-text service reads whatever the original container
// was. Returns null when this browser cannot decode the file.
export async function toWav(blob: Blob, sampleRate = 16000): Promise<Blob | null> {
  if (typeof AudioContext === 'undefined' || blob.size > MAX_DECODE_MB * 1024 * 1024) return null
  const context = new AudioContext({ sampleRate })
  try {
    const decoded = await context.decodeAudioData(await blob.arrayBuffer())
    const mono = new Float32Array(decoded.length)
    for (let channel = 0; channel < decoded.numberOfChannels; channel++) {
      const data = decoded.getChannelData(channel)
      for (let i = 0; i < mono.length; i++) mono[i] += data[i] / decoded.numberOfChannels
    }
    return encodeWav(mono, decoded.sampleRate)
  } catch {
    return null
  } finally {
    void context.close()
  }
}
