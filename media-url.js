function parseInstagramMediaUrl(source) {
  if (!source || typeof source !== "string") return null;

  let url;
  try {
    url = new URL(source);
  } catch {
    return null;
  }

  if (url.protocol !== "https:" || url.username || url.password || url.port ||
      url.searchParams.has("bytestart") || url.searchParams.has("byteend")) {
    return null;
  }

  return url;
}

function getDownloadableVideo(source) {
  const url = parseInstagramMediaUrl(source);
  if (!url || !/(^|\.)(instagram\.com|cdninstagram\.com|fbcdn\.net)$/i.test(url.hostname)) return null;

  const extension = url.pathname.match(/\.(mp4|webm|m4v|mov)$/i)?.[1].toLowerCase();
  return extension ? { url: url.href, extension } : null;
}

function getDownloadableImage(source) {
  const url = parseInstagramMediaUrl(source);
  if (!url || !/(^|\.)(instagram\.com|cdninstagram\.com|fbcdn\.net)$/i.test(url.hostname)) return null;

  const extension = url.pathname.match(/\.(jpe?g|png|webp|avif|gif)$/i)?.[1].toLowerCase();
  return extension ? { url: url.href, extension: extension === "jpeg" ? "jpg" : extension } : null;
}

function getDownloadableVoice(source) {
  const url = parseInstagramMediaUrl(source);
  if (!url || !/(^|\.)(instagram\.com|cdninstagram\.com|fbcdn\.net|fbsbx\.com)$/i.test(url.hostname)) return null;

  const extension = url.pathname.match(/\.(mp4|m4a|mp3|aac|opus|ogg|oga|webm|wav)$/i)?.[1].toLowerCase();
  if (!extension) return null;
  return { url: url.href, extension: extension === "mp4" ? "m4a" : extension };
}
