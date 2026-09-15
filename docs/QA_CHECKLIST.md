# Manual QA Checklist

Manual QA checklist for the CCMMS frontend, covering every user-facing flow end to end. Check things off as you go; anything that doesn't match "Expected" is a real bug to report back.

**Before you start:**
- Backend running: `npm run dev` from repo root (all 5 services should log "listening on port ...").
- Frontend running: `cd frontend && npm run dev`, open `http://localhost:5173`.
- Credentials for all seeded accounts (1 Super Admin, 3 Club Admins — Music/Game/Dance, 3 Students) are in the root `.env` file comments — not repeated here.
- If anything hangs for more than ~10 seconds with no response (especially catalog or login), it's likely a transient cloud DB connectivity blip we've hit before, not a real bug — stop the backend and run `npm run dev` again before assuming something's broken.

---

## 1. Registration & Login

- [x] **Register with a non-IIIT email** (e.g. `test@gmail.com`) → inline warning appears as you type ("Must be an @students.iiit.ac.in email"); submitting anyway shows the backend's `403` error ("Registration is restricted only to iiit students").
- [x] **Register with a valid `@students.iiit.ac.in` email** → success message + "Go to login" link.
- [x] **Register with an email that already exists** → error shown inline (`409`, "email already exists").
- [x] **Log in with the new account** → redirected to `/catalog`, Navbar shows Catalog/Profile/Orders/Notifications/Logout (no admin links — this is a plain `STUDENT`).
- [x] **Log in with wrong password** → "invalid credentials" shown inline, no redirect.
- [x] **Log in as a seeded Club Admin** → Navbar additionally shows Create Item / Delivery Slots / Club Orders.
- [x] **Log in as the seeded Super Admin** → Navbar additionally shows Promote User / Create Club too.
- [x] **Refresh the page while logged in** → stays logged in (no bounce to `/login`). This confirms `AuthContext` correctly rehydrates from `localStorage`.
- [x] **Click Logout** → redirected to `/login`, Navbar reverts to Login/Register only.
- [x] **After logout, type `/catalog`, `/orders`, `/profile`, etc. directly into the address bar** → every one bounces to `/login` (confirms `ProtectedRoute` is enforcing the wall, including on a hard page load, not just client-side navigation).

## 2. Catalog Browsing

- [x] Visit `/catalog` logged in as any role → table of items (name, type, club, price, stock) appears.
- [x] Change the **type** filter (APPAREL/MUG/ACCESSORY) → list narrows correctly.
- [x] Change the **club** filter → list narrows correctly.
- [x] Combine both filters → still correct.
- [x] Click an item's name → navigates to `/catalog/:id`.
- [x] (Only meaningful once there are 11+ items in an unfiltered view) "Load More" button appears and appends more rows without losing the ones already shown.

## 3. Item Detail & Checkout — the core flow

For each of these, watch the **Stock** number on the page as well as the outcome message.

- [x] **Open an APPAREL item where your saved preferred size is available** → that size is pre-selected as a radio button.
- [x] **Open an APPAREL item where your preferred size is NOT offered** (or you have no preferred size saved yet) → a warning banner appears and no size is pre-selected; you must pick one manually before submitting.
- [x] **Try to submit without picking a size** (when sizes are required) → inline "Please select a size" message, no request sent.
- [x] **Checkout with mock card `4242`** → "Order placed successfully!" message + link to `/orders`; **stock count on the page decreases immediately** (this was a bug we fixed — confirm it updates without needing a manual refresh).
- [x] **Checkout with mock card `4000` (or leave it blank)** → "Payment failed..." message; **stock count is unchanged** (the saga rollback should restore it — confirmed in backend testing, now confirm it visually too).
- [x] **Checkout an item with 0 stock** (currently: Dance Club Mug) → "This item is out of stock" message.
- [x] **Leave an item detail page open and idle for 10+ seconds** after someone else (or you, in another tab) changes its stock → the number updates on its own (polling), no manual refresh needed.
- [x] **(Optional, harder to trigger) Lock contention retry:** open the same item in two browser tabs (or as two different students), click "Place Order" in both within the same second → one should succeed, the other should briefly show "Retrying... (attempt X of 3)" before resolving.

## 4. Profile Page (`/profile`)

- [x] Visit `/profile` → shows your current full name, phone, hostel block, preferred size (blank fields show as empty, not an error).
- [x] Change your **preferred size** to something an existing item does NOT offer, and Save → confirmation message shown.
- [x] Go back to that item's detail page → confirms the out-of-stock-fallback warning now appears (proves the size actually saved and is being read correctly elsewhere).
- [x] Update full name / phone / hostel block, leaving other fields blank → only the filled-in fields should change (partial update).

## 5. Orders Page (`/orders`)

