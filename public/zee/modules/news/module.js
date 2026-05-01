const LABELS = {
  nvidia: "NVIDIA",
  star_citizen: "Star Citizen",
  steam: "Steam / PC",
  world: "World / macro",
};

async function loadAll() {
  const res = await fetch("/api/zee/news");
  const j = await res.json();
  if (!j.ok) throw new Error(j.error || "news failed");
  return j.feeds;
}

export const newsModule = {
  id: "news",
  title: "Intel feeds",
  mount(el) {
    el.innerHTML = `<div class="zee-news" id="zee-news-root"></div>`;
    const root = el.querySelector("#zee-news-root");
    const render = (feeds) => {
      if (!root) return;
      const keys = /** @type {(keyof typeof LABELS)[]} */ (["nvidia", "star_citizen", "steam", "world"]);
      root.innerHTML = keys
        .map((k) => {
          const bundle = feeds[k];
          const title = LABELS[k];
          if (bundle?.error) {
            return `<section class="zee-news-col"><h4>${title}</h4><div class="zee-err">${bundle.error}</div></section>`;
          }
          const items = Array.isArray(bundle)
            ? bundle
                .slice(0, 5)
                .map(
                  (a, i) =>
                    `<li><a href="${escapeAttr(a.url)}" target="_blank" rel="noopener">${i + 1}. ${escapeHtml(
                      a.title || ""
                    )}</a><span class="zee-src">${escapeHtml(a.source || "")}</span></li>`
                )
                .join("")
            : "";
          const content = items || `<div class="zee-muted">No current headlines found for this topic.</div>`;
          return `<section class="zee-news-col"><h4>${title}</h4>${items ? `<ol class="zee-news-list">${items}</ol>` : content}</section>`;
        })
        .join("");
    };
    loadAll()
      .then(render)
      .catch((e) => {
        if (root) root.innerHTML = `<div class="zee-err">${e.message}</div><div class="zee-muted">Set NEWS_API_KEY.</div>`;
      });
    const id = window.setInterval(() => {
      loadAll().then(render).catch(() => {});
    }, 120_000);
    return { destroy: () => window.clearInterval(id) };
  },
};

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
function escapeAttr(s) {
  return escapeHtml(s).replace(/"/g, "&quot;");
}
