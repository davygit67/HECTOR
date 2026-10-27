/** Safe disconnect policy: hide/black out the existing window; never move projection to the laptop. */
export function displayAvailable(selected: number | null, ids: number[]) { return selected !== null && ids.includes(selected); }
export function outputAction(open: boolean, selected: number | null, ids: number[]) {
  return !open ? 'none' : displayAvailable(selected, ids) ? 'keep' : 'hide';
}
