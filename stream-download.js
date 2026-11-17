function seekToBeginning(video) {
  if (video.currentTime < 0.05 && !video.seeking) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const listeners = new AbortController();
    const timeout = setTimeout(() => finish(new Error("Seek timed out")), 8000);
    function finish(error) {
      clearTimeout(timeout);
      listeners.abort();
      if (error) reject(error);
      else resolve();
    }
    const options = { once: true, signal: listeners.signal };
    video.addEventListener("seeked", () => finish(), options);
    video.addEventListener("emptied", () => finish(new Error("Video changed")), options);
    video.addEventListener("error", () => finish(new Error("Video error")), options);
    try {
      video.currentTime = 0;
    } catch (error) {
      finish(error);
    }
  });
}

function capturePlayback(video, stream, pageUrl, source) {
  const mimeType = ["video/mp4", "video/webm"]
    .find(type => MediaRecorder.isTypeSupported(type));
  if (!mimeType || !stream.getVideoTracks().length) {
    throw new Error("Video stream cannot be recorded");
  }

  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8000000 });

  return new Promise((resolve, reject) => {
    const listeners = new AbortController();
    const chunks = [];
    let completed = false;
    const options = { signal: listeners.signal };
    const timeout = setTimeout(fail, (video.duration * 2 + 30) * 1000);
    const watch = setInterval(() => {
      if (!video.isConnected || video.currentSrc !== source || location.href !== pageUrl) fail();
    }, 500);

    function cleanup() {
      clearTimeout(timeout);
      clearInterval(watch);
      listeners.abort();
    }

    function fail() {
      cleanup();
      if (recorder.state !== "inactive") recorder.stop();
      reject(new Error("Playback could not finish"));
    }

    recorder.addEventListener("dataavailable", event => {
      if (event.data.size) chunks.push(event.data);
    }, options);
    recorder.addEventListener("error", fail, options);
    recorder.addEventListener("stop", () => {
      cleanup();
      if (!chunks.length || !completed) {
        reject(new Error("The recording is incomplete"));
        return;
      }
      const type = recorder.mimeType || mimeType;
      resolve({ blob: new Blob(chunks, { type }), extension: type.startsWith("video/mp4") ? "mp4" : "webm" });
    }, options);

    video.addEventListener("emptied", fail, { ...options, once: true });
    video.addEventListener("error", fail, { ...options, once: true });
    video.addEventListener("ended", () => {
      completed = true;
      if (recorder.state !== "inactive") recorder.stop();
    }, { ...options, once: true });
    const pause = () => {
      if (recorder.state === "recording") recorder.pause();
    };
    video.addEventListener("waiting", pause, options);
    video.addEventListener("pause", () => { if (!video.ended) pause(); }, options);
    video.addEventListener("playing", () => {
      if (recorder.state === "paused") recorder.resume();
    }, options);

    try {
      recorder.start(1000);
      video.play().catch(fail);
    } catch {
      fail();
    }
  });
}

async function recordInstagramVideo(video) {
  if (typeof video.captureStream !== "function" || typeof MediaRecorder === "undefined" ||
      !Number.isFinite(video.duration) || video.duration <= 0 || video.mediaKeys ||
      (video.seekable.length && video.seekable.start(0) > 0.1)) {
    throw new Error("Video cannot be recorded from the beginning");
  }

  const source = video.currentSrc;
  const pageUrl = location.href;
  const original = {
    time: video.currentTime, paused: video.paused, loop: video.loop, rate: video.playbackRate
  };
  let stream;
  try {
    video.pause();
    video.loop = false;
    video.playbackRate = 1;
    await seekToBeginning(video);
    if (!video.isConnected || video.currentSrc !== source || location.href !== pageUrl) {
      throw new Error("Video changed");
    }
    stream = video.captureStream();
    return await capturePlayback(video, stream, pageUrl, source);
  } finally {
    stream?.getTracks().forEach(track => track.stop());
    if (video.isConnected && video.currentSrc === source) {
      video.loop = original.loop;
      video.playbackRate = original.rate;
      if (location.href === pageUrl) {
        video.currentTime = original.time;
        if (original.paused) video.pause();
        else video.play().catch(() => {});
      }
    }
  }
}

function saveRecordedVideo(recording, category) {
  const url = URL.createObjectURL(recording.blob);
  const link = document.createElement("a");
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

  link.href = url;
  link.download = "instagram-" + category + "-" + timestamp + "." + recording.extension;
  link.hidden = true;
  document.body.append(link);
  try {
    link.click();
  } finally {
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}
