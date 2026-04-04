/**
 * Netlify Function: scrape-onkar
 * Platform: QuickSell (catalog.to)
 *
 * ENV VARS needed in Netlify:
 *   APPS_SCRIPT_URL  = your Google Apps Script web app URL
 *   SCRAPE_SECRET    = toyland2026
 *
 * URLs:
 *   Debug  : /scrape-onkar?debug=1
 *   Inspect: /scrape-onkar?secret=toyland2026&inspect=1
 *   Run    : /scrape-onkar?secret=toyland2026
 *   Probe  : /scrape-onkar?secret=toyland2026&probe=1   ← finds the right API URL
 */

const STORE_BASE = "https://onkartoys.catalog.to";
const COMPANY_ID = "-O45EEmKrx4yZAGq44QL";
const USER_ID    = "-O45EEmKrx4yZAGq44QK";

// Known catalogue IDs and slugs from the amalgam-json
const CATALOGUES = [
  { id: "-Ol6fjocrt1ataQgvk9T", title: "BOARD GAMES",                     slug: "onkar-toys/board-games/m04",               count: 77  },
  { id: "-OJ7ASiPSEi3c8FjnV4a", title: "TOYS BELOW 200",                  slug: "onkar-toys/toys-below-200/chi",            count: 81  },
  { id: "-OJ7DT8T-Fnx-v_ec5fY", title: "TOYS RANGE 200-500",              slug: "onkar-toys/toys-range-200-500/t0d",        count: 72  },
  { id: "-OJ7FcPBCqd8wkknDGAC", title: "TOYS RANGE 500-1000",             slug: "onkar-toys/toys-range-500-1000/ll7",       count: 34  },
  { id: "-OJ7FoKZpSNgHi-AT6hI", title: "TOYS ABOVE 1000",                 slug: "onkar-toys/toys-above-1000/t4p",           count: 2   },
  { id: "-O4yWIceW2kwzjoQNJNp", title: "REMOTE CONTROL TOYS",             slug: "onkar-toys/remote-control-toys/699",       count: 56  },
  { id: "-OJ7GjbexFbg1wtNM51u", title: "INTEX ITEMS",                     slug: "onkar-toys/intex-items/cmh",               count: 20  },
  { id: "-O4xteWZt3KFNvTz4H2z", title: "MUSICAL GUN ITEMS",               slug: "onkar-toys/gunsmusicaldartsjelly/9r2",     count: 13  },
  { id: "-OJXsl0qIbzlLZbASVhn", title: "FLYING TOYS",                     slug: "onkar-toys/flying-toys/daa",               count: 6   },
  { id: "-O4xteWZt3KFNvTz4H2z", title: "DOZEN BOX ITEMS/STATIONERY ITEMS",slug: "onkar-toys/dozen-box-items/02f",           count: 18  },
];

export default async (req) => {
  const { searchParams } = new URL(req.url);
  const secret = searchParams.get("secret");

  if (searchParams.get("debug") === "1") {
    return json({
      SCRAPE_SECRET_set: !!process.env.SCRAPE_SECRET,
      APPS_SCRIPT_URL_set: !!process.env.APPS_SCRIPT_URL,
      match: secret === process.env.SCRAPE_SECRET,
    });
  }

  if (secret !== process.env.SCRAPE_SECRET) return json({ error: "Wrong secret." }, 401);
  const appsScriptUrl = process.env.APPS_SCRIPT_URL;
  if (!appsScriptUrl) return json({ error: "APPS_SCRIPT_URL not set." }, 500);

  // ── Inspect: show catalogue list ────────────────────────────
  if (searchParams.get("inspect") === "1") {
    const amalgam = await fetchAmalgam(STORE_BASE);
    return json({
      total_catalogues: amalgam.catalogues?.length,
      catalogues: amalgam.catalogues?.map(c => ({ id: c.id, title: c.title, slug: c.slug, count: c.productCount })),
    });
  }

  // ── Probe: try every possible API pattern on first catalogue ─
  if (searchParams.get("probe") === "1") {
    const cat = CATALOGUES[0];
    const results = [];
    const urlsToTry = buildCatalogueUrls(cat);
    for (const url of urlsToTry) {
      try {
        const res = await fetch(url, {
          headers: { "User-Agent": "Mozilla/5.0 Chrome/120.0.0.0" },
          signal: AbortSignal.timeout(8000),
        });
        const body = await res.text();
        const isJson = body.trim()[0] === "{" || body.trim()[0] === "[";
        const hasProducts = body.includes("products") || body.includes("name");
        results.push({
          url,
          status: res.status,
          isJson,
          hasProducts,
          preview: body.substring(0, 200),
        });
      } catch (e) {
        results.push({ url, error: e.message });
      }
    }
    return json({ probe_results: results });
  }

  // ── MAIN SCRAPE ───────────────────────────────────────────────
  const log = [];
  try {
    // Get fresh catalogue list with IDs from homepage
    log.push("📂 Fetching catalogue list...");
    const homeAmalgam = await fetchAmalgam(STORE_BASE);
    const catalogues = homeAmalgam.catalogues || [];
    log.push(`✅ ${catalogues.length} catalogues found`);

    const allItems = [];

    for (const cat of catalogues) {
      log.push(`  📦 ${cat.title} (${cat.productCount} products)...`);
      try {
        const products = await fetchCatalogueProducts(cat, log);
        log.push(`    → ${products.length} products extracted`);
        allItems.push(...products);
      } catch (e) {
        log.push(`    ❌ ${e.message}`);
      }
      await sleep(400);
    }

    log.push(`✅ Total: ${allItems.length} products`);

    if (allItems.length === 0) {
      return json({ success: false, log, tip: "Run ?probe=1 to find the working API URL pattern." });
    }

    log.push("📝 Writing to Google Sheet...");
    const { added, failed, failedItems } = await writeToSheet(allItems, appsScriptUrl, log);

    return json({
      success: true, log,
      stats: { catalogues: catalogues.length, total: allItems.length, added, failed },
      failed_items: failedItems.slice(0, 10),
    });
  } catch (err) {
    return json({ success: false, error: err.message, log }, 500);
  }
};

