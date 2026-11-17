function getDownloadableVideo(source) {
  if (!source || typeof source !== "string") return null;

  let url;
  try {
    url = new URL(source);
  } catch {
    return null;
  }

  const mediaHost = /(^|\.)(instagram\.com|cdninstagram\.com|fbcdn\.net)$/i;
  const extension = url.pathname.match(/\.(mp4|webm|m4v|mov)$/i)?.[1].toLowerCase();
  if (url.protocol !== "https:" || url.username || url.password || url.port ||
      !mediaHost.test(url.hostname) || !extension ||
      url.searchParams.has("bytestart") || url.searchParams.has("byteend")) {
    return null;
  }

  return { url: url.href, extension };
}
