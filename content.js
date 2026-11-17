(() => {
  const rtl = document.documentElement.lang.toLowerCase().startsWith("ar");
  const labels = rtl
    ? {
        download: "تحميل الفيديو",
        starting: "جاري البدء…",
        started: "بدأ التحميل",
        unavailable: "رابط الفيديو غير متاح للتحميل",
        failed: "تعذّر بدء التحميل"
      }
    : {
        download: "Download video",
        starting: "Starting…",
        started: "Download started",
        unavailable: "Direct video file unavailable",
        failed: "Could not start download"
      };

  const host = document.createElement("div");
  host.hidden = true;
  const shadow = host.attachShadow({ mode: "closed" });
  const styles = new CSSStyleSheet();
  styles.replaceSync([
    ":host { position: fixed; z-index: 2147483647; display: block; }",
    ":host([hidden]) { display: none; }",
    "button { box-sizing: border-box; max-width: calc(100vw - 24px); min-height: 36px;",
    "  padding: 6px 12px; border: 1px solid #ffffff66; border-radius: 999px;",
    "  background: #171717; color: #fff; font: 600 13px/1.25 system-ui, sans-serif;",
    "  cursor: pointer; }",
    "button:hover { background: #333; }",
    "button:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }",
    "button:disabled { cursor: wait; }",
    '[role="status"] { position: absolute; top: calc(100% + 4px); right: 0;',
    "  width: max-content; max-width: min(235px, calc(100vw - 24px)); padding: 5px 8px;",
    "  border-radius: 8px; background: #171717; color: #fff; font: 13px/1.3 system-ui, sans-serif;",
    "  pointer-events: none; }",
    '[role="status"]:empty { display: none; }'
  ].join("\n"));
  shadow.adoptedStyleSheets = [styles];

  const button = document.createElement("button");
  button.type = "button";
  button.textContent = labels.download;

  const status = document.createElement("span");
  status.setAttribute("role", "status");
  status.dir = rtl ? "rtl" : "ltr";
  shadow.append(button, status);
  document.body.append(host);

  let activeVideo = null;
  let activeSource = "";
  let activePath = "";
  let feedbackTimer;
  let pendingFrame = false;

  function currentCategory() {
    const path = location.pathname;
    if (path.startsWith("/stories/")) return "story";
    if (/^\/reels?(\/|$)/.test(path)) return "reel";
    if (path === "/" || /^\/(p|tv|explore)(\/|$)/.test(path)) return "post";
    if (/^\/[^/]+\/?$/.test(path) || /^\/[^/]+\/(reels|tagged)\/?$/.test(path)) {
      return "post";
    }
    return null;
  }

  function visibleVideoRect(video) {
    const rect = video.getBoundingClientRect();
    const left = Math.max(0, rect.left);
    const top = Math.max(0, rect.top);
    const right = Math.min(innerWidth, rect.right);
    const bottom = Math.min(innerHeight, rect.bottom);
    if (right - left < 48 || bottom - top < 64) return null;

    const centerX = (left + right) / 2;
    const centerY = (top + bottom) / 2;
    const targets = document.elementsFromPoint(centerX, centerY);
    if (!targets.includes(video) && !targets.includes(video.parentElement)) return null;
    return { top, right, centerX, centerY };
  }

  function selectVideo() {
    let best = null;
    for (const video of document.querySelectorAll("video")) {
      const rect = visibleVideoRect(video);
      if (!rect) continue;

      const distance = Math.hypot(
        (rect.centerX - innerWidth / 2) / innerWidth,
        (rect.centerY - innerHeight / 2) / innerHeight
      );
      const score = distance + (video.paused || video.ended ? 0.15 : 0);
      if (!best || score < best.score) best = { video, rect, score };
    }
    return best;
  }

  function clearFeedback() {
    clearTimeout(feedbackTimer);
    status.textContent = "";
  }

  function showFeedback(text) {
    clearFeedback();
    status.textContent = text;
    feedbackTimer = setTimeout(clearFeedback, 3500);
  }

  function update() {
    pendingFrame = false;
    const next = currentCategory() && selectVideo();
    const video = next?.video ?? null;
    const source = video?.currentSrc || video?.src || "";
    if (video !== activeVideo || source !== activeSource || location.pathname !== activePath) {
      clearFeedback();
    }
    activeVideo = video;
    activeSource = source;
    activePath = location.pathname;
    const shouldHide = !next;
    if (host.hidden !== shouldHide) host.hidden = shouldHide;
    if (!next) return;

    const left = Math.min(innerWidth - host.offsetWidth - 8,
      next.rect.right - host.offsetWidth - 10);
    host.style.left = Math.max(8, left) + "px";
    host.style.top = Math.max(8,
      Math.min(innerHeight - host.offsetHeight - 8, next.rect.top + 10)) + "px";
  }

  function scheduleUpdate() {
    if (pendingFrame) return;
    pendingFrame = true;
    requestAnimationFrame(update);
  }

  function videoFile(video) {
    const sources = [
      video.currentSrc,
      video.src,
      ...Array.from(video.querySelectorAll("source[src]"), source => source.src)
    ];
    for (const source of sources) {
      const media = getDownloadableVideo(source);
      if (media) return media;
    }
    return null;
  }

  button.addEventListener("click", async event => {
    event.stopPropagation();
    if (!event.isTrusted || button.disabled) return;

    const video = activeVideo;
    update();
    if (!video || video !== activeVideo) return;

    const media = videoFile(video);
    if (!media) {
      showFeedback(labels.unavailable);
      return;
    }

    const requestedPath = activePath;
    const requestedSource = activeSource;
    button.disabled = true;
    showFeedback(labels.starting);
    let started = false;
    try {
      const response = await chrome.runtime.sendMessage({
        type: "download-instagram-video",
        url: media.url,
        category: currentCategory()
      });
      started = response?.started === true;
    } catch {
      // Chrome may reject the request after the extension or tab is reloaded.
    } finally {
      button.disabled = false;
    }

    if (video === activeVideo && requestedPath === activePath && requestedSource === activeSource) {
      showFeedback(started ? labels.started : labels.failed);
    }
  });

  new MutationObserver(scheduleUpdate).observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["src", "hidden", "aria-hidden"]
  });

  for (const event of ["loadedmetadata", "emptied", "play", "pause"]) {
    document.addEventListener(event, scheduleUpdate, true);
  }
  for (const event of ["scroll", "resize", "popstate"]) {
    window.addEventListener(event, scheduleUpdate, { capture: true, passive: true });
  }
  window.navigation?.addEventListener("navigatesuccess", scheduleUpdate);
  scheduleUpdate();
})();
