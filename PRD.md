# 1) Product summary

**Working name:** PulseCast
**One‑liner:** Create a room, share a 6‑digit code, and broadcast live audio from one device to ~27 nearby devices with **perceptually zero lag** and a minimal UI.

> **Reality check on “zero latency”**
> Absolute zero network latency is physically impossible. This PRD defines strict, testable targets that make the experience **perceptually instant and synchronized**.

---

# 2) Goals & non‑goals

### Primary goals

* **One‑to‑many audio broadcast**: One “Host” streams audio in real time to up to **27 Listeners** in the same room.
* **Perceptual zero‑lag**:

  * **End‑to‑end (host → listener) one‑way latency**: median ≤ **50 ms** (LAN), ≤ **120 ms** (good WAN).
  * **Inter‑listener skew** (difference between any two listeners): ≤ **15 ms** (LAN), ≤ **35 ms** (good WAN).
* **Simple UX**: Two actions only—**Create** a room or **Join** with a **6‑digit code**. No sign‑in.
* **Lightweight**: Minimal UI; fast loads; small JS footprint.
* **Reliability**: Stable for 26–27 concurrent devices per room.

### Non‑goals (v1)

* No video; no multi‑host mixing; no recording; no chat.
* No persistent user accounts.
* No advanced moderation or analytics dashboards (basic metrics only).

---

# 3) Target users & use cases

* Teachers, tour guides, office standups, small venues, watch parties—any scenario where **one device** needs to **broadcast** to many **nearby** devices with minimal lag.

---

# 4) User stories (critical)

* As a Host, I can **Create Room** → get a **6‑digit code** → **Start Broadcast** from mic or system audio.
* As a Listener, I can **Join Room** by entering the code → **Tap to unmute** (autoplay policy) → hear the stream **immediately**.
* As a Host, I can **handoff hosting** to a listener if my device leaves/dies.
* As a Listener, I can **adjust volume** and **choose output device** (when supported).
* As a Host, I can **see connected count** and whether we’re meeting the latency target.

---

# 5) UX & flows

### Entry screen

* Two buttons: **Create** • **Join**
* Footer: “Works best on headphones • Allow microphone/screen audio to broadcast”

### Create flow

1. Tap **Create** → backend returns **6‑digit code** (e.g., `123‑456`) + “Waiting for listeners…”
2. Tap **Start Broadcast**

   * Choose **Mic** (default) or **System/Tab audio** (via `getDisplayMedia` with audio).
   * Prompt for autoplay: “Enable audio” (user gesture).
3. See **live status**: listeners count, median latency, jitter, region.

### Join flow

1. Tap **Join** → numeric keypad → enter `XXXXXX`.
2. If room active: connect → prompt “Enable audio”.
3. Show minimal player: Room code, connected count, latency badge (Good/Fair/Poor), volume, output selector.

### Error states

* Invalid/expired code; room full (27 cap); network blocked (no TURN); autoplay blocked (prompt re‑enable).

> **Wireframe (text)**

```
[ PulseCast ]                [ Join Room ]
[ Create  ] [ Join  ]        Code: [ _ _ _ - _ _ _ ]
                             [  Join Now  ]

[ Host Room: 123-456 ]       [ Room: 123-456  •  23 listeners ]
Listeners: 0                  ◉ Live (Good)  Latency: ~55 ms
[ Start Broadcast ]           [ Volume ▢▢▢▢▢ ] [ Output ▼ ]
[ Copy Code ] [ End Room ]    [ Leave Room ]
```

---

# 6) Functional requirements

* **R1. Room creation**

  * Server generates **unique 6‑digit numeric code** (`^[0-9]{6}$`, display as `XXX‑XXX`).
  * **TTL**: 2 hours active or until Host ends room; codes recycled only after safe TTL expiry.
  * **Capacity**: 1 Host + up to **26 Listeners** (hard limit 27 total).

* **R2. Join**

  * Listener enters code; server validates capacity & freshness; returns **WebRTC join info**.
  * First entrant is **Host**; subsequent entrants default **Listener**.

* **R3. Broadcast**

  * Host selects **audio source**: microphone (AEC/NS toggles) or system/tab audio.
  * Host publishes **one audio track** to the SFU; listeners subscribe **receive‑only**.
  * Host can **mute/unmute**, **end**, or **handoff host** (promote a listener).

* **R4. Sync**

  * Built‑in **time sync** (see §8) to align playout across listeners.

* **R5. Signaling & presence**

  * WebSocket signaling; heartbeat every 5 s; presence updates to Host.

* **R6. Telemetry (privacy‑light)**

  * Room metrics: join count, current listeners, median latency/jitter, packet loss (%).
  * Client metrics via `getStats()` sampled every 2–5 s; anonymized.

* **R7. Accessibility & device controls**

  * Keyboard navigable; visible focus; large keypad; output device selection via `setSinkId` (when available).

* **R8. Security**

  * DTLS‑SRTP transport; short‑lived room & join tokens (JWT); rate‑limited code attempts.

