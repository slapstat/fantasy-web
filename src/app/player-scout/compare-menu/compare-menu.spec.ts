import { signal } from '@angular/core';
import { MockBuilder, MockRender, ngMocks } from 'ng-mocks';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IconComponent } from '../../shared/icon/icon';
import { PopoverTriggerDirective } from '../../shared/popover/popover-trigger.directive';
import { PLANNER_LAYOUT, PlannerLayout } from '../../streamer-planner/planner-page-size';
import {
  CompareMenuComponent,
  daysBefore,
  daysBetween,
  formatDay,
  relativeDay,
  seasonFloor,
  sinceCaption,
} from './compare-menu';

const TODAY = '2026-10-20';

describe('the day arithmetic', () => {
  it('counts days back across a month', () => {
    expect(daysBefore(TODAY, 7)).toBe('2026-10-13');
    expect(daysBefore(TODAY, 20)).toBe('2026-09-30');
    expect(daysBefore('2026-01-03', 5)).toBe('2025-12-29');
  });

  it('counts the days between two days, across a month and a year', () => {
    expect(daysBetween('2026-10-15', TODAY)).toBe(5);
    expect(daysBetween('2026-09-30', TODAY)).toBe(20);
    expect(daysBetween('2025-12-29', '2026-01-03')).toBe(5);
  });

  it('writes a day as the page does', () => {
    expect(formatDay('2026-10-07')).toBe('7 Oct');
    expect(formatDay(null)).toBe('');
  });

  it('says how long ago a day was, in the words the menu uses for its own lines', () => {
    expect(relativeDay('2026-10-19', TODAY)).toBe('yesterday');
    expect(relativeDay('2026-10-13', TODAY)).toBe('a week ago');
    expect(relativeDay('2026-10-15', TODAY)).toBe('5 days ago');
  });

  it('floors a season at its first of October, on either side of the new year', () => {
    expect(seasonFloor('2026-10-14')).toBe('2026-10-01');
    expect(seasonFloor('2027-03-02')).toBe('2026-10-01');
    expect(seasonFloor('2026-09-20')).toBe('2026-10-01');
  });
});

describe('sinceCaption', () => {
  it('says only when there is nothing to compare with, since the menu offers no other day that cannot answer', () => {
    expect(sinceCaption({ kind: 'NONE' })).toEqual('No earlier projection to compare with yet.');
    expect(
      sinceCaption({
        requested: '2026-10-07',
        kind: 'SNAPSHOT',
        resolved: '2026-10-05',
        earliestSnapshot: '2026-10-01',
      }),
    ).toBe('');
    expect(sinceCaption({ requested: '2026-10-07', kind: 'PRESEASON' })).toBe('');
    expect(sinceCaption(null)).toBe('');
  });
});

