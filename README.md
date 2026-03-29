# ToyLand 🧸

A toy shop built with HTML, CSS and JavaScript. Products are managed via Google Sheets and orders are placed through WhatsApp.

## Features
- Dynamic product catalogue from Google Sheets
- Filter by category, brand, price and age range
- Cart and wishlist
- WhatsApp ordering and checkout
- Admin panel to manage products and stock
- Image uploads via Cloudinary
- Fully responsive

## Tech Stack
- Frontend: HTML, CSS, JavaScript
- Backend: Netlify Functions (serverless)
- Database: Google Sheets
- Image hosting: Cloudinary
- Deployment: Netlify

## Setup
1. Clone the repo
2. Set environment variables in Netlify (see below)
3. Deploy to Netlify — done

## Environment Variables
Set these in Netlify → Site settings → Environment variables:
```
SHEET_ID
APPS_SCRIPT_URL
APPS_SCRIPT_SECRET
CLOUDINARY_CLOUD_NAME
CLOUDINARY_UPLOAD_PRESET
ADMIN_USERNAME
ADMIN_PASSWORD
```

## File Structure
```
├── index.html                  # Main shop
├── admin.html                  # Admin panel
├── assets/
│   ├── main.js
│   └── style.css
├── netlify/
│   └── functions/
│       ├── auth.js
│       ├── sheet.js
│       ├── admin-action.js
│       └── cloudinary.js
├── netlify.toml
├── google-apps-script.js
└── sample-data.csv
```
