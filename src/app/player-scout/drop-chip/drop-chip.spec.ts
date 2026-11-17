import { MockBuilder, MockRender, ngMocks } from 'ng-mocks';
import { DropChipComponent } from './drop-chip';

describe('DropChipComponent', () => {
  beforeEach(() => MockBuilder(DropChipComponent));

  it('names the drop, and nothing of what his going costs', () => {
    MockRender(DropChipComponent, { name: 'Eeli Tolvanen' });

    expect(ngMocks.formatText(ngMocks.find('.drop-btn'))).toBe('Dropping Eeli Tolvanen');
  });

  it('asks for another drop on the words, and for none on the cross', () => {
    const pickAnother = vi.fn();
    const cleared = vi.fn();
    MockRender(DropChipComponent, { name: 'Eeli Tolvanen', pickAnother, cleared });

    ngMocks.click('.drop-btn');
    expect(pickAnother).toHaveBeenCalledTimes(1);
    expect(cleared).not.toHaveBeenCalled();
    ngMocks.click('.drop-clear');
    expect(cleared).toHaveBeenCalledTimes(1);
    expect(ngMocks.find('.drop-clear').attributes['aria-label']).toBeTruthy();
  });
});
