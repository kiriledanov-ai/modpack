(() => {
  const send = () => {
    chrome.storage.sync.get({ serverUrl: '', manualHandle: '' }, settings => {
      window.postMessage({ source: 'lunacy-extension', type: 'config', ...settings }, location.origin);
    });
  };
  send();
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && (changes.serverUrl || changes.manualHandle)) send();
  });
})();
