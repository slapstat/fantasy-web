import { describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideRouter, RedirectFunction, Route, UrlTree } from '@angular/router';
import { routes } from './app.routes';
import { authGuard } from './guards/auth.guard';
import { whosHotEnabledGuard } from './guards/whos-hot-enabled.guard';
import { demoRedemptionGuard } from './guards/demo-redemption.guard';
import { playerScoutEnabledGuard } from './guards/player-scout-enabled.guard';
import { roleChangesEnabledGuard } from './guards/role-changes-enabled.guard';

describe('routes', () => {
  const routeFor = (path: string): Route => routes.find((route) => route.path === path)!;

  it('keeps the leaderboard behind a sign-in, since its splits are a signed-in endpoint', () => {
    // Unguarded, a signed-out visitor with the URL reached the page and was told the
    // leaderboard "couldn't load — check your connection" over what was really a 401.
    expect(routeFor('whos-hot').canActivate).toEqual([whosHotEnabledGuard, authGuard]);
  });

  it('lets demo work be saved before home is shown', () => {
    // The projections list is what saves a board carried over from the landing demo; home must
    // hand such a user over to it rather than leave the work waiting in session storage.
    expect(routeFor('home').canActivate).toEqual([authGuard, demoRedemptionGuard]);
  });

  it('leaves the pages that have to open for a stranger unguarded', () => {
    // A share link is the whole point of sharing, and consent has to be informed before
    // anyone has agreed to anything — neither may bounce a visitor to the login page.
    expect(routeFor('s/:token').canActivate).toBeUndefined();
    expect(routeFor('privacy').canActivate).toBeUndefined();
    // A payment provider reviews the terms, refund policy included, from a signed-out browser, and
    // a customer has to be able to read them before paying.
    expect(routeFor('terms').canActivate).toBeUndefined();
  });

  it('sends the old refund policy address to that section of the terms', () => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    const redirect = routeFor('refunds').redirectTo as RedirectFunction;

    const target = TestBed.runInInjectionContext(() =>
      redirect({ queryParams: {} } as unknown as Parameters<RedirectFunction>[0]),
    );

    expect((target as UrlTree).toString()).toEqual('/terms#refunds');
  });

  /**
   * The plans and the subscription on them are one page now, and a finished checkout returns to
   * whatever URL it was given when it was created, which for anything already in flight is the
   * old one. So /pricing and /account still have to arrive
   * here, and arrive carrying ?checkout=success: without it the page greets a new subscriber
   * as a visitor and offers them a second checkout.
   */
  it('keeps the old payment addresses pointed here, query string and all', () => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });

    for (const path of ['pricing', 'account']) {
      const route = routeFor(path);
      expect(route.pathMatch).toEqual('full');
      const redirect = route.redirectTo as RedirectFunction;
      const target = TestBed.runInInjectionContext(() =>
        redirect({
          queryParams: { checkout: 'success' },
        } as unknown as Parameters<RedirectFunction>[0]),
      );

      expect((target as UrlTree).toString()).toEqual('/premium?checkout=success');
    }
  });

  it('serves Player Scout signed in and only where the BFF switches it on', () => {
    expect(routeFor('player-scout').canActivate).toEqual([authGuard, playerScoutEnabledGuard]);
  });

  it('sends the page Player Scout replaced to it', () => {
    // A bookmark to FA Scout, or a link in an old thread, still lands somewhere.
    expect(routeFor('fa-scout').redirectTo).toEqual('player-scout');
    expect(routeFor('fa-scout').pathMatch).toEqual('full');
  });

  it('serves Role Changes signed in and only where the BFF switches it on', () => {
    expect(routeFor('role-changes').canActivate).toEqual([authGuard, roleChangesEnabledGuard]);
  });

  it('catches an unknown address instead of letting the router throw', () => {
    // NG04002 reached Sentry as an application error and the visitor saw an empty page.
    // It has to be last: a wildcard earlier in the list would swallow every route after it.
    expect(routes.at(-1)?.path).toEqual('**');
    expect(routeFor('**').canActivate).toBeUndefined();
  });
});
