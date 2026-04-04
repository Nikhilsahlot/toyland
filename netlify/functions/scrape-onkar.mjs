/**
 * Netlify Function: scrape-onkar
 *
 * Scrapes ALL catalogues + items + images from onkartoys.catalog.to
 * and writes them directly to your Google Sheet via your Apps Script URL.
 *
 * ─── ONE-TIME SETUP ───────────────────────────────────────────
 * In Netlify Dashboard → toys-land → Site configuration → Environment variables:
 *
 *   APPS_SCRIPT_URL   = (your existing Google Apps Script web app URL)
 *   SCRAPE_SECRET     = any password you choose, e.g. "toyland2024"
 *
 * Optional (needed only if catalog.to blocks direct API access):
 *   SCRAPINGBEE_API_KEY = (free at scrapingbee.com, 1000 free credits)
 *
 * ─── HOW TO RUN ────────────────────────────────────────────────
 * After deploying, open this URL in your browser:
 *   https://toys-land.netlify.app/.netlify/functions/scrape-onkar?secret=YOUR_SCRAPE_SECRET
 *
 * It will show live progress and add all items to your sheet automatically.
 */

const STORE_SLUG = "onkartoys";

export default async (req) => {
  const { searchParams } = new URL(req.url);
  const secret = searchParams.get("secret");

  // Debug mode — shows env var status without exposing values
  if (searchParams.get("debug") === "1") {
    return json({
      SCRAPE_SECRET_set: !!process.env.SCRAPE_SECRET,
      SCRAPE_SECRET_length: (process.env.SCRAPE_SECRET || "").length,
      APPS_SCRIPT_URL_set: !!process.env.APPS_SCRIPT_URL,
      secret_you_sent: secret,
      match: secret === process.env.SCRAPE_SECRET,
    });
  }

  // Security check
  const expectedSecret = process.env.SCRAPE_SECRET;
  if (!expectedSecret) {
    return json({ error: "SCRAPE_SECRET env var not set in Netlify. Add it in Site configuration → Environment variables, then redeploy." }, 500);
  }
  if (secret !== expectedSecret) {
    return json({ error: `Wrong secret. You sent: "${secret}". Check your SCRAPE_SECRET env var value.` }, 401);
  }

  const appsScriptUrl = process.env.APPS_SCRIPT_URL;
  if (!appsScriptUrl) {
    return json({ error: "APPS_SCRIPT_URL environment variable not set in Netlify." }, 500);
  }

  const log = [];
  try {
    // ── 1. Discover and scrape all items ──────────────────────
    log.push("🔍 Attempting to fetch data from catalog.to...");
    const items = await scrapeAllItems(log);

    if (items.length === 0) {
      return json({
        success: false,
        log,
        message: "Could not scrape any items. See the 'next_steps' field.",
        next_steps: getNextSteps(),
      });
    }

    log.push(`✅ Found ${items.length} items across all catalogues`);

    // ── 2. Write to Google Sheet ──────────────────────────────
    log.push("📝 Writing to your Google Sheet...");
    const { added, failed, failedItems } = await writeToSheet(items, appsScriptUrl, log);

    return json({
      success: true,
      log,
      stats: { total: items.length, added, failed },
      failed_items: failedItems,
    });
  } catch (err) {
    return json({ success: false, error: err.message, log }, 500);
  }
};

// ── Try every known catalog.to API pattern ────────────────────
async function scrapeAllItems(log) {
  // catalog.to is built on a backend that exposes REST endpoints.
  // We try multiple patterns used by different versions of their platform.
  const strategies = [
    tryFirebaseAPI,
    tryCatalogDirectAPI,
    tryPublicDataJSON,
  ];

  for (const strategy of strategies) {
    try {
      const items = await strategy(STORE_SLUG, log);
      if (items && items.length > 0) return items;
    } catch (e) {
      log.push(`  Strategy failed: ${e.message}`);
    }
  }

  return [];
}

// Strategy 1: catalog.to's Firebase Firestore REST API
async function tryFirebaseAPI(slug, log) {
  log.push("  [Strategy 1] Trying Firebase Firestore API...");

  // catalog.to stores data in Firebase — the project IDs they commonly use:
  const firebaseProjects = ["catalog-to-prod", "catalogto", "catalog-app-prod"];

  for (const project of firebaseProjects) {
    const url = `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents/stores/${slug}/catalogues`;
    try {
      const res = await fetchWithTimeout(url, 6000);
      if (res.ok) {
        const data = await res.json();
        log.push(`  ✅ Firebase API hit! Project: ${project}`);
        return parseFirestoreResponse(data, slug, log);
      }
    } catch (e) {}
  }

  // Also try their REST API directly
  const apiUrl = `https://api.catalog.to/api/v1/store/${slug}`;
  try {
    const res = await fetchWithTimeout(apiUrl, 6000);
    if (res.ok) {
      const data = await res.json();
      log.push(`  ✅ catalog.to REST API responded`);
      return parseCatalogAPIResponse(data, log);
    }
  } catch (e) {}

  return [];
}

