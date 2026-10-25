import { motion, useReducedMotion } from 'framer-motion'
import type { Mood } from '@/types'

// Earnest the bunny. The `mood` prop is the only thing that drives the animation.
// Art is flat shapes on purpose so it's easy to swap for final artwork later.

const PLUM = '#2B2140'
const LAVENDER = '#B9A7F5'
const LAVENDER_DEEP = '#9F8BEA'
const WARM = '#FBFAFF'
const BUTTER = '#FFD86B'
const CORAL = '#FF7A6B'
const MINT = '#8FE3C0'

interface MoodSpec {
  earL: number // degrees, pivot at the ear base (negative tips the left ear outward)
  earR: number
  earScale: number
  armL: number
  armR: number
  pupil: [number, number]
  eyeOpen: number // 0..1
  mouth: { w: number; e: number; u: number; l: number }
  body: { y: number; rotate: number; scale: number }
}

const SPECS: Record<Mood, MoodSpec> = {
  idle: { earL: -8, earR: 8, earScale: 1, armL: 12, armR: -12, pupil: [0, 0], eyeOpen: 1, mouth: { w: 11, e: 152, u: 160, l: 161 }, body: { y: 0, rotate: 0, scale: 1 } },
  listening: { earL: -2, earR: 2, earScale: 1.12, armL: 10, armR: -10, pupil: [0, 1], eyeOpen: 1, mouth: { w: 8, e: 153, u: 157, l: 160 }, body: { y: -2, rotate: 0, scale: 1.03 } },
  confused: { earL: -6, earR: 82, earScale: 1, armL: 12, armR: -12, pupil: [-4, -3], eyeOpen: 0.9, mouth: { w: 7, e: 156, u: 151, l: 152 }, body: { y: 0, rotate: 5, scale: 1 } },
  bored: { earL: -72, earR: 72, earScale: 0.92, armL: 8, armR: -8, pupil: [2, -6], eyeOpen: 0.9, mouth: { w: 9, e: 156, u: 150, l: 151 }, body: { y: 7, rotate: 0, scale: 0.97 } },
  handRaised: { earL: -3, earR: 3, earScale: 1.1, armL: 12, armR: -170, pupil: [2, -1], eyeOpen: 1, mouth: { w: 11, e: 151, u: 158, l: 166 }, body: { y: -3, rotate: 0, scale: 1 } },
  speaking: { earL: -8, earR: 8, earScale: 1, armL: 12, armR: -45, pupil: [0, 0], eyeOpen: 1, mouth: { w: 10, e: 152, u: 156, l: 168 }, body: { y: 0, rotate: 0, scale: 1 } },
  happy: { earL: -16, earR: 16, earScale: 1.08, armL: 62, armR: -62, pupil: [0, 0], eyeOpen: 1, mouth: { w: 14, e: 149, u: 151, l: 174 }, body: { y: -4, rotate: 0, scale: 1 } },
  thinking: { earL: -4, earR: 24, earScale: 1, armL: 12, armR: -12, pupil: [5, -5], eyeOpen: 1, mouth: { w: 6, e: 154, u: 154, l: 156 }, body: { y: 0, rotate: -3, scale: 1 } },
}

const mouthPath = ({ w, e, u, l }: MoodSpec['mouth']) =>
  `M ${120 - w} ${e} Q 120 ${u} ${120 + w} ${e} Q 120 ${l} ${120 - w} ${e} Z`

// Fill-box transform so rotation/scale pivot is expressed relative to each shape.
const pivot = (x: number, y: number) => ({ transformBox: 'fill-box' as const, originX: x, originY: y })

const spring = { type: 'spring' as const, stiffness: 170, damping: 15 }

interface MascotProps {
  mood: Mood
  /** CSS size of the square-ish SVG; defaults to fill its container width. */
  className?: string
  /** When set, the mascot renders as a button (e.g. "call on them"). */
  onClick?: () => void
}

