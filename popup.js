const COPY = {
  ar: {
    subtitle: 'أداة تنزيل ونسخ إنستغرام',
    togglesTitle: 'الأزرار المفعّلة داخل إنستغرام',
    lblPost: 'تنزيل كل صور البوست والكاروسيل',
    lblReel: 'تحميل الريلز (Reels)',
    lblPhoto: 'تحميل الصورة المحددة والصور HD',
    lblStory: 'تحميل الستوري والهايلايت',
    lblPfp: 'تحميل صورة البروفايل (PFP)',
    lblBio: 'نسخ الوصف وتحميل البايو',
    lblUser: 'نسخ الاسم واليوزرنيم',
    lblBatchMode: 'طريقة التحميل المتعدد',
    optAsk: 'تحديد واختيار (ZIP أو متتالي)',
    optZip: 'ملف ZIP واحد تلقائياً',
    optSeq: 'تنزيل متتالي (ملف ملف)',
    lblPattern: 'صيغة اسم الملف',
    historyTitle: 'آخر العمليات',
    clearHistory: 'مسح',
    empty: 'لا توجد تنزيلات أو نسخ حديثة بعد.',
    langBtn: 'EN',
    themes: { auto: 'تلقائي', light: 'فاتح', dark: 'داكن' },
  },
  en: {
    subtitle: 'Instagram Downloader & Copy Kit',
    togglesTitle: 'Active Controls on Instagram',
    lblPost: 'Download All Post Photos',
    lblReel: 'Download Reels (MP4)',
    lblPhoto: 'Download Selected Photo & HD',
    lblStory: 'Download Stories & Highlights',
    lblPfp: 'Download Profile Picture (PFP)',
    lblBio: 'Copy Captions & Save Bio',
    lblUser: 'Copy Display Name & @username',
    lblBatchMode: 'Multi-Download Mode',
    optAsk: 'Pick & Choose (ZIP or Sequential)',
    optZip: 'Auto Bundle in .ZIP',
    optSeq: 'Auto Sequential (One-by-One)',
    lblPattern: 'Filename Template',
    historyTitle: 'Recent Activity',
    clearHistory: 'Clear',
    empty: 'No recent downloads or copies yet.',
    langBtn: 'AR',
    themes: { auto: 'Auto', light: 'Light', dark: 'Dark' },
  },
};

const DEFAULTS = {
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

function applyTheme(theme) {
  const isDark =
    theme === 'dark' ||
    (theme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
}

function applyLanguage(lang, theme) {
  const dict = COPY[lang] || COPY.ar;
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
  Object.keys(dict).forEach((id) => {
    const el = document.getElementById(id);
    if (el && typeof dict[id] === 'string') el.textContent = dict[id];
  });
  const themeBtn = document.getElementById('themeToggle');
  if (themeBtn) themeBtn.textContent = dict.themes[theme] || dict.themes.auto;
}

function renderHistory(items, lang) {
  const list = document.getElementById('historyList');
  list.innerHTML = '';
  if (!items || items.length === 0) {
    const li = document.createElement('li');
    li.className = 'history-empty';
    li.textContent = (COPY[lang] || COPY.ar).empty;
    list.appendChild(li);
    return;
  }

  items.slice(0, 12).forEach((item) => {
    const li = document.createElement('li');
    li.className = 'history-item';

    const name = document.createElement('span');
    name.className = 'history-name';
    name.textContent = item.filename || 'item';

    const type = document.createElement('span');
    type.className = 'history-type';
    type.textContent = item.type || 'media';

    li.appendChild(name);
    li.appendChild(type);
    list.appendChild(li);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  chrome.storage.sync.get(DEFAULTS, (rawSettings) => {
    const settings = chrome.runtime.lastError || !rawSettings ? { ...DEFAULTS } : { ...DEFAULTS, ...rawSettings };
    applyTheme(settings.theme);
    applyLanguage(settings.lang, settings.theme);

    document.querySelectorAll('input[data-setting]').forEach((input) => {
      const key = input.dataset.setting;
      input.checked = Boolean(settings[key]);
      input.addEventListener('change', () => {
        chrome.storage.sync.set({ [key]: input.checked });
      });
    });

    const batchSelect = document.getElementById('batchMode');
    batchSelect.value = settings.batchMode || DEFAULTS.batchMode;
    batchSelect.addEventListener('change', () => {
      chrome.storage.sync.set({ batchMode: batchSelect.value });
    });

    const patternSelect = document.getElementById('filenamePattern');
    patternSelect.value = settings.filenamePattern || DEFAULTS.filenamePattern;
    patternSelect.addEventListener('change', () => {
      chrome.storage.sync.set({ filenamePattern: patternSelect.value });
    });

    document.getElementById('themeToggle').addEventListener('click', () => {
      const order = ['auto', 'light', 'dark'];
      chrome.storage.sync.get({ theme: 'auto', lang: 'ar' }, (curr) => {
        const safeCurr = chrome.runtime.lastError || !curr ? { theme: 'auto', lang: 'ar' } : curr;
        const idx = order.indexOf(safeCurr.theme);
        const next = order[(idx >= 0 ? idx + 1 : 1) % order.length];
        chrome.storage.sync.set({ theme: next }, () => {
          applyTheme(next);
          applyLanguage(safeCurr.lang, next);
        });
      });
    });

    document.getElementById('langToggle').addEventListener('click', () => {
      chrome.storage.sync.get({ lang: 'ar', theme: 'auto' }, (curr) => {
        const safeCurr = chrome.runtime.lastError || !curr ? { lang: 'ar', theme: 'auto' } : curr;
        const next = safeCurr.lang === 'ar' ? 'en' : 'ar';
        chrome.storage.sync.set({ lang: next }, () => {
          applyLanguage(next, safeCurr.theme);
          chrome.storage.local.get({ history: [] }, (d) =>
            renderHistory(d && !chrome.runtime.lastError ? d.history : [], next)
          );
        });
      });
    });

    chrome.storage.local.get({ history: [] }, (data) => {
      renderHistory(data && !chrome.runtime.lastError ? data.history : [], settings.lang);
    });
  });

  document.getElementById('clearHistory').addEventListener('click', () => {
    chrome.storage.local.set({ history: [] }, () => {
      chrome.storage.sync.get({ lang: 'ar' }, (s) =>
        renderHistory([], s && !chrome.runtime.lastError ? s.lang : 'ar')
      );
    });
  });
});
