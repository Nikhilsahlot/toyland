/**
 * Netlify Function: scrape-onkar
 *
 * Scrapes ALL catalogues + items + images from onkartoys.catalog.to
 * and writes them directly to your Google Sheet via your Apps Script URL.
 *
 * ENV VARS NEEDED (Netlify Dashboard → Site config → Environment variables):
 *   APPS_SCRIPT_URL   = your Google Apps Script web app URL
 *   SCRAPE_SECRET     = toyland2026
 *
 * RUN:
 *   https://toys-land.netlify.app/.netlify/functions/scrape-onkar?secret=toyland2026
 *
 * INSPECT HTML (to debug what the site serves):
 *   https://toys-land.netlify.app/.netlify/functions/scrape-onkar?secret=toyland2026&inspect=1
 */

const STORE_SLUG = "onkartoys";

export default async (req) => {
  const { searchParams } = new URL(req.url);
  const secret = searchParams.get("secret");

  // ── Debug: env var check (no secret needed) ───────────────────
  if (searchParams.get("debug") === "1") {
    return json({
      SCRAPE_SECRET_set: !!process.env.SCRAPE_SECRET,
      SCRAPE_SECRET_length: (process.env.SCRAPE_SECRET || "").length,
      APPS_SCRIPT_URL_set: !!process.env.APPS_SCRIPT_URL,
      secret_you_sent: secret,
      match: secret === process.env.SCRAPE_SECRET,
    });
  }

  // ── Auth ───────────────────────────────────────────────────────
  const expectedSecret = process.env.SCRAPE_SECRET;
  if (!expectedSecret) {
    return json({ error: "SCRAPE_SECRET env var not set. Add it in Netlify → Environment variables, then redeploy." }, 500);
  }
  if (secret !== expectedSecret) {
    return json({ error: `Wrong secret. You sent: "${secret}"` }, 401);
  }

  // ── Inspect mode: dump what catalog.to actually sends ─────────
  if (searchParams.get("inspect") === "1") {
    const res = await fetch(`https://${STORE_SLUG}.catalog.to`, {
      headers: { "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36" }
    });
    const html = await res.text();
    const scripts = [...html.matchAll(/src=["']([^"']+)["']/g)].map(m => m[1]);
    const externalUrls = [...html.matchAll(/["'](https?:\/\/[^"'\s<>]{10,})["']/g)]
      .map(m => m[1])
      .filter(u => !u.match(/\.(png|jpg|gif|svg|css|woff|ico)/) )
      .filter((v, i, a) => a.indexOf(v) === i)
      .slice(0, 40);
    const inlineScripts = [...html.matchAll(/<script(?![^>]*src)[^>]*>([\s\S]{10,500}?)<\/script>/g)]
      .map(m => m[1].trim())
      .filter(s => s.length > 10)
      .slice(0, 10);
    return json({
      status: res.status,
      html_bytes: html.length,
      first_1000: html.substring(0, 1000),
      script_src_tags: scripts,
      external_urls_found: externalUrls,
      inline_scripts: inlineScripts,
    });
  }

  const appsScriptUrl = process.env.APPS_SCRIPT_URL;
  if (!appsScriptUrl) {
    return json({ error: "APPS_SCRIPT_URL environment variable not set." }, 500);
  }

  const log = [];
  try {
    log.push("🔍 Fetching data from catalog.to...");
    const items = await scrapeAllItems(log);

    if (items.length === 0) {
      return json({
        success: false,
        log,
        message: "Could not extract items. Run with &inspect=1 to see the raw HTML structure.",
        tip: `https://toys-land.netlify.app/.netlify/functions/scrape-onkar?secret=${secret}&inspect=1`,
      });
    }

    log.push(`✅ Found ${items.length} items`);
    log.push("📝 Writing to Google Sheet...");
    const { added, failed, failedItems } = await writeToSheet(items, appsScriptUrl, log);

    return json({
      success: true,
      log,
      stats: { total: items.length, added, failed },
      failed_items: failedItems,
    });
  } catch (err) {
    return json({ success: false, error: err.message, stack: err.stack, log }, 500);
  }
};

// ── Scraping strategies ───────────────────────────────────────
async function scrapeAllItems(log) {
  for (const strategy of [tryFirebaseAPI, tryCatalogDirectAPI, tryJSBundleProbe]) {
    try {
      const items = await strategy(STORE_SLUG, log);
      if (items && items.length > 0) return items;
    } catch (e) {
      log.push(`  Strategy error: ${e.message}`);
    }
  }
  return [];
}