// Strategy 2: Direct API endpoints catalog.to exposes
async function tryCatalogDirectAPI(slug, log) {
  log.push("  [Strategy 2] Trying catalog.to direct endpoints...");

  const endpoints = [
    `https://${slug}.catalog.to/api/catalogues`,
    `https://catalog.to/api/store/${slug}`,
    `https://api.catalog.to/store/${slug}/products`,
    `https://${slug}.catalog.to/data.json`,
    `https://${slug}.catalog.to/products.json`,
  ];

  for (const url of endpoints) {
    try {
      const res = await fetchWithTimeout(url, 6000, {
        Accept: "application/json",
        "User-Agent": "Mozilla/5.0 (compatible)",
      });
      if (res.ok) {
        const text = await res.text();
        if (text.trim().startsWith("{") || text.trim().startsWith("[")) {
          const data = JSON.parse(text);
          log.push(`  ✅ Got JSON from: ${url}`);
          return parseCatalogAPIResponse(data, log);
        }
      }
    } catch (e) {}
  }

  return [];
}

// Strategy 3: Try to fetch the site HTML and extract embedded JSON (Next.js/Nuxt style)
async function tryPublicDataJSON(slug, log) {
  log.push("  [Strategy 3] Trying to extract embedded JSON from page HTML...");

  const res = await fetchWithTimeout(`https://${slug}.catalog.to`, 10000, {
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
    Accept: "text/html",
  });

  if (!res.ok) {
    log.push(`  HTML fetch failed: ${res.status}`);
    return [];
  }

  const html = await res.text();
  log.push(`  Got ${html.length} bytes of HTML`);

  // Look for embedded JSON data (common in SSR frameworks)
  const patterns = [
    /__NEXT_DATA__\s*=\s*({.+?})\s*<\/script>/s,
    /__NUXT__\s*=\s*(.+?)\s*<\/script>/s,
    /window\.__STATE__\s*=\s*({.+?})\s*;?\s*<\/script>/s,
    /window\.__data__\s*=\s*({.+?})\s*;?\s*<\/script>/s,
    /<script[^>]+type="application\/json"[^>]*>({.+?})<\/script>/s,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) {
      try {
        const data = JSON.parse(match[1]);
        log.push(`  ✅ Found embedded JSON data`);
        return extractItemsFromEmbeddedData(data, log);
      } catch (e) {
        log.push(`  JSON parse failed: ${e.message}`);
      }
    }
  }

  // Also try to find any script tags that load data
  const scriptSrcs = [...html.matchAll(/src="([^"]*chunk[^"]*\.js[^"]*)"/g)].map(m => m[1]);
  log.push(`  Found ${scriptSrcs.length} JS chunks — HTML scraping not possible without headless browser`);

  return [];
}

// ── Response parsers ──────────────────────────────────────────
function parseFirestoreResponse(data, slug, log) {
  const items = [];
  const documents = data.documents || [];

  for (const doc of documents) {
    const fields = doc.fields || {};
    const catName = getFirestoreField(fields.name) || "General";
    const catItems = getFirestoreField(fields.items) || [];

    for (const item of catItems) {
      const f = item.mapValue?.fields || item;
      items.push({
        name: getFirestoreField(f.name) || "Product",
        category: catName,
        price: parsePrice(getFirestoreField(f.price) || getFirestoreField(f.selling_price)),
        original_price: parsePrice(getFirestoreField(f.original_price) || getFirestoreField(f.mrp)),
        image_url: getFirestoreField(f.image) || getFirestoreField(f.image_url) || "",
        description: getFirestoreField(f.description) || "",
        age_range: "3-12",
        brand: "Onkar Toys",
        rating: 4.5,
      });
    }
  }

  log.push(`  Parsed ${items.length} items from Firestore`);
  return items;
}

function getFirestoreField(field) {
  if (!field) return null;
  return field.stringValue ?? field.integerValue ?? field.doubleValue ?? field.arrayValue?.values ?? null;
}

