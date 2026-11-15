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
  shiftMonth,
  formatMonth,
  monthOf,
  monthWeeks,
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

  it('says how long ago a day was, in the words the button uses', () => {
    expect(relativeDay('2026-10-19', TODAY)).toBe('yesterday');
    expect(relativeDay('2026-10-13', TODAY)).toBe('a week ago');
    expect(relativeDay('2026-10-15', TODAY)).toBe('5 days ago');
  });
});

describe('sinceCaption', () => {
  it('says when there is nothing to compare with, and nothing until the answer lands', () => {
    expect(sinceCaption({ kind: 'NONE' })).toEqual('No earlier projection to compare with yet.');
    expect(sinceCaption(null)).toBe('');
  });

  it('says when a nearer day answered than the one asked for: a gap in the kept days', () => {
    const kept = {
      requested: '2026-10-17',
      kind: 'SNAPSHOT' as const,
      resolved: '2026-10-17',
      earliestSnapshot: '2026-10-14',
    };
    expect(sinceCaption(kept)).toBe('');
    expect(sinceCaption({ ...kept, resolved: '2026-10-16' })).toEqual(
      'Compared with 16 Oct, the nearest day kept.',
    );
  });

  it('says nothing for the preseason, which the button already names', () => {
    expect(sinceCaption({ kind: 'PRESEASON' })).toBe('');
    expect(sinceCaption({ requested: '2026-10-07', kind: 'PRESEASON' })).toBe('');
  });
});

