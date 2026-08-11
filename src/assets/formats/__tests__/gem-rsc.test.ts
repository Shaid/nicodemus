import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  G_BOX,
  G_BUTTON,
  G_STRING,
  G_TEXT,
  G_TITLE,
  freeStrings,
  readRscHeader,
  readTree,
  treeOffset,
  treeStrings,
} from '../gem-rsc.ts';

/**
 * GEM `.RSC` resource files (Phantasie II, Atari ST) — see
 * `docs/phantasie/dungeon-format.md` §8.6.3. Fixtures are the real
 * extracted floppy files.
 */
const DISK1 = resolve('data/phantasieii/atarist/extracted/disk1');
const DISK2 = resolve('data/phantasieii/atarist/extracted/disk2');
const read = (dir: string, name: string) => new Uint8Array(readFileSync(resolve(dir, name)));

const PHANT_RSC = read(DISK2, 'PHANT.RSC');
const OUT_RSC = read(DISK2, 'OUT.RSC');
const BACKUP_RSC = read(DISK1, 'BACKUP.RSC');

describe('GEM .RSC header', () => {
  const cases: Array<[string, Uint8Array, number, number]> = [
    ['PHANT.RSC', PHANT_RSC, 26, 266],
    ['OUT.RSC', OUT_RSC, 44, 320],
    ['BACKUP.RSC', BACKUP_RSC, 0, 0],
  ];

  it.each(cases)('%s: rsh_rssize equals the real file length', (_name, data) => {
    expect(readRscHeader(data).totalSize).toBe(data.length);
  });

  it.each(cases)('%s: tree and object counts', (_name, data, trees, objects) => {
    const header = readRscHeader(data);
    if (trees > 0) {
      expect(header.treeCount).toBe(trees);
      expect(header.objectCount).toBe(objects);
    }
    expect(header.version).toBe(0);
  });

  it.each(cases)('%s: section offsets chain exactly', (_name, data) => {
    const h = readRscHeader(data);
    // BACKUP.RSC ships nstring = 0, and its rsh_frstr then degenerates to a
    // bare end-of-pool marker with ~516 unused bytes before rsh_tedinfo, so
    // only the files that actually carry free strings close this link.
    if (h.freeStringCount > 0) {
      expect(h.freeStringOffset + 4 * h.freeStringCount).toBe(h.tedinfoOffset);
    }
    expect(h.tedinfoOffset + 28 * h.tedinfoCount).toBe(h.objectOffset);
    expect(h.objectOffset + 24 * h.objectCount).toBe(h.treeIndexOffset);
    expect(h.treeIndexOffset + 4 * h.treeCount).toBe(h.totalSize);
  });
});

describe('OUT.RSC — the outdoor world-map resource', () => {
  const header = readRscHeader(OUT_RSC);

  it('tree 0 is the outdoor menu bar', () => {
    const strings = treeStrings(OUT_RSC, header, 0);
    expect(strings).toContain(' Info     ');
    expect(strings).toContain('   Options  ');
    expect(strings).toContain('  Speed  ');
    expect(strings).toContain('  Cast spell  ');
    // The Speed menu's three delay settings, in the order PHANT.PRG's
    // dispatcher at addr 0x1739E maps to 5 / 10 / 1000 ms.
    expect(strings).toContain('   fast   ');
    expect(strings).toContain('   normal ');
    expect(strings).toContain('   slow   ');
  });

  /**
   * The section-gate refusal pair — `dungeon-format.md` §8.6.3. The
   * movement handler at addr `0x64AC` picks tree 15 when the current
   * section is above 16 and tree 17 otherwise.
   */
  it('tree 15 is "THE RIVER STYX"', () => {
    expect(treeStrings(OUT_RSC, header, 15)).toEqual([' THE RIVER STYX ']);
  });

  it('tree 17 is "THAT IS THE OCEAN"', () => {
    expect(treeStrings(OUT_RSC, header, 17)).toEqual([' THAT IS THE OCEAN ']);
  });

  it('both refusal trees are a bare box + one text line, no button', () => {
    for (const index of [15, 17]) {
      const objects = readTree(OUT_RSC, header, index);
      expect(objects).toHaveLength(2);
      expect(objects[0].objectClass).toBe(G_BOX);
      expect(objects[1].objectClass).toBe(G_TEXT);
      // No G_BUTTON anywhere: these dismiss on the evnt_multi timeout or a
      // keypress (PHANT.PRG addr 0x16CBE), never on a click target.
      expect(objects.some((o) => o.objectClass === G_BUTTON)).toBe(false);
    }
  });

  it('tree offsets come from rsh_trindex', () => {
    expect(treeOffset(OUT_RSC, header, 15)).toBe(0x39b4);
    expect(treeOffset(OUT_RSC, header, 17)).toBe(0x3a2c);
  });

  it('rejects an out-of-range tree index', () => {
    expect(() => treeOffset(OUT_RSC, header, header.treeCount)).toThrow(/out of range/);
  });

  it('has exactly one free string, a form_alert template', () => {
    expect(freeStrings(OUT_RSC, header)).toEqual(['[0][Not enough Magic     ][ SORRY ]']);
  });
});

describe('PHANT.RSC — the town/guild/shop resource', () => {
  const header = readRscHeader(PHANT_RSC);

  it('tree 0 is the town menu bar', () => {
    const strings = treeStrings(PHANT_RSC, header, 0);
    expect(strings).toContain(' Town options  ');
    expect(strings).toContain('  Save game');
  });

  it('tree 3 lists the six character-creation races', () => {
    const strings = treeStrings(PHANT_RSC, header, 3);
    expect(strings.slice(0, 6)).toEqual([
      'HUMAN',
      'DWARF',
      'ELF',
      'HALFLING',
      'GNOME',
      'RANDOM',
    ]);
  });

  it('tree 4 lists the six classes', () => {
    const strings = treeStrings(PHANT_RSC, header, 4);
    expect(strings.slice(0, 6)).toEqual([
      'THIEF',
      'MONK',
      'RANGER',
      'FIGHTER',
      'PRIEST',
      'WIZARD',
    ]);
  });

  it('carries 15 form_alert templates in the free-string table', () => {
    const strings = freeStrings(PHANT_RSC, header);
    expect(strings).toHaveLength(15);
    expect(strings[9]).toBe('[0][               | D O N E !      |            ][ O.K. ]');
    for (const s of strings) expect(s.startsWith('[0][')).toBe(true);
  });

  it('menu titles are G_TITLE and menu entries are G_STRING', () => {
    const objects = readTree(PHANT_RSC, header, 0);
    const titles = objects.filter((o) => o.objectClass === G_TITLE);
    expect(titles.map((o) => o.text)).toEqual([' Info  ', ' Town options  ']);
    expect(objects.filter((o) => o.objectClass === G_STRING).length).toBeGreaterThan(10);
  });
});
