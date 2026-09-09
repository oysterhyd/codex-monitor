// Quota values are observations, not a continuously interpolated signal.
// A new reset cycle starts a separate segment: never invent usage during the gap.
export function chartPaths(points, xy, { step = false, baseline = 150 } = {}) {
  const segments = [];
  for (let i = 0; i < xy.length; i++) {
    const [x, y] = xy[i];
    const previous = points[i - 1];
    const reset = previous?.resets;
    const crossesReset = step && previous && (
      (reset != null && reset * 1000 > previous.time && reset * 1000 <= points[i].time) ||
      (reset != null && points[i].resets != null && reset !== points[i].resets)
    );
    if (!i || crossesReset) segments.push({ line: `M${x},${y}`, first: x, last: x });
    else {
      const segment = segments.at(-1);
      segment.line += step ? ` H${x} V${y}` : ` L${x},${y}`;
      segment.last = x;
    }
  }
  return {
    line: segments.map(s => s.line).join(' '),
    area: segments.map(s => `${s.line} L${s.last},${baseline} L${s.first},${baseline} Z`).join(' '),
  };
}
