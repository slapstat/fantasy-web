import { signal } from '@angular/core';
import { MockBuilder, MockRender, ngMocks } from 'ng-mocks';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IconComponent } from '../../shared/icon/icon';
import { PopoverTriggerDirective } from '../../shared/popover/popover-trigger.directive';
import { PLANNER_LAYOUT, PlannerLayout } from '../../streamer-planner/planner-page-size';
import { RankFloorComponent } from './rank-floor';

describe('RankFloorComponent', () => {
  const layout = signal<PlannerLayout>('desktop');

  beforeEach(() => {
    layout.set('desktop');
    return MockBuilder(RankFloorComponent)
      .keep(IconComponent)
      .keep(PopoverTriggerDirective)
      .provide({ provide: PLANNER_LAYOUT, useValue: layout.asReadonly() });
  });

  afterEach(() => {
    document.querySelector('.cdk-overlay-container')?.remove();
  });

  function render(floor: number | null, depth: number | null = 192, ranked = 770) {
    const picked = vi.fn();
    const cleared = vi.fn();
    const fixture = MockRender(RankFloorComponent, { floor, depth, ranked, picked, cleared });
    return { fixture, picked, cleared };
  }

  type Fixture = ReturnType<typeof render>['fixture'];
  const button = (fixture: Fixture) => ngMocks.find(fixture, '.floor-btn');
  const cross = (fixture: Fixture) => ngMocks.find(fixture, '.floor-clear', null);
  const panel = () => document.querySelector<HTMLElement>('.app-popover-panel')!;
  const open = (fixture: Fixture) => {
    ngMocks.click(button(fixture));
    fixture.detectChanges();
    return panel();
  };
  const step = (depth: number) =>
    [...panel().querySelectorAll<HTMLButtonElement>('.step')].find(
      (el) => el.textContent?.trim() === String(depth),
    )!;

  it('names the question while no depth is held, and the depth once one is', () => {
    const { fixture } = render(null);
    expect(ngMocks.formatText(button(fixture))).toBe('Any rank');
    expect(cross(fixture)).toBeNull();

    const held = render(200).fixture;
    expect(ngMocks.formatText(button(held))).toBe('Top 200');
    expect(cross(held)).not.toBeNull();
  });

  it('offers the league its own rostered depth, and marks it when it is the one held', () => {
    const { fixture, picked } = render(null, 192);
    const rostered = open(fixture).querySelector<HTMLButtonElement>('.rostered')!;
    expect(rostered.textContent?.trim()).toBe('Rostered depth (192)');
    expect(rostered.getAttribute('aria-pressed')).toBe('false');

    rostered.click();
    expect(picked).toHaveBeenCalledWith(192);

    expect(
      open(render(192, 192).fixture).querySelector('.rostered')!.getAttribute('aria-pressed'),
    ).toBe('true');
  });

  it('leaves the rostered depth out where it would cut nobody', () => {
    expect(open(render(null, 192, 150).fixture).querySelector('.rostered')).toBeNull();
    expect(open(render(null, null).fixture).querySelector('.rostered')).toBeNull();
  });

  it('holds the list to a depth pressed on the ladder, and closes behind the answer', () => {
    const { fixture, picked } = render(null);
    open(fixture);

    step(300).click();
    fixture.detectChanges();

    expect(picked).toHaveBeenCalledWith(300);
    expect(document.querySelector('.app-popover-panel')).toBeNull();
  });

  it('draws a depth every ranked player already sits inside as one that does not answer', () => {
    const { fixture } = render(null, null, 250);
    open(fixture);

    expect(step(100).disabled).toBe(false);
    expect(step(200).disabled).toBe(false);
    expect(step(300).disabled).toBe(true);
    expect(step(500).disabled).toBe(true);
  });

  it("takes a depth of the reader's own, and reads an emptied field as the whole list", () => {
    const { fixture, picked, cleared } = render(null);
    const own = open(fixture).querySelector<HTMLInputElement>('.own-input')!;

    own.value = '175';
    own.dispatchEvent(new Event('input'));
    expect(picked).toHaveBeenCalledWith(175);

    own.value = '';
    own.dispatchEvent(new Event('input'));
    expect(cleared).toHaveBeenCalled();
  });

  it('holds an own depth to the places there are, since a deeper one cuts nobody', () => {
    const { fixture, picked } = render(null, null, 300);
    const own = open(fixture).querySelector<HTMLInputElement>('.own-input')!;

    own.value = '900';
    own.dispatchEvent(new Event('input'));

    expect(picked).toHaveBeenCalledWith(299);
  });

  it('holds an own depth to nothing while no count of the ranked has landed', () => {
    const { fixture, picked } = render(null, null, 0);
    const own = open(fixture).querySelector<HTMLInputElement>('.own-input')!;
    expect(own.getAttribute('max')).toBeNull();

    own.value = '200';
    own.dispatchEvent(new Event('input'));

    expect(picked).toHaveBeenCalledWith(200);
  });

  it('gives the whole list back on the cross, and leaves focus on the pill', () => {
    const { fixture, cleared } = render(200);

    ngMocks.click(cross(fixture));

    expect(cleared).toHaveBeenCalled();
    expect(document.activeElement).toBe(button(fixture).nativeElement);
  });

  it('wears the depth alone on a phone, where the line has three controls on it', () => {
    layout.set('phone');
    const { fixture } = render(200);

    expect(ngMocks.formatText(button(fixture))).toBe('Top 200');
    // One span rather than the sentence's two: the words have nowhere to go on a phone.
    expect(ngMocks.findAll(fixture, '.floor-lead')).toHaveLength(0);
  });
});
