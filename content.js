/**
 * InstaKit Content Script (ISOLATED world)
 * Final production build:
 * - Bulletproof clipboard copy (Clipboard API + execCommand fallback)
 * - SPA route cleanup so profile/story/reel icons never duplicate
 * - On-demand media & profile resolution (posts, carousels, reels, stories, highlights, bio, PFP)
 * - Multi-select media picker modal (all pre-selected, ZIP or Sequential choice)
 * - CORS-safe ZIP bundling via background fallback + direct blob download
 */
(() => {
  if (window.__INSTAKIT_CONTENT__) return;
  window.__INSTAKIT_CONTENT__ = true;

  const I18N = {
    ar: {
      downloadPost: 'تنزيل البوست',
      downloadSelected: 'تحميل الصورة المحددة فقط',
      downloadAllPost: 'تحديد وتحميل كل صور ومقاطع البوست',
      downloadReel: 'تحميل الريلز',
      downloadPhoto: 'تحميل الصورة',
      downloadChatVideo: 'تحميل الفيديو',
      downloadChatAll: 'تحميل الكل',
      incompleteChatAlbum: 'تعذر تجهيز كل صور المحادثة للتنزيل',
      downloadStory: 'تحميل الستوري',
      downloadAllStories: 'تحديد وتحميل كل الستوريات',
      downloadHighlightOne: 'تحميل هذه الستوري من الهايلايت',
      downloadHighlightAll: 'تحديد وتحميل الهايلايت كامل',
      downloadPfp: 'تحميل صورة البروفايل (PFP)',
      copyBio: 'نسخ البايو',
      downloadBio: 'تحميل البايو (.txt)',
      copyUser: 'نسخ اليوزر',
      copyName: 'نسخ الاسم',
      copyCaption: 'نسخ الوصف',
      copied: 'تم النسخ:',
      captionCopied: 'تم نسخ الوصف',
      copyFailed: 'تعذر النسخ إلى الحافظة',
      downloading: 'جاري التنزيل...',
      packingZip: 'جاري تجهيز ملف ZIP...',
      downloaded: 'تم بدء التنزيل',
      noMedia: 'تعذر العثور على رابط مباشر للوسائط',
      incompleteCarousel: 'ما قدرنا نجهّز كل عناصر هذا البوست للتنزيل',
      noText: 'لا يوجد نص متاح للنسخ',
      pickerTitle: 'تحديد الصور والمقاطع للتنزيل',
      selectAll: 'تحديد الكل',
      deselectAll: 'إلغاء الكل',
      selectedCount: 'محدد',
      downloadZip: 'تنزيل في ملف .ZIP',
      downloadSequential: 'تنزيل متتالي (واحد تلو الآخر)',
      close: 'إغلاق',
      videoTag: 'فيديو',
      photoTag: 'صورة',
    },
    en: {
      downloadPost: 'Download Post',
      downloadSelected: 'Download Selected Photo Only',
      downloadAllPost: 'Select & Download All Post Media',
      downloadReel: 'Download Reel',
      downloadPhoto: 'Download Photo',
      downloadChatVideo: 'Download Video',
      downloadChatAll: 'Download All',
      incompleteChatAlbum: 'Could not load all photos in this message',
      downloadStory: 'Download Story',
      downloadAllStories: 'Select & Download All Stories',
      downloadHighlightOne: 'Download This Highlight Story',
      downloadHighlightAll: 'Select & Download Full Highlight',
      downloadPfp: 'Download Profile Picture (PFP)',
      copyBio: 'Copy Bio',
      downloadBio: 'Save Bio (.txt)',
      copyUser: 'Copy @username',
      copyName: 'Copy Display Name',
      copyCaption: 'Copy Caption',
      copied: 'Copied:',
      captionCopied: 'Caption copied',
      copyFailed: 'Failed to copy to clipboard',
      downloading: 'Downloading...',
      packingZip: 'Building ZIP archive...',
      downloaded: 'Download started',
      noMedia: 'Could not locate direct media URL',
      incompleteCarousel: 'Could not load all the media in this post',
      noText: 'No text found to copy',
      pickerTitle: 'Select Media to Download',
      selectAll: 'Select All',
      deselectAll: 'Deselect All',
      selectedCount: 'selected',
      downloadZip: 'Download as .ZIP',
      downloadSequential: 'Download Sequentially',
      close: 'Close',
      videoTag: 'MP4',
      photoTag: 'JPG',
    },
  };

  let settings = {
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

  const mediaCache = new Map();
  const userCache = new Map();
  const storyCache = new Map();
  let lastPathname = location.pathname;

  window.addEventListener('instakit:cache-update', (e) => {
    const { type, payload } = e.detail || {};
    if (type === 'media' && payload?.code) {
      mediaCache.set(payload.code, payload);
      if (mediaCache.size > 160) mediaCache.delete(mediaCache.keys().next().value);
      if (document.body) scheduleScan();
    } else if (type === 'user' && payload?.username) {
      userCache.set(payload.username.toLowerCase(), payload);
    } else if (type === 'story' && payload) {
      if (payload.highlightId) storyCache.set(`highlight:${payload.highlightId}`, payload);
      if (payload.username) storyCache.set(`user:${payload.username.toLowerCase()}`, payload);
    }
  });

  function sendMsg(payload) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(payload, (res) => {
          if (chrome.runtime.lastError) {
            resolve({ ok: false, error: chrome.runtime.lastError.message });
          } else {
            resolve(res || { ok: false });
          }
        });
      } catch (err) {
        resolve({ ok: false, error: err.message });
      }
    });
  }

  function resolveFromPageWorld(kind, key) {
    return new Promise((resolve) => {
      const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const timer = setTimeout(() => {
        window.removeEventListener('instakit:resolve-result', onRes);
        resolve(null);
      }, 4500);

      function onRes(e) {
        if (e.detail?.requestId === requestId) {
          clearTimeout(timer);
          window.removeEventListener('instakit:resolve-result', onRes);
          resolve(e.detail.result || null);
        }
      }

      window.addEventListener('instakit:resolve-result', onRes);
      window.dispatchEvent(
        new CustomEvent('instakit:resolve-media', {
          detail: { requestId, kind, key },
        })
      );
    });
  }

  function detectPageDarkTheme() {
    if (settings.theme === 'dark') return true;
    if (settings.theme === 'light') return false;
    const bg = getComputedStyle(document.body).backgroundColor;
    const match = bg.match(/\d+/g);
    if (match && match.length >= 3) {
      const luminance =
        (0.299 * Number(match[0]) +
          0.587 * Number(match[1]) +
          0.114 * Number(match[2])) /
        255;
      return luminance < 0.45;
    }
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  function applyAdaptiveTheme() {
    const isDark = detectPageDarkTheme();
    document.documentElement.setAttribute(
      'data-instakit-theme',
      isDark ? 'dark' : 'light'
    );
  }

  function t(key) {
    const dict = I18N[settings.lang] || I18N.ar;
    return dict[key] || key;
  }

  function loadSettings() {
    chrome.storage.sync.get(settings, (stored) => {
      if (!chrome.runtime.lastError && stored) {
        settings = { ...settings, ...stored };
      }
      applyAdaptiveTheme();
      scanAndInject();
    });
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync') {
      for (const [key, val] of Object.entries(changes)) {
        settings[key] = val.newValue;
      }
      applyAdaptiveTheme();
      document.querySelectorAll('[data-instakit-injected]').forEach((el) => el.remove());
      document.querySelectorAll('[data-instakit-profile-user]').forEach((el) => {
        delete el.dataset.instakitProfileUser;
      });
      scanAndInject();
    }
  });

  function showToast(message) {
    let toast = document.getElementById('instakit-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'instakit-toast';
      toast.className = 'instakit-toast';
      document.body.appendChild(toast);
    }
    toast.setAttribute('role', 'status');
    toast.textContent = message;
    toast.classList.add('is-visible');
    clearTimeout(toast.__timer);
    toast.__timer = setTimeout(() => {
      toast.classList.remove('is-visible');
    }, 2600);
  }

  const ICONS = {
    download:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
    copy:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
    layers:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>',
    fileText:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>',
    atSign:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-3.92 7.94"/></svg>',
    user:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
  };

  function createIconBtn({
    tooltip,
    icon = 'download',
    variant = 'default',
    size = 'md',
    tooltipPos = 'top',
    onClick,
  }) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `instakit-icon-btn ${
      variant === 'primary' ? 'instakit-icon-btn--primary' : ''
    } ${size === 'sm' ? 'instakit-icon-btn--sm' : ''}`;
    btn.setAttribute('data-instakit-injected', 'true');
    btn.setAttribute('data-tooltip', tooltip);
    btn.setAttribute('aria-label', tooltip);
    if (tooltipPos === 'bottom') btn.setAttribute('data-tooltip-pos', 'bottom');
    btn.innerHTML = ICONS[icon] || ICONS.download;
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!e.isTrusted || btn.disabled) return;
      btn.disabled = true;
      Promise.resolve().then(() => onClick(btn)).catch(() => showToast(t('noMedia')))
        .finally(() => { btn.disabled = false; });
    });
    return btn;
  }

  function execCommandCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '0';
    ta.style.left = '-9999px';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    const activeEl = document.activeElement;
    ta.focus({ preventScroll: true });
    ta.select();
    ta.setSelectionRange(0, text.length);
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    ta.remove();
    if (activeEl && typeof activeEl.focus === 'function') {
      try {
        activeEl.focus({ preventScroll: true });
      } catch {
        // Ignore
      }
    }
    return ok;
  }

  async function copyText(text, label, username = '', previewInToast = true) {
    const cleaned = String(text || '').trim();
    if (!cleaned) {
      showToast(t('noText'));
      return;
    }

    let copied = false;
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      try {
        await navigator.clipboard.writeText(cleaned);
        copied = true;
      } catch {
        copied = execCommandCopy(cleaned);
      }
    } else {
      copied = execCommandCopy(cleaned);
    }

    if (copied) {
      const preview = cleaned.replace(/\s+/g, ' ').slice(0, 40);
      showToast(previewInToast ? `${t('copied')} ${preview}${cleaned.length > 40 ? '...' : ''}` : t('captionCopied'));
      sendMsg({
        action: 'LOG_COPY',
        label: `${label}: ${preview}`,
        username,
        type: 'copy',
      });
    } else {
      showToast(t('copyFailed'));
    }
  }

  async function downloadSingle({ url, username, type, id, ext }) {
    if (!url || url.startsWith('blob:')) {
      showToast(t('noMedia'));
      return;
    }
    showToast(t('downloading'));
    const res = await sendMsg({
      action: 'DOWNLOAD_MEDIA',
      url,
      username,
      type,
      id,
      ext,
    });
    if (res?.ok) showToast(`${t('downloaded')}: ${res.filename}`);
    else showToast(res?.error || t('noMedia'));
  }

  async function downloadSequential({ items, username, type, id }) {
    const valid = items.filter((item) => item.url && !item.url.startsWith('blob:'));
    if (valid.length === 0) {
      showToast(t('noMedia'));
      return;
    }
    showToast(t('downloading'));
    const res = await sendMsg({
      action: 'DOWNLOAD_BATCH',
      items: valid,
      username,
      type,
      id,
    });
    if (res?.ok) showToast(`${t('downloaded')} (${res.count})`);
    else showToast(res?.error || t('noMedia'));
  }

  function base64ToUint8Array(base64) {
    const bin = atob(base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) {
      bytes[i] = bin.charCodeAt(i);
    }
    return bytes;
  }

  async function fetchBinaryBytes(url) {
    try {
      const res = await fetch(url, { mode: 'cors', credentials: 'omit', cache: 'no-store' });
      if (res.ok) return new Uint8Array(await res.arrayBuffer());
    } catch {
      // Fallback to service worker fetch with host_permissions (CORS-free)
    }
    const bgRes = await sendMsg({ action: 'FETCH_MEDIA_BASE64', url });
    if (bgRes?.ok && bgRes.base64) {
      return base64ToUint8Array(bgRes.base64);
    }
    throw new Error('Unable to fetch binary');
  }

  async function downloadAsZip({ items, username, type, id }) {
    const valid = items.filter((item) => item.url && !item.url.startsWith('blob:'));
    if (valid.length === 0 || !window.InstaKitZip) {
      showToast(t('noMedia'));
      return;
    }
    showToast(t('packingZip'));
    try {
      const entries = [];
      for (let i = 0; i < valid.length; i++) {
        const item = valid[i];
        const data = await fetchBinaryBytes(item.url);
        const ext = item.ext || (item.type === 'video' ? 'mp4' : 'jpg');
        entries.push({
          name: `${username}_${type}_${i + 1}.${ext}`,
          data,
        });
      }
      const zipBlob = window.InstaKitZip.buildZipBlob(entries);
      const zipName = `${username}_${type}_${id || Date.now()}.zip`.replace(
        /[<>:"/\\|?*]/g,
        '_'
      );
      const objectUrl = URL.createObjectURL(zipBlob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = zipName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 2500);
      showToast(`${t('downloaded')}: ${zipName}`);
      sendMsg({ action: 'LOG_HISTORY', filename: zipName, type, username });
    } catch {
      downloadSequential({ items: valid, username, type, id });
    }
  }

  function openMediaPickerModal({ items, username, type, id }) {
    const valid = items.filter((item) => item.url && !item.url.startsWith('blob:'));
    if (valid.length === 0) {
      showToast(t('noMedia'));
      return;
    }

    if (settings.batchMode === 'zip') {
      downloadAsZip({ items: valid, username, type, id });
      return;
    }
    if (settings.batchMode === 'sequential') {
      downloadSequential({ items: valid, username, type, id });
      return;
    }

    document.getElementById('instakit-picker-backdrop')?.remove();

    const selected = new Set(valid.map((_, idx) => idx));

    const backdrop = document.createElement('div');
    backdrop.id = 'instakit-picker-backdrop';
    backdrop.className = 'instakit-modal-backdrop';
    backdrop.dir = settings.lang === 'ar' ? 'rtl' : 'ltr';

    const modal = document.createElement('div');
    modal.className = 'instakit-modal';

    const header = document.createElement('div');
    header.className = 'instakit-modal-header';
    const titleEl = document.createElement('h3');
    titleEl.className = 'instakit-modal-title';
    titleEl.textContent = t('pickerTitle');
    header.appendChild(titleEl);

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'instakit-pill-btn';
    closeBtn.textContent = t('close');
    closeBtn.addEventListener('click', () => backdrop.remove());
    header.appendChild(closeBtn);

    const toolbar = document.createElement('div');
    toolbar.className = 'instakit-modal-toolbar';
    const countLabel = document.createElement('span');
    const toggleAllBtn = document.createElement('button');
    toggleAllBtn.type = 'button';
    toggleAllBtn.className = 'instakit-pill-btn';
    toolbar.appendChild(countLabel);
    toolbar.appendChild(toggleAllBtn);

    const grid = document.createElement('div');
    grid.className = 'instakit-modal-grid';

    const footer = document.createElement('div');
    footer.className = 'instakit-modal-footer';

    const seqBtn = document.createElement('button');
    seqBtn.type = 'button';
    seqBtn.className = 'instakit-pill-btn';

    const zipBtn = document.createElement('button');
    zipBtn.type = 'button';
    zipBtn.className = 'instakit-pill-btn instakit-pill-btn--primary';

    footer.appendChild(seqBtn);
    footer.appendChild(zipBtn);

    function syncUI() {
      const count = selected.size;
      countLabel.textContent = `${count} / ${valid.length} ${t('selectedCount')}`;
      toggleAllBtn.textContent =
        count === valid.length ? t('deselectAll') : t('selectAll');
      seqBtn.textContent = `${t('downloadSequential')} (${count})`;
      zipBtn.textContent = `${t('downloadZip')} (${count})`;
      seqBtn.disabled = count === 0;
      zipBtn.disabled = count === 0;
    }

    valid.forEach((item, idx) => {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'instakit-thumb is-selected';

      const previewUrl = item.poster || item.url;
      const imgEl = document.createElement('img');
      imgEl.src = previewUrl;
      imgEl.alt = `Item ${idx + 1}`;

      const checkEl = document.createElement('span');
      checkEl.className = 'instakit-thumb-check';
      checkEl.textContent = '✓';

      const typeEl = document.createElement('span');
      typeEl.className = 'instakit-thumb-type';
      typeEl.textContent = item.type === 'video' ? t('videoTag') : t('photoTag');

      card.appendChild(imgEl);
      card.appendChild(checkEl);
      card.appendChild(typeEl);

      card.addEventListener('click', () => {
        if (selected.has(idx)) {
          selected.delete(idx);
          card.classList.remove('is-selected');
          checkEl.textContent = '';
        } else {
          selected.add(idx);
          card.classList.add('is-selected');
          checkEl.textContent = '✓';
        }
        syncUI();
      });
      grid.appendChild(card);
    });

    toggleAllBtn.addEventListener('click', () => {
      const selectEverything = selected.size < valid.length;
      const cards = grid.querySelectorAll('.instakit-thumb');
      cards.forEach((card, idx) => {
        const checkEl = card.querySelector('.instakit-thumb-check');
        if (selectEverything) {
          selected.add(idx);
          card.classList.add('is-selected');
          if (checkEl) checkEl.textContent = '✓';
        } else {
          selected.delete(idx);
          card.classList.remove('is-selected');
          if (checkEl) checkEl.textContent = '';
        }
      });
      syncUI();
    });

    seqBtn.addEventListener('click', () => {
      const picked = valid.filter((_, idx) => selected.has(idx));
      backdrop.remove();
      downloadSequential({ items: picked, username, type, id });
    });

    zipBtn.addEventListener('click', () => {
      const picked = valid.filter((_, idx) => selected.has(idx));
      backdrop.remove();
      downloadAsZip({ items: picked, username, type, id });
    });

    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) backdrop.remove();
    });

    syncUI();
    modal.appendChild(header);
    modal.appendChild(toolbar);
    modal.appendChild(grid);
    modal.appendChild(footer);
    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);
  }

  function getBestSrcFromImg(img) {
    if (!img) return null;
    const srcset = img.getAttribute('srcset');
    if (srcset) {
      const candidates = srcset
        .split(',')
        .map((part) => {
          const [url, size] = part.trim().split(/\s+/);
          const width = parseInt(size || '0', 10) || 0;
          return { url, width };
        })
        .filter((c) => c.url);
      candidates.sort((a, b) => b.width - a.width);
      if (candidates[0]?.url) return candidates[0].url;
    }
    return img.src || null;
  }

  const postRoute = /\/(?:p|reels?|tv)\/([A-Za-z0-9_-]+)(?:\/|$)/;
  const postDialog = '[role="dialog"], dialog[open]';
  const accountLink = /^\/([a-z0-9._]+)\/$/i;
  const captionSelector = 'h1, [data-testid="post-caption"], [data-testid="caption"], [data-caption]';
  const actionLabels = /^(like|unlike|comment|save|remove from saved|إعجاب|أعجبني|إلغاء الإعجاب|تعليق|حفظ|إزالة من المحفوظات)$/i;
  const moreSelector = 'button, [role="button"], time, svg, [aria-hidden="true"]';
  const nextLabel = /^(next(?: slide| photo)?|التالي|الصورة التالية)$/i;
  const previousLabel = /^(previous(?: slide| photo)?|السابق|الصورة السابقة)$/i;
  const enabledPostRoots = new WeakMap();

  function postKey(path) {
    return path?.split(/[?#]/, 1)[0].match(postRoute)?.[1] || '';
  }

  function getPostShortcode(root, useLocation) {
    if (useLocation && postKey(location.pathname)) return postKey(location.pathname);
    const links = [...root.querySelectorAll('a[href]')];
    const timestamp = links.find(link => link.querySelector('time') && postKey(link.pathname));
    if (timestamp) return postKey(timestamp.pathname);
    const codes = new Set(links.filter(link => !link.closest(captionSelector)).map(link => postKey(link.pathname)).filter(Boolean));
    return codes.size === 1 ? [...codes][0] : '';
  }

  function getArticleUsername(root) {
    const links = [...root.querySelectorAll('a[href^="/"]')];
    const eligible = links.filter(link => accountLink.test(link.pathname) &&
      link.textContent.trim().toLowerCase() === link.pathname.slice(1, -1).toLowerCase());
    const link = eligible.find(link => link.closest('header')) || eligible[0];
    return link ? link.pathname.slice(1, -1) : '';
  }

  function readCaption(node, authorLink) {
    const clone = node.cloneNode(true);
    clone.querySelectorAll(moreSelector).forEach(element => element.remove());
    if (authorLink) {
      const link = [...clone.querySelectorAll('a[href]')].find(item =>
        item.getAttribute('href') === authorLink.getAttribute('href') &&
        item.textContent.trim() === authorLink.textContent.trim()
      );
      link?.remove();
    }

    function read(element) {
      if (element.nodeType === Node.TEXT_NODE) return element.nodeValue;
      if (element.nodeName === 'BR') return '\n';
      const text = [...element.childNodes].map(read).join('');
      return element.matches?.('div,p') ? '\n' + text + '\n' : text;
    }
    return [...clone.childNodes].map(read).join('').trim();
  }

  function getArticleCaption(root, username) {
    for (const node of root.querySelectorAll(captionSelector)) {
      if (node.closest('button, nav, [data-instakit-injected]')) continue;
      const authorLink = [...node.querySelectorAll('a[href^="/"]')].find(link =>
        link.textContent.trim().toLowerCase() === username.toLowerCase() &&
        link.pathname.toLowerCase() === '/' + username.toLowerCase() + '/'
      );
      const caption = readCaption(node, authorLink);
      if (caption && caption.toLowerCase() !== username.toLowerCase()) return caption;
    }
    if (!username) return '';

    const ownerPath = '/' + username.toLowerCase() + '/';
    for (const link of root.querySelectorAll('a[href^="/"]')) {
      if (link.pathname.toLowerCase() !== ownerPath ||
          link.textContent.trim().toLowerCase() !== username.toLowerCase() ||
          link.closest('header, nav, button, [role="button"], time')) continue;
      if (link.closest('[data-testid*="comment" i], [role="listitem"], li')) continue;

      // Feed captions put the owner and the description inline. Start at the
      // smallest wrapper that has text after the owner's link.
      for (let block = link.parentElement; block && block !== root; block = block.parentElement) {
        if (block.querySelector('time, video, img, ul, form, [data-instakit-injected]')) break;
        const row = block.parentElement;
        const vicinity = row && row !== root && !row.querySelector('header, section, article, ul, form, video, img')
          ? row : block;
        if ([...vicinity.querySelectorAll('button, [role="button"]')].some(button =>
          /^(reply|رد)$/i.test(button.textContent.trim())
        )) break;
        const caption = readCaption(block, link);
        if (caption && !/^(original audio|الصوت الأصلي|follow(?:ing)?|متابعة)$/i.test(caption)) return caption;
        if (block.parentElement === root) break;
      }
    }
    return '';
  }

  function videoItem(video) {
    const source = [video.currentSrc, video.src, ...[...video.querySelectorAll('source[src]')].map(node => node.src)]
      .map(getDownloadableVideo).find(Boolean);
    return source && { url: source.url, type: 'video', ext: source.extension, poster: video.poster };
  }

  function postMediaElement(root) {
    const video = root.querySelector('video');
    if (video) return video;
    return [...root.querySelectorAll('img')].find(img => {
      if (img.closest('header, footer, button, [data-instakit-injected]')) return false;
      const rect = img.getBoundingClientRect();
      return (rect.width >= 120 && rect.height >= 100) ||
        (rect.width === 0 && (img.naturalWidth || img.width) >= 240);
    }) || null;
  }

  function imageItem(img) {
    const source = getDownloadableImage(getBestSrcFromImg(img));
    return source && { url: source.url, type: 'image', ext: source.extension, poster: source.url };
  }

  function carouselTrack(root) {
    return [...root.querySelectorAll('ul, [role="list"]')].find(track =>
      [...track.children].some(slide => postMediaElement(slide))
    );
  }

  function carouselViewport(root, track) {
    for (let element = track?.parentElement; element && element !== root; element = element.parentElement) {
      if (element.querySelector('video, img') && carouselButton(element, nextLabel)) return element;
      if (element.querySelector('video, img') && carouselButton(element, previousLabel)) return element;
    }
    const media = postMediaElement(root);
    for (let element = media?.parentElement; element && element !== root; element = element.parentElement) {
      if (element.querySelector('section, article, form')) break;
      if (carouselButton(element, nextLabel) || carouselButton(element, previousLabel)) return element;
    }
    return null;
  }

  function carouselButton(root, pattern) {
    return [...root.querySelectorAll('button[aria-label], [role="button"][aria-label], button svg[aria-label]')]
      .find(node => pattern.test(node.getAttribute('aria-label')))?.closest('button, [role="button"]');
  }

  function activeSlide(root, track, viewport) {
    const dots = [...root.querySelectorAll('div._acnb')];
    const activeDot = dots.findIndex(dot => dot.classList.contains('_acnf'));
    const rect = (viewport || track?.parentElement || root).getBoundingClientRect();
    const center = (rect.left + rect.right) / 2;
    const slides = track ? [...track.children] : [root];
    let best = null;
    slides.forEach((slide, index) => {
      const media = postMediaElement(slide);
      if (!media) return;
      const box = media.getBoundingClientRect();
      const distance = Math.abs((box.left + box.right) / 2 - center);
      if (!best || distance < best.distance) best = { media, index, distance };
    });
    return { index: activeDot >= 0 ? activeDot : (best?.index ?? 0), media: best?.media };
  }

  function asDownloadItem(item) {
    if (!item?.url) return null;
    const video = item.type === 'video';
    const source = video ? getDownloadableVideo(item.url) : getDownloadableImage(item.url);
    return source && { ...item, url: source.url, ext: source.extension };
  }

  function displayedMediaCode(media) {
    const url = getDownloadableImage(media.poster || media.currentSrc || media.src) ||
      getDownloadableVideo(media.currentSrc || media.src);
    if (!url) return '';
    const pathname = new URL(url.url).pathname;
    const matching = [...mediaCache.values()].filter(entry => entry.slides?.some(slide =>
      [getDownloadableImage(slide.poster), asDownloadItem(slide)].some(item =>
        item && new URL(item.url).pathname === pathname
      )
    ));
    return matching.length === 1 ? matching[0].code : '';
  }

  async function collectCarousel(root, viewport, code, cached) {
    const items = (cached?.slides || []).map(asDownloadItem).filter(Boolean);
    if (items.length > 1 && items.length === (cached.expected || cached.slides.length)) return items;

    const track = carouselTrack(root);
    const expected = root.querySelectorAll('div._acnb').length;
    const domItems = [...(track?.children || [])].map(slide => {
      const media = postMediaElement(slide);
      return media?.matches('video') ? videoItem(media) : imageItem(media);
    }).filter(Boolean);
    if (!viewport || (domItems.length > 1 && expected && domItems.length === expected)) {
      return domItems.length >= items.length ? domItems : items;
    }

    // Some carousels only mount the slides near the current one.
    const path = location.pathname;
    const original = activeSlide(root, track, viewport);
    const originalSource = original.media?.currentSrc || original.media?.src;
    const live = () => root.isConnected && viewport.isConnected && location.pathname === path;
    const collected = new Map();
    const wait = () => new Promise(resolve => setTimeout(resolve, 70));
    const now = () => activeSlide(root, carouselTrack(root), viewport);
    const mediaSource = state => state.media?.currentSrc || state.media?.src;
    const remember = state => {
      const element = state.media;
      const item = element?.matches('video') ? videoItem(element) : imageItem(element);
      if (item) collected.set(new URL(item.url).pathname, item);
    };
    async function move(direction) {
      const button = carouselButton(viewport, direction);
      if (!live() || !button || button.disabled || button.getAttribute('aria-disabled') === 'true') return false;
      const before = now();
      const beforeSource = mediaSource(before);
      button.click();
      for (let attempt = 0; attempt < 12 && live(); attempt++) {
        await wait();
        const after = now();
        if (after.media && (after.index !== before.index || mediaSource(after) !== beforeSource) &&
            (after.media.matches('video') || imageItem(after.media))) return true;
      }
      return false;
    }

    let originalIndex = 0;
    while (originalIndex < 20 && await move(previousLabel)) originalIndex++;
    let index = 0;
    try {
      if (live()) remember(now());
      while (index < 19 && await move(nextLabel)) {
        index++;
        remember(now());
      }
      const fresh = (code && mediaCache.get(code)?.slides || []).map(asDownloadItem).filter(Boolean);
      return [fresh, domItems, [...collected.values()]].reduce((best, candidate) =>
        candidate.length > best.length ? candidate : best
      );
    } finally {
      while (index > originalIndex && live() && mediaSource(now()) !== originalSource && await move(previousLabel)) index--;
      while (index < originalIndex && live() && mediaSource(now()) !== originalSource && await move(nextLabel)) index++;
    }
  }

  function findPostActionBar(root) {
    const icons = [...root.querySelectorAll('svg[aria-label]')].filter(icon =>
      actionLabels.test(icon.getAttribute('aria-label')) && !icon.closest('[data-instakit-injected]')
    );
    if (!icons.length) return null;

    const save = icons.find(icon => /^(save|remove from saved|حفظ|إزالة من المحفوظات)$/i.test(icon.getAttribute('aria-label')));
    const section = (save || icons[0]).closest('section');
    if (section && root.contains(section)) return section;
    for (let row = icons[0].parentElement; row && row !== root; row = row.parentElement) {
      if (icons.filter(icon => row.contains(icon)).length >= 2) return row;
    }
    return null;
  }

  function injectPostControls(root, { modal = false, reel = false, permalink = false } = {}) {
    const media = postMediaElement(root);
    if (!media) return;
    const track = carouselTrack(root);
    const viewport = carouselViewport(root, track);
    const actionBar = findPostActionBar(root);
    if (modal && !actionBar && !postKey(location.pathname)) return;

    const placement = actionBar || viewport || media.parentElement;
    if (!placement) return;
    const useLocation = modal || permalink;
    const code = getPostShortcode(root, useLocation) || displayedMediaCode(media);
    const username = getArticleUsername(root);
    const carousel = Boolean(viewport ||
      root.querySelectorAll('div._acnb').length > 1 ||
      [...(track?.children || [])].filter(postMediaElement).length > 1 ||
      (code && (mediaCache.get(code)?.expected || mediaCache.get(code)?.slides?.length) > 1));
    const prior = enabledPostRoots.get(root);
    if (prior?.dock.isConnected && prior.placement === placement &&
        prior.code === code && prior.username === username && prior.carousel === carousel &&
        prior.path === location.pathname) return;
    prior?.dock.remove();

    const dock = document.createElement('div');
    dock.className = actionBar ? 'instakit-dock instakit-post-dock' : 'instakit-overlay-corner';
    dock.dataset.instakitInjected = 'true';
    dock.dataset.instakitPostDock = 'true';
    const path = location.pathname;
    const stillOpen = () => dock.isConnected && location.pathname === path;
    const resolvePost = async () => {
      if (!code) return null;
      return await resolveFromPageWorld('post', code) || mediaCache.get(code) || null;
    };

    const allowDownload = reel ? settings.enableReelDownload :
      settings.enablePostDownload || (settings.enablePhotoDownload && !media.matches('video'));
    if (allowDownload) {
      dock.appendChild(createIconBtn({
        tooltip: carousel ? t('downloadSelected') : t(reel ? 'downloadReel' : 'downloadPost'),
        icon: 'download',
        variant: 'primary',
        onClick: async () => {
          const liveTrack = carouselTrack(root);
          const active = activeSlide(root, liveTrack, carouselViewport(root, liveTrack));
          const activeMedia = active.media || media;
          const video = activeMedia.matches('video');
          const direct = video ? videoItem(activeMedia) : imageItem(activeMedia);
          const entry = direct ? null : mediaCache.get(code);
          const cached = asDownloadItem(entry?.slides?.[active.index]);
          const resolved = !direct && (!cached || (video && cached.type !== 'video')) ? await resolvePost() : null;
          if (!stillOpen()) return;
          const item = direct || asDownloadItem(resolved?.slides?.[active.index]) || cached;
          if (!item || (video && item.type !== 'video')) return showToast(t('noMedia'));
          return downloadSingle({ ...item, username: resolved?.username || entry?.username || username || 'instagram',
            type: reel ? 'reel' : 'post', id: code ? code + '_' + (active.index + 1) : '' });
        },
      }));
    }

    if (carousel && settings.enablePostDownload) {
      dock.appendChild(createIconBtn({
        tooltip: t('downloadAllPost'),
        icon: 'layers',
        onClick: async () => {
          const cached = mediaCache.get(code);
          const complete = cached?.slides?.length > 1 && cached.slides.length === (cached.expected || cached.slides.length) &&
            cached.slides.every(asDownloadItem);
          const entry = complete ? cached : await resolvePost();
          if (!stillOpen()) return;
          const items = await collectCarousel(root, viewport, code, entry);
          if (!stillOpen()) return;
          const expected = Math.max(root.querySelectorAll('div._acnb').length, entry?.expected || entry?.slides?.length || 0);
          if (items.length < 2 || (expected && items.length < expected)) {
            showToast(t('incompleteCarousel'));
            return;
          }
          openMediaPickerModal({ items, username: entry?.username || username || 'instagram',
            type: 'carousel', id: code });
        },
      }));
    }

    if (settings.enableBioActions) {
      dock.appendChild(createIconBtn({
        tooltip: t('copyCaption'),
        icon: 'copy',
        onClick: async () => {
          const visible = getArticleCaption(root, username);
          const full = code && mediaCache.get(code)?.caption;
          const collapsed = [...root.querySelectorAll('button, [role="button"]')].some(button =>
            /^(more|المزيد)$/i.test(button.textContent.trim())
          );
          const entry = !full && (collapsed || !visible) ? await resolvePost() : null;
          if (!stillOpen()) return;
          return copyText(full || entry?.caption || visible, 'Caption', username, false);
        },
      }));
    }

    if (dock.children.length === 0) return;
    if (!actionBar && getComputedStyle(placement).position === 'static') placement.style.position = 'relative';
    placement.appendChild(dock);
    enabledPostRoots.set(root, { dock, placement, code, username, carousel, path });
  }

  function injectFeedReelControls() {
    if (!/^\/reels?(?:\/|$)/.test(location.pathname)) return;
    const videos = [...document.querySelectorAll('video')].filter(video =>
      !video.closest('article, ' + postDialog)
    );
    for (const video of videos) {
      let card = video.parentElement;
      for (let node = card; node && !node.matches('main, body, [role="main"]'); node = node.parentElement) {
        if (node.querySelectorAll('video').length > 1) break;
        if (findPostActionBar(node) || node.matches('[role="presentation"]')) card = node;
      }
      if (card) injectPostControls(card, { reel: true, permalink: videos.length === 1 });
    }
  }

  function matchVisibleStoryItem(section, items) {
    if (!Array.isArray(items) || items.length === 0) return items[0];
    const visibleImg = Array.from(section.querySelectorAll('img')).find(
      (img) => (img.naturalWidth || img.width) > 200
    );
    const visibleSrc = visibleImg?.src || '';
    if (visibleSrc) {
      const matched = items.find((item) => {
        const ref = item.poster || item.url || '';
        const token = ref.split('/').pop()?.split('?')[0];
        return token && visibleSrc.includes(token);
      });
      if (matched) return matched;
    }
    return items[0];
  }

  function injectStoryAndHighlightControls() {
    if (!settings.enableStoryDownload) return;
    if (!location.pathname.startsWith('/stories/')) return;

    const section = document.querySelector('section');
    if (!section || section.querySelector('[data-instakit-storybar]')) return;

    const highlightMatch = location.pathname.match(/\/stories\/highlights\/(\d+)/);
    const isHighlight = Boolean(highlightMatch);
    const highlightId = highlightMatch ? highlightMatch[1] : null;
    const userMatch = location.pathname.match(/\/stories\/([^/?]+)/);
    const storyUser = !isHighlight && userMatch ? userMatch[1] : 'instagram';

    const corner = document.createElement('div');
    corner.className = 'instakit-overlay-corner';
    corner.setAttribute('data-instakit-injected', 'true');
    corner.setAttribute('data-instakit-storybar', '1');

    const resolveTray = async () => {
      const key = isHighlight ? `highlight:${highlightId}` : `user:${storyUser.toLowerCase()}`;
      let cached = storyCache.get(key);
      if (!cached?.items?.length) {
        cached = await resolveFromPageWorld(
          isHighlight ? 'highlight' : 'story',
          isHighlight ? highlightId : storyUser
        );
      }
      return cached;
    };

    const getCurrentStoryMedia = async () => {
      const cached = await resolveTray();
      if (cached?.items?.length) {
        const item = matchVisibleStoryItem(section, cached.items);
        if (item?.url) {
          return {
            url: item.url,
            ext: item.type === 'video' ? 'mp4' : 'jpg',
            username: cached.username || storyUser,
            id: item.id,
          };
        }
      }
      const video = section.querySelector('video');
      const vSrc = video?.src || video?.querySelector('source')?.src || '';
      if (vSrc && !vSrc.startsWith('blob:')) {
        return { url: vSrc, ext: 'mp4', username: storyUser, id: Date.now() };
      }
      const imgs = Array.from(section.querySelectorAll('img')).filter(
        (img) => (img.naturalWidth || img.width) > 200
      );
      const best = getBestSrcFromImg(imgs[0]);
      return best ? { url: best, ext: 'jpg', username: storyUser, id: Date.now() } : null;
    };

    corner.appendChild(
      createIconBtn({
        tooltip: isHighlight ? t('downloadHighlightOne') : t('downloadStory'),
        icon: 'download',
        variant: 'primary',
        onClick: async () => {
          const media = await getCurrentStoryMedia();
          if (!media) return showToast(t('noMedia'));
          downloadSingle({
            url: media.url,
            username: media.username,
            type: isHighlight ? 'highlight_story' : 'story',
            id: isHighlight ? `${highlightId}_${media.id}` : media.id,
            ext: media.ext,
          });
        },
      })
    );

    corner.appendChild(
      createIconBtn({
        tooltip: isHighlight ? t('downloadHighlightAll') : t('downloadAllStories'),
        icon: 'layers',
        onClick: async () => {
          const cached = await resolveTray();
          if (cached?.items?.length) {
            openMediaPickerModal({
              items: cached.items.map((item) => ({
                url: item.url,
                poster: item.poster || item.url,
                type: item.type,
                ext: item.type === 'video' ? 'mp4' : 'jpg',
              })),
              username: cached.username || storyUser,
              type: isHighlight ? 'highlight_full' : 'stories',
              id: highlightId || storyUser,
            });
          } else {
            const single = await getCurrentStoryMedia();
            if (!single) return showToast(t('noMedia'));
            openMediaPickerModal({
              items: [
                {
                  url: single.url,
                  poster: single.url,
                  type: single.ext === 'mp4' ? 'video' : 'image',
                  ext: single.ext,
                },
              ],
              username: single.username,
              type: isHighlight ? 'highlight_full' : 'stories',
              id: highlightId || storyUser,
            });
          }
        },
      })
    );

    if (getComputedStyle(section).position === 'static') {
      section.style.position = 'relative';
    }
    section.appendChild(corner);
  }

  function injectProfileControls() {
    const pathParts = location.pathname.split('/').filter(Boolean);
    const reserved = new Set([
      'explore',
      'reels',
      'reel',
      'direct',
      'accounts',
      'stories',
      'p',
    ]);
    if (pathParts.length !== 1 || reserved.has(pathParts[0])) return;

    const username = pathParts[0];
    const header = document.querySelector('header');
    if (!header) return;
    if (
      header.dataset.instakitProfileUser === username &&
      header.querySelector('[data-instakit-profile-dock]')
    ) {
      return;
    }

    // Clear stale controls if React reused <header> across profile navigation
    header.querySelectorAll('[data-instakit-injected]').forEach((el) => el.remove());
    header.dataset.instakitProfileUser = username;

    if (settings.enablePfpDownload) {
      const avatarImg =
        header.querySelector(`img[alt*="${username}"]`) || header.querySelector('img');
      const avatarWrap = avatarImg?.closest('div');
      if (avatarImg && avatarWrap && !avatarWrap.querySelector('[data-instakit-pfp]')) {
        if (getComputedStyle(avatarWrap).position === 'static') {
          avatarWrap.style.position = 'relative';
        }
        const pfpBtn = createIconBtn({
          tooltip: t('downloadPfp'),
          icon: 'download',
          variant: 'primary',
          size: 'sm',
          tooltipPos: 'bottom',
          onClick: async () => {
            let latest = userCache.get(username.toLowerCase());
            if (!latest?.pfpUrl) {
              latest = await resolveFromPageWorld('user', username);
            }
            const url = latest?.pfpUrl || getBestSrcFromImg(avatarImg);
            downloadSingle({
              url,
              username,
              type: 'pfp',
              id: 'avatar',
              ext: 'jpg',
            });
          },
        });
        pfpBtn.classList.add('instakit-pfp-corner');
        pfpBtn.setAttribute('data-instakit-pfp', '1');
        avatarWrap.appendChild(pfpBtn);
      }
    }

    const dock = document.createElement('div');
    dock.className = 'instakit-dock';
    dock.style.marginTop = '8px';
    dock.setAttribute('data-instakit-injected', 'true');
    dock.setAttribute('data-instakit-profile-dock', '1');

    const resolveUser = async () => {
      let latest = userCache.get(username.toLowerCase());
      if (!latest || (!latest.bio && !latest.fullName)) {
        const fetched = await resolveFromPageWorld('user', username);
        if (fetched) latest = fetched;
      }
      return latest;
    };

    if (settings.enableCopyUsername) {
      dock.appendChild(
        createIconBtn({
          tooltip: t('copyUser'),
          icon: 'atSign',
          size: 'sm',
          onClick: () => copyText(`@${username}`, 'Username', username),
        })
      );

      dock.appendChild(
        createIconBtn({
          tooltip: t('copyName'),
          icon: 'user',
          size: 'sm',
          onClick: async () => {
            const latest = await resolveUser();
            const domName =
              header.querySelector('section span[dir="auto"]')?.textContent?.trim() ||
              username;
            copyText(latest?.fullName || domName, 'Name', username);
          },
        })
      );
    }

    if (settings.enableBioActions) {
      const getBioPayload = async () => {
        const latest = await resolveUser();
        if (latest && (latest.bio || latest.externalUrl)) {
          return [
            `${latest.fullName || username} (@${username})`,
            latest.bio,
            latest.externalUrl,
          ]
            .filter(Boolean)
            .join('\n');
        }
        const candidates = Array.from(header.querySelectorAll('section span[dir="auto"], section h1'))
          .map((el) => el.textContent?.trim() || '')
          .filter(
            (txt) =>
              txt &&
              txt !== username &&
              !/^(posts?|followers?|following|follow|message|edit profile|منشور|متابع|يتابع|متابعة|مراسلة)$/i.test(
                txt
              )
          );
        const unique = Array.from(new Set(candidates));
        return unique.join('\n') || `@${username}`;
      };

      dock.appendChild(
        createIconBtn({
          tooltip: t('copyBio'),
          icon: 'copy',
          size: 'sm',
          onClick: async () => {
            const text = await getBioPayload();
            copyText(text, 'Bio', username);
          },
        })
      );

      dock.appendChild(
        createIconBtn({
          tooltip: t('downloadBio'),
          icon: 'fileText',
          size: 'sm',
          variant: 'primary',
          onClick: async () => {
            const text = await getBioPayload();
            const res = await sendMsg({
              action: 'DOWNLOAD_TEXT',
              username,
              type: 'bio',
              id: 'profile',
              text,
            });
            if (res?.ok) showToast(`${t('downloaded')}: ${res.filename}`);
          },
        })
      );
    }

    if (dock.children.length > 0) {
      header.appendChild(dock);
    }
  }

  const chatThread = /^\/direct\/t\/[^/]+/;
  const chatMedia = 'img, video';
  const chatComposer = 'textarea, [contenteditable]:not([contenteditable="false"])';
  const chatLabeledControls = 'button[aria-label], [role="button"][aria-label], svg[aria-label]';
  const chatCloseLabel = /^(close(?: media| viewer)?|إغلاق|اغلاق)$/i;
  const chatNextLabel = /^(next(?: slide| photo| image)?|التالي|الصورة التالية)$/i;
  const chatPreviousLabel = /^(previous(?: slide| photo| image)?|السابق|الصورة السابقة)$/i;
  let chatOpening;
  let chatViewer;

  function mediaKey(item) {
    const path = new URL(item.url).pathname;
    return path.slice(path.lastIndexOf('/') + 1);
  }

  function chatMediaEntries(root, minSize) {
    return [...root.querySelectorAll(chatMedia)].flatMap(element => {
      if (element.closest('header, footer, [data-instakit-injected]')) return [];
      if (Math.min(element.clientWidth || element.naturalWidth || 0,
        element.clientHeight || element.naturalHeight || 0) < minSize) return [];
      const item = element.matches('video') ? videoItem(element) : imageItem(element);
      return [{ element, item }];
    });
  }

  function chatDisplayedMedia(root) {
    const centerX = window.innerWidth / 2;
    const centerY = window.innerHeight / 2;
    return chatMediaEntries(root, 48).map(entry => {
      const box = entry.element.getBoundingClientRect();
      const width = Math.min(box.right, window.innerWidth) - Math.max(0, box.left);
      const height = Math.min(box.bottom, window.innerHeight) - Math.max(0, box.top);
      const style = getComputedStyle(entry.element);
      const distance = Math.hypot((box.left + box.right) / 2 - centerX,
        (box.top + box.bottom) / 2 - centerY);
      return { ...entry, area: width * height, distance, visible: width >= 48 && height >= 48 &&
        style.visibility === 'visible' && style.opacity !== '0' };
    }).filter(entry => entry.visible)
      .sort((a, b) => b.area / (1 + b.distance) - a.area / (1 + a.distance))[0];
  }

  function isChatViewerRoot(root) {
    if (!root.isConnected || root.closest('[data-instakit-injected], [hidden], [aria-hidden="true"], [inert]') ||
      !root.getClientRects().length || root.querySelector(chatComposer)) return false;
    if (root.matches('dialog[open], [aria-modal="true"]')) return true;
    return [...root.querySelectorAll(chatLabeledControls)].some(control =>
      chatCloseLabel.test(control.getAttribute('aria-label')));
  }

  function findChatViewer() {
    for (const root of [...document.querySelectorAll(postDialog)].reverse()) {
      if (isChatViewerRoot(root) && chatDisplayedMedia(root)) return root;
    }

    // Some versions render the media viewer as a fixed overlay without a dialog role.
    for (const node of document.querySelectorAll(chatLabeledControls)) {
      if (!chatCloseLabel.test(node.getAttribute('aria-label'))) continue;
      for (let root = node.parentElement; root && root !== document.body; root = root.parentElement) {
        if (root.clientWidth < window.innerWidth * 0.75 || root.clientHeight < window.innerHeight * 0.75) continue;
        if (getComputedStyle(root).position === 'fixed' && isChatViewerRoot(root) && chatDisplayedMedia(root)) return root;
      }
    }
    return null;
  }

  function noteChatMediaOpen(event) {
    if (!event.isTrusted || !(event.target instanceof Element) || !chatThread.test(location.pathname) ||
      (chatViewer && isChatViewerRoot(chatViewer.root) && chatDisplayedMedia(chatViewer.root))) return;
    const target = event.target;
    if (target.closest('a[href], header, [data-instakit-injected]')) return;
    const trigger = target.closest('button, [role="button"]');
    const media = target.closest(chatMedia) || [...(trigger?.querySelectorAll(chatMedia) || [])].find(element => {
      const box = element.getBoundingClientRect();
      return event.clientX >= box.left && event.clientX <= box.right &&
        event.clientY >= box.top && event.clientY <= box.bottom;
    });
    if (!media || Math.min(media.clientWidth, media.clientHeight) < 48) return;
    const group = media.closest('[role="row"], [role="listitem"], [data-message-id]') || trigger;
    const entries = group ? chatMediaEntries(group, 48) : [];
    chatOpening = {
      pathname: location.pathname,
      expires: performance.now() + 3000,
      previousViewer: findChatViewer(),
      images: entries.filter(entry => entry.item?.type === 'image').map(entry => entry.item),
      source: media.matches('img') ? imageItem(media) : null,
    };
    scheduleScan();
  }

  function chatAlbum(state, current) {
    const images = new Map();
    const remember = item => { if (item?.type === 'image') images.set(mediaKey(item), item); };
    const viewerImages = chatMediaEntries(state.root, 48).filter(entry => entry.item?.type === 'image');
    const inViewer = new Set(viewerImages.map(entry => mediaKey(entry.item)));
    // Only use message thumbnails when at least one image matches this viewer.
    if (state.source && inViewer.has(mediaKey(state.source))) state.images.forEach(remember);
    const hasNavigation = carouselButton(state.root, chatNextLabel) || carouselButton(state.root, chatPreviousLabel);
    if (hasNavigation) viewerImages.forEach(entry => remember(entry.item));
    remember(current);
    return { images, hasNavigation };
  }

  async function downloadChatAlbum(state) {
    if (state.collecting) return;
    const current = () => chatDisplayedMedia(state.root)?.item;
    const original = current();
    if (original?.type !== 'image') return;
    const { images, hasNavigation } = chatAlbum(state, original);
    const live = () => chatViewer === state && state.root.isConnected && location.pathname === state.pathname;
    const key = () => { const item = current(); return item && mediaKey(item); };
    const originalKey = mediaKey(original);
    const remember = () => {
      const item = current();
      if (item?.type === 'image') images.set(mediaKey(item), item);
    };
    const navButton = label => {
      const button = carouselButton(state.root, label);
      return button && !button.disabled && button.getAttribute('aria-disabled') !== 'true' ? button : null;
    };
    async function step(label) {
      const button = live() && navButton(label);
      if (!button) return false;
      const before = key();
      button.click();
      for (let attempt = 0; attempt < 15 && live(); attempt++) {
        await new Promise(resolve => setTimeout(resolve, 60));
        const after = key();
        if (after && after !== before) return true;
      }
      return false;
    }
    state.collecting = true;
    let offset = 0;
    let complete = true;
    try {
      if (hasNavigation) {
        for (const [label, delta] of [[chatPreviousLabel, -1], [chatNextLabel, 1]]) {
          let steps = 0;
          const seen = new Set([key()]);
          while (live() && navButton(label)) {
            if (++steps > 30 || !await step(label)) {
              complete = false;
              break;
            }
            offset += delta;
            remember();
            if (seen.has(key())) break;
            seen.add(key());
          }
        }
      }
    } finally {
      while (live() && offset !== 0 && key() !== originalKey) {
        const delta = offset > 0 ? -1 : 1;
        if (!await step(delta < 0 ? chatPreviousLabel : chatNextLabel)) break;
        offset += delta;
      }
      state.collecting = false;
      scheduleScan();
    }
    if (!live()) return;
    if (!complete || images.size < 2) return showToast(t('incompleteChatAlbum'));
    await downloadSequential({ items: [...images.values()], type: 'chat_album', id: Date.now() });
  }

  function injectChatViewerControls() {
    if (chatViewer && (chatViewer.pathname !== location.pathname || !isChatViewerRoot(chatViewer.root))) {
      chatViewer.dock?.remove();
      chatViewer = null;
    }
    if (!chatViewer && chatOpening) {
      if (chatOpening.pathname !== location.pathname || performance.now() >= chatOpening.expires) {
        chatOpening = null;
        return;
      }
      const root = findChatViewer();
      if (!root) return;
      if (root === chatOpening.previousViewer) return;
      chatViewer = { ...chatOpening, root };
      chatOpening = null;
    }
    if (!chatViewer || chatViewer.collecting) return;
    const state = chatViewer;
    const displayed = chatDisplayedMedia(state.root);
    if (!displayed) {
      state.dock?.remove();
      state.dock = null;
      return;
    }
    const video = displayed.element.matches('video');
    const album = !video ? chatAlbum(state, displayed.item) : null;
    const showAll = album && (album.images.size > 1 || album.hasNavigation);
    const layout = [video, Boolean(showAll), settings.lang].join(':');
    if (state.dock?.isConnected && layout === state.layout) return;
    state.dock?.remove();
    state.layout = layout;
    const dock = document.createElement('div');
    dock.className = 'instakit-chat-viewer-actions';
    dock.setAttribute('data-instakit-injected', 'true');
    dock.append(createIconBtn({
      tooltip: t(video ? 'downloadChatVideo' : 'downloadPhoto'),
      onClick: () => {
        const item = chatDisplayedMedia(state.root)?.item;
        if (!item || chatViewer !== state) return showToast(t('noMedia'));
        return downloadSingle({ ...item, type: item.type === 'video' ? 'chat_video' : 'chat_photo',
          id: Date.now() });
      },
    }));
    if (showAll) {
      const all = createIconBtn({ tooltip: t('downloadChatAll'), icon: 'layers',
        onClick: () => downloadChatAlbum(state) });
      const label = document.createElement('span');
      label.textContent = t('downloadChatAll');
      all.append(label);
      dock.append(all);
    }
    state.dock = dock;
    state.root.append(dock);
  }

  function scanAndInject() {
    const pathname = location.pathname;
    if (pathname !== lastPathname) {
      lastPathname = pathname;
      document.querySelectorAll('[data-instakit-storybar]').forEach((el) => el.remove());
    }
    applyAdaptiveTheme();
    injectChatViewerControls();
    if (/^\/direct(?:\/|$)/.test(pathname)) {
      document.querySelectorAll('[data-instakit-post-dock], [data-instakit-profile-dock], [data-instakit-pfp]')
        .forEach(el => el.remove());
      return;
    }
    const dialogs = [...document.querySelectorAll(postDialog)].filter(root =>
      !root.closest('[data-instakit-injected]') && root.querySelector('img, video')
    );
    for (const root of dialogs) {
      injectPostControls(root, { modal: true, reel: /\/reel\//.test(location.pathname) });
    }
    const articles = [...document.querySelectorAll('article')].filter(root => !root.closest(postDialog));
    for (const root of articles) injectPostControls(root, { permalink: !dialogs.length && articles.length === 1 });
    if (!dialogs.length && !articles.length && /^\/p\//.test(location.pathname)) {
      const root = document.querySelector('main, [role="main"]');
      if (root) injectPostControls(root, { permalink: true });
    }
    injectFeedReelControls();
    injectStoryAndHighlightControls();
    injectProfileControls();
  }

  let scanFrame;
  function scheduleScan() {
    if (scanFrame !== undefined) return;
    scanFrame = requestAnimationFrame(() => {
      scanFrame = undefined;
      scanAndInject();
    });
  }

  const observer = new MutationObserver(scheduleScan);

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });

  const chatViewerObserver = new MutationObserver(() => {
    if (chatOpening || chatViewer) scheduleScan();
  });
  chatViewerObserver.observe(document.documentElement, {
    subtree: true,
    attributes: true,
    attributeFilter: ['open', 'hidden', 'aria-hidden', 'aria-modal', 'aria-label', 'inert'],
  });

  document.addEventListener('click', noteChatMediaOpen, true);
  document.addEventListener('load', event => {
    if (chatThread.test(location.pathname) && event.target instanceof HTMLImageElement) scheduleScan();
  }, true);
  document.addEventListener('loadedmetadata', event => {
    if (chatThread.test(location.pathname) && event.target instanceof HTMLVideoElement) scheduleScan();
  }, true);
  window.addEventListener('popstate', scheduleScan);
  window.navigation?.addEventListener('navigatesuccess', scheduleScan);
  window.dispatchEvent(new CustomEvent('instakit:read-cache'));
  loadSettings();
})();
