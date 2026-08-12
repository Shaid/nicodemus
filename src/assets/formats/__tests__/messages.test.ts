import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  decodeMessageWordTable,
  decodeMessageLine,
  decodeP1P2Message,
  decodeAllP1P2Messages,
  choiceTextWidth,
  sliceChoiceText,
  decodeP3Message,
  decodeAllP3Messages,
  wrapP3Message,
  MESSAGE_TEXT_BASE,
} from '../messages.ts';
import { decodeP3MessagePointers } from '../dungeon-p3.ts';

const MESS1_PATH = resolve('data/phantasie/amiga/mess1');
const MESS4_PATH = resolve('data/phantasie/amiga/mess4');
const DNGA_PATH = resolve('data/phantasieiii/amiga/D/dnga.dat');

describe('P1/P2 message file (scripting-engine.md §3.1)', () => {
  it('decodes mess1s word table and confirms MESSAGE_TEXT_BASE = 0xE6', () => {
    expect(MESSAGE_TEXT_BASE).toBe(0xe6);
    const data = new Uint8Array(readFileSync(MESS1_PATH));
    const words = decodeMessageWordTable(data);
    expect(words).toHaveLength(115);
    // Byte-exact confirmed sequence from dungeon-format.md/scripting-engine.md §3.1.
    expect(words.slice(6, 15)).toEqual([0x29, 0x52, 0x52, 0x52, 0x52, 0x7b, 0xa4, 0xcd, 0xcd]);
  });

  it('decodes the confirmed line at 0xE6+0x29 to the literal "THE PARTY MEMBERS..." text', () => {
    const data = new Uint8Array(readFileSync(MESS1_PATH));
    const line = decodeMessageLine(data, MESSAGE_TEXT_BASE + 0x29);
    expect(line.lengthByte).toBe(1);
    expect(line.text).toBe('  THE PARTY MEMBERS CHOKE AND GASP.     ');
  });

  it('decodes the confirmed line at 0xE6+0x52 ("--- A DAMP DARK STONE TUNNEL ---"), length 0x28', () => {
    const data = new Uint8Array(readFileSync(MESS1_PATH));
    const line = decodeMessageLine(data, MESSAGE_TEXT_BASE + 0x52);
    expect(line.lengthByte).toBe(0x28);
    expect(line.text).toBe('   --- A DAMP DARK STONE TUNNEL ---     ');
  });

  it('message index 5 (the first slot whose word differs from its successor) spans two 41-byte lines and is not empty', () => {
    const data = new Uint8Array(readFileSync(MESS1_PATH));
    const words = decodeMessageWordTable(data);
    // words[0..5] are all 0 (six duplicate entries); word[6] is the first
    // distinct value (0x29). Only index 5 (word differs from its successor)
    // resolves as real content — see the "duplicate consecutive entries"
    // test below for why indices 0-4 are empty.
    const msg = decodeP1P2Message(data, words, 5);
    expect(msg.empty).toBe(false);
    expect(msg.length).toBe(80);
    expect(msg.lineCount).toBe(2);
    expect(msg.text).toBe(
      'A STRANGE PURPLE GAS FILLS THE AIR.       THE PARTY MEMBERS CHOKE AND GASP.     ',
    );
  });

  it('duplicate consecutive word-table entries decode as empty', () => {
    const data = new Uint8Array(readFileSync(MESS1_PATH));
    const words = decodeMessageWordTable(data);
    // Indices 0-4 all share word value 0 with their successor (confirmed dupes).
    for (const i of [0, 1, 2, 3, 4]) {
      expect(decodeP1P2Message(data, words, i).empty).toBe(true);
    }
  });

  it('message index 90 (dng1 star slot 0s real message) — corrected choice-count matches the real star nbChoices=2', () => {
    const data = new Uint8Array(readFileSync(MESS1_PATH));
    const words = decodeMessageWordTable(data);
    const msg = decodeP1P2Message(data, words, 90);
    expect(msg.empty).toBe(false);
    expect(msg.length).toBe(80);
    expect(msg.text).toBe(
      'THERE ARE ABOUT 250 GOLD PIECES HERE    THAT APPEAR TO BE COATED WITH LIQUID.   ',
    );
    // Raw next-line byte is 3; corrected hint (raw-1) matches the star's real nbChoices=2.
    expect(msg.choiceLineText).toBe(' TAKE THEM  LEAVE THEM                  ');
    expect(msg.embeddedChoiceCountHint).toBe(2);
    expect(sliceChoiceText(msg.choiceLineText!, 2)).toEqual(['TAKE THEM', 'LEAVE THEM']);
  });

  it('message index 69 in mess1 (dng1 star slot 2, nbChoices=3) — corrected hint matches, choice text slices to 3 items', () => {
    const data = new Uint8Array(readFileSync(MESS1_PATH));
    const words = decodeMessageWordTable(data);
    const msg = decodeP1P2Message(data, words, 69);
    expect(msg.text).toBe('THERE IS A SCROLL HERE ON A TABLE.      ');
    expect(msg.choiceLineText).toBe('  READ IT    BURN IT    LEAVE IT        ');
    expect(msg.embeddedChoiceCountHint).toBe(3);
    expect(sliceChoiceText(msg.choiceLineText!, 3)).toEqual(['READ IT', 'BURN IT', 'LEAVE IT']);
  });

  it('message index 59 in mess4 (dng4 star nbChoices=9, width-3 digit choices)', () => {
    const data = new Uint8Array(readFileSync(MESS4_PATH));
    const words = decodeMessageWordTable(data);
    const msg = decodeP1P2Message(data, words, 59);
    expect(msg.embeddedChoiceCountHint).toBe(9);
    expect(choiceTextWidth(9)).toBe(3);
    expect(sliceChoiceText(msg.choiceLineText!, 9)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9']);
  });

  it('choiceTextWidth: 11 normally, 3 when >7, 5 when exactly 8', () => {
    expect(choiceTextWidth(2)).toBe(11);
    expect(choiceTextWidth(7)).toBe(11);
    expect(choiceTextWidth(8)).toBe(5);
    expect(choiceTextWidth(9)).toBe(3);
  });

  it('decodeAllP1P2Messages decodes all 115 slots without throwing, across all 10 real P1 mess files', () => {
    for (let n = 1; n <= 10; n++) {
      const path = resolve(`data/phantasie/amiga/mess${n}`);
      const data = new Uint8Array(readFileSync(path));
      const messages = decodeAllP1P2Messages(data);
      expect(messages).toHaveLength(115);
    }
  });
});

describe('P3 message text pool (scripting-engine.md §3.2)', () => {
  it('slot 5 decodes to "Arrows fire from a slit in the roof."', () => {
    const data = new Uint8Array(readFileSync(DNGA_PATH));
    const pointers = decodeP3MessagePointers(data);
    const text = decodeP3Message(data, pointers[5]);
    expect(text).toBe('Arrows fire from a slit in the roof.     ');
  });

  it('slot 6 decodes to "Molten lead is poured from the roof."', () => {
    const data = new Uint8Array(readFileSync(DNGA_PATH));
    const pointers = decodeP3MessagePointers(data);
    const text = decodeP3Message(data, pointers[6]);
    expect(text).toBe('Molten lead is poured from the roof. ');
  });

  it('an empty pointer slot (address null) decodes to null', () => {
    const data = new Uint8Array(readFileSync(DNGA_PATH));
    const pointers = decodeP3MessagePointers(data);
    const emptySlot = pointers.find((p) => p.address === null);
    expect(emptySlot).toBeDefined();
    expect(decodeP3Message(data, emptySlot!)).toBeNull();
  });

  it('decodeAllP3Messages resolves all 110 slots with 0 decode failures for at least the first 15', () => {
    const data = new Uint8Array(readFileSync(DNGA_PATH));
    const pointers = decodeP3MessagePointers(data);
    const messages = decodeAllP3Messages(data, pointers);
    expect(messages).toHaveLength(110);
    // At least the doc-confirmed first 15 slots resolve to non-garbage.
    let nonNull = 0;
    for (let i = 0; i < 15; i++) {
      if (messages[i] !== null) nonNull++;
    }
    expect(nonNull).toBeGreaterThan(0);
  });

  it('wrapP3Message wraps at the default 38-char width and forces breaks on \\n', () => {
    expect(wrapP3Message('a'.repeat(50))).toEqual(['a'.repeat(38), 'a'.repeat(12)]);
    expect(wrapP3Message('hello\nworld')).toEqual(['hello', 'world']);
  });
});