// ── Build every possible URL pattern for a catalogue ─────────
function buildCatalogueUrls(cat) {
  const id = cat.id;
  const slug = cat.slug;
  const shortSlug = slug.split("/").pop(); // e.g. "m04"
  const midSlug = slug.split("/").slice(0,2).join("/"); // e.g. "onkar-toys/board-games"

  return [
    // QuickSell Firebase REST API patterns
    `https://quicksell.co/api/v1/catalogues/${id}/products`,
    `https://api.quicksell.co/v1/catalogues/${id}/products`,
    `https://api.quicksell.co/catalogues/${id}/products`,
    `https://quicksell.co/api/catalogues/${id}`,
    `https://catalogue-cdn.quicksell.co/catalogues/${id}`,
    `https://catalogue-cdn.quicksell.co/catalogues/${id}/products`,
    // Firebase Firestore REST
    `https://firestore.googleapis.com/v1/projects/quicksell-prod/databases/(default)/documents/catalogues/${id}/products`,
    `https://firestore.googleapis.com/v1/projects/quicksell-app/databases/(default)/documents/catalogues/${id}`,
    `https://firestore.googleapis.com/v1/projects/quicksell/databases/(default)/documents/catalogues/${id}`,
    // catalog.to with ID
    `${STORE_BASE}/catalogue/${id}`,
    `${STORE_BASE}/c/${id}`,
    `${STORE_BASE}/api/catalogue/${id}`,
    `${STORE_BASE}/api/catalogues/${id}/products`,
    // catalog.to with slug variations
    `${STORE_BASE}/${midSlug}`,
    `${STORE_BASE}/${shortSlug}`,
    // QuickSell CDN data files
    `https://d19s00k70wfv0n.cloudfront.net/${USER_ID}/catalogues/${id}.json`,
    `https://do9uy4stciz2v.cloudfront.net/${USER_ID}/catalogues/${id}.json`,
    `https://d19s00k70wfv0n.cloudfront.net/catalogues/${id}.json`,
  ];
}