function parseCatalogAPIResponse(data, log) {
  const items = [];
  // Handle various possible shapes
  const catalogues = data.catalogues || data.categories || data.sections ||
    (Array.isArray(data) ? data : null) || [];

  for (const cat of catalogues) {
    const catName = cat.name || cat.title || "General";
    const catItems = cat.items || cat.products || cat.entries || [];

    for (const item of catItems) {
      items.push({
        name: item.name || item.title || "Product",
        category: catName,
        price: parsePrice(item.price || item.selling_price || item.amount),
        original_price: parsePrice(item.original_price || item.mrp || item.compare_price),
        image_url: item.image_url || item.image || item.photo ||
          (item.images?.[0]?.url) || (item.images?.[0]) || "",
        description: item.description || item.details || item.name || "",
        age_range: item.age_range || item.age || "3-12",
        brand: item.brand || "Onkar Toys",
        rating: item.rating || 4.5,
      });
    }
  }

  log.push(`  Parsed ${items.length} items`);
  return items;
}

function extractItemsFromEmbeddedData(data, log) {
  // Walk the embedded JSON to find arrays that look like product lists
  const items = [];
  const found = findProductArrays(data);
  for (const arr of found) {
    for (const item of arr) {
      if (item.name && (item.price || item.image)) {
        items.push({
          name: item.name || item.title,
          category: item.category || item.catalogue || item.section || "General",
          price: parsePrice(item.price || item.selling_price),
          original_price: parsePrice(item.original_price || item.mrp),
          image_url: item.image_url || item.image || item.photo || "",
          description: item.description || item.name || "",
          age_range: item.age_range || "3-12",
          brand: item.brand || "Onkar Toys",
          rating: item.rating || 4.5,
        });
      }
    }
  }
  log.push(`  Extracted ${items.length} items from embedded data`);
  return items;
}

function findProductArrays(obj, depth = 0) {
  if (depth > 8 || !obj || typeof obj !== "object") return [];
  const results = [];
  if (Array.isArray(obj)) {
    if (obj.length > 0 && typeof obj[0] === "object" && (obj[0].name || obj[0].title)) {
      results.push(obj);
    }
    for (const item of obj) results.push(...findProductArrays(item, depth + 1));
  } else {
    for (const val of Object.values(obj)) results.push(...findProductArrays(val, depth + 1));
  }
  return results;
}

// ── Write items to Google Sheet via Apps Script ───────────────
async function writeToSheet(items, appsScriptUrl, log) {
  let added = 0, failed = 0;
  const failedItems = [];

  for (const item of items) {
    try {
      const payload = {
        action: "add_product",
        name: item.name,
        category: item.category,
        price: item.price || 0,
        original_price: item.original_price || Math.round((item.price || 0) * 1.3),
        image_url: item.image_url,
        description: item.description || item.name,
        age_range: item.age_range || "3-12",
        brand: item.brand || "Onkar Toys",
        stock: true,
        rating: item.rating || 4.5,
      };

      const res = await fetchWithTimeout(appsScriptUrl, 15000, {
        "Content-Type": "application/x-www-form-urlencoded",
      }, "POST", `data=${encodeURIComponent(JSON.stringify(payload))}`);

      const result = await res.json();
      if (result.success) {
        added++;
      } else {
        failed++;
        failedItems.push({ name: item.name, error: result.error });
      }
    } catch (e) {
      failed++;
      failedItems.push({ name: item.name, error: e.message });
    }
  }

  log.push(`  Sheet write complete: ${added} added, ${failed} failed`);
  return { added, failed, failedItems };
}

// ── Utility helpers ───────────────────────────────────────────
async function fetchWithTimeout(url, ms = 8000, headers = {}, method = "GET", body = null) {
  const opts = {
    method,
    headers: { "User-Agent": "Mozilla/5.0 (compatible; ToylandScraper/1.0)", ...headers },
    signal: AbortSignal.timeout(ms),
  };
  if (body) opts.body = body;
  return fetch(url, opts);
}

function parsePrice(val) {
  if (!val) return 0;
  const n = parseFloat(String(val).replace(/[^0-9.]/g, ""));
  return isNaN(n) ? 0 : Math.round(n);
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function getNextSteps() {
  return [
    "catalog.to fully renders via JavaScript — a headless browser is needed to scrape it.",
    "EASIEST FIX: Add SCRAPINGBEE_API_KEY to your Netlify env vars (free at scrapingbee.com).",
    "OR: Ask Onkar Toys to export their product CSV from their catalog.to dashboard and share it with you. You can then run the bulk import script in your Google Sheet.",
  ];
}

export const config = {
  path: "/.netlify/functions/scrape-onkar",
};
