import { MockBuilder, MockRender } from 'ng-mocks';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { signal } from '@angular/core';
import { Router } from '@angular/router';
import { provideLocationMocks } from '@angular/common/testing';
import { of } from 'rxjs';
import { CdkMenu, CdkMenuItem, CdkMenuTrigger } from '@angular/cdk/menu';
import { App } from './app';
import { environment } from '../environments/environment';
import { AccountService } from './services/account.service';
import { AuthService } from './services/auth.service';
import { FeatureService } from './services/feature.service';
import { EntitlementService } from './services/entitlement.service';
import { ConsentBannerComponent } from './shared/consent-banner/consent-banner';
import { LazyEnvironmentBannerComponent } from './shared/environment-banner/lazy-environment-banner';
import { PlayerHeadshotComponent } from './shared/player-headshot/player-headshot';
import { ToastComponent } from './shared/toast/toast';
import { LazyUnverifiedBannerComponent } from './shared/unverified-banner/lazy-unverified-banner';

describe('App', () => {
  const isLoggedIn = signal(true);
  const isAdmin = signal(true);
  const logout = vi.fn();
  const username = signal<string | null>('alex');
  const email = signal<string | null>('alex@example.com');
  const avatarUrl = signal<string | null>(null);
  const premium = signal(false);
  const loadState = signal<'idle' | 'loading' | 'loaded' | 'error'>('loaded');
  const playerScout = signal(false);
  const roleChanges = signal(false);
  const draftAnalysis = signal(false);
  const startBench = signal(false);

  beforeEach(() => {
    isLoggedIn.set(true);
    isAdmin.set(true);
    username.set('alex');
    email.set('alex@example.com');
    avatarUrl.set(null);
    premium.set(false);
    loadState.set('loaded');
    playerScout.set(false);
    roleChanges.set(false);
    draftAnalysis.set(false);
    startBench.set(false);
    logout.mockClear();
    return (
      MockBuilder(App)
        // The menus are the thing under test, so the CDK directives that open them stay real,
        // and so does the avatar, whose fallback is part of what the header shows.
        .keep(CdkMenu)
        .keep(CdkMenuItem)
        .keep(CdkMenuTrigger)
        .keep(PlayerHeadshotComponent)
        .mock(ConsentBannerComponent)
        // ng-mocks cannot mock a component with a @defer block, so the banners' gates stay real;
        // here neither condition holds, so neither banner loads.
        .keep(LazyEnvironmentBannerComponent)
        .keep(LazyUnverifiedBannerComponent)
        .mock(ToastComponent)
        .mock(AuthService, { isLoggedIn, isAdmin, isEmailVerified: signal(true), logout })
        .mock(AccountService, { username, email, avatarUrl })
        .mock(EntitlementService, { premium, loadState })
        .mock(FeatureService, {
          playerScout,
          roleChanges,
          draftAnalysis,
          startBench,
        } as never)
        .provide({
          provide: Router,
          useValue: {
            url: '/projections',
            events: of(),
            createUrlTree: () => ({}),
            serializeUrl: () => '/projections',
          },
        })
        .provide(provideLocationMocks())
    );
  });

  const render = () => {
    const fixture = MockRender(App);
    fixture.detectChanges();
    return fixture;
  };

  const openMenu = (fixture: ReturnType<typeof render>, trigger: string) => {
    const button = fixture.nativeElement.querySelector(trigger) as HTMLButtonElement;
    button.click();
    fixture.detectChanges();
    return Array.from(document.querySelectorAll<HTMLElement>('.nav-menu-item'));
  };

  const openNavMenu = (fixture: ReturnType<typeof render>) => openMenu(fixture, '.nav-burger');
  const openAccountMenu = (fixture: ReturnType<typeof render>) => openMenu(fixture, '.nav-avatar');

  /**
   * The header's links do not fit beside the logo on a phone, so a menu button stands in for
   * them there. Nothing may be dropped on the way in: what the header can show at a width that
   * fits, the menu has to carry at one that doesn't.
   */
  it('carries every header link into the menu the burger opens', () => {
    const fixture = render();

    const items = openNavMenu(fixture).map((item) => item.textContent?.trim());

    expect(items).toEqual([
      'Home',
      'Draft Mode',
      'Power Rankings',
      'My Projections',
      "Who's Hot",
      'Streamer Planner',
      'Premium',
      'Admin',
    ]);
  });

  /**
   * The page it opens is the one way into a league drafted somewhere else, and a line on the
   * draft picker was the whole of how anyone reached it — which nobody looking for it in the
   * menu would ever find.
   */
  it('offers the power rankings', () => {
    const fixture = render();

    const items = openNavMenu(fixture).map((item) => item.textContent?.trim());

    expect(items).toContain('Power Rankings');
  });

  /**
   * The page reads a league all season, not just after its draft, so it sits in the header
   * beside the in-season tools; the menu carries it only where the header links collapse.
   */
  it('links the power rankings from the header rather than the Draft menu', () => {
    const fixture = render();

    const header = Array.from(
      fixture.nativeElement.querySelectorAll('.app-nav a') as NodeListOf<HTMLElement>,
    ).map((link) => link.textContent?.trim());
    const item = openNavMenu(fixture).find(
      (menuItem) => menuItem.textContent?.trim() === 'Power Rankings',
    );

    expect(header).toContain('Power Rankings');
    expect(item?.classList).toContain('nav-menu-item--collapsed');
  });

  /** Role Changes is a BFF switch: linked in the header and the burger only where it is on. */
  it('links Role Changes only where the environment serves it', () => {
    expect(openNavMenu(render()).map((item) => item.textContent?.trim())).not.toContain(
      'Role Changes',
    );
  });

  it('offers Role Changes where the environment serves it', () => {
    roleChanges.set(true);
    const fixture = render();

    expect(fixture.nativeElement.textContent ?? '').toContain('Role Changes');
    expect(openNavMenu(fixture).map((item) => item.textContent?.trim())).toContain('Role Changes');
  });

  it('offers Draft Analysis where the environment serves it', () => {
    draftAnalysis.set(true);
    const fixture = render();

    const items = openNavMenu(fixture).map((item) => item.textContent?.trim());

    expect(items).toContain('Draft Analysis');
  });

  it('offers Player Scout from the header and the burger where the BFF serves it', () => {
    playerScout.set(true);
    const fixture = render();

    const header = Array.from(
      fixture.nativeElement.querySelectorAll('.app-nav a') as NodeListOf<HTMLElement>,
    ).map((link) => link.textContent?.trim());
    const items = openNavMenu(fixture).map((item) => item.textContent?.trim());

    expect(header).toContain('Player Scout');
    expect(items).toContain('Player Scout');
  });

  it('offers Start/Bench from the header and the burger where the BFF serves it', () => {
    startBench.set(true);
    const fixture = render();

    const header = Array.from(
      fixture.nativeElement.querySelectorAll('.app-nav a') as NodeListOf<HTMLElement>,
    ).map((link) => link.textContent?.trim());
    const items = openNavMenu(fixture).map((item) => item.textContent?.trim());

    expect(header).toContain('Start/Bench');
    expect(items).toContain('Start/Bench');
  });

  it.each(['Draft Analysis', 'Player Scout', 'Start/Bench'])(
    'drops %s where the BFF does not serve it',
    (label) => {
      const fixture = render();

      const items = openNavMenu(fixture).map((item) => item.textContent?.trim());

      expect(items).not.toContain(label);
    },
  );

  it('leaves out the links the header itself leaves out', () => {
    isAdmin.set(false);
    const fixture = render();

    const items = openNavMenu(fixture).map((item) => item.textContent?.trim());

    expect(items).not.toContain('Admin');
    expect(items).toContain("Who's Hot");
  });

  /**
   * The page is a build-flag feature, and a link into a page the router will bounce is worse
   * than no link, so the nav has to drop it wherever it appears.
   */
  it("drops the Who's hot link when the page is switched off", () => {
    const original = environment.whosHotEnabled;
    environment.whosHotEnabled = false;
    try {
      const fixture = render();

      const header = fixture.nativeElement.textContent ?? '';
      expect(header).not.toContain("Who's Hot");
      expect(openNavMenu(fixture).map((item) => item.textContent?.trim())).not.toContain(
        "Who's Hot",
      );
    } finally {
      environment.whosHotEnabled = original;
    }
  });

  /**
   * The account lives behind the avatar at the right edge, at every width: the links fold into
   * the burger on a phone, but who you are and how you leave have to stay a tap away.
   */
  it('offers the profile and signing out from the account menu', () => {
    const fixture = render();

    const items = openAccountMenu(fixture).map((item) => item.textContent?.trim());

    expect(items).toEqual(['Profile', 'Premium', 'Sign Out']);
  });

  it('says who is signed in at the top of the account menu', () => {
    const fixture = render();
    openAccountMenu(fixture);

    const identity = document.querySelector('.account-menu-identity')?.textContent ?? '';

    expect(identity).toContain('alex');
    expect(identity).toContain('alex@example.com');
  });

  /**
   * An account without a name should not just be told it has none: the line that says so is the
   * link to the field that fixes it, so nobody has to go looking for it under Profile.
   */
  it('links to the username field when the account has not picked a name yet', () => {
    username.set(null);
    const fixture = render();
    openAccountMenu(fixture);

    const link = document.querySelector('a.account-menu-name');

    expect(link?.textContent?.trim()).toEqual('Set a Username');
    expect(link?.getAttribute('routerLink')).toEqual('/profile');
    expect(link?.getAttribute('fragment')).toEqual('username');
  });

  /**
   * The nav has to say what the account has and offer the way to
   * the rest: the plan under the name, one Premium item in the account menu, and a header link
   * to the Premium page for an account that could use it. Each in one place, and never a
   * "Free plan" or an offer to buy said of a subscriber.
   */
  describe('the plan in the nav', () => {
    it('offers a free account the Premium page from the header and the burger', () => {
      const fixture = render();

      const link = fixture.nativeElement.querySelector('.app-nav a.nav-premium');
      expect(link?.textContent?.trim()).toEqual('Premium');
      expect(link?.getAttribute('routerLink')).toEqual('/premium');
      expect(openNavMenu(fixture).map((item) => item.textContent?.trim())).toContain('Premium');
    });

    // A signed-out visitor never loads an entitlement, so the plan cannot say whether they
    // would benefit. They are the likeliest buyer, and away from the landing page the header is
    // the only navigation they have, so they are offered the price outright.
    it('offers a signed-out visitor the Premium page from the header', () => {
      isLoggedIn.set(false);
      loadState.set('idle');
      const fixture = render();

      const link = fixture.nativeElement.querySelector('.app-nav a.nav-premium');
      expect(link?.textContent?.trim()).toEqual('Premium');
      expect(link?.getAttribute('routerLink')).toEqual('/premium');
    });

    it('states the free plan and leads to Premium from the account menu', () => {
      const fixture = render();

      const items = openAccountMenu(fixture);
      const subscription = items.find((item) => item.textContent?.trim() === 'Premium');
      expect(subscription?.getAttribute('routerLink')).toEqual('/premium');
      expect(document.querySelector('.account-menu-plan')?.textContent?.trim()).toEqual(
        'Free plan',
      );
    });

    it('sells nothing to a subscriber, and leads them to their subscription instead', () => {
      premium.set(true);
      const fixture = render();

      expect(fixture.nativeElement.querySelector('.app-nav a.nav-premium')).toBeNull();
      const items = openAccountMenu(fixture);
      expect(items.map((item) => item.textContent?.trim())).toEqual([
        'Profile',
        'Premium',
        'Sign Out',
      ]);
      expect(
        items.find((item) => item.textContent?.trim() === 'Premium')?.getAttribute('routerLink'),
      ).toEqual('/premium');
      expect(document.querySelector('.account-menu-plan')?.textContent?.trim()).toEqual('Premium');
    });

    // The entitlement is a live read and says non-premium until it lands. Acting on that early
    // would sell Premium to a subscriber for the length of a request.
    it('says nothing about the plan until the entitlement is known', () => {
      loadState.set('loading');
      const fixture = render();

      expect(fixture.nativeElement.querySelector('.app-nav a.nav-premium')).toBeNull();
      const items = openAccountMenu(fixture).map((item) => item.textContent?.trim());
      expect(items).toContain('Premium');
      expect(document.querySelector('.account-menu-plan')).toBeNull();
    });
  });

  it('signs out from the account menu', () => {
    const fixture = render();
    const signOut = openAccountMenu(fixture).find(
      (item) => item.textContent?.trim() === 'Sign Out',
    );

    signOut?.click();

    expect(logout).toHaveBeenCalledOnce();
  });

  it('draws the first letter of the username while there is no picture', () => {
    const fixture = render();

    const avatar = fixture.nativeElement.querySelector('.nav-avatar') as HTMLElement;

    expect(avatar.querySelector('img')).toBeNull();
    expect(avatar.textContent?.trim()).toEqual('A');
  });

  it('falls back to the email for an account without a username', () => {
    username.set(null);
    email.set('zoe@example.com');
    const fixture = render();

    const avatar = fixture.nativeElement.querySelector('.nav-avatar') as HTMLElement;

    expect(avatar.textContent?.trim()).toEqual('Z');
  });

  it('draws the picture once the account has one', () => {
    avatarUrl.set('blob:http://localhost/avatar');
    const fixture = render();

    const image = fixture.nativeElement.querySelector('.nav-avatar img') as HTMLImageElement;

    expect(image.getAttribute('src')).toEqual('blob:http://localhost/avatar');
  });

  it('offers no menu at all to a signed-out visitor', () => {
    isLoggedIn.set(false);
    const fixture = render();

    expect(fixture.nativeElement.querySelector('.nav-burger')).toBeNull();
    expect(fixture.nativeElement.querySelector('.nav-avatar')).toBeNull();
  });
});