export function Mascot({ mood, className, onClick }: MascotProps) {
  const reduce = useReducedMotion()
  const spec = SPECS[mood]
  const tr = reduce ? { duration: 0 } : spring

  // Gentle always-on bob. It lives on its own group so its looping transition
  // never touches the pose spring (a shared transition made rotate/scale restart each loop).
  const bob = mood === 'bored' ? { amp: 3, seconds: 4 } : mood === 'happy' ? { amp: -9, seconds: 0.6 } : { amp: -3, seconds: 3 }

  const raised = mood === 'handRaised'
  const speaking = mood === 'speaking'

  const bored = mood === 'bored' && !reduce
  const YAWN_TIMES = [0, 0.6, 0.7, 0.84, 0.92, 1]
  const YAWN_SECONDS = 9
  const yawnMouth = mouthPath({ w: 10, e: 154, u: 146, l: 190 })
  const restMouth = mouthPath(spec.mouth)

  const mouthD = speaking && !reduce
    ? [8, 18, 10, 20, 8].map((l) => mouthPath({ ...spec.mouth, l: 154 + l }))
    : bored
      ? [restMouth, restMouth, yawnMouth, yawnMouth, restMouth, restMouth]
      : restMouth
  const mouthTransition = speaking && !reduce
    ? { duration: 0.9, repeat: Infinity, ease: 'easeInOut' as const }
    : bored
      ? { duration: YAWN_SECONDS, repeat: Infinity, ease: 'easeInOut' as const, times: YAWN_TIMES }
      : tr
  // Eyes squeeze shut mid-yawn, then drift back up to the sky.
  const eyeScale = mood === 'happy' ? 0 : bored ? [0.9, 0.9, 0.1, 0.1, 0.9, 0.9] : spec.eyeOpen
  const eyeTransition = bored
    ? { duration: YAWN_SECONDS, repeat: Infinity, ease: 'easeInOut' as const, times: YAWN_TIMES }
    : tr

  const art = (
    <svg
      viewBox="-40 -30 320 290"
      role="img"
      aria-label={`Earnest the bunny, looking ${mood === 'handRaised' ? 'like they have a question' : mood}`}
      className={className}
      overflow="visible"
    >
      <motion.g
        initial={false}
        animate={spec.body}
        transition={tr}
        style={{ transformBox: 'fill-box', originX: 0.5, originY: 1 }}
      >
        <motion.g
          animate={reduce ? { y: 0 } : { y: [0, bob.amp, 0] }}
          transition={reduce ? { duration: 0 } : { duration: bob.seconds, repeat: Infinity, ease: 'easeInOut' }}
        >
        {/* ears sit behind the head */}
        <motion.g initial={false} animate={{ rotate: spec.earL, scaleY: spec.earScale }} transition={tr} style={pivot(0.5, 1)}>
          <motion.g
            animate={mood === 'listening' && !reduce ? { rotate: [0, -3, 0, 2, 0] } : mood === 'happy' && !reduce ? { rotate: [0, -6, 0] } : { rotate: 0 }}
            transition={mood === 'happy' ? { duration: 0.6, repeat: Infinity } : { duration: 2.4, repeat: Infinity, repeatDelay: 1.2 }}
            style={pivot(0.5, 1)}
          >
            <ellipse cx="90" cy="38" rx="18" ry="46" fill={LAVENDER} />
            <ellipse cx="90" cy="42" rx="9" ry="32" fill={LAVENDER_DEEP} opacity="0.55" />
          </motion.g>
        </motion.g>
        <motion.g initial={false} animate={{ rotate: spec.earR, scaleY: spec.earScale }} transition={tr} style={pivot(0.5, 1)}>
          <motion.g
            animate={mood === 'listening' && !reduce ? { rotate: [0, 3, 0, -2, 0] } : mood === 'happy' && !reduce ? { rotate: [0, 6, 0] } : { rotate: 0 }}
            transition={mood === 'happy' ? { duration: 0.6, repeat: Infinity } : { duration: 2.4, repeat: Infinity, repeatDelay: 1.6 }}
            style={pivot(0.5, 1)}
          >
            <ellipse cx="150" cy="38" rx="18" ry="46" fill={LAVENDER} />
            <ellipse cx="150" cy="42" rx="9" ry="32" fill={LAVENDER_DEEP} opacity="0.55" />
          </motion.g>
        </motion.g>

        {/* feet */}
        <ellipse cx="92" cy="220" rx="24" ry="12" fill={LAVENDER_DEEP} />
        <ellipse cx="148" cy="220" rx="24" ry="12" fill={LAVENDER_DEEP} />

        {/* body + head blob */}
        <ellipse cx="120" cy="142" rx="80" ry="78" fill={LAVENDER} />
        <ellipse cx="120" cy="192" rx="42" ry="28" fill={WARM} opacity="0.85" />

        {/* arms: pivot at the shoulder, long enough that a raised hand reads clearly */}
        <Arm cx={50} rotate={spec.armL} transition={tr} />
        <Arm
          cx={190}
          rotate={spec.armR}
          transition={tr}
          sway={raised && !reduce ? [0, 5, 0, -5, 0] : speaking && !reduce ? [0, 4, 0, 2, 0] : undefined}
          swaySeconds={raised ? 1.8 : 2.4}
        />

        {/* cheeks and nose */}
        <ellipse cx="76" cy="150" rx="11" ry="7" fill={CORAL} opacity="0.4" />
        <ellipse cx="164" cy="150" rx="11" ry="7" fill={CORAL} opacity="0.4" />
        <ellipse cx="120" cy="143" rx="5.5" ry="4" fill={CORAL} />

        {/* eyes */}
        {[96, 144].map((cx) => (
          <g key={cx}>
            <motion.g
              initial={false}
              animate={{ scaleY: eyeScale }}
              transition={eyeTransition}
              style={pivot(0.5, 0.5)}
            >
              <motion.g
                animate={reduce ? undefined : { scaleY: [1, 1, 0.1, 1, 1] }}
                transition={{ duration: 4.5, repeat: Infinity, times: [0, 0.46, 0.5, 0.54, 1] }}
                style={pivot(0.5, 0.5)}
              >
                <ellipse cx={cx} cy="124" rx="13" ry="16" fill={WARM} />
                <motion.g initial={false} animate={{ x: spec.pupil[0], y: spec.pupil[1] }} transition={tr}>
                  <ellipse cx={cx} cy="125" rx="9" ry="12" fill={PLUM} />
                  <circle cx={cx + 3} cy="120" r="3.2" fill={WARM} />
                </motion.g>
              </motion.g>
            </motion.g>
            {/* closed happy eyes: ^ ^ arcs */}
            <motion.path
              d={`M ${cx - 10} 128 Q ${cx} 114 ${cx + 10} 128`}
              fill="none"
              stroke={PLUM}
              strokeWidth="4.5"
              strokeLinecap="round"
              initial={false}
              animate={{ opacity: mood === 'happy' ? 1 : 0 }}
              transition={tr}
            />
          </g>
        ))}

        {/* brows when confused */}
        <motion.g initial={false} animate={{ opacity: mood === 'confused' ? 1 : 0 }} transition={tr}>
          <path d="M 84 100 Q 96 94 108 100" fill="none" stroke={PLUM} strokeWidth="4" strokeLinecap="round" />
          <path d="M 132 96 Q 144 88 156 98" fill="none" stroke={PLUM} strokeWidth="4" strokeLinecap="round" />
        </motion.g>

        {/* mouth */}
        <motion.path
          initial={false}
          animate={{ d: mouthD }}
          transition={mouthTransition}
          fill={mood === 'speaking' || mood === 'happy' || mood === 'handRaised' ? '#7A3F5E' : PLUM}
          stroke={PLUM}
          strokeWidth="3.5"
          strokeLinejoin="round"
        />
        </motion.g>
      </motion.g>

      {/* mood props above the head */}
      <MoodProp mood={mood} reduce={!!reduce} />
    </svg>
  )

  if (!onClick) return art
  return (
    <button
      type="button"
      onClick={onClick}
      className="cursor-pointer rounded-3xl focus-visible:outline-3 focus-visible:outline-offset-4 focus-visible:outline-[#7C5CE0]"
    >
      {art}
    </button>
  )
}

