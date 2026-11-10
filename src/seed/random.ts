/**
 * Small seeded PRNG (mulberry32). Using a fixed seed means `pnpm seed --reset`
 * produces the same data every time, so bugs found on seeded data are reproducible.
 */
export function createRandom(seed: number) {
  let state = seed >>> 0

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  const int = (min: number, max: number): number => min + Math.floor(next() * (max - min + 1))

  const pick = <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)]

  const weighted = <T extends string>(weights: Record<T, number>): T => {
    const entries = Object.entries(weights) as [T, number][]
    const total = entries.reduce((sum, [, weight]) => sum + weight, 0)
    let roll = next() * total
    for (const [value, weight] of entries) {
      roll -= weight
      if (roll < 0) {
        return value
      }
    }
    return entries[entries.length - 1][0]
  }

  return { next, int, pick, weighted }
}

export type Random = ReturnType<typeof createRandom>
