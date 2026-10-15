const { contextBridge, ipcRenderer } = require('electron');
// This isolated source gets no scene, AI, file or desktop-capture bridge.
contextBridge.exposeInMainWorld('projectionSource', {
  report: state => ipcRenderer.send('media:source-state', state),
  subscribe: listener => {
    const handler = (_event, command) => listener(command);
    ipcRenderer.on('media:source-command', handler);
    return () => ipcRenderer.removeListener('media:source-command', handler);
  },
});
