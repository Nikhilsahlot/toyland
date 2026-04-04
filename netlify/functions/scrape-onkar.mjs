/**
 * Netlify Function: scrape-onkar
 * Platform: QuickSell (catalog.to)
 *
 * How it works:
 * 1. Fetches the homepage amalgam-json → gets all 11 catalogue slugs
 * 2. Fetches each catalogue page → parses its amalgam-json for products
 * 3. Writes every product to your Google Sheet via Apps Script
 *
 * ENV VARS needed in Netlify:
 *   APPS_SCRIPT_URL  = your Google Apps Script web app URL
 *   SCRAPE_SECRET    = toyland2026
 *
 * URLs:
 *   Run scraper : /scrape-onkar?secret=toyland2026
 *   Debug env   : /scrape-onkar?debug=1
 *   Inspect data: /scrape-onkar?secret=toyland2026&inspect=1
 */

const STORE_BASE = "https://onkartoys.catalog.to";

export default async (req) => {
  const { searchParams } = new URL(req.url);
  const secret = searchParams.get("secret");

  // Debug: check env vars
  if (searchParams.get("debug") === "1") {
    return json({
      SCRAPE_SECRET_set: !!process.env.SCRAPE_SECRET,
      APPS_SCRIPT_URL_set: !!process.env.APPS_SCRIPT_URL,
      secret_sent: secret,
      match: secret === process.env.SCRAPE_SECRET,
    });
  }

  // Auth
  if (secret !== process.env.SCRAPE_SECRET) {
    return json({ error: "Wrong secret." }, 401);
  }

  const appsScriptUrl = process.env.APPS_SCRIPT_URL;
  if (!appsScriptUrl) return json({ error: "APPS_SCRIPT_URL not set." }, 500);

  // Inspect: show catalogue list from homepage
  if (searchParams.get("inspect") === "1") {
    const amalgam = await fetchAmalgam(STORE_BASE);
    const catalogues = (amalgam.catalogues || []).map(c => ({
      title: c.title,
      slug: c.slug,
      productCount: c.productCount,
      url: `${STORE_BASE}/${c.slug}`,
    }));
    return json({ total_catalogues: catalogues.length, catalogues });
  }

  // ── MAIN SCRAPE ───────────────────────────────────────────────
  const log = [];

  try {
    // Step 1: get all catalogue slugs from homepage
    log.push("📂 Fetching catalogue list from homepage...");
    const homeAmalgam = await fetchAmalgam(STORE_BASE);
    const catalogues = homeAmalgam.catalogues || [];

    if (catalogues.length === 0) {
      return json({ success: false, log, error: "No catalogues found in amalgam-json." });
    }
    log.push(`✅ Found ${catalogues.length} catalogues: ${catalogues.map(c => c.title).join(", ")}`);

    // Step 2: fetch each catalogue page and extract products
    const allItems = [];
    for (const cat of catalogues) {
      const catUrl = `${STORE_BASE}/${cat.slug}`;
      log.push(`  📦 Fetching: ${cat.title} (${cat.productCount} products)...`);
      try {
        const catAmalgam = await fetchAmalgam(catUrl);
        const products = extractProductsFromCatalogue(catAmalgam, cat.title, log);
        log.push(`    → Got ${products.length} products`);
        allItems.push(...products);
      } catch (e) {
        log.push(`    ❌ Error: ${e.message}`);
      }
      // Small delay to be polite to the server
      await sleep(300);
    }

    log.push(`✅ Total: ${allItems.length} products across ${catalogues.length} catalogues`);

    if (allItems.length === 0) {
      return json({
        success: false, log,
        message: "Fetched all catalogues but found 0 products. Run &inspect=1 to check structure.",
      });
    }

    // Step 3: write to Google Sheet
    log.push("📝 Writing to Google Sheet...");
    const { added, failed, failedItems } = await writeToSheet(allItems, appsScriptUrl, log);

    return json({
      success: true,
      log,
      stats: { catalogues: catalogues.length, total_products: allItems.length, added, failed },
      failed_items: failedItems.slice(0, 10), // show first 10 failures only
    });

  } catch (err) {
    return json({ success: false, error: err.message, log }, 500);
  }
};

