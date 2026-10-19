import { RedirectFunction, Router, Routes } from '@angular/router';
import { inject } from '@angular/core';
import { landingRedirectGuard } from './guards/landing-redirect.guard';
import { environment } from '../environments/environment';
import { adminGuard } from './guards/admin.guard';
import { authGuard } from './guards/auth.guard';
import { whosHotEnabledGuard } from './guards/whos-hot-enabled.guard';
import { draftAnalysisEnabledGuard } from './guards/draft-analysis-enabled.guard';
import { startBenchEnabledGuard } from './guards/start-bench-enabled.guard';
import { playerScoutEnabledGuard } from './guards/player-scout-enabled.guard';
import { roleChangesEnabledGuard } from './guards/role-changes-enabled.guard';
import { demoRedemptionGuard } from './guards/demo-redemption.guard';
import { DESCRIPTION, INDEXABLE } from './shared/crawl-tags';

/**
 * The old payment addresses, /pricing and /account, both land on /premium with whatever they were
 * carrying. Built rather than written as a plain string because the query string has to come with
 * it explicitly: ?checkout=success is what tells the page it is the welcome after a payment, and a
 * redirect that dropped it would greet a new subscriber as a visitor.
 */
const toPremium: RedirectFunction = (route) =>
  inject(Router).createUrlTree(['/premium'], { queryParams: route.queryParams });

const toRefundTerms: RedirectFunction = () =>
  inject(Router).createUrlTree(['/terms'], { fragment: 'refunds' });

/**
 * Every route is loaded on demand. Statically importing the components put each feature —
 * the projections table, the draft board, Who's hot, the shared page — into the initial
 * bundle, which was closing in on the 1 MB `maximumError` budget in `angular.json`. The
 * guards stay eagerly imported: they are tiny and have to run before the chunk is fetched.
 *
 * `data: { [INDEXABLE]: true }` is what lets search engines list a page; every route without it
 * is marked noindex (see shared/crawl-tags.ts), and public/sitemap.xml has to list exactly the
 * ones with it. An indexable page other than the home page also needs a `title` and a
 * `data: { [DESCRIPTION]: … }` of its own and a prerender in app.routes.server.ts: Google folds a
 * page that answers with the home page's title into the home page (crawl-rules.spec.ts checks).
 */
