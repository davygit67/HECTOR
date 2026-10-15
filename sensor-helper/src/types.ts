import type { SensorFrame } from '../../src/shared/sensor.js';
import type { SensorBridgeStatus } from '../../src/shared/sensorBridge.js';
export type Mode = SensorBridgeStatus['mode'];
export interface Sink {
  status(state: SensorBridgeStatus['state'], message: string): void;
  frame(frame: SensorFrame): void;
}
export interface Source { stop(): void }
export type SourceFactory = (sink: Sink) => Source;
