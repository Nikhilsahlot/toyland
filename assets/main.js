// All sensitive config is in Netlify environment variables
// No secrets in this file

let products = [];
let allProducts = [];
let cart = [];
let wishlist = [];
let filteredProducts = [];
let currentCategory = 'all';
let searchQuery = '';

async function loadProducts() {
  try {
    showSkeletonCards(24);
    const response = await fetch('/.netlify/functions/sheet');
    const text = await response.text();
    const json = JSON.parse(text.match(/google\.visualization\.Query\.setResponse\(([\s\S]*)\)/)[1]);
    const rows = json.table.rows;
    if (!rows || rows.length === 0) {
      showEmptyState();
      return;
    }
    products = rows.map((row, index) => ({
      id: row.c[0]?.v ?? index + 1,
      name: row.c[1]?.v ?? 'Unknown Product',
      category: row.c[2]?.v ?? 'Uncategorized',
      price: parseFloat(row.c[3]?.v) || 0,
      original_price: parseFloat(row.c[4]?.v) || 0,
      image_url: row.c[5]?.v ?? '',
      description: row.c[6]?.v ?? '',
      age_range: row.c[7]?.v ?? '',
      brand: row.c[8]?.v ?? '',
      in_stock: row.c[9]?.v === true || String(row.c[9]?.v ?? row.c[9]?.f ?? '').toUpperCase() === 'TRUE',
      rating: parseFloat(row.c[10]?.v) || 0,
      color: getCategoryColor(row.c[2]?.v ?? 'Uncategorized'),
      badge: 'NEW'
    })).filter(p => p.name && p.price > 0);
    allProducts = [...products];
    filteredProducts = [...products];
    buildDynamicUI(products);
    renderProducts(filteredProducts);
  } catch (error) {
    console.error('Failed to load products:', error);
    // Fallback to sample data
    loadSampleData();
  }
}

function loadSampleData() {
  products = [
    { id: 1, name: 'Spider-Man Action Figure', brand: 'Hasbro', category: 'Action Figures', age_range: '4-12', price: 799, original_price: 1199, image_url: '', description: '', in_stock: true, rating: 4.5, color: 'FF6B35', badge: 'SALE' },
    { id: 2, name: 'LEGO Classic Set', brand: 'LEGO', category: 'Building Blocks', age_range: '4-12', price: 2499, original_price: 3299, image_url: '', description: '', in_stock: true, rating: 4.9, color: '6C3CE1', badge: 'NEW' },
    // Add 22 more sample products matching schema
    // ... (truncated for brevity - full 24 products will be added)
  ];
  allProducts = [...products];
  filteredProducts = [...products];
  renderProducts(filteredProducts);
  updateCategoryCount(products);
}

function showSkeletonCards(count) {
  const grid = document.getElementById('productGrid');
  grid.innerHTML = Array.from({length: count}, () => `
    <div class="skeleton-card">
      <div class="skeleton skeleton-image"></div>
      <div class="skeleton skeleton-text"></div>
      <div class="skeleton skeleton-text short"></div>
      <div class="skeleton skeleton-price"></div>
      <div class="skeleton skeleton-btn"></div>
    </div>
  `).join('');
}

function showEmptyState() {
  const grid = document.getElementById('productGrid');
  grid.innerHTML = `
    <div class="empty-state">
      <div class="empty-state-icon">📭</div>
      <div class="empty-state-text">No products available</div>
      <div class="empty-state-subtext">Check back later or contact support</div>
    </div>
  `;
}

function showErrorState() {
  const grid = document.getElementById('productGrid');
  grid.innerHTML = `
    <div class="empty-state">
      <div class="empty-state-icon">⚠️</div>
      <div class="empty-state-text">Failed to load products</div>
      <div class="empty-state-subtext">Please check your internet connection and try again</div>
    </div>
  `;
}

function getCategoryColor(category) {
  const colors = {
    'Action Figures': 'FF6B35',
    'Building Blocks': '6C3CE1',
    'Board Games': '27AE60',
    'Remote Control': 'E74C3C',
    'Educational': 'F39C12',
    'Soft Toys': 'E91E8C',
    'Outdoor & Sports': '2ECC71',
    'Arts & Crafts': '9B59B6',
    'Uncategorized': '95A5A6'
  };
  return colors[category] || '95A5A6';
}