export const routes: Routes = [
  {
    path: '',
    // The rewritten landing page (The Lineup Card) sits behind NEW_LANDING_ENABLED so an
    // environment can switch it off; off, the page as it shipped before the rewrite is served.
    loadComponent: () =>
      environment.newLandingEnabled
        ? import('./landing/landing').then((m) => m.LandingComponent)
        : import('./landing/classic-landing/classic-landing').then(
            (m) => m.ClassicLandingComponent,
          ),
    canActivate: [landingRedirectGuard],
    data: { [INDEXABLE]: true },
  },
  // Where a signed-in user starts. Signing in and a signed-in visit to / both land here.
  {
    path: 'home',
    loadComponent: () => import('./home/home').then((m) => m.HomeComponent),
    canActivate: [authGuard, demoRedemptionGuard],
  },
  // Picking a draft source needs the user's own projections, so there is nothing to render
  // for a signed-out visitor — send them to sign in rather than to a failed load.
  {
    path: 'draft',
    loadComponent: () => import('./draft-start/draft-start').then((m) => m.DraftStartComponent),
    canActivate: [authGuard],
  },
  // A draft being set up, before anything is saved for it: the row is created when the setup is
  // confirmed and the page then moves to `drafts/:id`. Two ways in, because a draft against a
  // preset is seeded by the server and one against a board is copied from that board.
  {
    path: 'draft/new/preset/:preset',
    loadComponent: () => import('./draft-mode/draft-mode').then((m) => m.DraftModeComponent),
    canActivate: [authGuard],
  },
  {
    path: 'draft/new/board/:board',
    loadComponent: () => import('./draft-mode/draft-mode').then((m) => m.DraftModeComponent),
    canActivate: [authGuard],
  },
  // A draft, which is a board of its own rather than something hanging off the projection it is
  // played against — so it has an address of its own.
  {
    path: 'drafts/:id',
    loadComponent: () => import('./draft-mode/draft-mode').then((m) => m.DraftModeComponent),
    canActivate: [authGuard],
  },
  // A draft's summary had an address of its own until the power rankings took its place; a link
  // saved to it opens the draft instead of the not-found page.
  {
    path: 'drafts/:id/summary',
    redirectTo: 'drafts/:id',
  },
  // A league drafted somewhere else, read rather than played: nothing is saved for it, so it has
  // no id of its own and a reload reads the league again.
  {
    path: 'team-power-rankings',
    loadComponent: () =>
      import('./team-power-rankings/team-power-rankings').then((m) => m.TeamPowerRankingsComponent),
    canActivate: [authGuard],
  },
  // A league's draft graded pick by pick. Served only where the BFF's DRAFT_ANALYSIS_ENABLED says so.
  {
    path: 'draft-analysis',
    loadComponent: () =>
      import('./draft-analysis/draft-analysis').then((m) => m.DraftAnalysisComponent),
    canActivate: [authGuard, draftAnalysisEnabledGuard],
  },
  {
    path: 'projections',
    loadComponent: () =>
      import('./projection-list/projection-list').then((m) => m.ProjectionListComponent),
    canActivate: [authGuard],
  },
  {
    path: 'projections/new',
    loadComponent: () =>
      import('./projection-create/projection-create').then((m) => m.ProjectionCreateComponent),
    canActivate: [authGuard],
  },
  // Where a board's one draft used to live. A board holds no draft any more, so an old link
  // opens the setup for a new draft against it — which saves nothing until it is confirmed.
  {
    path: 'projections/:board/draft',
    redirectTo: 'draft/new/board/:board',
    pathMatch: 'full',
  },
  {
    path: 'projections/:id',
    loadComponent: () =>
      import('./draft-projection/draft-projection').then((m) => m.DraftProjectionComponent),
    canActivate: [authGuard],
  },
  // Public and unguarded on purpose: a share link has to open for someone who has never signed
  // in — that is the whole point of it. nginx serves crawlers an Open Graph document for this
  // path instead, so a posted link unfurls as the projection rather than the site.
  {
    path: 's/:token',
    loadComponent: () =>
      import('./shared-projection/shared-projection').then((m) => m.SharedProjectionComponent),
  },
  // Off with WHOS_HOT_ENABLED=false, which drops the nav links and bounces a direct hit home,
  // so the page can be pulled from an environment without pulling it from the build.
  //
  // The splits behind the leaderboard are a signed-in endpoint, so without this a signed-out
  // visitor who typed the URL or kept a bookmark got the page's "couldn't load — check your
  // connection" state over a 401, which blames the network for a sign-in. The nav only offers
  // the link to a signed-in user, so this catches the direct hit rather than a visible link.
  {
    path: 'whos-hot',
    loadComponent: () => import('./whos-hot/whos-hot').then((m) => m.WhosHotComponent),
    canActivate: [whosHotEnabledGuard, authGuard],
  },
  // Signed in, like Who's Hot.
  {
    path: 'streamer-planner',
    loadComponent: () =>
      import('./streamer-planner/streamer-planner').then((m) => m.StreamerPlannerComponent),
    canActivate: [authGuard],
  },
  // Served only where the BFF's PLAYER_SCOUT_ENABLED says so, and signed in like the planner.
  {
    path: 'player-scout',
    loadComponent: () => import('./player-scout/player-scout').then((m) => m.PlayerScoutComponent),
    canActivate: [authGuard, playerScoutEnabledGuard],
  },
  // The page Player Scout replaced: a bookmark or a link to it lands on it.
  { path: 'fa-scout', redirectTo: 'player-scout', pathMatch: 'full' },
  // Served only where the BFF's ROLE_CHANGES_ENABLED says so, and signed in like Who's Hot.
  {
    path: 'role-changes',
    loadComponent: () => import('./role-changes/role-changes').then((m) => m.RoleChangesComponent),
    canActivate: [authGuard, roleChangesEnabledGuard],
  },
  // Served only where the BFF's START_BENCH_ENABLED says so, and signed in like the planner.
  {
    path: 'start-bench',
    loadComponent: () => import('./start-bench/start-bench').then((m) => m.StartBenchComponent),
    canActivate: [authGuard, startBenchEnabledGuard],
  },
  {
    path: 'admin',
    loadComponent: () => import('./admin/admin').then((m) => m.AdminComponent),
    canActivate: [adminGuard],
  },
  // Public and unguarded on purpose: consent has to be informed, so the policy must be
  // reachable from the banner before anyone has agreed to anything.
  {
    path: 'privacy',
    loadComponent: () => import('./privacy/privacy').then((m) => m.PrivacyComponent),
    title: 'Privacy policy - SlapStat',
    data: {
      [INDEXABLE]: true,
      [DESCRIPTION]:
        'What SlapStat collects, why, who it is shared with, how long it is kept, and the rights you have over it.',
    },
  },
  // Public and unguarded like /privacy, and deliberately not behind the payments flag: a payment
  // provider's review reads the terms from a signed-out browser before the feature is ever switched
  // on, and a customer deciding whether to pay has to be able to read them before they do.
  {
    path: 'terms',
    loadComponent: () => import('./terms/terms').then((m) => m.TermsComponent),
    title: 'Terms and conditions - SlapStat',
    data: {
      [INDEXABLE]: true,
      [DESCRIPTION]:
        'The terms for using SlapStat and paying for Premium, including when a charge is refunded.',
    },
  },
  // The refund policy was a page of its own and is now a section of the terms. The address stays,
  // for links already out there; nginx answers it with a 301 too, for readers that run no scripts.
  {
    path: 'refunds',
    pathMatch: 'full',
    redirectTo: toRefundTerms,
  },
  // One page for the plans and for the subscription on them, so /pricing and /account are kept
  // only as the way here: a checkout that already redirected there, a bookmark, a link posted
  // somewhere we cannot edit. The redirect carries the query string, since ?checkout=success is
  // what tells the page it is the welcome.
  {
    path: 'premium',
    loadComponent: () => import('./premium/premium').then((m) => m.PremiumComponent),
  },
  {
    path: 'pricing',
    pathMatch: 'full',
    redirectTo: toPremium,
  },
  {
    path: 'account',
    pathMatch: 'full',
    redirectTo: toPremium,
  },
  {
    path: 'feedback',
    loadComponent: () => import('./feedback/feedback').then((m) => m.FeedbackComponent),
    canActivate: [authGuard],
  },
  {
    path: 'profile',
    loadComponent: () => import('./profile/profile').then((m) => m.ProfileComponent),
    canActivate: [authGuard],
  },
  // Not indexable: a sign-in form has nothing to find in search, and while it was indexed Google
  // folded it into the home page as a duplicate.
  {
    path: 'login',
    loadComponent: () => import('./auth/login/login').then((m) => m.LoginComponent),
  },
  {
    path: 'register',
    loadComponent: () => import('./auth/register/register').then((m) => m.RegisterComponent),
    title: 'Create account - SlapStat',
    data: {
      [INDEXABLE]: true,
      [DESCRIPTION]:
        "Create a free SlapStat account to build fantasy hockey player rankings from your league's scoring settings and take them into your draft.",
    },
  },
  {
    path: 'auth/google/callback',
    loadComponent: () =>
      import('./auth/google-callback/google-callback').then((m) => m.GoogleCallbackComponent),
  },
  {
    path: 'forgot-password',
    loadComponent: () =>
      import('./auth/forgot-password/forgot-password').then((m) => m.ForgotPasswordComponent),
  },
  {
    path: 'reset-password',
    loadComponent: () =>
      import('./auth/reset-password/reset-password').then((m) => m.ResetPasswordComponent),
  },
  {
    path: 'verify-email',
    loadComponent: () =>
      import('./auth/verify-email/verify-email').then((m) => m.VerifyEmailComponent),
  },
  // Last, and matching everything left. Without it the router threw NG04002 on any address
  // the app does not have — a mistyped URL, a link to a page that has since been renamed, a
  // crawler guessing — which reported to Sentry as an application error and left the visitor
  // with the header above nothing at all.
  {
    path: '**',
    loadComponent: () => import('./not-found/not-found').then((m) => m.NotFoundComponent),
  },
];
