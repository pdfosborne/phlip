import type { Look } from './bot/engine'
import { clamp, easings } from './bot/math'

/** Degrees of head yaw/pitch while following a target. Chosen, not measured. */
export const YAW_MAX = 16
export const PITCH_MAX = 13
/** Absolute pitch with the target at centre (attentive, not vacant). */
export const PITCH = 10
/** Resting yaw offset while following (look slightly aside of centre). */
export const TURN = 0
/** Spin (degrees) melted during the turn-in. Unused when tour is already 1. */
export const SPIN = 360
export const TURN_TIME = 1.1

export interface Aim {
  nx: number
  ny: number
  tour: number
  pointer: boolean
  /** Nearby chrome (FAB → peek tab): tighter, more downward pitch. */
  near?: boolean
}

/**
 * Gaze target. `nx`/`ny` are already normalized (-1..1) from the bot centre.
 * Screen y grows downward; pitch grows upward, hence the sign flip.
 *
 * `TURN` is 0 here (rail icon looks at the target, not a settings panel).
 */
export function lookTarget({ nx, ny, tour, pointer, near }: Aim): Look {
  const pitch0 = near ? -8 : PITCH
  const pitchSpan = near ? 20 : PITCH_MAX
  return {
    yaw: -TURN + nx * YAW_MAX,
    pitch: pitch0 - ny * pitchSpan,
    mix: tour,
    spin: SPIN * (1 - tour),
    wander: pointer ? 0 : 1
  }
}

export { clamp, easings }
