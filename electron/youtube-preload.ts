// The YouTube player page's only bridge: report player status to main, receive playback commands. Nothing else.
import { contextBridge, ipcRenderer } from 'electron';
contextBridge.exposeInMainWorld('hectorPlayer', {
  report: (status: unknown) => ipcRenderer.send('hector:player-report', status),
  onCommand: (callback: (command: unknown) => void) => { ipcRenderer.on('hector:player-command', (_event, command) => callback(command)); }
});
