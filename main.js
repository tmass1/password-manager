const { app, BrowserWindow, ipcMain, dialog } = require('electron');
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

    if (site && password) {
      passwords.push({ site, username, password });
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

    let csv = 'url,username,password\n';
    for (const pwd of passwords) {
      csv += `${escapeCSV(pwd.site)},${escapeCSV(pwd.username)},${escapeCSV(pwd.password)}\n`;
    }

    fs.writeFileSync(result.filePath, csv, 'utf-8');
    return { success: true, count: passwords.length };
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