describe('the calendar arithmetic', () => {
  it('lays a month out as six weeks, Monday first', () => {
    const weeks = monthWeeks('2026-10');

    expect(weeks).toHaveLength(6);
    expect(weeks.every((week) => week.length === 7)).toBe(true);
    // The first of October 2026 is a Thursday.
    expect(weeks[0]).toEqual([
      null,
      null,
      null,
      '2026-10-01',
      '2026-10-02',
      '2026-10-03',
      '2026-10-04',
    ]);
    expect(weeks.flat().filter(Boolean)).toHaveLength(31);
    expect(weeks[5]).toEqual([null, null, null, null, null, null, null]);
  });

  it('starts a month that opens on a Monday in the first column, and one on a Sunday in the last', () => {
    expect(monthWeeks('2027-02')[0][0]).toBe('2027-02-01');
    expect(monthWeeks('2026-11')[0]).toEqual([null, null, null, null, null, null, '2026-11-01']);
  });

  it('turns months across the new year, and names one', () => {
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2027-01', -1)).toBe('2026-12');
    expect(monthOf('2026-10-14')).toBe('2026-10');
    expect(formatMonth('2026-11')).toBe('November 2026');
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
    today = TODAY,
  ) {
    const sinceChange = vi.fn();
    const cleared = vi.fn();
    const fixture = MockRender(CompareMenuComponent, {
      on,
      since,
      today,
      earliestKept,
      sinceChange,
      cleared,
    });
    return { fixture, sinceChange, cleared };
  }

  type Fixture = ReturnType<typeof render>['fixture'];
  const button = (fixture: Fixture) => ngMocks.find(fixture, '.compare-btn');
  const cross = (fixture: Fixture) => ngMocks.find(fixture, '.compare-clear', null);
  const panel = () => document.querySelector<HTMLElement>('.app-popover-panel');
  const open = (fixture: Fixture) => {
    ngMocks.click(button(fixture));
    fixture.detectChanges();
    return panel()!;
  };
  const preseason = (menu: HTMLElement) => menu.querySelector<HTMLButtonElement>('.preseason')!;
  const days = (menu: HTMLElement) => [...menu.querySelectorAll<HTMLButtonElement>('.day')];
  const day = (menu: HTMLElement, iso: string) =>
    menu.querySelector<HTMLButtonElement>(`.day[data-day="${iso}"]`)!;
  const offered = (menu: HTMLElement) =>
    days(menu)
      .filter((cell) => !cell.disabled)
      .map((cell) => cell.dataset['day']);
  const month = (menu: HTMLElement) => menu.querySelector('.month-name')!.textContent.trim();
  const turns = (menu: HTMLElement) => [...menu.querySelectorAll<HTMLButtonElement>('.month-turn')];
  const press = async (fixture: Fixture, target: HTMLElement, key: string) => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    fixture.detectChanges();
    await fixture.whenStable();
  };
  const focused = () => (document.activeElement as HTMLElement | null)?.dataset['day'];

  it('reads Projection Change while no comparison is on, and as the day once one is', () => {
    const { fixture } = render(false, null);
    expect(ngMocks.formatText(button(fixture))).toBe('Projection Change');
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

  it('keeps reading Projection Change while the comparison is off, whatever day it kept', () => {
    const { fixture } = render(false, '2026-10-15');

    expect(ngMocks.formatText(button(fixture))).toBe('Projection Change');
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
    expect(ngMocks.formatText(button(fixture))).toBe('Projection Change');
  });

  it('has no cross in rest, where there is nothing to switch off', () => {
    const { fixture } = render(false, '2026-10-15');

    expect(cross(fixture)).toBeNull();
  });

  it('switches the comparison off from the cross, in one press and without opening the menu', () => {
    const { fixture, sinceChange, cleared } = render(true, '2026-10-15');
    const clear = cross(fixture)!.nativeElement as HTMLButtonElement;
    expect(clear.getAttribute('aria-label')).toBe('Stop comparing');

    clear.click();

    expect(cleared).toHaveBeenCalledTimes(1);
    expect(sinceChange).not.toHaveBeenCalled();
    expect(panel()).toBeNull();
    // The cross goes with the comparison: focus lands on the button it sat on.
    expect(document.activeElement).toBe(button(fixture).nativeElement);
  });

  it('finishes the sentence with the preseason or a day of the calendar, and nothing else', () => {
    const { fixture } = render(false, null);

    const menu = open(fixture);

    expect(menu.querySelector('.menu-title')!.textContent.trim()).toBe(
      "Compare today's projection with",
    );
    expect(menu.getAttribute('aria-label')).toBe("Compare today's projection with");
    expect(preseason(menu).querySelector('.preseason-label')!.textContent.trim()).toBe('Preseason');
    expect(preseason(menu).querySelector('.preseason-note')!.textContent.trim()).toBe(
      'before game 1',
    );
    expect(month(menu)).toBe('October 2026');
    expect([...menu.querySelectorAll('th')].map((th) => th.textContent.trim())).toEqual([
      'Mo',
      'Tu',
      'We',
      'Th',
      'Fr',
      'Sa',
      'Su',
    ]);
    expect(days(menu)).toHaveLength(31);
    expect(menu.querySelectorAll('button')).toHaveLength(1 + 2 + 31);
  });

  it('lets only a day on record be pressed: from the first kept to yesterday', () => {
    const { fixture } = render(false, null);

    const menu = open(fixture);

    expect(offered(menu)).toEqual([
      '2026-10-14',
      '2026-10-15',
      '2026-10-16',
      '2026-10-17',
      '2026-10-18',
      '2026-10-19',
    ]);
    // Nothing says why the others do not answer.
    expect(menu.textContent).not.toContain('kept');
  });

  it('marks today, which is what the days are compared with and so is not one of them', () => {
    const { fixture } = render(false, null);

    const today = day(open(fixture), TODAY);

    expect(today.disabled).toBe(true);
    expect(today.getAttribute('aria-current')).toBe('date');
    expect(today.getAttribute('aria-label')).toBe('20 October, today');
    expect(today.classList).toContain('day--today');
  });

  it('names each day in full for a screen reader, and shows its date alone', () => {
    const { fixture } = render(false, null);

    const cell = day(open(fixture), '2026-10-15');

    expect(cell.getAttribute('aria-label')).toBe('15 October');
    expect(cell.textContent.trim()).toBe('15');
  });

  it('switches on against the day pressed, or the preseason, closing the menu each time', () => {
    const { fixture, sinceChange, cleared } = render(false, null);

    day(open(fixture), '2026-10-16').click();
    expect(panel()).toBeNull();
    preseason(open(fixture)).click();
    expect(panel()).toBeNull();

    expect(sinceChange.mock.calls).toEqual([['2026-10-16'], [null]]);
    expect(cleared).not.toHaveBeenCalled();
  });

  it('picks nothing for the reader: opening and closing the menu changes nothing', () => {
    const { fixture, sinceChange, cleared } = render(false, null);

    const menu = open(fixture);
    expect(preseason(menu).getAttribute('aria-pressed')).toBe('false');
    expect(days(menu).some((cell) => cell.getAttribute('aria-pressed') === 'true')).toBe(false);
    ngMocks.click(button(fixture));

    expect(panel()).toBeNull();
    expect(sinceChange).not.toHaveBeenCalled();
    expect(cleared).not.toHaveBeenCalled();
  });

  it('marks the day picked and opens on it', () => {
    const { fixture } = render(true, '2026-10-15');

    const menu = open(fixture);

    expect(
      days(menu)
        .filter((cell) => cell.getAttribute('aria-pressed') === 'true')
        .map((cell) => cell.dataset['day']),
    ).toEqual(['2026-10-15']);
    expect(day(menu, '2026-10-15').classList).toContain('day--picked');
    expect(preseason(menu).getAttribute('aria-pressed')).toBe('false');
    expect(focused()).toBe('2026-10-15');
  });

  it('does not mark the day kept from last time while the comparison is off', () => {
    const { fixture } = render(false, '2026-10-15');

    const menu = open(fixture);

    expect(day(menu, '2026-10-15').getAttribute('aria-pressed')).toBe('false');
    expect(day(menu, '2026-10-15').classList).not.toContain('day--picked');
  });

  it('marks the preseason as the pick once the comparison is on with no day, and opens on it', () => {
    const { fixture } = render(true, null);

    const menu = open(fixture);

    expect(preseason(menu).getAttribute('aria-pressed')).toBe('true');
    expect(days(menu).some((cell) => cell.classList.contains('day--picked'))).toBe(false);
    expect(document.activeElement).toBe(preseason(menu));
  });

  it('opens on the month of the day picked, and otherwise on the latest month with a day in it', () => {
    const picked = render(true, '2026-10-20', '2026-10-14', '2026-11-15');
    expect(month(open(picked.fixture))).toBe('October 2026');
    ngMocks.click(button(picked.fixture));

    const rest = render(false, null, '2026-10-14', '2026-11-15');
    expect(month(open(rest.fixture))).toBe('November 2026');
    ngMocks.click(button(rest.fixture));

    // On the first of a month the latest day is in the month before.
    const first = render(false, null, '2026-10-14', '2026-11-01');
    expect(month(open(first.fixture))).toBe('October 2026');
  });

  it('turns the months no further than the days there are, and picks nothing on the way', () => {
    const { fixture, sinceChange } = render(false, null, '2026-10-14', '2026-11-15');
    const menu = open(fixture);
    const [earlier, later] = turns(menu);
    expect(earlier.getAttribute('aria-label')).toBe('Previous month');
    expect(later.getAttribute('aria-label')).toBe('Next month');
    expect(later.getAttribute('aria-disabled')).toBe('true');
    expect(earlier.getAttribute('aria-disabled')).toBeNull();

    later.click();
    fixture.detectChanges();
    expect(month(menu)).toBe('November 2026');

    earlier.click();
    fixture.detectChanges();
    expect(month(menu)).toBe('October 2026');
    expect(offered(menu)[0]).toBe('2026-10-14');
    expect(earlier.getAttribute('aria-disabled')).toBe('true');
    expect(later.getAttribute('aria-disabled')).toBeNull();

    earlier.click();
    fixture.detectChanges();
    expect(month(menu)).toBe('October 2026');

    expect(panel()).not.toBeNull();
    expect(sinceChange).not.toHaveBeenCalled();
  });

  it('starts over from its own month each time it opens', () => {
    const { fixture } = render(false, null, '2026-10-14', '2026-11-15');
    turns(open(fixture))[0].click();
    fixture.detectChanges();
    expect(month(panel()!)).toBe('October 2026');
    ngMocks.click(button(fixture));

    expect(month(open(fixture))).toBe('November 2026');
  });

  it('keeps the day picked on show even once it falls before the first on record', () => {
    const { fixture } = render(true, '2026-09-28', '2026-10-14');

    const menu = open(fixture);

    expect(month(menu)).toBe('September 2026');
    expect(day(menu, '2026-09-28').classList).toContain('day--picked');
    expect(day(menu, '2026-09-28').disabled).toBe(true);
    expect(turns(menu)[0].getAttribute('aria-disabled')).toBe('true');
  });

  it('makes the days one tab stop: the day picked, or the latest that can be pressed', () => {
    const stops = (menu: HTMLElement) =>
      days(menu)
        .filter((cell) => cell.getAttribute('tabindex') === '0')
        .map((cell) => cell.dataset['day']);

    const picked = render(true, '2026-10-15');
    expect(stops(open(picked.fixture))).toEqual(['2026-10-15']);
    ngMocks.click(button(picked.fixture));

    const rest = render(false, null);
    expect(stops(open(rest.fixture))).toEqual(['2026-10-19']);
  });

  it('walks the days with the arrows, stopping at the first and last on record, and picks nothing', async () => {
    const { fixture, sinceChange } = render(true, '2026-10-16');
    const menu = open(fixture);
    expect(focused()).toBe('2026-10-16');

    await press(fixture, day(menu, '2026-10-16'), 'ArrowLeft');
    expect(focused()).toBe('2026-10-15');
    expect(day(menu, '2026-10-15').getAttribute('tabindex')).toBe('0');
    expect(day(menu, '2026-10-16').getAttribute('tabindex')).toBe('-1');

    await press(fixture, day(menu, '2026-10-15'), 'ArrowUp');
    expect(focused()).toBe('2026-10-14');
    await press(fixture, day(menu, '2026-10-14'), 'ArrowLeft');
    expect(focused()).toBe('2026-10-14');

    await press(fixture, day(menu, '2026-10-14'), 'ArrowRight');
    await press(fixture, day(menu, '2026-10-15'), 'ArrowDown');
    expect(focused()).toBe('2026-10-19');

    // The week of the 12th runs Monday to Sunday: its ends, held to the days on record.
    await press(fixture, day(menu, '2026-10-16'), 'Home');
    expect(focused()).toBe('2026-10-14');
    await press(fixture, day(menu, '2026-10-16'), 'End');
    expect(focused()).toBe('2026-10-18');

    expect(panel()).not.toBeNull();
    expect(sinceChange).not.toHaveBeenCalled();
  });

  it('turns the month when the arrows cross its edge, and with Page Up and Page Down', async () => {
    const { fixture } = render(true, '2026-11-01', '2026-10-14', '2026-11-15');
    const menu = open(fixture);
    expect(month(menu)).toBe('November 2026');

    await press(fixture, day(menu, '2026-11-01'), 'ArrowLeft');
    expect(month(menu)).toBe('October 2026');
    expect(focused()).toBe('2026-10-31');

    await press(fixture, day(menu, '2026-10-31'), 'PageDown');
    expect(month(menu)).toBe('November 2026');
    // November has no 31st, and the 30th is not a day yet: the last day there is.
    expect(focused()).toBe('2026-11-14');

    await press(fixture, day(menu, '2026-11-14'), 'PageUp');
    expect(month(menu)).toBe('October 2026');
    expect(focused()).toBe('2026-10-14');
  });

  it('offers the preseason alone while there is no day on record', () => {
    const { fixture } = render(false, null, null);

    const menu = open(fixture);

    expect(preseason(menu)).not.toBeNull();
    expect(menu.querySelector('.days')).toBeNull();
    expect(menu.querySelector('.month')).toBeNull();
    expect(menu.querySelector('.divider')).toBeNull();
  });

  it('offers the preseason alone on the first day kept, when yesterday is not one yet', () => {
    const { fixture } = render(false, null, TODAY);

    expect(open(fixture).querySelector('.days')).toBeNull();
  });
});
