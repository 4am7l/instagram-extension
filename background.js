importScripts("media-url.js");

/**
 * InstaKit Background Service Worker (Manifest V3)
 * Handles media downloads, staggered sequential batch downloads,
 * CORS-free binary fetching for ZIP archives, and download history.
 */

const DEFAULT_SETTINGS = {
  lang: 'ar',
  theme: 'auto',
  batchMode: 'ask',
  enablePostDownload: true,
  enableReelDownload: true,
  enablePhotoDownload: true,
  enableStoryDownload: true,
  enablePfpDownload: true,
  enableBioActions: true,
  enableCopyUsername: true,
  filenamePattern: '{username}_{type}_{id}',
};

chrome.runtime.onInstalled.addListener(async () => {
  const existing = await chrome.storage.sync.get(null);
  if (!existing || Object.keys(existing).length === 0) {
    await chrome.storage.sync.set(DEFAULT_SETTINGS);
  }

  chrome.contextMenus.removeAll(() => {
    void chrome.runtime.lastError;
    chrome.contextMenus.create(
      {
        id: 'instakit-download-media',
        title: 'Download with InstaKit',
        contexts: ['image', 'video'],
        documentUrlPatterns: ['*://*.instagram.com/*'],
      },
      () => {
        void chrome.runtime.lastError;
      }
    );
  });
});

chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId === 'instakit-download-media') {
    const isVideo = info.mediaType === 'video';
    const media = isVideo ? getDownloadableVideo(info.srcUrl) : getDownloadableImage(info.srcUrl);
    if (!media) return;
    const ext = media.extension;
    const filename = sanitizeFilename(
      `instagram_${isVideo ? 'video' : 'photo'}_${Date.now()}.${ext}`
    );
    triggerDownload(media.url, filename, {
      type: isVideo ? 'reel' : 'photo',
      username: 'instagram',
    }).catch(() => {});
  }
});

function sanitizeFilename(name) {
  return name.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').replace(/_{2,}/g, '_');
}

function buildFilename({
  username = 'instagram',
  type = 'media',
  id = '',
  ext = 'jpg',
  pattern,
}) {
  const cleanUser = sanitizeFilename(username || 'instagram');
  const shortId = sanitizeFilename(String(id || Date.now())).slice(0, 24);
  const date = new Date().toISOString().slice(0, 10);
  const template = pattern || DEFAULT_SETTINGS.filenamePattern;

  const base = template
    .replace('{username}', cleanUser)
    .replace('{type}', type)
    .replace('{id}', shortId)
    .replace('{date}', date);

  return `${sanitizeFilename(base)}.${ext}`;
}

async function appendHistory(entry) {
  try {
    const data = await chrome.storage.local.get({ history: [] });
    const history = Array.isArray(data.history) ? data.history : [];
    history.unshift({
      id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
      timestamp: Date.now(),
      ...entry,
    });
    await chrome.storage.local.set({ history: history.slice(0, 50) });
  } catch {
    // Ignore storage quota errors
  }
}

