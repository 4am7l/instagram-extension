importScripts("media-url.js");

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  const voice = message?.type === "download-instagram-voice";
  if (!voice && message?.type !== "download-instagram-video") return;

  const instagramPage = voice
    ? /^https:\/\/(?:www\.)?instagram\.com\/direct\/t\/[^/?#]+/
    : /^https:\/\/(?:www\.)?instagram\.com\//;
  const media = voice ? getDownloadableVoice(message.url) : getDownloadableVideo(message.url);
  if (sender.frameId !== 0 || !instagramPage.test(sender.url ?? "") || !media) {
    respond({ started: false });
    return;
  }

  const videoCategory = ["reel", "story", "post"].includes(message.category)
    ? message.category
    : "video";
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

  chrome.downloads.download({
    url: media.url,
    filename: "Instagram/" + (voice ? "voice" : videoCategory) + "-" + timestamp + "." + media.extension,
    conflictAction: "uniquify",
    saveAs: false
  }).then(
    () => respond({ started: true }),
    () => respond({ started: false })
  );

  return true;
});
