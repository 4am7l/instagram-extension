/**
 * InstaKit Page Interceptor (MAIN world)
 * Passively reads Instagram API/GraphQL responses and provides reliable on-demand
 * resolution (cache + React fiber + authenticated fetch fallback) for posts,
 * carousels, reels, stories, highlights, PFP, bio, and captions.
 */
(() => {
  if (window.__INSTAKIT_INTERCEPTOR__) return;
  window.__INSTAKIT_INTERCEPTOR__ = true;

  const mediaCache = new Map();
  const userCache = new Map();
  const storyCache = new Map();

  function emit(type, payload) {
    window.dispatchEvent(
      new CustomEvent('instakit:cache-update', {
        detail: { type, payload },
      })
    );
  }

  function pickBestCandidate(candidates) {
    if (!Array.isArray(candidates) || candidates.length === 0) return null;
    return (
      candidates
        .slice()
        .sort(
          (a, b) =>
            (b.width || 0) * (b.height || 0) - (a.width || 0) * (a.height || 0)
        )[0]?.url || null
    );
  }

  function pickBestVideo(versions) {
    if (!Array.isArray(versions) || versions.length === 0) return null;
    return (
      versions
        .filter(version => usableVideo(version?.url))
        .sort(
          (a, b) =>
            (b.width || 0) * (b.height || 0) - (a.width || 0) * (a.height || 0)
        )[0]?.url || null
    );
  }

  function usableVideo(source) {
    try {
      const url = new URL(source);
      return url.protocol === 'https:' && /\.(mp4|webm|m4v|mov)$/i.test(url.pathname) &&
        !url.searchParams.has('bytestart') && !url.searchParams.has('byteend');
    } catch {
      return false;
    }
  }

  function extractReelTray(reel) {
    if (!reel || typeof reel !== 'object' || !Array.isArray(reel.items)) return;
    const rawId = String(reel.id || '');
    const highlightMatch = rawId.match(/highlight:(\d+)/);
    const key = highlightMatch ? `highlight:${highlightMatch[1]}` : rawId;
    const username = reel.user?.username || '';
    const title = reel.title || '';

    const items = [];
    for (const item of reel.items) {
      const videoUrl = pickBestVideo(item.video_versions) || item.video_url;
      const imageUrl =
        pickBestCandidate(item.image_versions2?.candidates) || item.display_url;
      if (videoUrl) {
        items.push({
          id: String(item.pk || item.id || items.length + 1),
          type: 'video',
          url: videoUrl,
          poster: imageUrl,
          username: item.user?.username || username,
        });
      } else if (imageUrl) {
        items.push({
          id: String(item.pk || item.id || items.length + 1),
          type: 'image',
          url: imageUrl,
          poster: imageUrl,
          username: item.user?.username || username,
        });
      }
    }

    if (items.length > 0 && (key || username)) {
      const entry = {
        key: key || username,
        isHighlight: Boolean(highlightMatch),
        highlightId: highlightMatch ? highlightMatch[1] : null,
        title,
        username: username || items[0]?.username || 'instagram',
        items,
      };
      if (entry.highlightId) storyCache.set(`highlight:${entry.highlightId}`, entry);
      if (entry.username) storyCache.set(`user:${entry.username.toLowerCase()}`, entry);
      emit('story', entry);
    }
  }

  function extractMediaItem(node) {
    if (!node || typeof node !== 'object') return;

    const code = node.code || node.shortcode;
    const id = node.pk || node.id;
    const owner = node.user || node.owner || {};
    const username = owner.username || '';

    if (
      username &&
      (owner.hd_profile_pic_url_info?.url ||
        owner.profile_pic_url_hd ||
        owner.profile_pic_url ||
        owner.biography !== undefined)
    ) {
      const prev = userCache.get(username.toLowerCase()) || {};
      const userEntry = {
        username,
        id: String(owner.pk || owner.id || prev.id || ''),
        fullName: owner.full_name || prev.fullName || '',
        bio: owner.biography !== undefined ? owner.biography : prev.bio || '',
        externalUrl: owner.external_url || prev.externalUrl || '',
        pfpUrl:
          owner.hd_profile_pic_url_info?.url ||
          owner.profile_pic_url_hd ||
          owner.profile_pic_url ||
          prev.pfpUrl ||
          '',
      };
      userCache.set(username.toLowerCase(), userEntry);
      emit('user', userEntry);
    }

    if (code) {
      const caption = node.caption?.text ?? node.edge_media_to_caption?.edges?.[0]?.node?.text;
      const children = node.carousel_media || node.edge_sidecar_to_children?.edges?.map(edge => edge.node);
      const isCarousel = Array.isArray(children) && children.length > 0;
      const slides = (isCarousel ? children : [node]).map(item => {
        const videoUrl = pickBestVideo(item?.video_versions) || (usableVideo(item?.video_url) ? item.video_url : '');
        const imageUrl = pickBestCandidate(item?.image_versions2?.candidates) || item?.display_url || '';
        if (videoUrl || item?.is_video || item?.media_type === 2 || item?.__typename === 'GraphVideo') {
          return { type: 'video', url: videoUrl, poster: imageUrl };
        }
        return { type: 'image', url: imageUrl, poster: imageUrl };
      });
      if (slides.some(slide => slide.url || slide.poster) || typeof caption === 'string') {
        const existing = mediaCache.get(code);
        const completeSlides = slides.length >= (existing?.slides.length || 0)
          ? slides.map((slide, index) => {
              const previous = existing?.slides.length === slides.length ? existing.slides[index] : null;
              return previous?.type === slide.type && !slide.url ? { ...slide, ...previous } : slide;
            })
          : existing.slides;
        const expected = Math.max(Number(node.carousel_media_count) || 0, slides.length, existing?.expected || 0);
        const entry = {
          code,
          id: id ? String(id) : (existing?.id || code),
          username: username || existing?.username || '',
          fullName: owner.full_name || existing?.fullName || '',
          caption: typeof caption === 'string' ? caption : (existing?.caption || ''),
          expected,
          slides: completeSlides,
        };
        mediaCache.delete(code);
        mediaCache.set(code, entry);
        if (mediaCache.size > 160) mediaCache.delete(mediaCache.keys().next().value);
        emit('media', entry);
      }
    }
  }

  function walkObject(obj, depth = 0, seen = new WeakSet()) {
    if (!obj || typeof obj !== 'object' || depth > 28) return;
    if (seen.has(obj)) return;
    seen.add(obj);

    if (Array.isArray(obj)) {
      for (const item of obj) {
        walkObject(item, depth + 1, seen);
      }
      return;
    }

    if (Array.isArray(obj.items) && (obj.id || obj.reel_type || obj.user)) {
      extractReelTray(obj);
    }

    if (obj.code || obj.shortcode) {
      extractMediaItem(obj);
    }

    if (
      obj.username &&
      (obj.biography !== undefined ||
        obj.profile_pic_url_hd ||
        obj.hd_profile_pic_url_info)
    ) {
      const prev = userCache.get(obj.username.toLowerCase()) || {};
      const userEntry = {
        username: obj.username,
        id: String(obj.pk || obj.id || prev.id || ''),
        fullName: obj.full_name || prev.fullName || '',
        bio: obj.biography !== undefined ? obj.biography : prev.bio || '',
        externalUrl: obj.external_url || prev.externalUrl || '',
        pfpUrl:
          obj.hd_profile_pic_url_info?.url ||
          obj.profile_pic_url_hd ||
          obj.profile_pic_url ||
          prev.pfpUrl ||
          '',
      };
      userCache.set(obj.username.toLowerCase(), userEntry);
      emit('user', userEntry);
    }

    for (const key of Object.keys(obj)) {
      if (key === 'return' || key === '_owner' || key === 'stateNode') continue;
      const val = obj[key];
      if (val && typeof val === 'object') {
        walkObject(val, depth + 1, seen);
      } else if (typeof val === 'string' && /^(json_payload|__bbox_json|payload)$/.test(key) && /^[{[]/.test(val)) {
        try { walkObject(JSON.parse(val), depth + 1, seen); } catch {}
      }
    }
  }

  function inspectPayloadText(text) {
    if (!text || typeof text !== 'string') return;
    const cleaned = text.trim().replace(/^for\s*\(;;\);\s*/, '');
    try {
      walkObject(JSON.parse(cleaned));
    } catch {
      for (const line of cleaned.split('\n')) {
        if (!/^\s*[{[]/.test(line)) continue;
        try { walkObject(JSON.parse(line)); } catch {}
      }
    }
  }

  function scanEmbedded(documentRoot) {
    for (const script of documentRoot.querySelectorAll('script[type="application/json"]')) {
      if (/video_url|video_versions|carousel_media|edge_sidecar_to_children|image_versions2|display_url|biography|profile_pic/.test(script.textContent)) {
        inspectPayloadText(script.textContent);
      }
    }
  }

  function scanPostDocument(html, key) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    scanEmbedded(doc);
    const canonical = doc.querySelector('link[rel="canonical"]')?.href || '';
    if (!canonical.split(/[/?#]/).includes(key) || (mediaCache.get(key)?.expected || 0) > 1) return;
    const video = doc.querySelector('meta[property="og:video:secure_url"], meta[property="og:video"]')?.content;
    if (usableVideo(video) && !mediaCache.get(key)?.slides?.some(slide => slide.type === 'video' && slide.url)) {
      extractMediaItem({
        shortcode: key, video_url: video,
        display_url: doc.querySelector('meta[property="og:image"]')?.content || '',
      });
    }
  }

  function mediaEndpoint(source) {
    try {
      const url = new URL(source, location.origin);
      return url.origin === location.origin && !url.pathname.startsWith('/api/v1/direct') &&
        (url.pathname.includes('/graphql') || url.pathname.includes('/api/v1/') || url.searchParams.has('query_hash'));
    } catch {
      return false;
    }
  }

  const origFetch = window.fetch;
  window.fetch = async function (...args) {
    const res = await origFetch.apply(this, args);
    try {
      const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
      if (mediaEndpoint(url)) {
        const clone = res.clone();
        clone.text().then(inspectPayloadText).catch(() => {});
      }
    } catch {
      // Ignore interceptor errors
    }
    return res;
  };

  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__instakitUrl = typeof url === 'string' ? url : '';
    return origOpen.call(this, method, url, ...rest);
  };

  XMLHttpRequest.prototype.send = function (...args) {
    this.addEventListener('load', function () {
      try {
        const url = this.__instakitUrl || '';
        if (mediaEndpoint(url)) {
          if (this.responseType === 'json') walkObject(this.response);
          else if (this.responseType === '' || this.responseType === 'text') inspectPayloadText(this.responseText);
        }
      } catch {
        // Ignore
      }
    });
    return origSend.apply(this, args);
  };

  function scanReactNodes(selector) {
    document.querySelectorAll(selector).forEach((el) => {
      for (const key of Object.keys(el)) {
        if (key.startsWith('__reactProps')) walkObject(el[key]);
        if (!key.startsWith('__reactFiber')) continue;
        let fiber = el[key];
        for (let depth = 0; fiber && depth < 8; depth++, fiber = fiber.return) {
          walkObject(fiber.memoizedProps);
        }
      }
    });
  }

  async function resolveOnDemand(kind, key) {
    if (kind === 'post') {
      if (!/^[A-Za-z0-9_-]{1,32}$/.test(key)) return null;
      const complete = entry => entry?.slides?.length === entry?.expected && entry?.slides?.every(slide => slide.url);
      const cached = mediaCache.get(key);
      if (complete(cached) && cached.caption) return cached;

      scanReactNodes('article, section, main, [role="dialog"], video');
      const fromPage = mediaCache.get(key);
      if (complete(fromPage) && fromPage.caption) return fromPage;

      try {
        const path = '/p/' + key + '/';
        const res = await origFetch(new URL(path, location.origin), {
          credentials: 'same-origin',
          signal: AbortSignal.timeout(3400),
        });
        if (res.ok) {
          const body = await res.text();
          if (/application\/json/i.test(res.headers.get('content-type') || '')) inspectPayloadText(body);
          else scanPostDocument(body, key);
        }
      } catch {
        // The active page may still provide a playable URL or a visible caption.
      }
      return mediaCache.get(key) || null;
    }

    if (kind === 'user') {
      const lower = String(key || '').toLowerCase();
      const existing = userCache.get(lower);
      if (existing && (existing.bio || existing.pfpUrl)) return existing;
      try {
        const res = await origFetch(
          `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(
            key
          )}`,
          {
            credentials: 'include',
            headers: { 'x-ig-app-id': '936619743392459' },
          }
        );
        if (res.ok) inspectPayloadText(await res.text());
      } catch {
        // Ignore
      }
      return userCache.get(lower) || null;
    }

    if (kind === 'highlight') {
      const cacheKey = `highlight:${key}`;
      if (storyCache.get(cacheKey)?.items?.length > 0) return storyCache.get(cacheKey);
      scanReactNodes('section');
      if (storyCache.get(cacheKey)?.items?.length > 0) return storyCache.get(cacheKey);
      try {
        const res = await origFetch(
          `https://www.instagram.com/api/v1/feed/reels_media/?reel_ids=highlight:${key}`,
          {
            credentials: 'include',
            headers: { 'x-ig-app-id': '936619743392459' },
          }
        );
        if (res.ok) inspectPayloadText(await res.text());
      } catch {
        // Ignore
      }
      return storyCache.get(cacheKey) || null;
    }

    if (kind === 'story') {
      const lower = String(key || '').toLowerCase();
      const cacheKey = `user:${lower}`;
      if (storyCache.get(cacheKey)?.items?.length > 0) return storyCache.get(cacheKey);
      scanReactNodes('section');
      if (storyCache.get(cacheKey)?.items?.length > 0) return storyCache.get(cacheKey);

      let cachedUser = userCache.get(lower);
      if (!cachedUser?.id) {
        cachedUser = await resolveOnDemand('user', key);
      }
      if (cachedUser?.id) {
        try {
          const res = await origFetch(
            `https://www.instagram.com/api/v1/feed/reels_media/?reel_ids=${cachedUser.id}`,
            {
              credentials: 'include',
              headers: { 'x-ig-app-id': '936619743392459' },
            }
          );
          if (res.ok) inspectPayloadText(await res.text());
        } catch {
          // Ignore
        }
      }
      return storyCache.get(cacheKey) || null;
    }

    return null;
  }

  window.addEventListener('instakit:resolve-media', async (e) => {
    const { requestId, kind, key } = e.detail || {};
    const result = await resolveOnDemand(kind, key);
    window.dispatchEvent(
      new CustomEvent('instakit:resolve-result', {
        detail: { requestId, result },
      })
    );
  });

  window.addEventListener('instakit:read-cache', () => {
    for (const entry of mediaCache.values()) emit('media', entry);
    for (const entry of userCache.values()) emit('user', entry);
    for (const entry of new Set(storyCache.values())) emit('story', entry);
  });
  window.addEventListener('DOMContentLoaded', () => scanEmbedded(document));
})();
