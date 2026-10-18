const { contextBridge, ipcRenderer, webUtils } = require('electron');
contextBridge.exposeInMainWorld('projectionPrograms', { read: () => ipcRenderer.invoke('programs:read'), put: value => ipcRenderer.invoke('programs:put', value) });
contextBridge.exposeInMainWorld('projectionProgramState', { read: () => ipcRenderer.invoke('programs:state:read'), write: value => ipcRenderer.invoke('programs:state:write', value) });
contextBridge.exposeInMainWorld('projectionLibrary', {
  read: () => ipcRenderer.invoke('library:read'),
  write: items => ipcRenderer.invoke('library:write', items),
});

contextBridge.exposeInMainWorld('projectionAssets', {
  store: (file, mimeType) => ipcRenderer.invoke('assets:store', webUtils.getPathForFile(file), mimeType),
  resolve: id => ipcRenderer.invoke('assets:resolve', id),
  remove: id => ipcRenderer.invoke('assets:remove', id),
});

contextBridge.exposeInMainWorld('projection', {
  getSnapshot: () => ipcRenderer.invoke('scene:get'),
  dispatch: command => ipcRenderer.invoke('scene:command', command),
  batch: (commands, expectedRevision) => ipcRenderer.invoke('scene:batch', commands, expectedRevision),
  output: command => ipcRenderer.invoke('output:command', command),
  subscribe: listener => {
    const handler = (_event, snapshot) => listener(snapshot);
    ipcRenderer.on('scene:snapshot', handler);
    return () => ipcRenderer.removeListener('scene:snapshot', handler);
  },
});

contextBridge.exposeInMainWorld('projectionChat', {
  getState: () => ipcRenderer.invoke('chat:get'),
  send: prompt => ipcRenderer.invoke('chat:send', prompt),
  cancel: () => ipcRenderer.invoke('chat:cancel'),
  clear: () => ipcRenderer.invoke('chat:clear'),
  memory: request => ipcRenderer.invoke('chat:memory', request),
  subscribe: listener => {
    const handler = (_event, state) => listener(state);
    ipcRenderer.on('chat:state', handler);
    return () => ipcRenderer.removeListener('chat:state', handler);
  },
});

contextBridge.exposeInMainWorld('projectionStudio', {
  subscribe: listener => {
    const handler = (_event, request) => listener(request);
    ipcRenderer.on('studio:rpc', handler);
    return () => ipcRenderer.removeListener('studio:rpc', handler);
  },
  reply: reply => ipcRenderer.send('studio:reply', reply),
});


contextBridge.exposeInMainWorld('projectionMedia', {
  snapshot: () => ipcRenderer.invoke('media:snapshot'),
  command: command => ipcRenderer.invoke('media:command', command),
  input: input => ipcRenderer.invoke('media:input', input),
  subscribe: listener => {
    const handler = (_event, event) => listener(event);
    ipcRenderer.on('media:event', handler);
    return () => ipcRenderer.removeListener('media:event', handler);
  },
});