const CATEGORY_META = {
  'Action Figures':  { emoji: '🦸', c1: '#FF6B35', c2: '#E74C3C' },
  'Building Blocks': { emoji: '🧱', c1: '#3498DB', c2: '#6C3CE1' },
  'Board Games':     { emoji: '🎲', c1: '#27AE60', c2: '#16A085' },
  'Remote Control':  { emoji: '🚗', c1: '#E74C3C', c2: '#E91E8C' },
  'Educational':     { emoji: '📚', c1: '#FFD93D', c2: '#F39C12' },
  'Soft Toys':       { emoji: '🧸', c1: '#E91E8C', c2: '#6C3CE1' },
  'Outdoor & Sports':{ emoji: '⚽', c1: '#27AE60', c2: '#3498DB' },
  'Arts & Crafts':   { emoji: '🎨', c1: '#6C3CE1', c2: '#E91E8C' },
};
const FALLBACK_COLORS = [
  ['#FF6B35','#E74C3C'], ['#6C3CE1','#3498DB'], ['#27AE60','#16A085'],
  ['#F39C12','#FFD93D'], ['#E91E8C','#9B59B6'], ['#2ECC71','#27AE60'],
];

function buildDynamicUI(products) {
  const categories = [...new Set(products.map(p => p.category))];
  const brands     = [...new Set(products.map(p => p.brand).filter(Boolean))];
  const counts     = {};
  products.forEach(p => { counts[p.category] = (counts[p.category] || 0) + 1; });

  // --- Category pills ---
  const pillsContainer = document.getElementById('pillsContainer');
  pillsContainer.innerHTML = '<button class="pill active" data-category="all">All</button>' +
    categories.map(cat => `<button class="pill" data-category="${cat}">${cat}</button>`).join('');

  // --- Category cards ---
  const categoryGrid = document.getElementById('categoryGrid');
  categoryGrid.innerHTML = categories.map((cat, i) => {
    const meta = CATEGORY_META[cat] || { emoji: '🎁', c1: FALLBACK_COLORS[i % FALLBACK_COLORS.length][0], c2: FALLBACK_COLORS[i % FALLBACK_COLORS.length][1] };
    return `
      <div class="category-card" style="--card-color-1:${meta.c1};--card-color-2:${meta.c2}" data-category="${cat}">
        <div class="category-card-emoji">${meta.emoji}</div>
        <div class="category-card-name">${cat}</div>
        <div class="category-card-count">${counts[cat]} product${counts[cat] !== 1 ? 's' : ''}</div>
      </div>`;
  }).join('');

  // --- Brand checkboxes (sidebar + mobile) ---
  const brandHTML = brands.map((b, i) => `
    <div class="filter-option">
      <input type="checkbox" id="brand${i+1}" value="${b}">
      <label for="brand${i+1}">${b}</label>
    </div>`).join('');
  const brandHTMLMobile = brands.map((b, i) => `
    <div class="filter-option">
      <input type="checkbox" id="brandM${i+1}" value="${b}">
      <label for="brandM${i+1}">${b}</label>
    </div>`).join('');
  document.getElementById('brandCheckboxes').innerHTML = brandHTML;
  document.getElementById('brandCheckboxesMobile').innerHTML = brandHTMLMobile;

  // --- Footer categories ---
  document.getElementById('footerCategories').innerHTML = categories
    .map(cat => `<a href="#" onclick="selectCategory('${cat}');return false;">${cat}</a>`).join('');

  // Re-attach listeners for newly created pills, cards, brand checkboxes
  attachDynamicListeners();
}

function selectCategory(cat) {
  currentCategory = cat;
  document.querySelectorAll('.pill').forEach(p => p.classList.remove('active'));
  const pill = document.querySelector(`.pill[data-category="${cat}"]`);
  if (pill) pill.classList.add('active');
  filterProducts();
  document.getElementById('products')?.scrollIntoView({ behavior: 'smooth' });
}

