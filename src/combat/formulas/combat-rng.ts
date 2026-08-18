/**
 * Phantasie III combat RNG — the confirmed LCG (scripting-engine.md §7.5):
 *
 *   seed = (seed * 25173 + 13849) mod 65536
 *   seed = seed & 0x7FFF                    (15-bit reduction)
 *   Random(range) = 1 + (seed % range)      (1..range inclusive)
 *
 * Structurally distinct from P1's `3677/3/32768` LCG and P2's additive
 * table generator — this module is P3's concrete generator (docs/
 * implementation.md §1.2).
 */

export interface CombatRng {
  /** Uniform `1..range` inclusive; `range` is clamped to at least 1. */
  roll(range: number): number;
}

export function createP3Rng(seed: number): CombatRng {
  let s = seed & 0x7fff;
  return {
    roll(range: number): number {
      s = (s * 25173 + 13849) & 0xffff;
      s = s & 0x7fff;
      return 1 + (s % Math.max(1, Math.floor(range)));
    },
  };
}
