/**
 * Netlify Function: scrape-onkar
 * Platform: QuickSell (catalog.to)
 *
 * ENV VARS needed in Netlify:
 *   APPS_SCRIPT_URL  = your Google Apps Script web app URL
 *   SCRAPE_SECRET    = toyland2026
 */

const STORE_BASE = "https://onkartoys.catalog.to";
const USER_ID    = "-O45EEmKrx4yZAGq44QK";
const COMPANY_ID = "-O45EEmKrx4yZAGq44QL";

export default async (req) => {
  const { searchParams } = new URL(req.url);
  const secret = searchParams.get("secret");

  if (searchParams.get("debug") === "1") {
    return json({ match: secret === process.env.SCRAPE_SECRET, APPS_SCRIPT_URL_set: !!process.env.APPS_SCRIPT_URL });
  }
  if (secret !== process.env.SCRAPE_SECRET) return json({ error: "Wrong secret." }, 401);
  const appsScriptUrl = process.env.APPS_SCRIPT_URL;
  if (!appsScriptUrl) return json({ error: "APPS_SCRIPT_URL not set." }, 500);

  // ── Probe2: try QuickSell API with full browser headers + referer ─
  if (searchParams.get("probe2") === "1") {
    const cat = { id: "-Ol6fjocrt1ataQgvk9T", title: "BOARD GAMES" };
    const results = [];
    const attempts = [
      // QuickSell API with full browser headers
      { url: `https://api.quicksell.co/v1/catalogues/${cat.id}/products`, headers: { "Referer": STORE_BASE, "Origin": STORE_BASE } },
      { url: `https://api.quicksell.co/v1/catalogues/${cat.id}/products?page=1&limit=100`, headers: { "Referer": STORE_BASE } },
      { url: `https://api.quicksell.co/v1/catalogues/${cat.id}`, headers: { "Referer": STORE_BASE } },
      // QuickSell widget/embed API
      { url: `https://api.quicksell.co/v1/companies/${COMPANY_ID}/catalogues`, headers: {} },
      { url: `https://api.quicksell.co/v1/companies/${USER_ID}/catalogues/${cat.id}/products`, headers: {} },
      // Try fetching the catalogue page with extra headers that a browser would send
      { url: `${STORE_BASE}/${cat.id}`, headers: { "Accept": "text/html" } },
      // QuickSell uses showcaseId in the URL sometimes
      { url: `${STORE_BASE}/board-games`, headers: {} },
      { url: `${STORE_BASE}/board-games/m04`, headers: {} },
      // Try the widget.js to find the API token
      { url: `https://d3r49s2alut4u1.cloudfront.net/js/widget.js`, headers: {} },
    ];
    for (const { url, headers } of attempts) {
      try {
        const res = await fetch(url, {
          headers: {
            "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
            "Accept": "application/json, text/html, */*",
            "Accept-Language": "en-US,en;q=0.9",
            ...headers,
          },
          signal: AbortSignal.timeout(8000),
        });
        const body = await res.text();
        results.push({
          url,
          status: res.status,
          content_length: body.length,
          content_type: res.headers.get("content-type"),
          preview: body.substring(0, 300),
        });
      } catch (e) {
        results.push({ url, error: e.message });
      }
    }
    return json({ probe2_results: results });
  }

  // ── Probe3: extract token from widget.js and use it ──────────
  if (searchParams.get("probe3") === "1") {
    // Fetch widget.js and look for API keys/tokens
    const widgetRes = await fetch("https://d3r49s2alut4u1.cloudfront.net/js/widget.js", {
      headers: { "User-Agent": "Mozilla/5.0 Chrome/120.0.0.0" },
      signal: AbortSignal.timeout(10000),
    });
    const widgetJs = await widgetRes.text();

    // Extract tokens, API keys, base URLs
    const apiKeys = [...widgetJs.matchAll(/["']([A-Za-z0-9_\-]{20,60})["']/g)].map(m => m[1]).slice(0, 20);
    const apiUrls = [...widgetJs.matchAll(/https?:\/\/[a-z0-9._\-]+(?:\/[^\s"']{3,})?/g)].map(m => m[0]).slice(0, 30);
    const authPatterns = [...widgetJs.matchAll(/(?:token|key|auth|bearer|api)[^"']{0,20}["']([^"']{10,})["']/gi)].map(m => m[1]).slice(0, 10);

    return json({
      widget_js_size: widgetJs.length,
      potential_api_keys: apiKeys,
      urls_found: apiUrls,
      auth_patterns: authPatterns,
      // Show sections containing "api" or "catalogue"
      api_sections: widgetJs.split("\n").filter(l => l.match(/api|catalogue|product|token|auth/i)).slice(0, 20),
    });
  }

  // ── Probe4: try fetching catalogue page with session cookie approach ─
  if (searchParams.get("probe4") === "1") {
    // First get cookies/session from homepage
    const homeRes = await fetch(STORE_BASE, {
      headers: { "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36" },
    });
    const cookies = homeRes.headers.get("set-cookie") || "";
    const homeHtml = await homeRes.text();

    // Extract showcaseId from amalgam
    const amalgamMatch = homeHtml.match(/id=["']?amalgam-json["']?[^>]*>([\s\S]*?)<\/script>/i);
    const amalgam = amalgamMatch ? JSON.parse(amalgamMatch[1]) : {};
    const showcaseId = amalgam.showcaseId || "";
    const catalogues = (amalgam.catalogues || []).slice(0, 2); // test first 2

    const results = [];
    for (const cat of catalogues) {
      // Try QuickSell internal API with showcaseId
      const urlsToTry = [
        `https://api.quicksell.co/v1/showcases/${showcaseId}/catalogues/${cat.id}/products`,
        `https://api.quicksell.co/v1/showcases/${showcaseId}/catalogues/${cat.id}`,
        `https://api.quicksell.co/v1/showcases/${showcaseId}/products?catalogueId=${cat.id}`,
        `https://api.quicksell.co/v1/users/${USER_ID}/catalogues/${cat.id}/products`,
        `https://api.quicksell.co/v1/users/${USER_ID}/products?catalogueId=${cat.id}`,
      ];
      for (const url of urlsToTry) {
        try {
          const res = await fetch(url, {
            headers: {
              "User-Agent": "Mozilla/5.0 Chrome/120.0.0.0",
              "Referer": STORE_BASE,
              "Origin": STORE_BASE,
              "Cookie": cookies,
            },
            signal: AbortSignal.timeout(6000),
          });
          const body = await res.text();
          results.push({ url, status: res.status, size: body.length, preview: body.substring(0, 200) });
        } catch (e) {
          results.push({ url, error: e.message });
        }
      }
    }
    return json({ showcaseId, cookies: cookies.substring(0, 100), results });
  }

  // ── MAIN: full scrape using whatever works ────────────────────
  const log = [];
  try {
    log.push("📂 Fetching homepage amalgam...");
    const homeRes = await fetch(STORE_BASE, {
      headers: { "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36" },
      signal: AbortSignal.timeout(15000),
    });
    const homeHtml = await homeRes.text();
    const amalgamMatch = homeHtml.match(/id=["']?amalgam-json["']?[^>]*>([\s\S]*?)<\/script>/i);
    if (!amalgamMatch) return json({ success: false, error: "No amalgam-json on homepage", log });

    const homeAmalgam = JSON.parse(amalgamMatch[1]);
    const showcaseId = homeAmalgam.showcaseId || "";
    const catalogues = homeAmalgam.catalogues || [];
    log.push(`✅ ${catalogues.length} catalogues, showcaseId: ${showcaseId}`);

    const allItems = [];
    for (const cat of catalogues) {
      log.push(`  📦 ${cat.title} (${cat.productCount} products)...`);
      const products = await tryAllProductFetches(cat, showcaseId, log);
      log.push(`    → ${products.length} extracted`);
      allItems.push(...products);
      await sleep(300);
    }

    log.push(`✅ Total: ${allItems.length} products`);
    if (allItems.length === 0) {
      return json({ success: false, log, tip: "Run ?probe2=1, ?probe3=1, ?probe4=1 for diagnosis" });
    }

    log.push("📝 Writing to Google Sheet...");
    const { added, failed, failedItems } = await writeToSheet(allItems, appsScriptUrl, log);
    return json({ success: true, log, stats: { total: allItems.length, added, failed }, failed_items: failedItems.slice(0, 10) });

  } catch (err) {
    return json({ success: false, error: err.message, log }, 500);
  }
};

// ── Try every product fetch strategy for a catalogue ─────────
async function tryAllProductFetches(cat, showcaseId, log) {
  const urlsToTry = [
    // QuickSell API with showcaseId (most likely)
    `https://api.quicksell.co/v1/showcases/${showcaseId}/catalogues/${cat.id}/products`,
    `https://api.quicksell.co/v1/showcases/${showcaseId}/catalogues/${cat.id}/products?page=1&limit=200`,
    `https://api.quicksell.co/v1/users/${USER_ID}/catalogues/${cat.id}/products`,
    `https://api.quicksell.co/v1/companies/${COMPANY_ID}/catalogues/${cat.id}/products`,
    // With pagination
    `https://api.quicksell.co/v1/catalogues/${cat.id}/products?page=0&limit=200`,
    `https://api.quicksell.co/v2/catalogues/${cat.id}/products`,
  ];

  for (const url of urlsToTry) {
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
          "Accept": "application/json",
          "Referer": STORE_BASE,
          "Origin": STORE_BASE,
        },
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) continue;
      const text = await res.text();
      if (!text || text.length < 5) continue;
      if (text.trim()[0] === "{" || text.trim()[0] === "[") {
        const data = JSON.parse(text);
        const products = extractFromJson(data, cat.title);
        if (products.length > 0) {
          log.push(`    ✅ ${url}`);
          return products;
        }
      }
    } catch (e) {}
  }
  return [];
}

function extractFromJson(data, catName) {
  const items = [];
  const raw = data.products || data.items || data.data || data.productList
    || (Array.isArray(data) ? data : []);
  for (const p of raw) {
    const name = p.name || p.title || p.productName || "";
    if (!name) continue;
    items.push(buildItem(p, catName));
  }
  return items;
}

function buildItem(p, catName) {
  let price = toNum(p.sellingPrice ?? p.price ?? p.sp ?? p.amount ?? 0);
  let mrp   = toNum(p.mrp ?? p.maxPrice ?? p.originalPrice ?? p.mp ?? 0);
  if (price > 100000) price = Math.round(price / 100);
  if (mrp   > 100000) mrp   = Math.round(mrp   / 100);
  if (mrp < price || mrp === 0) mrp = Math.round(price * 1.3);
  return {
    name: (p.name || p.title || "").trim(),
    category: catName,
    price, original_price: mrp,
    image_url: extractImage(p),
    description: (p.description || p.details || p.name || "").trim(),
    age_range: "3-12", brand: "Onkar Toys", rating: 4.5,
  };
}

function extractImage(p) {
  for (const f of ["imageUrl","image_url","image","photo","thumbnail","pictureUrl"]) {
    if (p[f] && typeof p[f] === "string" && p[f].startsWith("http")) return p[f];
  }
  const imgs = p.images || p.imageList || p.photos || [];
  if (imgs.length > 0) {
    const first = imgs[0];
    if (typeof first === "string" && first.startsWith("http")) return first;
    if (first?.url) return first.url;
    const key = first?.key || first?.id || first?.name;
    if (key) return `https://catalogue-cdn.quicksell.co/s/${key}`;
  }
  const key = p.imageKey || p.key || p.imageId;
  if (key) return `https://catalogue-cdn.quicksell.co/s/${key}`;
  const pid = p.id || p.productId || p._id;
  if (pid) return `https://do9uy4stciz2v.cloudfront.net/${USER_ID}/products/${pid}.jpg`;
  return "";
}

async function writeToSheet(items, url, log) {
  let added = 0, failed = 0;
  const failedItems = [];
  for (const item of items) {
    try {
      const payload = {
        action: "add_product",
        name: item.name, category: item.category,
        price: item.price || 0,
        original_price: item.original_price || Math.round((item.price || 0) * 1.3),
        image_url: item.image_url || "",
        description: item.description || item.name,
        age_range: "3-12", brand: "Onkar Toys", stock: true, rating: 4.5,
      };
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `data=${encodeURIComponent(JSON.stringify(payload))}`,
        signal: AbortSignal.timeout(25000),
      });
      let result;
      try { result = await res.json(); } catch { result = { error: "bad json" }; }
      if (result.success) { added++; }
      else { failed++; failedItems.push({ name: item.name, error: result.error }); }
    } catch (e) { failed++; failedItems.push({ name: item.name, error: e.message }); }
  }
  log.push(`  ✅ ${added} added, ${failed} failed`);
  return { added, failed, failedItems };
}

function toNum(v) { const n = parseFloat(String(v ?? 0).replace(/[^0-9.]/g,"")); return isNaN(n)?0:n; }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), { status, headers: { "Content-Type": "application/json" } });
}