function attachDynamicListeners() {
  document.querySelectorAll('.pill').forEach(pill => {
    pill.addEventListener('click', () => {
      currentCategory = pill.dataset.category;
      document.querySelectorAll('.pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      filterProducts();
      setTimeout(() => document.getElementById('products')?.scrollIntoView({ behavior: 'smooth' }), 100);
    });
  });
  document.querySelectorAll('.category-card').forEach(card => {
    card.addEventListener('click', () => {
      selectCategory(card.dataset.category);
    });
  });
  document.querySelectorAll('[id^="brand"]').forEach(cb => {
    cb.addEventListener('change', filterProducts);
  });
}

function updateCategoryCount(products) {
  const counts = {};
  products.forEach(p => { counts[p.category] = (counts[p.category] || 0) + 1; });
  document.querySelectorAll('.category-card').forEach(card => {
    const countEl = card.querySelector('.category-card-count');
    const n = counts[card.dataset.category] || 0;
    if (countEl) countEl.textContent = `${n} product${n !== 1 ? 's' : ''}`;
  });
}

function renderProducts(productsToRender = filteredProducts) {
  const grid = document.getElementById('productGrid');
  const resultCount = document.getElementById('resultCount');
  const emptyState = document.getElementById('emptyState');

  if (productsToRender.length === 0) {
    grid.style.display = 'none';
    emptyState.style.display = 'block';
    resultCount.textContent = 'No products found';
    return;
  }

  grid.style.display = 'grid';
  emptyState.style.display = 'none';
  resultCount.textContent = `Showing ${productsToRender.length} product${productsToRender.length !== 1 ? 's' : ''}`;

  grid.innerHTML = productsToRender.map((product, index) => {
    const discount = product.original_price ? Math.round(((product.original_price - product.price) / product.original_price) * 100) : 0;
    const isWishlisted = wishlist.includes(product.id);
    const isOutOfStock = !product.in_stock;
    const imageSrc = product.image_url || `https://placehold.co/280x280/${product.color}/white?text=${encodeURIComponent(product.name)}`;

    let actionsHtml = `
      <button class="btn-cart ${isOutOfStock ? 'btn-disabled' : ''}" ${isOutOfStock ? 'onclick="return false;"' : `onclick="addToCart(${product.id})"`}>${isOutOfStock ? '📦 Out of Stock' : '🛒 Add to Cart'}</button>
      <button class="btn-whatsapp ${isOutOfStock ? 'btn-disabled' : ''}" ${isOutOfStock ? 'onclick="return false;"' : `onclick="orderOnWhatsApp(${product.id})"`}>${isOutOfStock ? '📦 Out of Stock' : '💬 Order on WhatsApp'}</button>
    `;

    return `
      <div class="product-card ${isOutOfStock ? 'out-of-stock' : ''}" style="transition-delay: ${index * 0.05}s">
        ${isOutOfStock ? '<div class="out-of-stock-ribbon">OUT OF STOCK</div>' : ''}
        <div class="product-image-container">
          <img src="${imageSrc}" alt="${product.name}" class="product-image" onerror="this.src='https://placehold.co/280x280/${product.color}/white?text=${encodeURIComponent(product.category)}'">
          <div class="product-badge ${product.badge === 'NEW' ? 'new' : ''}">${product.badge || ''}</div>
          <button class="wishlist-btn ${isWishlisted ? 'active' : ''}" onclick="toggleWishlist(${product.id})">
            ${isWishlisted ? '❤️' : '🤍'}
          </button>
        </div>
        <div class="product-info">
          <div class="product-brand">${product.brand || 'Brand'}</div>
          <div class="product-name">${product.name}</div>
          <div class="product-age">👶 ${product.age_range || 'All ages'}</div>
          <div class="product-rating">
            ${product.rating ? `⭐ <span class="product-rating-value">${product.rating}</span>` : ''}
          </div>
          <div class="product-pricing">
            <div class="product-price">₹${product.price}</div>
            ${product.original_price ? `<div class="product-original-price">₹${product.original_price}</div>` : ''}
            ${discount > 0 ? `<div class="product-discount">${discount}% OFF</div>` : ''}
          </div>
          <div class="product-actions">
            ${actionsHtml}
          </div>
        </div>
      </div>
    `;
  }).join('');

  setTimeout(() => {
    document.querySelectorAll('.product-card').forEach(card => {
      card.classList.add('visible');
    });
  }, 100);
}

function filterProducts() {
  filteredProducts = allProducts.filter(product => {
    const categoryMatch = currentCategory === 'all' || product.category === currentCategory;
    const searchMatch = searchQuery === '' ||
      product.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      product.brand.toLowerCase().includes(searchQuery.toLowerCase());

    const priceRange = parseInt(document.getElementById('priceRange')?.value || 5000);
    const priceMatch = product.price <= priceRange;

    const ageCheckboxes = Array.from(document.querySelectorAll('#age1:checked, #age2:checked, #age3:checked, #age4:checked')).map(cb => cb.value);
    const ageMatch = ageCheckboxes.length === 0 || ageCheckboxes.some(range => {
      const [min, max] = range.split('-').map(Number);
      const age = product.age_range || '';
      if (age === 'All ages') return true;
      if (age.includes('+')) {
        const pMin = parseInt(age);
        return pMin <= max;
      }
      if (age.includes('-')) {
        const [pMin, pMax] = age.split('-').map(Number);
        return pMin <= max && pMax >= min;
      }
      return false;
    });

    const brandCheckboxes = Array.from(document.querySelectorAll('#brandCheckboxes input:checked, #brandCheckboxesMobile input:checked')).map(cb => cb.value);
    const brandMatch = brandCheckboxes.length === 0 || brandCheckboxes.includes(product.brand);

    return categoryMatch && searchMatch && priceMatch && ageMatch && brandMatch;
  });

  renderProducts(filteredProducts);
}

// Cart Functions
function addToCart(productId) {
  const product = allProducts.find(p => p.id === productId);
  if (!product || !product.in_stock) return;
  
  const existingItem = cart.find(item => item.id === productId);
  if (existingItem) {
    existingItem.qty++;
  } else {
    cart.push({ ...product, qty: 1 });
  }
  updateCart();
  showCartSidebar();
}

function updateCart() {
  const cartBadge = document.getElementById('cartBadge');
  const cartItems = document.getElementById('cartItems');
  const cartFooter = document.getElementById('cartFooter');
  const cartTotal = document.getElementById('cartTotal');

  const totalItems = cart.reduce((sum, item) => sum + item.qty, 0);
  cartBadge.textContent = totalItems;

  if (cart.length === 0) {
    cartFooter.style.display = 'none';
    cartItems.innerHTML = '<div class="cart-empty"><div class="cart-empty-icon">🛒</div><div>Your cart is empty</div></div>';
    return;
  }

  cartFooter.style.display = 'block';

  const total = cart.reduce((sum, item) => sum + (item.price * item.qty), 0);
  cartTotal.textContent = `₹${total}`;

  cartItems.innerHTML = cart.map(item => `
    <div class="cart-item">
      <img src="${item.image_url || `https://placehold.co/80x80/${item.color}/white?text=${encodeURIComponent(item.name.split(' ')[0])}`}" alt="${item.name}" class="cart-item-image" onerror="this.src='https://placehold.co/80x80/gray/white?text=Toy'">
      <div class="cart-item-info">
        <div class="cart-item-name">${item.name}</div>
        <div class="cart-item-brand">${item.brand}</div>
        <div class="cart-item-controls">
          <div class="qty-controls">
            <button class="qty-btn" onclick="updateQty(${item.id}, -1)">−</button>
            <span class="qty-value">${item.qty}</span>
            <button class="qty-btn" onclick="updateQty(${item.id}, 1)">+</button>
          </div>
          <div class="cart-item-price">₹${item.price * item.qty}</div>
          <div class="cart-item-remove" onclick="removeFromCart(${item.id})">🗑️</div>
        </div>
      </div>
    </div>
  `).join('');
}

function updateQty(productId, change) {
  const item = cart.find(i => i.id === productId);
  if (item) {
    item.qty += change;
    if (item.qty <= 0) {
      removeFromCart(productId);
    } else {
      updateCart();
    }
  }
}

function removeFromCart(productId) {
  cart = cart.filter(item => item.id !== productId);
  updateCart();
}

function showCartSidebar() {
  document.getElementById('cartSidebar').classList.add('active');
  document.getElementById('overlay').classList.add('active');
}

function hideCartSidebar() {
  document.getElementById('cartSidebar').classList.remove('active');
  document.getElementById('overlay').classList.remove('active');
}

function toggleWishlist(productId) {
  if (wishlist.includes(productId)) {
    wishlist = wishlist.filter(id => id !== productId);
  } else {
    wishlist.push(productId);
  }
  document.getElementById('wishlistBadge').textContent = wishlist.length;
  renderProducts(filteredProducts);
}

function orderOnWhatsApp(productId) {
  const product = allProducts.find(p => p.id === productId);
  if (!product) return;
  const message = `Hi! I want to order:\n\nProduct: ${product.name}\nBrand: ${product.brand}\nPrice: ₹${product.price}\n\nPlease confirm availability and delivery time.`;
  window.open(`https://wa.me/919818231025?text=${encodeURIComponent(message)}`, '_blank');
}

function checkoutCart() {
  let message = 'Hi! Here is my order:\n\n';
  cart.forEach((item, index) => {
    message += `${index + 1}. ${item.name} x${item.qty} = ₹${item.price * item.qty}\n`;
  });
  const total = cart.reduce((sum, item) => sum + (item.price * item.qty), 0);
  message += `\nTotal: ₹${total}\n\nPlease confirm my order. Thank you!`;
  window.open(`https://wa.me/919818231025?text=${encodeURIComponent(message)}`, '_blank');
}

function hideWishlistSidebar() {
  document.getElementById('wishlistSidebar').classList.remove('active');
  document.getElementById('overlay').classList.remove('active');
}

function showWishlistSidebar() {
  const container = document.getElementById('wishlistItems');
  if (wishlist.length === 0) {
    container.innerHTML = '<div class="cart-empty"><div class="cart-empty-icon">❤️</div><div>Your wishlist is empty</div></div>';
  } else {
    container.innerHTML = wishlist.map(id => {
      const p = allProducts.find(x => x.id === id);
      if (!p) return '';
      return `
        <div class="cart-item">
          <img src="${p.image_url || `https://placehold.co/80x80/${p.color}/white?text=${encodeURIComponent(p.name.split(' ')[0])}`}" alt="${p.name}" class="cart-item-image">
          <div class="cart-item-info">
            <div class="cart-item-name">${p.name}</div>
            <div class="cart-item-brand">${p.brand}</div>
            <div class="cart-item-controls">
              <div class="cart-item-price">₹${p.price}</div>
              <button class="btn-cart" onclick="addToCart(${p.id}); showWishlistSidebar();">Add to Cart</button>
              <div class="cart-item-remove" onclick="toggleWishlist(${p.id}); showWishlistSidebar();">🗑️</div>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }
  document.getElementById('wishlistSidebar').classList.add('active');
  document.getElementById('overlay').classList.add('active');
}

function openWhatsApp() {
  const message = 'Hi! I have a question about your toys.';
  window.open(`https://wa.me/919818231025?text=${encodeURIComponent(message)}`, '_blank');
}

function startCountdown() {
  let storedEnd = parseInt(localStorage.getItem('saleEndTime'));
  let endTime;
  if (!storedEnd || storedEnd <= Date.now()) {
    endTime = Date.now() + (24 * 60 * 60 * 1000);
    localStorage.setItem('saleEndTime', endTime.toString());
  } else {
    endTime = storedEnd;
  }

  function updateTimer() {
    const now = Date.now();
    let diff = endTime - now;
    if (diff <= 0) {
      endTime = Date.now() + (24 * 60 * 60 * 1000);
      localStorage.setItem('saleEndTime', endTime.toString());
      diff = 24 * 60 * 60 * 1000;
    }


    const hours = Math.floor(diff / (1000 * 60 * 60)).toString().padStart(2, '0');
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60)).toString().padStart(2, '0');
    const seconds = Math.floor((diff % (1000 * 60)) / 1000).toString().padStart(2, '0');

    document.getElementById('hours').textContent = hours;
    document.getElementById('minutes').textContent = minutes;
    document.getElementById('seconds').textContent = seconds;

    const timer = document.getElementById('countdownTimer');
    if (parseInt(hours) < 1) timer.classList.add('urgent');
    else timer.classList.remove('urgent');
  }

  updateTimer();
  setInterval(updateTimer, 1000);
}

function startTestimonialCarousel() {
  let currentIndex = 0;
  const cards = document.querySelectorAll('.testimonial-card');
  const dots = document.querySelectorAll('.testimonial-dot');

  function showTestimonial(index) {
    cards.forEach(card => card.classList.remove('active'));
    dots.forEach(dot => dot.classList.remove('active'));
    cards[index].classList.add('active');
    dots[index].classList.add('active');
  }

  dots.forEach((dot, index) => {
    dot.addEventListener('click', () => {
      currentIndex = index;
      showTestimonial(currentIndex);
    });
  });

  setInterval(() => {
    currentIndex = (currentIndex + 1) % cards.length;
    showTestimonial(currentIndex);
  }, 5000);
}

function setupScrollAnimations() {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
      }
    });
  }, { threshold: 0.1 });

  document.querySelectorAll('.product-card, .category-card, .why-card').forEach(el => {
    observer.observe(el);
  });
}

