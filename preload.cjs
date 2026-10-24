const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('harbor', Object.freeze({
  connect: options => ipcRenderer.invoke('irc:connect', options),
  connectionState: () => ipcRenderer.invoke('irc:connectionState'),
  sysinfo: () => ipcRenderer.invoke('app:sysinfo'),
  uploadImage: options => ipcRenderer.invoke('app:uploadImage', options),
  rememberAuthPassword: options => ipcRenderer.invoke('irc:rememberAuthPassword', options),
  disconnect: () => ipcRenderer.invoke('irc:disconnect'),
  quit: reason => ipcRenderer.invoke('irc:quit', reason),
  join: channel => ipcRenderer.invoke('irc:join', channel),
  part: (channel, reason) => ipcRenderer.invoke('irc:part', channel, reason),
  changeNick: nick => ipcRenderer.invoke('irc:nick', nick),
  message: (target, text, action) => ipcRenderer.invoke('irc:message', target, text, action),
  notice: (target, text) => ipcRenderer.invoke('irc:notice', target, text),
  ctcp: (target, command) => ipcRenderer.invoke('irc:ctcp', target, command),
  rawCommand: command => ipcRenderer.invoke('irc:raw', command),
  openExternal: url => ipcRenderer.invoke('app:openExternal', url),
  onEvent: callback => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('irc:event', listener);
    return () => ipcRenderer.removeListener('irc:event', listener);
  }
}));