function triggerDownload(url, filename, meta = {}) {
  return new Promise((resolve, reject) => {
    chrome.downloads.download(
      {
        url,
        filename: `InstaKit/${filename}`,
        conflictAction: 'uniquify',
        saveAs: false,
      },
      async (downloadId) => {
        if (chrome.runtime.lastError || !downloadId) {
          reject(new Error(chrome.runtime.lastError?.message || 'Download failed'));
          return;
        }
        await appendHistory({
          filename,
          type: meta.type || 'media',
          username: meta.username || 'instagram',
          url,
        });
        resolve(downloadId);
      }
    );
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const instagramPage = /^https:\/\/(?:www\.)?instagram\.com\//;
  if (!message || sender.frameId !== 0 || !instagramPage.test(sender.url ?? "")) return false;

  if (message.type === "download-instagram-voice") {
    const thread = /^https:\/\/(?:www\.)?instagram\.com\/direct\/t\/[^/?#]+/;
    const media = thread.test(sender.url) && getDownloadableVoice(message.url);
    if (!media) {
      sendResponse({ started: false });
      return false;
    }
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    chrome.downloads.download({
      url: media.url,
      filename: "Instagram/voice-" + timestamp + "." + media.extension,
      conflictAction: "uniquify",
      saveAs: false,
    }).then(() => sendResponse({ started: true }), () => sendResponse({ started: false }));
    return true;
  }

  if (!message.action) return false;

  if (message.action === 'DOWNLOAD_MEDIA') {
    (async () => {
      try {
        const media = getDownloadableVideo(message.url) || getDownloadableImage(message.url);
        if (!media) throw new Error('Direct Instagram media is unavailable');
        const settings = await chrome.storage.sync.get(DEFAULT_SETTINGS);
        const filename = buildFilename({
          username: message.username,
          type: message.type,
          id: message.id,
          ext: media.extension,
          pattern: settings.filenamePattern,
        });
        const downloadId = await triggerDownload(media.url, filename, {
          type: message.type,
          username: message.username,
        });
        sendResponse({ ok: true, downloadId, filename });
      } catch (err) {
        sendResponse({ ok: false, error: err.message });
      }
    })();
    return true;
  }

  if (message.action === 'DOWNLOAD_BATCH') {
    (async () => {
      try {
        const settings = await chrome.storage.sync.get(DEFAULT_SETTINGS);
        const items = Array.isArray(message.items) ? message.items.map(item =>
          getDownloadableVideo(item?.url) || getDownloadableImage(item?.url)
        ) : [];
        if (!items.length || items.some(item => !item)) throw new Error('Direct Instagram media is unavailable');
        const results = [];
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          const filename = buildFilename({
            username: message.username,
            type: `${message.type || 'post'}_${i + 1}`,
            id: message.id,
            ext: item.extension,
            pattern: settings.filenamePattern,
          });
          const id = await triggerDownload(item.url, filename, {
            type: message.type || 'carousel',
            username: message.username,
          });
          results.push({ id, filename });
          if (i < items.length - 1) {
            await sleep(220);
          }
        }
        sendResponse({ ok: true, count: results.length });
      } catch (err) {
        sendResponse({ ok: false, error: err.message });
      }
    })();
    return true;
  }

  if (message.action === 'FETCH_MEDIA_BASE64') {
    (async () => {
      try {
        const media = getDownloadableVideo(message.url) || getDownloadableImage(message.url);
        if (!media) throw new Error('Direct Instagram media is unavailable');
        const res = await fetch(media.url, { credentials: 'omit', redirect: 'error' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buf = await res.arrayBuffer();
        sendResponse({ ok: true, base64: arrayBufferToBase64(buf) });
      } catch (err) {
        sendResponse({ ok: false, error: err.message });
      }
    })();
    return true;
  }

  if (message.action === 'DOWNLOAD_TEXT') {
    (async () => {
      try {
        const settings = await chrome.storage.sync.get(DEFAULT_SETTINGS);
        const filename = buildFilename({
          username: message.username,
          type: message.type || 'bio',
          id: message.id || 'profile',
          ext: 'txt',
          pattern: settings.filenamePattern,
        });
        const dataUrl =
          'data:text/plain;charset=utf-8,' + encodeURIComponent(message.text || '');
        const downloadId = await triggerDownload(dataUrl, filename, {
          type: message.type || 'bio',
          username: message.username,
        });
        sendResponse({ ok: true, downloadId, filename });
      } catch (err) {
        sendResponse({ ok: false, error: err.message });
      }
    })();
    return true;
  }

  if (message.action === 'LOG_HISTORY') {
    appendHistory({
      filename: message.filename || 'item',
      type: message.type || 'media',
      username: message.username || 'instagram',
    }).then(() => sendResponse({ ok: true }));
    return true;
  }

  if (message.action === 'LOG_COPY') {
    appendHistory({
      filename: message.label || 'Copied text',
      type: message.type || 'copy',
      username: message.username || 'instagram',
    }).then(() => sendResponse({ ok: true }));
    return true;
  }

  return false;
});
