# DEMO.md — Shift Management System Demo Playbook

One deterministic, repeatable demo of the full product: **Smart Schedule Optimizer → Approval → Publication → Mobile attendance with presence verification + geofencing**, with three roles (Manager, Employee, Supervisor) driving a single branch.

Read this first. Everything below is verified against the bundled seed and reset pipeline.

---

## A. Reset / start here (operator)

```bash
pnpm run db:reset        # drops DB, replays migrations, runs the demo seed, ~30s
```

Then start the API (dev: `pnpm --filter @sms/api dev`, or production build + `pnpm --filter @sms/api start`). For the web app, `pnpm --filter @sms/web build` requires `NEXT_PUBLIC_API_URL=http://localhost:3001` (dev mode wires it from `.env`). The seed is **idempotent** — re-running `pnpm --filter @sms/api exec ts-node prisma/seed.ts` never duplicates rows.

> The demo anchors all dates to **today at runtime** (`+7 days` story window, `-2/-1` history). What you see on screen always matches the current date. **Resetting is the contract**: it rebuilds a pristine tenant in one command and can be run mid-demo to return to a clean slate.

Demo login accounts (all password `DemoPass-123!`):

| Employee # | Login            | Role        | Permission highlights                    |
|------------|------------------|-------------|------------------------------------------|
| DEMO-001   | owner@demo.com   | OWNER       | everything                              |
| DEMO-002   | manager@demo.com | MANAGER     | publish schedules, approve leave, correct attendance |
| DEMO-003   | employee@demo.com| EMPLOYEE    | self-service (clock-in, presence, open shifts) |
| DEMO-004   | supervisor@demo.com | SHIFT_MANAGER | read + assign shifts, **cannot publish** |

Demo branch: **Main Branch** (FOH / Bar team), one department + one team, manager `demo.manager` is the team's manager.

---

## B. Cast

| # | Name          | Login if any | Skills      | Certifications | Story role |
|---|---------------|--------------|-------------|----------------|------------|
| 001 | Demo Owner   | owner@demo.com | —         | —              | cannot staff shifts (no quals) |
| 002 | Demo Manager | manager@demo.com | —     | —              | publisher / approver |
| 003 | Demo Employee| employee@demo.com | BARISTA, CASH | FIRSTAID, FOOD (valid) | the hero: qualified for the story shift |
| 004 | Demo Supervisor | supervisor@demo.com | CASH | FOOD          | constrained: can only run the Midday Cover |
| 005 | Sam Carter   | —            | BARISTA, CASH | FIRSTAID, FOOD | **has APPROVED leave on the story day** |
| 006 | Priya Nair   | —            | CASH | FOOD           | missed 2 presence verifications (yesterday + today) |
| 007 | Miguel Rojas | —            | BARISTA, CASH | FIRSTAID, FOOD | **FIRSTAID expired 2 days ago** |
| 008 | Aisha Khan   | —            | BARISTA, CASH | FIRSTAID, FOOD | fully qualified, gets proposed |

Working hours: all eight staff have availability Mon–Sun 06:00–23:00 (shift conflicts, leave and expiry remain the differentiators). Leave balances: DEMO-005 has 7 days annual used + an approved 1-day leave on the story day.

---

## C. The schedule sheet (draft "Main Branch — Demo Week", today±)

| Shift | Day            | Time | Coverage                 | Notes |
|-------|----------------|------|--------------------------|-------|
| Weekend Service | D−2 | 08–16 | Priya Nair               | history |
| Late Bar  | D−1 | 16–00 | Demo Employee, Aisha Khan | history |
| Morning Shift | D+0 (today) | 08–12 | Demo Employee         | today's live clock-in target |
| Evening Operations | **D+7 (story day)** | 16–20 | need: 2 × BARISTA + 2 × FIRSTAID | the optimizer's stage |
| Midday Cover | D+7          | 10–14 | need: 1 × CASH           | second D+7 slot |
| Open Shift — Cover Needed | D+8 | 10–14 | open for requests        | available to every employee |

---

## D. Demo flow (30-ish seconds per step)

