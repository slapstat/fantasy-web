import { MockBuilder, MockedComponentFixture, MockInstance, MockRender, ngMocks } from 'ng-mocks';
import { signal } from '@angular/core';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Observable, of, throwError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, Router } from '@angular/router';
import { CREATE_PRESETS, ProjectionCreateComponent, requestedPreset } from './projection-create';
import { ProjectionStorageService } from '../services/projection-storage.service';
import { StartingPointPreviewComponent } from '../shared/starting-point-preview/starting-point-preview';
import { ProjectionBoardCache } from '../services/projection-board-cache';
import { StatInfoService } from '../services/stat-info.service';
import { CreateProjectionRequest } from '../api/models/create-projection-request';
import { ProjectionResponse } from '../api/models/projection-response';
import { ProjectionSummaryResponse } from '../api/models/projection-summary-response';
import { PlayerService } from '../services/player.service';
import { NotificationService } from '../services/notification.service';
import { ProjectionRankingService } from '../services/projection-ranking.service';
import { ProjectionModelService } from '../services/projection-model.service';
import { EntitlementService } from '../services/entitlement.service';
import { ProjectionSerializerService } from '../services/projection-serializer.service';
import { SeededProjectionResponse } from '../api/models/seeded-projection-response';
import { ModelBoardResponse } from '../api/models/model-board-response';
import { ProjectionCalculationService } from '../services/projection-calculation.service';
import { Goalie, Skater } from '../models/player.model';
import { SkaterPosition } from '../models/position.model';
import { GoalieScoringStats, SkaterScoringStats } from '../models/projection.model';
import { GOALIE_SCORING_STAT_KEYS, SKATER_SCORING_STAT_KEYS } from '../models/stat-key.model';
import { FeatureService } from '../services/feature.service';
import { MODEL_SOURCES } from '../models/ai-projection';
import { RestOfSeasonService } from '../services/rest-of-season.service';

