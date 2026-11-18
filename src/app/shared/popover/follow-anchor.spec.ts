import { OverlayRef } from '@angular/cdk/overlay';
import { Subject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { followAnchor } from './follow-anchor';

describe('followAnchor', () => {
  let frames: FrameRequestCallback[];
  let anchor: HTMLElement;
  let box: { top: number; left: number; width: number; height: number };
  let detachments: Subject<void>;
  let overlayRef: OverlayRef;
  let gone: ReturnType<typeof vi.fn<() => void>>;

  /** Runs the frame the helper asked for, as the browser would on its next paint. */
  function nextFrame(): void {
    const due = frames;
    frames = [];
    due.forEach((callback) => callback(0));
  }

  beforeEach(() => {
    frames = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.stubGlobal('cancelAnimationFrame', () => (frames = []));
    box = { top: 100, left: 50, width: 120, height: 30 };
    anchor = document.createElement('button');
    document.body.append(anchor);
    anchor.getBoundingClientRect = () =>
      ({ ...box, bottom: box.top + box.height, right: box.left + box.width }) as DOMRect;
    detachments = new Subject<void>();
    overlayRef = {
      overlayElement: document.createElement('div'),
      updatePosition: vi.fn(),
      detachments: () => detachments,
    } as unknown as OverlayRef;
    gone = vi.fn<() => void>();
  });

  afterEach(() => {
    anchor.remove();
    vi.unstubAllGlobals();
  });

  it('leaves the overlay alone while its anchor stays put', () => {
    followAnchor(overlayRef, anchor, gone);
    nextFrame();
    nextFrame();

    expect(overlayRef.updatePosition).not.toHaveBeenCalled();
    expect(gone).not.toHaveBeenCalled();
  });

  it('repositions the overlay when something above pushes its anchor down the page', () => {
    followAnchor(overlayRef, anchor, gone);
    nextFrame();

    box = { ...box, top: 400, left: 350 };
    nextFrame();

    expect(overlayRef.updatePosition).toHaveBeenCalledTimes(1);
  });

  it('says the anchor is gone once it is scrolled out of the window, and stops looking', () => {
    followAnchor(overlayRef, anchor, gone);
    nextFrame();

    box = { ...box, top: -200 };
    nextFrame();

    expect(gone).toHaveBeenCalledTimes(1);
    expect(frames).toEqual([]);
  });

  it('says the anchor is gone once it leaves the document', () => {
    followAnchor(overlayRef, anchor, gone);
    anchor.remove();
    nextFrame();

    expect(gone).toHaveBeenCalledTimes(1);
  });

  it('stops by itself when the overlay closes', () => {
    followAnchor(overlayRef, anchor, gone);
    detachments.next();

    box = { ...box, top: 400 };
    nextFrame();

    expect(frames).toEqual([]);
    expect(overlayRef.updatePosition).not.toHaveBeenCalled();
  });
});
