/// <reference lib="webworker" />
// Ambient analysis worker: one per renderer, so studio preview and output never share or block each other's light.
import { AmbientProcessor, type AmbientRequest } from './processor';
const processor = new AmbientProcessor(), scope = self as unknown as DedicatedWorkerGlobalScope;
scope.onmessage = (event: MessageEvent<AmbientRequest>) => {
  const result = processor.handle(event.data);
  if (result) scope.postMessage(result, result.field ? [result.field.data.buffer] : []);
};
