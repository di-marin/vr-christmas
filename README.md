# VR & AR Christmas Dinner 🎄

A small page for the group's Christmas dinner: a date poll, a potluck list and secret santa.

- **Website**: `index.html`, `style.css`, `app.js`, `config.js`. Static files, hosted on GitHub Pages.
- **Backend**: `backend/Code.gs`, a Google Apps Script attached to a Google Sheet that stores everything.

Open `index.html` locally to try it. While `config.js` has no URL, the page runs in **demo mode**: data stays in your browser and comes with sample entries. The demo admin code is `elf`.

---

## 1. Set up the backend (≈10 min)

> Use a **personal Google account**. University Workspace accounts often block "Anyone" web apps.

1. Create a new Google Sheet, e.g. "VR Christmas 2026".
2. **Extensions → Apps Script**. Delete the sample code and paste in all of `backend/Code.gs`. Save.
3. In the function dropdown at the top, pick **`setup`** and click **Run**. Allow the permissions it asks for.
   Under *Advanced → Go to … (unsafe)* you'll see a warning. That's normal for your own script.
4. Open **Execution log**. It shows your **admin code** (e.g. `elf-4821`). Keep it.
   You can change it under ⚙️ *Project Settings → Script Properties → `ADMIN_CODE`*.
5. **Deploy → New deployment** → type **Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
   → **Deploy** and copy the **Web app URL** (`https://script.google.com/macros/s/…/exec`).
6. Paste that URL into `config.js` as `apiUrl`.

The Sheet now has tabs `config`, `dates`, `votes`, `food` and `santa`. You can edit them by hand:
- **config**: `location`, `budget`, `giftNote` and `santaDeadline` show up on the page right away.
- **dates**: add or remove candidate dates (format `2026-12-11`, time `18:00`).

> If you edit `Code.gs` later: *Deploy → Manage deployments → ✏️ → Version: New version → Deploy*.
> The URL stays the same.

## 2. Publish on GitHub Pages

Create a repo called **`vr-christmas`** under the `di-marin` account. GitHub serves it at
**https://di-marin.github.io/vr-christmas/**.

```bash
git init
git add .
git commit -m "Christmas dinner page"
git branch -M main
git remote add origin https://github.com/di-marin/vr-christmas.git
git push -u origin main
```

Then go to repo **Settings → Pages → Source: Deploy from a branch → `main` / root**. It's live after about a minute.

(Alternative: put these files in a `vr-christmas/` folder inside the `di-marin.github.io` repo. That gives the same URL.)

## 3. Organiser corner

Open **https://di-marin.github.io/vr-christmas/?admin** and enter the admin code. From there you can:
- **Set the final date**. It then shows at the top with a countdown.
- **Run the secret santa draw**. Everyone gets the next person in a shuffled circle, so nobody draws themselves.
  The pairs are kept in Script Properties, not in the Sheet, so you won't spoil it for yourself by accident.
- **Undo the draw** if someone joins late, then draw again.

After the draw, everyone opens the page, enters their name and PIN, and sees only their own person and that person's wishlist.

## Good to know
- People are identified by the name they type. It's remembered on their device and isn't case-sensitive.
  It's a trust-based friend-group tool, not a login system.
- PINs are stored hashed. Still, tell people not to reuse a real password.
- Forgotten PIN? In the organiser corner, use **Reset PIN**: type their name and a new PIN, then tell them the new PIN.
  This works before and after the draw and doesn't change who has whom.
