document.addEventListener('DOMContentLoaded', init);

const state = {
  proxySettings: {
    host: '',
    port: '',
    domains: []
  }
};

async function init() {
  await loadSettings();
  renderDomains();
  setupListeners();
}

/* ---------- STORAGE ---------- */

async function loadSettings() {
  const result = await chrome.storage.sync.get('proxySettings');

  state.proxySettings = result.proxySettings || {
    host: '',
    port: '',
    domains: []
  };

  const hostInput = document.getElementById('proxyHost');
  const portInput = document.getElementById('proxyPort');

  if (hostInput) hostInput.value = state.proxySettings.host || '';
  if (portInput) portInput.value = state.proxySettings.port || '';
}

async function saveSettings() {
  await chrome.storage.sync.set({
    proxySettings: state.proxySettings
  });

  chrome.runtime.sendMessage({ action: 'updateProxy' });
}

/* ---------- EVENTS ---------- */

function setupListeners() {

  const hostInput = document.getElementById('proxyHost');
  const portInput = document.getElementById('proxyPort');
  const addBtn = document.getElementById('addDomainBtn');
  const domainInput = document.getElementById('domainInput');

  if (hostInput) {
    hostInput.addEventListener('input', debounce(() => {
      state.proxySettings.host = hostInput.value.trim();
      saveSettings();
    }, 400));
  }

  if (portInput) {
    portInput.addEventListener('input', debounce(() => {
      state.proxySettings.port = portInput.value.trim();
      saveSettings();
    }, 400));
  }

  if (addBtn) {
    addBtn.addEventListener('click', addDomain);
  }

  if (domainInput) {
    domainInput.addEventListener('keypress', e => {
      if (e.key === 'Enter') addDomain();
    });
  }

}

/* ---------- DOM ---------- */

function renderDomains() {

  const list = document.getElementById('domainsList');
  if (!list) return;

  list.innerHTML = '';

  if (!state.proxySettings.domains.length) {

    const empty = document.createElement('li');
    empty.textContent = 'No domains';
    empty.className = 'empty';

    list.appendChild(empty);
    return;
  }

  state.proxySettings.domains.forEach(domain => {

    const li = document.createElement('li');

    const label = document.createElement('span');
    label.textContent = domain;

    const removeBtn = document.createElement('button');
    removeBtn.textContent = '✕';
    removeBtn.className = 'remove-btn';

    removeBtn.addEventListener('click', () => removeDomain(domain));

    li.append(label, removeBtn);
    list.appendChild(li);

  });

}

/* ---------- DOMAIN LOGIC ---------- */

function addDomain() {

  const input = document.getElementById('domainInput');
  if (!input) return;

  const domain = input.value.trim().toLowerCase();

  if (!domain) return;

  if (state.proxySettings.domains.includes(domain)) {
    input.value = '';
    return;
  }

  state.proxySettings.domains.push(domain);
  input.value = '';

  renderDomains();
  saveSettings();
}

function removeDomain(domain) {

  state.proxySettings.domains =
    state.proxySettings.domains.filter(d => d !== domain);

  renderDomains();
  saveSettings();
}

/* ---------- UTILS ---------- */

function debounce(fn, delay) {

  let timer;

  return function () {

    clearTimeout(timer);

    timer = setTimeout(() => {
      fn.apply(this, arguments);
    }, delay);

  };

}
