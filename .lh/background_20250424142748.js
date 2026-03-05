// Global extension state
const extensionState = {
  isEnabled: false,
  proxySettings: {
    host: '',
    port: 8080,
    secure: false,
    domains: []
  },
  activeTab: null,
  trackedDomains: new Map(),
  MAX_TRACKED_DOMAINS: 300
};
const unknownDomainsLogged = new Set();

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
    console.log(pacScript);
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
  const { host, port, domains = [] } = settings;
  const normalizedDomains = domains.map(d => d.replace(/^www\./, '').toLowerCase());

  return `
    function dnsDomainIs(host, domain) {
      return host === domain || host.endsWith('.' + domain);
    }

    function FindProxyForURL(url, host) {
      var mainDomain = host.split('.').slice(-2).join('.').toLowerCase();

      var allowed = ${JSON.stringify(normalizedDomains)};

      for (var i = 0; i < allowed.length; i++) {
        if (dnsDomainIs(host, allowed[i])) {
          return "PROXY ${host}:${port}";
        }
      }

      return "DIRECT";
    }
  `;
}

// ==================== EVENT LISTENERS ====================
function setupTabListeners() {
  chrome.tabs.onActivated.addListener(async ({ tabId }) => {
    extensionState.activeTab = await chrome.tabs.get(tabId);
    updateIconState();
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

// ==================== WEB REQUEST HANDLING ====================
function handleWebRequest(details) {
  if (!extensionState.isEnabled || !extensionState.activeTab) return;

  try {
    const requestUrl = new URL(details.url);
    if (requestUrl.protocol === 'chrome-extension:') return;

    const requestHost = requestUrl.hostname.replace(/^www\./, '').toLowerCase();
    const requestMainDomain = requestHost.split('.').slice(-2).join('.');

    const activeTabUrl = new URL(extensionState.activeTab.url);
    const activeMainDomain = activeTabUrl.hostname.replace(/^www\./, '').toLowerCase().split('.').slice(-2).join('.');

    // If the active tab domain is not in the list of allowed domains, return
    if (!extensionState.proxySettings.domains.includes(activeMainDomain)) return;

    // Otherwise, apply proxy to all requests from this tab
    return { requestHeaders: details.requestHeaders };
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
    } else if (extensionState.proxySettings.domains.includes(mainDomain)) {
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
