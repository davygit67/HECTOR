/** Additive control messages; PMF1/PMS1 payloads retain their existing format. */
export interface SensorBridgeStatus {
  protocol: 'pm-sensor'; version: 1; type: 'status';
  mode: 'live' | 'demo' | 'replay';
  state: 'starting' | 'waiting' | 'streaming' | 'error' | 'ended';
  message: string;
}
export const SENSOR_STATUS_MAX_BYTES = 4096;
export function validateSensorBridgeStatus(input: unknown): asserts input is SensorBridgeStatus {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid sensor bridge status.');
  const value = input as Record<string, unknown>;
  if (value.protocol !== 'pm-sensor' || value.version !== 1 || value.type !== 'status' ||
      typeof value.mode !== 'string' || !['live', 'demo', 'replay'].includes(value.mode) || typeof value.state !== 'string' || !['starting', 'waiting', 'streaming', 'error', 'ended'].includes(value.state) ||
      typeof value.message !== 'string' || value.message.length > 500 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value.message)) {
    throw new Error('Invalid sensor bridge status.');
  }
}
export function parseSensorBridgeStatus(input: string): SensorBridgeStatus {
  if (new TextEncoder().encode(input).length > SENSOR_STATUS_MAX_BYTES) throw new Error('Sensor bridge status is too large.');
  let value: unknown; try { value = JSON.parse(input); } catch { throw new Error('Invalid sensor bridge status JSON.'); }
  validateSensorBridgeStatus(value); return value;
}
