/**
 * Netlify Function: scrape-onkar
 *
 * Scrapes ALL catalogues + items + images from onkartoys.catalog.to (QuickSell platform)
 * and writes them directly to your Google Sheet via your Apps Script URL.
 *
 * ENV VARS (Netlify Dashboard → Site config → Environment variables):
 *   APPS_SCRIPT_URL = your Google Apps Script web app URL
 *   SCRAPE_SECRET   = toyland2026
 *
 * RUN:
 *   https://toys-land.netlify.app/.netlify/functions/scrape-onkar?secret=toyland2026
 *
 * INSPECT RAW DATA (for debugging):
 *   https://toys-land.netlify.app/.netlify/functions/scrape-onkar?secret=toyland2026&inspect=1
 */

const STORE_URL = "https://onkartoys.catalog.to";

export default async (req) => {
  const { searchParams } = new URL(req.url);
  const secret = searchParams.get("secret");

  // ── Debug: env check ──────────────────────────────────────────
  if (searchParams.get("debug") === "1") {
    return json({
      SCRAPE_SECRET_set: !!process.env.SCRAPE_SECRET,
      APPS_SCRIPT_URL_set: !!process.env.APPS_SCRIPT_URL,
      secret_you_sent: secret,
      match: secret === process.env.SCRAPE_SECRET,
    });
  }

  // ── Auth ──────────────────────────────────────────────────────
  if (secret !== process.env.SCRAPE_SECRET) {
    return json({ error: `Wrong secret.` }, 401);
  }

  const appsScriptUrl = process.env.APPS_SCRIPT_URL;
  if (!appsScriptUrl) return json({ error: "APPS_SCRIPT_URL not set." }, 500);

  // ── Inspect mode: dump the raw QuickSell JSON blobs ──────────
  if (searchParams.get("inspect") === "1") {
    const { metaData, amalgam, error } = await fetchQuickSellData();
    if (error) return json({ error }, 500);
    return json({
      metaData_keys: Object.keys(metaData || {}),
      amalgam_keys: Object.keys(amalgam || {}),
      metaData_sample: JSON.stringify(metaData).substring(0, 2000),
      amalgam_sample: JSON.stringify(amalgam).substring(0, 3000),
    });
  }

  // ── Main: scrape + write to sheet ────────────────────────────
  const log = [];
  try {
    log.push("🔍 Fetching QuickSell data from onkartoys.catalog.to...");
    const { metaData, amalgam, error } = await fetchQuickSellData();

    if (error) return json({ success: false, error, log });

    log.push("✅ Got metaData and amalgam JSON blobs from page");

    const items = extractItems(metaData, amalgam, log);

    if (items.length === 0) {
      return json({
        success: false,
        log,
        message: "Parsed the QuickSell data but found 0 items. Run &inspect=1 to see the raw structure.",
      });
    }

    log.push(`✅ Extracted ${items.length} items across all catalogues`);
    log.push("📝 Writing to Google Sheet...");

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

// ── Fetch and parse the two QuickSell JSON blobs from the HTML ─
async function fetchQuickSellData() {
  try {
    const res = await fetch(STORE_URL, {
      headers: {
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) return { error: `HTTP ${res.status} from catalog.to` };

    const html = await res.text();

    // Extract metaData-json blob
    const metaMatch = html.match(/<script[^>]*id=["']?metaData-json["']?[^>]*>([\s\S]*?)<\/script>/i)
      || html.match(/id=["']?metaData-json["']?[^>]*>([\s\S]*?)<\/script>/i);

    // Extract amalgam-json blob (this has the catalogues + products)
    const amalgamMatch = html.match(/<script[^>]*id=["']?amalgam-json["']?[^>]*>([\s\S]*?)<\/script>/i)
      || html.match(/id=["']?amalgam-json["']?[^>]*>([\s\S]*?)<\/script>/i);

    if (!amalgamMatch) {
      // Try alternate patterns in case IDs have no quotes
      const altAmalgam = html.match(/amalgam-json[^>]*>([\s\S]*?)<\/script>/i);
      const altMeta = html.match(/metaData-json[^>]*>([\s\S]*?)<\/script>/i);
      if (!altAmalgam) {
        return { error: "Could not find amalgam-json or metaData-json in the HTML. The page structure may have changed." };
      }
      return {
        metaData: altMeta ? JSON.parse(altMeta[1]) : {},
        amalgam: JSON.parse(altAmalgam[1]),
      };
    }

    return {
      metaData: metaMatch ? JSON.parse(metaMatch[1]) : {},
      amalgam: JSON.parse(amalgamMatch[1]),
    };
  } catch (e) {
    return { error: `Fetch/parse error: ${e.message}` };
  }
}

// ── Extract items from QuickSell's data structure ─────────────
function extractItems(metaData, amalgam, log) {
  const items = [];

  // QuickSell's amalgam object typically has:
  // { collections: [...], products: [...] }  OR
  // { catalogues: [...] }  OR
  // { categories: [...] }
  // Each collection/catalogue has a name and list of product IDs or embedded products

  // Build a product lookup map if products are separate
  const productMap = {};
  const rawProducts = amalgam.products || amalgam.items || amalgam.productList || [];
  for (const p of rawProducts) {
    const id = p.id || p._id || p.productId;
    if (id) productMap[id] = p;
  }
  log.push(`  Product map size: ${Object.keys(productMap).length}`);

  // Get catalogues/collections
  const catalogues = amalgam.collections || amalgam.catalogues || amalgam.categories
    || amalgam.sections || amalgam.groups || [];

  log.push(`  Found ${catalogues.length} catalogues in amalgam`);

  for (const cat of catalogues) {
    const catName = cat.name || cat.title || cat.label || "General";
    const catProducts = cat.products || cat.items || cat.entries || cat.productList || [];

    for (const p of catProducts) {
      // Product might be inline or just an ID referencing productMap
      const product = (typeof p === "string" || typeof p === "number")
        ? (productMap[p] || null)
        : p;

      if (!product) continue;

      const name = product.name || product.title || product.productName || "";
      if (!name) continue;

      // Image URL — QuickSell uses CDN URLs
      const imageUrl = extractQuickSellImage(product);

      // Price — QuickSell stores in paise (1/100 rupee) sometimes
      let price = toPrice(product.price || product.sellingPrice || product.selling_price
        || product.sp || product.amount || 0);
      let originalPrice = toPrice(product.mrp || product.originalPrice || product.original_price
        || product.maxPrice || product.mp || 0);

      // If price looks like paise (e.g. 50000 for ₹500), convert
      if (price > 100000) { price = Math.round(price / 100); }
      if (originalPrice > 100000) { originalPrice = Math.round(originalPrice / 100); }
      if (originalPrice === 0) originalPrice = Math.round(price * 1.3);

      items.push({
        name,
        category: catName,
        price,
        original_price: originalPrice,
        image_url: imageUrl,
        description: product.description || product.details || product.note || name,
        age_range: "3-12",
        brand: "Onkar Toys",
        rating: 4.5,
      });
    }
  }

  // Fallback: if no catalogues found, try flat product list
  if (items.length === 0 && rawProducts.length > 0) {
    log.push("  No catalogues structure found, using flat product list...");
    for (const product of rawProducts) {
      const name = product.name || product.title || product.productName || "";
      if (!name) continue;
      items.push({
        name,
        category: product.category || product.categoryName || product.collection || "General",
        price: toPrice(product.price || product.sellingPrice || product.sp || 0),
        original_price: toPrice(product.mrp || product.originalPrice || product.mp || 0),
        image_url: extractQuickSellImage(product),
        description: product.description || name,
        age_range: "3-12",
        brand: "Onkar Toys",
        rating: 4.5,
      });
    }
  }

  return items;
}

// QuickSell stores images on their CDN or S3 — extract the best URL
function extractQuickSellImage(product) {
  // Direct image fields
  const direct = product.image || product.imageUrl || product.image_url
    || product.photo || product.thumbnail || product.img;
  if (direct && typeof direct === "string" && direct.startsWith("http")) return direct;

  // Images array
  const imgs = product.images || product.imageList || product.photos || [];
  if (imgs.length > 0) {
    const first = imgs[0];
    if (typeof first === "string") return first;
    if (first.url) return first.url;
    if (first.src) return first.src;
    // QuickSell image object with key
    if (first.key || first.id) {
      return `https://catalogue-cdn.quicksell.co/s/${first.key || first.id}`;
    }
  }

  // QuickSell-specific: imageKey or key field
  if (product.imageKey || product.key || product.imageId) {
    return `https://catalogue-cdn.quicksell.co/s/${product.imageKey || product.key || product.imageId}`;
  }

  return "";
}

// ── Write to Google Sheet ─────────────────────────────────────
async function writeToSheet(items, url, log) {
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

      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `data=${encodeURIComponent(JSON.stringify(payload))}`,
        signal: AbortSignal.timeout(20000),
      });

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

  log.push(`  Sheet write: ${added} added, ${failed} failed`);
  return { added, failed, failedItems };
}

// ── Helpers ───────────────────────────────────────────────────
function toPrice(val) {
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
