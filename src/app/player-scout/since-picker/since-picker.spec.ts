import { MockBuilder, MockRender, ngMocks } from 'ng-mocks';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ScoutSince } from '../../api/models/scout-since';
import { IconComponent } from '../../shared/icon/icon';
import {
  daysBefore,
  formatDay,
  seasonFloor,
  sinceCaption,
  SincePickerComponent,
} from './since-picker';

const TODAY = '2026-10-14';

describe('the day arithmetic', () => {
  it('counts days back across a month', () => {
    expect(daysBefore(TODAY, 7)).toBe('2026-10-07');
    expect(daysBefore(TODAY, 14)).toBe('2026-09-30');
    expect(daysBefore('2026-01-03', 5)).toBe('2025-12-29');
  });

  it('writes a day as the page does', () => {
    expect(formatDay('2026-10-07')).toBe('7 Oct');
    expect(formatDay(null)).toBe('');
  });

  it('floors a season at its first of October, on either side of the new year', () => {
    expect(seasonFloor('2026-10-14')).toBe('2026-10-01');
    expect(seasonFloor('2027-03-02')).toBe('2026-10-01');
    expect(seasonFloor('2026-09-20')).toBe('2026-10-01');
  });
});

describe('sinceCaption', () => {
  const kept: ScoutSince = {
    requested: '2026-10-07',
    kind: 'SNAPSHOT',
    resolved: '2026-10-07',
    earliestSnapshot: '2026-10-01',
  };

  it('says nothing when the day asked for answered, since the picker already shows it', () => {
    expect(sinceCaption(kept)).toEqual('');
  });

  it('says when a nearer day answered than the one asked for', () => {
    expect(sinceCaption({ ...kept, resolved: '2026-10-05' })).toEqual(
      'Compared with 5 Oct, the nearest day kept.',
    );
  });

  it('says the preseason projection stood in for a day nothing is kept from', () => {
    const caption = sinceCaption({
      requested: '2026-10-07',
      kind: 'PRESEASON',
      earliestSnapshot: '2026-10-15',
    });

    expect(caption).toEqual('Days are kept from 15 Oct. Compared with preseason.');
  });

  it('says so when no day-by-day projection is kept at all', () => {
    expect(sinceCaption({ requested: '2026-10-07', kind: 'PRESEASON' })).toEqual(
      'No day is kept yet. Compared with preseason.',
    );
  });

  it('says nothing when the preseason was asked for, since the picker already shows it', () => {
    expect(sinceCaption({ kind: 'PRESEASON' })).toEqual('');
  });

  it('says when there is nothing to compare with, and nothing until the answer lands', () => {
    expect(sinceCaption({ kind: 'NONE' })).toEqual('No earlier projection to compare with yet.');
    expect(sinceCaption(null)).toBe('');
  });
});

