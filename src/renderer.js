const { createElement: h } = React;
const { createRoot } = ReactDOM;

// ========== Icon Resolver Module ==========

// In-memory cache for favicon URLs (persists during session)
const iconCache = new Map();
const pendingRequests = new Map();
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

// Extract registrable domain from URL or site string
function extractDomain(site) {
  if (!site) return null;
  try {
    // Add protocol if missing
    let url = site;
    if (!url.includes('://')) url = 'https://' + url;
    const parsed = new URL(url);
    // Get hostname and remove www prefix
    let domain = parsed.hostname.toLowerCase().replace(/^www\./, '');
    return domain || null;
  } catch {
    // If URL parsing fails, try to extract domain-like string
    const match = site.match(/([a-zA-Z0-9][-a-zA-Z0-9]*\.)+[a-zA-Z]{2,}/);
    return match ? match[0].toLowerCase().replace(/^www\./, '') : null;
  }
}

// Generate deterministic color from string
function hashColor(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  // Generate hue from hash (0-360), keep saturation and lightness fixed for nice colors
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 65%, 45%)`;
}

// Favicon URL builders
const faviconServices = [
  (domain, size) => `https://www.google.com/s2/favicons?domain=${domain}&sz=${size}`,
  (domain) => `https://icon.horse/icon/${domain}`,
  (domain) => `https://icons.duckduckgo.com/ip3/${domain}.ico`
];

// Check if image URL is valid
function checkImage(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(url);
    img.onerror = () => resolve(null);
    img.src = url;
    // Timeout after 3 seconds
    setTimeout(() => resolve(null), 3000);
  });
}

// Resolve favicon for domain with fallback chain
async function resolveFavicon(domain, size = 32) {
  if (!domain) return null;

  const cacheKey = `${domain}:${size}`;

  // Check memory cache
  const cached = iconCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.url;
  }

  // Check if request is already pending (coalesce requests)
  if (pendingRequests.has(cacheKey)) {
    return pendingRequests.get(cacheKey);
  }

  // Create pending request
  const request = (async () => {
    // Try each service in order
    for (const buildUrl of faviconServices) {
      const url = buildUrl(domain, size);
      const result = await checkImage(url);
      if (result) {
        iconCache.set(cacheKey, { url: result, timestamp: Date.now() });
        pendingRequests.delete(cacheKey);
        return result;
      }
    }
    // All services failed
    iconCache.set(cacheKey, { url: null, timestamp: Date.now() });
    pendingRequests.delete(cacheKey);
    return null;
  })();

  pendingRequests.set(cacheKey, request);
  return request;
}

// ItemIcon Component - renders favicon or fallback avatar
function ItemIcon({ site, name, size = 32, className = '' }) {
  const [iconUrl, setIconUrl] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(false);

  const domain = React.useMemo(() => extractDomain(site), [site]);
  const displayName = name || site || '?';
  const letter = (displayName[0] || '?').toUpperCase();
  const bgColor = React.useMemo(() => hashColor(domain || displayName), [domain, displayName]);

  React.useEffect(() => {
    let mounted = true;
    setLoading(true);
    setError(false);

    if (domain) {
      resolveFavicon(domain, size).then(url => {
        if (mounted) {
          setIconUrl(url);
          setLoading(false);
          if (!url) setError(true);
        }
      });
    } else {
      setLoading(false);
      setError(true);
    }

    return () => { mounted = false; };
  }, [domain, size]);

  const style = {
    width: size,
    height: size,
    minWidth: size,
    minHeight: size,
    borderRadius: size > 32 ? 12 : 8,
    overflow: 'hidden',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: size > 32 ? size * 0.4 : size * 0.5,
    fontWeight: 600,
    color: '#fff',
    backgroundColor: bgColor,
    flexShrink: 0
  };

  // Show favicon if loaded successfully
  if (iconUrl && !error) {
    return h('img', {
      src: iconUrl,
      alt: '',
      className: `item-icon ${className}`,
      style: { ...style, backgroundColor: 'transparent' },
      onError: () => setError(true)
    });
  }

  // Show fallback avatar (letter on colored background)
  return h('div', {
    className: `item-icon item-icon-fallback ${className}`,
    style
  }, letter);
}

