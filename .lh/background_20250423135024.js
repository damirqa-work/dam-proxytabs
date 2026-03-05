// Cleaned and improved version of background.js

// Global extension state
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

// ==================== INITIALIZATION ====================
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

async function loadSettings() {
  const data = await chrome.storage.sync.get(['isEnabled', 'proxySettings']);
  extensionState.isEnabled = data.isEnabled ?? false;
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
    const { host, port } = extensionState.proxySettings;

    if (!extensionState.isEnabled || !host || !port) {
      await chrome.proxy.settings.clear({});
      return;
    }

    if (!(await checkProxyAvailability())) {
      await setIconState('error');
      showProxyErrorNotification();
      return;
    }

    const pacScript = generatePacScript(extensionState.proxySettings);
    await chrome.proxy.settings.set({
      value: {
        mode: 'pac_script',
        pacScript: { data: pacScript }
      },
      scope: 'regular'
    });
  } catch (error) {
    console.error('[Background] Failed to update proxy settings:', error);
    await setIconState('error');
  }
}

function generatePacScript(settings) {
  const { host, port, domains = [], relatedDomains = {} } = settings;
  const normalizedDomains = domains.map(d => d.replace(/^www\./, '').toLowerCase());
  const normalizedRelated = {};

  for (const mainDomain in relatedDomains) {
    const cleanMain = mainDomain.replace(/^www\./, '').toLowerCase();
    normalizedRelated[cleanMain] = relatedDomains[mainDomain].map(d =>
      d.replace(/^www\./, '').toLowerCase()
    );
  }

  return `
    function FindProxyForURL(url, host) {
      const cleanHost = host.replace(/^www\./, '').toLowerCase();
      const mainDomain = cleanHost.split('.').slice(-2).join('.');

      if (${JSON.stringify(normalizedDomains)}.includes(mainDomain)) {
        return "PROXY ${host}:${port}";
      }

      const related = ${JSON.stringify(normalizedRelated)}[mainDomain];
      if (related && related.includes(cleanHost)) {
        return "PROXY ${host}:${port}";
      }

      return "DIRECT";
    }
  `;
}

// ==================== EVENT LISTENERS ====================
function setupTabListeners() {
  chrome.tabs.onActivated.addListener(async ({ tabId }) => {
    extensionState.activeTab = await chrome.tabs.get(tabId);
    await updateProxySettings();
    updateIconState();
    console
  });
}

function setupWebRequestListeners() {
  const filter = { urls: ['<all_urls>'] };
  chrome.webRequest.onSendHeaders.addListener(handleWebRequest, filter, ['requestHeaders']);
  chrome.webRequest.onResponseStarted.addListener(handleWebRequest, filter, ['responseHeaders']);
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
            sendResponse({ success: true, tab: extensionState.activeTab, isEnabled: extensionState.isEnabled });
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
  const cleanDomain = mainDomain.replace(/^www\./, '').toLowerCase();
  const trackedDomains = extensionState.proxySettings.domains.map(d => d.replace(/^www\./, '').toLowerCase());

  if (!trackedDomains.includes(cleanDomain)) return;

  extensionState.proxySettings.relatedDomains[mainDomain] = [];
  chrome.storage.sync.set({ proxySettings: extensionState.proxySettings });
  extensionState.trackedDomains.clear();
}

function handleWebRequest(details) {
  if (!extensionState.isEnabled) return; 
  if (!extensionState.activeTab) return;
  if (!extensionState.activeTab.url || !extensionState.activeTab.url==="" || !extensionState.activeTab.url.startsWith('chrome')) return;
  if (!details.url || !details.url.startsWith('http')) return;

  try {
    const requestUrl = new URL(details.url);
    if (requestUrl.protocol === 'chrome-extension:') return;
    const requestHost = requestUrl.hostname.replace(/^www\./, '').toLowerCase();
    const requestMainDomain = requestHost.split('.').slice(-2).join('.');

    const activeTabUrl = new URL(extensionState.activeTab.url);
    const activeMainDomain = activeTabUrl.hostname.replace(/^www\./, '').toLowerCase().split('.').slice(-2).join('.');
    const related = extensionState.proxySettings.relatedDomains[requestMainDomain];

    if (related) return;

    if (!extensionState.proxySettings.domains.some(domain => domain.replace(/^www\./, '').toLowerCase() === activeMainDomain)) return;

    if (extensionState.trackedDomains.size >= extensionState.MAX_TRACKED_DOMAINS) {
      const oldestKey = extensionState.trackedDomains.keys().next().value;
      extensionState.trackedDomains.delete(oldestKey);
    }

    extensionState.trackedDomains.set(requestHost, Date.now());

    if (!extensionState.proxySettings.relatedDomains[activeMainDomain]) {
      extensionState.proxySettings.relatedDomains[activeMainDomain] = [];
    }

    if (!extensionState.proxySettings.relatedDomains[activeMainDomain].includes(requestMainDomain)) {
      extensionState.proxySettings.relatedDomains[activeMainDomain].push(requestMainDomain);
      chrome.runtime.sendMessage({
        type: 'relatedDomainsUpdate',
        data: {
          mainDomain: activeMainDomain,
          domains: extensionState.proxySettings.relatedDomains[activeMainDomain]
        }
      });
    }
  } catch (error) {
    console.error('[Background] Web request handler error:', error, details);
  }
}


// ==================== UTILITY FUNCTIONS ====================
async function checkProxyAvailability() {
  const { host, port, secure } = extensionState.proxySettings;
  if (!host || !port) return false;

  try {
    const url = `http${secure ? 's' : ''}://${host}:${port}`;
    await fetch(url, {
      method: 'HEAD',
      mode: 'no-cors',
      signal: AbortSignal.timeout(4000)
    });
    return true;
  } catch (error) {
    if (error.name !== 'AbortError') {
      console.error('[Background] Proxy check failed:', error);
    }
    return false;
  }
}

async function updateIconState() {
  try {
    if (!extensionState.activeTab?.url) {
      await setIconState('disabled');
      return;
    }

    const url = new URL(extensionState.activeTab.url);
    const hostname = url.hostname.replace('www.', '');
    const mainDomain = hostname.split('.').slice(-2).join('.');

    if (!extensionState.isEnabled || !extensionState.proxySettings.domains.length) {
      await setIconState('disabled');
    } else if (
      extensionState.proxySettings.domains.includes(mainDomain) ||
      extensionState.proxySettings.relatedDomains[mainDomain]?.length
    ) {
      await setIconState('active');
    } else {
      await setIconState('default');
    }
  } catch (error) {
    console.error('[Background] Icon update error:', error);
    await setIconState('default');
  }
}

async function setIconState(state) {
  const icons = {
    default: { path: 'icons/icon-blue16.png' },
    active: { path: 'icons/icon-a.png' },
    disabled: { path: 'icons/icon-dis.png' },
    error: { path: 'icons/icon-error.png' }
  };
  await chrome.action.setIcon(icons[state]);
}

function showProxyErrorNotification() {
  chrome.notifications.create('proxy-error', {
    type: 'basic',
    iconUrl: 'icons/icon-error.png',
    title: 'Proxy Error',
    message: `Cannot connect to ${extensionState.proxySettings.host}:${extensionState.proxySettings.port}`
  });
}

if (chrome.runtime?.id) {
  initializeExtension().catch(console.error);
}