interface ArmProps {
  cx: number
  rotate: number
  transition: object
  /** Horizontal tip offsets to sway through; the shoulder end never moves. */
  sway?: number[]
  swaySeconds?: number
}

function Arm({ cx, rotate, transition, sway, swaySeconds = 2 }: ArmProps) {
  const top = 158
  const w = 12 // half thickness, same as a foot's half height
  const h = 36 // half length: a foot is 48 long, the arm is 72
  const k = 0.5523
  const cy = top + h
  // An ellipse as four curves; only the bottom point moves, so the shoulder stays put.
  const d = (dx: number) => {
    const bx = cx + dx
    const bottom = top + 2 * h
    return `M ${cx} ${top} C ${cx + k * w} ${top} ${cx + w} ${cy - k * h} ${cx + w} ${cy} C ${cx + w} ${cy + k * h} ${bx + k * w} ${bottom} ${bx} ${bottom} C ${bx - k * w} ${bottom} ${cx - w} ${cy + k * h} ${cx - w} ${cy} C ${cx - w} ${cy - k * h} ${cx - k * w} ${top} ${cx} ${top} Z`
  }
  return (
    <motion.g initial={false} animate={{ rotate }} transition={transition} style={pivot(0.5, 0)}>
      {/* invisible box keeps the pivot fixed at the shoulder while the tip sways */}
      <rect x={cx - 14} y={top} width="28" height={2 * h} fill="none" />
      <motion.path
        d={d(0)}
        animate={{ d: sway ? sway.map(d) : d(0) }}
        transition={sway ? { duration: swaySeconds, repeat: Infinity, ease: 'easeInOut' } : { duration: 0.2 }}
        fill={LAVENDER_DEEP}
      />
    </motion.g>
  )
}

