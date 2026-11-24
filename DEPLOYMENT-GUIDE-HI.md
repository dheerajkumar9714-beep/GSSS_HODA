# Shala Darpan School Analytics — Deployment Guide (Hindi)

**Standalone Build 2026-11-24-V2 (mobile corrections applied)**
School: GOVT. SENIOR SECONDARY SCHOOL HODA, MANDALGARH (222681) · UDISE 08241132502

Ye guide do packages ke liye hai:

| Package | Kab use karein |
|---|---|
| `shala-darpan-standalone-v1.zip` | Apne computer (VS Code) par chalane ke liye, ya Render / Railway par deploy karne ke liye |
| `shala-darpan-vercel-v1.zip` | Vercel par deploy karne ke liye (data Neon Postgres database me rehta hai) |

Dono me site ek hi hai — waisa hi design, waisa hi theme, waisa hi data.
Farak sirf data rakhne ki jagah ka hai:

- **Standalone (file mode):** data `data/db.json` file me rehta hai.
- **Vercel / DATABASE_URL mode:** data Postgres database (Neon) me rehta hai.
  Vercel par file-storage nahi chalta, isliye wahan database lazmi hai.

---

## 1. Package me kya-kya hai

- `server.js` / `app.js` — poori site (server + saare pages)
- `store.js` — data rakhne wala hissa (file ya Postgres)
- `public/index.html` — site ka front-end (live site wala hi theme)
- `data/seed.json` — school ka asal data (pehli baar chalne par yahi load hota hai)
- `README.md` aur ye guide

### Saath aaya hua data (24-11-2026 ko live site se liya gaya)

| Data | Sankhya |
|---|---|
| Students (Active) | 254 (Boys 133 · Girls 121) |
| Removed register (TC / NSO) | 47 (TC 29 · NSO 18) |
| Teachers | 19 |
| Parent accounts | 206 (Login = HODA+SRNO, password = bachche ki DOB DDMMYYYY) |
| PEN wale students | 246 (8 students ka PEN Shala Darpan me hi khaali hai — Classes 1–7) |
| Exams | 5 (saare abhi Published) |
| Bhare hue marks | 297 |
| Board exams | 3 (Class 5, 10, 12) · Board entries 46 |
| Enrolments (session-wise) | 887 (neeche "farak" wala hissa dekhein) |
| Documents ke records | 7 report-card PDF records + 1 admit card record (sirf record — asal PDF file ke liye "farak" dekhein) |
| Home Page ka content | Live site par jo set hai, waisa ka waisa |

---

## 2. Pehla login — sabse zaroori

**Admin password Muse wali site se transfer NAHI hua hai** (aapke badle hue
password suraksha ke liye kabhi record hi nahi kiye gaye). Is package me
Admin login is prakar hoga:

- **Login ID:** `admin@hoda.school`
- **Password:**
  - Agar aapne `ADMIN_PASSWORD` environment variable set kiya hai → wahi password.
  - Warna pehli baar site chalne par ek **one-time password** banta hai jo
    `data/OWNER-SETUP.txt` file me likha milta hai.
- Pehle login ke baad **My Account** tab se password badal dein —
  password badalte hi `OWNER-SETUP.txt` file apne aap delete ho jati hai.

**Teacher logins:** `teacher@hoda.school` aur `santosh.agarwal@hoda.school`
accounts maujood hain, lekin unke password set nahi hain. Admin login karke
**Accounts** tab se har teacher ka password set karke unhe dein.

**Parent logins:** pehle jaise hi — Login ID `HODA + SRNO`
(jaise `HODA1448`), temporary password = bachche ki **DOB DDMMYYYY me**
(jaise 27-11-2012 → `27112012`). Parent ko sirf apne bachche dikhte hain.

---

## 3. Apne computer par chalana (VS Code)

1. Zip ko kisi folder me kholein (extract karein).
2. VS Code me wahi folder kholein.
3. Terminal kholein (Terminal → New Terminal) aur chalayein:

```bash
npm install
npm start
```

4. Browser me kholein: **http://localhost:3000**
5. Pehla Admin login upar wale hisse (Section 2) ke hisaab se karein —
   one-time password `data/OWNER-SETUP.txt` me milega.

Site band karne ke liye terminal me `Ctrl + C` dabayein.

> **Dhyaan dein:** jab bhi naya package/version lagayein, pehle apne purane
> folder ke **`data/` folder ka backup** lein (copy karke kahin aur rakh dein).
> Aapka saara badla hua data `data/db.json` me hi hota hai. Naye version me
> purana `data/db.json` wapas rakhne se aapka data waisa ka waisa aa jayega.

---

## 4. Render par deploy karna (step-by-step)

Render par do tareeke hain. **Pehla tareeka (Neon database ke saath) sabse
surakshit hai**, kyunki Render ki free disk par data reset ho sakta hai.

### Tareeka A — Render + Neon database (salah di jati hai)

1. Pehle Section 6 ke steps se **Neon database** bana lein aur
   `DATABASE_URL` (connection string) copy kar lein.