function setupStickyNavbar() {
  const navbar = document.getElementById('navbar');
  window.addEventListener('scroll', () => {
    if (window.pageYOffset > 80) {
      navbar.classList.add('scrolled');
    } else {
      navbar.classList.remove('scrolled');
    }
  });

// Enhanced filter sidebar scroll (mouse wheel fix)
  const sidebarInner = document.querySelector('.filter-sidebar-inner');
  if (sidebarInner) {
    sidebarInner.addEventListener('wheel', (e) => {
      e.stopPropagation();
      sidebarInner.scrollTop += e.deltaY;
      e.preventDefault();
    }, { passive: false });

    // Smooth resize handler
    let resizeTimeout;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(() => {
        sidebarInner.style.height = `calc(100vh - 160px)`;
      }, 100);
    });
  }

}

function clearAllFilters() {
  document.getElementById('priceRange').value = 5000;
  document.getElementById('priceValue').textContent = '5000';
  document.querySelectorAll('[id^="age"]:checked').forEach(cb => cb.checked = false);
  document.querySelectorAll('#brandCheckboxes input:checked, #brandCheckboxesMobile input:checked').forEach(cb => cb.checked = false);
  currentCategory = 'all';
  document.querySelector('.pill[data-category="all"]').classList.add('active');
  document.querySelectorAll('.pill[data-category]:not([data-category="all"])').forEach(p => p.classList.remove('active'));
  searchQuery = '';
  document.getElementById('searchInput').value = '';
  filterProducts();
}

