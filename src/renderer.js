const { createElement: h } = React;
const { createRoot } = ReactDOM;

function generatePassword(options) {
  const { length, uppercase, lowercase, numbers, symbols } = options;
  let chars = '';
  if (uppercase) chars += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  if (lowercase) chars += 'abcdefghijklmnopqrstuvwxyz';
  if (numbers) chars += '0123456789';
  if (symbols) chars += '!@#$%^&*()_+-=[]{}|;:,.<>?';
  if (!chars) chars = 'abcdefghijklmnopqrstuvwxyz';
  let password = '';
  const array = new Uint32Array(length);
  crypto.getRandomValues(array);
  for (let i = 0; i < length; i++) {
    password += chars[array[i] % chars.length];
  }
  return password;
}

function App() {
  const [screen, setScreen] = React.useState('loading');
  const [masterPassword, setMasterPassword] = React.useState('');
  const [confirmPassword, setConfirmPassword] = React.useState('');
  const [passwords, setPasswords] = React.useState([]);
  const [showForm, setShowForm] = React.useState(false);
  const [formData, setFormData] = React.useState({ site: '', username: '', password: '' });
  const [error, setError] = React.useState('');
  const [showPasswords, setShowPasswords] = React.useState({});
  const [showGenerator, setShowGenerator] = React.useState(false);
  const [genOptions, setGenOptions] = React.useState({
    length: 16,
    uppercase: true,
    lowercase: true,
    numbers: true,
    symbols: true
  });
  const [generatedPassword, setGeneratedPassword] = React.useState('');
  const [searchQuery, setSearchQuery] = React.useState('');
  const [importStatus, setImportStatus] = React.useState('');
  const [touchIdAvailable, setTouchIdAvailable] = React.useState(false);
  const [touchIdEnabled, setTouchIdEnabled] = React.useState(false);

  React.useEffect(() => {
    checkVault();
    checkTouchId();
  }, []);

  const checkVault = async () => {
    const exists = await window.electronAPI.checkVaultExists();
    setScreen(exists ? 'unlock' : 'setup');
  };

  const checkTouchId = async () => {
    const available = await window.electronAPI.checkTouchIdAvailable();
    setTouchIdAvailable(available);
    if (available) {
      const enabled = await window.electronAPI.checkTouchIdEnabled();
      setTouchIdEnabled(enabled);
    }
  };

  const handleSetup = async (e) => {
    e.preventDefault();
    setError('');
    if (masterPassword.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    if (masterPassword !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    await window.electronAPI.createVault(masterPassword);
    setScreen('vault');
  };

  const handleUnlock = async (e) => {
    e.preventDefault();
    setError('');
    const success = await window.electronAPI.unlockVault(masterPassword);
    if (success) {
      const saved = await window.electronAPI.getPasswords(masterPassword);
      setPasswords(saved);
      setScreen('vault');
    } else {
      setError('Incorrect master password');
    }
  };

  const handleAddPassword = async (e) => {
    e.preventDefault();
    if (formData.site && formData.username && formData.password) {
      const id = await window.electronAPI.savePassword(masterPassword, formData);
      if (id) {
        setPasswords([...passwords, { ...formData, id }]);
        setFormData({ site: '', username: '', password: '' });
        setShowForm(false);
      }
    }
  };

  const handleDelete = async (id) => {
    const success = await window.electronAPI.deletePassword(masterPassword, id);
    if (success) {
      setPasswords(passwords.filter(p => p.id !== id));
    }
  };

  const toggleShowPassword = (id) => {
    setShowPasswords(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const handleLock = () => {
    setMasterPassword('');
    setPasswords([]);
    setScreen('unlock');
  };

  const handleGenerate = () => {
    const pwd = generatePassword(genOptions);
    setGeneratedPassword(pwd);
  };

  const useGeneratedPassword = () => {
    setFormData({ ...formData, password: generatedPassword });
    setShowGenerator(false);
    setGeneratedPassword('');
  };

  const filteredPasswords = passwords.filter(p => {
    const query = searchQuery.toLowerCase();
    return p.site.toLowerCase().includes(query) || p.username.toLowerCase().includes(query);
  });

  const handleImport = async () => {
    setImportStatus('Importing...');
    const result = await window.electronAPI.importPasswords(masterPassword);
    if (result.canceled) {
      setImportStatus('');
    } else if (result.success) {
      setPasswords([...passwords, ...result.passwords]);
      setImportStatus(`Imported ${result.count} passwords`);
      setTimeout(() => setImportStatus(''), 3000);
    } else {
      setImportStatus(result.error || 'Import failed');
      setTimeout(() => setImportStatus(''), 3000);
    }
  };

  const handleExport = async () => {
    setImportStatus('Exporting...');
    const result = await window.electronAPI.exportPasswords(masterPassword);
    if (result.canceled) {
      setImportStatus('');
    } else if (result.success) {
      setImportStatus(`Exported ${result.count} passwords`);
      setTimeout(() => setImportStatus(''), 3000);
    } else {
      setImportStatus(result.error || 'Export failed');
      setTimeout(() => setImportStatus(''), 3000);
    }
  };

  const handleTouchIdUnlock = async () => {
    setError('');
    const result = await window.electronAPI.unlockWithTouchId();
    if (result.success) {
      setMasterPassword(result.masterPassword);
      const saved = await window.electronAPI.getPasswords(result.masterPassword);
      setPasswords(saved);
      setScreen('vault');
    } else {
      setError(result.error || 'Touch ID failed');
    }
  };

  const handleEnableTouchId = async () => {
    const result = await window.electronAPI.enableTouchId(masterPassword);
    if (result.success) {
      setTouchIdEnabled(true);
      setImportStatus('Touch ID enabled');
      setTimeout(() => setImportStatus(''), 3000);
    } else {
      setImportStatus(result.error || 'Failed to enable Touch ID');
      setTimeout(() => setImportStatus(''), 3000);
    }
  };

  const handleDisableTouchId = async () => {
    const result = await window.electronAPI.disableTouchId();
    if (result.success) {
      setTouchIdEnabled(false);
      setImportStatus('Touch ID disabled');
      setTimeout(() => setImportStatus(''), 3000);
    }
  };

  if (screen === 'loading') {
    return h('div', { className: 'container center' },
      h('p', null, 'Loading...')
    );
  }

  if (screen === 'setup') {
    return h('div', { className: 'container center' },
      h('div', { className: 'auth-box' },
        h('h1', null, 'Create Master Password'),
        h('p', { className: 'subtitle' }, 'This password will encrypt all your data'),
        h('form', { onSubmit: handleSetup },
          h('input', {
            type: 'password',
            placeholder: 'Master password (min 8 chars)',
            value: masterPassword,
            onChange: (e) => setMasterPassword(e.target.value)
          }),
          h('input', {
            type: 'password',
            placeholder: 'Confirm master password',
            value: confirmPassword,
            onChange: (e) => setConfirmPassword(e.target.value)
          }),
          error && h('p', { className: 'error' }, error),
          h('button', { type: 'submit', className: 'btn-primary' }, 'Create Vault')
        )
      )
    );
  }

  if (screen === 'unlock') {
    return h('div', { className: 'container center' },
      h('div', { className: 'auth-box' },
        h('h1', null, 'Unlock Vault'),
        touchIdEnabled && h('button', {
          type: 'button',
          className: 'btn-touchid',
          onClick: handleTouchIdUnlock
        }, 'Unlock with Touch ID'),
        touchIdEnabled && h('div', { className: 'divider' }, h('span', null, 'or')),
        h('form', { onSubmit: handleUnlock },
          h('input', {
            type: 'password',
            placeholder: 'Master password',
            value: masterPassword,
            onChange: (e) => setMasterPassword(e.target.value)
          }),
          error && h('p', { className: 'error' }, error),
          h('button', { type: 'submit', className: 'btn-primary' }, 'Unlock')
        )
      )
    );
  }

  return h('div', { className: 'container' },
    h('header', null,
      h('h1', null, 'Password Manager'),
      h('div', { className: 'header-buttons' },
        h('button', { className: 'btn-primary', onClick: () => setShowForm(!showForm) },
          showForm ? 'Cancel' : 'Add Password'
        ),
        h('button', { className: 'btn-secondary', onClick: handleImport }, 'Import'),
        h('button', { className: 'btn-secondary', onClick: handleExport }, 'Export'),
        touchIdAvailable && h('button', {
          className: touchIdEnabled ? 'btn-touchid-enabled' : 'btn-secondary',
          onClick: touchIdEnabled ? handleDisableTouchId : handleEnableTouchId
        }, touchIdEnabled ? 'Touch ID On' : 'Touch ID'),
        h('button', { className: 'btn-secondary', onClick: handleLock }, 'Lock')
      )
    ),
    importStatus && h('div', { className: 'import-status' }, importStatus),
    showForm && h('form', { className: 'password-form', onSubmit: handleAddPassword },
      h('input', {
        type: 'text',
        placeholder: 'Website',
        value: formData.site,
        onChange: (e) => setFormData({ ...formData, site: e.target.value })
      }),
      h('input', {
        type: 'text',
        placeholder: 'Username',
        value: formData.username,
        onChange: (e) => setFormData({ ...formData, username: e.target.value })
      }),
      h('div', { className: 'password-input-row' },
        h('input', {
          type: 'text',
          placeholder: 'Password',
          value: formData.password,
          onChange: (e) => setFormData({ ...formData, password: e.target.value })
        }),
        h('button', {
          type: 'button',
          className: 'btn-secondary',
          onClick: () => setShowGenerator(!showGenerator)
        }, 'Generate')
      ),
      showGenerator && h('div', { className: 'generator-box' },
        h('div', { className: 'generator-options' },
          h('div', { className: 'option-row' },
            h('label', null, 'Length: ', genOptions.length),
            h('input', {
              type: 'range',
              min: 8,
              max: 32,
              value: genOptions.length,
              onChange: (e) => setGenOptions({ ...genOptions, length: parseInt(e.target.value) })
            })
          ),
          h('div', { className: 'option-checkboxes' },
            h('label', null,
              h('input', {
                type: 'checkbox',
                checked: genOptions.uppercase,
                onChange: (e) => setGenOptions({ ...genOptions, uppercase: e.target.checked })
              }), ' ABC'
            ),
            h('label', null,
              h('input', {
                type: 'checkbox',
                checked: genOptions.lowercase,
                onChange: (e) => setGenOptions({ ...genOptions, lowercase: e.target.checked })
              }), ' abc'
            ),
            h('label', null,
              h('input', {
                type: 'checkbox',
                checked: genOptions.numbers,
                onChange: (e) => setGenOptions({ ...genOptions, numbers: e.target.checked })
              }), ' 123'
            ),
            h('label', null,
              h('input', {
                type: 'checkbox',
                checked: genOptions.symbols,
                onChange: (e) => setGenOptions({ ...genOptions, symbols: e.target.checked })
              }), ' !@#'
            )
          )
        ),
        h('div', { className: 'generator-result' },
          h('button', { type: 'button', className: 'btn-primary', onClick: handleGenerate }, 'Generate'),
          generatedPassword && h('div', { className: 'generated-password' },
            h('code', null, generatedPassword),
            h('div', { className: 'generated-actions' },
              h('button', {
                type: 'button',
                className: 'btn-icon',
                onClick: () => navigator.clipboard.writeText(generatedPassword)
              }, 'Copy'),
              h('button', {
                type: 'button',
                className: 'btn-icon',
                onClick: useGeneratedPassword
              }, 'Use')
            )
          )
        )
      ),
      h('button', { type: 'submit', className: 'btn-primary' }, 'Save')
    ),
    h('div', { className: 'search-box' },
      h('input', {
        type: 'text',
        placeholder: 'Search passwords...',
        value: searchQuery,
        onChange: (e) => setSearchQuery(e.target.value)
      })
    ),
    h('div', { className: 'password-list' },
      passwords.length === 0
        ? h('p', { className: 'empty-message' }, 'No passwords saved yet.')
        : filteredPasswords.length === 0
        ? h('p', { className: 'empty-message' }, 'No matching passwords.')
        : filteredPasswords.map(p =>
            h('div', { key: p.id, className: 'password-item' },
              h('div', { className: 'password-info' },
                h('strong', null, p.site),
                h('span', null, p.username),
                h('span', { className: 'password-value' },
                  showPasswords[p.id] ? p.password : '••••••••'
                )
              ),
              h('div', { className: 'password-actions' },
                h('button', {
                  className: 'btn-icon',
                  onClick: () => toggleShowPassword(p.id),
                  title: showPasswords[p.id] ? 'Hide' : 'Show'
                }, showPasswords[p.id] ? 'Hide' : 'Show'),
                h('button', {
                  className: 'btn-icon',
                  onClick: () => navigator.clipboard.writeText(p.password),
                  title: 'Copy'
                }, 'Copy'),
                h('button', { className: 'btn-delete', onClick: () => handleDelete(p.id) }, 'Delete')
              )
            )
          )
    )
  );
}

const root = createRoot(document.getElementById('root'));
root.render(h(App));