---

# 7) Non‑functional requirements

* **Performance**

  * First load TTI ≤ **1.5 s** on 4G; JS ≤ **180 KB** gzipped for the join screen.
* **Latency targets (acceptance)**

  * **Host→Listener one‑way latency**:

    * LAN: p50 ≤ 50 ms; p95 ≤ 80 ms; p99 ≤ 120 ms.
    * WAN (same region): p50 ≤ 120 ms; p95 ≤ 180 ms; p99 ≤ 250 ms.
  * **Inter‑listener skew**: LAN ≤ 15 ms; WAN ≤ 35 ms.
* **Reliability**

  * Room uptime 99.9% monthly; graceful TURN fallback.
* **Compatibility**

  * Latest Chrome/Edge/Firefox; Safari 16+; iOS/iPadOS 16.4+; Android 11+.
  * Progressive Web App shell (installable), but background play not guaranteed on all mobile.

---

# 8) Architecture & technical design

### Stack

* **Frontend**: **Next.js (App Router, React Server Components)**, TypeScript, minimal client JS per route.
* **Signaling API**: Node 20+, **WebSocket** (Fastify or bare ws).
* **Media**: **WebRTC + SFU** (single upstream from Host, N downstream to Listeners).

  * SFU options (pick one for v1): **mediasoup** (self‑host), **Janus**, **LiveKit** (managed/self).
  * Rationale: Mesh doesn’t scale; MCU adds mixing delay; SFU gives minimal added latency.
* **Traversal**: **STUN/TURN** (e.g., coturn) with ephemeral credentials.
* **Storage**: In‑memory/Redis for rooms & presence; no PII.
* **Hosting**:

  * Next.js on edge (static/SSR) for page loads.
  * **Dedicated Node region** for persistent WebSockets & SFU (close to users).

### Media pipeline (one track, many subscribers)

```
[Host getUserMedia/getDisplayMedia] 
      ↓ (Opus @48kHz, 5 ms ptime, FEC on, low-latency)
          DTLS-SRTP
      →  [SFU]  → fan-out → [Listener 1..27]
                           (receive-only, DataChannel control)
```

### Ultra‑low‑latency tuning

* **Codec**: Opus, 48 kHz, mono (stereo optional), **ptime=5 ms**, **maxptime=10 ms**, **FEC=on**, **DTX=off** (continuous stream), constrained bitrate (e.g., 32–64 kbps).
* **Jitter buffer**: Request minimal buffering; set **`RTCRtpReceiver.playoutDelayHint`** to ~0.02–0.04 s **where supported** (fallback to default otherwise).
* **Constraints**: For microphone speech, enable **echoCancellation**, **noiseSuppression**, **autoGainControl** as toggles; for music, allow disabling to reduce added processing delay.
* **SFU config**: Prioritize low latency over loss concealment; short queue; no transcoding unless necessary (pass‑through Opus).
* **Synchronization**:

  * **Clock sync**: NTP‑style ping on DataChannel to estimate server offset/drift (5 quick probes; median).
  * **Playout alignment**: SFU relays a **server timestamp**; receivers calculate a **target playout time** and bias their local jitter buffer towards that time (small, continuous drift correction to keep devices aligned).
  * **Skew monitor**: Listeners send periodic tone‑mark timing (client‑side correlation) to estimate **relative skew**; SFU/Host displays a “Sync: Good/Fair/Poor” badge.

> Note: We can’t force exact sample‑time across browsers, but with the above strategy we achieve perceptual sync. Where available, we route the remote track through **Web Audio** for fine timing nudges (very small added buffer, typically 10–20 ms) only when necessary.

### Signaling protocol (WebSocket)

* **Messages**: `create_room`, `join_room`, `sdp_offer/answer`, `ice_candidate`, `host_handoff`, `leave`, `heartbeat`, `metrics`.
* **Auth**: short‑lived JWT per role; room secret kept server‑side; codes are not credentials.
* **Presence**: server tracks members; on Host drop, **auto‑promote** the earliest listener (or the one designated by Host) if “auto‑handoff” is enabled.

### Room/code service

* **Code format**: 6 digits; reject ambiguous codes (`000000`, `123123`) optionally.
* **Rate limits**: 10 create attempts / IP / minute; 60 join attempts / IP / hour.
* **TTL**: Active while Host connected + 10 minutes grace; max hard TTL 2 hours.

### Data model (ephemeral)

* `Room { code, createdAt, region, capacity=27, hostPeerId, listeners[], status }`
* `Participant { peerId, role: 'host'|'listener', joinedAt, deviceHints }`

### Pages & routes

* `/` (landing: Create/Join)
* `/room/[code]` (SSR shell; client hydrates WebRTC controller)
* `/api/room` (POST create)
* `/ws` (WebSocket endpoint for signaling)

---

# 9) Security & privacy

