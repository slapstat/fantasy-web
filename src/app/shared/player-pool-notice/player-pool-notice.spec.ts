import { MockBuilder, MockRender, ngMocks } from 'ng-mocks';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PlayerPoolNoticeComponent } from './player-pool-notice';

describe('PlayerPoolNoticeComponent', () => {
  beforeEach(() => MockBuilder(PlayerPoolNoticeComponent));

  function render(newPlayerCount: number, newPlayersOnly = false) {
    return MockRender(PlayerPoolNoticeComponent, { newPlayerCount, newPlayersOnly });
  }

  it('says how many players were added', () => {
    const fixture = render(12);

    const text = fixture.nativeElement.textContent as string;
    expect(fixture.nativeElement.querySelector('.pool-notice')).not.toBeNull();
    expect(text).toContain('12 players have been added');
    expect(text).toContain('Your existing projections are unchanged');
  });

  // What the new players start from is not said: the footer is the one reassurance.
  it('keeps the footer to the existing projections', () => {
    const footer = render(3).nativeElement.querySelector('.pool-notice__footer');

    expect(footer.textContent.trim()).toBe('Your existing projections are unchanged.');
  });

  it('reads as one player for a single addition', () => {
    expect(render(1).nativeElement.textContent as string).toContain('1 player has been added');
  });

  /**
   * Players who left the pool are the table's business, not this notice's — their rows are kept
   * and hidden, and saying "removed" here would claim something that did not happen.
   */
  it('says nothing about players leaving', () => {
    const text = render(12).nativeElement.textContent as string;

    expect(text).not.toContain('removed');
  });

  it('renders nothing when no one is waiting to be acknowledged', () => {
    expect(render(0).nativeElement.querySelector('.pool-notice')).toBeNull();
  });

  // The filter lives in the notice now, bound both ways to the table's.
  it('narrows to the new players from its own checkbox', () => {
    const fixture = render(12);
    const checkbox: HTMLInputElement = ngMocks.find(fixture, '#new-players-only').nativeElement;

    expect(checkbox.checked).toBe(false);
    checkbox.click();
    fixture.detectChanges();

    expect(fixture.point.componentInstance.newPlayersOnly()).toBe(true);
  });

  it('shows the filter as on when the table already is', () => {
    const fixture = render(12, true);

    expect(ngMocks.find(fixture, '#new-players-only').nativeElement.checked).toBe(true);
  });

  /**
   * No close icon: the notice stays until it is acknowledged, and acknowledging is the page's to
   * do, since it is the page that saves the projection.
   */
  it('asks to be acknowledged rather than closing itself', () => {
    const fixture = render(12);
    const acknowledged = vi.fn();
    fixture.point.componentInstance.acknowledged.subscribe(acknowledged);

    expect(fixture.nativeElement.querySelector('.pool-notice__dismiss')).toBeNull();
    ngMocks.click(ngMocks.find(fixture, 'button.btn'));

    expect(acknowledged).toHaveBeenCalledOnce();
    expect(fixture.nativeElement.querySelector('.pool-notice')).not.toBeNull();
  });
});