// ========== TagInput Component ==========
// 1Password-style tag input with chips, autocomplete, and keyboard handling
function TagInput({ tags, onChange, allTags, placeholder = 'Add tag...' }) {
  const [inputValue, setInputValue] = React.useState('');
  const [showSuggestions, setShowSuggestions] = React.useState(false);
  const [selectedSuggestion, setSelectedSuggestion] = React.useState(0);
  const inputRef = React.useRef(null);

  // Filter suggestions based on input
  const suggestions = React.useMemo(() => {
    if (!inputValue.trim()) return [];
    const query = inputValue.toLowerCase().trim();
    return allTags
      .filter(tag => tag.toLowerCase().includes(query) && !tags.includes(tag))
      .slice(0, 5);
  }, [inputValue, allTags, tags]);

  // Normalize and add a tag
  const addTag = (tagName) => {
    const normalized = tagName.trim().toLowerCase();
    if (normalized && !tags.includes(normalized)) {
      onChange([...tags, normalized]);
    }
    setInputValue('');
    setShowSuggestions(false);
    setSelectedSuggestion(0);
  };

  // Remove a tag by index
  const removeTag = (index) => {
    onChange(tags.filter((_, i) => i !== index));
  };

  // Parse input for separators (comma, slash) and commit tags
  const parseAndAddTags = (value) => {
    // Split by comma or slash
    const parts = value.split(/[,\/]/);
    if (parts.length > 1) {
      // Collect all new tags to add
      const newTags = [];
      parts.slice(0, -1).forEach(part => {
        const normalized = part.trim().toLowerCase();
        if (normalized && !tags.includes(normalized) && !newTags.includes(normalized)) {
          newTags.push(normalized);
        }
      });
      // Add all new tags at once
      if (newTags.length > 0) {
        onChange([...tags, ...newTags]);
      }
      // Keep the last part in input
      return parts[parts.length - 1];
    }
    return value;
  };

  const handleInputChange = (e) => {
    const value = e.target.value;
    const remaining = parseAndAddTags(value);
    setInputValue(remaining);
    setShowSuggestions(remaining.trim().length > 0);
    setSelectedSuggestion(0);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (showSuggestions && suggestions.length > 0) {
        addTag(suggestions[selectedSuggestion]);
      } else if (inputValue.trim()) {
        addTag(inputValue);
      }
    } else if (e.key === 'Backspace' && !inputValue && tags.length > 0) {
      // Remove last tag when backspace on empty input
      removeTag(tags.length - 1);
    } else if (e.key === 'ArrowDown' && showSuggestions) {
      e.preventDefault();
      setSelectedSuggestion(prev => Math.min(prev + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp' && showSuggestions) {
      e.preventDefault();
      setSelectedSuggestion(prev => Math.max(prev - 1, 0));
    } else if (e.key === 'Escape') {
      setShowSuggestions(false);
    }
  };

  const handleBlur = () => {
    // Delay to allow click on suggestion
    setTimeout(() => {
      if (inputValue.trim()) {
        addTag(inputValue);
      }
      setShowSuggestions(false);
    }, 150);
  };

  return h('div', { className: 'tag-input-container' },
    h('div', { className: 'tag-input-chips' },
      tags.map((tag, index) =>
        h('span', { key: tag, className: 'tag-chip' },
          tag,
          h('button', {
            type: 'button',
            className: 'tag-chip-remove',
            onClick: () => removeTag(index)
          }, '×')
        )
      ),
      h('input', {
        ref: inputRef,
        type: 'text',
        className: 'tag-input-field',
        value: inputValue,
        onChange: handleInputChange,
        onKeyDown: handleKeyDown,
        onFocus: () => inputValue.trim() && setShowSuggestions(true),
        onBlur: handleBlur,
        placeholder: tags.length === 0 ? placeholder : ''
      })
    ),
    showSuggestions && suggestions.length > 0 && h('div', { className: 'tag-suggestions' },
      suggestions.map((suggestion, index) =>
        h('div', {
          key: suggestion,
          className: `tag-suggestion ${index === selectedSuggestion ? 'selected' : ''}`,
          onMouseDown: (e) => {
            e.preventDefault();
            addTag(suggestion);
          }
        }, suggestion)
      )
    )
  );
}

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

function formatCardNumber(value) {
  const v = value.replace(/\s+/g, '').replace(/[^0-9]/gi, '');
  const matches = v.match(/\d{4,16}/g);
  const match = matches && matches[0] || '';
  const parts = [];
  for (let i = 0, len = match.length; i < len; i += 4) {
    parts.push(match.substring(i, i + 4));
  }
  return parts.length ? parts.join(' ') : value;
}

function App() {
  const [screen, setScreen] = React.useState('loading');
  const [masterPassword, setMasterPassword] = React.useState('');
  const [confirmPassword, setConfirmPassword] = React.useState('');
  const [items, setItems] = React.useState([]);
  const [showForm, setShowForm] = React.useState(false);
  const [activeCategory, setActiveCategory] = React.useState('passwords');
  const [showSettings, setShowSettings] = React.useState(false);
  const [formType, setFormType] = React.useState('password');
  const [selectedItems, setSelectedItems] = React.useState(new Set());
  const [passwordForm, setPasswordForm] = React.useState({ site: '', username: '', password: '', websiteUrl: '', tags: [] });
  const [cardForm, setCardForm] = React.useState({ name: '', cardNumber: '', expiry: '', cvv: '', cardHolder: '', tags: [] });
  const [error, setError] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [showSecrets, setShowSecrets] = React.useState({});
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
  const [sortBy, setSortBy] = React.useState('title');
  const [displayLimit, setDisplayLimit] = React.useState(50);
  const [importStatus, setImportStatus] = React.useState('');
  const [touchIdAvailable, setTouchIdAvailable] = React.useState(false);
  const [touchIdEnabled, setTouchIdEnabled] = React.useState(false);
  const [loadingTotal, setLoadingTotal] = React.useState(0);
  const [loadingCount, setLoadingCount] = React.useState(0);
  const [editingItem, setEditingItem] = React.useState(null);
  const [editForm, setEditForm] = React.useState(null);
  const [contextMenu, setContextMenu] = React.useState(null); // { x, y, item }
  const [lastClickedId, setLastClickedId] = React.useState(null); // Anchor for shift-select

  React.useEffect(() => {
    checkVault();
    checkTouchId();
  }, []);

  // Close context menu on click outside
  React.useEffect(() => {
    const handleClick = () => setContextMenu(null);
    if (contextMenu) {
      document.addEventListener('click', handleClick);
      return () => document.removeEventListener('click', handleClick);
    }
  }, [contextMenu]);

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
    setLoading(true);
    setLoadingCount(0);
    setLoadingTotal(0);

    const success = await window.electronAPI.unlockVault(masterPassword);
    if (success) {
      // Set up progressive loading listeners
      const pendingItems = [];

      const removeBatchListener = window.electronAPI.onPasswordsBatch((batch) => {
        // Normalize and accumulate items
        const normalized = batch.map(item => ({
          ...item,
          type: item.type || 'password',
          tags: item.tags || [],
          createdAt: item.createdAt || Date.now(),
          modifiedAt: item.modifiedAt || Date.now(),
          accessCount: item.accessCount || 0,
          lastAccessed: item.lastAccessed || null
        }));
        pendingItems.push(...normalized);
        setLoadingCount(pendingItems.length);
        // Update items progressively
        setItems([...pendingItems]);
      });

      const removeCompleteListener = window.electronAPI.onPasswordsComplete(() => {
        removeBatchListener();
        removeCompleteListener();
        setLoading(false);
        setLoadingTotal(0);
        setLoadingCount(0);
      });

      // Start loading - this returns immediately with total count
      const result = await window.electronAPI.getPasswords(masterPassword);
      setLoadingTotal(result.total);

      // If empty vault, go straight to vault screen
      if (result.total === 0) {
        removeBatchListener();
        removeCompleteListener();
        setLoading(false);
      }

      setScreen('vault');
    } else {
      setLoading(false);
      setError('Incorrect master password');
    }
  };

  const handleAddItem = async (e) => {
    e.preventDefault();
    const now = Date.now();
    let itemData;

    if (formType === 'password') {
      if (!passwordForm.site || !passwordForm.username || !passwordForm.password) return;
      // Normalize website URL
      let websiteUrl = (passwordForm.websiteUrl || '').trim();
      if (websiteUrl && !websiteUrl.includes('://')) {
        websiteUrl = 'https://' + websiteUrl;
      }
      itemData = {
        type: 'password',
        site: passwordForm.site,
        username: passwordForm.username,
        password: passwordForm.password,
        websiteUrl: websiteUrl || null,
        tags: passwordForm.tags || [],
        isFavorite: false,
        createdAt: now,
        modifiedAt: now,
        accessCount: 0,
        lastAccessed: null
      };
    } else {
      if (!cardForm.name || !cardForm.cardNumber) return;
      itemData = {
        type: 'card',
        name: cardForm.name,
        cardNumber: cardForm.cardNumber,
        expiry: cardForm.expiry,
        cvv: cardForm.cvv,
        cardHolder: cardForm.cardHolder,
        tags: cardForm.tags || [],
        isFavorite: false,
        createdAt: now,
        modifiedAt: now,
        accessCount: 0,
        lastAccessed: null
      };
    }

    const id = await window.electronAPI.savePassword(masterPassword, itemData);
    if (id) {
      setItems([...items, { ...itemData, id }]);
      setPasswordForm({ site: '', username: '', password: '', websiteUrl: '', tags: [] });
      setCardForm({ name: '', cardNumber: '', expiry: '', cvv: '', cardHolder: '', tags: [] });
      setShowForm(false);
    }
  };

  const handleDelete = async (id) => {
    const success = await window.electronAPI.deletePassword(masterPassword, id);
    if (success) {
      setItems(items.filter(p => p.id !== id));
      if (selectedItems.has(id)) {
        setSelectedItems(prev => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
    }
  };

  const handleContextMenu = (e, item) => {
    e.preventDefault();
    // If right-clicked item is already selected, use all selected items
    // Otherwise, select only the right-clicked item
    let contextItems;
    if (selectedItems.has(item.id)) {
      contextItems = Array.from(selectedItems).map(id => items.find(i => i.id === id)).filter(Boolean);
    } else {
      setSelectedItems(new Set([item.id]));
      contextItems = [item];
    }
    setContextMenu({ x: e.clientX, y: e.clientY, items: contextItems });
  };

  const handleDuplicate = async () => {
    if (!contextMenu || contextMenu.items.length === 0) return;
    const item = contextMenu.items[0]; // Duplicate first selected item
    const now = Date.now();
    const duplicateData = {
      ...item,
      id: undefined,
      createdAt: now,
      modifiedAt: now,
      accessCount: 0,
      lastAccessed: null
    };
    delete duplicateData.id;

    const id = await window.electronAPI.savePassword(masterPassword, duplicateData);
    if (id) {
      const newItem = { ...duplicateData, id };
      setItems([...items, newItem]);
      setSelectedItems(new Set([id]));
      setImportStatus('Entry duplicated');
      setTimeout(() => setImportStatus(''), 1500);
    }
    setContextMenu(null);
  };

  const handleContextDelete = async () => {
    if (!contextMenu || contextMenu.items.length === 0) return;
    const count = contextMenu.items.length;
    const message = count === 1
      ? `Delete "${contextMenu.items[0].type === 'card' ? contextMenu.items[0].name : contextMenu.items[0].site}"?`
      : `Delete ${count} items?`;

    if (confirm(message)) {
      for (const item of contextMenu.items) {
        await window.electronAPI.deletePassword(masterPassword, item.id);
      }
      const deletedIds = new Set(contextMenu.items.map(i => i.id));
      setItems(items.filter(i => !deletedIds.has(i.id)));
      setSelectedItems(new Set());
      setImportStatus(count === 1 ? 'Entry deleted' : `${count} entries deleted`);
      setTimeout(() => setImportStatus(''), 1500);
    }
    setContextMenu(null);
  };

  const toggleShowSecret = (id) => {
    setShowSecrets(prev => ({ ...prev, [id]: !prev[id] }));
    // Track access
    const item = items.find(i => i.id === id);
    if (item && !showSecrets[id]) {
      const updated = {
        ...item,
        accessCount: (item.accessCount || 0) + 1,
        lastAccessed: Date.now()
      };
      setItems(items.map(i => i.id === id ? updated : i));
    }
  };

  const handleLock = () => {
    setMasterPassword('');
    setItems([]);
    setScreen('unlock');
  };

  const handleGenerate = () => {
    const pwd = generatePassword(genOptions);
    setGeneratedPassword(pwd);
  };

  const useGeneratedPassword = () => {
    setPasswordForm({ ...passwordForm, password: generatedPassword });
    setShowGenerator(false);
    setGeneratedPassword('');
  };

  // Memoize expensive computations
  const categoryItems = React.useMemo(() => {
    return items.filter(item => {
      if (activeCategory === 'favorites') return item.isFavorite === true;
      if (activeCategory === 'passwords') return item.type === 'password' || !item.type;
      if (activeCategory === 'cards') return item.type === 'card';
      return true;
    });
  }, [items, activeCategory]);

  // Count favorites
  const favoritesCount = React.useMemo(() => {
    return items.filter(item => item.isFavorite === true).length;
  }, [items]);

  const filteredItems = React.useMemo(() => {
    if (!searchQuery) return categoryItems;

    // Check for tag: or # prefix for tag-only search
    const tagPrefixMatch = searchQuery.match(/^(?:tag:|#)(.+)$/i);
    if (tagPrefixMatch) {
      const tagQuery = tagPrefixMatch[1].toLowerCase().trim();
      return categoryItems.filter(p => {
        const tags = p.tags || [];
        return tags.some(tag => tag.toLowerCase() === tagQuery || tag.toLowerCase().includes(tagQuery));
      });
    }

    // Regular search - matches tags, website URL, and other fields
    const query = searchQuery.toLowerCase();
    return categoryItems.filter(p => {
      const tags = p.tags || [];
      const matchesTags = tags.some(tag => tag.toLowerCase().includes(query));
      const matchesWebsite = (p.websiteUrl || '').toLowerCase().includes(query);
      if (p.type === 'card') {
        return (p.name || '').toLowerCase().includes(query) ||
               (p.cardHolder || '').toLowerCase().includes(query) ||
               matchesTags;
      }
      return (p.site || '').toLowerCase().includes(query) ||
             (p.username || '').toLowerCase().includes(query) ||
             matchesTags ||
             matchesWebsite;
    });
  }, [categoryItems, searchQuery]);

  const sortedItems = React.useMemo(() => {
    return [...filteredItems].sort((a, b) => {
      switch (sortBy) {
        case 'title':
          const titleA = a.type === 'card' ? (a.name || '') : (a.site || '');
          const titleB = b.type === 'card' ? (b.name || '') : (b.site || '');
          return titleA.localeCompare(titleB);
        case 'created':
          return (b.createdAt || 0) - (a.createdAt || 0);
        case 'modified':
          return (b.modifiedAt || 0) - (a.modifiedAt || 0);
        case 'frequent':
          return (b.accessCount || 0) - (a.accessCount || 0);
        case 'recent':
          return (b.lastAccessed || 0) - (a.lastAccessed || 0);
        default:
          return 0;
      }
    });
  }, [filteredItems, sortBy]);

  // Compute tags with counts for sidebar (top 20)
  const tagsWithCounts = React.useMemo(() => {
    const tagCounts = {};
    items.forEach(p => {
      (p.tags || []).forEach(tag => {
        tagCounts[tag] = (tagCounts[tag] || 0) + 1;
      });
    });
    return Object.entries(tagCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([tag, count]) => ({ tag, count }));
  }, [items]);

  // Legacy allTags for backwards compatibility
  const allTags = tagsWithCounts.map(t => t.tag);

  // Get the single selected item for detail view (only when exactly one selected)
  const selectedItem = React.useMemo(() => {
    if (selectedItems.size === 1) {
      const id = Array.from(selectedItems)[0];
      return items.find(i => i.id === id) || null;
    }
    return null;
  }, [selectedItems, items]);

  // Limit displayed items for performance
  const displayedItems = sortedItems.slice(0, displayLimit);
  const hasMore = sortedItems.length > displayLimit;

  // Keyboard shortcuts (Cmd+A to select all)
  React.useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'a' && !showForm) {
        e.preventDefault();
        if (displayedItems.length > 0) {
          setSelectedItems(new Set(displayedItems.map(i => i.id)));
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [showForm, displayedItems]);

  const handleTagClick = (tag) => {
    setSearchQuery(tag);
  };

  const handleImport = async () => {
    setImportStatus('Importing...');
    const result = await window.electronAPI.importPasswords(masterPassword);
    if (result.canceled) {
      setImportStatus('');
      return;
    }
    if (!result.success) {
      setImportStatus(result.error || 'Import failed');
      setTimeout(() => setImportStatus(''), 3000);
      return;
    }

    // Streaming import
    if (result.streaming) {
      const pendingItems = [...items];
      let importedCount = 0;

      const removeBatchListener = window.electronAPI.onImportBatch((batch) => {
        const normalized = batch.map(p => ({
          ...p,
          type: 'password',
          createdAt: Date.now(),
          modifiedAt: Date.now(),
          accessCount: 0,
          lastAccessed: null
        }));
        pendingItems.push(...normalized);
        importedCount += batch.length;
        setItems([...pendingItems]);
        setImportStatus(`Importing... ${importedCount} of ${result.total}`);
      });

      const removeCompleteListener = window.electronAPI.onImportComplete((data) => {
        removeBatchListener();
        removeCompleteListener();
        setImportStatus(`Imported ${data.count} passwords`);
        setTimeout(() => setImportStatus(''), 3000);
      });
    } else {
      // Legacy non-streaming (fallback)
      const importedWithMeta = result.passwords.map(p => ({
        ...p,
        type: 'password',
        createdAt: Date.now(),
        modifiedAt: Date.now(),
        accessCount: 0,
        lastAccessed: null
      }));
      setItems([...items, ...importedWithMeta]);
      setImportStatus(`Imported ${result.count} passwords`);
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

  const handleClearVault = async () => {
    if (!confirm('Are you sure you want to delete ALL entries? This cannot be undone.')) {
      return;
    }
    setImportStatus('Clearing vault...');
    const result = await window.electronAPI.clearVault(masterPassword);
    if (result.success) {
      setItems([]);
      setSelectedItems(new Set());
      setImportStatus('Vault cleared');
      setTimeout(() => setImportStatus(''), 3000);
    } else {
      setImportStatus(result.error || 'Failed to clear vault');
      setTimeout(() => setImportStatus(''), 3000);
    }
  };

  const handleTouchIdUnlock = async () => {
    setError('');
    setLoading(true);
    setLoadingCount(0);
    setLoadingTotal(0);

    const result = await window.electronAPI.unlockWithTouchId();
    if (result.success) {
      setMasterPassword(result.masterPassword);

      // Set up progressive loading listeners
      const pendingItems = [];

      const removeBatchListener = window.electronAPI.onPasswordsBatch((batch) => {
        // Normalize and accumulate items
        const normalized = batch.map(item => ({
          ...item,
          type: item.type || 'password',
          tags: item.tags || [],
          createdAt: item.createdAt || Date.now(),
          modifiedAt: item.modifiedAt || Date.now(),
          accessCount: item.accessCount || 0,
          lastAccessed: item.lastAccessed || null
        }));
        pendingItems.push(...normalized);
        setLoadingCount(pendingItems.length);
        // Update items progressively
        setItems([...pendingItems]);
      });

      const removeCompleteListener = window.electronAPI.onPasswordsComplete(() => {
        removeBatchListener();
        removeCompleteListener();
        setLoading(false);
        setLoadingTotal(0);
        setLoadingCount(0);
      });

      // Start loading - this returns immediately with total count
      const loadResult = await window.electronAPI.getPasswords(result.masterPassword);
      setLoadingTotal(loadResult.total);

      // If empty vault, go straight to vault screen
      if (loadResult.total === 0) {
        removeBatchListener();
        removeCompleteListener();
        setLoading(false);
      }

      setScreen('vault');
    } else {
      setLoading(false);
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

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
    setImportStatus('Copied to clipboard');
    setTimeout(() => setImportStatus(''), 1500);
  };

  // Toggle favorite status and persist immediately
  const handleToggleFavorite = async (item) => {
    const updatedItem = { ...item, isFavorite: !item.isFavorite, modifiedAt: Date.now() };
    const success = await window.electronAPI.updatePassword(masterPassword, item.id, updatedItem);
    if (success) {
      setItems(items.map(i => i.id === item.id ? updatedItem : i));
      setImportStatus(updatedItem.isFavorite ? 'Added to favorites' : 'Removed from favorites');
      setTimeout(() => setImportStatus(''), 1500);
    }
  };

  // Open website URL
  const handleOpenWebsite = (url, item) => {
    if (!url) return;
    // Copy username to clipboard for convenience
    if (item && item.username) {
      navigator.clipboard.writeText(item.username);
      setImportStatus('Username copied, opening website...');
      setTimeout(() => setImportStatus(''), 2000);
    }
    window.open(url, '_blank');
  };

  // Edit mode handlers
  const handleStartEdit = (item) => {
    setEditingItem(item);
    if (item.type === 'card') {
      setEditForm({
        name: item.name || '',
        cardNumber: item.cardNumber || '',
        expiry: item.expiry || '',
        cvv: item.cvv || '',
        cardHolder: item.cardHolder || '',
        tags: [...(item.tags || [])]
      });
    } else {
      setEditForm({
        site: item.site || '',
        username: item.username || '',
        password: item.password || '',
        websiteUrl: item.websiteUrl || '',
        tags: [...(item.tags || [])]
      });
    }
  };

  const handleCancelEdit = () => {
    setEditingItem(null);
    setEditForm(null);
  };

  const handleSaveEdit = async () => {
    if (!editingItem || !editForm) return;

    const now = Date.now();
    let updatedData;

    if (editingItem.type === 'card') {
      if (!editForm.name || !editForm.cardNumber) return;
      updatedData = {
        type: 'card',
        name: editForm.name,
        cardNumber: editForm.cardNumber,
        expiry: editForm.expiry,
        cvv: editForm.cvv,
        cardHolder: editForm.cardHolder,
        tags: editForm.tags,
        isFavorite: editingItem.isFavorite || false,
        createdAt: editingItem.createdAt,
        modifiedAt: now,
        accessCount: editingItem.accessCount || 0,
        lastAccessed: editingItem.lastAccessed
      };
    } else {
      if (!editForm.site || !editForm.username || !editForm.password) return;
      // Normalize website URL
      let websiteUrl = (editForm.websiteUrl || '').trim();
      if (websiteUrl && !websiteUrl.includes('://')) {
        websiteUrl = 'https://' + websiteUrl;
      }
      updatedData = {
        type: 'password',
        site: editForm.site,
        username: editForm.username,
        password: editForm.password,
        websiteUrl: websiteUrl || null,
        tags: editForm.tags,
        isFavorite: editingItem.isFavorite || false,
        createdAt: editingItem.createdAt,
        modifiedAt: now,
        accessCount: editingItem.accessCount || 0,
        lastAccessed: editingItem.lastAccessed
      };
    }

    const success = await window.electronAPI.updatePassword(masterPassword, editingItem.id, updatedData);
    if (success) {
      const updatedItem = { ...updatedData, id: editingItem.id };
      setItems(items.map(i => i.id === editingItem.id ? updatedItem : i));
      setSelectedItems(new Set([editingItem.id]));
      setEditingItem(null);
      setEditForm(null);
      setImportStatus('Changes saved');
      setTimeout(() => setImportStatus(''), 1500);
    } else {
      setImportStatus('Failed to save changes');
      setTimeout(() => setImportStatus(''), 3000);
    }
  };

  // Compute all unique tags across all items for autocomplete
  const allUniqueTags = React.useMemo(() => {
    const tagSet = new Set();
    items.forEach(item => {
      (item.tags || []).forEach(tag => tagSet.add(tag));
    });
    return Array.from(tagSet).sort();
  }, [items]);

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
        h('h1', null, loading ? 'Unlocking...' : 'Unlock Vault'),
        loading ? h('div', { className: 'loading-message' },
          loadingTotal > 0
            ? `Decrypting ${loadingCount} of ${loadingTotal} items...`
            : 'Decrypting vault...'
        ) : [
          touchIdEnabled && h('button', {
            key: 'touchid',
            type: 'button',
            className: 'btn-touchid',
            onClick: handleTouchIdUnlock
          }, 'Unlock with Touch ID'),
          touchIdEnabled && h('div', { key: 'divider', className: 'divider' }, h('span', null, 'or')),
          h('form', { key: 'form', onSubmit: handleUnlock },
            h('input', {
              type: 'password',
              placeholder: 'Master password',
              value: masterPassword,
              onChange: (e) => setMasterPassword(e.target.value)
            }),
            error && h('p', { className: 'error' }, error),
            h('button', { type: 'submit', className: 'btn-primary' }, 'Unlock')
          )
        ]
      )
    );
  }

  // Helper to select an item (supports multi-select with Cmd/Ctrl and Shift)
  const handleSelectItem = (item, e) => {
    setShowForm(false);

    if (e && e.shiftKey && lastClickedId !== null) {
      // Shift+click: range selection
      const currentIndex = displayedItems.findIndex(i => i.id === item.id);
      const lastIndex = displayedItems.findIndex(i => i.id === lastClickedId);

      if (currentIndex !== -1 && lastIndex !== -1) {
        const start = Math.min(currentIndex, lastIndex);
        const end = Math.max(currentIndex, lastIndex);
        const rangeIds = displayedItems.slice(start, end + 1).map(i => i.id);

        if (e.metaKey || e.ctrlKey) {
          // Shift+Cmd: add range to existing selection
          setSelectedItems(prev => {
            const next = new Set(prev);
            rangeIds.forEach(id => next.add(id));
            return next;
          });
        } else {
          // Shift only: replace selection with range
          setSelectedItems(new Set(rangeIds));
        }
      }
    } else if (e && (e.metaKey || e.ctrlKey)) {
      // Cmd/Ctrl+click: toggle selection
      setSelectedItems(prev => {
        const next = new Set(prev);
        if (next.has(item.id)) {
          next.delete(item.id);
        } else {
          next.add(item.id);
        }
        return next;
      });
      setLastClickedId(item.id);
    } else {
      // Regular click: single select
      setSelectedItems(new Set([item.id]));
      setLastClickedId(item.id);
    }
  };

  // Helper to start adding new item
  const handleAddNew = () => {
    setSelectedItems(new Set());
    setShowForm(true);
    setFormType(activeCategory === 'cards' ? 'card' : 'password');
  };

  return h('div', { className: 'app-layout' },
    // Column 1: Sidebar
    h('aside', { className: 'sidebar' },
      h('div', { className: 'sidebar-header' },
        h('h1', null, 'Vault')
      ),

      h('nav', { className: 'sidebar-nav' },
        h('button', {
          className: activeCategory === 'favorites' ? 'nav-item active' : 'nav-item',
          onClick: () => { setActiveCategory('favorites'); setSelectedItems(new Set()); setShowForm(false); setShowSettings(false); setDisplayLimit(50); }
        },
          h('span', { className: 'nav-item-content' },
            h('span', { className: 'nav-icon star-icon' }, '★'),
            'Favorites'
          ),
          favoritesCount > 0 && h('span', { className: 'nav-item-count' }, favoritesCount)
        ),
        h('button', {
          className: activeCategory === 'passwords' ? 'nav-item active' : 'nav-item',
          onClick: () => { setActiveCategory('passwords'); setSelectedItems(new Set()); setShowForm(false); setShowSettings(false); setDisplayLimit(50); }
        }, 'Passwords'),
        h('button', {
          className: activeCategory === 'cards' ? 'nav-item active' : 'nav-item',
          onClick: () => { setActiveCategory('cards'); setSelectedItems(new Set()); setShowForm(false); setShowSettings(false); setDisplayLimit(50); }
        }, 'Credit Cards')
      ),

      h('div', { className: 'sidebar-tags' },
        h('span', { className: 'sidebar-section-title' }, 'Tags'),
        tagsWithCounts.length > 0
          ? h('div', { className: 'tags-list' },
              tagsWithCounts.map(({ tag, count }) =>
                h('button', {
                  key: tag,
                  className: searchQuery === tag ? 'tag-btn active' : 'tag-btn',
                  onClick: () => handleTagClick(tag)
                },
                  h('span', { className: 'tag-btn-name' }, tag),
                  h('span', { className: 'tag-btn-count' }, count)
                )
              )
            )
          : h('div', { className: 'tags-empty' },
              h('p', null, 'No tags yet'),
              h('p', { className: 'tags-empty-hint' }, 'Add tags to items to organize them')
            )
      ),

      h('div', { className: 'sidebar-footer' },
        h('button', {
          className: showSettings ? 'nav-item active' : 'nav-item',
          onClick: () => { setShowSettings(true); setSelectedItems(new Set()); setShowForm(false); }
        },
          h('span', { className: 'nav-item-content' },
            h('span', { className: 'nav-icon' }, '⚙'),
            'Settings'
          )
        ),
        h('button', { className: 'btn-secondary sidebar-btn lock-btn', onClick: handleLock }, '🔒 Lock')
      )
    ),

    // Column 2: Item List
    h('section', { className: 'list-panel' },
      h('div', { className: 'list-header' },
        h('div', { className: 'search-box' },
          h('input', {
            type: 'text',
            placeholder: 'Search...',
            value: searchQuery,
            onChange: (e) => setSearchQuery(e.target.value)
          }),
          searchQuery && h('button', { className: 'btn-clear-search', onClick: () => setSearchQuery('') }, 'Clear')
        ),
        h('div', { className: 'list-controls' },
          h('select', { className: 'sort-select', value: sortBy, onChange: (e) => setSortBy(e.target.value) },
            h('option', { value: 'title' }, 'Title'),
            h('option', { value: 'created' }, 'Date Created'),
            h('option', { value: 'modified' }, 'Date Modified'),
            h('option', { value: 'frequent' }, 'Most Used'),
            h('option', { value: 'recent' }, 'Recently Used')
          ),
          h('button', { className: 'btn-primary btn-add', onClick: handleAddNew }, '+')
        )
      ),

      importStatus && h('div', { className: 'import-status' }, importStatus),

      h('div', { className: 'items-list' },
        loading && loadingTotal > 0 && h('div', { className: 'loading-progress' },
          `Loading ${loadingCount} of ${loadingTotal}...`
        ),
        categoryItems.length === 0 && !loading
          ? h('div', { className: 'empty-message' },
              h('p', null, activeCategory === 'favorites' ? 'No favorites yet' : activeCategory === 'cards' ? 'No credit cards saved yet.' : 'No passwords saved yet.'),
              activeCategory === 'favorites' && h('p', { className: 'empty-hint' }, 'Click the ★ on any item to add it to favorites')
            )
          : sortedItems.length === 0 && !loading
          ? h('p', { className: 'empty-message' }, 'No matching items.')
          : [
            h('div', { key: 'count', className: 'items-count' }, loading ? `${sortedItems.length} items (loading...)` : `${sortedItems.length} items`),
            ...displayedItems.map(item =>
              h('div', {
                key: item.id,
                className: `list-item ${selectedItems && selectedItems.has(item.id) ? 'selected' : ''}`,
                onClick: (e) => handleSelectItem(item, e),
                onContextMenu: (e) => handleContextMenu(e, item)
              },
                h(ItemIcon, {
                  site: item.type === 'card' ? null : item.site,
                  name: item.type === 'card' ? item.name : item.site,
                  size: 28,
                  className: 'list-item-icon'
                }),
                h('div', { className: 'list-item-content' },
                  h('strong', null, item.type === 'card' ? item.name : item.site),
                  h('span', null, item.type === 'card' ? '•••• ' + (item.cardNumber || '').slice(-4) : item.username)
                ),
                (item.tags && item.tags.length > 0) && h('div', { className: 'list-item-tags' },
                  item.tags.slice(0, 2).map(tag => h('span', { key: tag, className: 'tag-mini' }, tag))
                ),
                h('button', {
                  className: `favorite-btn ${item.isFavorite ? 'active' : ''}`,
                  onClick: (e) => { e.stopPropagation(); handleToggleFavorite(item); },
                  title: item.isFavorite ? 'Remove from favorites' : 'Add to favorites'
                }, '★')
              )
            ),
            hasMore && h('button', {
              key: 'load-more',
              className: 'btn-load-more',
              onClick: () => setDisplayLimit(displayLimit + 50)
            }, `Show more (${sortedItems.length - displayLimit} remaining)`)
          ]
      )
    ),

    // Column 3: Detail Panel
    h('section', { className: 'detail-panel' },
      showSettings ? (
        // Settings View
        h('div', { className: 'detail-content settings-content' },
          h('div', { className: 'detail-header' },
            h('h2', null, 'Settings'),
            h('button', { className: 'btn-secondary', onClick: () => setShowSettings(false) }, 'Close')
          ),
          h('div', { className: 'settings-sections' },
            // Security Section
            h('div', { className: 'settings-section' },
              h('h3', { className: 'settings-section-title' }, 'Security'),
              touchIdAvailable && h('div', { className: 'settings-row' },
                h('div', { className: 'settings-row-info' },
                  h('span', { className: 'settings-row-label' }, 'Touch ID'),
                  h('span', { className: 'settings-row-desc' }, 'Use Touch ID to unlock your vault')
                ),
                h('button', {
                  className: touchIdEnabled ? 'btn-toggle active' : 'btn-toggle',
                  onClick: touchIdEnabled ? handleDisableTouchId : handleEnableTouchId
                }, touchIdEnabled ? 'On' : 'Off')
              ),
              h('div', { className: 'settings-row' },
                h('div', { className: 'settings-row-info' },
                  h('span', { className: 'settings-row-label' }, 'Lock Vault'),
                  h('span', { className: 'settings-row-desc' }, 'Lock now and require password to access')
                ),
                h('button', { className: 'btn-secondary', onClick: handleLock }, 'Lock Now')
              )
            ),
            // Data Section
            h('div', { className: 'settings-section' },
              h('h3', { className: 'settings-section-title' }, 'Data'),
              h('div', { className: 'settings-row' },
                h('div', { className: 'settings-row-info' },
                  h('span', { className: 'settings-row-label' }, 'Import'),
                  h('span', { className: 'settings-row-desc' }, 'Import passwords from CSV file')
                ),
                h('button', { className: 'btn-secondary', onClick: handleImport }, 'Import')
              ),
              h('div', { className: 'settings-row' },
                h('div', { className: 'settings-row-info' },
                  h('span', { className: 'settings-row-label' }, 'Export'),
                  h('span', { className: 'settings-row-desc' }, 'Export passwords to CSV file')
                ),
                h('button', { className: 'btn-secondary', onClick: handleExport }, 'Export')
              ),
              h('div', { className: 'settings-row settings-row-danger' },
                h('div', { className: 'settings-row-info' },
                  h('span', { className: 'settings-row-label' }, 'Clear Vault'),
                  h('span', { className: 'settings-row-desc' }, 'Delete all entries permanently')
                ),
                h('button', { className: 'btn-danger', onClick: handleClearVault }, 'Clear All')
              )
            )
          )
        )
      ) : showForm ? (
        // Add Form
        formType === 'password' ? h('div', { className: 'detail-content' },
          h('div', { className: 'detail-header' },
            h('h2', null, 'New Password'),
            h('button', { className: 'btn-secondary', onClick: () => setShowForm(false) }, 'Cancel')
          ),
          h('form', { className: 'detail-form', onSubmit: handleAddItem },
            h('div', { className: 'form-group' },
              h('label', null, 'Website'),
              h('input', {
                type: 'text',
                value: passwordForm.site,
                onChange: (e) => setPasswordForm({ ...passwordForm, site: e.target.value })
              })
            ),
            h('div', { className: 'form-group' },
              h('label', null, 'Username'),
              h('input', {
                type: 'text',
                value: passwordForm.username,
                onChange: (e) => setPasswordForm({ ...passwordForm, username: e.target.value })
              })
            ),
            h('div', { className: 'form-group' },
              h('label', null, 'Password'),
              h('div', { className: 'password-input-row' },
                h('input', {
                  type: 'text',
                  value: passwordForm.password,
                  onChange: (e) => setPasswordForm({ ...passwordForm, password: e.target.value })
                }),
                h('button', {
                  type: 'button',
                  className: 'btn-secondary',
                  onClick: () => setShowGenerator(!showGenerator)
                }, 'Generate')
              )
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
                  h('label', null, h('input', { type: 'checkbox', checked: genOptions.uppercase, onChange: (e) => setGenOptions({ ...genOptions, uppercase: e.target.checked }) }), ' ABC'),
                  h('label', null, h('input', { type: 'checkbox', checked: genOptions.lowercase, onChange: (e) => setGenOptions({ ...genOptions, lowercase: e.target.checked }) }), ' abc'),
                  h('label', null, h('input', { type: 'checkbox', checked: genOptions.numbers, onChange: (e) => setGenOptions({ ...genOptions, numbers: e.target.checked }) }), ' 123'),
                  h('label', null, h('input', { type: 'checkbox', checked: genOptions.symbols, onChange: (e) => setGenOptions({ ...genOptions, symbols: e.target.checked }) }), ' !@#')
                )
              ),
              h('div', { className: 'generator-result' },
                h('button', { type: 'button', className: 'btn-primary', onClick: handleGenerate }, 'Generate'),
                generatedPassword && h('div', { className: 'generated-password' },
                  h('code', null, generatedPassword),
                  h('div', { className: 'generated-actions' },
                    h('button', { type: 'button', className: 'btn-icon', onClick: () => copyToClipboard(generatedPassword) }, 'Copy'),
                    h('button', { type: 'button', className: 'btn-icon', onClick: useGeneratedPassword }, 'Use')
                  )
                )
              )
            ),
            h('div', { className: 'form-group' },
              h('label', null, 'Website URL'),
              h('input', {
                type: 'text',
                placeholder: 'https://example.com',
                value: passwordForm.websiteUrl,
                onChange: (e) => setPasswordForm({ ...passwordForm, websiteUrl: e.target.value })
              })
            ),
            h('div', { className: 'form-group' },
              h('label', null, 'Tags'),
              h(TagInput, {
                tags: Array.isArray(passwordForm.tags) ? passwordForm.tags : [],
                onChange: (newTags) => setPasswordForm({ ...passwordForm, tags: newTags }),
                allTags: allUniqueTags
              })
            ),
            h('button', { type: 'submit', className: 'btn-primary btn-save' }, 'Save Password')
          )
        ) : h('div', { className: 'detail-content' },
          h('div', { className: 'detail-header' },
            h('h2', null, 'New Credit Card'),
            h('button', { className: 'btn-secondary', onClick: () => setShowForm(false) }, 'Cancel')
          ),
          h('form', { className: 'detail-form', onSubmit: handleAddItem },
            h('div', { className: 'form-group' },
              h('label', null, 'Card Name'),
              h('input', {
                type: 'text',
                placeholder: 'e.g. Chase Sapphire',
                value: cardForm.name,
                onChange: (e) => setCardForm({ ...cardForm, name: e.target.value })
              })
            ),
            h('div', { className: 'form-group' },
              h('label', null, 'Card Number'),
              h('input', {
                type: 'text',
                value: cardForm.cardNumber,
                onChange: (e) => setCardForm({ ...cardForm, cardNumber: formatCardNumber(e.target.value) }),
                maxLength: 19
              })
            ),
            h('div', { className: 'form-row' },
              h('div', { className: 'form-group' },
                h('label', null, 'Expiry'),
                h('input', {
                  type: 'text',
                  placeholder: 'MM/YY',
                  value: cardForm.expiry,
                  onChange: (e) => {
                    let v = e.target.value.replace(/\D/g, '');
                    if (v.length >= 2) v = v.slice(0, 2) + '/' + v.slice(2, 4);
                    setCardForm({ ...cardForm, expiry: v });
                  },
                  maxLength: 5
                })
              ),
              h('div', { className: 'form-group' },
                h('label', null, 'CVV'),
                h('input', {
                  type: 'text',
                  value: cardForm.cvv,
                  onChange: (e) => setCardForm({ ...cardForm, cvv: e.target.value.replace(/\D/g, '').slice(0, 4) }),
                  maxLength: 4
                })
              )
            ),
            h('div', { className: 'form-group' },
              h('label', null, 'Cardholder Name'),
              h('input', {
                type: 'text',
                value: cardForm.cardHolder,
                onChange: (e) => setCardForm({ ...cardForm, cardHolder: e.target.value })
              })
            ),
            h('div', { className: 'form-group' },
              h('label', null, 'Tags'),
              h(TagInput, {
                tags: Array.isArray(cardForm.tags) ? cardForm.tags : [],
                onChange: (newTags) => setCardForm({ ...cardForm, tags: newTags }),
                allTags: allUniqueTags
              })
            ),
            h('button', { type: 'submit', className: 'btn-primary btn-save' }, 'Save Card')
          )
        )
      ) : selectedItem ? (
        // Detail View (with edit mode support)
        editingItem && editingItem.id === selectedItem.id ? (
          // Edit Mode
          selectedItem.type === 'card' ? h('div', { className: 'detail-content' },
            h('div', { className: 'detail-header' },
              h('h2', null, 'Edit Credit Card'),
              h('div', { className: 'detail-header-actions' },
                h('button', { className: 'btn-secondary', onClick: handleCancelEdit }, 'Cancel'),
                h('button', { className: 'btn-primary', onClick: handleSaveEdit }, 'Save')
              )
            ),
            h('div', { className: 'detail-form' },
              h('div', { className: 'form-group' },
                h('label', null, 'Card Name'),
                h('input', {
                  type: 'text',
                  value: editForm.name,
                  onChange: (e) => setEditForm({ ...editForm, name: e.target.value })
                })
              ),
              h('div', { className: 'form-group' },
                h('label', null, 'Card Number'),
                h('input', {
                  type: 'text',
                  value: editForm.cardNumber,
                  onChange: (e) => setEditForm({ ...editForm, cardNumber: formatCardNumber(e.target.value) }),
                  maxLength: 19
                })
              ),
              h('div', { className: 'form-row' },
                h('div', { className: 'form-group' },
                  h('label', null, 'Expiry'),
                  h('input', {
                    type: 'text',
                    placeholder: 'MM/YY',
                    value: editForm.expiry,
                    onChange: (e) => {
                      let v = e.target.value.replace(/\D/g, '');
                      if (v.length >= 2) v = v.slice(0, 2) + '/' + v.slice(2, 4);
                      setEditForm({ ...editForm, expiry: v });
                    },
                    maxLength: 5
                  })
                ),
                h('div', { className: 'form-group' },
                  h('label', null, 'CVV'),
                  h('input', {
                    type: 'text',
                    value: editForm.cvv,
                    onChange: (e) => setEditForm({ ...editForm, cvv: e.target.value.replace(/\D/g, '').slice(0, 4) }),
                    maxLength: 4
                  })
                )
              ),
              h('div', { className: 'form-group' },
                h('label', null, 'Cardholder Name'),
                h('input', {
                  type: 'text',
                  value: editForm.cardHolder,
                  onChange: (e) => setEditForm({ ...editForm, cardHolder: e.target.value })
                })
              ),
              h('div', { className: 'form-group' },
                h('label', null, 'Tags'),
                h(TagInput, {
                  tags: editForm.tags,
                  onChange: (newTags) => setEditForm({ ...editForm, tags: newTags }),
                  allTags: allUniqueTags
                })
              )
            )
          ) : h('div', { className: 'detail-content' },
            h('div', { className: 'detail-header' },
              h('h2', null, 'Edit Password'),
              h('div', { className: 'detail-header-actions' },
                h('button', { className: 'btn-secondary', onClick: handleCancelEdit }, 'Cancel'),
                h('button', { className: 'btn-primary', onClick: handleSaveEdit }, 'Save')
              )
            ),
            h('div', { className: 'detail-form' },
              h('div', { className: 'form-group' },
                h('label', null, 'Website'),
                h('input', {
                  type: 'text',
                  value: editForm.site,
                  onChange: (e) => setEditForm({ ...editForm, site: e.target.value })
                })
              ),
              h('div', { className: 'form-group' },
                h('label', null, 'Username'),
                h('input', {
                  type: 'text',
                  value: editForm.username,
                  onChange: (e) => setEditForm({ ...editForm, username: e.target.value })
                })
              ),
              h('div', { className: 'form-group' },
                h('label', null, 'Password'),
                h('input', {
                  type: 'text',
                  value: editForm.password,
                  onChange: (e) => setEditForm({ ...editForm, password: e.target.value })
                })
              ),
              h('div', { className: 'form-group' },
                h('label', null, 'Website URL'),
                h('input', {
                  type: 'text',
                  placeholder: 'https://example.com',
                  value: editForm.websiteUrl || '',
                  onChange: (e) => setEditForm({ ...editForm, websiteUrl: e.target.value })
                })
              ),
              h('div', { className: 'form-group' },
                h('label', null, 'Tags'),
                h(TagInput, {
                  tags: editForm.tags,
                  onChange: (newTags) => setEditForm({ ...editForm, tags: newTags }),
                  allTags: allUniqueTags
                })
              )
            )
          )
        ) : (
          // View Mode
          selectedItem.type === 'card' ? h('div', { className: 'detail-content' },
            h('div', { className: 'detail-header' },
              h(ItemIcon, {
                site: null,
                name: selectedItem.name,
                size: 48,
                className: 'detail-icon'
              }),
              h('div', { className: 'detail-header-text' },
                h('h2', null, selectedItem.name),
                h('span', { className: 'detail-type' }, 'Credit Card')
              ),
              h('button', {
                className: `favorite-btn-large ${selectedItem.isFavorite ? 'active' : ''}`,
                onClick: () => handleToggleFavorite(selectedItem),
                title: selectedItem.isFavorite ? 'Remove from favorites' : 'Add to favorites'
              }, '★'),
              h('button', { className: 'btn-secondary btn-edit', onClick: () => handleStartEdit(selectedItem) }, 'Edit')
            ),
            h('div', { className: 'detail-fields' },
              h('div', { className: 'detail-field' },
                h('label', null, 'Card Number'),
                h('div', { className: 'field-value' },
                  h('span', { className: 'mono' }, showSecrets[selectedItem.id] ? selectedItem.cardNumber : '•••• •••• •••• ' + (selectedItem.cardNumber || '').slice(-4)),
                  h('button', { className: 'btn-icon', onClick: () => toggleShowSecret(selectedItem.id) }, showSecrets[selectedItem.id] ? 'Hide' : 'Show'),
                  h('button', { className: 'btn-icon', onClick: () => copyToClipboard(selectedItem.cardNumber.replace(/\s/g, '')) }, 'Copy')
                )
              ),
              h('div', { className: 'detail-row' },
                h('div', { className: 'detail-field' },
                  h('label', null, 'Expiry'),
                  h('div', { className: 'field-value' },
                    h('span', null, selectedItem.expiry),
                    h('button', { className: 'btn-icon', onClick: () => copyToClipboard(selectedItem.expiry) }, 'Copy')
                  )
                ),
                selectedItem.cvv && h('div', { className: 'detail-field' },
                  h('label', null, 'CVV'),
                  h('div', { className: 'field-value' },
                    h('span', { className: 'mono' }, showSecrets[selectedItem.id] ? selectedItem.cvv : '•••'),
                    h('button', { className: 'btn-icon', onClick: () => copyToClipboard(selectedItem.cvv) }, 'Copy')
                  )
                )
              ),
              selectedItem.cardHolder && h('div', { className: 'detail-field' },
                h('label', null, 'Cardholder'),
                h('div', { className: 'field-value' },
                  h('span', null, selectedItem.cardHolder),
                  h('button', { className: 'btn-icon', onClick: () => copyToClipboard(selectedItem.cardHolder) }, 'Copy')
                )
              ),
              h('div', { className: 'detail-field' },
                h('label', null, 'Tags'),
                (selectedItem.tags && selectedItem.tags.length > 0)
                  ? h('div', { className: 'detail-tags' },
                      selectedItem.tags.map(tag => h('span', { key: tag, className: 'tag', onClick: () => handleTagClick(tag) }, tag))
                    )
                  : h('span', { className: 'no-tags' }, 'No tags')
              )
            ),
            h('div', { className: 'detail-actions' },
              h('button', { className: 'btn-delete', onClick: () => { handleDelete(selectedItem.id); setSelectedItems(new Set()); } }, 'Delete')
            )
          ) : h('div', { className: 'detail-content' },
            h('div', { className: 'detail-header' },
              h(ItemIcon, {
                site: selectedItem.site,
                name: selectedItem.site,
                size: 48,
                className: 'detail-icon'
              }),
              h('div', { className: 'detail-header-text' },
                h('h2', null, selectedItem.site),
                h('span', { className: 'detail-type' }, 'Password')
              ),
              h('button', {
                className: `favorite-btn-large ${selectedItem.isFavorite ? 'active' : ''}`,
                onClick: () => handleToggleFavorite(selectedItem),
                title: selectedItem.isFavorite ? 'Remove from favorites' : 'Add to favorites'
              }, '★'),
              h('button', { className: 'btn-secondary btn-edit', onClick: () => handleStartEdit(selectedItem) }, 'Edit')
            ),
            h('div', { className: 'detail-fields' },
              h('div', { className: 'detail-field' },
                h('label', null, 'Username'),
                h('div', { className: 'field-value' },
                  h('span', null, selectedItem.username),
                  h('button', { className: 'btn-icon', onClick: () => copyToClipboard(selectedItem.username) }, 'Copy')
                )
              ),
              h('div', { className: 'detail-field' },
                h('label', null, 'Password'),
                h('div', { className: 'field-value' },
                  h('span', { className: 'mono' }, showSecrets[selectedItem.id] ? selectedItem.password : '••••••••'),
                  h('button', { className: 'btn-icon', onClick: () => toggleShowSecret(selectedItem.id) }, showSecrets[selectedItem.id] ? 'Hide' : 'Show'),
                  h('button', { className: 'btn-icon', onClick: () => copyToClipboard(selectedItem.password) }, 'Copy')
                )
              ),
              selectedItem.websiteUrl && h('div', { className: 'detail-field website-field' },
                h('label', null, 'Website'),
                h('div', { className: 'field-value field-value-website' },
                  h('span', { className: 'website-url', title: selectedItem.websiteUrl },
                    extractDomain(selectedItem.websiteUrl) || selectedItem.websiteUrl
                  ),
                  h('div', { className: 'website-actions' },
                    h('button', {
                      className: 'btn-icon btn-primary-small',
                      onClick: () => handleOpenWebsite(selectedItem.websiteUrl, selectedItem)
                    }, 'Open & Fill'),
                    h('button', {
                      className: 'btn-icon',
                      onClick: () => copyToClipboard(selectedItem.websiteUrl)
                    }, 'Copy')
                  )
                )
              ),
              h('div', { className: 'detail-field' },
                h('label', null, 'Tags'),
                (selectedItem.tags && selectedItem.tags.length > 0)
                  ? h('div', { className: 'detail-tags' },
                      selectedItem.tags.map(tag => h('span', { key: tag, className: 'tag', onClick: () => handleTagClick(tag) }, tag))
                    )
                  : h('span', { className: 'no-tags' }, 'No tags')
              )
            ),
            h('div', { className: 'detail-actions' },
              h('button', { className: 'btn-delete', onClick: () => { handleDelete(selectedItem.id); setSelectedItems(new Set()); } }, 'Delete')
            )
          )
        )
      ) : (selectedItems && selectedItems.size > 1) ? (
        // Multi-select state
        h('div', { className: 'detail-empty' },
          h('p', null, `${selectedItems.size} items selected`),
          h('p', { className: 'detail-empty-hint' }, 'Right-click to delete selected items'),
          h('p', { className: 'detail-empty-hint' }, 'Cmd+click to toggle selection')
        )
      ) : (
        // Empty state
        h('div', { className: 'detail-empty' },
          h('p', null, 'Select an item to view details'),
          h('p', { className: 'detail-empty-hint' }, 'or click + to add a new one')
        )
      )
    ),

    // Context Menu
    contextMenu && h('div', {
      className: 'context-menu',
      style: { left: contextMenu.x, top: contextMenu.y }
    },
      contextMenu.items.length === 1 && h('button', {
        className: 'context-menu-item',
        onClick: handleDuplicate
      }, 'Duplicate...'),
      h('button', {
        className: 'context-menu-item context-menu-item-danger',
        onClick: handleContextDelete
      }, contextMenu.items.length === 1 ? 'Delete' : `Delete ${contextMenu.items.length} items`)
    )
  );
}

const root = createRoot(document.getElementById('root'));
root.render(h(App));
