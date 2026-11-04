// The upstream counter reports check-ins minus check-outs. Members who leave without checking out stay
// counted ("ghosts") until the counter is reset once per day, so the raw value inflates over the day.
// This module learns the reset hour and the ghost share per gym from history and subtracts the
// estimated ghosts from the raw series.

export interface CounterSample {
  time: number // epoch ms
  hour: number // local (Europe/Berlin) hour of the sample
  count: number
}

export interface GhostModel {
  resetHour: number | null
  ghostRatio: number // ghosts per counted check-in
  lagMinutes: number
  segments: number // number of complete reset-to-reset segments the ratio was fitted on
}

// A check-in only turns into a ghost once the member would have left, roughly one visit later.
const DEFAULT_LAG_MINUTES = 75
// Steps across longer gaps are not trusted as check-ins and restart the segment.
const MAX_STEP_GAP_MS = 15 * 60 * 1000
const SEGMENT_BREAK_GAP_MS = 3 * 60 * 60 * 1000
const MIN_SEGMENT_CHECKINS = 20
const MAX_FIT_SEGMENTS = 28
// A flat counter before the reset proves every regular member has left, so the value is pure ghosts.
const CLEAN_FLAT_MINUTES = 60
const MIN_CLEAN_SEGMENTS = 5
// Ghosts never leave, so the estimate may never exceed the lowest count seen within this window.
const GHOST_BOUND_WINDOW_MINUTES = 180

export const NO_GHOST_MODEL: GhostModel = { resetHour: null, ghostRatio: 0, lagMinutes: DEFAULT_LAG_MINUTES, segments: 0 }

function isResetDrop(previous: number, current: number): boolean {
  const drop = previous - current
  return drop >= Math.max(10, previous * 0.5)
}

function hourDistance(a: number, b: number): number {
  const diff = Math.abs(a - b) % 24
  return Math.min(diff, 24 - diff)
}

export function detectResetHour(samples: CounterSample[]): number | null {
  const dropsByHour = Array<number>(24).fill(0)
  const days = new Set<number>()

  for (let i = 1; i < samples.length; i += 1) {
    days.add(Math.floor(samples[i].time / 86_400_000))
    if (samples[i].time - samples[i - 1].time > MAX_STEP_GAP_MS) continue
    if (isResetDrop(samples[i - 1].count, samples[i].count)) {
      dropsByHour[samples[i].hour] += 1
    }
  }

  let bestHour = 0
  for (let hour = 1; hour < 24; hour += 1) {
    if (dropsByHour[hour] > dropsByHour[bestHour]) bestHour = hour
  }

  // The reset must happen on most days, otherwise the drops are just people leaving.
  return dropsByHour[bestHour] >= Math.max(5, days.size * 0.5) ? bestHour : null
}

function isResetAt(samples: CounterSample[], i: number, resetHour: number): boolean {
  return (
    samples[i].time - samples[i - 1].time <= SEGMENT_BREAK_GAP_MS &&
    hourDistance(samples[i].hour, resetHour) <= 1 &&
    isResetDrop(samples[i - 1].count, samples[i].count)
  )
}

function isFlatBefore(samples: CounterSample[], lastIndex: number): boolean {
  const since = samples[lastIndex].time - CLEAN_FLAT_MINUTES * 60 * 1000
  let first = lastIndex
  while (first > 0 && samples[first - 1].time >= since) first -= 1
  if (samples[first].time - since > MAX_STEP_GAP_MS) return false

  let min = samples[lastIndex].count
  let max = min
  for (let i = first; i < lastIndex; i += 1) {
    min = Math.min(min, samples[i].count)
    max = Math.max(max, samples[i].count)
  }
  return max - min <= 1
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle]
}

