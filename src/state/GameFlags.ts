/**
 * Bitmask arithmetic for the P3 script opcodes that set/test per-character
 * stat bits — opcode 0x18 ("Set stat bitmask") and 0x19 ("Bitmask gate").
 *
 * These opcodes store arbitrary 16-bit bitfields *inside* a character's
 * flat stat word (scripting-engine.md §5), so this module is pure bit
 * arithmetic over a stat word; the party-wide per-member loop lives in
 * DungeonHost, not here.
 */

/** `bitNumber` is 1-based (opcode param): bit value = `1 << (bitNumber - 1)`. */
export function bitValue(bitNumber: number): number {
  return 1 << (bitNumber - 1);
}

/** Opcode 0x18: `setNotClear` true → OR the bit in; false → AND it out. */
export function applyBit(word: number, bitNumber: number, setNotClear: boolean): number {
  const bit = bitValue(bitNumber);
  return (setNotClear ? word | bit : word & ~bit) & 0xffff;
}

/** Opcode 0x19: true when stat word `word` has `bitNumber` set. */
export function hasBit(word: number, bitNumber: number): boolean {
  return (word & bitValue(bitNumber)) !== 0;
}
