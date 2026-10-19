import { ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MockBuilder } from 'ng-mocks';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FeatureService } from './feature.service';
import { Api } from '../api/api';
import { getFeatures } from '../api/fn/features/get-features';

describe('FeatureService', () => {
  const invoke = vi.fn();
  const presets = [
    { source: 'default' as const },
    { source: 'model' as const },
    { source: 'rest_of_season' as const },
    { source: 'blank' as const },
  ];

  beforeEach(() => {
    invoke.mockReset();
    return MockBuilder(FeatureService).mock(Api, { invoke });
  });

  const answered = async () => {
    const service = TestBed.inject(FeatureService);
    // Reading the signal is what starts the load; stability is when it has landed.
    service.aiProjection();
    await TestBed.inject(ApplicationRef).whenStable();
    return service;
  };

  it('offers nothing until the BFF has answered', () => {
    invoke.mockReturnValue(new Promise(() => undefined));

    const service = TestBed.inject(FeatureService);

    expect(service.aiProjection()).toEqual(false);
    expect(service.offeredPresets(presets).map((preset) => preset.source)).toEqual([
      'default',
      'blank',
    ]);
  });

  it('offers every preset where the BFF serves the AI projection and the rest of the season', async () => {
    invoke.mockResolvedValue({ aiProjection: true, restOfSeasonPreset: true });

    const service = await answered();

    expect(invoke).toHaveBeenCalledWith(getFeatures);
    expect(service.aiProjection()).toEqual(true);
    expect(service.offeredPresets(presets)).toEqual(presets);
  });

  // The rest of the season has a switch of its own on the BFF. Off, the BFF answers its preview
  // 404 and refuses to create from it, so offering it is a card every press on which fails.
  it('drops the rest-of-season preset where only that is switched off, and keeps the model', async () => {
    invoke.mockResolvedValue({ aiProjection: true, restOfSeasonPreset: false });

    const service = await answered();

    expect(service.offeredPresets(presets).map((preset) => preset.source)).toEqual([
      'default',
      'model',
      'blank',
    ]);
  });

  it('drops the rest-of-season preset where the BFF says nothing about it', async () => {
    invoke.mockResolvedValue({ aiProjection: true });

    const service = await answered();

    expect(service.offeredPresets(presets).map((preset) => preset.source)).toEqual([
      'default',
      'model',
      'blank',
    ]);
  });

  it('drops the model preset where the BFF does not serve it', async () => {
    invoke.mockResolvedValue({ aiProjection: false });

    const service = await answered();

    expect(service.aiProjection()).toEqual(false);
    expect(service.offeredPresets(presets).map((preset) => preset.source)).toEqual([
      'default',
      'blank',
    ]);
  });

  it('reports the rest-of-season preset as the BFF does, and off until it answers', async () => {
    invoke.mockResolvedValue({ aiProjection: true, restOfSeasonPreset: false });
    expect(TestBed.inject(FeatureService).restOfSeasonPreset()).toEqual(false);

    expect((await answered()).restOfSeasonPreset()).toEqual(false);
  });

  it('offers the rest-of-season preset where the BFF switches it on', async () => {
    invoke.mockResolvedValue({ aiProjection: true, restOfSeasonPreset: true });

    expect((await answered()).restOfSeasonPreset()).toEqual(true);
  });

  it('reports Player Scout as the BFF does, and off until it answers', async () => {
    invoke.mockResolvedValue({ aiProjection: true, playerScout: true });
    expect(TestBed.inject(FeatureService).playerScout()).toEqual(false);

    expect((await answered()).playerScout()).toEqual(true);
  });

  it('reports Role Changes as the BFF does, and off until it answers', async () => {
    invoke.mockResolvedValue({ aiProjection: true, roleChanges: true });
    expect(TestBed.inject(FeatureService).roleChanges()).toEqual(false);

    expect((await answered()).roleChanges()).toEqual(true);
  });

  it('is not settled while the BFF has yet to answer', () => {
    invoke.mockReturnValue(new Promise(() => undefined));

    const service = TestBed.inject(FeatureService);

    expect(service.settled()).toEqual(false);
  });

  it('is settled once the BFF has answered', async () => {
    invoke.mockResolvedValue({ aiProjection: true });

    expect((await answered()).settled()).toEqual(true);
  });

  // A page that waits for the answer must not wait forever when it fails.
  it('is settled when the answer fails', async () => {
    invoke.mockRejectedValue(new Error('offline'));

    expect((await answered()).settled()).toEqual(true);
  });

  // Offering a preset the server may not serve is the failure this service exists to prevent, so
  // not knowing counts as not served.
  it('does not offer the AI projection when the answer never arrives', async () => {
    invoke.mockRejectedValue(new Error('offline'));

    const service = await answered();

    expect(service.aiProjection()).toEqual(false);
  });
});
