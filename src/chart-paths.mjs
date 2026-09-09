// Quota values are observations, not a continuously interpolated signal.
// A new reset cycle starts a separate segment: never invent usage during the gap.
export function chartPaths(points, xy, { step = false, baseline = 150, smooth = false } = {}) {
  const segments = [], connectors = [];
  for (let i = 0; i < xy.length; i++) {
    const [x, y] = xy[i];
    const previous = points[i - 1];
    const reset = previous?.resets;
    const crossesReset = step && previous && (
      (reset != null && reset * 1000 > previous.time && reset * 1000 <= points[i].time) ||
      (reset != null && points[i].resets != null && Math.abs(reset - points[i].resets) > 1)
    );
    const gap = smooth && points[i].gapBefore;
    if (smooth && crossesReset && !gap) connectors.push(`M${xy[i-1][0]},${xy[i-1][1]} L${x},${y}`);
    if (!i || crossesReset || gap) segments.push({ line: `M${x},${y}`, first: x, last: x });
    else {
      const segment = segments.at(-1);
      const [px, py] = xy[i-1];
      const dx = (x-px)/3;
      segment.line += smooth ? ` C${px+dx},${py} ${x-dx},${y} ${x},${y}` : step ? ` H${x} V${y}` : ` L${x},${y}`;
      segment.last = x;
    }
  }
  return {
    line: segments.map(s => s.line).join(' '),
    ...(smooth ? { connectors } : {}),
    area: segments.map(s => `${s.line} L${s.last},${baseline} L${s.first},${baseline} Z`).join(' '),
  };
}