* **Transport**: HTTPS; DTLS‑SRTP for media; WSS for signaling.
* **TURN credentials**: short‑lived via REST API (`hmac` with timestamp).
* **Data minimization**: No PII; store only ephemeral metrics.
* **Abuse prevention**: Rate limits, basic CAPTCHA after repeated failures, code enumeration detection.
* **Option (later)**: Insertable Streams for end‑to‑end encryption beyond SFU (adds CPU/latency; not in v1).

---

# 10) Accessibility & compliance

* WCAG 2.2 AA basics: keyboard nav, focus states, color contrast, labels.
* “Enable audio” button is always focusable and discoverable to satisfy autoplay policies.

---

# 11) Observability & metrics

* Client `getStats()` to report: RTT, jitter, packetsLost, jitterBufferDelay, jitterBufferEmittedCount, audioLevel.
* Room‑level aggregates: p50/p95 latency estimates, skew estimates, join/leave events.
* Logging: structured JSON with room code hashed.
* Alerting: high packet loss (>5% p95), TURN usage spikes, repeated code brute‑force.

---

# 12) QA & acceptance tests

### Functional

* Create/join with valid/invalid codes; capacity cap @27; host handoff; TURN fallback (block UDP to force test).

### Latency & sync

* **Mouth‑to‑ear**: play a known **chirp** from Host; listeners auto‑correlate local capture via Web Audio to estimate one‑way latency (no manual stopwatch).
* **Inter‑listener skew**: listeners receive periodic **sync pings**; compare arrival vs target playout; must meet targets (§7).
* **Network chaos**: simulate 1–3% loss, 20–60 ms jitter; verify p95 under limits.

### Compatibility

* Chrome, Firefox, Safari (macOS + iOS), Android Chrome; wired/Wi‑Fi/4G.

---

# 13) Rollout plan

* **Alpha (internal)**: LAN tests; 10–15 devices; measure skew; tune SFU/jitter buffers.
* **Beta (limited)**: Mixed networks; 3 geo regions; monitor TURN %; optimize code rates.
* **GA**: Documentation, SLA, simple status page.

---

# 14) Risks & mitigations

* **Autoplay & user gesture**: Require explicit “Enable audio” on join; cache permission for session.
* **iOS background audio**: May suspend; communicate limitation; suggest screen awake.
* **Network variability**: Provide TURN fallback; adaptive bitrate; expose latency badge.
* **“Zero‑latency” expectation**: Frame messaging around **perceptual** instant; publish numeric targets and live indicators.
* **Browser differences**: Use feature detection for `setSinkId`, `playoutDelayHint`, Web Audio routing; maintain safe fallbacks.

---

# 15) Visual & UI guidelines

* **Minimal look**: single‑column mobile‑first; large buttons; numeric keypad for code.
* **Dark/light** modes; system font stack; no heavy UI libs.
* **Animations**: none by default; keep under 8 KB CSS total.

---

# 16) Implementation notes (developer‑ready)

* **Next.js**

  * App Router; server actions for `/api/room` (create); edge‑cached landing.
  * Client components only where WebRTC is used; lazy‑load those bundles on `/room/[code]`.
* **WebRTC**

  * `RTCPeerConnection` with **single audio sender** from Host; listeners set `direction: "recvonly"`.
  * **SDP munging** to enforce Opus/ptime/bitrate where necessary.
  * DataChannel `control` for time sync, hearts, and host handoff.
* **SFU**

  * Co‑locate SFU and signaling (single region per room) to cut host→SFU RTT.
  * Use UDP preferred; detect/block fallback to TCP/TLS only when necessary.
* **TURN/STUN**

  * Primary STUN (public); **TURN UDP** in same region; **TCP/TLS** as final fallback.
* **Code generation**

  * Uniform random 6‑digit; reserve hot/abusive codes; display as `NNN‑NNN`.
  * Store `{ code, roomId, createdAt, expiresAt, region }` in Redis with TTL.
* **Host handoff**

  * Host can nominate a listener; server updates roles; listeners re‑subscribe to new source (seamless).

---

# 17) Open questions (decide before build)

* Permit **stereo** for music mode? (adds bandwidth; minor latency difference)
* Default **AEC/NS/AGC** toggles when broadcasting system audio? (likely all off)
* Should codes be **numeric only** or **CVC‑style alphanumeric** for fewer collisions?
* Max **room TTL** beyond 2 hours?

---

# 18) Success metrics (post‑GA)

* **Join success rate** ≥ 98%.
* **TURN usage** ≤ 25% (healthy NAT traversal).
* **Latency target adherence** ≥ 95% of listening time.
* **Room crash rate** < 0.5% sessions.
* **User effort**: median clicks to join ≤ 3.

---

## Appendix A — Minimal API (illustrative)

* `POST /api/room/create` → `{ code, region, token(host) }`
* `POST /api/room/join` `{ code }` → `{ role, rtcConfig(iceServers), token, sfuEndpoint }`
* `WS /ws`

  * `join_room { code, token }`
  * `sdp_offer/answer`, `ice_candidate`
  * `control { syncPing | hostHandoff | leave }`

---