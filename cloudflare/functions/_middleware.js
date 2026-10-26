/** Canonical host: always HTTPS apex (preeminentstore.com), single 301 hop when possible. */
export async function onRequest(context) {
  const url = new URL(context.request.url);
  const host = url.hostname.toLowerCase();
  let changed = false;

  // www → apex (Cloudflare "Always Use HTTPS" may already have upgraded http→https first;
  // a zone Redirect Rule should collapse http://www into one hop to https://apex when possible.)
  if (host === "www.preeminentstore.com") {
    url.hostname = "preeminentstore.com";
    changed = true;
  }

  // Legacy .html paths → extensionless canonicals (absolute URL, 301).
  if (/\.html$/i.test(url.pathname)) {
    url.pathname = url.pathname.replace(/\.html$/i, "");
    if (!url.pathname) url.pathname = "/";
    changed = true;
  }

  if (changed) {
    url.protocol = "https:";
    url.hostname = "preeminentstore.com";
    return Response.redirect(url.toString(), 301);
  }

  return context.next();
}
