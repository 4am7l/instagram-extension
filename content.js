(() => {
  const rtl = document.documentElement.lang.toLowerCase().startsWith("ar");
  const labels = rtl
    ? {
        download: "تحميل الفيديو",
        starting: "جاري البدء…",
        started: "بدأ التحميل",
        recording: "جاري حفظ الفيديو. خلّيه يشتغل للآخر.",
        failed: "تعذّر حفظ الفيديو"
      }
    : {
        download: "Download video",
        starting: "Starting…",
        started: "Download started",
        recording: "Saving video. Let it play to the end.",
        failed: "Could not save this video"
      };

  const host = document.createElement("div");
  host.hidden = true;
  const shadow = host.attachShadow({ mode: "closed" });
  const styles = new CSSStyleSheet();
  styles.replaceSync([
    ":host { position: fixed; z-index: 2147483647; display: block; }",
    ":host([hidden]) { display: none; }",
    "button { box-sizing: border-box; width: 30px; height: 30px; display: grid; place-items: center;",
    "  padding: 0; border: 1px solid #ffffff66; border-radius: 50%;",
    "  background: #171717; color: #fff; cursor: pointer; }",
    "button svg { width: 16px; height: 16px; }",
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
  button.title = labels.download;
  button.setAttribute("aria-label", labels.download);
  const svgNamespace = "http://www.w3.org/2000/svg";
  const icon = document.createElementNS(svgNamespace, "svg");
  icon.setAttribute("viewBox", "0 0 24 24");
  icon.setAttribute("aria-hidden", "true");
  const arrow = document.createElementNS(svgNamespace, "path");
  arrow.setAttribute("d", "M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4");
  arrow.setAttribute("fill", "none");
  arrow.setAttribute("stroke", "currentColor");
  arrow.setAttribute("stroke-width", "2");
  arrow.setAttribute("stroke-linecap", "round");
  arrow.setAttribute("stroke-linejoin", "round");
  icon.append(arrow);
  button.append(icon);

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
    const dialog = targets[0]?.closest('[role="dialog"], dialog[open]');
    if (dialog && !dialog.contains(video)) return null;
    return { left, top, right, centerX, centerY };
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

  function showFeedback(text, persistent = false) {
    clearFeedback();
    status.textContent = text;
    if (!persistent) feedbackTimer = setTimeout(clearFeedback, 3500);
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

    const post = currentCategory() === "post" && video.closest("article");
    const bounds = post ? post.getBoundingClientRect() : next.rect;
    const width = host.offsetWidth;
    const height = host.offsetHeight;
    let left = bounds.right + 6;
    let top = Math.max(6, next.rect.top);
    if (left + width + 6 > innerWidth) {
      left = bounds.left - width - 6;
      if (left < 6) {
        left = Math.max(6, next.rect.right - width - 6);
        top = next.rect.top - height - 4;
      }
    }
    host.style.left = left + "px";
    host.style.top = Math.max(6, Math.min(innerHeight - height - 6, top)) + "px";
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
    const category = currentCategory();
    const requestedPath = activePath;
    const requestedSource = activeSource;
    button.disabled = true;
    let started = false;
    try {
      if (media) {
        showFeedback(labels.starting);
        try {
          const response = await chrome.runtime.sendMessage({
            type: "download-instagram-video",
            url: media.url,
            category
          });
          started = response?.started === true;
        } catch {
          // Use playback capture if the browser rejects the direct request.
        }
      }
      if (!started && video === activeVideo && requestedPath === activePath &&
          requestedSource === activeSource) {
        showFeedback(labels.recording, true);
        saveRecordedVideo(await recordInstagramVideo(video), category);
        started = true;
      }
    } catch {
      // The status below reports a failed or interrupted capture.
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