// ── Try all URL patterns for a catalogue, return products ─────
async function fetchCatalogueProducts(cat, log) {
  // Strategy A: try fetching the catalogue page with different URL formats
  const urlFormats = [
    // Try with just the middle part of the slug (no last segment)
    `${STORE_BASE}/${cat.slug.split("/").slice(0, 2).join("/")}`,
    // Try with ID appended
    `${STORE_BASE}/${cat.slug.split("/").slice(0, 2).join("/")}/${cat.id}`,
    // Try QuickSell's direct API
    `https://api.quicksell.co/v1/catalogues/${cat.id}/products`,
    `https://quicksell.co/api/v1/catalogues/${cat.id}/products`,
    // Try CDN JSON
    `https://d19s00k70wfv0n.cloudfront.net/${USER_ID}/catalogues/${cat.id}.json`,
    `https://do9uy4stciz2v.cloudfront.net/${USER_ID}/catalogues/${cat.id}.json`,
  ];

  for (const url of urlFormats) {
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
          "Accept": "text/html,application/json,*/*",
        },
        signal: AbortSignal.timeout(10000),
      });

      if (!res.ok) continue;
      const text = await res.text();

      // If it's JSON, parse directly
      if (text.trim()[0] === "{" || text.trim()[0] === "[") {
        const data = JSON.parse(text);
        const products = extractFromJson(data, cat.title);
        if (products.length > 0) {
          log.push(`    ✅ JSON API: ${url}`);
          return products;
        }
      }

      // If it's HTML, look for amalgam-json
      if (text.includes("amalgam-json")) {
        const match = text.match(/id=["']?amalgam-json["']?[^>]*>([\s\S]*?)<\/script>/i);
        if (match) {
          const amalgam = JSON.parse(match[1]);
          const products = extractProductsFromAmalgam(amalgam, cat.title);
          if (products.length > 0) {
            log.push(`    ✅ HTML amalgam: ${url}`);
            return products;
          }
        }
      }
    } catch (e) { /* try next */ }
  }

  return [];
}

// ── Extract products from a JSON API response ─────────────────
function extractFromJson(data, categoryName) {
  const items = [];
  const raw = data.products || data.items || data.productList
    || (Array.isArray(data) ? data : []);

  for (const p of raw) {
    const name = p.name || p.title || p.productName || "";
    if (!name) continue;
    items.push(buildItem(p, categoryName));
  }
  return items;
}

// ── Extract products from an HTML page's amalgam object ───────
function extractProductsFromAmalgam(amalgam, categoryName) {
  const items = [];
  const raw = amalgam.products || amalgam.catalogue?.products
    || amalgam.catalogueProducts || amalgam.productList || [];

  for (const p of raw) {
    const name = p.name || p.title || p.productName || "";
    if (!name) continue;
    items.push(buildItem(p, categoryName));
  }
  return items;
}

function buildItem(p, categoryName) {
  let price = toNum(p.sellingPrice ?? p.price ?? p.sp ?? p.amount ?? 0);
  let mrp   = toNum(p.mrp ?? p.maxPrice ?? p.originalPrice ?? p.mp ?? 0);
  if (price > 100000) price = Math.round(price / 100);
  if (mrp   > 100000) mrp   = Math.round(mrp   / 100);
  if (mrp < price || mrp === 0) mrp = Math.round(price * 1.3);

  return {
    name: (p.name || p.title || p.productName || "").trim(),
    category: categoryName,
    price,
    original_price: mrp,
    image_url: extractImage(p),
    description: (p.description || p.details || p.note || p.name || "").trim(),
    age_range: "3-12",
    brand: "Onkar Toys",
    rating: 4.5,
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
    if (first?.src) return first.src;
    const key = first?.key || first?.id || first?.name;
    if (key) return `https://catalogue-cdn.quicksell.co/s/${key}`;
  }
  const key = p.imageKey || p.key || p.imageId;
  if (key) return `https://catalogue-cdn.quicksell.co/s/${key}`;
  // Construct from known CloudFront pattern
  const pid = p.id || p.productId || p._id;
  if (pid) return `https://do9uy4stciz2v.cloudfront.net/${USER_ID}/products/${pid}.jpg`;
  return "";
}

// ── Fetch amalgam-json from any page ─────────────────────────
async function fetchAmalgam(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml",
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  const match = html.match(/id=["']?amalgam-json["']?[^>]*>([\s\S]*?)<\/script>/i);
  if (!match) throw new Error("No amalgam-json found");
  return JSON.parse(match[1]);
}

// ── Write to Google Sheet ─────────────────────────────────────
async function writeToSheet(items, appsScriptUrl, log) {
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
      const res = await fetch(appsScriptUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `data=${encodeURIComponent(JSON.stringify(payload))}`,
        signal: AbortSignal.timeout(25000),
      });
      let result;
      try { result = await res.json(); } catch { result = { error: "bad response" }; }
      if (result.success) { added++; }
      else { failed++; failedItems.push({ name: item.name, error: result.error }); }
    } catch (e) {
      failed++;
      failedItems.push({ name: item.name, error: e.message });
    }
  }
  log.push(`  ✅ Sheet: ${added} added, ${failed} failed`);
  return { added, failed, failedItems };
}

function toNum(v) {
  const n = parseFloat(String(v ?? 0).replace(/[^0-9.]/g, ""));
  return isNaN(n) ? 0 : n;
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status, headers: { "Content-Type": "application/json" },
  });
}
