import { contextBridge, ipcRenderer } from 'electron';
import type { Bridge } from '../src/core/bridge';
const bridge: Bridge = {
  snapshot: () => ipcRenderer.invoke('hector:snapshot'),
  request: request => ipcRenderer.invoke('hector:request', request),
  subscribe: callback => { const handler = (_: unknown, value: Parameters<typeof callback>[0]) => callback(value); ipcRenderer.on('hector:state', handler); return () => ipcRenderer.removeListener('hector:state', handler); }
};
contextBridge.exposeInMainWorld('hector', bridge);
