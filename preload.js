const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  checkVaultExists: () => ipcRenderer.invoke('check-vault-exists'),
  createVault: (masterPassword) => ipcRenderer.invoke('create-vault', masterPassword),
  unlockVault: (masterPassword) => ipcRenderer.invoke('unlock-vault', masterPassword),
  getPasswords: (masterPassword) => ipcRenderer.invoke('get-passwords', masterPassword),
  savePassword: (masterPassword, password) => ipcRenderer.invoke('save-password', { masterPassword, password }),
  updatePassword: (masterPassword, id, password) => ipcRenderer.invoke('update-password', { masterPassword, id, password }),
  deletePassword: (masterPassword, id) => ipcRenderer.invoke('delete-password', { masterPassword, id }),
  importPasswords: (masterPassword) => ipcRenderer.invoke('import-passwords', masterPassword),
  exportPasswords: (masterPassword) => ipcRenderer.invoke('export-passwords', masterPassword),
  clearVault: (masterPassword) => ipcRenderer.invoke('clear-vault', masterPassword),
  checkTouchIdAvailable: () => ipcRenderer.invoke('check-touch-id-available'),
  checkTouchIdEnabled: () => ipcRenderer.invoke('check-touch-id-enabled'),
  enableTouchId: (masterPassword) => ipcRenderer.invoke('enable-touch-id', masterPassword),
  disableTouchId: () => ipcRenderer.invoke('disable-touch-id'),
  unlockWithTouchId: () => ipcRenderer.invoke('unlock-with-touch-id'),
  // Progressive loading listeners
  onPasswordsBatch: (callback) => {
    const listener = (event, batch) => callback(batch);
    ipcRenderer.on('passwords-batch', listener);
    return () => ipcRenderer.removeListener('passwords-batch', listener);
  },
  onPasswordsComplete: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('passwords-complete', listener);
    return () => ipcRenderer.removeListener('passwords-complete', listener);
  },
  // Progressive import listeners
  onImportBatch: (callback) => {
    const listener = (event, batch) => callback(batch);
    ipcRenderer.on('import-batch', listener);
    return () => ipcRenderer.removeListener('import-batch', listener);
  },
  onImportComplete: (callback) => {
    const listener = (event, data) => callback(data);
    ipcRenderer.on('import-complete', listener);
    return () => ipcRenderer.removeListener('import-complete', listener);
  }
});
