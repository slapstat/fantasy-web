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
  const field = (fixture: Fixture) => ngMocks.find(fixture, 'input.day-field');
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
    }));
  const press = (target: HTMLElement, key: string) =>
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  const focused = () => document.activeElement?.querySelector('.choice-label')?.textContent.trim();
  /** A browser that will not open a picker: "Pick a day" becomes the menu's own field. */
  const typedField = async (fixture: Fixture) => {
    const input = field(fixture).nativeElement as HTMLInputElement;
    input.showPicker = vi.fn(() => {
      throw new DOMException('no activation', 'NotAllowedError');
    });
    const menu = open(fixture);
    menu.querySelector<HTMLButtonElement>('.pick-day')!.click();
    fixture.detectChanges();
    await fixture.whenStable();
    return { menu, typed: menu.querySelector<HTMLInputElement>('input.day-input')! };
  };

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

  it('finishes the sentence with nothing, each relative day there is a projection for, and the preseason', () => {
    const { fixture } = render(false, null, '2026-10-10');

    const menu = open(fixture);

    expect(menu.querySelector('.menu-title')!.textContent.trim()).toBe(
      "Compare today's projection with",
    );
    expect(lines(menu)).toEqual([
      { label: 'Nothing', note: 'today only', picked: true },
      { label: 'Yesterday', note: '19 Oct', picked: false },
      { label: 'A week ago', note: '13 Oct', picked: false },
      { label: 'Preseason', note: 'before game 1', picked: false },
    ]);
    expect(menu.querySelector('.pick-day')).not.toBeNull();
  });

  it('leaves out a day before the first on record, and says nothing about what is stored', () => {
    const { fixture } = render(false, null);

    const menu = open(fixture);

    expect(lines(menu).map((line) => line.label)).toEqual(['Nothing', 'Yesterday', 'Preseason']);
    expect(choices(menu).some((choice) => choice.disabled)).toBe(false);
    expect(menu.textContent).not.toContain('kept');
  });

  it('names the panel as the sentence the menu finishes, not as the day on the button', () => {
    const { fixture } = render(true, '2026-10-15');

    expect(open(fixture).getAttribute('aria-label')).toBe("Compare today's projection with");
  });

  it('keeps the day last picked as a line of its own, in its place among the days, and marks it', () => {
    const { fixture } = render(true, '2026-10-15', '2026-10-10');

    expect(lines(open(fixture))).toEqual([
      { label: 'Nothing', note: 'today only', picked: false },
      { label: 'Yesterday', note: '19 Oct', picked: false },
      { label: '5 days ago', note: '15 Oct', picked: true },
      { label: 'A week ago', note: '13 Oct', picked: false },
      { label: 'Preseason', note: 'before game 1', picked: false },
    ]);
  });

  it('keeps the day picked as a line even once it falls before the first on record', () => {
    const { fixture } = render(true, '2026-10-12');

    expect(lines(open(fixture))).toContainEqual({
      label: '8 days ago',
      note: '12 Oct',
      picked: true,
    });
  });

  it('marks the relative day as the pick, rather than listing the same day twice', () => {
    const { fixture } = render(true, '2026-10-19');

    const all = lines(open(fixture));
    expect(all.map((line) => line.label)).toEqual(['Nothing', 'Yesterday', 'Preseason']);
    expect(all[1].picked).toBe(true);
  });

  it('marks the preseason as the pick once the comparison is on with no day', () => {
    const { fixture } = render(true, null);

    expect(lines(open(fixture)).map((line) => line.picked)).toEqual([false, false, true]);
  });

  it('switches on against a day, or the preseason, and off for nothing, closing the menu each time', () => {
    const { fixture, sinceChange, cleared } = render(false, null);

    choices(open(fixture))[1].click();
    expect(panel()).toBeNull();
    choices(open(fixture))[2].click();
    choices(open(fixture))[0].click();

    expect(sinceChange.mock.calls).toEqual([['2026-10-19'], [null]]);
    expect(cleared).toHaveBeenCalledTimes(1);
  });

  it('is one radio group with one tab stop, which is the line picked, and opens on it', () => {
    const { fixture } = render(true, '2026-10-19');

    const menu = open(fixture);
    const group = menu.querySelector('[role="radiogroup"]')!;

    expect(choices(menu).map((choice) => choice.getAttribute('tabindex'))).toEqual([
      '-1',
      '0',
      '-1',
    ]);
    expect(focused()).toBe('Yesterday');
    // "Pick a day" is not one of the answers.
    expect(group.querySelector('.pick-day')).toBeNull();
    expect(group.getAttribute('aria-labelledby')).toBe('compare-menu-title');
  });

  it('walks the lines with the arrows, round the ends, and reaches them with Home and End, picking nothing', () => {
    const { fixture, sinceChange, cleared } = render(false, null);

    const all = choices(open(fixture));
    expect(focused()).toBe('Nothing');

    press(all[0], 'ArrowDown');
    expect(focused()).toBe('Yesterday');
    press(all[1], 'ArrowUp');
    press(all[0], 'ArrowUp');
    expect(focused()).toBe('Preseason');
    press(all[2], 'ArrowDown');
    expect(focused()).toBe('Nothing');
    press(all[0], 'End');
    expect(focused()).toBe('Preseason');
    press(all[2], 'Home');
    expect(focused()).toBe('Nothing');

    expect(panel()).not.toBeNull();
    expect(sinceChange).not.toHaveBeenCalled();
    expect(cleared).not.toHaveBeenCalled();
  });

  it('opens the platform picker from "Pick a day" and changes nothing until a day is picked in it', () => {
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

  it('offers no day before the first on record nor later than yesterday', () => {
    const { fixture } = render(true, '2026-10-15');
    const input = field(fixture).nativeElement as HTMLInputElement;

    expect(input.min).toBe('2026-10-14');
    expect(input.max).toBe('2026-10-19');
  });

  it('turns "Pick a day" into a named field in the menu where the browser will not show a picker', async () => {
    const { fixture, sinceChange } = render(true, '2026-10-15');
    const hidden = field(fixture).nativeElement as HTMLInputElement;
    const hiddenFocus = vi.spyOn(hidden, 'focus');

    const { menu, typed } = await typedField(fixture);

    // The menu stays, and focus is on a field that can be seen and is named: never on the hidden
    // one, which is off the accessibility tree.
    expect(panel()).not.toBeNull();
    expect(menu.querySelector('.pick-day')).toBeNull();
    expect(typed.closest('label')!.textContent.trim()).toBe('Day');
    expect(document.activeElement).toBe(typed);
    expect(hiddenFocus).not.toHaveBeenCalled();
    expect(typed.min).toBe('2026-10-14');
    expect(typed.max).toBe('2026-10-19');
    expect(menu.querySelector('.range-note')!.textContent.trim()).toBe(
      'Pick a day from 14 Oct to 19 Oct.',
    );
    expect(sinceChange).not.toHaveBeenCalled();
  });

  it('takes a day typed into that field and closes the menu', async () => {
    const { fixture, sinceChange } = render(true, '2026-10-15');
    const { typed } = await typedField(fixture);

    typed.value = '2026-10-17';
    typed.dispatchEvent(new Event('change'));

    expect(sinceChange).toHaveBeenCalledExactlyOnceWith('2026-10-17');
    expect(panel()).toBeNull();
  });

  it('says so when the day typed is outside the days on record, and keeps the menu open', async () => {
    const { fixture, sinceChange } = render(true, '2026-10-15');
    const { menu, typed } = await typedField(fixture);

    typed.value = '2026-10-12';
    typed.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    expect(sinceChange).not.toHaveBeenCalled();
    expect(panel()).not.toBeNull();
    expect(typed.getAttribute('aria-invalid')).toBe('true');
    expect(typed.getAttribute('aria-describedby')).toBe('compare-menu-range');
    expect(menu.querySelector('.range-note')!.classList).toContain('range-note--outside');

    typed.value = '2026-10-16';
    typed.dispatchEvent(new Event('change'));

    expect(sinceChange).toHaveBeenCalledExactlyOnceWith('2026-10-16');
  });

  it('brings the menu back with the days there are when the picker hands over a day outside them', async () => {
    const { fixture, sinceChange } = render(true, '2026-10-15');
    const input = field(fixture).nativeElement as HTMLInputElement;

    input.value = '2026-10-12';
    input.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    await fixture.whenStable();

    expect(sinceChange).not.toHaveBeenCalled();
    const note = panel()!.querySelector('.range-note')!;
    expect(note.textContent.trim()).toBe('Pick a day from 14 Oct to 19 Oct.');
    expect(note.classList).toContain('range-note--outside');
  });

  it('keeps the day field out of the tab order and off the accessibility tree', () => {
    const { fixture } = render(false, null);

    expect(field(fixture).attributes['tabindex']).toBe('-1');
    expect(field(fixture).attributes['aria-hidden']).toBe('true');
  });

  it('offers nothing and the preseason alone while there is no day on record', () => {
    const { fixture } = render(false, null, null);

    const menu = open(fixture);

    expect(lines(menu).map((line) => line.label)).toEqual(['Nothing', 'Preseason']);
    expect(menu.querySelector('.pick-day')).toBeNull();
    expect(menu.querySelector('.divider')).toBeNull();
    expect(field(fixture).attributes['min']).toBe('2026-10-01');
  });
});
