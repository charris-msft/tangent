import { describe, it, expect } from 'vitest';
import { computeTileLayout, type DisplayBounds } from '../tiling';

const display1: DisplayBounds = { id: 1, x: 0, y: 0, width: 1920, height: 1080, isPrimary: true };
const display2: DisplayBounds = { id: 2, x: 1920, y: 0, width: 1920, height: 1080 };

describe('computeTileLayout', () => {
  it.each([
    { sessions: [] as string[], displays: [display1], label: 'no sessions' },
    { sessions: ['a'], displays: [] as DisplayBounds[], label: 'no displays' },
    { sessions: [] as string[], displays: [] as DisplayBounds[], label: 'both empty' },
  ])('returns empty array when $label', ({ sessions, displays }) => {
    expect(computeTileLayout(sessions, displays)).toEqual([]);
  });

  it('1 session on 1 display fills the display minus outer padding', () => {
    const result = computeTileLayout(['s1'], [display1]);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      sessionId: 's1',
      displayId: 1,
      x: 8,
      y: 8,
      width: 1920 - 16,
      height: 1080 - 16,
    });
  });

  it('4 sessions on 1 display produces 2x2 grid', () => {
    const result = computeTileLayout(['a', 'b', 'c', 'd'], [display1]);
    expect(result).toHaveLength(4);
    // cols=2, rows=2
    const cellW = Math.floor((1920 - 16 - 8) / 2);
    const cellH = Math.floor((1080 - 16 - 8) / 2);
    expect(result[0].x).toBe(8);
    expect(result[0].y).toBe(8);
    expect(result[1].x).toBe(Math.floor(8 + cellW + 8));
    expect(result[1].y).toBe(8);
    expect(result[2].x).toBe(8);
    expect(result[2].y).toBe(Math.floor(8 + cellH + 8));
    expect(result[3].x).toBe(Math.floor(8 + cellW + 8));
    expect(result[3].y).toBe(Math.floor(8 + cellH + 8));
    for (const p of result) {
      expect(p.width).toBe(cellW);
      expect(p.height).toBe(cellH);
    }
  });

  it('3 sessions on 1 display produces 2 cols x 2 rows with only 3 returned', () => {
    const result = computeTileLayout(['a', 'b', 'c'], [display1]);
    expect(result).toHaveLength(3);
    const cellW = Math.floor((1920 - 16 - 8) / 2);
    const cellH = Math.floor((1080 - 16 - 8) / 2);
    expect(result[0]).toMatchObject({ sessionId: 'a', x: 8, y: 8, width: cellW, height: cellH });
    expect(result[1].x).toBe(Math.floor(8 + cellW + 8));
    expect(result[1].y).toBe(8);
    expect(result[2].x).toBe(8);
    expect(result[2].y).toBe(Math.floor(8 + cellH + 8));
  });

  it('4 sessions across 2 displays splits 2 + 2', () => {
    const result = computeTileLayout(['a', 'b', 'c', 'd'], [display1, display2]);
    expect(result).toHaveLength(4);
    expect(result.filter((p) => p.displayId === 1)).toHaveLength(2);
    expect(result.filter((p) => p.displayId === 2)).toHaveLength(2);
    expect(result[0].sessionId).toBe('a');
    expect(result[1].sessionId).toBe('b');
    expect(result[2].sessionId).toBe('c');
    expect(result[3].sessionId).toBe('d');
  });

  it('5 sessions across 2 displays splits 3 + 2', () => {
    const result = computeTileLayout(['a', 'b', 'c', 'd', 'e'], [display1, display2]);
    expect(result).toHaveLength(5);
    expect(result.filter((p) => p.displayId === 1)).toHaveLength(3);
    expect(result.filter((p) => p.displayId === 2)).toHaveLength(2);
  });

  it.each([
    { n: 1 },
    { n: 2 },
    { n: 3 },
    { n: 4 },
    { n: 7 },
    { n: 9 },
    { n: 16 },
  ])('all $n positions stay within display bounds (single display)', ({ n }) => {
    const sessions = Array.from({ length: n }, (_, i) => `s${i}`);
    const result = computeTileLayout(sessions, [display1]);
    for (const p of result) {
      expect(p.x).toBeGreaterThanOrEqual(display1.x);
      expect(p.y).toBeGreaterThanOrEqual(display1.y);
      expect(p.x + p.width).toBeLessThanOrEqual(display1.x + display1.width);
      expect(p.y + p.height).toBeLessThanOrEqual(display1.y + display1.height);
    }
  });

  it('all positions stay within their respective display bounds (multi-display)', () => {
    const sessions = Array.from({ length: 11 }, (_, i) => `s${i}`);
    const displays = [display1, display2];
    const result = computeTileLayout(sessions, displays);
    for (const p of result) {
      const d = displays.find((x) => x.id === p.displayId)!;
      expect(p.x).toBeGreaterThanOrEqual(d.x);
      expect(p.y).toBeGreaterThanOrEqual(d.y);
      expect(p.x + p.width).toBeLessThanOrEqual(d.x + d.width);
      expect(p.y + p.height).toBeLessThanOrEqual(d.y + d.height);
    }
  });

  it('respects custom padding and outerPadding', () => {
    const result = computeTileLayout(['a'], [display1], { padding: 20, outerPadding: 50 });
    expect(result[0]).toEqual({
      sessionId: 'a',
      displayId: 1,
      x: 50,
      y: 50,
      width: 1920 - 100,
      height: 1080 - 100,
    });
  });

  it.each([
    { n: 2 },
    { n: 3 },
    { n: 4 },
    { n: 5 },
    { n: 6 },
    { n: 7 },
    { n: 8 },
  ])('windows do not overlap for $n windows (single display)', ({ n }) => {
    const sessions = Array.from({ length: n }, (_, i) => `s${i}`);
    const result = computeTileLayout(sessions, [display1]);
    
    // Check all pairs for overlap
    for (let i = 0; i < result.length; i++) {
      for (let j = i + 1; j < result.length; j++) {
        const a = result[i];
        const b = result[j];
        const overlapX = a.x < b.x + b.width && b.x < a.x + a.width;
        const overlapY = a.y < b.y + b.height && b.y < a.y + a.height;
        const overlaps = overlapX && overlapY;
        expect(overlaps).toBe(false);
      }
    }
  });
});