- [x] After placing at least one successful order, visit `/orders` → it appears in the table with the correct size, quantity, status (`COMMITTED`), and timestamp.
- [x] Click "View item" on a row → navigates to that item's `/catalog/:id` detail page.
- [x] If you have zero orders (a fresh account), the page should say "You haven't placed any orders yet." — not a blank page or an error.

## 6. Notifications Page (`/notifications`)

- [x] After placing an order, wait a few seconds, then visit `/notifications` → an `ORDER_PLACED` notification appears, visually distinguished (highlighted) as unread.
- [x] Click "Mark read" → it un-highlights immediately, without a full page reload.
- [x] Leave the page open and wait ~15 seconds after triggering a new notification elsewhere (e.g. a Club Admin sets a delivery slot on something you ordered) → the new notification appears on its own.
- [x] Zero notifications → "No notifications yet." message, not blank/broken.

## 7. Club Admin Pages (log in as a seeded Club Admin, e.g. Music Club)

- [x] Visit `/admin/create-item` → no club dropdown shown (it's implicit), just "Managing: Music Club" text.
- [x] Create a MUG (no size field should appear) → success message, and it shows up on `/catalog` afterward.
- [x] Create an APPAREL item **without** entering any sizes → backend `400` error shown ("APPAREL items must have at least one availableSize").
- [x] Create an APPAREL item **with** sizes (e.g. `S,M,L`) → succeeds.
- [x] Visit `/admin/delivery-slots` → lists only Music Club's items.
- [x] Set a delivery slot (date + start time + end time) on one item → "Slot set." message, and the "Current slot" text updates to show it.
- [x] As a student who has ordered that exact item, check `/notifications` within ~15s → a `DELIVERY_SLOT_UPDATED` notification arrives.
- [x] Visit `/admin/orders` → **the Item column shows the real item name (not a raw Mongo ID)**, and **the Student column shows an email (not a raw UUID)** — both of these were bugs we fixed, worth double-checking carefully.
- [x] Click "Mark Delivered" on a `COMMITTED` order → status updates to `DELIVERED` in place, button disappears for that row.
- [x] As that order's student, check `/orders` and `/notifications` → status shows `DELIVERED`, and an `ORDER_DELIVERED` notification arrived.
- [x] Try visiting `/admin/promote` or `/admin/create-club` as a Club Admin (not Super Admin) → redirected away (these are Super-Admin-only).

## 8. Super Admin Pages (log in as the seeded Super Admin)

- [x] Visit `/admin/create-item`, `/admin/delivery-slots`, or `/admin/orders` → a club dropdown appears ("Select a club"); nothing loads until you pick one.
- [x] Pick a club and confirm the item list / order list shown matches that specific club, not all clubs mixed together.
- [x] Visit `/admin/promote` → enter an email, click "Find" → shows the user's current name/role.
  - [x] Promote a fresh/throwaway `STUDENT` account to `CLUB_ADMIN`, picking a club → success message; log in as that account and confirm it can now use the Club Admin pages for that club.
  - [x] Try promoting a user who's **already** a Club Admin somewhere to a **different** club → warning shown, and the backend correctly rejects it with `400` if attempted.
  - [x] Look up a nonexistent email → "No user with that email" / `404`.
- [x] Visit `/admin/create-club` → create a club, assigning a throwaway student as its admin → success message shows the created club + assigned admin; that student can now log in and manage that club.
- [x] Try creating a club with a name that already exists → `409` error shown.
- [x] Try assigning a `SUPER_ADMIN` account as a new club's admin → `400` error shown ("Cannot assign a SUPER_ADMIN as a Club Admin").

## 9. Role-based access (cross-cutting)

- [x] As a plain `STUDENT`, try visiting any `/admin/*` URL directly → redirected to `/catalog`.
- [x] As a `CLUB_ADMIN`, try visiting `/admin/promote` or `/admin/create-club` directly → redirected to `/catalog`.
- [x] Confirm `CLUB_ADMIN` and `SUPER_ADMIN` can **also** place a normal checkout on `/catalog/:id` — this is intentional, not a bug (checkout is deliberately open to every role, not just students).

---

## Known, already-understood limitations (not bugs — don't file these)

- The Club Orders page's "Student" column shows an email now, but there's no student *name* resolution beyond what's in `student_email` — this is expected.
- No real-time push anywhere (notifications and stock counts use polling, not WebSockets) — this is a deliberate architecture choice, not a missing feature.
- There's no "delete item" or "delete club" anywhere in the UI — no backend endpoint exists for either, by design.
- Registration does not ask for a preferred size — that's set afterward on `/profile`.
- A failed mock payment (`4000`) never creates a row in Orders history at all — only successful orders do. This is intentional (verified in `learnings.md`).
