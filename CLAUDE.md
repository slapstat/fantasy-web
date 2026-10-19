# CLAUDE.md — fantasy-web

Angular frontend for the fantasy hockey draft tool. Fantasy managers log in,
make predictions for the upcoming NHL season, and get a ranking of players
based on their league/scoring settings. Talks only to `fantasy-bff`.

## Tech stack

- Angular, TypeScript, RxJS: the versions are whatever `package.json` pins (written out here,
  they went a major version stale)
- Standalone components, signals
- Tests: Vitest (via `ng test`), ng-mocks, jsdom
- Lint: ESLint + angular-eslint; Format: Prettier
- API client generated from BFF OpenAPI via `ng-openapi-gen`

## Common commands

```bash
npm ci                 # install (use this, not npm install, for clean state)
npm start              # ng serve → http://localhost:4200 (talks to a local BFF on :8080)
npm run start:staging  # ng serve locally but point apiUrl at the staging BFF (api.staging.slapstat.com)
npm test               # Vitest run
npm run lint           # eslint src/**/*.ts
npm run format         # prettier --write
npm run format:check   # prettier --check (CI uses this — must pass)
npm run build          # production build → dist/fantasy-web/browser
npm run generate:api   # generate src/app/api from specs/bff-openapi.yaml
npm run check:copy     # hold user-facing copy to COPY-RULES.md (CI uses this)
```

CI runs (and must pass): `generate:api`, `lint`, `format:check`, `check:copy`, `test`, `build`, and the
guard scripts in `.github/scripts/` (`check-build-placeholders.sh`, `check-deployment-args.sh`,
`check-inline-icons.sh`, `check-native-tooltips.sh`, `check-password-fields.sh`,
`check-pending-states.sh`, `check-backdrop-clicks.sh`).

> **After cloning, run `npm run generate:api` once** — `src/app/api` is generated,
> not committed, so lint/test/build will fail until it exists.

## Architecture (`src/app/`)

- `api/` — **generated** client (`fn/`, `models/`), **not committed** (gitignored).
  Generated from the pinned `specs/bff-openapi.yaml` via `npm run generate:api`
  (CI runs this after `npm ci`). Do not hand-edit.
- `auth/` — `login`, `register`, shared `auth-form`
- `draft-projection/` — main feature: `projection-settings-section`,
  `scoring-type-section`, `scoring-stats-section`, `player-projections-table`,
  `share-dialog` (publishing the projection as a public link).
  **League settings are locked to an imported league**, on every page that imports one (the
  editor, Who's Hot, New projection, Draft Settings): the league type, which stats score, the
  points weights, the league size and the roster slots show as the league set them and cannot be
  changed; the goalie minimum, the utility columns (GP, TOI) and everything about display stay
  the user's. The way out is **Disconnect league** in `app-league-sync` (the import dialog, or the
  League section of Draft Settings), which drops `yahooSync`/`espnSync` and keeps the values,
  now editable, and `lastEspnLeagueId`; in a draft it also ends following the league's picks.
  Opening the other platform's tab while linked asks first (`platform-switch-dialog`), and
  going on disconnects the same way but leaves the import dialog open for the new sync.
  Each shared control takes the league's name as `lockedBy` (null = the user's). Until
  2026-09-29 the settings stayed editable and a "No longer in sync" dialog broke the link after
  the edit; that dialog now only guards Draft Mode's picks and a league board's order.
  The table's toolbar is two groups: the **league settings** (Points/Category, League setup, Stats,
  Ranking, Import league), which change the numbers, and the **filters** (search, position, team,
  rookies), which change which rows show. On a phone the first group folds behind one
  "League settings" button, since it is set once per projection and open it took four rows. The
  bulk **Decimals** setting sits folded under the Stats menu rather than on the toolbar, as the one
  other question asked of every column at once. The filter selects carry no visible label: their
  first option already says what they narrow.
  The search box is `shared/player-picker`, shared with the share page and Who's Hot: typing
  narrows the table by name as it always did, and ticking names in the list under it shows those
  players and nobody else (the other filters still apply on top). While anyone is ticked the
  typed text only searches the list, so it cannot hide the players already picked.
  The pill beside the box is two buttons: the count opens the list of who is picked, where one
  player can be taken out, and the cross clears them all.
  A pick of skaters alone drops the goalie columns, and a pick of goalies alone the skater ones,
  as the position filter would (`ActiveColumnsService.columnFilter`).
  The player pool moves under a saved projection — a new season brings a new roster, trades
  and call-ups follow — and the **BFF** adds the newcomers on the read that notices, seeding
  them from what the projection started as. It never removes: a row whose player has left the
  pool is kept, and **the table is what hides it**, without a word: nearly everyone who leaves a
  pool is a player no fantasy manager would draft, so a count of them was noise (Alexander's
  call). `shared/player-pool-notice` still reports the additions from `poolReconciliation`, once
  per pool change. The editor also carries `playerBasis` / `playerPoolSyncedAt`
  through `ProjectionState` untouched, so a save doesn't drop them.
  Behind `MANUAL_RANKING_ENABLED`, the toolbar's **Ranking** menu switches a player type from its
  projected stats to the owner's own order. `models/manual-ranking.ts` holds the whole of it: the
  hand-ranked type keeps the value curve its projections produced and the order only decides who
  sits in which seat, so the board can still weigh a hand-ranked goalie against a centre. It is
  applied in `scoredProjections`, which is upstream of every rank, share and draft board, rather
  than in a sort. A place is typed into the # column, and that column is an input only while
  `rankableType()` says the rows on screen are that whole type in ranking order.
  The table also marks **rookies** (a badge by the name, plus a "Rookies only" filter) from
  `GET /api/v1/players/rookies`. That endpoint answers `known: false` wherever the projection
  service is not running — production, today — and a failed request leaves the resource without
  a value; both must read as _no marker and no filter_, never as every player being a veteran.
  `rookieIds` is therefore null in both cases, and is taken via `hasValue()` because reading a
  resource in an error state throws.