2. Standalone zip ki files ko ek **GitHub repository** me daalein
   (github.com → New repository → files upload karein).
3. render.com par account banayein → **New → Web Service** → apna GitHub
   repository chunein.
4. Settings is prakar rakhein:
   - **Runtime:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
5. **Environment Variables** me ye jodein:
   - `DATABASE_URL` = Neon wali connection string
   - `ADMIN_PASSWORD` = apna chuna hua majboot Admin password
6. **Create Web Service** dabayein. 2–5 minute me site live ho jayegi —
   Render ek `https://...onrender.com` wala address dega.
7. Us address par jaakar Admin login karke test karein (Section 7 ki list).

> Free plan par site kuch der khaali rehne par "so" jati hai — pehla page
> khulne me 30–50 second lag sakte hain. Ye Render free plan ka niyam hai.

### Tareeka B — Render par sirf file mode (bina database)

Upar wale hi steps, lekin `DATABASE_URL` na dein. Iske liye Render me
**Persistent Disk** jodna padega aur use `data` folder ki jagah par mount
karna hoga, warna har deploy/restart par data **seed par wapas** chala
jayega. Isi liye Tareeka A behtar hai.

### Railway (dusra vikalp)

railway.app par New Project → GitHub repo chunein → Variables me
`DATABASE_URL` aur `ADMIN_PASSWORD` dein → deploy apne aap ho jata hai.
Baaki sab Render jaisa hi hai.

---

## 5. Custom domain jodna + HTTPS

1. Domain khareedin (jaise kisi registrar se `hoda-school.in`).
2. **Vercel par:** Project → Settings → Domains → apna domain jodein →
   Vercel jo DNS record (A / CNAME) bataye, wo domain wale panel me daalein.
3. **Render par:** Web Service → Settings → Custom Domain → domain jodein →
   Render jo CNAME bataye wo DNS me daalein.
4. HTTPS (browser me taala wala nishan) dono jagah **apne aap free** me lag
   jata hai — kuch der (kabhi kabhi kuch ghante) lag sakte hain.

---

## 6. Vercel par deploy karna (step-by-step)

Iske liye `shala-darpan-vercel-v1.zip` wala package chahiye.
Vercel par site ki files rehti hain, lekin **saara data Neon database me**
rehta hai — isliye deploy dobara karne ya site restart hone par data kabhi
nahi khota.

### Step 1 — Neon database banana (free)

1. **neon.tech** par jayein → Sign up (Google/GitHub se ho jata hai) — free plan.
2. **Create project** dabayein → project ka naam dein (jaise `shala-darpan`)
   → **Create**.
3. Project khulte hi **Connection string** dikhegi — kuch is prakar ki:
   `postgresql://user:password@ep-....aws.neon.tech/dbname?sslmode=require`
4. Use copy karke surakshit rakh lein — yahi aapka `DATABASE_URL` hai.
   **Ise kisi ke saath share na karein** (isme database ka password hota hai).

### Step 2 — GitHub repository banana

1. github.com par account banayein (agar pehle se hai to wahi).
2. **New repository** → naam dein (jaise `shala-darpan`) → **Create repository**.
3. `shala-darpan-vercel-v1.zip` ko kholein (extract karein) aur uske **andar
   ki saari files** repository me upload karein
   (repository page par "uploading an existing file" wala link milta hai).
   Dhyaan dein: zip ke andar wali files seedha repository ki jad (root) me
   honi chahiye — ek aur folder ke andar nahi.

### Step 3 — Vercel me import karna

1. **vercel.com** par jayein → Sign up/Login (GitHub se karein to asaan rahega).
2. **Add New → Project** → apna GitHub repository **Import** karein.
3. Framework puche to **Other** rehne dein — package me `vercel.json` pehle
   se bana hai, koi aur setting badalne ki zarurat nahi.

### Step 4 — Environment Variables dena (sabse zaroori kadam)

Import wale page par hi **Environment Variables** wale hisse me ye dein:

| Naam (bilkul aisa hi likhein) | Value |
|---|---|
| `DATABASE_URL` | Step 1 me copy ki gayi Neon connection string |
| `ADMIN_PASSWORD` | Apna chuna hua majboot Admin password (kam se kam 10–12 characters) |

> `DATABASE_URL` ke bina site Vercel par chalegi hi nahi (wahan data rakhne
> ki koi sthayi jagah nahi hoti). `ADMIN_PASSWORD` na dein to pehla Admin
> login nahi ban payega — isliye ye dono lazmi dein.

### Step 5 — Deploy aur pehla test

1. **Deploy** dabayein. 1–3 minute me site live ho jayegi —
   `https://...vercel.app` wala address milega.
2. Pehli baar khulne par data apne aap Neon database me load ho jata hai
   (seed apne aap chal jata hai — aapko kuch karna nahi hai).
3. Admin login karein: `admin@hoda.school` + jo `ADMIN_PASSWORD` aapne diya tha.
4. Section 7 wali test list se sab check karein.
5. Chahein to Section 5 ke hisaab se apna domain jod dein.

