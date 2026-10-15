/** Output windows may align the existing target, but cannot edit content or playback. */
export function isOutputCalibrationCommand(command: unknown): boolean {
  if (!command || typeof command !== 'object') return false;
  const type = (command as { type?: unknown }).type;
  return type === 'calibration.set' || type === 'calibration.reset';
}
