# 🔴 Stranger Things — UI/UX Quiz System

A full-stack quiz platform with real-time admin monitoring, tab-switch detection, and session persistence.

---

## SETUP

### Requirements
- Node.js 18+ installed

### Install & Run

```bash
# 1. Install dependencies (already done if node_modules exists)
npm install

# 2. Start the server
npm start
# OR
node server/index.js
```

Server starts on **http://localhost:3000**

---

## PAGES

| Page | URL |
|------|-----|
| 🎮 Team Quiz | http://localhost:3000/quiz.html |
| 🛡 Admin Panel | http://localhost:3000/admin.html |

---

## CREDENTIALS

### Admin
- Password: `chmod777`

### Teams (10 pre-registered)
| Team ID | Password | Name |
|---------|----------|------|
| TEAM01  | pass01   | Team Alpha |
| TEAM02  | pass02   | Team Beta |
| TEAM03  | pass03   | Team Gamma |
| TEAM04  | pass04   | Team Delta |
| TEAM05  | pass05   | Team Epsilon |
| TEAM06  | pass06   | Team Zeta |
| TEAM07  | pass07   | Team Eta |
| TEAM08  | pass08   | Team Theta |
| TEAM09  | pass09   | Team Iota |
| TEAM10  | pass10   | Team Kappa |

---

## FEATURES

### Quiz (Team Side)
- ✅ **Session survives refresh** — answers stored server-side, restored on reload
- ✅ **Randomised question order** per team (within each section)
- ✅ **Timer synced to server** via heartbeat every 15s
- ✅ **Real-time answer saving** on every selection
- ✅ **Keyboard navigation** — Arrow keys to navigate, 1-4 to answer, F to flag
- ✅ **Typewriter animation** on question text
- ✅ **Stranger Things theme** — Christmas lights, red glow, Special Elite font

### Admin Panel
- ✅ **Live WebSocket updates** — new logins, submissions, tab switches appear instantly
- ✅ **Tab switch detection** — triggers on visibility change, blur, Ctrl+Tab, Alt+Tab, window switch
- ✅ **Alert log** with team name, count, timestamp
- ✅ **Toast notification** for each new tab switch event
- ✅ **Leaderboard** with rank, score, breakdown, time, tab switch count
- ✅ **Team credentials grid** showing status (Not Started / In Progress / Submitted)
- ✅ **Clear all data** button for resetting between rounds

### Architecture
- ✅ **In-memory server state** — survives client refreshes, no database needed
- ✅ **Multi-team concurrent support** — each team has isolated session state
- ✅ **No data collision** — teams identified by session token
- ✅ **WebSocket broadcast** to all connected admins simultaneously

---

## CUSTOMISATION

Edit `server/index.js` to:
- Change `ADMIN_PASSWORD`
- Add/edit `TEAM_CREDENTIALS`
- Add questions to `getAllQuestions()`
- Change timer: `totalSeconds: 38 * 60` in the login route

---

## NETWORK ACCESS (for LAN events)

To let other computers on the same WiFi connect:

1. Find your IP: run `ipconfig` (Windows) or `ifconfig` (Mac/Linux)
2. Teams open: `http://YOUR_IP:3000/quiz.html`
3. Admin opens: `http://YOUR_IP:3000/admin.html`
