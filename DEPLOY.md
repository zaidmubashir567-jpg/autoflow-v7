# AutoFlow v7 — Deployment Guide

## ✅ Already Done
- [x] Supabase project: `ndwvsrtyjnaddrifafqk`
- [x] All 14 database tables + RLS created
- [x] All 8 Edge Functions deployed (ACTIVE)
- [x] Admin account: `zaidmubashir567@gmail.com` / `AutoFlow2024!`
- [x] Supabase anon key baked into `shared/auth.js`

---

## 🚀 Step 1 — Push to GitHub (5 min)

1. Go to https://github.com/new
2. Create repo named **autoflow-v7** (Private, no README)
3. Open **PowerShell** in this folder and run:

```bash
git init
git config user.email "zaidmubashir567@gmail.com"
git config user.name "Zaid Mubashir"
git branch -M main
git add -A
git commit -m "AutoFlow v7 — initial deploy"
git remote add origin https://github.com/YOUR_USERNAME/autoflow-v7.git
git push -u origin main
```

---

## 🚀 Step 2 — Deploy to Vercel (5 min)

### Option A — Vercel Dashboard (Easiest)
1. Go to https://vercel.com/new
2. Import your `autoflow-v7` GitHub repo
3. Framework Preset: **Other**
4. Root Directory: leave blank
5. Click **Deploy**

### Option B — Vercel CLI
```bash
npm install -g vercel
vercel --yes --name autoflow-v7
```

---

## 🔑 Step 3 — Add Claude API Key to Edge Functions (2 min)

Go to: https://supabase.com/dashboard/project/ndwvsrtyjnaddrifafqk/settings/functions

Add secret:
| Key | Value |
|-----|-------|
| `ANTHROPIC_API_KEY` | Your Claude API key (sk-ant-...) |

> `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are auto-injected — no action needed.

---

## 🗺️ Step 4 — Enable Google Places API

1. Go to https://console.cloud.google.com/apis/library/places-backend.googleapis.com
2. Click **Enable** (requires billing on Google Cloud project)

---

## 📋 Credentials Summary

| Item | Value |
|------|-------|
| Supabase URL | `https://ndwvsrtyjnaddrifafqk.supabase.co` |
| Admin Email | `zaidmubashir567@gmail.com` |
| Admin Password | `AutoFlow2024!` |
| Admin Panel | `https://autoflow-v7.vercel.app/admin/dashboard.html` |
| Client Portal | `https://autoflow-v7.vercel.app/client/dashboard.html` |

---

## ⚡ Quick Deploy (Windows)
Double-click **DEPLOY_NOW.bat** — it handles git + Vercel automatically.
