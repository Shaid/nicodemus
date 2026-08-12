import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  readScrollLines,
  readScrollDocuments,
  SCROLL_LINE_LENGTH,
  SCROLL_LINE_COUNT,
  SCROLL_FILE_BYTES,
  SCROLL_SLOT_LINES,
  SCROLL_SLOT_COUNT,
} from '../scrolls.ts';

const SCROLLS_PATH = resolve('data/phantasie/amiga/scrolls.dtx');

describe('readScrollLines — scrolls.dtx (dungeon-format.md §8.4)', () => {
  it('confirms the file is exactly 400 x 40-byte lines', () => {
    const data = new Uint8Array(readFileSync(SCROLLS_PATH));
    expect(data.length).toBe(SCROLL_FILE_BYTES);
    expect(SCROLL_LINE_LENGTH * SCROLL_LINE_COUNT).toBe(16000);
  });

  it('decodes the opening lines as the known "THE HISTORY OF GELNOR" text', () => {
    const data = new Uint8Array(readFileSync(SCROLLS_PATH));
    const lines = readScrollLines(data);
    expect(lines).toHaveLength(SCROLL_LINE_COUNT);
    expect(lines[0].trim()).toBe('THE HISTORY OF GELNOR');
    expect(lines[1].trim()).toBe('PART 1');
    expect(lines[2].trim()).toBe('FOR MANY YEARS THE ISLAND OF');
  });

  it('decodes a fully-NUL line slot as the empty string', () => {
    const data = new Uint8Array(readFileSync(SCROLLS_PATH));
    const lines = readScrollLines(data);
    // Line 18 (0-based) is the first blank separator after "PART 1".
    expect(lines[18]).toBe('');
  });

  it('throws rather than silently truncating a too-short file', () => {
    expect(() => readScrollLines(new Uint8Array(100))).toThrow();
  });
});

describe('readScrollDocuments — confirmed 20-line/800-byte scroll-slot boundary', () => {
  it('finds exactly 19 scroll documents', () => {
    const data = new Uint8Array(readFileSync(SCROLLS_PATH));
    const docs = readScrollDocuments(data);
    expect(docs).toHaveLength(19);
  });

  it('every document start line is an exact multiple of the 20-line slot size — zero deviations', () => {
    const data = new Uint8Array(readFileSync(SCROLLS_PATH));
    const docs = readScrollDocuments(data);
    for (const doc of docs) {
      expect(doc.startLine % SCROLL_SLOT_LINES).toBe(0);
    }
  });

  it('the file holds exactly 20 fixed 20-line slots (16000 / 40 / 20)', () => {
    expect(SCROLL_SLOT_COUNT).toBe(20);
  });

  it('the "HISTORY OF GELNOR" scrolls are the first three documents, one slot each except part 3', () => {
    const data = new Uint8Array(readFileSync(SCROLLS_PATH));
    const docs = readScrollDocuments(data);
    expect(docs[0].title).toBe('THE HISTORY OF GELNOR');
    expect(docs[0].startLine).toBe(0);
    expect(docs[0].slotCount).toBe(1);

    expect(docs[1].title).toBe('THE HISTORY OF GELNOR');
    expect(docs[1].startLine).toBe(20);
    expect(docs[1].slotCount).toBe(1);

    // Part 3 continues into an in-fiction "GELNOR TIMES" newspaper article
    // and is the one scroll that overflows into a second 800-byte slot.
    expect(docs[2].startLine).toBe(40);
    expect(docs[2].lineCount).toBe(37);
    expect(docs[2].slotCount).toBe(2);
  });

  it('the last document ("REPORT NUMBER ONE FROM FILMON THE SAGE") starts at line 380, the last slot', () => {
    const data = new Uint8Array(readFileSync(SCROLLS_PATH));
    const docs = readScrollDocuments(data);
    const last = docs[docs.length - 1];
    expect(last.startLine).toBe(380);
    expect(last.lines.some((l) => l.includes('FILMON THE SAGE'))).toBe(true);
  });

  it('every document has non-empty lines and a non-empty title', () => {
    const data = new Uint8Array(readFileSync(SCROLLS_PATH));
    const docs = readScrollDocuments(data);
    for (const doc of docs) {
      expect(doc.lines.length).toBe(doc.lineCount);
      expect(doc.lines.length).toBeGreaterThan(0);
      expect(doc.title.length).toBeGreaterThan(0);
    }
  });
});
