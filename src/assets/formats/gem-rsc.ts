/**
 * GEM/AES `.RSC` resource-file decoder (Atari ST).
 *
 * `.RSC` is the **operating system's** resource-bundle format, not a
 * Phantasie format: TOS's AES loads one with `rsrc_load()` and the program
 * then addresses its contents by numeric index through `rsrc_gaddr()`. It
 * holds the entire GEM UI of an ST program — menu bars, dialog boxes,
 * alert templates — as object trees plus a flat string pool.
 *
 * Phantasie II ships three of them:
 *
 * | File | Loaded by | Contents |
 * |------|-----------|----------|
 * | `disk2/PHANT.RSC` | `PHANT.PRG` addr `0x4382` (`rsrc_load`, filename addr `0x1FB56`) | town/guild/bank/shop UI, 26 trees |
 * | `disk2/OUT.RSC` | `PHANT.PRG` addr `0x572C` (`rsrc_load`, filename addr `0x1FCA6`) | outdoor world-map UI, 44 trees |
 * | `disk1/BACKUP.RSC` | the separate `UTILIT2.PRG` backup utility | utility UI |
 *
 * Only one `.RSC` is resident at a time, so a tree index in the
 * disassembly only means something once you know which file was last
 * loaded — see `docs/phantasie/dungeon-format.md` §8.6.3, where the
 * outdoor movement code's `rsrc_gaddr(R_TREE, 15/17)` resolves against
 * `OUT.RSC`, not `PHANT.RSC`.
 *
 * All multi-byte fields are big-endian. Every offset stored in the file
 * (including `ob_spec` pointers and `te_ptext`) is a plain byte offset
 * from the start of the file; the AES fixes them up into real pointers at
 * load time, but on disk they are file-relative and can be followed
 * directly.
 *
 * Confirmed byte-exact against the real extracted files: both P2 headers'
 * `rsh_rssize` equals the file's own byte length, and every section offset
 * chains exactly into the next (`frstr + 4*nstring == tedinfo`,
 * `tedinfo + 28*nted == object`, `object + 24*nobs == trindex`,
 * `trindex + 4*ntree == rssize`).
 */

/** Header word layout (18 big-endian `u16`s, `RSHDR`). */
const HEADER_WORDS = 18;

export interface RscHeader {
  /** `rsh_vrsn` — format version (0 for the original, non-extended format). */
  version: number;
  /** `rsh_object` — byte offset of the `OBJECT` array. */
  objectOffset: number;
  /** `rsh_tedinfo` — byte offset of the `TEDINFO` array. */
  tedinfoOffset: number;
  /** `rsh_iconblk` — byte offset of the `ICONBLK` array. */
  iconblkOffset: number;
  /** `rsh_bitblk` — byte offset of the `BITBLK` array. */
  bitblkOffset: number;
  /** `rsh_frstr` — byte offset of the free-string pointer array. */
  freeStringOffset: number;
  /** `rsh_string` — byte offset of the string pool. */
  stringOffset: number;
  /** `rsh_imdata` — byte offset of the raw image data. */
  imageDataOffset: number;
  /** `rsh_frimg` — byte offset of the free-image pointer array. */
  freeImageOffset: number;
  /** `rsh_trindex` — byte offset of the tree pointer array. */
  treeIndexOffset: number;
  /** `rsh_nobs` — total `OBJECT` count across all trees. */
  objectCount: number;
  /** `rsh_ntree` — number of object trees. */
  treeCount: number;
  /** `rsh_nted` — `TEDINFO` count. */
  tedinfoCount: number;
  /** `rsh_nib` — `ICONBLK` count. */
  iconblkCount: number;
  /** `rsh_nbb` — `BITBLK` count. */
  bitblkCount: number;
  /** `rsh_nstring` — free-string count. */
  freeStringCount: number;
  /** `rsh_nimages` — free-image count. */
  imageCount: number;
  /** `rsh_rssize` — total resource size; equals the file length. */
  totalSize: number;
}

