(() => {
  const arabic = document.documentElement.lang.toLowerCase().startsWith("ar");
  const labels = arabic
    ? {
        download: "تحميل الفويس",
        playFirst: "شغّل نفس الفويس شوي، وبعدين جرّب التحميل",
        started: "بدأ تحميل الفويس",
        failed: "تعذّر تحميل الفويس"
      }
    : {
        download: "Download voice message",
        playFirst: "Play this voice message briefly, then try downloading it again",
        started: "Voice download started",
        failed: "Could not download this voice message"
      };

  const waveformSelector = [
    'svg[aria-label="Waveform for audio message" i]',
    'svg[aria-label*="موجة"][aria-label*="صوت"]'
  ].join(",");
  const playSelector = [
    '[aria-label="Play" i]', '[aria-label="Pause" i]',
    '[aria-label="تشغيل"]', '[aria-label="إيقاف مؤقت"]'
  ].join(",");
  const progressSelector = '[aria-label="Audio progress bar" i], [role="slider"]';
  const players = new Map();
  let scannedPath;
  let scanFrame;

  const styles = new CSSStyleSheet();
  styles.replaceSync(`
    :host { position: relative; display: inline-flex; flex: none; align-self: center;
      vertical-align: middle; margin-inline: 4px; }
    button { box-sizing: border-box; display: grid; place-items: center;
      width: 28px; height: 28px; padding: 0; border-radius: 50%; border: 1px solid #ffffff66;
      background: #171717; color: white; cursor: pointer; font: 18px/1 system-ui, sans-serif; }
    button:hover { background: #353535; }
    button:focus-visible { outline: 2px solid #0095f6; outline-offset: 2px; }
    span { position: absolute; inset-block-start: calc(100% + 4px); inset-inline-end: 0;
      z-index: 10; width: max-content; max-width: min(230px, 60vw); padding: 5px 8px;
      border-radius: 6px; background: #171717; color: white; pointer-events: none;
      font: 12px/1.4 system-ui, sans-serif; }
    span:empty { display: none; }
  `);

  function audioSource(player) {
    const audio = player.matches("audio") ? player : player.querySelector("audio");
    return audio?.currentSrc || audio?.src || audio?.querySelector("source[src]")?.src || "";
  }

  function readVoiceSource(source) {
    const direct = getDownloadableVoice(source);
    if (direct) return direct;
    if (typeof source !== "string" || !source.startsWith("blob:" + location.origin + "/")) return null;

    return {
      url: source,
      file: fetch(source)
        .then(response => response.ok ? response.blob() : null)
        .catch(() => null)
    };
  }

  function saveVoiceBlob(blob) {
    const extension = {
      "audio/mp4": "m4a", "video/mp4": "m4a", "audio/x-m4a": "m4a",
      "audio/mpeg": "mp3", "audio/aac": "aac", "audio/ogg": "ogg",
      "application/ogg": "ogg", "audio/opus": "opus", "audio/webm": "webm",
      "video/webm": "webm", "audio/wav": "wav", "audio/x-wav": "wav"
    }[blob?.type.split(";")[0]];
    if (!blob?.size || !extension) return false;

    const link = document.createElement("a");
    const objectUrl = URL.createObjectURL(blob);
    link.href = objectUrl;
    link.download = "instagram-voice-" + new Date().toISOString().replace(/[:.]/g, "-") + "." + extension;
    link.hidden = true;
    document.body.append(link);
    try {
      link.click();
      return true;
    } finally {
      link.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    }
  }

  function addPlayer(player) {
    const host = document.createElement("span");
    const shadow = host.attachShadow({ mode: "closed" });
    shadow.adoptedStyleSheets = [styles];

    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("aria-label", labels.download);
    button.title = labels.download;
    button.textContent = "↓";

    const status = document.createElement("span");
    status.setAttribute("role", "status");
    shadow.append(button, status);
    player.after(host);

    const path = location.pathname;
    let timer;
    const record = { host, source: null, control: null };
    const capture = event => {
      if (location.pathname === path && event.target === player) {
        record.source = readVoiceSource(event.detail);
      }
    };
    player.addEventListener("ig-voice-source", capture);

    record.remove = () => {
      clearTimeout(timer);
      player.removeEventListener("ig-voice-source", capture);
      player.removeAttribute("data-ig-voice-player");
      record.control?.removeAttribute("data-ig-voice-play");
      host.remove();
    };

    function show(text) {
      clearTimeout(timer);
      status.textContent = text;
      timer = setTimeout(() => { status.textContent = ""; }, 3500);
    }

    button.addEventListener("click", async event => {
      event.stopPropagation();
      if (!event.isTrusted || location.pathname !== path || !player.isConnected || button.disabled) return;

      const current = audioSource(player);
      const source = current && current !== record.source?.url ? readVoiceSource(current) : record.source;
      if (!source) {
        show(labels.playFirst);
        return;
      }

      button.disabled = true;
      try {
        let started;
        if (source.file) {
          const blob = await source.file;
          if (location.pathname !== path || !player.isConnected || !host.isConnected) return;
          started = saveVoiceBlob(blob);
        } else {
          const response = await chrome.runtime.sendMessage({
            type: "download-instagram-voice",
            url: source.url
          });
          started = response?.started === true;
        }
        show(started ? labels.started : labels.failed);
      } catch {
        show(labels.failed);
      } finally {
        button.disabled = false;
      }
    });

    players.set(player, record);
    return record;
  }

  function scan() {
    scanFrame = undefined;
    const path = location.pathname;
    if (scannedPath !== path) {
      for (const record of players.values()) record.remove();
      players.clear();
      scannedPath = path;
    }
    if (!/^\/direct\/t\/[^/]+/.test(path)) return;

    const visiblePlayers = new Map();
    for (const waveform of document.querySelectorAll(waveformSelector)) {
      const player = waveform.parentElement;
      const control = player?.querySelector(playSelector);
      if (control && player.querySelector(progressSelector)) {
        visiblePlayers.set(player, control.closest('button,[role="button"]') || control);
      }
    }
    const waveformPlayers = [...visiblePlayers.keys()];
    for (const audio of document.querySelectorAll('audio[controls]')) {
      if (!waveformPlayers.some(player => player.contains(audio))) visiblePlayers.set(audio, null);
    }
    for (const [player, record] of players) {
      if (visiblePlayers.has(player) && record.host.isConnected) continue;
      record.remove();
      players.delete(player);
    }
    for (const [player, control] of visiblePlayers) {
      const record = players.get(player) || addPlayer(player);
      if (record.control !== control) {
        record.control?.removeAttribute("data-ig-voice-play");
        record.control = control;
      }
      player.setAttribute("data-ig-voice-player", "");
      const label = control?.getAttribute("aria-label") || control?.querySelector(playSelector)?.getAttribute("aria-label");
      const action = /^(pause|إيقاف مؤقت)$/i.test(label) ? "pause" : "play";
      if (control) control.dataset.igVoicePlay = action;
    }
  }

  function scheduleScan() {
    if (scanFrame === undefined) scanFrame = requestAnimationFrame(scan);
  }

  new MutationObserver(() => {
    if (location.pathname.startsWith("/direct/t/") || players.size) scheduleScan();
  }).observe(document.body, {
    childList: true, subtree: true, attributes: true, attributeFilter: ["aria-label", "controls"]
  });
  window.addEventListener("popstate", scheduleScan);
  window.navigation?.addEventListener("navigatesuccess", scheduleScan);
  scheduleScan();
})();
