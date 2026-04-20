export interface DisplayBounds {
  id: number;
  x: number;
  y: number;
  width: number;
  height: number;
  isPrimary?: boolean;
  label?: string;
}

export interface TilePosition {
  sessionId: string;
  displayId: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ExclusionRect {
  displayId: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TileLayoutOptions {
  padding?: number;
  outerPadding?: number;
  /**
   * Rectangles (in screen coordinates) that tile cells must not overlap.
   * Used by Explode so popouts don't land on top of the main Tangent window.
   * A cell is skipped if it overlaps any exclusion rect on the same display.
   */
  exclusions?: ExclusionRect[];
}

function rectsOverlap(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number }
): boolean {
  return (
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  );
}

interface Cell {
  x: number;
  y: number;
  width: number;
  height: number;
}

function generateCells(
  totalCells: number,
  display: DisplayBounds,
  padding: number,
  outerPadding: number
): Cell[] {
  const cols = Math.ceil(Math.sqrt(totalCells));
  const rows = Math.ceil(totalCells / cols);
  const availWidth = display.width - 2 * outerPadding;
  const availHeight = display.height - 2 * outerPadding;
  const cellWidth = (availWidth - (cols - 1) * padding) / cols;
  const cellHeight = (availHeight - (rows - 1) * padding) / rows;

  const cells: Cell[] = [];
  for (let i = 0; i < totalCells; i++) {
    const row = Math.floor(i / cols);
    const col = i % cols;
    const x = display.x + outerPadding + col * (cellWidth + padding);
    const y = display.y + outerPadding + row * (cellHeight + padding);
    const floorX = Math.floor(x);
    const floorY = Math.floor(y);
    const floorWidth = Math.floor(cellWidth);
    const floorHeight = Math.floor(cellHeight);
    const clampedWidth = Math.min(floorWidth, display.x + display.width - floorX);
    const clampedHeight = Math.min(floorHeight, display.y + display.height - floorY);
    cells.push({ x: floorX, y: floorY, width: clampedWidth, height: clampedHeight });
  }
  return cells;
}

function cellsForDisplay(
  count: number,
  display: DisplayBounds,
  exclusions: ExclusionRect[],
  padding: number,
  outerPadding: number
): Cell[] {
  if (count === 0) return [];
  const myExclusions = exclusions.filter((e) => e.displayId === display.id);
  if (myExclusions.length === 0) {
    return generateCells(count, display, padding, outerPadding);
  }

  // Grow the grid until we have enough non-overlapping cells. Capped to
  // keep the grid sane — in practice convergence is fast since each added
  // cell only shrinks existing cells slightly.
  let totalCells = count;
  const maxAttempts = 8;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const cells = generateCells(totalCells, display, padding, outerPadding);
    const usable = cells.filter(
      (c) => !myExclusions.some((ex) => rectsOverlap(c, ex))
    );
    if (usable.length >= count) {
      return usable.slice(0, count);
    }
    // Grow by the deficit plus one to try a coarser grid with larger,
    // more-likely-to-miss-the-exclusion cells next time.
    totalCells = totalCells + (count - usable.length) + 1;
  }
  // Fallback: accept whatever we have (even if < count). Better than
  // throwing — caller will just have fewer repositioned windows.
  const fallback = generateCells(totalCells, display, padding, outerPadding);
  return fallback
    .filter((c) => !myExclusions.some((ex) => rectsOverlap(c, ex)))
    .slice(0, count);
}

export function computeTileLayout(
  sessionIds: string[],
  displays: DisplayBounds[],
  options?: TileLayoutOptions
): TilePosition[] {
  if (sessionIds.length === 0 || displays.length === 0) {
    return [];
  }

  const padding = options?.padding ?? 8;
  const outerPadding = options?.outerPadding ?? 8;
  const exclusions = options?.exclusions ?? [];

  const n = sessionIds.length;
  const m = displays.length;
  const base = Math.floor(n / m);
  const remainder = n - base * m;

  const positions: TilePosition[] = [];
  let cursor = 0;

  for (let d = 0; d < m; d++) {
    const count = base + (d < remainder ? 1 : 0);
    if (count === 0) continue;

    const display = displays[d];
    const cells = cellsForDisplay(count, display, exclusions, padding, outerPadding);

    for (const cell of cells) {
      if (cursor >= sessionIds.length) break;
      positions.push({
        sessionId: sessionIds[cursor++],
        displayId: display.id,
        x: cell.x,
        y: cell.y,
        width: cell.width,
        height: cell.height,
      });
    }
  }

  return positions;
}