/** `ob_type` low byte — the GEM object classes that can carry text. */
export const G_BOX = 20;
export const G_TEXT = 21;
export const G_BOXTEXT = 22;
export const G_IMAGE = 23;
export const G_USERDEF = 24;
export const G_IBOX = 25;
export const G_BUTTON = 26;
export const G_BOXCHAR = 27;
export const G_STRING = 28;
export const G_FTEXT = 29;
export const G_FBOXTEXT = 30;
export const G_ICON = 31;
export const G_TITLE = 32;

/** `ob_spec` points at a bare NUL-terminated string for these types. */
const STRING_SPEC_TYPES = new Set([G_BUTTON, G_STRING, G_TITLE]);
/** `ob_spec` points at a `TEDINFO` for these types. */
const TEDINFO_SPEC_TYPES = new Set([G_TEXT, G_BOXTEXT, G_FTEXT, G_FBOXTEXT]);

export interface RscObject {
  /** Index of this object within its tree. */
  index: number;
  /** `ob_next` — next sibling, or `-1`. */
  next: number;
  /** `ob_head` — first child, or `-1`. */
  head: number;
  /** `ob_tail` — last child, or `-1`. */
  tail: number;
  /** `ob_type` (full word; the object class is the low byte). */
  type: number;
  /** `ob_type & 0xff` — the GEM object class, one of the `G_*` constants. */
  objectClass: number;
  /** `ob_flags`. */
  flags: number;
  /** `ob_state`. */
  state: number;
  /** `ob_spec` — raw, still a file-relative byte offset for text objects. */
  spec: number;
  /** `ob_x`, in character cells relative to the parent. */
  x: number;
  /** `ob_y`, in character cells relative to the parent. */
  y: number;
  /** `ob_width`, in character cells. */
  width: number;
  /** `ob_height`, in character cells. */
  height: number;
  /** Depth in the tree (root is 0). */
  depth: number;
  /**
   * The object's displayed text, or `undefined` for object classes that
   * carry no text. For `TEDINFO`-backed classes this is `te_ptext`, which
   * in a shipped resource file is the author's *placeholder* — the running
   * program overwrites it for objects it fills in at runtime.
   */
  text?: string;
}

const OBJECT_SIZE = 24;
const TEDINFO_SIZE = 28;

const decodeAscii = (bytes: Uint8Array) => new TextDecoder('ascii').decode(bytes);

function readCStringAt(data: Uint8Array, offset: number): string | undefined {
  if (offset <= 0 || offset >= data.length) return undefined;
  let end = offset;
  while (end < data.length && data[end] !== 0) end++;
  return decodeAscii(data.subarray(offset, end));
}