function MoodProp({ mood, reduce }: { mood: Mood; reduce: boolean }) {
  // The repeat applies to y only; a shared transition would replay the fade-in every loop.
  const floatY = reduce ? { y: 0 } : { y: [0, -6, 0] }
  const floatTransition = reduce
    ? { duration: 0 }
    : { opacity: { duration: 0.3 }, y: { duration: 2, repeat: Infinity, ease: 'easeInOut' as const } }
  return (
    <g style={{ pointerEvents: 'none' }}>
      {mood === 'confused' && (
        <motion.text x="186" y="-2" fontSize="40" fontWeight="700" fill={CORAL} fontFamily="Fredoka Variable, sans-serif" initial={{ opacity: 0 }} animate={{ opacity: 1, ...floatY }} transition={floatTransition}>
          ?
        </motion.text>
      )}
      {mood === 'bored' && (
        <motion.text x="184" y="10" fontSize="26" fontWeight="700" fill={PLUM} opacity="0.5" fontFamily="Fredoka Variable, sans-serif" initial={{ opacity: 0 }} animate={{ opacity: 0.5, ...floatY }} transition={floatTransition}>
          z z
        </motion.text>
      )}
      {mood === 'thinking' && (
        <>
          {[0, 1, 2].map((i) => (
            <motion.circle
              key={i}
              cx={188 + i * 14}
              cy={10 - i * 10}
              r={4 + i * 2}
              fill={BUTTER}
              initial={{ opacity: 0 }}
              animate={reduce ? { opacity: 1 } : { opacity: [0.3, 1, 0.3], transition: { duration: 1.4, repeat: Infinity, delay: i * 0.25 } }}
            />
          ))}
        </>
      )}
      {mood === 'happy' && (
        <>
          {[[30, 10], [208, 14], [216, 60]].map(([x, y], i) => (
            <motion.path
              key={i}
              d={`M ${x} ${y - 9} L ${x + 3} ${y - 3} L ${x + 9} ${y} L ${x + 3} ${y + 3} L ${x} ${y + 9} L ${x - 3} ${y + 3} L ${x - 9} ${y} L ${x - 3} ${y - 3} Z`}
              fill={BUTTER}
              initial={{ opacity: 0, scale: 0 }}
              animate={reduce ? { opacity: 1, scale: 1 } : { opacity: [0, 1, 0], scale: [0.4, 1, 0.4], transition: { duration: 1.6, repeat: Infinity, delay: i * 0.35 } }}
              style={pivot(0.5, 0.5)}
            />
          ))}
        </>
      )}
      {mood === 'listening' && (
        <motion.g initial={{ opacity: 0 }} animate={{ opacity: 0.8 }}>
          <path d="M 14 120 Q 6 132 14 144" fill="none" stroke={MINT} strokeWidth="4" strokeLinecap="round" />
          <path d="M 4 112 Q -8 132 4 152" fill="none" stroke={MINT} strokeWidth="4" strokeLinecap="round" opacity="0.6" />
        </motion.g>
      )}
    </g>
  )
}