### 1) Manager — Smart Schedule Optimizer (the opening move)
1. Log in as **manager@demo.com**.
2. Open **Schedules → Smart Schedule Optimizer** for Main Branch, window = **story day (D+7)**.
3. Expected: `optimal`, 8 employees considered, 5 excluded, and — **the whole story on one screen**:
   - **Sam Carter** → excluded: **Approved leave** on the requested day.
   - **Miguel Rojas** → excluded: **Expired certification** (FIRSTAID ran out two days ago).
   - Owner / Manager → excluded: **missing skills** *and* missing certification.
   - Suggested staffing:
     - **Evening Operations ← Aisha Khan** (2 × BARISTA + FIRSTAID needed — she holds both, valid).
     - **Midday Cover ← Demo Supervisor** (needs CASH — he's the constrained cash-only candidate).
   - The optimizer even *tried* Demo Supervisor on Evening Operations and the qualification rule **blocked** it (`dropped blocking proposal = 1`) — "AI can propose, the platform's business rules decide."
4. Open the candidate explainer: every excluded staff member shows **why** (leave, skill, cert, expired cert).

> Talking point: the solver aggressively staffs the **constrained** candidates first (supervisor's only eligible shift is Midday), leaving the two fully-qualified baristas (Demo Employee + Aisha Khan) as the natural pair for the flagship Evening Operations shift. The manager can now see *why* before accepting anything.

### 2) Manager — human-in-the-loop correction
1. Run **Validate Assignment** for the pair **Demo Employee → Evening Operations**: returns `valid`, zero conflicts, zero warnings (skills + valid certs + no leave + no overlap).
2. For contrast, validate **Sam Carter → Evening Operations**: hard conflict — **Approved leave**.
3. Apply the proposal (both D+7 assignments) — drafts are created, no one is told yet.

### 3) Manager — publish
1. **Publish** the schedule. Expected: snapshot created; notifications fired.
2. **Demo Employee** and **Demo Supervisor** get `schedule.published` (manager: badge on the bell = 1).

### 4) Supervisor — can see, cannot publish (RBAC live)
1. Log in as **supervisor@demo.com**.
2. Schedules load fine (he has `schedule.read`), daily attendance loads fine.
3. Try to **publish** the schedule → **403**. Only MANAGER / OWNER hold `schedule.publish`. Leave that error on screen as the security beat.

### 5) Employee — mobile attendance (the closing beat)
1. Log in as **employee@demo.com** on the phone/mobile view, go to **Attendance**.
2. Clock in inside the branch geofence (see §F for coordinates). Accepted → an **AttendanceRecord** opens; a **presence verification** is due **1 minute** after clock-in.
3. Answer the presence prompt at the branch → **VERIFIED** (inside geofence, 0 m from center, radius 500 m).
4. Bonus demo: clock in from far away (e.g., San Francisco) → **rejected**: geofence mode is `strict` and missing-location reporting is off.

### 6) Manager / Supervisor — presence exceptions (proof it's real)
1. **Attendance → Presence Verifications**: **Priya Nair shows 2 × MISSED** (yesterday + today). She clocked in outside the fence, so a verification ran, and she never answered it.
2. View the **Daily Board** for today: Demo Employee's clock-in and Priya's record with the flag.
3. (Optional) Manager uses **Correction** with a mandatory audit reason (every correction is audited).

### 7) Employee — open shift (optional 5th beat)
1. Open Shifts shows **"Open Shift — Cover Needed"** (D+8, 10–14), open to all staff.
2. Request it → `pending`. A supervisor/manager can approve it and the employee appears on the shift.

---

## E. What "ready" means after `pnpm run db:reset` (verified counts)

- 42 permissions seeded; 8 employees; 6 shifts; 4 assignments; **2 shift requirements** (Evening 2×BARISTA + certs, Midday 1×CASH); 10 skills; 10 certifications; 4 notifications (1 unread); 42 availability rules; 1 geofence (Main Branch, active); 1 draft schedule; 2 leave requests (1 approved on story day, 1 pending); 2 presence verifications (both MISSED, Priya).
- Owner-role permissions are self-healed at seed ("Linked 0 … catalog covers 42 of 42" — idempotent).

---

## F. Break-glass numbers / config

| Item | Value |
|------|-------|
| Branch geofence center | **40.712775, −74.005973** (radius **500 m**, toggled **on**) |
| Geofence mode | `strict`, missing-location reporting `off` (clock-ins without coordinates are rejected) |
| Presence verification | enabled, **1 minute** after clock-in, **15-minute** grace before auto-MISSED |
| Attendance reconciliation | PENDING past `dueAt + grace` → MISSED (manager-triggered) |
| Story day | today + 7 (fixed by seed every reset) |
| API | `http://localhost:3001/api/v1`, `/health` ok |

For the mobile demo use any location within the fence; to show the strict rejection, use a far-away location.

---

## G. Known limitations

- **Smart Schedule Optimizer staffs constrained candidates first**; it will satisfy a CASH-only shift before fully filling a 2-person shift when the last eligible candidate is multi-qualified. That's why the demo pairs *Midday ← Supervisor* with *Evening ← Aisha and Demo Employee (manual validate + apply)* — it demos the "AI proposes, managers decide" loop on purpose.
- **No browser automation** in this environment: visual QA was done by code inspection + API-level rehearsal, not pixel checks. Run the UI steps in §D once live before presenting; the API behaviors above are guaranteed by tests and the smoke suite.

## H. Verified smoke suite (28 checks, all green)

Bench-verified via HTTP against the reset DB: 8 employees considered / 5 excluded with reasons visible, per-pair verdicts (leave / expired cert / missing skill / clean), clock-in inside fence accepted, presence verify → VERIFIED, far-away clock-in rejected, supervisor reads OK but publish → 403, 2 MISSED exceptions visible.