describe('ProjectionCreateComponent', () => {
  MockInstance.scope();

  /** The preview the page draws, read where these tests used to read the page itself. */
  const previewOf = (fixture: MockedComponentFixture<ProjectionCreateComponent>) =>
    ngMocks.find(fixture.debugElement, StartingPointPreviewComponent).componentInstance;

  const created: ProjectionResponse = {
    id: 'new-id',
    kind: 'projection',
    name: 'Dynasty',
    season: '20262027',
    autoNamed: false,
    createdAt: '2026-06-01T00:00:00Z',
    updatedAt: '2026-06-01T00:00:00Z',
    data: { settings: {} as never, players: [] },
  };

  const source: ProjectionResponse = {
    id: 'src',
    kind: 'projection',
    name: 'Source',
    season: '20262027',
    autoNamed: false,
    createdAt: '2026-06-01T00:00:00Z',
    updatedAt: '2026-06-01T00:00:00Z',
    data: {
      settings: {
        scoringType: 'category',
        statWeights: { goals: 5 },
        activeScoringColumns: ['goals'],
        activeUtilityColumns: ['gp'],
        scaleSettings: {},
        decimalSettings: { goals: 0 },
        useDefaultDecimals: false,
        leagueSize: 10,
        rosterSlots: { c: 1, lw: 1, rw: 1, w: 0, f: 0, d: 2, util: 1, bn: 2, g: 2 },
        minGoalieGames: 25,
      },
      players: [
        {
          playerId: 1,
          type: 'skater',
          stats: {
            utility: { gp: 82 },
            scoring: {
              stpg: 0,
              stpa: 0,
              stp: 0,
              hatTricks: 0,
              defPoints: 0,
              shifts: 0,
              toi: 0,
              goals: 64,
            },
          },
        },
      ],
    },
  };

  const summary: ProjectionSummaryResponse = {
    id: 'p1',
    kind: 'projection',
    name: 'My Projection',
    draftStatus: 'none',
    season: '20262027',
    autoNamed: false,
    createdAt: '2026-06-01T00:00:00Z',
    updatedAt: '2026-06-01T00:00:00Z',
  };

  const skater = (id: number, name: string, goals: number): Skater => ({
    type: 'skater',
    id,
    name,
    teamAbbrev: 'TOR',
    positions: new Set<SkaterPosition>(['C']),
    stats: {
      utility: { gp: 82, toiPerGame: 1200 },
      scoring: {
        ...(Object.fromEntries(
          SKATER_SCORING_STAT_KEYS.map((key) => [key, 0]),
        ) as SkaterScoringStats),
        goals,
        assists: 40,
        // Inverse to the goals, so sorting by hits is a different five in a different order.
        hits: 100 - goals,
      },
    },
  });

  // Enough games to be a qualified starter, but a modest enough season to rank below every
  // skater — which is what makes the reserved goalie row worth having.
  const goalie: Goalie = {
    type: 'goalie',
    id: 7,
    name: 'Only Goalie',
    teamAbbrev: 'WPG',
    stats: {
      utility: { gp: 40 },
      scoring: {
        ...(Object.fromEntries(
          GOALIE_SCORING_STAT_KEYS.map((key) => [key, 0]),
        ) as GoalieScoringStats),
        w: 1,
        sv: 10,
        ga: 5,
      },
    },
  };

  const skaters = [
    skater(1, 'Best Player', 60),
    skater(2, 'Second Player', 50),
    skater(3, 'Third Player', 40),
    skater(4, 'Fourth Player', 30),
    skater(5, 'Fifth Player', 20),
    skater(6, 'Sixth Player', 10),
  ];

  const players = [...skaters, goalie];

  // The model reaches three of the six skaters and none of the goalie, and rates them in the
  // opposite order to last season — so a preview drawn from it cannot be mistaken for the
  // last-season one.
  const seeded: SeededProjectionResponse = {
    season: 2026,
    modelVersion: 'test-1',
    skaters: 3,
    goalies: 0,
    unmapped: 0,
    goaliesWithoutWorkload: 2,
    players: [4, 5, 6].map((id) => ({
      playerId: id,
      type: 'skater' as const,
      stats: {
        utility: { gp: 82, toiPerGame: 1200 },
        scoring: {
          ...(Object.fromEntries(SKATER_SCORING_STAT_KEYS.map((key) => [key, 0])) as Record<
            string,
            number
          >),
          goals: id * 10,
          assists: 40,
          hits: 0,
        },
      },
    })),
  };

  const seed = vi.fn<() => Observable<SeededProjectionResponse>>(() => of(seeded));

  /**
   * What Create writes from the AI preset: the model's lines, and last season's for everyone the
   * model does not reach — the BFF's reconciliation, done by hand.
   */
  const reached = new Set(seeded.players.map((row) => row.playerId));
  const createdBoard: ModelBoardResponse = {
    players: [
      ...seeded.players,
      ...players
        .filter((player) => !reached.has(player.id))
        .map((player) => ({
          playerId: player.id,
          type: player.type,
          stats: player.stats,
        })),
    ],
  };
  const board = vi.fn<() => Observable<ModelBoardResponse>>(() => of(createdBoard));

  const navigate = vi.fn();
  const notifyError = vi.fn();
  /** The query string the page opened with; the same object is handed to every render. */
  const queryParams: Record<string, string> = {};
  /** A subscriber unless a test says otherwise, so the AI projection is open to the page. */
  const premium = signal(true);
  const aiProjection = signal(true);
  /** A season under way unless a test says otherwise, so the rest of it is on the page. */
  const restOfSeasonAvailable = signal(true);
  const entitlementLoadState = signal<'idle' | 'loading' | 'loaded' | 'error'>('loaded');
  const createProjection = vi.fn<
    (request: CreateProjectionRequest) => Observable<ProjectionResponse>
  >(() => of(created));

  beforeEach(() => {
    premium.set(true);
    aiProjection.set(true);
    restOfSeasonAvailable.set(true);
    entitlementLoadState.set('loaded');
    navigate.mockClear();
    notifyError.mockClear();
    createProjection.mockClear();
    seed.mockClear();
    board.mockClear();
    for (const key of Object.keys(queryParams)) {
      delete queryParams[key];
    }
    return (
      MockBuilder(ProjectionCreateComponent)
        // The preview is kept real: these tests read the page through the table it draws, which is
        // what the page is for. Its own contract is covered in starting-point-preview.spec.ts.
        .keep(StartingPointPreviewComponent)
        // The page provides it and the preview shares it; mocked, neither can load a board.
        .keep(ProjectionBoardCache)
        .keep(StatInfoService)
        .keep(ProjectionRankingService)
        .keep(ProjectionCalculationService)
        .keep(ProjectionSerializerService)
        .mock(ProjectionModelService, { seed, board })
        .mock(PlayerService, {
          getPlayers: () => of(players),
          getRookieIds: () => of(new Set([3])),
        })
        .mock(ProjectionStorageService, {
          listEditable: () => of([]),
          createProjection,
          loadProjection: () => of(source),
        })
        .mock(NotificationService, { error: notifyError })
        .mock(EntitlementService, { premium, loadState: entitlementLoadState })
        .mock(FeatureService, { aiProjection })
        .mock(RestOfSeasonService, {
          available: restOfSeasonAvailable,
          // What the real one does, out of the two answers above: see rest-of-season.service.spec.ts.
          offeredPresets: <T extends { readonly source?: string | null }>(presets: readonly T[]) =>
            presets.filter(
              (preset) =>
                (aiProjection() || !MODEL_SOURCES.includes(preset.source ?? '')) &&
                (preset.source !== 'rest_of_season' || restOfSeasonAvailable()),
            ),
        })
        .provide({ provide: Router, useValue: { navigate } })
        .provide({ provide: ActivatedRoute, useValue: { snapshot: { queryParams } } })
    );
  });

  describe('the preset a link asks for', () => {
    it.each([
      ['the AI projection', 'model'],
      ['the rest of the season', 'rest_of_season'],
    ])('opens on %s when the link says so', async (_name, source) => {
      queryParams['start'] = source;
      const fixture = MockRender(ProjectionCreateComponent);
      await fixture.whenStable();

      expect(fixture.point.componentInstance.startingPoint()).toEqual({
        kind: 'preset',
        source,
      });
    });

    /**
     * The AI preset is offered only once the BFF has said it serves the model, and the page
     * falls back to the first card whenever the picked one is not offered. The pick has to
     * wait for the answer, or the answer would undo it.
     */
    it('waits for the environment to offer the preset before picking it', async () => {
      queryParams['start'] = 'model';
      aiProjection.set(false);
      const fixture = MockRender(ProjectionCreateComponent);
      await fixture.whenStable();
      const component = fixture.point.componentInstance;
      expect(component.startingPoint()).toEqual({ kind: 'preset', source: 'default' });

      aiProjection.set(true);
      fixture.detectChanges();
      expect(component.startingPoint()).toEqual({ kind: 'preset', source: 'model' });
    });

    it('ignores a value that names no preset', async () => {
      queryParams['start'] = 'own1';
      const fixture = MockRender(ProjectionCreateComponent);
      await fixture.whenStable();

      expect(fixture.point.componentInstance.startingPoint()).toEqual({
        kind: 'preset',
        source: 'default',
      });
    });

    it('only knows the presets the page has', () => {
      expect(requestedPreset('model')).toEqual('model');
      expect(requestedPreset('blank')).toEqual('blank');
      expect(requestedPreset('copy')).toBeNull();
      expect(requestedPreset(undefined)).toBeNull();
    });
  });

  it('loads the existing projections', async () => {
    const fixture = MockRender(ProjectionCreateComponent);
    await fixture.whenStable();
    expect(fixture.point.componentInstance.isLoading()).toEqual(false);
  });

  it('prefills the name with a suggestion and requires one to create', async () => {
    const fixture = MockRender(ProjectionCreateComponent);
    await fixture.whenStable();
    const component = fixture.point.componentInstance;

    expect(component.name()).toEqual('My Projection');
    expect(component.canCreate()).toEqual(true);
    component.name.set('   ');
    expect(component.canCreate()).toEqual(false);
  });

  it('suffixes the suggested name when it is already taken', async () => {
    MockInstance(
      ProjectionStorageService,
      'listEditable',
      vi.fn(() =>
        of([
          { ...summary, id: 'p1', name: 'My Projection' },
          { ...summary, id: 'p2', name: 'My Projection 2' },
        ]),
      ),
    );

    const fixture = MockRender(ProjectionCreateComponent);
    await fixture.whenStable();

    expect(fixture.point.componentInstance.name()).toEqual('My Projection 3');
  });

  // An imported board takes a name as surely as one of the user's own does: they are listed
  // together, and the server keeps them in one namespace.
  it('skips a name an imported board is already using', async () => {
    MockInstance(
      ProjectionStorageService,
      'listEditable',
      vi.fn(() =>
        of([
          { ...summary, id: 'p1', name: 'My Projection' },
          { ...summary, id: 's1', kind: 'imported' as const, name: 'My Projection 2' },
        ]),
      ),
    );

    const fixture = MockRender(ProjectionCreateComponent);
    await fixture.whenStable();

    expect(fixture.point.componentInstance.name()).toEqual('My Projection 3');
  });

  // The server refuses it either way; this is about hearing so on the field rather than in a
  // toast after the round trip.
  it('blocks a name already taken, and says so on the field', async () => {
    MockInstance(
      ProjectionStorageService,
      'listEditable',
      vi.fn(() => of([{ ...summary, id: 's1', kind: 'imported' as const, name: "Erik's board" }])),
    );

    const fixture = MockRender(ProjectionCreateComponent);
    await fixture.whenStable();
    const component = fixture.point.componentInstance;

    component.name.set("  Erik's board  ");
    fixture.detectChanges();

    expect(component.nameTaken()).toBe(true);
    expect(component.canCreate()).toEqual(false);
    expect(fixture.nativeElement.querySelector('.field-error').textContent).toContain(
      'A projection with that name already exists',
    );

    component.name.set('Something else');
    expect(component.nameTaken()).toBe(false);
    expect(component.canCreate()).toEqual(true);
  });

  it('creates a projection and navigates to edit mode', async () => {
    const fixture = MockRender(ProjectionCreateComponent);
    await fixture.whenStable();
    const component = fixture.point.componentInstance;

    component.name.set('Dynasty');
    component.create();

    expect(createProjection).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledWith(['/projections', 'new-id']);
  });

  // Names are unique per user, and the name is a field on this page, so a clash is something to
  // say here rather than a reason to leave.
  it('says the name is taken when the server rejects it (409), and stays put', async () => {
    createProjection.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 409 })));
    const fixture = MockRender(ProjectionCreateComponent);
    await fixture.whenStable();
    const component = fixture.point.componentInstance;

    component.name.set('Dynasty');
    component.create();

    expect(notifyError).toHaveBeenCalledWith('A projection with that name already exists.');
    expect(navigate).not.toHaveBeenCalled();
    expect(component.isCreating()).toEqual(false);
  });

  // The toast is all the user sees; the report behind it is all we see, so it carries what the
  // BFF answered rather than the sentence alone.
  it('reports what the server answered when it refuses for a reason the page has no words for', async () => {
    createProjection.mockReturnValueOnce(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 400,
            error: { code: 'BAD_REQUEST', message: 'source=rest_of_season is unavailable' },
          }),
      ),
    );
    const fixture = MockRender(ProjectionCreateComponent);
    await fixture.whenStable();
    const component = fixture.point.componentInstance;

    component.name.set('Dynasty');
    component.create();

    expect(notifyError).toHaveBeenCalledWith("Couldn't create the projection. Please try again.", {
      status: 400,
      code: 'BAD_REQUEST',
      message: 'source=rest_of_season is unavailable',
    });
    expect(navigate).not.toHaveBeenCalled();
    expect(component.isCreating()).toEqual(false);
  });

  describe('the three groups of starting points', () => {
    const listed = [
      { ...summary, id: 'own1', kind: 'projection' as const, name: 'Dynasty' },
      {
        ...summary,
        id: 'shared1',
        kind: 'imported' as const,
        name: "Alex's board",
        origin: { shareToken: 'tok', authorUsername: 'alex' },
      },
    ];

    /** A spreadsheet upload: the same `imported` kind, and none of somebody else's ownership. */
    const fromSheet = {
      ...summary,
      id: 'sheet1',
      kind: 'imported' as const,
      name: 'My sheet',
    };

    /**
     * The split is who owns the board, not how it arrived. A spreadsheet the user uploaded is
     * theirs, so it is a starting point among their own rather than among what they follow.
     */
    it("counts a spreadsheet upload among the user's own starting points", async () => {
      MockInstance(
        ProjectionStorageService,
        'listEditable',
        vi.fn(() => of([...listed, fromSheet])),
      );

      const fixture = MockRender(ProjectionCreateComponent);
      await fixture.whenStable();
      const component = fixture.point.componentInstance;

      expect(component.ownProjections().map((row) => row.id)).toEqual(['own1', 'sheet1']);
      expect(component.followedBoards().map((row) => row.id)).toEqual(['shared1']);
      expect(component.sourceLabel(fromSheet)).toEqual('From a spreadsheet');
    });

    /** The door to a spreadsheet stands in the group the upload lands in, not beside the link. */
    it("puts the upload with the user's own boards and the follow field with the followed", async () => {
      MockInstance(
        ProjectionStorageService,
        'listEditable',
        vi.fn(() => of([...listed, fromSheet])),
      );

      const fixture = MockRender(ProjectionCreateComponent);
      await fixture.whenStable();
      const component = fixture.point.componentInstance;
      const root: HTMLElement = fixture.nativeElement;

      component.sourceKind.set('projection');
      fixture.detectChanges();
      expect(root.querySelector('app-spreadsheet-import-button')).not.toBeNull();
      expect(root.querySelector('app-share-import')).toBeNull();

      component.sourceKind.set('following');
      fixture.detectChanges();
      expect(root.querySelector('app-share-import')).not.toBeNull();
      expect(root.querySelector('app-spreadsheet-import-button')).toBeNull();
    });

    it("picks a spreadsheet upload among the user's own boards", async () => {
      const listEditable = vi.fn(() => of(listed));
      MockInstance(ProjectionStorageService, 'listEditable', listEditable);

      const fixture = MockRender(ProjectionCreateComponent);
      await fixture.whenStable();
      const component = fixture.point.componentInstance;

      component.onUploaded({ id: 'sheet9' } as ProjectionResponse);
      await fixture.whenStable();

      expect(component.sourceKind()).toEqual('projection');
      expect(component.isCopyOf('sheet9')).toBe(true);
      expect(listEditable).toHaveBeenCalledTimes(2);
    });

    it('splits what the user has into their own and what was shared with them', async () => {
      MockInstance(
        ProjectionStorageService,
        'listEditable',
        vi.fn(() => of(listed)),
      );

      const fixture = MockRender(ProjectionCreateComponent);
      await fixture.whenStable();
      const component = fixture.point.componentInstance;

      expect(component.ownProjections().map((row) => row.id)).toEqual(['own1']);
      expect(component.followedBoards().map((row) => row.id)).toEqual(['shared1']);
      expect(component.sourceLabel(listed[1])).toEqual('Following alex');
    });

    it('opens with last season picked, so there is always an answer', async () => {
      const fixture = MockRender(ProjectionCreateComponent);
      await fixture.whenStable();
      const component = fixture.point.componentInstance;

      expect(component.startingPoint()).toEqual({ kind: 'preset', source: 'default' });
      expect(component.canCreate()).toEqual(true);
    });

    // The three groups were tabs, and a tab holds an answer of its own: a copy picked under one
    // and a preset under another were both live at once, and pressing Create used whichever tab
    // happened to be open. One value cannot do that — picking either replaces the other.
    it('holds one starting point, so picking a preset drops a copy', async () => {
      MockInstance(
        ProjectionStorageService,
        'listEditable',
        vi.fn(() => of(listed)),
      );

      const fixture = MockRender(ProjectionCreateComponent);
      await fixture.whenStable();
      const component = fixture.point.componentInstance;

      component.selectCopyFrom('shared1');
      expect(component.isCopyOf('shared1')).toBe(true);

      component.selectPreset('model');
      expect(component.isCopyOf('shared1')).toBe(false);
      expect(component.isPreset('model')).toBe(true);

      component.create();
      expect(createProjection.mock.calls[0][0].source).toEqual('model');
    });

    // Four cards, each with an icon and what picking it means. The boards used to be radio rows
    // under the presets, all on the page at once, so a user with a few projections faced ten
    // radios before the question had registered.
    // The same shape as the draft picker: a segment per kind carrying its count, and the cards
    // of the open kind under it. The page opens on the presets, so the boards are one press away.
    it('asks for the kind with a segmented control, and cards for the open kind', async () => {
      MockInstance(
        ProjectionStorageService,
        'listEditable',
        vi.fn(() => of(listed)),
      );

      const fixture = MockRender(ProjectionCreateComponent);
      await fixture.whenStable();
      fixture.detectChanges();

      const root: HTMLElement = fixture.nativeElement;
      const texts = (selector: string) =>
        Array.from(root.querySelectorAll<HTMLElement>(selector)).map((element) =>
          element.textContent?.trim(),
        );

      expect(texts('.kind-name')).toEqual(['Preset', 'Your projection', 'Following']);
      expect(texts('.kind-count')).toEqual([`${CREATE_PRESETS.length}`, '1', '1']);
      expect(
        Array.from(root.querySelectorAll<HTMLElement>('.segmented .kind')).map((segment) =>
          segment.getAttribute('aria-pressed'),
        ),
      ).toEqual(['true', 'false', 'false']);

      // The presets are the open kind, one card each, with the first checked.
      expect(texts('.row-name')).toEqual(CREATE_PRESETS.map((preset) => preset.name));
      expect(root.querySelectorAll('.row-icon app-icon')).toHaveLength(CREATE_PRESETS.length);
      expect(root.querySelector('.row')?.classList.contains('row--selected')).toBe(true);
      // Folded, not gone: the segments say how many boards there are, one press away.
      expect(root.querySelector('app-projection-import')).toBeNull();
    });

    // Switching to a kind checks its first card, so Create is never a press away from nothing.
    it('checks the first card of the kind that is opened', async () => {
      MockInstance(
        ProjectionStorageService,
        'listEditable',
        vi.fn(() => of(listed)),
      );

      const fixture = MockRender(ProjectionCreateComponent);
      await fixture.whenStable();
      const component = fixture.point.componentInstance;
      const root: HTMLElement = fixture.nativeElement;

      component.sourceKind.set('projection');
      fixture.detectChanges();
      expect(component.startingPoint()).toEqual({ kind: 'copy', id: 'own1' });
      expect(component.canCreate()).toEqual(true);
      expect(
        Array.from(root.querySelectorAll<HTMLElement>('.row-name')).map((name) =>
          name.textContent?.trim(),
        ),
      ).toEqual(['Dynasty']);

      component.sourceKind.set('following');
      fixture.detectChanges();
      expect(component.startingPoint()).toEqual({ kind: 'copy', id: 'shared1' });
      expect(root.querySelector('.row-meta')?.textContent?.trim()).toContain('Following alex');
      // The paste field belongs to the followed kind, where such a board comes from.
      expect(root.querySelector('app-share-import')).not.toBeNull();

      // A pick the user made is kept when the kind is left and come back to.
      component.sourceKind.set('preset');
      component.sourceKind.set('following');
      expect(component.startingPoint()).toEqual({ kind: 'copy', id: 'shared1' });
    });

    // An empty kind is still an answer to "what kind", so its segment stays; only Create waits.
    it('holds Create back on a kind with nothing in it', async () => {
      const fixture = MockRender(ProjectionCreateComponent);
      await fixture.whenStable();
      const component = fixture.point.componentInstance;
      const root: HTMLElement = fixture.nativeElement;

      component.sourceKind.set('projection');
      fixture.detectChanges();

      expect(component.startingPoint()).toEqual({ kind: 'copy', id: null });
      expect(component.copiedBoard()).toBeNull();
      expect(component.canCreate()).toEqual(false);
      expect(root.querySelector('.group-empty')?.textContent).toContain('No saved projections yet');
      expect(root.querySelector('.row')).toBeNull();
      expect(root.querySelector('.preview-note')?.textContent).toContain('Nothing to copy');

      component.sourceKind.set('preset');
      expect(component.canCreate()).toEqual(true);
    });

    // A copy is previewed out of the board it would copy — its rows, its numbers, its columns.
    // It used to be a sentence naming the board, because the page never downloaded one.
    it('previews the board a copy would be made of', async () => {
      MockInstance(
        ProjectionStorageService,
        'listEditable',
        vi.fn(() => of(listed)),
      );

      const fixture = MockRender(ProjectionCreateComponent);
      await fixture.whenStable();
      const component = fixture.point.componentInstance;

      expect(component.copiedBoard()).toBeNull();

      component.selectCopyFrom('shared1');
      await fixture.whenStable();
      fixture.detectChanges();

      expect(component.copiedBoard()?.id).toEqual('shared1');
      // The board's own row, with the board's own number on it — not the 60 goals last season
      // gave the same player, which is what every preset preview would show.
      const rows = previewOf(fixture).previewRows();
      expect(rows.map((row) => row.player.name)).toEqual(['Best Player']);
      expect((rows[0].projection.stats.scoring as SkaterScoringStats).goals).toEqual(64);
      expect(fixture.nativeElement.querySelector('.preview-card')).not.toBeNull();
    });

    // The board is scored and drawn the way it will open in the editor: a category board is not
    // previewed as a points one, and the columns are the ones it keeps.
    it("previews a copy with the board's own settings", async () => {
      MockInstance(
        ProjectionStorageService,
        'listEditable',
        vi.fn(() => of(listed)),
      );

      const fixture = MockRender(ProjectionCreateComponent);
      await fixture.whenStable();
      const component = fixture.point.componentInstance;

      component.selectCopyFrom('own1');
      await fixture.whenStable();

      expect(previewOf(fixture).previewScoringType()).toEqual('category');
      expect([...previewOf(fixture).previewActiveColumns().scoring]).toEqual(['goals']);
      expect([...previewOf(fixture).previewActiveColumns().utility]).toEqual(['gp']);
      expect(previewOf(fixture).previewDecimalSettings().goals).toEqual(0);
    });

    // Half a megabyte a board, so the preview's copy is the one Create sends — and picking a
    // board again after wandering off it does not fetch it a second time.
    it('downloads a board once, however often it is picked or created from', async () => {
      const loadProjection = vi.fn(() => of(source));
      MockInstance(
        ProjectionStorageService,
        'listEditable',
        vi.fn(() => of(listed)),
      );
      MockInstance(ProjectionStorageService, 'loadProjection', loadProjection);

      const fixture = MockRender(ProjectionCreateComponent);
      await fixture.whenStable();
      const component = fixture.point.componentInstance;

      component.selectCopyFrom('own1');
      await fixture.whenStable();
      component.selectPreset('default');
      component.selectCopyFrom('own1');
      await fixture.whenStable();
      component.create();

      expect(loadProjection).toHaveBeenCalledOnce();
      expect(createProjection).toHaveBeenCalledWith(
        expect.objectContaining({ data: source.data, source: undefined }),
      );
    });

    // The preview is decoration: a board that will not download costs the page the table, not
    // the sentence that was there before there was one, and not the Create button.
    it('names the board when its rows cannot be downloaded', async () => {
      MockInstance(
        ProjectionStorageService,
        'listEditable',
        vi.fn(() => of(listed)),
      );
      MockInstance(
        ProjectionStorageService,
        'loadProjection',
        vi.fn(() => throwError(() => new HttpErrorResponse({ status: 502 }))),
      );

      const fixture = MockRender(ProjectionCreateComponent);
      await fixture.whenStable();
      const component = fixture.point.componentInstance;

      component.selectCopyFrom('shared1');
      await fixture.whenStable();
      fixture.detectChanges();

      expect(previewOf(fixture).hasFailed()).toEqual(true);
      expect(component.canCreate()).toEqual(true);
      expect(fixture.nativeElement.querySelector('.preview-note').textContent).toContain(
        'exact copy of',
      );
      expect(fixture.nativeElement.querySelector('.preview-card')).toBeNull();
    });

    // A copy carries rows only the client has, whoever made them — the same path the user's own
    // projections take, which is the point of listing both as starting points.
    it('copies a shared board verbatim, sending no source', async () => {
      MockInstance(
        ProjectionStorageService,
        'listEditable',
        vi.fn(() => of(listed)),
      );

      const fixture = MockRender(ProjectionCreateComponent);
      await fixture.whenStable();
      const component = fixture.point.componentInstance;

      component.selectCopyFrom('shared1');
      component.create();

      expect(createProjection).toHaveBeenCalledWith(
        expect.objectContaining({ data: source.data, source: undefined }),
      );
    });

    it('picks a board the moment it is followed, and re-reads the list it belongs in', async () => {
      const listEditable = vi.fn(() => of(listed));
      MockInstance(ProjectionStorageService, 'listEditable', listEditable);

      const fixture = MockRender(ProjectionCreateComponent);
      await fixture.whenStable();
      const component = fixture.point.componentInstance;

      component.onFollowed({ id: 'fresh1' } as ProjectionResponse);
      await fixture.whenStable();

      // A followed board is the Following kind's, so the page opens it and checks the new card.
      expect(component.sourceKind()).toEqual('following');
      expect(component.isCopyOf('fresh1')).toBe(true);
      expect(listEditable).toHaveBeenCalledTimes(2);
    });
  });

  it('creates from scratch with default (points) settings', async () => {
    const fixture = MockRender(ProjectionCreateComponent);
    await fixture.whenStable();

    fixture.point.componentInstance.create();

    expect(createProjection).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          settings: expect.objectContaining({ scoringType: 'points' }),
        }),
      }),
    );
  });

  // The player rows are ~0.5 MB the client had just downloaded, and uploading them back was
  // failing outright for at least one user in production. The server derives them from source.
  it('asks the server to fill in the players instead of uploading them', async () => {
    const fixture = MockRender(ProjectionCreateComponent);
    await fixture.whenStable();

    fixture.point.componentInstance.create();

    const request = createProjection.mock.calls[0][0];
    expect(request.source).toEqual('default');
    expect(request.data.players).toEqual([]);
  });

  it('asks for zeroed players when creating a blank projection', async () => {
    const fixture = MockRender(ProjectionCreateComponent);
    await fixture.whenStable();
    const component = fixture.point.componentInstance;

    component.selectPreset('blank');
    component.create();

    expect(createProjection.mock.calls[0][0].source).toEqual('blank');
  });

  // A copy carries rows that only the client has, so it must keep sending them.
  it('sends no source when copying an existing projection', async () => {
    const fixture = MockRender(ProjectionCreateComponent);
    await fixture.whenStable();
    const component = fixture.point.componentInstance;

    component.selectCopyFrom('src');
    component.create();

    expect(createProjection.mock.calls[0][0].source).toBeUndefined();
  });

  it('copies the source projection data (settings and players) verbatim', async () => {
    const fixture = MockRender(ProjectionCreateComponent);
    await fixture.whenStable();
    const component = fixture.point.componentInstance;

    component.selectCopyFrom('src');
    component.create();

    expect(createProjection).toHaveBeenCalledWith(expect.objectContaining({ data: source.data }));
  });

  describe('league settings', () => {
    it('opens a preset on the league a new projection has, and a copy on its own', async () => {
      const fixture = MockRender(ProjectionCreateComponent);
      await fixture.whenStable();
      const component = fixture.point.componentInstance;

      expect(component.leagueSettings()?.scoringType).toEqual('points');

      component.selectCopyFrom('src');
      await fixture.whenStable();

      expect(component.leagueSettings()?.scoringType).toEqual('category');
      expect(component.leagueSettings()?.minGoalieGames).toEqual(25);
    });

    it('scores the preview by the league set here', async () => {
      const fixture = MockRender(ProjectionCreateComponent);
      await fixture.whenStable();
      const component = fixture.point.componentInstance;

      component.setLeagueSettings({ ...component.leagueSettings()!, scoringType: 'category' });
      fixture.detectChanges();

      expect(previewOf(fixture).leagueSettings()?.scoringType).toEqual('category');
    });

    it('creates a preset with the league set here', async () => {
      const fixture = MockRender(ProjectionCreateComponent);
      await fixture.whenStable();
      const component = fixture.point.componentInstance;

      component.setLeagueSettings({ ...component.leagueSettings()!, scoringType: 'category' });
      component.setStatWeights({ ...component.leagueSettings()!.statWeights, goals: 9 });
      component.create();

      const request = createProjection.mock.calls[0][0];
      expect(request.source).toEqual('default');
      expect(request.data.settings.scoringType).toEqual('category');
      expect(request.data.settings.statWeights['goals']).toEqual(9);
    });

    it('lays the league set here over a copy, and keeps its rows', async () => {
      const fixture = MockRender(ProjectionCreateComponent);
      await fixture.whenStable();
      const component = fixture.point.componentInstance;

      component.selectCopyFrom('src');
      await fixture.whenStable();
      component.setLeagueSettings({ ...component.leagueSettings()!, scoringType: 'points' });
      component.create();

      const request = createProjection.mock.calls[0][0];
      expect(request.data.settings.scoringType).toEqual('points');
      expect(request.data.settings.decimalSettings['goals']).toEqual(0);
      expect(request.data.players).toHaveLength(1);
      expect(request.data.draft).toBeUndefined();
    });

    // The presets differ only in their numbers, so a league set with one picked stays with the
    // others: an imported league falling back to the defaults on a preset switch read as lost.
    it('keeps the league set for one preset when another is picked', async () => {
      const fixture = MockRender(ProjectionCreateComponent);
      await fixture.whenStable();
      const component = fixture.point.componentInstance;

      component.setLeagueSettings({
        ...component.leagueSettings()!,
        leagueSize: 14,
        yahooSync: {
          leagueName: 'My league',
          leagueKey: '465.l.1',
          syncedAt: '2026-09-17T00:00:00Z',
        },
      });
      component.selectPreset('blank');

      expect(component.leagueSettings()?.leagueSize).toEqual(14);
      expect(component.leagueSettings()?.yahooSync?.leagueName).toEqual('My league');
      component.create();
      expect(createProjection.mock.calls[0][0].data.settings.yahooSync?.leagueName).toEqual(
        'My league',
      );
    });

    // A board carries a league of its own: the presets' league is not laid over it, and is still
    // there on the way back.
    it('keeps a board on its own league and the presets on theirs', async () => {
      const fixture = MockRender(ProjectionCreateComponent);
      await fixture.whenStable();
      const component = fixture.point.componentInstance;

      component.setLeagueSettings({ ...component.leagueSettings()!, leagueSize: 14 });
      component.selectCopyFrom('src');
      await fixture.whenStable();
      expect(component.leagueSettings()?.leagueSize).not.toEqual(14);

      component.selectPreset('default');
      expect(component.leagueSettings()?.leagueSize).toEqual(14);
    });

    // An import says which league the user plays in, which is as true of a copy as of a preset.
    it('creates a copy with the league imported while a preset was picked', async () => {
      const fixture = MockRender(ProjectionCreateComponent);
      await fixture.whenStable();
      const component = fixture.point.componentInstance;

      component.setLeagueSettings({
        ...component.leagueSettings()!,
        scoringType: 'points',
        yahooSync: {
          leagueName: 'My league',
          leagueKey: '465.l.1',
          syncedAt: '2026-09-17T00:00:00Z',
        },
      });
      component.selectCopyFrom('src');
      await fixture.whenStable();

      expect(component.leagueSettings()?.yahooSync?.leagueName).toEqual('My league');
      expect(component.leagueSettings()?.scoringType).toEqual('points');
      // Not something an import sets, so the board's own stays.
      expect(component.leagueSettings()?.minGoalieGames).toEqual(25);
      component.create();
      const request = createProjection.mock.calls[0][0];
      expect(request.data.settings.yahooSync?.leagueName).toEqual('My league');
      expect(request.data.settings.scoringType).toEqual('points');
      expect(request.data.players).toHaveLength(1);
    });

    it('says the settings can be changed later', async () => {
      const fixture = MockRender(ProjectionCreateComponent);
      await fixture.whenStable();
      fixture.detectChanges();

      expect(fixture.nativeElement.querySelector('.league .field-hint').textContent).toContain(
        'change these later',
      );
    });

    // The import's label under the cards is deliberately not among them: it is a way into the
    // starting-point section, and as a fourth heading it made the page read as five steps.
    it('heads its three sections, and only those, with a heading', async () => {
      const fixture = MockRender(ProjectionCreateComponent);
      await fixture.whenStable();
      fixture.detectChanges();

      const titles = Array.from<HTMLElement>(fixture.nativeElement.querySelectorAll('h2')).map(
        (title) => title.textContent?.trim(),
      );
      expect(titles).toEqual(['Starting point', 'League settings', 'Preview']);
    });
  });

  // The board's own top five, whoever they turn out to be. Under these stats that is all
  // skaters — the goalie ranks below them and is not lifted into the last seat.
  const topFive = ['Best Player', 'Second Player', 'Third Player', 'Fourth Player', 'Fifth Player'];

  it('previews the top players with the stats last season gave them', async () => {
    const fixture = MockRender(ProjectionCreateComponent);
    await fixture.whenStable();

    const rows = previewOf(fixture).previewRows();
    expect(rows.map((row) => row.player.name)).toEqual(topFive);
    // Numbered by their place in the preview, the way the editor numbers its own view.
    expect(rows.map((row) => row.rank)).toEqual([1, 2, 3, 4, 5]);
    expect(rows[0].projection.stats.scoring).toEqual(
      expect.objectContaining({ goals: 60, assists: 40 }),
    );
    expect(rows[0].projection.stats.utility.gp).toEqual(82);
    expect(rows[0].score.fantasyPoints).toBeGreaterThan(0);
    expect(rows.every((row) => row.player.type === 'skater')).toBe(true);
  });

  // The goalie minimum is a category-league rule (see ProjectionRankingService.isQualified), and
  // a new projection opens in points mode — so the preview must not put the editor's
  // "Below league minimum" marker on a goalie who would never carry one there.
  it('leaves a barely-played goalie unmarked, as points scoring does', async () => {
    // A board short enough that the goalie is in the preview on its own merits — there is no
    // reserved seat lifting it in any more.
    MockInstance(
      PlayerService,
      'getPlayers',
      vi.fn(() =>
        of([...skaters.slice(0, 3), { ...goalie, stats: { ...goalie.stats, utility: { gp: 5 } } }]),
      ),
    );

    const fixture = MockRender(ProjectionCreateComponent);
    await fixture.whenStable();

    const goalieRow = previewOf(fixture)
      .previewRows()
      .find((row) => row.player.name === 'Only Goalie');
    expect(goalieRow).toBeDefined();
    expect(goalieRow?.belowMinGames).toEqual(false);
  });

  // The preview shows the columns the editor opens with — the goalie ones included, so they read
  // as the editor's empty cells rather than being quietly left out.
  it('previews the columns a new projection opens with', async () => {
    const fixture = MockRender(ProjectionCreateComponent);
    await fixture.whenStable();

    expect([...previewOf(fixture).previewActiveColumns().utility]).toEqual(['gp']);
    expect([...previewOf(fixture).previewActiveColumns().scoring]).toEqual([
      'goals',
      'assists',
      'ppp',
      'hits',
      'blocks',
      'w',
      'sv',
      'ga',
    ]);
  });

  // Same players in the same rows, emptied — the point of the preview is that only the numbers
  // change, so the score has to go to zero with the stats that produced it.
  it('zeroes every previewed stat and score when starting from scratch', async () => {
    const fixture = MockRender(ProjectionCreateComponent);
    await fixture.whenStable();
    const component = fixture.point.componentInstance;

    component.selectPreset('blank');
    // The preview is a child now, so the pick reaches it on the next round of change detection.
    fixture.detectChanges();

    const rows = previewOf(fixture).previewRows();
    expect(rows.map((row) => row.player.name)).toEqual(topFive);
    const values = rows.flatMap((row) => [
      ...Object.values(row.projection.stats.scoring),
      ...Object.values(row.projection.stats.utility),
      row.score.fantasyPoints,
      row.score.zScore,
    ]);
    expect(values.every((value) => value === 0)).toEqual(true);
    // Nobody is projected for any games yet, so nobody is called short of them either.
    expect(rows.some((row) => row.belowMinGames)).toEqual(false);
  });

  // Five rows do not need the pool. Asking for it was half a megabyte to draw them.
  it('downloads only the top of the board', async () => {
    const getPlayers = vi.fn(() => of(players));
    MockInstance(PlayerService, 'getPlayers', getPlayers);

    const fixture = MockRender(ProjectionCreateComponent);
    await fixture.whenStable();

    expect(getPlayers).toHaveBeenCalledWith({ skaters: 25, goalies: 10 });
    expect(previewOf(fixture).previewRows()).toHaveLength(5);
  });

  // The preview is the editor's table in a card, so it takes the same scroll shell: its stat
  // columns run off the right edge here exactly as they do there, and the card is 760px wide.
  it("gives the preview table the editor's scroll shell", async () => {
    const fixture = MockRender(ProjectionCreateComponent);
    await fixture.whenStable();
    fixture.detectChanges();

    const wrapper = fixture.nativeElement.querySelector(
      '.preview-card > .table-scroll > .table-wrapper',
    );
    expect(wrapper).not.toBeNull();
    expect(wrapper.getAttribute('appTableScroll')).toEqual('Preview');
  });

  it('marks the rookies the editor would mark', async () => {
    const fixture = MockRender(ProjectionCreateComponent);
    await fixture.whenStable();

    const rows = previewOf(fixture).previewRows();
    expect(rows.filter((row) => row.rookie).map((row) => row.player.name)).toEqual([
      'Third Player',
    ]);
  });

  // A failed player read model is not a reason to block the form: the preview is decoration.
  it('still lets you create when the preview cannot load', async () => {
    MockInstance(
      PlayerService,
      'getPlayers',
      vi.fn(() => throwError(() => new HttpErrorResponse({ status: 502 }))),
    );

    const fixture = MockRender(ProjectionCreateComponent);
    await fixture.whenStable();
    const component = fixture.point.componentInstance;

    expect(previewOf(fixture).hasFailed()).toEqual(true);
    expect(component.loadError()).toEqual(false);
    expect(component.canCreate()).toEqual(true);
  });

  // The preset list is the whole of this page's offer, so an environment whose BFF does not serve
  // the AI projection must not list it, and 'default' is still what the page opens on.
  it('drops the AI preset where the BFF does not serve the AI projection', async () => {
    aiProjection.set(false);
    const fixture = MockRender(ProjectionCreateComponent);
    await fixture.whenStable();
    const component = fixture.point.componentInstance;

    expect(component.presets().map((preset) => preset.source)).toEqual(['default', 'blank']);
    expect(component.isPreset('default')).toBe(true);
    expect(seed).not.toHaveBeenCalled();
  });

  // The answer is a request, so it can land after the page is drawn. The card joins the list
  // then, without moving the pick the page opened on.
  it('offers the AI preset once the BFF says it serves it', async () => {
    aiProjection.set(false);
    const fixture = MockRender(ProjectionCreateComponent);
    await fixture.whenStable();
    const component = fixture.point.componentInstance;

    aiProjection.set(true);
    fixture.detectChanges();

    expect(component.presets().map((preset) => preset.source)).toEqual([
      'default',
      'model',
      'rest_of_season',
      'blank',
    ]);
    expect(component.isPreset('default')).toBe(true);
  });

  it('leaves the rest of the season out between seasons', async () => {
    restOfSeasonAvailable.set(false);
    const fixture = MockRender(ProjectionCreateComponent);
    await fixture.whenStable();

    expect(fixture.point.componentInstance.presets().map((preset) => preset.source)).toEqual([
      'default',
      'model',
      'blank',
    ]);
  });

  it('creates from the rest of the season, filled in by the server like the AI projection', async () => {
    const fixture = MockRender(ProjectionCreateComponent);
    await fixture.whenStable();
    const component = fixture.point.componentInstance;

    component.name.set('From here on');
    component.selectPreset('rest_of_season');
    await fixture.whenStable();
    component.create();

    expect(createProjection.mock.calls[0][0].source).toEqual('rest_of_season');
    expect(createProjection.mock.calls[0][0].data.players).toEqual([]);
    expect(navigate).toHaveBeenCalledWith(['/projections', created.id]);
  });

  /** The two AI presets share a name's worth of words, so each says which season it covers. */
  it('says under each AI preset which part of the season it is', async () => {
    const fixture = MockRender(ProjectionCreateComponent);
    await fixture.whenStable();
    fixture.detectChanges();

    const metas = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('.row-meta'),
    ).map((element) => element.textContent?.trim());
    expect(metas).toEqual(['The whole season', 'Only the games left to play']);
  });

  it("asks the server for the model's lines when the AI preset is picked", async () => {
    const fixture = MockRender(ProjectionCreateComponent);
    await fixture.whenStable();
    const component = fixture.point.componentInstance;

    component.name.set('Dynasty');
    component.selectPreset('model');
    await fixture.whenStable();
    component.create();

    expect(createProjection.mock.calls[0][0].source).toEqual('model');
  });

  /**
   * The model projects a season in fractions. Shown at the defaults, which were written for last
   * season's counted stats, every one of them would be printed as a whole number and the preview
   * of the AI projection would be indistinguishable from the preview of last season.
   */
  it("shows the model's fractions rather than rounding them to whole numbers", async () => {
    board.mockReturnValueOnce(
      of({
        players: seeded.players.map((player) => ({
          ...player,
          stats: {
            utility: { ...player.stats.utility, gp: 78.6 },
            scoring: { ...player.stats.scoring, goals: 49.43, assists: 40 },
          },
        })),
      }),
    );
    const fixture = MockRender(ProjectionCreateComponent);
    await fixture.whenStable();
    const component = fixture.point.componentInstance;

    component.selectPreset('model');
    await fixture.whenStable();
    fixture.detectChanges();

    const decimals = previewOf(fixture).previewDecimalSettings();
    expect(decimals.goals).toEqual(1);
    expect(decimals.gp).toEqual(1);
    // Whole in every row the model returned, so it is still written as one.
    expect(decimals.assists).toEqual(0);
  });

  // Where nothing is sold every account reads the whole board, so the preview is the board
  // Create writes rather than the free teaser's slice of the model.
  it('asks for the board Create would write, not a slice of the model', async () => {
    const fixture = MockRender(ProjectionCreateComponent);
    await fixture.whenStable();

    fixture.point.componentInstance.selectPreset('model');
    await fixture.whenStable();

    expect(board).toHaveBeenCalledOnce();
    expect(seed).not.toHaveBeenCalled();
  });

  it('does not download the model until the AI preset is picked', async () => {
    const fixture = MockRender(ProjectionCreateComponent);
    await fixture.whenStable();

    expect(board).not.toHaveBeenCalled();

    fixture.point.componentInstance.selectPreset('model');
    await fixture.whenStable();

    expect(board).toHaveBeenCalledOnce();
  });

  // The server fills everyone the model does not reach with last season's line, so the preview
  // ranks them too: leaving them out is what put a goalie third on a board that opens with him
  // seventh.
  it('previews the board Create writes, last-season rows for the players the model misses included', async () => {
    const fixture = MockRender(ProjectionCreateComponent);
    await fixture.whenStable();
    const component = fixture.point.componentInstance;

    component.selectPreset('model');
    await fixture.whenStable();
    fixture.detectChanges();

    const rows = previewOf(fixture).previewRows();
    expect(rows.map((row) => row.player.name)).toEqual([
      'Best Player',
      'Sixth Player',
      'Second Player',
      'Fifth Player',
      'Third Player',
    ]);
  });

  it("scores the preview on the model's numbers, not last season's", async () => {
    const fixture = MockRender(ProjectionCreateComponent);
    await fixture.whenStable();
    const component = fixture.point.componentInstance;

    const lastSeason = previewOf(fixture)
      .previewRows()
      .find((row) => row.player.id === 6);
    component.selectPreset('model');
    await fixture.whenStable();
    const projected = previewOf(fixture)
      .previewRows()
      .find((row) => row.player.id === 6);

    expect(lastSeason).toBeUndefined();
    expect(projected?.projection.type).toEqual('skater');
    expect((projected?.projection.stats.scoring as SkaterScoringStats).goals).toEqual(60);
    expect(projected?.score.fantasyPoints).toBeGreaterThan(0);
  });

  /** MoneyPuck's terms require the credit, so it has to travel with the model's own numbers. */
  it('says what the model is made of, under the model and nowhere else', async () => {
    const fixture = MockRender(ProjectionCreateComponent);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).not.toContain('MoneyPuck');

    fixture.point.componentInstance.selectPreset('model');
    await fixture.whenStable();
    fixture.detectChanges();

    const note = fixture.nativeElement.querySelector('.preview-note');
    expect(note.textContent).toContain('advanced stats from MoneyPuck');
    expect(note.textContent).toContain('Data © MoneyPuck.com');
  });

  /**
   * Locked, not hidden: someone who cannot see the AI projection has no reason to buy it. The
   * card stays pickable, the preview draws the model's own top five for anyone, and the page's
   * one button becomes the way to Premium.
   */
  describe('when the AI projection is behind a subscription', () => {
    beforeEach(() => {
      premium.set(false);
    });

    const withRendered = async (
      test: (fixture: MockedComponentFixture<ProjectionCreateComponent>) => void | Promise<void>,
    ) => {
      const fixture = MockRender(ProjectionCreateComponent);
      await fixture.whenStable();
      await test(fixture);
    };

    it('marks the card locked but leaves it on the page and pickable', async () => {
      await withRendered(async (fixture) => {
        const component = fixture.point.componentInstance;
        component.selectPreset('model');
        await fixture.whenStable();
        fixture.detectChanges();

        expect(component.aiProjectionLocked()).toBe(true);
        expect(component.isPreset('model')).toBe(true);
        expect(fixture.nativeElement.querySelectorAll('.row--locked').length).toEqual(2);
      });
    });

    /** The rest of the season is the model's lines too: locked with them, never a way around them. */
    it('locks the rest of the season with the AI projection', async () => {
      await withRendered(async (fixture) => {
        const component = fixture.point.componentInstance;
        component.name.set('From here on');
        component.selectPreset('rest_of_season');
        await fixture.whenStable();
        fixture.detectChanges();

        expect(component.aiProjectionLocked()).toBe(true);
        expect(component.canCreate()).toBe(false);
        component.create();
        expect(createProjection).not.toHaveBeenCalled();
      });
    });

    /**
     * The teaser. A request this narrow is the preview the BFF serves to everyone, so a free
     * account sees the model's own top skaters rather than a description of them.
     */
    it('previews the top of the model even while it is locked', async () => {
      await withRendered(async (fixture) => {
        const component = fixture.point.componentInstance;
        component.selectPreset('model');
        await fixture.whenStable();
        fixture.detectChanges();

        expect(seed).toHaveBeenCalledWith({ skaterLimit: 25, goalieLimit: 1, source: 'model' });
        expect(board).not.toHaveBeenCalled();
        expect(previewOf(fixture).previewRows().length).toBeGreaterThan(0);
        expect(fixture.nativeElement.querySelector('.preview-card')).not.toBeNull();
      });
    });

    it('offers the way to Premium where the Create button would be', async () => {
      await withRendered(async (fixture) => {
        fixture.point.componentInstance.selectPreset('model');
        await fixture.whenStable();
        fixture.detectChanges();

        const action = fixture.nativeElement.querySelector('a.create-button');
        expect(action).not.toBeNull();
        expect(action.textContent.trim()).toEqual('Unlock with Premium');
        expect(action.getAttribute('routerLink')).toEqual('/premium');
      });
    });

    /** A Create button that can only be refused is worse than one that is plainly not offered. */
    it('stands the Create button down while the locked starting point is picked', async () => {
      await withRendered(async (fixture) => {
        const component = fixture.point.componentInstance;
        component.selectPreset('model');
        await fixture.whenStable();
        fixture.detectChanges();

        expect(component.canCreate()).toBe(false);
        expect(fixture.nativeElement.querySelector('button.create-button')).toBeNull();

        component.selectPreset('default');
        await fixture.whenStable();
        fixture.detectChanges();

        expect(component.canCreate()).toBe(true);
        expect(fixture.nativeElement.querySelector('button.create-button')).not.toBeNull();
        expect(fixture.nativeElement.querySelector('a.create-button')).toBeNull();
      });
    });

    it('previews the board Create would write for a subscriber', async () => {
      premium.set(true);
      await withRendered(async (fixture) => {
        fixture.point.componentInstance.selectPreset('model');
        await fixture.whenStable();
        fixture.detectChanges();

        expect(board).toHaveBeenCalled();
        expect(seed).not.toHaveBeenCalled();
        expect(fixture.nativeElement.querySelector('a.create-button')).toBeNull();
        expect(fixture.point.componentInstance.canCreate()).toBe(true);
      });
    });

    /**
     * A subscription that lapsed while the page was open is the one way to reach the server's
     * refusal from here, and telling someone to retry it would be telling them to keep failing.
     */
    it('says what a refused create actually needs, rather than telling anyone to retry', async () => {
      createProjection.mockReturnValueOnce(
        throwError(() => new HttpErrorResponse({ status: 403 })),
      );
      const fixture = MockRender(ProjectionCreateComponent);
      await fixture.whenStable();

      fixture.point.componentInstance.create();

      expect(notifyError).toHaveBeenCalledWith(expect.stringContaining('part of Premium'));
      expect(notifyError).not.toHaveBeenCalledWith(expect.stringContaining('try again'));
    });
  });
});
