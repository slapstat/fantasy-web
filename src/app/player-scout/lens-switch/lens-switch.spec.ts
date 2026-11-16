import { MockBuilder, MockRender, ngMocks } from 'ng-mocks';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LensSwitchComponent } from './lens-switch';

describe('LensSwitchComponent', () => {
  beforeEach(() => MockBuilder(LensSwitchComponent));

  it('presses the side the headings sort by and asks for the other', () => {
    const picked = vi.fn();
    const fixture = MockRender(LensSwitchComponent, {
      lens: 'change',
      sinceLabel: 'vs 7 Oct',
      picked,
    });

    const options = ngMocks.findAll(fixture, '.lens-option');
    expect(options.map((option) => ngMocks.formatText(option))).toEqual(['Projection', 'Change']);
    expect(options.map((option) => option.nativeElement.getAttribute('aria-pressed'))).toEqual([
      'false',
      'true',
    ]);
    options[0].nativeElement.click();
    expect(picked).toHaveBeenCalledWith('value');
  });
});
