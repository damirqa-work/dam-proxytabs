document.addEventListener('DOMContentLoaded', () => {
  const state = {
    isEnabled: false,
    proxySettings: {
      host: '',
      port: '',
      domains: []
    },
    currentTab: null
  };

  const elements = {
    toggleBtn: document.getElementById('toggleBtn'),
    statusText: document.getElementById('statusText'),
    statusIndicator: document.getElementById('statusIndicator'),
    proxyInfo: document.getElementById('proxyInfo'),
    domainsList: document.getElementById('domainsList'),
    domainsCount: document.getElementById('domainsCount'),
    relatedDomainsCount: document.getElementById('relatedDomainsCount'),
    addCurrentBtn: document.getElementById('addCurrentBtn'),
    settingsBtn: document.getElementById('settingsBtn'),
    bugsBtn: document.getElementById('bugsBtn')
  };

  async function init() {
    try {
      await loadProxySettings();
      await getCurrentTabInfo();
      setupEventListeners();
      updateUI();
      await loadUnproxiedDomains();
      setupUnproxiedToggle();
    } catch (error) {
      console.error('Popup init error:', error);
      showMessage('Initialization failed', false);
    }
  }

  async function loadProxySettings() {
    const result = await chrome.storage.sync.get(['isEnabled', 'proxySettings']);
    state.isEnabled = result.isEnabled ?? false;
    state.proxySettings = result.proxySettings || { host: '', port: '', domains: [] };
  }

  async function getCurrentTabInfo() {
    const response = await chrome.runtime.sendMessage({ action: 'getTabInfo' });
    if (response?.success && response.tab) {
      state.currentTab = response.tab;
    } else {
      throw new Error('Failed to get tab info');
    }
  }

  function updateUI() {
    updateToggleState();
    updateProxyInfo();
    //renderDomainsList();
  }

  function updateToggleState() {
    elements.domainsCount.textContent = state.proxySettings.domains.length;
    elements.toggleBtn.checked = state.isEnabled;
    elements.statusText.textContent = state.isEnabled ? 'Enabled' : 'Disabled';
    elements.statusIndicator.style.backgroundColor = state.isEnabled ? '#34a853' : '#ea4335';
  }

  function updateProxyInfo() {
    elements.proxyInfo.textContent = state.proxySettings.host
      ? `${state.proxySettings.host}:${state.proxySettings.port}`
      : 'Not configured';
  }

  function setupEventListeners() {
    elements.toggleBtn.addEventListener('change', handleToggle);
    elements.addCurrentBtn.addEventListener('click', addCurrentDomain);
    elements.settingsBtn.addEventListener('click', () => chrome.runtime.openOptionsPage());
    elements.bugsBtn.addEventListener('click', () => chrome.tabs.create({ url: 'https://github.com/damirqa-work/damproxytabs/issues/' }));
    elements.bugsBtn.addEventListener('click', () => chrome.tabs.create({ url: 'https://github.com/damirqa-work/damproxytabs/issues/' }));
    chrome.storage.onChanged.addListener(handleStorageChange);
  }

  async function handleToggle() {
    const newState = elements.toggleBtn.checked;
    try {
      const response = await chrome.runtime.sendMessage({ action: 'toggle', enabled: newState });
      if (response.success) {
        state.isEnabled = response.isEnabled;
        updateToggleState();
      }
    } catch (error) {
      console.error('Toggle failed:', error);
      elements.toggleBtn.checked = !newState;
      showMessage('Failed to toggle proxy', false);
    }
  }

  async function addCurrentDomain() {
    if (!state.currentTab?.url) return showMessage("Can't get current tab URL", false);
    const domain = extractMainDomain(new URL(state.currentTab.url).hostname);
    if (!domain) return showMessage('Invalid domain', false);
    if (state.proxySettings.domains.includes(domain)) return showMessage('Domain already added', false);

    state.proxySettings.domains.push(domain);
    await chrome.storage.sync.set({ proxySettings: state.proxySettings });
    await chrome.runtime.sendMessage({ action: 'updateProxy' });
    //renderDomainsList();
    elements.domainsCount.textContent = state.proxySettings.domains.length;
    showMessage(`Added domain: ${domain}`, true);
  }

  function extractMainDomain(hostname) {
    const parts = hostname.replace(/^www\./, '').split('.');
    return parts.length > 1 ? parts.slice(-2).join('.') : hostname;
  }

  function handleStorageChange(changes, namespace) {
    if (namespace === 'local' && changes.unproxiedDomains) {
      const domain = state.currentTabDomain;
      const updatedDomains = changes.unproxiedDomains.newValue?.[domain] || [];
      state.unproxiedDomains = updatedDomains;
      renderUnproxiedDomains();
    }
  }
  

  function showMessage(text, isSuccess) {
    const msg = document.createElement('div');
    msg.className = `popup-message ${isSuccess ? 'success' : 'error'}`;
    msg.textContent = text;
    document.body.appendChild(msg);
    setTimeout(() => {
      msg.classList.add('fade-out');
      setTimeout(() => msg.remove(), 300);
    }, 3000);
  }

  async function loadUnproxiedDomains() {
    const result = await chrome.storage.local.get(['unproxiedDomains']);
    const unproxied = result.unproxiedDomains || [];
    renderUnproxiedList(unproxied);
  }
  
  function renderUnproxiedList(domains) {
    const list = document.getElementById('unproxiedList');
    const count = document.getElementById('unproxiedCount');
    list.innerHTML = '';
    count.textContent = domains.length;
  
    if (!domains.length) {
      list.innerHTML = '<li class="empty">No domains</li>';
      return;
    }
    
    domains.forEach((name) => {
      const li = document.createElement('li');
      li.className = 'unproxied-item';
      li.title = `Detected at: ${new Date().toLocaleString()}`;
  
      const label = document.createElement('span');
      label.textContent = name;
  
      const btns = document.createElement('div');
      btns.className = 'unproxied-buttons';
  
      const addBtn = document.createElement('button');
      addBtn.className = 'add-btn';
      addBtn.textContent = '+';
      addBtn.title = 'Add to proxy list';
      addBtn.onclick = () => addToProxy(name);
  
      const removeBtn = document.createElement('button');
      removeBtn.className = 'remove-btn';
      removeBtn.textContent = '✕';
      removeBtn.title = 'Remove from this list';
      removeBtn.onclick = () => removeFromUnproxied(name);
  
      if (state.proxySettings.domains.some(d => d.name === name || d === name)) {
        addBtn.style.display = 'none';
      }
  
      btns.append(addBtn, removeBtn);
      li.append(label, btns);
      list.appendChild(li);
    });
  }
  
  function setupUnproxiedToggle() {
    const toggle = document.getElementById('unproxiedToggle');
    const list = document.getElementById('unproxiedList');
    const chevron = toggle.querySelector('.chevron');
  
    toggle.addEventListener('click', () => {
      list.style.display = list.style.display === 'none' ? 'block' : 'none';
      chevron.innerHTML = list.style.display === 'none' ? '&#9660;' : '&#9650;';
    });
  }
  
  async function addToProxy(domain) {
    if (!state.proxySettings.domains.some(d => d.name === domain || d === domain)) {
      state.proxySettings.domains.push(domain);
      await chrome.storage.sync.set({ proxySettings: state.proxySettings });
      await chrome.runtime.sendMessage({ action: 'updateProxy' });
      showMessage(`Added ${domain}`, true);
      loadUnproxiedDomains();
    }
  }
  
  async function removeFromUnproxied(domain) {
    const result = await chrome.storage.local.get(['unproxiedDomains']);
    const domains = result.unproxiedDomains || [];
    const updated = domains.filter(d => d !== domain);
    await chrome.storage.local.set({ unproxiedDomains: updated });
    renderUnproxiedList(updated);
    showMessage(`Removed ${domain}`, true);
  }


  init();
});