// ── Fetch and parse amalgam-json from any catalog page ────────
async function fetchAmalgam(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    },
    signal: AbortSignal.timeout(20000),
  });

  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const html = await res.text();

  // Target the amalgam-json script tag by ID
  const match = html.match(/id=["']?amalgam-json["']?[^>]*>([\s\S]*?)<\/script>/i);
  if (!match) throw new Error(`No amalgam-json found at ${url}`);

  return JSON.parse(match[1]);
}

// ── Extract products from a catalogue page's amalgam data ─────
function extractProductsFromCatalogue(amalgam, categoryName, log) {
  const items = [];

  // QuickSell catalogue pages have products in amalgam.products or
  // amalgam.catalogue.products or amalgam.catalogueProducts
  const rawProducts =
    amalgam.products ||
    amalgam.catalogue?.products ||
    amalgam.catalogueProducts ||
    amalgam.productList ||
    [];

  for (const p of rawProducts) {
    const name = p.name || p.title || p.productName || "";
    if (!name) continue;

    // Price handling — QuickSell sometimes stores in paise (×100), sometimes rupees
    let price = toNum(p.sellingPrice ?? p.price ?? p.sp ?? p.amount ?? 0);
    let mrp = toNum(p.mrp ?? p.maxPrice ?? p.originalPrice ?? p.mp ?? 0);

    // Convert from paise if needed (values above 100000 are almost certainly paise)
    if (price > 100000) price = Math.round(price / 100);
    if (mrp > 100000) mrp = Math.round(mrp / 100);
    if (mrp === 0 && price > 0) mrp = Math.round(price * 1.3);
    if (mrp < price) mrp = Math.round(price * 1.3);

    items.push({
      name: name.trim(),
      category: categoryName,
      price,
      original_price: mrp,
      image_url: extractImage(p),
      description: (p.description || p.details || p.note || name).trim(),
      age_range: "3-12",
      brand: "Onkar Toys",
      rating: 4.5,
    });
  }

  return items;
}

// ── Extract best image URL from a QuickSell product object ────
function extractImage(p) {
  // Direct string URL fields
  for (const field of ["imageUrl", "image_url", "image", "photo", "thumbnail", "pictureUrl"]) {
    if (p[field] && typeof p[field] === "string" && p[field].startsWith("http")) {
      return p[field];
    }
  }

  // Images array
  const imgs = p.images || p.imageList || p.photos || [];
  if (imgs.length > 0) {
    const first = imgs[0];
    if (typeof first === "string" && first.startsWith("http")) return first;
    if (first?.url) return first.url;
    if (first?.src) return first.src;
    // QuickSell image object with a key → build CDN URL
    const key = first?.key || first?.id || first?.name;
    if (key) return `https://catalogue-cdn.quicksell.co/s/${key}`;
  }

  // QuickSell-specific key fields
  const key = p.imageKey || p.key || p.imageId || p.imagekey;
  if (key) return `https://catalogue-cdn.quicksell.co/s/${key}`;

  // If there's a userId/companyId and productId, construct the CloudFront URL
  const uid = p.userId || p.companyUserId;
  const pid = p.id || p.productId || p._id;
  if (uid && pid) {
    return `https://do9uy4stciz2v.cloudfront.net/${uid}/products/${pid}.jpg`;
  }

  return "";
}

// ── Write all products to Google Sheet via Apps Script ────────
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
        image_url: item.image_url || "",
        description: item.description || item.name,
        age_range: item.age_range || "3-12",
        brand: item.brand || "Onkar Toys",
        stock: true,
        rating: item.rating || 4.5,
      };

      const res = await fetch(appsScriptUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `data=${encodeURIComponent(JSON.stringify(payload))}`,
        signal: AbortSignal.timeout(25000),
      });

      const text = await res.text();
      let result;
      try { result = JSON.parse(text); } catch { result = { error: text }; }

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

  log.push(`  ✅ Sheet: ${added} added, ${failed} failed`);
  return { added, failed, failedItems };
}

// ── Helpers ───────────────────────────────────────────────────
function toNum(val) {
  if (!val && val !== 0) return 0;
  const n = parseFloat(String(val).replace(/[^0-9.]/g, ""));
  return isNaN(n) ? 0 : n;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