describe('CompareMenuComponent', () => {
  const layout = signal<PlannerLayout>('desktop');

  beforeEach(() => {
    layout.set('desktop');
    return MockBuilder(CompareMenuComponent)
      .keep(IconComponent)
      .keep(PopoverTriggerDirective)
      .provide({ provide: PLANNER_LAYOUT, useValue: layout.asReadonly() });
  });

  afterEach(() => {
    document.querySelector('.cdk-overlay-container')?.remove();
  });

  function render(
    on: boolean,
    since: string | null,
    earliestKept: string | null = '2026-10-14',
    sinceChange = vi.fn(),
    cleared = vi.fn(),
  ) {
    const fixture = MockRender(CompareMenuComponent, {
      on,
      since,
      today: TODAY,
      earliestKept,
      sinceChange,
      cleared,
    });
    return { fixture, sinceChange, cleared };
  }

  type Fixture = ReturnType<typeof render>['fixture'];
  const button = (fixture: Fixture) => ngMocks.find(fixture, '.compare-btn');
  const field = (fixture: Fixture) => ngMocks.find(fixture, 'input[type=date]');
  const panel = () => document.querySelector<HTMLElement>('.app-popover-panel');
  const open = (fixture: Fixture) => {
    ngMocks.click(button(fixture));
    fixture.detectChanges();
    return panel()!;
  };
  const choices = (menu: HTMLElement) => [...menu.querySelectorAll<HTMLButtonElement>('.choice')];
  const lines = (menu: HTMLElement) =>
    choices(menu).map((choice) => ({
      label: choice.querySelector('.choice-label')!.textContent.trim(),
      note: choice.querySelector('.choice-note')!.textContent.trim(),
      picked: choice.getAttribute('aria-checked') === 'true',
      disabled: choice.disabled,
    }));

  it('reads as an invitation while no comparison is on, and as the day once one is', () => {
    const { fixture } = render(false, null);
    expect(ngMocks.formatText(button(fixture))).toBe('Compare with · an earlier day');
    expect(button(fixture).nativeElement.classList).not.toContain('compare-btn--on');

    fixture.componentInstance.on = true;
    fixture.componentInstance.since = '2026-10-15';
    fixture.detectChanges();

    expect(ngMocks.formatText(button(fixture))).toBe('Compare with · 15 Oct · 5 days ago');
    expect(button(fixture).nativeElement.classList).toContain('compare-btn--on');
  });

  it('names the preseason as before game 1', () => {
    const { fixture } = render(true, null);

    expect(ngMocks.formatText(button(fixture))).toBe('Compare with · Preseason · before game 1');
  });

  it('keeps wearing the sentence while the comparison is off, whatever day it kept', () => {
    const { fixture } = render(false, '2026-10-15');

    expect(ngMocks.formatText(button(fixture))).toBe('Compare with · an earlier day');
  });

  it('shortens to the day alone on a phone, where the chips sit beside it', () => {
    layout.set('phone');
    const { fixture } = render(true, '2026-10-15');
    expect(ngMocks.formatText(button(fixture))).toBe('vs 15 Oct');

    fixture.componentInstance.since = null;
    fixture.detectChanges();
    expect(ngMocks.formatText(button(fixture))).toBe('vs preseason');

    fixture.componentInstance.on = false;
    fixture.detectChanges();
    expect(ngMocks.formatText(button(fixture))).toBe('Compare with · an earlier day');
  });

  it('finishes the sentence with nothing, the two relative days, the preseason, and says from when days are kept', () => {
    const { fixture } = render(false, null);

    const menu = open(fixture);

    expect(menu.querySelector('.menu-title')!.textContent.trim()).toBe(
      "Compare today's projection with",
    );
    expect(lines(menu)).toEqual([
      { label: 'Nothing', note: 'today only', picked: true, disabled: false },
      { label: 'Yesterday', note: '19 Oct', picked: false, disabled: false },
      { label: 'A week ago', note: '13 Oct, not kept', picked: false, disabled: true },
      { label: 'Preseason', note: 'before game 1', picked: false, disabled: false },
    ]);
    expect(menu.querySelector('.menu-foot')!.textContent.trim()).toBe('Days are kept from 14 Oct.');
    expect(menu.querySelector<HTMLButtonElement>('.pick-day')!.disabled).toBe(false);
  });

  it('keeps the day last picked as a line of its own, in its place among the days, and marks it', () => {
    const { fixture } = render(true, '2026-10-15', '2026-10-10');

    expect(lines(open(fixture))).toEqual([
      { label: 'Nothing', note: 'today only', picked: false, disabled: false },
      { label: 'Yesterday', note: '19 Oct', picked: false, disabled: false },
      { label: '15 Oct', note: '5 days ago', picked: true, disabled: false },
      { label: 'A week ago', note: '13 Oct', picked: false, disabled: false },
      { label: 'Preseason', note: 'before game 1', picked: false, disabled: false },
    ]);
  });

  it('marks the relative day as the pick, rather than listing the same day twice', () => {
    const { fixture } = render(true, '2026-10-19');

    const all = lines(open(fixture));
    expect(all.map((line) => line.label)).toEqual([
      'Nothing',
      'Yesterday',
      'A week ago',
      'Preseason',
    ]);
    expect(all[1].picked).toBe(true);
  });

  it('marks the preseason as the pick once the comparison is on with no day', () => {
    const { fixture } = render(true, null);

    expect(lines(open(fixture)).map((line) => line.picked)).toEqual([false, false, false, true]);
  });

  it('switches on against a day, or the preseason, and off for nothing, closing the menu each time', () => {
    const { fixture, sinceChange, cleared } = render(false, null);

    choices(open(fixture))[1].click();
    expect(panel()).toBeNull();
    choices(open(fixture))[3].click();
    choices(open(fixture))[0].click();

    expect(sinceChange.mock.calls).toEqual([['2026-10-19'], [null]]);
    expect(cleared).toHaveBeenCalledTimes(1);
  });

  it('refuses a day nothing is kept for', () => {
    const { fixture, sinceChange } = render(false, null);

    choices(open(fixture))[2].click();

    expect(sinceChange).not.toHaveBeenCalled();
  });

  it('opens the platform picker from "Pick a day…" and changes nothing until a day is picked in it', () => {
    const { fixture, sinceChange, cleared } = render(false, null);
    const input = field(fixture).nativeElement as HTMLInputElement;
    const showPicker = vi.fn();
    input.showPicker = showPicker;

    open(fixture).querySelector<HTMLButtonElement>('.pick-day')!.click();

    expect(panel()).toBeNull();
    expect(showPicker).toHaveBeenCalledTimes(1);
    // The picker dismissed: no comparison with a day the reader never chose.
    expect(sinceChange).not.toHaveBeenCalled();
    expect(cleared).not.toHaveBeenCalled();

    input.value = '2026-10-16';
    input.dispatchEvent(new Event('change'));

    expect(sinceChange).toHaveBeenCalledExactlyOnceWith('2026-10-16');
  });

  it('offers no day before the first kept nor later than yesterday, and ignores one typed outside', () => {
    const { fixture, sinceChange } = render(true, '2026-10-15');
    const input = field(fixture).nativeElement as HTMLInputElement;

    expect(input.min).toBe('2026-10-14');
    expect(input.max).toBe('2026-10-19');
    input.value = '2026-10-12';
    input.dispatchEvent(new Event('change'));

    expect(sinceChange).not.toHaveBeenCalled();
  });

  it('falls back to the field itself where the browser will not show a picker', () => {
    const { fixture } = render(true, '2026-10-15');
    const input = field(fixture).nativeElement as HTMLInputElement;
    input.showPicker = vi.fn(() => {
      throw new DOMException('no activation', 'NotAllowedError');
    });
    const focus = vi.spyOn(input, 'focus');

    open(fixture).querySelector<HTMLButtonElement>('.pick-day')!.click();

    expect(focus).toHaveBeenCalledTimes(1);
  });

  it('keeps the day field out of the tab order and off the accessibility tree', () => {
    const { fixture } = render(false, null);

    expect(field(fixture).attributes['tabindex']).toBe('-1');
    expect(field(fixture).attributes['aria-hidden']).toBe('true');
  });

  it('offers no day at all while none is kept, and says so', () => {
    const { fixture } = render(false, null, null);

    const menu = open(fixture);

    expect(lines(menu).map((line) => line.disabled)).toEqual([false, true, true, false]);
    expect(menu.querySelector<HTMLButtonElement>('.pick-day')!.disabled).toBe(true);
    expect(menu.querySelector('.menu-foot')!.textContent.trim()).toBe('No day is kept yet.');
    expect(field(fixture).attributes['min']).toBe('2026-10-01');
  });
});
