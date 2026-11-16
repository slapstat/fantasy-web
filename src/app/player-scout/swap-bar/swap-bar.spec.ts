import { MockBuilder, MockRender, ngMocks } from 'ng-mocks';
import { SwapBarComponent } from './swap-bar';

describe('SwapBarComponent', () => {
  beforeEach(() => MockBuilder(SwapBarComponent));

  it('names the drop and what his going costs the lineup', () => {
    MockRender(SwapBarComponent, { name: 'Eeli Tolvanen', loss: '99.9', unit: 'points' });

    expect(ngMocks.formatText(ngMocks.find('.swap-text'))).toBe(
      'Dropping Eeli Tolvanen · your lineup loses 99.9 points',
    );
    expect(ngMocks.find('app-swap-bar').attributes['role']).toBe('region');
  });

  it('names him alone when his place could not be weighed', () => {
    MockRender(SwapBarComponent, { name: 'Eeli Tolvanen', loss: null, unit: 'Z-Score' });

    expect(ngMocks.formatText(ngMocks.find('.swap-text'))).toBe('Dropping Eeli Tolvanen');
  });

  it('asks for another drop on Change, and for none on the cross', () => {
    const pickAnother = vi.fn();
    const cleared = vi.fn();
    MockRender(SwapBarComponent, {
      name: 'Eeli Tolvanen',
      loss: '99.9',
      unit: 'points',
      pickAnother,
      cleared,
    });

    ngMocks.click('.swap-change');
    expect(pickAnother).toHaveBeenCalledTimes(1);
    ngMocks.click('.swap-clear');
    expect(cleared).toHaveBeenCalledTimes(1);
    expect(ngMocks.find('.swap-clear').attributes['aria-label']).toBe('Clear drop');
  });
});
