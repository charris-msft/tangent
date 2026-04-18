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

export interface TileLayoutOptions {
  padding?: number;
  outerPadding?: number;
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
    const cols = Math.ceil(Math.sqrt(count));
    const rows = Math.ceil(count / cols);

    const availWidth = display.width - 2 * outerPadding;
    const availHeight = display.height - 2 * outerPadding;

    const cellWidth = (availWidth - (cols - 1) * padding) / cols;
    const cellHeight = (availHeight - (rows - 1) * padding) / rows;

    for (let i = 0; i < count; i++) {
      const row = Math.floor(i / cols);
      const col = i % cols;
      const x = display.x + outerPadding + col * (cellWidth + padding);
      const y = display.y + outerPadding + row * (cellHeight + padding);

      // Floor the final position and size
      const floorX = Math.floor(x);
      const floorY = Math.floor(y);
      const floorWidth = Math.floor(cellWidth);
      const floorHeight = Math.floor(cellHeight);

      // Ensure the window stays within display bounds (handle rounding edge cases)
      const clampedWidth = Math.min(floorWidth, display.x + display.width - floorX);
      const clampedHeight = Math.min(floorHeight, display.y + display.height - floorY);

      positions.push({
        sessionId: sessionIds[cursor++],
        displayId: display.id,
        x: floorX,
        y: floorY,
        width: clampedWidth,
        height: clampedHeight,
      });
    }
  }

  return positions;
}
