# HOW TO SEE THE CHANGES

## 1. Stop the current dev server
Press `Ctrl+C` in the terminal where it's running

## 2. Pull latest code
```bash
cd schoolflow-connect
git pull origin main
```

## 3. Restart dev server
```bash
npm run dev
```

## 4. Hard refresh browser
- Windows/Linux: `Ctrl + Shift + R`
- Mac: `Cmd + Shift + R`

## What you should now see:

### Teachers page (`/principal/teachers`)
- **NEW**: Full table with 8 columns
- **NEW**: Search by name or subject
- **NEW**: Click any row → teacher detail with 3 tabs

### Students page (`/principal/students`)
- **NEW**: Single table with 9 columns (not "By Exam/By Attendance" tabs)
- **NEW**: Each student clickable → detail page with 3 tabs
- **NEW**: Red flags on low attendance/homework/marks

### Classes page (`/principal/classes`)
- **NEW**: Cards showing class names (not individual sections)
- **NEW**: Click class → section comparison table
- **NEW**: Click section → full section detail

### Dashboard
- "Good morning" greeting removed
- Header shows just date and school name

---

If you STILL see the old pages after this, send me the browser console errors.
