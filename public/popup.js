/* RouteCraft toolbar popup. Plain JS so it works without a content-script
 * build step and stays fast enough to open from the toolbar. */
(function () {
  'use strict';

  var target = document.getElementById('target');
  var homeButton = document.getElementById('open-app');
  var currentSection = document.getElementById('current');
  var currentButton = document.getElementById('open-current');
  var currentOrigin = document.getElementById('current-origin');
  var recentSection = document.getElementById('recent');
  var recentList = document.getElementById('recent-list');
  var errorBox = document.getElementById('error');

  function send(message) {
    return new Promise(function (resolve) {
      try {
        chrome.runtime.sendMessage(message, function (response) {
          if (chrome.runtime.lastError) {
            resolve({ ok: false, error: chrome.runtime.lastError.message });
            return;
          }
          resolve(response || { ok: false, error: 'The extension did not respond.' });
        });
      } catch (error) {
        resolve({ ok: false, error: error && error.message ? error.message : 'The extension is unavailable.' });
      }
    });
  }

  function showError(message) {
    if (!message) return;
    errorBox.textContent = message;
    errorBox.hidden = false;
  }

  function closeSoon() {
    window.setTimeout(function () {
      window.close();
    }, 40);
  }

  async function openHome() {
    errorBox.hidden = true;
    var result = await send({ type: 'OPEN_APP' });
    if (!result || !result.ok) {
      showError((result && result.error) || 'Could not open RouteCraft.');
      return;
    }
    closeSoon();
  }

  async function openInput(input) {
    var value = String(input || '').trim();
    if (!value) {
      target.focus();
      return;
    }
    errorBox.hidden = true;
    var result = await send({
      type: 'OPEN_INPUT',
      input: value,
      disposition: 'newForegroundTab',
    });
    if (!result || !result.ok) {
      showError((result && result.error) || 'Could not open RouteCraft.');
      return;
    }
    closeSoon();
  }

  function renderCurrent(tab) {
    if (!tab || !tab.url || !/^https?:/i.test(tab.url)) return;
    var parsed;
    try {
      parsed = new URL(tab.url);
    } catch (error) {
      return;
    }
    currentOrigin.textContent = parsed.origin;
    currentButton.title = 'Open ' + parsed.origin + ' in RouteCraft';
    currentButton.addEventListener('click', function () {
      openInput(tab.url);
    });
    currentSection.hidden = false;
  }

  function loadCurrentTab() {
    try {
      chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
        if (chrome.runtime.lastError) return;
        renderCurrent(tabs && tabs[0]);
      });
    } catch (error) {
      /* popup still works without tab context */
    }
  }

  function renderRecent() {
    var raw;
    try {
      raw = localStorage.getItem('routecraft.recent') || localStorage.getItem('oneswagger.recent');
    } catch (error) {
      return;
    }
    if (!raw) return;
    var items;
    try {
      items = JSON.parse(raw);
    } catch (error) {
      return;
    }
    if (!Array.isArray(items)) return;
    var visible = items
      .filter(function (item) {
        return item && typeof item.url === 'string' && item.url;
      })
      .slice(0, 3);
    if (visible.length === 0) return;

    visible.forEach(function (item) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'recent-item';

      var title = document.createElement('span');
      title.className = 'recent-title';
      title.textContent = item.title || item.url;

      var url = document.createElement('span');
      url.className = 'recent-url';
      url.textContent = item.url;

      button.appendChild(title);
      button.appendChild(url);
      button.addEventListener('click', function () {
        openInput(item.url);
      });
      recentList.appendChild(button);
    });
    recentSection.hidden = false;
  }

  homeButton.addEventListener('click', openHome);

  document.getElementById('quick-open').addEventListener('submit', function (event) {
    event.preventDefault();
    openInput(target.value);
  });

  loadCurrentTab();
  renderRecent();
  target.focus();
})();
