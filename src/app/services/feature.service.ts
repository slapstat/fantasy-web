import { Injectable, computed, inject } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { from } from 'rxjs';
import { Api } from '../api/api';
import { getFeatures } from '../api/fn/features/get-features';
import { CreateProjectionRequest } from '../api/models/create-projection-request';
import { MODEL_SOURCES, REST_OF_SEASON_PRESET_SOURCE } from '../models/ai-projection';

/**
 * What the BFF says this environment serves, read once per page load.
 *
 * <p>The BFF is the only place these are decided. It enforces the same answer at the endpoints
 * behind each feature, so a page that follows this cannot offer something every request for is
 * refused, and no build of the web can disagree with the server it talks to.
 */
@Injectable({ providedIn: 'root' })
export class FeatureService {
  private readonly api = inject(Api);

  // A failed read is not surfaced on purpose: it leaves the AI projection unoffered, which is what
  // the server would answer anyway if it is unreachable, and every page that offers it has its
  // own load against the same BFF that shows the outage.
  private readonly features = rxResource({
    stream: () => from(this.api.invoke(getFeatures)),
  });

  /**
   * Whether the answer is in, or has failed. A page that takes one of two paths by a feature waits
   * for this, rather than take the path the default points at and then switch.
   */
  readonly settled = computed(() => !this.features.isLoading());

  /**
   * Whether the AI projection is served here at all. False until the answer lands, so a preset
   * the environment turns out not to serve is never shown and then taken away. Nothing to do
   * with this account's plan: a locked AI projection is still served.
   */
  readonly aiProjection = computed(() =>
    this.features.hasValue() ? this.features.value().aiProjection : false,
  );

  /** Whether Draft Analysis is served here. False until the answer lands, like the others. */
  readonly draftAnalysis = computed(() =>
    this.features.hasValue() ? this.features.value().draftAnalysis : false,
  );

  /**
   * Whether Who's hot may narrow its board to the players a linked league has available. False
   * until the answer lands, like the others.
   */
  readonly whosHotAvailableFilter = computed(() =>
    this.features.hasValue() ? this.features.value().whosHotAvailableFilter : false,
  );

  /**
   * Whether a draft may be started from the rest of the season here. False until the answer
   * lands, like the others; true still offers it only while a season is under way, which
   * `RestOfSeasonService` asks.
   */
  readonly restOfSeasonPreset = computed(() =>
    this.features.hasValue() ? this.features.value().restOfSeasonPreset : false,
  );

  /** Whether Player Scout is served here. False until the answer lands, like the others. */
  readonly playerScout = computed(() =>
    this.features.hasValue() ? this.features.value().playerScout : false,
  );
  /** Whether Role Changes is served here. False until the answer lands, like the others. */
  readonly roleChanges = computed(() =>
    this.features.hasValue() ? this.features.value().roleChanges : false,
  );
  /** Whether Start/Bench is served here. False until the answer lands, like the others. */
  readonly startBench = computed(() =>
    this.features.hasValue() ? this.features.value().startBench : false,
  );

  /**
   * The presets this environment offers: everything but the model-seeded ones where the AI
   * projection is not served, and everything but the rest of the season where that preset is
   * switched off on its own. A starting point the server will not fill in must not be offered,
   * on any page that lists presets.
   *
   * <p>The rest of the season has its own switch on the BFF, over and above the AI projection's,
   * and it was off in production while this method offered the preset wherever the model was
   * served. Nothing showed until the season started: `RestOfSeasonService` hid the preset between
   * seasons, and on the season's first day it appeared for everyone, with a preview the BFF
   * answered 404 and a Create it refused with 400 (FANTASY-WEB-H, 2026-10-17).
   */
  offeredPresets<T extends { readonly source: CreateProjectionRequest['source'] }>(
    presets: readonly T[],
  ): readonly T[] {
    return presets.filter((preset) => this.serves(preset.source ?? ''));
  }

  private serves(source: string): boolean {
    if (!MODEL_SOURCES.includes(source)) {
      return true;
    }
    if (!this.aiProjection()) {
      return false;
    }
    return source !== REST_OF_SEASON_PRESET_SOURCE || this.restOfSeasonPreset();
  }
}
