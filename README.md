# Shala Darpan School Analytics — Standalone

GOVT. SENIOR SECONDARY SCHOOL HODA, MANDALGARH (222681) · UDISE 08241132502

Standalone Build 2026-11-24-V2 (mobile corrections applied)

Ye package Muse par chalne wali Shala Darpan School Analytics site ki apni
hosting par chalane wali copy hai — waisa hi UI/UX, waisa hi theme, aur
school ka asal data seed ke roop me saath me.

## Chalane ke liye

```bash
npm install
npm start
# http://localhost:3000
```

## Pehla Admin login

- Agar `ADMIN_PASSWORD` environment variable set hai, to wahi Admin password hai.
- Warna pehle boot par ek one-time password banta hai jo
  `data/OWNER-SETUP.txt` me likha jata hai (password badalte hi file delete ho jati hai).
- Login ID: `admin@hoda.school`
- Parent login: `HODA + SRNO`, temporary password = bachche ki DOB (DDMMYYYY).

## Poori jankari

**DEPLOYMENT-GUIDE-HI.md** dekhein — local chalana, Render, Railway aur
Vercel + Neon par deploy karne ke saare steps Hindi me wahi diye hain.
