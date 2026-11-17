(() => {
  let pending;

  document.addEventListener("click", event => {
    if (!event.isTrusted || !location.pathname.startsWith("/direct/t/")) return;
    const control = event.target.closest?.("[data-ig-voice-play]");
    const player = control?.closest("[data-ig-voice-player]");
    if (!player) return;

    // If two different messages are clicked before either starts, a shared
    // audio element cannot be safely attributed to either message.
    const now = performance.now();
    const overlapping = pending && pending.path === location.pathname &&
      pending.expires > now && pending.player !== player;
    pending = {
      player: overlapping || control.dataset.igVoicePlay === "pause" ? null : player,
      path: location.pathname,
      expires: now + 4000
    };
  }, true);

  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function (...args) {
    const request = pending;
    const result = Reflect.apply(play, this, args);
    if (!(this instanceof HTMLAudioElement) || !request?.player ||
        performance.now() > request.expires || location.pathname !== request.path) {
      return result;
    }

    result?.then(() => {
      const player = request.player;
      const owningPlayer = this.closest("[data-ig-voice-player]");
      if (pending !== request || performance.now() > request.expires ||
          location.pathname !== request.path || !player.isConnected ||
          (owningPlayer && owningPlayer !== player)) {
        return;
      }

      const source = this.currentSrc || this.src || this.querySelector("source[src]")?.src;
      if (!source) return;
      pending = null;
      player.dispatchEvent(new CustomEvent("ig-voice-source", { detail: source }));
    }, () => {});
    return result;
  };
})();
