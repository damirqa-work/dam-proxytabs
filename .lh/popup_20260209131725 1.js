// Глобальное состояние расширения
const extensionState = {
  isEnabled: false,
  proxySettings: {
    host: '',
    port: 8080,
    secure: false,
    domains: [],
    relatedDomains: {}
  },
  activeTab: null,
  trackedDomains: new Map(),
  MAX_TRACKED_DOMAINS: 300
};

// ==================== ИНИЦИАЛИЗАЦИЯ ====================
chrome.runtime.onInstalled.addListener(initializeExtension);
chrome.runtime.onStartup.addListener(initializeExtension);

async function initializeExtension() {
  console.log('[Background] Initializing extension...');
  try {
    await loadSettings();
    setupTabListeners();
    setupWebRequestListeners();
    setupMessageHandlers();
    await updateProxySettings();
    await updateIconState();
    console.log('[Background] Extension initialized');
  } catch (error) {
    console.error('[Background] Initialization failed:', error);
  }
}

// ==================== ОСНОВНЫЕ ФУНКЦИИ ====================
async function loadSettings() {
  const data = await chrome.storage.sync.get(['isEnabled', 'proxySettings']);
  extensionState.isEnabled = data.isEnabled || false;
  extensionState.proxySettings = {
    host: '127.0.0.1',
    port: 8080,
    secure: false,
    domains: [],
    relatedDomains: {},
    ...data.proxySettings
  };
}

async function updateProxySettings() {
  try {
    if (!extensionState.isEnabled || !extensionState.proxySettings.host || !extensionState.proxySettings.port) {
      await chrome.proxy.settings.clear({});
      return;
    }

    const isAlive = await checkProxyAvailability();
    if (!isAlive) {
      await setIconState('error');
      showProxyErrorNotification();
      return;
    }

    const pacScript = generatePacScript(extensionState.proxySettings);
    console.log(":PAC: ",pacScript);
    await chrome.proxy.settings.set({
      value: {
        mode: "pac_script",
        pacScript: {
          data: pacScript
        }
      },
      scope: "regular"
    });
  } catch (error) {
    console.error('[Background] Failed to update proxy settings:', error);
    await setIconState('error');
  }
}

function generatePacScript(settings) {
  const { host, port, domains = [], relatedDomains = {} } = settings;
  
  // return `
  //   function FindProxyForURL(url, host) {
  //     const mainDomains = ${JSON.stringify(domains)};
  //     const relatedDomains = ${JSON.stringify(relatedDomains)};

  //     for (const i = 0; i < mainDomains.length; i++) {
  //       const domain = mainDomains[i];
  //       if (host === domain || host.endsWith('.' + domain)) {
  //         return "PROXY ${host}:${port}";
  //       }
  //     }

  //     const domainParts = host.split('.');
  //     const mainDomain = domainParts.slice(-2).join('.');
      
  //     if (relatedDomains[mainDomain]) {
  //       for (const i = 0; i < relatedDomains[mainDomain].length; i++) {
  //         const relatedDomain = relatedDomains[mainDomain][i];
  //         if (host === relatedDomain || host.endsWith('.' + relatedDomain)) {
  //           return "PROXY ${host}:${port}";
  //         }
  //       }
  //     }

  //     return "DIRECT";
  //   }
  // `;
  return `
  function FindProxyForURL(url, host) {
    const mainDomains = ${JSON.stringify(settings.domains || [])};
    const relatedDomains = ${JSON.stringify(settings.relatedDomains || {})};
    
    // Точное сравнение доменов
    function isMatch(currentHost, targetDomain) {
      return currentHost === targetDomain || 
        currentHost.endsWith('.' + targetDomain);
    }

    // Проверка основных доменов
    for (const domain of mainDomains) {
      if (isMatch(host, domain)) return "PROXY ${settings.host}:${settings.port}";
    }
    
    // Проверка связанных доменов
    const currentMainDomain = host.split('.').slice(-2).join('.');
    if (relatedDomains[currentMainDomain]) {
      for (const domain of relatedDomains[currentMainDomain]) {
        if (isMatch(host, domain)) return "PROXY ${settings.host}:${settings.port}";
      }
    }
    
    return "DIRECT";
  }
`;
}

