document.addEventListener('DOMContentLoaded', async () => {
  // DOM элементы
  const elements = {
    proxyHost: document.getElementById('proxyHost'),
    proxyPort: document.getElementById('proxyPort'),
    domainInput: document.getElementById('domainInput'),
    addDomainBtn: document.getElementById('addDomainBtn'),
    domainsList: document.getElementById('domainsList'),
    saveBtn: document.getElementById('saveBtn'),
    statusMessage: document.getElementById('statusMessage'),
    proxyStatus: document.getElementById('proxyStatus'),
    proxyStatusText: document.getElementById('proxyStatusText'),
    toggleRelatedBtn: document.getElementById('toggleRelatedBtn'),
    relatedDomainsList: document.getElementById('relatedDomainsList')
  };

  let domains = [];
  let proxySettings = {};


  async function init() {
    await loadSettings();
    setupEventListeners();
    checkProxyStatus();
    setInterval(checkProxyStatus, 30000);
  }

  async function loadSettings() {
    const data = await chrome.storage.sync.get(['proxySettings']);
    proxySettings = data.proxySettings || {};
    
    elements.proxyHost.value = proxySettings.host || '';
    elements.proxyPort.value = proxySettings.port || '';
    domains = proxySettings.domains || [];
    
    renderDomainsList();
    renderAllRelatedDomains();
  }

  async function checkProxyStatus() {
    elements.proxyStatus.className = 'status-indicator checking';
    elements.proxyStatusText.textContent = 'Checking proxy status...';
    
    try {
      const isAlive = await chrome.runtime.sendMessage({ action: "checkProxy" });
      const status = isAlive ? 'connected' : 'disconnected';
      const message = isAlive 
        ? `Connected to ${proxySettings.host}:${proxySettings.port}`
        : 'Proxy server not responding';
      
      elements.proxyStatus.className = `status-indicator ${status}`;
      elements.proxyStatusText.textContent = message;
    } catch (error) {
      console.error('Proxy check error:', error);
    }
  }


  function renderDomainsList() {
    elements.domainsList.innerHTML = domains.map(domain => `
      <li>
        ${domain}
        <button class="delete-domain" data-domain="${domain}">×</button>
      </li>
    `).join('');
  }


  async function renderAllRelatedDomains() {
    const related = proxySettings.relatedDomains || {};
    return 
    elements.relatedDomainsList.innerHTML = Object.entries(related)
      .map(([mainDomain, domains]) => `
        <div class="related-domain-group">
          <h4>${mainDomain}</h4>
          ${domains.map(domain => `
            <div class="related-domain-item">
              <span>${domain}</span>
              <button class="delete-related-btn" 
                      data-main="${mainDomain}" 
                      data-domain="${domain}">×</button>
            </div>
          `).join('')}
        </div>
      `).join('');

    // Обработчики удаления
    elements.relatedDomainsList.querySelectorAll('.delete-related-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const { main, domain } = btn.dataset;
        if (!proxySettings.relatedDomains?.[main]) return;
        
        proxySettings.relatedDomains[main] = proxySettings.relatedDomains[main]
          .filter(d => d !== domain);
        
        if (proxySettings.relatedDomains[main].length === 0) {
          delete proxySettings.relatedDomains[main];
        }
        
        await chrome.storage.sync.set({ proxySettings });
        await renderAllRelatedDomains();
        chrome.runtime.sendMessage({ action: "updateProxy" });
      });
    });
  }

  // Валидация домена
  function isValidDomain(domain) {
    return /^([a-z0-9-]+\.)+[a-z]{2,}$/i.test(domain);
  }

  // Показать сообщение
  function showMessage(text, type) {
    elements.statusMessage.textContent = text;
    elements.statusMessage.className = type;
    elements.statusMessage.style.display = 'block';
    
    setTimeout(() => {
      elements.statusMessage.style.display = 'none';
    }, 3000);
  }


  function setupEventListeners() {
    elements.toggleRelatedBtn.addEventListener('click', () => {
      elements.relatedDomainsList.classList.toggle('expanded');
      elements.toggleRelatedBtn.textContent = 
        elements.relatedDomainsList.classList.contains('expanded') ? '▲' : '▼';
    });

    elements.addDomainBtn.addEventListener('click', () => {
      const domain = elements.domainInput.value.trim().toLowerCase();
      
      if (!domain) return;
      if (!isValidDomain(domain)) {
        showMessage('Invalid domain format', 'error');
        return;
      }
      if (domains.includes(domain)) {
        showMessage('Domain already exists', 'error');
        return;
      }
      
      domains.push(domain);
      renderDomainsList();
      elements.domainInput.value = '';
      elements.domainInput.focus();
    });

    elements.domainsList.addEventListener('click', (e) => {
      if (e.target.classList.contains('delete-domain')) {
        domains = domains.filter(d => d !== e.target.dataset.domain);
        renderDomainsList();
      }
    });


    elements.saveBtn.addEventListener('click', async () => {
      const host = elements.proxyHost.value.trim();
      const port = parseInt(elements.proxyPort.value);
      
      if (!host || !port || port < 1 || port > 65535) {
        showMessage('Please enter valid host and port', 'error');
        return;
      }
      
      showMessage('Checking proxy server...', 'info');
      
      try {
        const controller = new AbortController();
        setTimeout(() => controller.abort(), 3000);
        
        await fetch(`http://${host}:${port}`, {
          method: 'HEAD',
          mode: 'no-cors',
          signal: controller.signal
        });

        
        const newSettings = { 
          host, 
          port, 
          domains: [...domains],
          relatedDomains: proxySettings.relatedDomains || {}
        };
        
        await chrome.storage.sync.set({ proxySettings: newSettings });
        proxySettings = newSettings;
        
        showMessage('Settings saved! Proxy is working', 'success');
        chrome.runtime.sendMessage({ action: "updateProxy" });
      } catch (error) {
        const newSettings = { 
          host, 
          port, 
          domains: [...domains],
          relatedDomains: {} 
        };
        
        await chrome.storage.sync.set({ proxySettings: newSettings });
        proxySettings = newSettings;
        
        showMessage('Settings saved but proxy is not responding', 'error');
        console.error("Proxy check failed:", error);
      }
      
      await renderAllRelatedDomains();
      await checkProxyStatus();
    });
  }

  // Запуск приложения
  init();
});