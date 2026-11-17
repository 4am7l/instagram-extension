importScripts("media-url.js");

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.type !== "download-instagram-video") return;

  const instagramPage = /^https:\/\/(?:www\.)?instagram\.com\//;
  const media = getDownloadableVideo(message.url);
  if (sender.frameId !== 0 || !instagramPage.test(sender.url ?? "") || !media) {
    respond({ started: false });
    return;
  }

  const category = ["reel", "story", "post"].includes(message.category)
    ? message.category
    : "video";
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

  chrome.downloads.download({
    url: media.url,
    filename: "Instagram/" + category + "-" + timestamp + "." + media.extension,
    conflictAction: "uniquify",
    saveAs: false
  }).then(
    () => respond({ started: true }),
    () => respond({ started: false })
  );

  return true;
});
