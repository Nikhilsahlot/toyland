# ToyLand Admin Panel & Dynamic Products 🚀

## 🎯 Features Added
✅ **Dynamic Products** from Google Sheets  
✅ **Skeleton Loading** & error states  
✅ **Out-of-Stock** handling with UI  
✅ **Admin Panel** (`admin.html`) - Login, Products, Add Product, Stats  
✅ **Netlify Functions** - Serverless auth  
✅ **Cloudinary** image upload support  
✅ **Responsive Design** maintained  

## 🚀 Quick Start

### 1. **Google Sheets Setup** 📊
```
1. Create new Google Sheet
2. Tab name: "Sheet1" (default)
3. Row 1 Headers: `id,name,category,price,original_price,image_url,description,age_range,brand,in_stock`
4. Import `sample-data.csv` (24 demo products)
5. Copy SHEET_ID from URL: `https://docs.google.com/spreadsheets/d/[SHEET_ID]/edit`
6. Share → Anyone with link can VIEW
```

### 2. **Google Apps Script** 🔧
```
1. Sheets → Extensions → Apps Script
2. Delete default code
3. Paste `google-apps-script.js` content
4. Project Settings → Script Properties → SECRET_KEY = "your-secret-key"
5. Deploy → New Deployment → Web app
   • Execute as: Me (your-email)
   • Who has access: Anyone
6. Copy Web App URL → APPS_SCRIPT_URL
```

### 3. **Cloudinary** ☁️ (Optional)
```
1. cloudinary.com → Sign up FREE
2. Dashboard → Copy Cloud name
3. Settings → Upload → Upload presets → Add preset
   • Mode: Unsigned
   • Copy preset name
4. Replace YOUR_CLOUD_NAME_HERE, YOUR_UPLOAD_PRESET_HERE
```

### 4. **Netlify Deploy** 🌐
```
1. Connect GitHub repo OR drag folder to netlify.com/drop
2. Site settings → Environment variables:
   ```
   ADMIN_USERNAME=your-admin
   ADMIN_PASSWORD=your-password-strong
   ```
3. Auto-deploy complete! ✨
```

### 5. **Update Constants** (index.html + admin.html)
```
const SHEET_ID = '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms'; // ← YOUR SHEET ID
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/.../exec'; // ← Apps Script URL
const CLOUDINARY_CLOUD_NAME = 'dabc123';
const CLOUDINARY_UPLOAD_PRESET = 'unsigned-preset';
```

## 🧪 Test Checklist
```
✅ Shop loads from Sheets (skeleton → products)
✅ Out-of-stock shows grey/ribbon/disabled  
✅ Admin login: your-admin/your-password
✅ Toggle stock status → updates sheet instantly
✅ Add product → Cloudinary upload → appears in shop
✅ Stats dashboard shows correct counts
✅ Netlify deploy: toys-land.netlify.app/admin
```

## 📱 Demo Admin Login
```
Username: admin
Password: admin123
(Change in Netlify env vars for production)
```

## 🔗 Admin URLs
```
Shop: https://your-site.netlify.app/
Admin: https://your-site.netlify.app/admin.html
Auth API: /.netlify/functions/auth
```

## 🛠 File Structure
```
├── index.html              # Main shop (dynamic)
├── admin.html             # Admin panel
├── assets/
│   ├── style.css         # Shared styles
│   └── main.js           # Shop logic
├── netlify/
│   ├── functions/
│   │   └── auth.js       # Login API
│   └── toml              # Config
├── sample-data.csv       # Import to Sheets
├── google-apps-script.js # Deploy to Apps Script
└── README.md            # 📖 This file
```

## 💡 Pro Tips
• **Sheets updates** → Shop auto-refreshes (no deploy!)
• **Cloudinary free** handles unlimited uploads
• **Netlify free** → 125k function calls/month
• **Admin demo** works instantly (change password in env)
• **CSV import** → Perfect demo data ready

## 🎨 Design System
```
Colors: Orange #FF6B35 | Purple #6C3CE1 | Yellow #FFD93D
Font: Nunito (Google Fonts)
Stock: ✅ Green | ❌ Red ribbon + disabled
Skeleton: Shimmer animation while loading
```

**Ready to deploy! 🚀 Push to GitHub → Netlify auto-builds**

---
*Made with ❤️ by BLACKBOXAI*

