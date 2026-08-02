/**
 * Small shared helper for reading fixed-width, NUL-terminated ASCII strings
 * out of raw binary buffers — used by every Phantasie table decoder that
 * reads names out of an executable or a fixed-stride record file
 * (`exe-data.ts`'s monster/race name tables, `monster-data.ts`'s per-record
 * name field).
 */

/**
 * Read a NUL-terminated ASCII string starting at `offset`, stopping at the
 * first NUL byte or after `maxLength` bytes, whichever comes first.
 */
export function readCString(data: Uint8Array, offset: number, maxLength = 256): string {
  const limit = Math.min(data.length, offset + maxLength);
  let end = offset;
  while (end < limit && data[end] !== 0) end++;
  return new TextDecoder('ascii').decode(data.subarray(offset, end));
}
