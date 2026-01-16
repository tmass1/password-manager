const { app, BrowserWindow, ipcMain, dialog, systemPreferences, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
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

// Key cache for performance with many items
const keyCache = new Map();

function deriveKey(password, salt) {
  const cacheKey = password + ':' + salt.toString('hex');
  if (keyCache.has(cacheKey)) {
    return keyCache.get(cacheKey);
  }
  const key = crypto.pbkdf2Sync(password, salt, ITERATIONS, KEY_LENGTH, 'sha512');
  keyCache.set(cacheKey, key);
  // Limit cache size
  if (keyCache.size > 100) {
    const firstKey = keyCache.keys().next().value;
    keyCache.delete(firstKey);
  }
  return key;
}

// Async key derivation for bulk operations
function deriveKeyAsync(password, salt) {
  return new Promise((resolve, reject) => {
    const cacheKey = password + ':' + salt.toString('hex');
    if (keyCache.has(cacheKey)) {
      return resolve(keyCache.get(cacheKey));
    }
    crypto.pbkdf2(password, salt, ITERATIONS, KEY_LENGTH, 'sha512', (err, key) => {
      if (err) return reject(err);
      keyCache.set(cacheKey, key);
      if (keyCache.size > 5000) {
        const firstKey = keyCache.keys().next().value;
        keyCache.delete(firstKey);
      }
      resolve(key);
    });
  });
}

// Async decrypt for bulk operations
async function decryptAsync(encryptedData, masterPassword) {
  const { encrypted, iv, salt, tag } = encryptedData;
  const key = await deriveKeyAsync(masterPassword, Buffer.from(salt, 'hex'));

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
    width: 1000,
    height: 700,
    minWidth: 800,
    minHeight: 500,
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

ipcMain.handle('get-passwords', async (event, masterPassword) => {
  try {
    const encryptedVault = store.get('vault');
    if (!encryptedVault || encryptedVault.length === 0) {
      return { items: [], total: 0 };
    }

    // Return immediately with total count, items will stream via separate channel
    const total = encryptedVault.length;

    // Start async decryption in background
    (async () => {
      const batchSize = 10;
      for (let i = 0; i < encryptedVault.length; i += batchSize) {
        const batch = encryptedVault.slice(i, i + batchSize);

        const batchResults = await Promise.all(
          batch.map(async (item) => {
            try {
              const decrypted = await decryptAsync(item.data, masterPassword);
              return { id: item.id, ...JSON.parse(decrypted) };
            } catch (e) {
              return null;
            }
          })
        );

        const validResults = batchResults.filter(Boolean);
        if (validResults.length > 0) {
          // Send batch to renderer
          event.sender.send('passwords-batch', validResults);
        }

        // Small yield
        await new Promise(resolve => setTimeout(resolve, 1));
      }

      // Signal completion
      event.sender.send('passwords-complete');
    })();

    return { items: [], total };
  } catch {
    return { items: [], total: 0 };
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

ipcMain.handle('update-password', (event, { masterPassword, id, password }) => {
  try {
    const vault = store.get('vault') || [];
    const index = vault.findIndex(item => item.id === id);
    if (index === -1) return false;

    vault[index] = {
      id,
      data: encrypt(JSON.stringify(password), masterPassword)
    };
    store.set('vault', vault);
    return true;
  } catch {
    return false;
  }
});

function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter(line => line.trim());
  if (lines.length < 2) return [];

  const parseRow = (row) => {
    const result = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < row.length; i++) {
      const char = row[i];
      if (char === '"') {
        if (inQuotes && row[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        result.push(current);
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current);
    return result;
  };

  const headers = parseRow(lines[0]).map(h => h.toLowerCase().trim());
  const passwords = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseRow(lines[i]);
    const entry = {};
    headers.forEach((header, idx) => {
      entry[header] = values[idx] || '';
    });

    // Map common CSV column names to our format
    const site = entry.url || entry.website || entry.name || entry.title || entry.hostname || '';
    const username = entry.username || entry.login || entry.email || entry.user || '';
    const password = entry.password || entry.pass || '';

    // Parse tags - support semicolon, comma, or slash as separators within the cell
    const tagsRaw = entry.tags || entry.tag || entry.labels || entry.label || '';
    const tags = tagsRaw
      ? tagsRaw.split(/[;,\/]/).map(t => t.trim().toLowerCase()).filter(t => t)
      : [];

    if (site && password) {
      passwords.push({ site, username, password, tags });
    }
  }

  return passwords;
}

ipcMain.handle('import-passwords', async (event, masterPassword) => {
  try {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'CSV Files', extensions: ['csv'] }]
    });

    if (result.canceled || result.filePaths.length === 0) {
      return { success: false, count: 0, canceled: true };
    }

    const filePath = result.filePaths[0];
    const content = fs.readFileSync(filePath, 'utf-8');
    const passwords = parseCSV(content);

    if (passwords.length === 0) {
      return { success: false, count: 0, error: 'No valid passwords found in file' };
    }

    const vault = store.get('vault') || [];
    const imported = [];

    for (const pwd of passwords) {
      const entry = {
        id: Date.now() + Math.random(),
        data: encrypt(JSON.stringify(pwd), masterPassword)
      };
      vault.push(entry);
      imported.push({ ...pwd, id: entry.id });
    }

    store.set('vault', vault);
    return { success: true, count: imported.length, passwords: imported };
  } catch (err) {
    return { success: false, count: 0, error: err.message };
  }
});

ipcMain.handle('export-passwords', async (event, masterPassword) => {
  try {
    const encryptedVault = store.get('vault');
    if (!encryptedVault || encryptedVault.length === 0) {
      return { success: false, error: 'No passwords to export' };
    }

    const passwords = encryptedVault.map(item => {
      const decrypted = decrypt(item.data, masterPassword);
      return JSON.parse(decrypted);
    });

    const result = await dialog.showSaveDialog({
      defaultPath: 'passwords.csv',
      filters: [{ name: 'CSV Files', extensions: ['csv'] }]
    });

    if (result.canceled || !result.filePath) {
      return { success: false, canceled: true };
    }

    const escapeCSV = (str) => {
      if (!str) return '';
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return '"' + str.replace(/"/g, '""') + '"';
      }
      return str;
    };

    let csv = 'url,username,password,tags\n';
    for (const pwd of passwords) {
      const tagsStr = Array.isArray(pwd.tags) ? pwd.tags.join(';') : '';
      csv += `${escapeCSV(pwd.site)},${escapeCSV(pwd.username)},${escapeCSV(pwd.password)},${escapeCSV(tagsStr)}\n`;
    }

    fs.writeFileSync(result.filePath, csv, 'utf-8');
    return { success: true, count: passwords.length };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('clear-vault', (event, masterPassword) => {
  try {
    // Verify master password first
    const checkData = store.get('vaultCheck');
    const result = decrypt(checkData, masterPassword);
    if (result !== 'vault-check') {
      return { success: false, error: 'Invalid master password' };
    }

    store.set('vault', []);
    return { success: true };
  } catch {
    return { success: false, error: 'Failed to clear vault' };
  }
});

// Touch ID handlers
ipcMain.handle('check-touch-id-available', () => {
  if (process.platform !== 'darwin') return false;
  return systemPreferences.canPromptTouchID();
});

ipcMain.handle('check-touch-id-enabled', () => {
  return store.has('touchIdEnabled') && store.get('touchIdEnabled') === true;
});

ipcMain.handle('enable-touch-id', async (event, masterPassword) => {
  try {
    if (!systemPreferences.canPromptTouchID()) {
      return { success: false, error: 'Touch ID not available' };
    }

    await systemPreferences.promptTouchID('enable Touch ID for Password Manager');

    // Encrypt and store the master password using safeStorage
    const encrypted = safeStorage.encryptString(masterPassword);
    store.set('touchIdPassword', encrypted.toString('base64'));
    store.set('touchIdEnabled', true);

    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('disable-touch-id', () => {
  store.delete('touchIdPassword');
  store.set('touchIdEnabled', false);
  return { success: true };
});

ipcMain.handle('unlock-with-touch-id', async () => {
  try {
    if (!store.get('touchIdEnabled')) {
      return { success: false, error: 'Touch ID not enabled' };
    }

    await systemPreferences.promptTouchID('unlock Password Manager');

    // Retrieve and decrypt the master password
    const encryptedBase64 = store.get('touchIdPassword');
    const encrypted = Buffer.from(encryptedBase64, 'base64');
    const masterPassword = safeStorage.decryptString(encrypted);

    // Verify the password works
    const checkData = store.get('vaultCheck');
    const result = decrypt(checkData, masterPassword);
    if (result !== 'vault-check') {
      return { success: false, error: 'Stored password invalid' };
    }

    return { success: true, masterPassword };
  } catch (err) {
    return { success: false, error: err.message };
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