// Strategy 1: Firebase Firestore REST API
async function tryFirebaseAPI(slug, log) {
  log.push("  [Strategy 1] Trying Firebase Firestore API...");
  const projects = ["catalog-to-prod", "catalogto", "catalog-app-prod", "catalog-to", "catalogto-prod"];
  for (const p of projects) {
    try {
      const url = `https://firestore.googleapis.com/v1/projects/${p}/databases/(default)/documents/stores/${slug}/catalogues`;
      const res = await fetchT(url, 5000);
      if (res.ok) {
        const data = await res.json();
        log.push(`  ✅ Firebase hit: project=${p}`);
        return parseFirestore(data, log);
      }
    } catch (e) {}
  }
  // Also try their REST API
  for (const url of [
    `https://api.catalog.to/v1/stores/${slug}`,
    `https://api.catalog.to/v1/stores/${slug}/products`,
    `https://api.catalog.to/stores/${slug}/catalogues`,
  ]) {
    try {
      const res = await fetchT(url, 5000);
      if (res.ok) {
        const data = await res.json();
        log.push(`  ✅ REST API hit: ${url}`);
        return parseCatalogAPI(data, log);
      }
    } catch (e) {}
  }
  return [];
}

// Strategy 2: Direct JSON endpoints
async function tryCatalogDirectAPI(slug, log) {
  log.push("  [Strategy 2] Trying direct JSON endpoints...");
  const urls = [
    `https://${slug}.catalog.to/api/catalogues`,
    `https://${slug}.catalog.to/api/products`,
    `https://${slug}.catalog.to/data.json`,
    `https://${slug}.catalog.to/products.json`,
    `https://catalog.to/api/v1/${slug}`,
  ];
  for (const url of urls) {
    try {
      const res = await fetchT(url, 5000, { Accept: "application/json" });
      if (res.ok) {
        const text = await res.text();
        if (text.trim()[0] === "{" || text.trim()[0] === "[") {
          const data = JSON.parse(text);
          log.push(`  ✅ JSON at: ${url}`);
          return parseCatalogAPI(data, log);
        }
      }
    } catch (e) {}
  }
  return [];
}