export function fitGhostModel(samples: CounterSample[], lagMinutes = DEFAULT_LAG_MINUTES): GhostModel {
  const resetHour = detectResetHour(samples)
  if (resetHour === null) {
    return { ...NO_GHOST_MODEL, lagMinutes }
  }

  const ratios: number[] = []
  const cleanRatios: number[] = []
  // null until the first reset: the first partial segment has an unknown start.
  let checkins: number | null = null

  for (let i = 1; i < samples.length; i += 1) {
    const gap = samples[i].time - samples[i - 1].time

    if (isResetAt(samples, i, resetHour)) {
      if (checkins !== null && checkins >= MIN_SEGMENT_CHECKINS) {
        const ghosts = samples[i - 1].count - samples[i].count
        ratios.push(ghosts / checkins)
        if (isFlatBefore(samples, i - 1)) cleanRatios.push(ghosts / checkins)
      }
      checkins = 0
      continue
    }

    if (gap > SEGMENT_BREAK_GAP_MS) {
      checkins = null
      continue
    }

    if (checkins !== null && gap <= MAX_STEP_GAP_MS) {
      checkins += Math.max(0, samples[i].count - samples[i - 1].count)
    }
  }

  if (ratios.length === 0) {
    return { ...NO_GHOST_MODEL, resetHour, lagMinutes }
  }

  // Prefer days where the gym was empty before the reset (e.g. closed for a while). Where the reset
  // happens at closing time or the gym runs 24h, real members are still counted and inflate the ratio.
  const fitRatios = cleanRatios.length >= MIN_CLEAN_SEGMENTS ? cleanRatios : ratios
  const recent = fitRatios.slice(-MAX_FIT_SEGMENTS)
  return {
    resetHour,
    ghostRatio: Math.min(0.9, Math.max(0, median(recent))),
    lagMinutes,
    segments: recent.length,
  }
}

/** Returns the estimated real occupancy for each sample (same order as the input). */
export function applyGhostCorrection(samples: CounterSample[], model: GhostModel): number[] {
  if (model.resetHour === null || model.ghostRatio <= 0) {
    return samples.map((sample) => sample.count)
  }

  const resetHour = model.resetHour
  const lagMs = model.lagMinutes * 60 * 1000
  const boundMs = GHOST_BOUND_WINDOW_MINUTES * 60 * 1000
  const adjusted: number[] = []
  // Unclamped estimates (count - modelled ghosts) of the current segment within the bound window.
  let recentEstimates: Array<{ time: number; estimate: number }> = []

  // Cumulative check-ins of the current segment, used to look up the value one lag ago.
  let history: Array<{ time: number; checkins: number }> = []
  let lagIndex = -1
  let checkins = 0
  let floor = 0

  const startSegment = (index: number, isReset: boolean) => {
    checkins = 0
    history = [{ time: samples[index].time, checkins: 0 }]
    lagIndex = 0
    floor = isReset ? residualAfterReset(samples, index) : 0
    recentEstimates = []
  }

  for (let i = 0; i < samples.length; i += 1) {
    const sample = samples[i]

    if (i === 0 || samples[i].time - samples[i - 1].time > SEGMENT_BREAK_GAP_MS) {
      startSegment(i, false)
    } else if (isResetAt(samples, i, resetHour)) {
      startSegment(i, true)
    } else if (sample.time - samples[i - 1].time <= MAX_STEP_GAP_MS) {
      checkins += Math.max(0, sample.count - samples[i - 1].count)
    }

    history.push({ time: sample.time, checkins })
    while (lagIndex + 1 < history.length && history[lagIndex + 1].time <= sample.time - lagMs) {
      lagIndex += 1
    }

    const ghosts = floor + Math.round(model.ghostRatio * history[lagIndex].checkins)
    const estimate = sample.count - ghosts

    // Ghosts(t) <= count(s) + ghosts added since s for every earlier s, because ghosts cannot leave.
    // If the estimate dipped below zero recently, the model over-subtracts and everything above that
    // dip is real (e.g. night visitors in a 24h gym).
    recentEstimates.push({ time: sample.time, estimate })
    while (recentEstimates[0].time < sample.time - boundMs) recentEstimates.shift()
    const lowest = Math.min(...recentEstimates.map((entry) => entry.estimate))

    adjusted.push(Math.max(0, estimate - Math.min(0, lowest)))
  }

  return adjusted
}

// Some counters keep a few entries through the reset. If the value right after the reset stays flat
// for an hour (nobody there), it is a residual that persists for the whole segment.
function residualAfterReset(samples: CounterSample[], resetIndex: number): number {
  const residual = samples[resetIndex].count
  const until = samples[resetIndex].time + 60 * 60 * 1000
  let seen = 0

  for (let i = resetIndex + 1; i < samples.length && samples[i].time <= until; i += 1) {
    if (samples[i].count !== residual) return 0
    seen += 1
  }

  return seen >= 3 ? residual : 0
}

export function correctGhosts(samples: CounterSample[]): { model: GhostModel; adjusted: number[] } {
  const model = fitGhostModel(samples)
  return { model, adjusted: applyGhostCorrection(samples, model) }
}
