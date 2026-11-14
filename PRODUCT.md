# Product

<!-- impeccable:product-schema 1 -->

The durable product record for design work on SlapStat's web app. It holds what the product is
and who it is for, not how it looks: the visual system belongs in `DESIGN.md`,
the reasons behind past choices in `DECISIONS.md`, and how the code works in `CLAUDE.md`.

## Platform

web

## Users

**Fantasy hockey managers who already play.** They run a team in a Yahoo or ESPN league, points
or categories, and know both hockey and fantasy; SlapStat explains itself, never the sport.

**In-season first** (Alexander, 2026-10-11): when a design choice has to favour one moment, it
favours the manager in the middle of the NHL season, setting this week's pickups and streamers,
checking waivers, seeing who is hot and how their team stacks up. The draft (preparing rankings
in the autumn, then Draft Mode on the day) is the second moment, seasonal and still core.

Other audiences:

- **Visitors who have not signed up**, on the public pages: the landing page (which tries the
  real projection editor without an account), `/premium`, and share links (`/s/:token`), which
  open for someone who has never signed in.
- **The admin** (`/admin`): the Yahoo service account, player syncs, the Yahoo access probe and
  given Premium memberships.

## Product Purpose

SlapStat ranks every NHL player by the user's own league's scoring settings and turns the
ranking into the decisions a manager makes: whom to draft, whom to pick up, which nights to
stream. The app is free; **Premium** is a monthly subscription (Stripe Checkout) that adds the
AI projection and the extras listed in `src/app/shared/premium/premium-perks.ts`.

Sharing is the marketing loop: a shared projection is a public, read-only page with a way to
follow or copy it, and both ends are measured (`projection_shared`,
`shared_projection_viewed`).

## Positioning

The nearest neighbour is **LineupExperts**. SlapStat offers largely the same set of tools and
aims to make **each one a little better**, in two ways that recur:

- **Tailored to your league and your team, not generic.** Rankings are scored by the league's
  imported scoring settings. The Streamer Planner reads the user's own roster and shows, night
  by night, which positions still have an open spot; LineupExperts' planner shows which clubs
  have the best schedule for everyone.
- **The answer changes in place.** Ticking a night, editing a weight or switching points and
  categories re-ranks on the page. LineupExperts reloads the whole page when a single day is
  included or excluded.

**The AI projection** is SlapStat's own model (projection-service). The team believes it is
more sophisticated than other projections and will prove more accurate; that is a belief, not a
published result (see Evidence on Hand). It is also a small part of what SlapStat does today and
will be a smaller part later: the product is the set of tools, not the model.

## Operating Context

- **The season sets the calendar**: preseason and the draft (September to early October), the
  regular season (October to April), the offseason. The landing page follows it (the in-season
  landing has an offseason line), and so do several tools: Who's Hot's ranges, the Rest of
  Season line, the planner's weeks.
