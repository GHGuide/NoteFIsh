/** Which rows of a long list to draw for a scroll position, given each row's
 * height (measured ahead of time, so nothing here touches the DOM). Returns the
 * slice to render plus the space to leave above and below it. */
export function windowOf(heights, scrollTop, viewport, overscan = 400) {
  const n = heights.length;
  let start = 0, top = 0;
  while (start < n && top + heights[start] < scrollTop - overscan) { top += heights[start]; start += 1; }
  let end = start, seen = top;
  while (end < n && seen < scrollTop + viewport + overscan) { seen += heights[end]; end += 1; }
  let bottom = 0;
  for (let i = end; i < n; i += 1) bottom += heights[i];
  return { start, end, top, bottom };
}