// ==================== ОБРАБОТЧИКИ СОБЫТИЙ ====================
function setupTabListeners() {
  chrome.tabs.onActivated.addListener(async activeInfo => {
    extensionState.activeTab = await chrome.tabs.get(activeInfo.tabId);
    updateIconState();
  });

  // chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  //   if (tabId === extensionState.activeTab?.id && changeInfo.url) {
  //     extensionState.activeTab.url = changeInfo.url;
  //     updateIconState();
  //   }
  // });
}

function setupWebRequestListeners() {
  chrome.webRequest.onSendHeaders.addListener(
    handleWebRequest,
    { urls: ["<all_urls>"] },
    ["requestHeaders"]
  );
  chrome.webRequest.onResponseStarted.addListener(
    handleWebRequest,
    { urls: ["<all_urls>"] },
    ["responseHeaders"]
  );
}

function setupMessageHandlers() {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    (async () => {
      try {
        switch (message.action) {
          case 'toggle':
            extensionState.isEnabled = message.enabled ?? !extensionState.isEnabled;
            await chrome.storage.sync.set({ isEnabled: extensionState.isEnabled });
            await updateProxySettings();
            sendResponse({ success: true, isEnabled: extensionState.isEnabled });
            break;
          case 'updateProxy':
            await updateProxySettings();
            sendResponse({ success: true });
            break;
          case 'checkProxy':
            const isAlive = await checkProxyAvailability();
            sendResponse({ success: true, isAlive });
            break;
          case 'getTabInfo':
            sendResponse({ 
              success: true, 
              tab: extensionState.activeTab,
              isEnabled: extensionState.isEnabled
            });
            break;
          case 'startTracking':
            startTracking(message.tabId, message.mainDomain);
            sendResponse({ success: true });
            break;
          default:
            sendResponse({ success: false, error: 'Unknown action' });
        }
      } catch (error) {
        console.error('[Background] Message handler error:', error);
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true;
  });
}

function startTracking(tabId, mainDomain) {
  // Normalize the domain (remove www. and make lowercase for comparison)
  const normalizedDomain = mainDomain.replace(/^www\./, '').toLowerCase();
  const normalizedProxyDomains = extensionState.proxySettings.domains.map(d => 
    d.replace(/^www\./, '').toLowerCase()
  );

  console.log(`[Background] startTracking: ${normalizedProxyDomains}`);

  if (!normalizedProxyDomains.includes(normalizedDomain)) {
    console.log(`[Background] Not tracking - domain ${mainDomain} not in proxy list. Current proxy domains:`, 
      extensionState.proxySettings.domains);
    return;
  }

  console.log(`[Background] Starting tracking for domain: ${mainDomain}`);
  
  // Clear existing tracked domains for this main domain
  extensionState.proxySettings.relatedDomains[mainDomain] = [];
  chrome.storage.sync.set({ proxySettings: extensionState.proxySettings });

  // Reset tracked domains map for this tab
  extensionState.trackedDomains.clear();
}

function handleWebRequest(details) {
  if (!extensionState.isEnabled) return;
  
  try {
    const url = new URL(details.url);
    const hostname = url.hostname.replace(/^www\./, '');
    //const mainDomain = hostname.split('.').slice(-2).join('.');
    if (!hostname) return null;
    
    const actTab = extensionState.activeTab.url;
    const parts = actTab.split('.');
    const mainDomain = parts.length >= 2 ? parts.slice(-2).join('.') : hostname;
    

    if (!details.initiator) return;
    
    const initiator = details.initiator.replace(/^www\./,'').split('.').slice(-2).join('.');
    console.log(`[Background] for INITIATOR: ${initiator}`);

    if (!extensionState.proxySettings.domains.includes(initiator)) {
      return;
    }
  
    console.log(`[Background] for url: ${url}`);
    //console.log(`[Background] for relateddomain: ${extensionState.proxySettings.relatedDomains[mainDomain]}`);

                           // Track ALL requested domains (including third-party)
    const requestedDomain = new URL(details.url).hostname.split('.').slice(-2).join('.');
    if (!extensionState.trackedDomains.has(requestedDomain)) {
      // Clean up old entries if limit reached
      if (extensionState.trackedDomains.size >= extensionState.MAX_TRACKED_DOMAINS) {
        const oldestKey = extensionState.trackedDomains.keys().next().value;
        extensionState.trackedDomains.delete(oldestKey);
      }

      extensionState.trackedDomains.set(requestedDomain, Date.now());

      // Update related domains in storage
      if (!extensionState.proxySettings.relatedDomains[initiator]) {
        extensionState.proxySettings.relatedDomains[initiator] = [];
      }

      if (!exten