- **Leagues come from Yahoo or ESPN.** Yahoo is the deeper integration (per-user OAuth, the live
  draft followed pick by pick, the user's own roster). ESPN connects with the user's cookies and
  cannot be followed live, since ESPN publishes a draft's picks only once it is over.
- **SlapStat only reads leagues.** It makes no roster moves; the add, drop or lineup change
  happens in Yahoo or ESPN afterwards.
- **Points and category leagues** both; category rankings use Z-scores.
- **Some managers keep projections in a spreadsheet** and bring them in (paste, .csv, .xlsx),
  read in the browser.
- **Features ship dark.** Most new tools land behind a build flag or a BFF feature switch,
  often on in staging before prod. Which flags are on where changes week to week and is not
  recorded here; check before assuming a surface is live.
- The interface is in **English** only; there is no i18n layer.

## Capabilities and Constraints

Surfaces, by route:

- **Projections** (`/projections`, `/projections/new`, `/projections/:id`): a projection is
  created from a preset (including the AI projection, over the whole season or, once a season
  is under way, only the games left to play), the user's own work, a shared board or a
  spreadsheet, then edited in a wide player table. League settings imported from a league are
  locked to it; **Disconnect league** is the way out.
- **Draft Mode** (`/draft`, `/drafts/:id`): a board drafted against any source, any number of
  times, optionally following the league's live Yahoo draft; a summary ranks the teams after.
- **In-season tools**: Streamer Planner (`/streamer-planner`, with the user's own open spots and
  a pickup priced against a drop), Who's Hot (`/whos-hot`), Team Power Rankings
  (`/team-power-rankings`), Player Scout (`/player-scout`: today's AI projection against an
  earlier day's, with a drop recommendation weighed against the user's roster; it replaced FA
  Scout, and `/fa-scout` redirects to it), Role Changes (`/role-changes`: skaters whose ice time
  or power-play share at their club has moved), Start/Bench (`/start-bench`: the user's roster
  on a given day with the best lineup by the AI projection) and Draft Analysis
  (`/draft-analysis`).
- **Sharing** (`/s/:token`): a frozen snapshot of the published rows, opened without sign-in,
  followed (read-only mirror) or copied.
- **Account**: sign-in by email or Google (Facebook behind a build flag); `/profile` (picture and the public name a
  share credits); `/premium` (both plans, subscribe, status and billing portal).
- **Public pages** (`/`, `/premium`, `/terms`, `/privacy`, `/refunds`) are prerendered and must
  read without JavaScript.

Constraints future work must keep:

- **The web talks only to the BFF**, and the BFF decides what is served: Premium is enforced
  there, so the web never offers what the BFF refuses.
- **Every BFF call can fail**, and every failure is shown (error state with Try again, a toast,
  or an inline save status), never swallowed.
- **Copy is held to `COPY-RULES.md`** (checked in CI) and the `slapstat-copy` skill. The
  canonical terms are projection, player rankings, scoring settings, league settings, Draft
  Mode, Premium and spot.
- **Icons are Lucide only**, through `<app-icon>`; nothing is drawn by hand, and a missing icon
  becomes a prompt for an image generator. Yahoo, Google, Facebook and ESPN marks are logos, not
  icons.
- **Player photos are off for licensing** (ESPN's are not licensed). NHL club crests are
  hot-linked from the NHL's CDN, not copied; they remain trademarks.
- **A player's club can be stale**: a share of skaters sit on a club they have left, so nothing
  may group by team without gating on the pool's sync stamp.
- **The initial bundle has a 1 MB budget**; heavy libraries load on demand.
- **The repository is public**: nothing about a user goes into it.

## Brand Commitments

- **Name**: SlapStat, in that casing (never Slapstat, SlapStats or SLAPSTAT); domain
  `slapstat.com`. Line in use: "Top-shelf tools for fantasy hockey managers".
- **Voice** (the `slapstat-copy` skill): written by someone who plays fantasy hockey and
  understands software. Second person, present tense, contractions; concrete product behaviour
  over adjectives; one idea a sentence; no SaaS hype (the banned list is in `COPY-RULES.md`);
  "we" only for what SlapStat did or failed to do; an error names what failed; no em dash.
- **Assets**: `public/slapstat-logo.png`, `public/og-image.png`,
  `public/og/team-power-rankings.png`, the app icons in `public/`.
- **Premium has one look everywhere** (the global `.premium-badge`) and one list of what it
  includes (`premium-perks.ts`), which follows what the environment actually serves: a perk
  nobody can reach is a refund request.

## Evidence on Hand

- **The product itself**: live at slapstat.com, Premium on sale since 2026-09-17. The landing
  page demo is the real editor over this season's player pool.
- **Real data**: the NHL player pool (synced from Yahoo), the projection model's lines, and the
  NHL stat store behind them (projection-service).
- **Absent, and not to be invented**: testimonials, user or league counts, press, ratings, and
  any published comparison of the AI projection's accuracy against other projections. Until such
  a comparison exists, no surface claims the AI projection is more accurate than anyone else's.
  There is no affiliation with or endorsement by the NHL, Yahoo or ESPN.

## Product Principles

1. **Your league, your team.** Every number is scored by the user's own league settings and,
   where SlapStat can read it, their own roster. A generic answer is the neighbour's job.
2. **Each tool a little better than the neighbour's.** Meet what managers expect from the
   category, then win on tailoring and on responsiveness: an input changes the answer in place,
   with no reload and no Run button.
3. **Show only what is known.** Never preselect a value that was not fetched; a failed or
   unknown read shows as no answer, never as a default that looks like data.
4. **Locked is not hidden.** A Premium feature keeps its place and its name for a free account;
   only the lock says it is not theirs yet. Someone who cannot see a thing has no reason to buy
   it.
5. **In-season and desktop first, phones acceptable** (Alexander, 2026-10-11). The week-to-week
   manager at a desktop decides close calls; every surface must still hold up at 375px (the
   breakpoint is 640px).

## Accessibility & Inclusion

No standard has been adopted; that is an open decision. Practices already in the code and worth
keeping: icons are `aria-hidden` and take their colour from the text, tables keep a player's
full name for screen readers where the phone layout shortens it, drag handles move with the
keyboard and announce in a live region, and every tooltip is the app's own `appTooltip`, never
the browser's `title`. A meaning a phone user needs is written out rather than left to a tooltip
(an off-night says "Off"), since a phone shows none.
