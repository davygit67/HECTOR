export type CloudRelayAction = 'state' | 'receive' | 'pause' | 'release';
export interface CloudRelayState {
  configured: boolean;
  ownsTarget: boolean;
  claimedElsewhere: boolean;
  receiving: boolean;
  busy: boolean;
  phase: 'stopped' | 'waiting' | 'connected' | 'delivering' | 'error';
  message: string;
  deviceId?: string;
  lastReceipt?: { jobId: string; status: 'complete' | 'incomplete' | 'failed' | 'cancelled' | 'uncertain'; text: string };
}
