import type { HardwareStatus } from './shared/studio';
let inspect: (() => HardwareStatus) | undefined;
export function registerPhysicalStatus(provider: () => HardwareStatus) { inspect = provider; return () => { if (inspect === provider) inspect = undefined; }; }
export const physicalStatus = () => inspect?.();