export function readRscHeader(data: Uint8Array): RscHeader {
  if (data.length < HEADER_WORDS * 2) {
    throw new Error(`RSC too small: ${data.length} bytes`);
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const w = (i: number) => view.getUint16(i * 2, false);
  return {
    version: w(0),
    objectOffset: w(1),
    tedinfoOffset: w(2),
    iconblkOffset: w(3),
    bitblkOffset: w(4),
    freeStringOffset: w(5),
    stringOffset: w(6),
    imageDataOffset: w(7),
    freeImageOffset: w(8),
    treeIndexOffset: w(9),
    objectCount: w(10),
    treeCount: w(11),
    tedinfoCount: w(12),
    iconblkCount: w(13),
    bitblkCount: w(14),
    freeStringCount: w(15),
    imageCount: w(16),
    totalSize: w(17),
  };
}

/**
 * Byte offset of tree `treeIndex`'s root `OBJECT`, read from the
 * `rsh_trindex` pointer array. This is the on-disk equivalent of the
 * address `rsrc_gaddr(R_TREE, treeIndex, &addr)` hands back at runtime.
 */
export function treeOffset(data: Uint8Array, header: RscHeader, treeIndex: number): number {
  if (treeIndex < 0 || treeIndex >= header.treeCount) {
    throw new Error(`tree index ${treeIndex} out of range (0..${header.treeCount - 1})`);
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return view.getUint32(header.treeIndexOffset + treeIndex * 4, false);
}

function readObject(
  data: Uint8Array,
  treeBase: number,
  index: number,
  depth: number,
): RscObject {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const o = treeBase + index * OBJECT_SIZE;
  if (o + OBJECT_SIZE > data.length) {
    throw new Error(`OBJECT ${index} at 0x${o.toString(16)} runs past end of resource`);
  }
  const type = view.getUint16(o + 6, false);
  const objectClass = type & 0xff;
  const spec = view.getUint32(o + 12, false);

  let text: string | undefined;
  if (STRING_SPEC_TYPES.has(objectClass)) {
    text = readCStringAt(data, spec);
  } else if (TEDINFO_SPEC_TYPES.has(objectClass)) {
    if (spec > 0 && spec + TEDINFO_SIZE <= data.length) {
      text = readCStringAt(data, view.getUint32(spec, false));
    }
  } else if (objectClass === G_BOXCHAR) {
    // The character lives in the top byte of ob_spec, not in the pool.
    const code = (spec >>> 24) & 0xff;
    text = code >= 0x20 && code < 0x7f ? String.fromCharCode(code) : undefined;
  }

  return {
    index,
    next: view.getInt16(o + 0, false),
    head: view.getInt16(o + 2, false),
    tail: view.getInt16(o + 4, false),
    type,
    objectClass,
    flags: view.getUint16(o + 8, false),
    state: view.getUint16(o + 10, false),
    spec,
    x: view.getInt16(o + 16, false),
    y: view.getInt16(o + 18, false),
    width: view.getInt16(o + 20, false),
    height: view.getInt16(o + 22, false),
    depth,
    text,
  };
}

/**
 * Walk one object tree, returning every object in index order with its
 * depth filled in. The walk follows `ob_head`/`ob_next`/`ob_tail` and is
 * cycle-guarded, so a malformed tree yields a short list rather than
 * hanging.
 */
export function readTree(data: Uint8Array, header: RscHeader, treeIndex: number): RscObject[] {
  const base = treeOffset(data, header, treeIndex);
  const out: RscObject[] = [];
  const seen = new Set<number>();
  const stack: Array<[number, number]> = [[0, 0]];

  while (stack.length > 0) {
    const [index, depth] = stack.pop()!;
    if (index < 0 || seen.has(index)) continue;
    seen.add(index);
    const object = readObject(data, base, index, depth);
    out.push(object);

    if (object.head >= 0 && object.tail >= 0) {
      const children: number[] = [];
      let child = object.head;
      while (child >= 0 && children.length <= header.objectCount) {
        children.push(child);
        if (child === object.tail) break;
        child = readObject(data, base, child, depth + 1).next;
      }
      for (let i = children.length - 1; i >= 0; i--) stack.push([children[i], depth + 1]);
    }
  }

  out.sort((a, b) => a.index - b.index);
  return out;
}

/**
 * Every text string in a tree, in object-index order, with surrounding
 * whitespace kept — GEM dialogs centre their labels by padding, so the
 * spaces are part of the shipped content.
 */
export function treeStrings(data: Uint8Array, header: RscHeader, treeIndex: number): string[] {
  return readTree(data, header, treeIndex)
    .map((object) => object.text)
    .filter((text): text is string => text !== undefined);
}

/**
 * The `rsh_frstr` free-string table — the strings a program reaches with
 * `rsrc_gaddr(R_STRING, index, ...)`. In both Phantasie II resource files
 * these are `form_alert()` templates in GEM's
 * `[icon][line|line|line][button|button]` syntax.
 */
export function freeStrings(data: Uint8Array, header: RscHeader): string[] {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const out: string[] = [];
  for (let i = 0; i < header.freeStringCount; i++) {
    const pointer = view.getUint32(header.freeStringOffset + i * 4, false);
    out.push(readCStringAt(data, pointer) ?? '');
  }
  return out;
}