describe('SincePickerComponent', () => {
  beforeEach(() => MockBuilder(SincePickerComponent).keep(IconComponent));

  function render(
    on: boolean,
    since: string | null,
    earliestKept: string | null = '2026-10-07',
    sinceChange = vi.fn(),
    cleared = vi.fn(),
  ) {
    const fixture = MockRender(SincePickerComponent, {
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
  const segments = (fixture: Fixture) => ngMocks.findAll(fixture, '.segment');
  const daySegment = (fixture: Fixture) => ngMocks.find(fixture, '.segment--day');
  const field = (fixture: Fixture) => ngMocks.find(fixture, 'input[type=date]');

  it('offers off, the preseason and a day, and marks off while no comparison is on', () => {
    const { fixture } = render(false, null);

    const all = segments(fixture);
    expect(all).toHaveLength(3);
    expect(all.map((segment) => ngMocks.formatText(segment))).toEqual([
      'Off',
      'Preseason',
      'Pick a day',
    ]);
    expect(all[0].attributes['aria-pressed']).toBe('true');
    expect(all[1].nativeElement.classList).not.toContain('segment--active');
    expect(all[2].nativeElement.classList).not.toContain('segment--active');
  });

  it('marks the preseason as the pick once the comparison is on with no day', () => {
    const { fixture } = render(true, null);

    const all = segments(fixture);
    expect(all[0].attributes['aria-pressed']).toBe('false');
    expect(all[1].attributes['aria-pressed']).toBe('true');
  });

  it('wears the day as the page writes it once one is set, and marks it the pick', () => {
    const { fixture } = render(true, '2026-10-02');

    const day = daySegment(fixture);
    expect(ngMocks.formatText(day)).toBe('2 Oct');
    expect(day.attributes['aria-pressed']).toBe('true');
    expect(day.attributes['aria-label']).toBe('A day of your own: 2 Oct');
    expect(field(fixture).nativeElement.value).toBe('2026-10-02');
    expect(segments(fixture)[1].attributes['aria-pressed']).toBe('false');
  });

  it('keeps wearing the day while the comparison is off, without marking it', () => {
    const { fixture } = render(false, '2026-10-02');

    const day = daySegment(fixture);
    expect(ngMocks.formatText(day)).toBe('2 Oct');
    expect(day.attributes['aria-pressed']).toBe('false');
  });

  it('offers no day before the first kept nor later than yesterday', () => {
    const { fixture } = render(true, '2026-10-09', '2026-10-07');

    expect(field(fixture).attributes['min']).toBe('2026-10-07');
    expect(field(fixture).attributes['max']).toBe('2026-10-13');
  });

  it("floors the field at the season's first of October while no day is kept", () => {
    const { fixture } = render(false, null, null);

    expect(field(fixture).attributes['min']).toBe('2026-10-01');
    expect(daySegment(fixture).nativeElement.disabled).toBe(false);
  });

  it('keeps the day field out of the tab order and off the accessibility tree', () => {
    const { fixture } = render(false, null);

    expect(field(fixture).attributes['tabindex']).toBe('-1');
    expect(field(fixture).attributes['aria-hidden']).toBe('true');
  });

  it('emits null for the preseason and the day picked in the field, and off for off', () => {
    const { fixture, sinceChange, cleared } = render(true, '2026-10-02');
    const input = field(fixture);

    ngMocks.click(segments(fixture)[1]);
    input.nativeElement.value = '2026-10-10';
    input.nativeElement.dispatchEvent(new Event('change'));
    ngMocks.click(segments(fixture)[0]);

    expect(sinceChange.mock.calls).toEqual([[null], ['2026-10-10']]);
    expect(cleared).toHaveBeenCalledTimes(1);
  });

  it('switches on against a week back when the day segment is pressed from the preseason', () => {
    const { fixture, sinceChange } = render(true, null);

    ngMocks.click(daySegment(fixture));

    expect(sinceChange).toHaveBeenCalledWith('2026-10-07');
  });

  it('switches on against the first kept day when a week back is before it', () => {
    const { fixture, sinceChange } = render(true, null, '2026-10-10');

    ngMocks.click(daySegment(fixture));

    expect(sinceChange).toHaveBeenCalledWith('2026-10-10');
  });

  it('switches the comparison back on against the day it kept when the segment is pressed', () => {
    const { fixture, sinceChange } = render(false, '2026-10-02');

    ngMocks.click(daySegment(fixture));

    expect(sinceChange).toHaveBeenCalledWith('2026-10-02');
  });

  it('opens the picker, and leaves the pick alone, when pressed while it is the pick', () => {
    const { fixture, sinceChange } = render(true, '2026-10-02');
    const showPicker = vi.fn();
    field(fixture).nativeElement.showPicker = showPicker;

    ngMocks.click(daySegment(fixture));

    expect(showPicker).toHaveBeenCalledTimes(1);
    expect(sinceChange).not.toHaveBeenCalled();
  });

  it('falls back to the field itself where the browser will not show a picker', () => {
    const { fixture } = render(true, '2026-10-02');
    const input = field(fixture).nativeElement as HTMLInputElement;
    input.showPicker = vi.fn(() => {
      throw new DOMException('no activation', 'NotAllowedError');
    });
    const focus = vi.spyOn(input, 'focus');

    ngMocks.click(daySegment(fixture));

    expect(focus).toHaveBeenCalledTimes(1);
  });

  it('disables the day while the season has no kept day before today', () => {
    const { fixture, sinceChange } = render(false, null, '2026-10-14');

    const day = daySegment(fixture);
    expect(day.nativeElement.disabled).toBe(true);
    ngMocks.click(day);

    expect(sinceChange).not.toHaveBeenCalled();
  });
});
