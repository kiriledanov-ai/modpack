const serverUrl = document.querySelector('#serverUrl');
const manualHandle = document.querySelector('#manualHandle');
const status = document.querySelector('#status');

chrome.storage.sync.get({ serverUrl: 'https://modpackcleva.onrender.com', manualHandle: '' }, value => {
  serverUrl.value = value.serverUrl;
  manualHandle.value = value.manualHandle;
});

document.querySelector('#save').addEventListener('click', async () => {
  let url = serverUrl.value.trim().replace(/\/+$/, '');
  const handle = manualHandle.value.trim().replace(/^@+/, '');
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error();
  } catch {
    status.textContent = 'Нужен корректный http(s) адрес';
    return;
  }
  if (handle && !/^[a-zA-Z0-9_-]{2,40}$/.test(handle)) {
    status.textContent = 'Некорректный @handle';
    return;
  }
  await chrome.storage.sync.set({ serverUrl: url, manualHandle: handle });
  status.textContent = 'Сохранено. Обновите mope.io.';
});