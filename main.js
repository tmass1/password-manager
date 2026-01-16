const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const crypto = require('crypto');
const Store = require('electron-store').default;

const store = new Store();

// Encryption settings
const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;
const IV_LENGTH = 16;
const SALT_LENGTH = 32;
const TAG_LENGTH = 16;
const ITERATIONS = 100000;

function deriveKey(password, salt) {
  return crypto.pbkdf2Sync(password, salt, ITERATIONS, KEY_LENGTH, 'sha512');
}

function encrypt(text, masterPassword) {
  const salt = crypto.randomBytes(SALT_LENGTH);
  const iv = crypto.randomBytes(IV_LENGTH);
  const key = deriveKey(masterPassword, salt);

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag();

  return {
    encrypted,
    iv: iv.toString('hex'),
    salt: salt.toString('hex'),
    tag: tag.toString('hex')
  };
}

function decrypt(encryptedData, masterPassword) {
  const { encrypted, iv, salt, tag } = encryptedData;
  const key = deriveKey(masterPassword, Buffer.from(salt, 'hex'));

  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    key,
    Buffer.from(iv, 'hex')
  );
  decipher.setAuthTag(Buffer.from(tag, 'hex'));

  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));
}

// IPC Handlers
ipcMain.handle('check-vault-exists', () => {
  return store.has('vault');
});

ipcMain.handle('create-vault', (event, masterPassword) => {
  const testData = encrypt('vault-check', masterPassword);
  store.set('vaultCheck', testData);
  store.set('vault', []);
  return true;
});

ipcMain.handle('unlock-vault', (event, masterPassword) => {
  try {
    const checkData = store.get('vaultCheck');
    const result = decrypt(checkData, masterPassword);
    return result === 'vault-check';
  } catch {
    return false;
  }
});

ipcMain.handle('get-passwords', (event, masterPassword) => {
  try {
    const encryptedVault = store.get('vault');
    if (!encryptedVault || encryptedVault.length === 0) {
      return [];
    }
    return encryptedVault.map(item => {
      const decrypted = decrypt(item.data, masterPassword);
      return { id: item.id, ...JSON.parse(decrypted) };
    });
  } catch {
    return [];
  }
});

ipcMain.handle('save-password', (event, { masterPassword, password }) => {
  try {
    const vault = store.get('vault') || [];
    const entry = {
      id: Date.now(),
      data: encrypt(JSON.stringify(password), masterPassword)
    };
    vault.push(entry);
    store.set('vault', vault);
    return entry.id;
  } catch {
    return null;
  }
});

ipcMain.handle('delete-password', (event, { masterPassword, id }) => {
  try {
    const vault = store.get('vault') || [];
    const filtered = vault.filter(item => item.id !== id);
    store.set('vault', filtered);
    return true;
  } catch {
    return false;
  }
});

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