> **Data kahan rehta hai, yaad rakhein:** Vercel sirf site chalata hai,
> data hamesha **Neon** me rehta hai. Deploy dobara karne, site band karke
> dobara chalane, ya naya version lagane par bhi data waisa ka waisa rahega.
> Data ka backup = Neon ka backup (neeche Section 7).

---

## 7. Deploy ke baad ki test list

Har deploy ke baad ye check zaroor karein:

- [ ] Home page khul raha hai, school ka naam/design live site jaisa hai
- [ ] Admin login ho raha hai (`admin@hoda.school`)
- [ ] Dashboard par **254 students** dikh rahe hain
- [ ] Ek parent login (jaise `HODA1448`, password = bachche ki DOB) se sirf
      usi ka bachcha dikh raha hai
- [ ] Results me koi published exam parent ko dikh raha hai
- [ ] Admin password My Account se badal diya hai (agar ADMIN_PASSWORD env
      nahi diya tha to lazmi)

---

## 8. Backup lena aur wapas lana (restore)

**File mode (local / Render Tareeka B):**

- Backup = `data/db.json` file ki copy kisi surakshit jagah rakhna.
  Behtar hai poora `data/` folder hi copy kar lein.
- Restore = site band karke purani `db.json` ko `data/db.json` ki jagah
  rakh dein aur site dobara chalayein.

**Database mode (Vercel / Render Tareeka A):**

- Data Neon me hai. Neon ke panel me **Backups / Restore** ka option hota
  hai (free plan me seemit samay ki history rehti hai).
- Ek aur asaan tareeka: Admin login karke Students aur PEN ke **Export CSV**
  samay-samay par download karke rakh lein — zaroorat padne par Import se
  wapas bhare ja sakte hain.

> **Niyam bana lein:** koi bhi bada badlav (naya session, bulk import,
> bahut saare students hatana) karne se pehle backup zaroor lein.

---

## 9. Muse wali site se farak — saaf-saaf

Ye package live site ki lagbhag poori copy hai, lekin kuch cheezein
standalone me **nahi** hain ya alag hain. Ye jaankari chhupayi nahi gayi hai:

1. **Scanned PDF ka OCR nahi hai.** Muse version me scanned/image PDF se
   marks padhe jate the. Standalone me Shala Darpan ki **CSV/XLSX sheet**
   se result update bilkul chalta hai (Layout A aur B dono), lekin scanned
   PDF ke marks auto-read nahi honge.
2. **Merged admit-card PDF ka auto-split nahi hai.** Muse version me ek
   merged PDF se cards apne aap alag hote the. Standalone me admit card
   **ek-ek student** ki upload hoti hai (Admit Card tab se).
3. **Import Centre saral hai.** Muse wala Universal Import Centre (PDF
   import, OCR review, mapping templates) standalone me nahi hai — yahan
   Students / PEN / Attendance ka **CSV import** hai.
4. **PDF files saath nahi aayi hain.** Documents ke records (7 report-card
   PDF + Aarti Kumari Regar ki admit card ka record) package me hain,
   lekin unki asal PDF files Muse ke andar hi reh gayi hain — site par
   unke saamne "file standalone me nahi" dikhega. Zaroorat ho to Admin
   wohi PDF dobara upload kar sakta hai.
5. **Enrolments 887 aaye hain, 946 nahi.** Live site ke enrolments me Admin
   ki haath se ki hui kuch corrections thi jo bahar nahi nikli; standalone
   me enrolments admission date (DOA) se dobara bane hain (har session me
   class ek-ek karke). Isse purane sessions ke class ke aankde kahin-kahin
   thode alag ho sakte hain. Current session (2026-27) ke 254 students
   bilkul sahi hain.
6. **Marks ki ginati ka farak:** package me **297 asal bhare hue marks**
   hain. Live site ka counter 371 dikhata tha, kyunki usme khaali (blank)
   mark-rows bhi gine jate the — results aur percentages par iska koi
   farak nahi padta.
7. **Purani daily attendance ke records nahi aaye** (live me 1 din ke 71
   entries thi). Har student ke saath aayi hui **attendance summary**
   (132 working days wale aankde) bilkul saath hai, aur nayi attendance
   standalone me roz bhari ja sakti hai.
8. **Teacher passwords set karne honge** — Section 2 dekhein.
9. **Hero photo ki jagah drawing hai.** Home page ke hero hisse ki asal
   photo (`hero-school.webp`) Muse se bahar nahi nikli, isliye usi
   rang-roop (gehra hara + sunehra) me bani school ki drawing lagayi hai.
   Baaki poora theme — rang, fonts, cards, buttons, tabs, home page ke
   sections ka kram — live site jaisa hi rakha gaya hai, dark mode ke saath.
10. **Login session:** server restart hone par sabko dobara login karna
    pad sakta hai (session server ki memory me rehte hain). Data par iska
    koi asar nahi padta.

---

## 10. Madad

Koi kadam atke to screenshot ke saath batayein — khaas taur par pehle
Vercel deploy par, jahan hum saath me test karenge ki Neon database se
data sahi load hua ya nahi.

*Standalone Build 2026-11-24-V2 (mobile corrections applied)*