- `draft-start/` — the **Draft Mode** page (`/draft`): picks what a draft is drafted
  against, across three kinds of source — the presets, the user's own projections, and
  boards copied from someone's share link. Drafts left mid-way lead the page as cards,
  since resuming one is what most visits are for; **the card itself is the button** (a
  chevron and a "Resume draft" / "View draft" label at its edge), with discard and
  open-the-projection behind a kebab. Below it, starting a draft is **one choice made in
  steps**: a segmented control for the kind of source (the table toolbar's "Points |
  Category" pill, each segment carrying its count so the two kinds not open are still
  accounted for), the radio cards of the open kind, and a single **Start draft** button,
  the only filled button on the page. The kind was a row of tiles for a release; once the
  choices under it became cards too (#515) the two rows looked alike and nothing said
  which was the category, so the category went low and the cards kept the weight.
  `projection-create` asks the same question
  the same way, down to the markup: the same segmented control over the same three kinds,
  the same radio cards under it, and the paste field on the shared kind. The three kinds
  and their labels live in `models/source-kind.ts` so the two pages cannot drift into
  calling one group two things; everything else is repeated per page, since component
  styles are scoped. That page went via four cards with the boards folded into a `<select>`
  (#508, #514), which was its own invention and made the reader learn the question twice.
  The new-projection page also sets the **league** above a preview, with the one
  `shared/league-settings-controls` component (the editor's toolbar: points/category, League
  setup, Stats, Import league) and the preview's editable weight row, kept per starting point
  and laid over the settings it creates with (a copy stays byte-exact when the league was left
  alone). A preview scored by defaults read as "not my league" and put people off creating at
  all. **The draft picker does neither any more**: it is the source and Start. A draft's league
  is set in the draft page's setup (`draft-mode/draft-setup`, a popup over the board: open by
  itself on a new draft, and the Settings button once the draft runs) — the same controls with `[sizing]="false"`, since the league's size there is the teams
  it seats, plus `shared/stat-weights-editor` for the points. Alexander's call (2026-09-28): the
  picker's preview was not the board the draft shows, and a league set before Start had to
  travel in history state and could not be changed once the draft ran.
  The first row of the open kind is
  checked from the start (`selection`, a
  `linkedSignal` that keeps a pick whose row survives a reload), so a preset draft is
  still one press away. Every choice under the tiles is **the same card** (a visible radio,
  an icon, the name, the meta if there is any, an outline on the checked one), two across
  on desktop and one on a phone. The presets were cards and the boards a ruled list for one
  release (#514); switching tiles then switched the grammar of the control under them,
  which read as inconsistent, so the card won. The two presets side by side are peers: the
  AI projection is what we mean to sell, and second in a vertical list it read as a
  footnote. It carries a gold **Premium** badge. **It is also locked**, and the two are different
  questions: the badge says which plan it belongs to, the padlock says this account has not
  bought it. `shared/premium/ai-projection-access.ts` answers the second for both pages so
  they cannot lock the same starting point on different terms, and holds off until the
  entitlement has landed — locking on a live read that says non-premium until it answers would
  put a padlock on a subscriber's own feature every time they open the page.
  **Locked is not hidden, deliberately.** The card keeps its place, its icon and its full-weight
  name; only a gold edge and the padlock say it is not yours yet, and picking it swaps the page's
  primary button for the way to `/premium`. Someone who cannot see the thing has no reason to buy
  it. (`FeatureService.aiProjection` is what genuinely hides it, and it is a third question:
  it is the BFF's answer from `GET /api/v1/features`, the same one its endpoints enforce, so
  there is no web build switch for it and the web cannot offer what the BFF refuses.) The gate is only what the pages draw —
  the BFF refuses `source=model` and the model's own lines to the same accounts, which is what
  makes it real. The radio stays real and visible on purpose: it is what the E2E suite
  checks (`li.row` + `getByRole('radio')`). The shared kind carries the paste
  field; `shareTokenFrom` accepts a whole URL, a `/s/…` path, or a bare token, and a name
  clash (409) asks for a name rather than reporting a failure the user cannot act on — which
  is now a rare path, since db-service numbers a taken name rather than refusing unless the
  caller chose it.
  **Import a spreadsheet** (`shared/spreadsheet-import`) sits on the new-projection page and the
  home page's import panel, **not on the draft picker**: Alexander took it off there (2026-09-28),
  since a file becomes a projection and the picker's own group already links to where
  projections are made. An .xlsx or .csv file read in the browser becomes an imported board like a share
  link's, created with `kind: imported` and its own rows (every pool player: empty unless the sheet
  names him, and a named player's own line under the sheet's stats, so a sheet without a SOG
  column does not leave 50 goals on no shots) and no origin, which is how the lists tell it apart ("From a spreadsheet", a green
  sheet icon). It was a button inside the editor for a release; Alexander moved it here because a
  projection kept in a spreadsheet is something you start from, like a shared board, not an edit.
  It draws nothing unless `SPREADSHEET_IMPORT_ENABLED` is on. An
  import switches to that kind and checks the copy.
  History, for anyone tempted to relitigate: the three kinds were tabs (#406), then all
  three lists at once with a button per row (#459, #503), then a hierarchy of filled and
  outlined buttons (#505). Eight buttons on one page was still too much; folding two of
  the three kinds behind tiles that name their contents is the compromise.
  **A draft is a row of its own** (`kind: draft`), holding its picks, its league and a copy of
  the numbers it was played against — so a board can be drafted against **as many times as its
  owner likes**, and editing or deleting that board leaves a draft under way exactly as it was.
  Start never saves anything: it opens `/draft/new/preset/:preset` or `/draft/new/board/:id`,
  and the draft page creates the draft once its setup is confirmed (`POST
/api/v1/projections/{id}/drafts` for a board, which copies the rows server-side; a plain
  create with `kind: draft` and `source` for a preset, whose rows the server seeds). The draft
  then lives at `/drafts/:id`. Before this a draft was a field on the board, so "one draft per
  projection" was a property of the storage rather than anyone's decision, and a preset could be
  "used up" by the draft against it.
  `ProjectionStorageService.listProjections()` filters the drafts out so they never show up as
  the user's own work, and `listAll()` is the one place they are wanted — the draft page, which
  lists them above the boards a new draft would be started against. A third reading,
  `listEditable()`, is everything that can be opened in the editor — the user's own plus
  imported boards, drafts excluded — and is what `projection-list` lists.
  **A draft is named**, defaulting to what it was started from and numbered by the server on a
  clash ("AI Projection (2)"). It can be renamed from its row on the draft page or from the
  heading on the board (`PUT /api/v1/projections/{id}/name`); a name the user typed is refused
  when taken, and from then on it is theirs. **The heading is editable during the setup too**,
  before anything is saved: there is nothing to rename yet, so the name is held and travels with
  the setup when it is confirmed. What the heading shows there is `freeNameFrom` (in
  `services/projection-name.ts`, the same shape db-service uses) applied to the drafts the user
  already has — otherwise the setup reads "AI Projection" and the draft that comes out of it is
  called "AI Projection (2)". The server still settles the real name; this only stops the page
  promising one it will not get. A **league sync** names the draft after the league
  (`derived: true`), which the server numbers on a clash and declines once the user has named
  the draft themselves — Alexander's call: a name somebody chose is the more deliberate of the
  two. A sync during a setup that has not been saved yet is held and applied the moment the
  draft exists. `projection-create` deliberately keeps `listProjections()`:
  it asks whether the user already has a projection of their own, and an imported copy
  is not one. An imported card says whose board it is and offers no Share, since a share
  credits the account that publishes it.
  Both sources then run the same board in `draft-mode/`.
  **Every draft setting has one owner.** While a board follows its league, the league owns the
  teams and the order: the board shows them read-only on its live line ("12 teams · draft
  position 6", the position only once the league has set its order), and the settings show
  them locked. With sync off the user owns the order and the seat and edits them in the settings;
  the number of teams stays the imported league's (below). **A new draft
  against a board that already has a league to follow has no setup**
  (`startingFromLeague`): the page reads the league's draft and creates the draft from its board,
  following it (the league's teams, its order where set, any picks already made), and falls back
  to the settings, with the reason on them, only where that draft can't be read or followed.
  The **settings** ("Draft Settings", `draft-mode/draft-setup`) hold everything else, in three
  sections. _League_: the import itself (`app-league-sync`, the Yahoo/ESPN picker, drawn in the section rather than behind an "Import league" button; Alexander's call), which sets the scoring; where the league's
  draft can be followed (`syncAvailable`: a Yahoo league, where the BFF's feature switch is on)
  the import turns on **Autosync draft picks**, the only place that switch lives (the board's toolbar has
  none). The switch asks the page for the league's draft before anything is saved
  (`checkSetupSync` → `DraftSyncCheck`), and only a league that answered locks anything.
  _Scoring_: editable until a league is imported, then locked to it like everywhere else (see
  "League settings are locked" under `draft-projection/`). _Teams and roster_: the league size, the user's draft position
  (on "Select" until chosen), the teams in their draft order and the roster slots, set by hand,
  or shown locked from the league's answer while picks are synced (the seat reads "–" and no
  order is drawn until the league has set its order). Once the size and the seat are chosen by
  hand, **Draft order** lists every team: a name field each (blank saves as "Team N", numbered
  down the order without the user's, shown as the placeholder), the user's team marked "You",
  a team with picks marked "Drafted", and a grip handle that drags the team (CDK drag-drop; the
  popup is a `cdkScrollable` so a drag scrolls it) and, being a button, moves it with the arrow
  keys, Home and End, announced in a live region. The seat select and the list are one order:
  moving the user's team changes the seat. Alexander brought the list back on 2026-09-28 after
  #816 had dropped it, since it now only serves drafts without a league (see DECISIONS.md). An
  ESPN league, a league that refused, a switch turned off and no league at all all leave these
  by hand. Saving with the switch on follows the league (`follow: true`);
  saving with it off stops following. Sync switched off (or stopped) before the league has set its order
  (`seatIsGuess`: the board is the league's team list and nothing is picked) opens the setup with
  the seat on "Select" and no Cancel, and the switch stays saved on until a seat is chosen, so a
  reload never opens a board drafted on a seat read off the team list.
  A draft whose league came from Yahoo can **follow that league's live draft** ("Follow Yahoo
  draft"). Following makes the league the source of the board: its teams, keyed by Yahoo's team
  key, in draft order, and its picks, polled every 5 s while the tab is visible and at once when
  it comes back into view (`league-draft-follow.ts` holds the pure mapping). Until the league's
  order is known (the BFF's `orderKnown`: Yahoo lists a live draft's slots only once it runs) the
  board holds the league's teams in the league's list order and says only that it is waiting,
  never a seat read off that list. Every pick edit is locked meanwhile, a board with a pick that is not the
  league's pick in that place asks before it is replaced, and following stops on an auction draft,
  a league without the user's team, a finished draft, or a 400/404/424. A dropped connection keeps
  polling. The switch is saved with the board as `draft.following` (only while on), so opening the
  board again, on any device, picks the league's draft back up once the BFF's features say
  following is offered; leaving the page is not switching it off. "Finish draft" is not offered
  while following: the board finishes when the league's draft does.
  **An ESPN league's draft is never followed** (removed 2026-09-30, see DECISIONS.md): ESPN's
  league API publishes a draft's picks only once it is over, all at once (seen 2026-09-29), so
  there is nothing to sync while it runs. An ESPN league still sets the draft's scoring, size and
  roster through the import, and Draft Settings shows its switch greyed out with "Not available
  on ESPN". A board saved following an ESPN league before then (`draft.following`) opens drafted
  by hand, and the flag is left as it lies.
  A league is linked in one place only: the league import inside Draft Settings (`draft-setup/`).
- `shared-projection/` — the page behind a share link (`/s/:token`), public and unguarded: a
  share link has to open for someone who has never signed in. Its byline carries the author's
  profile picture, or the initial of their username where they have none. A signed-in visitor is offered
  "Draft Mode", which copies the snapshot into their own projections and opens the board; a
  signed-out one still gets the sign-up. Pressing either button again makes **another**
  copy: the name the board was shared under is taken by then, and db-service numbers the new
  one (`My league (2)`) rather than refusing. This page used to catch that 409 and answer
  "you already have a copy of this board", with links to go and find it, which left someone
  who had pressed a button on a board doing the navigating themselves. It renders the **snapshot** the
  owner published — the top rows with identity, rank and value frozen into them — so it needs
  no player read model and no ranking of its own. It renders the editor's own `player-row` and
  `projections-table-header` in a **read-only** mode, so a shared projection looks like the
  table it was published from — but it does **not** reuse the scoring: those values were
  computed against the owner's whole player pool, and recomputing them over the hundred
  published rows would quietly print different numbers than were shared. Sharing is the marketing loop, so both ends
  are measured (`projection_shared`, `shared_projection_viewed`).
  Crawlers never reach this component: `nginx.conf` routes link-preview user agents for `/s/*`
  to the BFF's per-share Open Graph document, since they run no JavaScript and would otherwise
  unfurl every shared projection as the site-wide preview. The BFF origin is substituted into
  `nginx.conf` at image build time from the same `API_URL` build arg as the bundle.
  The preview's image is the BFF's per-share card, proxied through this origin at
  `/s/:token/og-image.png` so the tags and the image they point at share a host. That
  location must stay above the static-asset location, which would otherwise claim any URL
  ending in `.png` and 404 it.
- `admin/premium/` — the Premium section of `/admin`: everyone who has Premium, and a form that
  gives an account a number of months of it for nothing. A given membership is stored apart from
  any subscription, so ending one here never touches what a paying member is billed, and only a
  given one offers the End button. The card styles are repeated in its own CSS because
  `admin.css` is scoped to the parent component.
- `admin/` — admin-only tools (`/admin`): the Yahoo service account, the player sync, and a
  **Yahoo access probe**. The probe asks Yahoo one question — will it serve this game's players? —
  for a game key and season you type in, and shows the status and Yahoo's own error wording. A
  failed sync only says that _something_ was refused; this is how you find out what. A refusal is
  a **result, not an error**: showing "could not reach the probe" over Yahoo's own 403 would waste
  the whole feature, so only a failure of our own call surfaces as an error.
- `home/` — where a signed-in user starts (`/home`): signing in and a signed-in visit to `/` land
  here. It shows the features side by side, each with its own way in (Projections, Draft mode,
  the AI projection, Who's Hot, and a share-link import under them), so nothing says which to
  start with; a returning user also gets the projection they updated last across the top. It
  began as a two-step checklist, which Alexander took out for telling everyone there was one
  right order. The AI card is drawn wherever the BFF serves the model, and sells it or offers it
  depending on the account's plan; its Create button opens `/projections/new?start=model` and its Draft link
  `/draft?start=model`, and both pages pick the AI preset once the BFF has said it serves it. `demoRedemptionGuard` sends anyone with landing-demo work
  waiting on to `/projections`, which is what saves it.
- `profile/` — the account's **profile picture** and **public name** (`/profile`, signed-in
  only), reached from the avatar at the right edge of the header, which opens the account menu
  (who is signed in, Profile, Sign out) at every width. Sharing forces the choice of a name, but
  it has to be changeable afterwards: a shared page credits the current one. `AccountService`
  caches the name in a signal, because the share dialog and this page both need to know whether
  one exists without re-fetching, and **follows the session**: an `effect` on
  `AuthService.isLoggedIn` loads the profile and the picture when a session starts and drops
  them when it ends, so the header can show them without every page asking. The picture is held
  as an object URL (`avatarUrl`), since the endpoint needs the bearer token an `<img>` cannot
  send. `AvatarImageService` crops and scales the picked file to a 256px square JPEG **in the
  browser** before upload, so a phone photo becomes a few tens of KB and the server never decodes
  an untrusted image; the header and the profile page both draw it with the table's
  `app-player-headshot`, whose initials fallback covers an account without a picture. The byline
  of a shared board draws the **author's** picture with the same component, from the public
  address the BFF sends as `authorAvatar` — nothing there is behind a bearer token, so no object
  URL — which is why the Profile page says the picture is shown when you share a projection.
- `premium/` and `shared/premium/` — the **Premium** subscription, sold through Stripe Checkout
  (see `BillingService`, `EntitlementService`). Checkout is Stripe's own page: Subscribe sends the
  browser to the URL the BFF returns, and nothing of Stripe's loads on our pages, so the price on
  `/premium` is the build's `PREMIUM_BASE_PRICE_USD`. The surfaces agree on what Premium _is_ through
  one list, `shared/premium/premium-perks.ts`, which follows the build flags so a build with the
  AI projection or Who's hot switched off cannot sell them; and on what it _looks like_ through
  one global class, `.premium-badge` in `styles.css` (a class rather than a component so it can
  sit inside a radio's label). `/premium` is the only page for any of it: Free and Premium side
  by side, the questions that otherwise arrive by mail after the first charge, and, in the place
  the Subscribe button sits for everyone else, a subscriber's status, their next charge or their
  last day, and the billing portal. It is also the welcome straight after checkout, with a link
  into each perk. There was a second page, `/account`, that carried the subscription half; it
  said what the cards already said, and a free account that reached it was told it had no
  subscription and sent to the pricing page anyway. `/pricing` and `/account` survive only as
  redirects here, built as a `RedirectFunction` so the query string comes with them: a checkout
  created before the move still returns to `/account?checkout=success`, and dropping that
  parameter would greet a new subscriber as a visitor. `EntitlementService` **follows the session** like `AccountService` (an
  `effect` on `isLoggedIn`), because sign-in is a router navigation and a load done once at
  bootstrap missed everyone who signed in during the session. The header sells Premium only to
  an account that has not bought it (`plan()` in `app.ts`, null until the entitlement has
  landed, so nothing is said of a subscriber a request too early). The account menu carries one
  Premium item for everyone, to that same page, and the landing nav links the price wherever
  payments are on, since a payment provider's review wants it reachable from the navigation.
- The **new-projection page's preview** is the other half of that: while the AI projection is
  locked, `projection-create` never asks for the model's lines (the BFF would refuse them, and
  the request would only draw the page's failure state) and fills the preview's slot with a
  pitch panel instead — what the model is and what it is worth, never a row of it. The slot is
  the same height either way, so picking a starting point does not drop the page.
  Both pages still handle a **403** from the server: the pages hold the locked request back
  themselves, so reaching one means a subscription lapsed mid-session or the entitlement read
  failed. `shared/premium/premium-refused.ts` is the one message for it, and it deliberately
  does not say "try again".
- `streamer-planner/` — the **Streamer Planner** page (`/streamer-planner`, signed in): every NHL team rated by its schedule over the
  nights ahead, and the best players a league has available for them. The nights are the page's
  one setting: presets (the rest of this week, next week, both) or two dates, held to today, the
  season and the BFF's 31-day cap (`planner-schedule.ts`: `presetStretch`, `clampStretch`;
  `PLANNER_TODAY` is the reader's own clock, so a night already played is never offered), then a
  strip of tick boxes, one a night, seven to a row so each row is a Monday-to-Sunday week (the days
  of the first week already behind are drawn faint). The league sits beside the nights.
  **The team schedules have one rating** for the whole page, the BFF's skater score and rank
  (`rateTeams`), with the Fav/Unfav tint read from the goals an opponent concedes; the BFF's
  goalie score and rank are sent but not read (Alexander's call, 2026-10-02). **The free agents
  are one list, skaters and goalies together** (Alexander's call, 2026-10-05, once the free agents
  had the page's full width): best first by the league's scoring, the skaters' categories as
  columns and the goalies' after them behind a rule, each row blank under the other kind's. From
  2026-10-01 to 2026-10-05 a segmented Skaters | Goalies control showed one kind at a time
  (`ofKind`, since removed). The first three rows of the list's first page are set off as the best picks
  (the rank as a gold, silver or bronze medal, nothing else: the table's `top` input); until 2026-10-05 they were
  three cards over the tables, repeating those rows. What
  concerns one table only sits on that table: the positions and the categories to rank by. The
  pills (All, C, LW, RW, D, G) narrow it to any number of positions at once, a player eligible at
  two is listed once, and the # column keeps his place in the whole list, so a list of goalies
  still says how they compare. The "Rank by" pills offer every category the league scores; picked,
  only the kinds that score in one of them are ranked (`scoresIn`), by those alone. Every heading
  sorts the whole list, in points and category leagues alike (`sortFreeAgents`, held by the page
  and applied before paging; best first by `defaultSortDirection`, a player the column says
  nothing about last either way, ties in ranked order); the score heading is the ranked order, and
  only in it are the first three set off. The list is paged and starts from the top when the
  positions, the categories or the order change. Until 2026-10-01 it
  copied LineupExperts: three, five or ten a position. No buttons: what the nights point at is what is on screen.
  `planner-schedule.ts` re-rates the teams over the nights ticked, by projection-service's own
  rule (a game is 1, or 1.25 on an off-night, scaled by the opponent), and uses the server's
  numbers untouched while every night is ticked; `planner-free-agents.ts` scales a free agent's
  line to the share of his club's games on those nights, filters by position and keeps two
  decimals on every stat for the ranking engine, whose default rounds a
  week's 0.4 goals to none. **The user's own team**: `GET /streamer-planner/my-team` gives his roster live, and `planner-lineup.ts` seats
  the players whose club plays each game day in the league's lineup slots (max matching over
  their positions, so a C/LW goes wherever leaves room); a night's `fits` is the positions that
  would fill one more seat. Each cell says who would still start ("D", "Any skater, G") or
  "Full", and while "Rank free agents by the game days … has room" is ticked (the default) a
  skater counts only the counted nights he fits (`roomFactor`) and the goalies' creases are split
  over the nights with a G seat. The nights only a drop makes room on (`fitsDrop`, `dropFactor`) are shown
  beside his GP as a yellow "+N" and never counted or scored, since each takes the dropped
  player's game. The free agents are ranked here, by the league's own scoring settings
  through `ProjectionRankingService`; the league is remembered on the device by
  `StreamerPlannerLeagueService` and picked in `league-field` (a Yahoo league reads at once, an
  ESPN id waits for Use). Clubs are drawn with `<app-team-logo>` (`shared/team-logo`): the NHL's
  own crest read from `assets.nhle.com`, an abbreviation badge where it fails; only a player on
  waivers gets a tag, since an add is what the list is a list of. Each free agent's line over the
  nights counted is drawn **in every category the league scores**, in the league's order
  (`lineStats`), as real table columns named once in the heading (`lineColumns`), after the
  score, GP and TOI; his positions sit under his name, not in a column. The columns are the
  skaters' categories over the skaters and the goalies' over the goalies, who have no TOI column.
  Picking categories to rank by re-ranks the skaters only: the goalies stay ranked by the league's
  whole set. More
  categories than the card is wide scroll sideways with the name held in place, and TOI is
  dropped by container query where the card is narrow. A
  category the BFF sent no number for is an empty cell, never written as the zero the ranking engine
  was handed (`FreeAgent.projected`).
- `player-scout/` — the **Player Scout** page (`/player-scout`, signed in, served only where the
  BFF's `playerScout` feature says so; `/fa-scout` and `/role-changes`, the two pages it
  replaced, redirect to it): every player in a league on the AI projection for the rest of the
  season, with how the projection has moved since a chosen day on a switch, and what the ice has
  shown in a view of its own. The league is picked with the planner's own field
  (`app-league-field`, `YahooLeaguePicker`) and opens on `LeagueChoiceService`'s league. **Two
  views** (`ScoutView`, switched like the planner's): *Projection* (score, games, ice time, the
  league's categories, and the gain against the chosen drop) and *On the ice* (measured ice a game, PP ice, PP share and the
  Daily Faceoff listing over each club's last 3/5/10 games, or since the comparison's day,
  against his games before; `scout-usage.ts`, the old Role Changes model; the BFF's
  `recentGames`). Both keep the rank, the player and the score to sort by. **The comparison is
  off by default**: a tick switches it on, against the preseason projection or the one of a day
  typed into the field (`since-picker/`; the caption says which day the BFF actually answered,
  since nothing is kept from before the history began). With it on, every figure wears its change
  underneath and the rank its places gained (`scout-ranking.ts`: `rankScout`; `delta`, `rise`,
  `isRising`), and Risers / Fallers appear. **Whose players, as Yahoo's player list asks it**: a
  Show select (Available / Free agents / Waivers / Taken / All, then each league team, the
  user's own first), a Club select, and a *Show my team* tick that adds the user's own players to
  any list; positions by pills, a search; 25 rows a page. The table (`scout-table/`) reuses the
  planner table's stylesheet and line helpers. **The user's own team is weighed night by night
  over the rest of the season** (`lineup-value.ts`: `valueLineup` seats the roster into the
  league's slots on every remaining night, best players first, so a player's *lineup cost* is
  what the team loses without him, which for a third centre behind two centre seats is nought
  whatever he projects). A player the reader marks as a streamer is a streaming spot, not a seat,
  filled from the free agents within the league's weekly add limit (`Streaming.weeklyAdds`, the
  BFF's `maxWeeklyAdds`): an add holds its free agent until the spot's next add, and with no limit
  known a spot takes a new one every night. **The drop is a page state, not a property of each row** (Alexander,
  2026-10-15, after an Impeccable critique found the old Swap column naming the same drop on
  nearly every row): with a full roster the room line offers the four cheapest holders of a
  roster spot as chips, the cheapest pressed (computed from the fetched roster, never assumed),
  and "Someone else" unfolds the roster where any holder can be picked; `priceDrop` then prices every
  available player in the filtered list against that one drop, so the "Gain if you drop
  <surname>" column sorts, and the three biggest gains wear the gold wash. A player who is out is
  kept off the chips, since his empty seat makes him cheapest by our reckoning; picked, he reads
  "0.0 while out". A pickup whose club has no night in the schedule reads "?", never a figure.
  With an open spot or an injured player to move to IR there are no chips and no column: the room
  line is the whole answer. The fold-out shows the four cheapest first with "Show all N", IR
  players under one line, and the one caption under the room line says what cost and gain are
  (a phone shows no tooltip). Under 38rem the gain rides as a line in the frozen player cell and
  the roster keeps Player, Starts and Lineup cost with the player pinned.
  `drop-candidates.ts` (`teamRoom`, `scoreTeam`) lives here too and Start/Bench reads it; the
  roster's types and `toScoutTeam` are in `services/player-scout.service.ts`.
- `start-bench/` — the **Start/Bench** page (`/start-bench`, signed in, served only where the BFF's
  `startBench` feature says so): the user's lineup for one day and the one the model would set,
  for the nights more of his players have a game than his lineup has spots. It opens on today's
  games (`PLANNER_TODAY`, the night as the NHL counts it) and steps a day at a time, or jumps by a
  date picker, from today to 30 days ahead. `GET /start-bench/my-team?date=` gives the roster **as
  the platform has it set for that day** (a day ahead shows what the manager set for it), each
  player with the model's line for that day alone, and `/streamer-planner/teams` that day's
  games. `start-bench-lineup.ts` (`startBenchDay`) seats the players whose club plays and who are
  not out, best first by the line scored with the league's settings through
  `ProjectionRankingService` (z-scores from an empty night in a category league), with a free
  seat taken before anyone is moved (`assignSeats`) so the better player keeps his own slot; a
  player level on the model keeps the seat he already has. The table lists the lineup as it
  stands (slot by slot, then bench, then IR) with each player's game, projection and suggested
  slot, and marks **Start** / **Bench** where the suggestion differs; a starter with no game or
  out is never told to sit, since he gives nothing either way. A points league also gets the
  projected points the moves gain. Nothing is written to the platform. A player the platform has
  cleared but still parks on IR plays tonight when the model expects him to (`playsTonight`: a
  skater dressing at 50% or more, a goalie with any share of the crease), tagged "Expected back";
  a player the platform still names an injury for (O, IR, DTD, ...) never does, whatever the model
  says (Alexander, 2026-10-15: activate only on certainty); one the
  suggestion starts from IR is **activated**, and `makeRoom` finds him a roster spot the cheapest
  way: an open spot, an injured player moved into the reserve slot he leaves, else a drop — the
  player the team loses least by over the rest of the season as Player Scout ranks it (`scoreTeam` over
  `GET /start-bench/rest-of-season`), among those not starting tonight (Alexander, 2026-10-13). A goalie's row reads "Confirmed starter" or "Likely starter" where Daily Faceoff's starting
  goalies page names him (`PlannerOwnLine.nights[].starter`, projection-service #282), else his
  chance to start. The league is picked with
  the planner's `app-league-field`, as Player Scout does.
- `services/` — app services (auth, projections, etc.)
- `interceptors/` — HTTP interceptors: `authInterceptor` attaches the JWT and refreshes
  once on 401 (all environments). **Only a 401/403 from `/auth/refresh` itself ends the
  session**: a status 0 or 5xx on the refresh keeps both tokens and fails the original call
  into its own error state, since it says nothing about the refresh token. Parallel 401s share
  one in-flight refresh (`AuthService.refresh()`). `retryInterceptor` (outermost) is a small **always-on**
  safety net: it retries transient gateway/connection errors (status 0/502/503/504) just
  twice with a short backoff (~250ms, 500ms) to absorb a momentary blip. It deliberately
  does **not** try to ride out a full service restart — that's the job of zero-downtime
  deploys, not a long client-side wait. `timeoutInterceptor` sits inside it and bounds every
  attempt (20 s for a read, 60 s for a write), because a server that accepts the connection and
  never answers raises no error: staging's BFF deadlocked on 2026-09-11 and pages sat on their
  spinner for minutes. A timeout fails as `RequestTimeoutError` and is not retried.
- `models/`, `pipes/`, `shared/` (e.g. `loading-indicator`)
  - `shared/row-window` — `rowWindow(list, body)` draws only the rows of a long, page-scrolled
    table that are near the screen, with a spacer `<tbody>` above and below standing in for the
    rest. Used by the shared page, whose "Show all" is ~1600 rows: a table is laid out whole, so
    drawing them all held the page 1.5 s on a laptop and ~9 s on a phone-speed CPU, and adding them
    in batches was worse (every batch re-lays out the whole table). Header cells keep the widest
    they have been as a `min-width`, so columns don't jump as names of other lengths scroll by.
    Browser find (Ctrl+F) only sees drawn rows; the page's own search covers the rest.
  - `shared/pinned-table-header` — holds a wide table's `<thead>` against the top of the window
    while the page scrolls past it. The projections table runs down the page rather than inside a
    viewport-tall scrollbox, but its wrapper stays a horizontal scroll container for the stat
    columns — and `overflow-x: auto` makes that wrapper the scrollport on both axes, so a sticky
    `thead` has nothing to stick to. The row group is translated instead — by a scroll-driven CSS
    animation (`styles.css`), so the browser runs the pin off the main thread and the header keeps
    up with a fast flick rather than trailing the rows and catching up at rest. The directive only
    measures what the timeline can't work out for itself — how far the header may travel — and
    keeps the old per-frame scroll handler for browsers without scroll timelines. **Where the pin
    begins is named, not measured**: the range is anchored to `exit-crossing`, the table's own top
    edge crossing the top of the window. It was once a measured window height, and every way that
    height could change without the measurement being redone (a zoom step, a phone collapsing its
    toolbars) parked the header that many pixels down the table for the rest of the scroll.
    A page that floats a bar over its top (the landing nav) sets `--pinned-header-inset` to that
    bar's height; it is registered with `@property` in `styles.css` as a `<length>`, because the
    fallback path reads the value back and an unregistered custom property returns raw tokens.
    **iOS takes neither path.** There the page is scrolled by a thread the page's code never
    runs on, and nothing we can hand that thread describes this pin: sticky cannot reach past
    the horizontal scroll container, and WebKit resolves a scroll-driven animation on the main
    thread (`canBeAccelerated()` refuses progress-based timelines without threaded animations,
    and the build that had them still showed it). Whatever moves the header during a flick trails
    the rows by however far the scroll got ahead — the header part-way down the table that was
    reported — so on iOS (`-webkit-touch-callout`, which every iOS browser has and nothing else
    does) the directive follows the page only while it moves slowly enough to be followed (under
    `FLICK_PX_PER_EVENT` between scroll events — a dragging finger), hides the header the moment
    it moves faster than that, and places it, with a fade, once the page has been still for
    `SCROLL_SETTLE_MS`. A frame late on a hide is invisible; a frame late on a position is a
    row out.
    **The `<thead>` stays `position: sticky` even though it pins nothing** (its scrollport never
    scrolls vertically): the rank and name cells inside it are sticky too — the frozen columns —
    and iOS places every sticky box from its scrolling thread. With the group itself sticky they
    are placed within it and ride along with its translation; made merely `relative` (#530) they
    were placed at the group's untransformed spot at the top of the table, and the pinned header
    came back with nothing where the rank and the name belong. The group is not promoted with
    `will-change` either (#531): it buys nothing where the animation is composited anyway, and it
    was in the mix when the cells went missing.
- `environments/` — `environment.ts` (dev: `apiUrl: http://localhost:8080/api/v1`),
  `environment.staging.ts` (points at the staging BFF `api.staging.slapstat.com`; used by
  `npm run start:staging` via the `staging` build/serve configs in `angular.json`),
  and `environment.prod.ts` (API URL injected at build time via the `API_URL` build arg —
  see `Dockerfile`). `start:staging` lets you run the web locally against staging without
  booting the backend services — it requires the staging BFF to allow
  `http://localhost:4200` as a CORS origin (in staging-bff's `CORS_ALLOWED_ORIGINS` and in the
  Traefik `api-cors` labels on its router; see `DEPLOYMENT.md`).

## Error handling

**Assume every call to the BFF can fail** — the BFF may be down, the network may drop, a
request may time out. Never let a failed call fail silently; always surface it to the user.
When you add or change a BFF call, handle its failure path with one of these patterns:

- **Transient blips** are already absorbed by `retryInterceptor` (retries status
  0/502/503/504 twice). Don't add your own retry loops on top.
- **Page / data loads** (an `rxResource`, or a load in `ngOnInit`): render the shared
  `app-error-state` component (`shared/error-state`) with a message and a **Try again**
  button that reloads the resource — see `projection-list` / `projection-create`. Pass the
  failure itself as `[error]`: a failure on our side (a 5xx, a timeout, or status 0 while the
  browser is online) then says so instead of asking the reader to check their connection.
- **Discrete user actions** (delete, create, open, connect): show a transient toast via
  `NotificationService.error(...)` (rendered by `app-toast` at the app root), and reset any
  `isLoading` / `isCreating` flag in the same error callback.
- **Autosave** (stat-weight edits, draft picks): flip the inline save status to `'error'`
  ("Couldn't save — changes are unsaved") instead of a toast, so repeated autosaves don't
  spam notifications.
- **Auth forms** (login / register / …): keep the inline `errorMessage`, and derive it with
  `messageForError(error, causeMessage)` from `shared/http-error` so a server-down
  (status 0 / 5xx) shows "can't reach the server" rather than a misleading
  "invalid credentials".

Every `.subscribe({…})` / `firstValueFrom(…)` / `rxResource` that reaches the BFF must have
an error path ending in one of the above. A bare `error: () => {}` is acceptable only with a
comment explaining why that particular failure genuinely isn't worth surfacing.

## Analytics (PostHog)

Usage analytics goes through `services/analytics.service.ts` — **nothing else may import
`posthog-js`**. It's off unless `environment.posthogKey` is set (same pattern as an empty
`googleClientId` hiding the Google button), so local dev and tests never fetch the library or
send anything.

Three constraints that aren't obvious from the code:

- **Never send the email as the analytics identifier.** Use the account UUID from the JWT's
  `sub` claim (`AuthService.getUserId()`). The `email` claim sits in the same token payload,
  so it's an easy mistake, and it would stamp PII onto every event row.
- **URLs are redacted before send.** `/reset-password?token=…` and `/verify-email?token=…`
  carry live single-use tokens, and PostHog stamps the full URL onto `$current_url`. The
  `before_send` hook strips them. If you add a route with a sensitive query param, add it to
  `REDACTED_QUERY_PARAMS` — and keep the redaction general rather than allowlisting routes.
- **`posthog-js` is imported dynamically, deliberately.** It's ~230 kB; a static import puts
  the initial bundle within a few kB of the 1 MB budget error in `angular.json`.

Autocapture and session replay are off. Turning either on is a deliberate step with its own
privacy review (replay would otherwise record sign-up forms), not a default.

## Error reporting (Sentry)

Browser faults go through `services/error-reporting.service.ts` — **nothing else may import
`@sentry/browser`**. It's off unless `environment.sentryDsn` is set (same pattern as an empty
`posthogKey`), so local dev, CI and tests never fetch the SDK or send anything.

It exists because a user lost a saved projection on 2026-08-13 and the only reason anyone found
out was an emailed photograph of their screen a day later. The four backend services had reported
to Sentry for months; the browser reported nowhere.

- **Uncaught errors and unhandled rejections** reach it via `ReportingErrorHandler`, which
  reports and then delegates to Angular's default handler so the console still gets them.
  `provideBrowserGlobalErrorListeners()` is what routes rejections there.
- **One error is deliberately not reported**: a stale-build chunk failure the router is already
  reloading for (`isRecoveringFromStaleBuild` in `shared/navigation-error.ts`). The router calls
  the navigation error handler and _then_ rethrows, so the same failure arrives twice — and it
  was raising a Sentry alert on every deploy for something the user never saw. It still reaches
  the console, and a build that is broken rather than stale still reports, through the
  notification the navigation handler shows when reloading did not help.
- **Handled failures report too.** `NotificationService.error(...)` is the single funnel for a
  discrete user action that failed, so it reports as well as renders — telling the user and
  telling ourselves are the same event.
- **Never send the email as the identifier.** Use the account UUID from the JWT's `sub` claim
  (`AuthService.getUserId()`), exactly as with analytics.
- **URLs are redacted before send**, sharing `shared/redact-url.ts` with analytics. Add a new
  sensitive query param to `REDACTED_QUERY_PARAMS` there and both paths are covered.
- **`@sentry/browser` is imported dynamically**, deliberately — a static import puts the initial
  bundle near the 1 MB budget error in `angular.json`.
- **The DSN is not a secret** (it only permits sending events), but it is per-environment: it
  arrives via the `SENTRY_DSN` build arg, and `environmentName` becomes Sentry's `environment` so
  one project separates staging from production the same way the Java services do.
- **The CSP has to allow the ingest host.** `connect-src` in `nginx.conf` lists
  `https://*.ingest.de.sentry.io`; without it every report is blocked in the browser and the
  feature is silently dead in production.

Performance tracing is off (`tracesSampleRate: 0`) for the same reason the backends keep alerting
narrow: a stream of spans would bury the faults this exists to surface.

## Copy

**No explanatory text by default.** Add no tooltip, subtitle, helper line, intro or empty-state
explanation unless the page cannot be used without it. Alexander asks for text when he wants it;
every unasked one has been rewritten or deleted by hand.

- A label that needs a tooltip is the wrong label: rename it, don't explain it.
- Never explain what the user can see, or restate a feature's benefit.
- What text there is: a tooltip at most 60 characters and one sentence; any visible text block
  at most 120. `check:copy` fails a PR over either (`COPY-RULES.md`, *Length*).

## Conventions

@.aiassistant/rules/guidelines.md

- Never hand-edit `src/app/api/**` — it's generated.
- Run `npm run format` before committing; `format:check` is enforced in CI.
- Keep API calls going through the generated client + a service wrapper, not raw
  `HttpClient` in components.

### Icons

**Every icon comes from `<app-icon name="…" />`** (`src/app/shared/icon/`), which draws it from
the Lucide set through `@ng-icons/lucide`. Never write an `<svg>` into a template, and never type a
character where an icon belongs (an arrow such as `←` or `▼`, a check `✓`, a pencil `✎`), whether
in a template, in a string a component returns, or in a CSS `content`.
`.github/scripts/check-inline-icons.sh` fails the build on either, and it runs in `pr-checks.yml`.

One spec for every icon, Lucide's: a 24x24 grid, no fill, `currentColor`, stroke width 2, round
caps and joins, `aria-hidden`. Only the size is settable per call site, and only to a step on the
scale: 14 inline with text (a back link, a sort arrow, a checkbox tick), 16 on a button or in a
menu (the default, so leave it out), 20 standalone (a dialog close, a card's icon box), 48 for an
empty or error state. An `em` length is for an icon that has to scale with its text, like
`size="0.85em"` in a Premium badge. The `IconSize` type holds the scale, so any other size fails
the build. Colour comes from the surrounding text, so an icon follows hover, disabled and danger
states without being told.

Adding one: import the Lucide export in `icon.ts` and give it a line in `ICONS`, named for what
the icon is for rather than what it looks like (`close`, not `x`). Look on lucide.dev first:
almost every UI concept is already there. The spec walks the whole set, so a name that draws
nothing, or two names that draw the same thing, fails.

**Never draw an icon by hand.** If nothing in Lucide fits, don't draw one: write a prompt
Alexander can give an image generator, and say that what comes back still has to become a 24x24
stroke drawing before it can join the set.

**Brand marks are not icons.** Yahoo, Google and Facebook are multi-colour logos at their
owners' scales; they stay inline, in the allowlist at the top of the guard script.

Why the guard exists: the app once held 61 hand-drawn inline SVGs with six stroke widths and three
icon families mixed, refresh and the check each drawn three ways, and a dozen typed characters
standing in for icons on the same rows as real ones. None of it broke anything, which is why it
accumulated for a year.

### Mobile / responsive layout

Mobile users aren't our top priority, but they must still get an **at least
acceptable** experience. For **every UI change, double-check it holds up on a narrow
(phone) viewport** — never ship something that only works on desktop.

- Sanity-check around **375px**; the app's responsive breakpoint is `max-width: 640px`
  (media queries live in `styles.css` and the component CSS).
- Quickest check: `npm run start:staging`, then screenshot the affected page at a
  375px viewport (a throwaway Playwright script works well).
- Common breakers: wide tables (the projections table especially — the sticky
  rank/player columns must stay compact so the stat columns stay scroll-visible,
  see #161), fixed widths, and horizontal overflow.

## End-to-end tests (Playwright)

`e2e/` holds Playwright E2E tests that drive a real browser against the **deployed
staging** app (`https://staging.slapstat.com`), not a local build. `e2e.yml` runs them
**daily** at 06:00 UTC and on manual dispatch (`gh workflow run e2e.yml`). It used to run
on every merge to `master` too; that was traded away because each run installs a
Chromium and waits out the redeploy, and merges land several times a day. So a merge that
touches a page the suite walks (`/draft`, `/projections/new`, the editor, the board) is
**not** checked until the next morning unless someone dispatches the run.

They are deliberately **not** a PR gate. The suite drives _deployed_ staging, so a PR's
own changes aren't there to test — gating on it would judge a PR by unrelated code and
deadlock the PR that fixes a red suite.

**A failing run opens a GitHub issue** (label `e2e-red`), comments on it while it stays
open, and closes it once the suite is green again — an alarm nobody stands down stops being
one. That exists because the suite once reproduced a data-loss bug nightly for five days
and the only trace was a red cross nobody read.

- Run locally: `npx playwright install chromium` (once), then `npm run e2e`.
- The signed-in tests use a throwaway staging account: the signed-in test reads
  `E2E_EMAIL` / `E2E_PASSWORD` (env locally, repo secrets in CI) and skips without
  them; the happy-path registers a fresh account per run. See `e2e/README.md`.
- `e2e/` lives outside `src/`, so lint / format:check / unit tests don't touch it.

**Policy:** keep and grow the E2E suite as long as it stays cheap to maintain —
prefer stable role/id selectors, keep tests independent, and retire a test that
turns slow or flaky rather than letting it rot. E2E complements the unit tests, it
doesn't replace them.

## CI / workflow

- `.github/workflows/pr-checks.yml`: Node 22, generates the API client then runs every check
  listed under [Common commands](#common-commands) on PRs to `master`, and on each merge-queue
  group (`merge_group`): master plus every PR queued ahead plus this one.
- **`master` takes PRs through GitHub's merge queue** (since 2026-10-12, when the repo moved to
  the `slapstat` organization). A PR no longer has to be up to date with `master`: once its
  checks are green, auto-merge (or *Merge when ready*) puts it in the queue, which tests it on
  top of everything ahead of it and squash-merges it. Never `gh pr update-branch` it for the
  merge's sake.
- **Copy is checked, not merely guided.** `npm run check:copy` reads `COPY-RULES.md` and fails
  on a new terminology, vocabulary, punctuation or length violation, ratcheted against
  `.github/copy-baseline.json`. It settles only what a script can settle: naming the same thing
  the same way, the banned phrases, the em dash, and the length caps. Whether a text should exist
  at all is [Copy](#copy) below; tone and rhythm are the `slapstat-copy` skill's job.
- A **spec drift check** runs first: it fetches `fantasy-bff`'s `specs/bff-openapi.yaml`
  from `master` and fails if the pinned `specs/bff-openapi.yaml` differs. Needs a repo
  secret `SPEC_READ_TOKEN` — a fine-grained PAT with read access to `fantasy-bff`.
- `specs/bff-openapi.yaml` is a **verbatim pinned copy** of the BFF's spec. To update
  after a BFF API change: copy the new `fantasy-bff/specs/bff-openapi.yaml` over it and
  run `npm run generate:api`.

## Monorepo conventions

The full set lives in the monorepo root `CLAUDE.md`: input validation at every boundary,
secrets only from env, one worktree per agent, and the merge procedure. In short — the web
talks only to the BFF. Branch → push → PR → checks pass → merge queue → **squash merge** to
`master` (the PR title becomes the commit message, and the queue takes no `--subject`, so make
the title a proper `feat:`/`fix:` message). No attribution trailers. Never queue a PR titled
"wip"/"draft".

Two that land differently on this side: the web's form validation (`maxLength` on the auth
fields, mirroring the BFF's `@Size` caps) is a **UX convenience, not a security boundary** —
the BFF re-validates regardless; and environment-specific values arrive as **build-time**
args (`API_URL`, `GOOGLE_CLIENT_ID`, `SENTRY_DSN` → `environment.prod.ts`), never hardcoded
in committed config.

## Deployment

- Deployed via **Coolify** (Hetzner) using the multi-stage `Dockerfile`: a Node build
  stage produces `dist/fantasy-web/browser`, served by nginx (see `nginx.conf`). The public pages
  (`/`, `/premium`, `/terms`, `/privacy`) are prerendered at build time into their own
  `index.html` (`src/app/app.routes.server.ts`, `app.config.server.ts`), so a client that runs no
  JavaScript reads their content; every other route falls back to the unrendered shell
  `index.csr.html`. Code that runs while those pages render must not touch browser globals
  (`localStorage`, `window`) without `isPlatformBrowser`, and prerendering makes no API call but
  `/api/v1/features`. `check-prerendered-pages.sh` fails CI if a page renders empty. Every build arg in `DEPLOYMENT.md`'s table is injected into
  `environment.prod.ts` at build time (`API_URL` also into `nginx.conf`); CI holds the table to
  the Dockerfile's ARGs. production = `slapstat.com` (`api.slapstat.com`), staging =
  `staging.slapstat.com` (`api.staging.slapstat.com`).
- A merge to `master` deploys **staging** (`tag-on-merge.yml` tags it and stamps `APP_VERSION`);
  **publishing the draft release** deploys production (`promote-to-prod.yml`). See `DEPLOYMENT.md`.
