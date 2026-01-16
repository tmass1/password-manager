const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  checkVaultExists: () => ipcRenderer.invoke('check-vault-exists'),
  createVault: (masterPassword) => ipcRenderer.invoke('create-vault', masterPassword),
  unlockVault: (masterPassword) => ipcRenderer.invoke('unlock-vault', masterPassword),
  getPasswords: (masterPassword) => ipcRenderer.invoke('get-passwords', masterPassword),
  savePassword: (masterPassword, password) => ipcRenderer.invoke('save-password', { masterPassword, password }),
  deletePassword: (masterPassword, id) => ipcRenderer.invoke('delete-password', { masterPassword, id }),
  importPasswords: (masterPassword) => ipcRenderer.invoke('import-passwords', masterPassword),
  exportPasswords: (masterPassword) => ipcRenderer.invoke('export-passwords', masterPassword)
});