// Strategy 3: Fetch HTML + all JS bundles, hunt for Firebase project ID and API URLs
async function tryJSBundleProbe(slug, log) {
  log.push("  [Strategy 3] Probing JS bundles for API URLs...");

  const base = `https://${slug}.catalog.to`;
  const htmlRes = await fetchT(base, 10000, {
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
  });
  if (!htmlRes.ok) return [];

  const html = await htmlRes.text();
  log.push(`  HTML: ${html.length} bytes`);

  // Check for embedded JSON first
  for (const pattern of [
    /__NEXT_DATA__\s*=\s*({[\s\S]+?})\s*<\/script>/,
    /window\.__INITIAL_STATE__\s*=\s*({[\s\S]+?})\s*;?\s*<\/script>/,
    /<script[^>]+type="application\/json"[^>]*>([\s\S]+?)<\/script>/,
  ]) {
    const m = html.match(pattern);
    if (m) {
      try {
        const data = JSON.parse(m[1]);
        const items = extractFromEmbedded(data, log);
        if (items.length > 0) return items;
      } catch (e) {}
    }
  }

  // Collect all JS src URLs
  const jsSrcs = [...html.matchAll(/src=["']([^"']+\.js[^"']*)["']/g)]
    .map(m => m[1].startsWith("http") ? m[1] : `${base}${m[1].startsWith("/") ? "" : "/"}${m[1]}`)
    .filter((v, i, a) => a.indexOf(v) === i)
    .slice(0, 10);

  log.push(`  Found ${jsSrcs.length} JS files, probing...`);

  const apiUrlsToTry = new Set();

  for (const src of jsSrcs) {
    try {
      const jsRes = await fetchT(src, 8000);
      if (!jsRes.ok) continue;
      const js = await jsRes.text();

      // Find Firebase project ID
      for (const pat of [
        /projectId['":\s]+["']([a-z0-9-]+)["']/g,
        /["']([a-z0-9-]+)["']\.firebaseapp\.com/g,
        /firebase.*?["']([a-z0-9-]{5,40})["']/g,
      ]) {
        for (const m of js.matchAll(pat)) {
          const proj = m[1];
          if (proj.length > 4 && proj.length < 40) {
            const fbUrl = `https://firestore.googleapis.com/v1/projects/${proj}/databases/(default)/documents/stores/${slug}/catalogues`;
            try {
              const fbRes = await fetchT(fbUrl, 5000);
              if (fbRes.ok) {
                const data = await fbRes.json();
                log.push(`  🔥 Firebase project found: ${proj}`);
                const items = parseFirestore(data, log);
                if (items.length > 0) return items;
              }
            } catch (e) {}
          }
        }
      }

      // Find any API URLs
      for (const m of js.matchAll(/["'](https:\/\/(?:api|backend|server)[^"'\s]{5,100})["']/g)) {
        apiUrlsToTry.add(m[1]);
      }
      for (const m of js.matchAll(/["'](https:\/\/[a-z0-9-]+\.catalog\.to\/[^"'\s]{3,})["']/g)) {
        apiUrlsToTry.add(m[1]);
      }
    } catch (e) {}
  }

  // Try any API URLs found in JS
  for (const url of apiUrlsToTry) {
    try {
      const res = await fetchT(url, 5000, { Accept: "application/json" });
      if (res.ok) {
        const text = await res.text();
        if (text.trim()[0] === "{" || text.trim()[0] === "[") {
          const data = JSON.parse(text);
          const items = parseCatalogAPI(data, log);
          if (items.length > 0) {
            log.push(`  ✅ Items from JS-discovered URL: ${url}`);
            return items;
          }
        }
      }
    } catch (e) {}
  }

  return [];
}

// ── Parsers ───────────────────────────────────────────────────
function parseFirestore(data, log) {
  const items = [];
  for (const doc of (data.documents || [])) {
    const f = doc.fields || {};
    const catName = fsVal(f.name) || "General";
    for (const item of (fsVal(f.items) || [])) {
      const fi = item.mapValue?.fields || {};
      items.push({
        name: fsVal(fi.name) || "Product",
        category: catName,
        price: toPrice(fsVal(fi.price) || fsVal(fi.selling_price)),
        original_price: toPrice(fsVal(fi.original_price) || fsVal(fi.mrp)),
        image_url: fsVal(fi.image) || fsVal(fi.image_url) || fsVal(fi.photo) || "",
        description: fsVal(fi.description) || "",
        age_range: "3-12", brand: "Onkar Toys", rating: 4.5,
      });
    }
  }
  log.push(`  Parsed ${items.length} items from Firestore`);
  return items;
}

function fsVal(f) {
  if (!f) return null;
  return f.stringValue ?? f.integerValue ?? f.doubleValue ?? f.arrayValue?.values ?? null;
}

function parseCatalogAPI(data, log) {
  const items = [];
  const cats = data.catalogues || data.categories || data.sections || data.data ||
    (Array.isArray(data) ? data : []);
  for (const cat of cats) {
    const catName = cat.name || cat.title || "General";
    for (const item of (cat.items || cat.products || cat.entries || [])) {
      items.push({
        name: item.name || item.title || "Product",
        category: catName,
        price: toPrice(item.price || item.selling_price || item.amount),
        original_price: toPrice(item.original_price || item.mrp || item.compare_price),
        image_url: item.image_url || item.image || item.photo ||
          item.images?.[0]?.url || item.images?.[0] || "",
        description: item.description || item.details || item.name || "",
        age_range: item.age_range || "3-12", brand: item.brand || "Onkar Toys", rating: item.rating || 4.5,
      });
    }
  }
  log.push(`  Parsed ${items.length} items`);
  return items;
}

function extractFromEmbedded(data, log) {
  const items = [];
  function walk(obj, depth = 0) {
    if (depth > 8 || !obj || typeof obj !== "object") return;
    if (Array.isArray(obj)) {
      if (obj.length > 0 && obj[0]?.name && (obj[0]?.price || obj[0]?.image)) {
        for (const item of obj) {
          items.push({
            name: item.name || item.title || "Product",
            category: item.category || item.catalogue || "General",
            price: toPrice(item.price || item.selling_price),
            original_price: toPrice(item.original_price || item.mrp),
            image_url: item.image_url || item.image || item.photo || "",
            description: item.description || item.name || "",
            age_range: "3-12", brand: "Onkar Toys", rating: 4.5,
          });
        }
      }
      obj.forEach(v => walk(v, depth + 1));
    } else {
      Object.values(obj).forEach(v => walk(v, depth + 1));
    }
  }
  walk(data);
  log.push(`  Extracted ${items.length} items from embedded data`);
  return items;
}

// ── Write to Google Sheet ─────────────────────────────────────
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
        image_url: item.image_url,
        description: item.description || item.name,
        age_range: item.age_range || "3-12",
        brand: item.brand || "Onkar Toys",
        stock: true, rating: item.rating || 4.5,
      };
      const res = await fetchT(url, 20000, { "Content-Type": "application/x-www-form-urlencoded" },
        "POST", `data=${encodeURIComponent(JSON.stringify(payload))}`);
      const result = await res.json();
      if (result.success) { added++; }
      else { failed++; failedItems.push({ name: item.name, error: result.error }); }
    } catch (e) {
      failed++;
      failedItems.push({ name: item.name, error: e.message });
    }
  }
  log.push(`  Done: ${added} added, ${failed} failed`);
  return { added, failed, failedItems };
}

// ── Helpers ───────────────────────────────────────────────────
async function fetchT(url, ms = 8000, headers = {}, method = "GET", body = null) {
  const opts = {
    method,
    headers: { "User-Agent": "Mozilla/5.0 (compatible; ToylandScraper/1.0)", ...headers },
    signal: AbortSignal.timeout(ms),
  };
  if (body) opts.body = body;
  return fetch(url, opts);
}

function toPrice(val) {
  if (!val) return 0;
  const n = parseFloat(String(val).replace(/[^0-9.]/g, ""));
  return isNaN(n) ? 0 : Math.round(n);
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status, headers: { "Content-Type": "application/json" },
  });
}