function applyFilters() {
  closeFilterSheet();
  filterProducts();
}

function closeFilterSheet() {
  document.getElementById('filterBottomSheet').classList.remove('active');
  document.getElementById('overlay').classList.remove('active');
}

function init() {
  loadProducts().then(() => {
    setupEventListeners();
    startCountdown();
    startTestimonialCarousel();
    setupScrollAnimations();
    setupStickyNavbar();
  });
}

function setupEventListeners() {
  // Search
  const searchInput = document.getElementById('searchInput');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      searchQuery = e.target.value;
      filterProducts();
    });
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && searchQuery.trim()) {
        document.getElementById('products').scrollIntoView({ behavior: 'smooth' });
      }
    });
  }

  // Cart/Wishlist icons
  document.getElementById('cartIcon').addEventListener('click', showCartSidebar);
  document.getElementById('wishlistIcon').addEventListener('click', showWishlistSidebar);
  document.getElementById('cartClose').addEventListener('click', hideCartSidebar);

  // Overlay
  document.getElementById('overlay').addEventListener('click', () => {
    hideCartSidebar();
    closeFilterSheet();
    document.getElementById('mobileMenu')?.classList.remove('active');
  });

  // Category pills & cards are handled by attachDynamicListeners() after buildDynamicUI()

  // Filters
  const priceRange = document.getElementById('priceRange');
  const priceRangeMobile = document.getElementById('priceRangeMobile');
  const priceValue = document.getElementById('priceValue');
  const priceValueMobile = document.getElementById('priceValueMobile');
  
  if (priceRange) {
    priceRange.addEventListener('input', (e) => {
      priceValue.textContent = e.target.value;
      filterProducts();
    });
  }
  if (priceRangeMobile) {
    priceRangeMobile.addEventListener('input', (e) => {
      priceValueMobile.textContent = e.target.value;
      if (priceRange) priceRange.value = e.target.value;
      filterProducts();
    });
  }

  // Brand checkboxes handled by attachDynamicListeners()

  // Age checkboxes (static)
  document.querySelectorAll('[id^="age"]').forEach(cb => cb.addEventListener('change', filterProducts));

  // Mobile filter
  document.getElementById('mobileFilterBtn')?.addEventListener('click', () => {
    document.getElementById('filterBottomSheet').classList.add('active');
    document.getElementById('overlay').classList.add('active');
  });

  // Hamburger
  document.getElementById('hamburger')?.addEventListener('click', () => {
    document.getElementById('mobileMenu').classList.add('active');
    document.getElementById('overlay').classList.add('active');
  });

  document.getElementById('mobileMenuClose')?.addEventListener('click', () => {
    document.getElementById('mobileMenu').classList.remove('active');
    document.getElementById('overlay').classList.remove('active');
  });

  // Clear filters
  document.querySelector('.clear-filters')?.addEventListener('click', clearAllFilters);
}

// Initialize when DOM loaded
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
