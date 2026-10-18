import { MockBuilder, MockRender, ngMocks } from 'ng-mocks';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { signal } from '@angular/core';
import { of, Subject, throwError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, Router } from '@angular/router';
import { provideLocationMocks } from '@angular/common/testing';
import { DraftStartComponent } from './draft-start';
import { LAST_SEASON_PRESET_NAME, MODEL_PRESET_NAME, Preset, PRESETS } from '../models/preset';
import { ProjectionStorageService } from '../services/projection-storage.service';
import { EntitlementService } from '../services/entitlement.service';
import { NotificationService } from '../services/notification.service';
import { PopoverTriggerDirective } from '../shared/popover/popover-trigger.directive';
import { ProjectionSummaryResponse } from '../api/models/projection-summary-response';
import { FeatureService } from '../services/feature.service';
import { RestOfSeasonService } from '../services/rest-of-season.service';
import { MODEL_SOURCES } from '../models/ai-projection';

describe('DraftStartComponent', () => {
  const LAST_SEASON = PRESETS.find((preset) => preset.id === 'last_season')!;
  const MODEL = PRESETS.find((preset) => preset.id === 'model')!;
  const REST_OF_SEASON = PRESETS.find((preset) => preset.id === 'rest_of_season')!;

  const summary = (
    id: string,
    kind: ProjectionSummaryResponse['kind'],
    draftStatus: ProjectionSummaryResponse['draftStatus'] = 'none',
    updatedAt = '2026-06-01T00:00:00Z',
    preset: Preset = LAST_SEASON,
  ): ProjectionSummaryResponse => ({
    id,
    name: kind === 'draft' ? preset.name : `Projection ${id}`,
    kind,
    ...(kind === 'draft' ? { preset: preset.id } : {}),
    draftStatus,
    season: '20262027',
    autoNamed: true,
    createdAt: '2026-06-01T00:00:00Z',
    updatedAt,
  });

  /** A draft played against one of the user's own boards, rather than against a preset. */
  const boardDraft = (
    id: string,
    sourceProjectionId: string,
    name = `Projection ${sourceProjectionId}`,
    draftStatus: ProjectionSummaryResponse['draftStatus'] = 'in_progress',
  ): ProjectionSummaryResponse => ({
    ...summary(id, 'draft', draftStatus),
    name,
    preset: undefined,
    sourceProjectionId,
  });

  const imported = (
    id: string,
    author: string,
    name = `Board ${id}`,
  ): ProjectionSummaryResponse => ({
    ...summary(id, 'imported'),
    name,
    origin: { shareToken: `token-${id}`, authorUsername: author },
  });

  /** A spreadsheet upload: the same `imported` kind, and none of somebody else's ownership. */
  const spreadsheet = (id: string, name = `Sheet ${id}`): ProjectionSummaryResponse => ({
    ...summary(id, 'imported'),
    name,
  });

  const navigate = vi.fn();
  /** The query string the page opened with; the same object is handed to every render. */
  const queryParams: Record<string, string> = {};
  const listAll = vi.fn();
  const createProjection = vi.fn();
  const deleteProjection = vi.fn();
  const startDraft = vi.fn();
  const renameProjection = vi.fn();
  const loadProjection = vi.fn();
  const updateProjection = vi.fn();
  const notifyError = vi.fn();
  const premium = signal(false);
  const aiProjection = signal(true);
  const restOfSeasonAvailable = signal(false);
  const loadState = signal<'idle' | 'loading' | 'loaded' | 'error'>('loaded');

  beforeEach(() => {
    premium.set(false);
    aiProjection.set(true);
    restOfSeasonAvailable.set(false);
    loadState.set('loaded');
    navigate.mockClear();
    listAll.mockClear();
    createProjection.mockClear();
    deleteProjection.mockClear();
    startDraft.mockClear();
    renameProjection.mockClear();
    loadProjection.mockReset();
    updateProjection.mockReset();
    updateProjection.mockImplementation((id: string) => of({ id }));
    notifyError.mockClear();
    for (const key of Object.keys(queryParams)) {
      delete queryParams[key];
    }
    listAll.mockReturnValue(of([summary('p1', 'projection')]));
    createProjection.mockReturnValue(of({ id: 'preset1' }));
    deleteProjection.mockReturnValue(of(undefined));
    startDraft.mockReturnValue(of({ id: 'd1' }));
    renameProjection.mockImplementation((id: string, name: string) => of({ id, name }));
    return (
      MockBuilder(DraftStartComponent)
        // The row menu is a real overlay, and mocked away the kebab opens nothing at all.
        .keep(PopoverTriggerDirective)
        .mock(ProjectionStorageService, {
          listAll,
          createProjection,
          deleteProjection,
          startDraft,
          renameProjection,
          loadProjection,
          updateProjection,
        })
        .mock(NotificationService, { error: notifyError })
        .mock(EntitlementService, { premium, loadState })
        .mock(FeatureService, {
          aiProjection,
          offeredPresets: <T extends { readonly source?: string | null }>(presets: readonly T[]) =>
            aiProjection()
              ? presets
              : presets.filter((preset) => !MODEL_SOURCES.includes(preset.source ?? '')),
        })
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
        // The component pulls in RouterLink, which has ng-mocks mock the router's location
        // providers too — and the CDK overlay behind the row menu needs a real one to open.
        .provide(provideLocationMocks())
    );
  });

  const render = async () => {
    const fixture = MockRender(DraftStartComponent);
    await fixture.whenStable();
    return fixture.point.componentInstance;
  };

  const renderFixture = async () => {
    const fixture = MockRender(DraftStartComponent);
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  };

  const texts = (fixture: { nativeElement: HTMLElement }, selector: string) =>
    Array.from(fixture.nativeElement.querySelectorAll<HTMLElement>(selector)).map((element) =>
      element.textContent?.trim(),
    );

  const menuPanel = () => document.querySelector('.draft-menu-panel');

  it('offers the projections newest-updated first and keeps the drafts out of them', async () => {
    listAll.mockReturnValue(
      of([
        summary('p1', 'projection', 'none', '2026-06-01T00:00:00Z'),
        summary('preset1', 'draft', 'in_progress'),
        summary('p2', 'projection', 'none', '2026-06-10T00:00:00Z'),
      ]),
    );

    const component = await render();

    expect(component.projections().map((projection) => projection.id)).toEqual(['p2', 'p1']);
    expect(component.drafts().map((draft) => draft.id)).toEqual(['preset1']);
  });

  it('opens a draft at its own address, which is not the board it was played against', async () => {
    const component = await render();

    component.openDraft({ id: 'd1', draftStatus: 'in_progress' } as never);

    expect(navigate).toHaveBeenCalledWith(['/drafts', 'd1']);
  });

  it('opens a finished draft on its board too', async () => {
    const component = await render();

    component.openDraft({ id: 'd1', draftStatus: 'finished' } as never);

    expect(navigate).toHaveBeenCalledWith(['/drafts', 'd1']);
  });

  // The draft is created by the draft page once its setup is confirmed. Saving it here, before
  // the teams and order were asked for, left an empty board behind whenever someone backed out.
  it('opens the setup for a new preset draft without saving anything yet', async () => {
    const component = await render();

    component.selectPreset(LAST_SEASON);
    component.start();

    expect(createProjection).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith(['/draft/new/preset', 'last_season']);
  });

  it('opens the setup for a draft against a board without writing to the board', async () => {
    const component = await render();

    component.sourceKind.set('projection');
    component.start();

    expect(startDraft).not.toHaveBeenCalled();
    expect(updateProjection).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith(['/draft/new/board', 'p1']);
  });

  /**
   * The whole of what the old model could not do. A preset that has been drafted against is
   * still on offer, and Start begins a second draft rather than resuming the first: the draft
   * that exists is its own row in the list above.
   */
  it('keeps a preset on offer once it has a draft, and starts another', async () => {
    listAll.mockReturnValue(of([summary('preset1', 'draft', 'in_progress')]));

    const component = await render();

    expect(component.availablePresets().map((preset) => preset.id)).toEqual([
      'last_season',
      'model',
    ]);
    expect(component.drafts().map((draft) => draft.id)).toEqual(['preset1']);

    component.selectPreset(LAST_SEASON);
    component.start();

    expect(navigate).toHaveBeenCalledWith(['/draft/new/preset', 'last_season']);
  });

  it('keeps a board on offer once it has drafts, however many', async () => {
    listAll.mockReturnValue(
      of([summary('p1', 'projection'), boardDraft('d1', 'p1'), boardDraft('d2', 'p1')]),
    );

    const component = await render();

    expect(component.projections().map((board) => board.id)).toEqual(['p1']);
    expect(component.drafts().map((draft) => draft.id)).toEqual(['d1', 'd2']);
  });

  // The league is the draft setup's to ask for now, so Start carries nothing but what the draft
  // is played against — and reads nothing either: no board is downloaded to show its league.
  describe('starting a draft', () => {
    it('opens the setup for a preset with nothing but the preset', async () => {
      listAll.mockReturnValue(of([]));
      const component = await render();

      component.start();

      expect(createProjection).not.toHaveBeenCalled();
      expect(navigate).toHaveBeenCalledWith(['/draft/new/preset', 'last_season']);
    });

    it('opens the setup for a board without reading or writing it', async () => {
      const component = await render();
      component.sourceKind.set('projection');

      component.start();

      expect(loadProjection).not.toHaveBeenCalled();
      expect(updateProjection).not.toHaveBeenCalled();
      expect(navigate).toHaveBeenCalledWith(['/draft/new/board', 'p1']);
    });
  });

  it('reloads the sources on retry after a failed load', async () => {
    listAll.mockReturnValue(throwError(() => new Error('boom')));

    const fixture = MockRender(DraftStartComponent);
    await fixture.whenStable();
    const component = fixture.point.componentInstance;
    expect(component.sourcesResource.error()).toBeTruthy();

    listAll.mockReturnValue(of([summary('p1', 'projection')]));
    component.retry();
    await fixture.whenStable();

    expect(component.sourcesResource.error()).toBeFalsy();
    expect(component.projections().map((projection) => projection.id)).toEqual(['p1']);
  });

  /**
   * The split is who owns the board, not how it arrived: a spreadsheet the user uploaded is
   * theirs to draft against like anything else they made, and only a followed board is not.
   */
  it('keeps the boards the user follows apart from the ones that are theirs', async () => {
    listAll.mockReturnValue(
      of([
        summary('p1', 'projection'),
        spreadsheet('s1'),
        imported('i1', 'alex'),
        summary('preset1', 'draft'),
      ]),
    );

    const component = await render();

    expect(component.projections().map((projection) => projection.id)).toEqual(['p1', 's1']);
    expect(component.followed().map((board) => board.id)).toEqual(['i1']);
  });

  it('says whose numbers a row holds', async () => {
    const component = await render();

    expect(component.sourceLabel(imported('i1', 'alex'))).toEqual('Following alex');
    expect(component.sourceLabel(summary('p1', 'projection'))).toEqual('Your projection');
    // A draft says what it was played against — unless that is what it is still called, as a
    // draft the server just named is.
    expect(component.sourceLabel(summary('preset1', 'draft'))).toEqual('');
    expect(component.sourceLabel({ ...summary('preset1', 'draft'), name: 'Mock #3' })).toEqual(
      "From Last Season's Stats",
    );
  });

  it('says what the timestamp on a draft means, which is not the same once it is over', async () => {
    const component = await render();

    expect(component.timingLabel(summary('p1', 'projection', 'in_progress'))).toEqual('last pick');
    expect(component.timingLabel(summary('p2', 'projection', 'finished'))).toEqual('finished');
  });

  it('gathers every draft into one list, unfinished first and newest first within that', async () => {
    listAll.mockReturnValue(
      of([
        summary('p1', 'projection', 'none'),
        summary('preset1', 'draft', 'in_progress', '2026-06-02T00:00:00Z'),
        { ...boardDraft('d1', 'p1'), updatedAt: '2026-06-09T00:00:00Z' },
        {
          ...boardDraft('d2', 'p1'),
          draftStatus: 'finished' as const,
          updatedAt: '2026-06-20T00:00:00Z',
        },
      ]),
    );

    const component = await render();

    // The finished one sorts last despite being the most recently touched: a draft still being
    // made is what the section is for.
    expect(component.drafts().map((draft) => draft.id)).toEqual(['d1', 'preset1', 'd2']);
  });

  /**
   * The two sections are about different things: what exists, and what a new draft would be
   * played against. No row appears in both, because a draft and the board it was copied from are
   * two rows — which is also what lets the board stay on offer while its draft is under way.
   */
  it('lists the drafts above and the boards below, with no row in both', async () => {
    listAll.mockReturnValue(
      of([
        summary('p1', 'projection', 'none'),
        summary('p2', 'projection', 'none'),
        imported('i1', 'alex'),
        boardDraft('d1', 'p1'),
        summary('preset1', 'draft', 'in_progress'),
      ]),
    );

    const component = await render();
    const ids = [...component.drafts(), ...component.projections(), ...component.followed()].map(
      (row) => row.id,
    );

    expect(ids).toEqual(['d1', 'preset1', 'p1', 'p2', 'i1']);
    expect(new Set(ids).size).toEqual(ids.length);
  });

  // A file becomes a projection, and projections are made on the new-projection page, which the
  // user's own group links to. Only the follow field, under the followed boards, makes a source
  // here.
  it('offers no upload, and the follow field only with the followed', async () => {
    listAll.mockReturnValue(of([summary('p1', 'projection'), imported('i1', 'alex')]));

    const fixture = MockRender(DraftStartComponent);
    await fixture.whenStable();
    const component = fixture.point.componentInstance;
    const root: HTMLElement = fixture.nativeElement;

    component.sourceKind.set('projection');
    fixture.detectChanges();
    expect(root.querySelector('app-spreadsheet-import-button')).toBeNull();
    expect(root.querySelector('app-share-import')).toBeNull();
    expect(root.querySelector('.create-projection')).not.toBeNull();

    component.sourceKind.set('following');
    fixture.detectChanges();
    expect(root.querySelector('app-share-import')).not.toBeNull();
    expect(root.querySelector('app-spreadsheet-import-button')).toBeNull();
  });

  it('re-reads the sources when a board is followed, so it joins the list', async () => {
    const fixture = MockRender(DraftStartComponent);
    await fixture.whenStable();

    fixture.point.componentInstance.onFollowed('i9');
    await fixture.whenStable();

    // The list is what the group reads from, and the copy is not in the one already fetched.
    expect(listAll).toHaveBeenCalledTimes(2);
  });

  it('starts the AI preset, not last season', async () => {
    const component = await render();

    component.selectPreset(MODEL);
    component.start();

    expect(navigate).toHaveBeenCalledWith(['/draft/new/preset', 'model']);
  });

  // The row is the only way in here, so dropping it is what switching the feature off means.
  it('drops the AI preset from the picker where the BFF does not serve the AI projection', async () => {
    aiProjection.set(false);
    const component = await render();

    expect(component.presets().map((preset) => preset.id)).toEqual(['last_season']);
  });

  it('offers the rest of the season beside the AI projection while a season is under way', async () => {
    restOfSeasonAvailable.set(true);
    const component = await render();

    expect(component.presets().map((preset) => preset.id)).toEqual([
      'last_season',
      'model',
      'rest_of_season',
    ]);
    component.selectPreset(REST_OF_SEASON);
    component.start();
    expect(navigate).toHaveBeenCalledWith(['/draft/new/preset', 'rest_of_season']);
  });

  it('leaves the rest of the season out between seasons', async () => {
    const component = await render();

    expect(component.presets().map((preset) => preset.id)).toEqual(['last_season', 'model']);
  });

  /** The names say it: "AI Projection" and "AI Rest of Season" need no line under them. */
  it('puts no line under a preset name', async () => {
    restOfSeasonAvailable.set(true);
    listAll.mockReturnValue(of([]));
    const fixture = await renderFixture();

    expect(texts(fixture, '.row-meta')).toEqual([]);
  });

  /**
   * Both presets and both boards can be drafted repeatedly, so what the page has to get right is
   * no longer which draft belongs to which preset — it is that a draft says what it was played
   * against, since its name may have been changed since.
   */
  it('says what each draft was played against', async () => {
    listAll.mockReturnValue(
      of([
        summary('lastSeason1', 'draft', 'in_progress', '2026-06-01T00:00:00Z'),
        summary('model1', 'draft', 'finished', '2026-06-02T00:00:00Z', MODEL),
        summary('p1', 'projection'),
        boardDraft('d1', 'p1', 'Beer League'),
        boardDraft('d2', 'gone', 'Orphan'),
      ]),
    );

    const component = await render();
    const labelOf = (id: string) =>
      component.sourceLabel(component.drafts().find((draft) => draft.id === id)!);

    // Nothing where the draft is still called after what it was played against, which is every
    // draft the server named; something the moment it has a name of its own.
    expect(labelOf('lastSeason1')).toEqual('');
    expect(labelOf('model1')).toEqual('');
    expect(labelOf('d1')).toEqual('From Projection p1');
    expect(labelOf('d2')).toEqual('Projection deleted');
    expect(component.draftLabel('in_progress')).toEqual('Resume draft');
    expect(component.draftLabel('finished')).toEqual('View draft');
  });

  // The choice is made in steps: the kind first, and the page opens on the user's own boards when
  // there are any. The other two kinds are segments that say how much they hold.
  it('asks for the kind of source first, opening on your projections with the rest folded', async () => {
    listAll.mockReturnValue(of([summary('p1', 'projection', 'none'), imported('i1', 'alex')]));

    const fixture = await renderFixture();
    const component = fixture.point.componentInstance;

    // Nothing is drafted yet, so the page is one question rather than two.
    expect(texts(fixture, '.section-title')).toEqual(['Start a new draft']);
    expect(texts(fixture, '.kind-name')).toEqual(['Preset', 'Your projection', 'Following']);
    expect(texts(fixture, '.kind-count')).toEqual(['2', '1', '1']);
    // A segmented control, not radios: the pressed one is said on the button itself.
    const pressed = () =>
      Array.from(
        (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('.segmented .kind'),
      ).map((segment) => segment.getAttribute('aria-pressed'));
    expect(pressed()).toEqual(['false', 'true', 'false']);
    expect(component.sourceKind()).toEqual('projection');
    expect(texts(fixture, '.row-name')).toEqual(['Projection p1']);

    component.sourceKind.set('preset');
    fixture.detectChanges();
    expect(pressed()).toEqual(['true', 'false', 'false']);
    // One step, a heading over it: the league is the draft setup's to ask, and there is no
    // preview. The import's label under the cards is deliberately not one: it is a way into the
    // step, not a step.
    expect(texts(fixture, 'h3')).toEqual(['What do you want to draft against?']);
    expect(texts(fixture, '.row-name')).toEqual([LAST_SEASON_PRESET_NAME, MODEL_PRESET_NAME]);
    expect(fixture.nativeElement.querySelector('app-projection-import')).toBeNull();
  });

  // One card for every choice, whichever tile is open. The presets were cards and the boards a
  // ruled list for a release, and switching tiles then switched the control under them.
  it('draws every choice as the same card, whichever tile is open', async () => {
    restOfSeasonAvailable.set(true);
    listAll.mockReturnValue(of([summary('p1', 'projection', 'none'), imported('i1', 'alex')]));

    const fixture = await renderFixture();
    const component = fixture.point.componentInstance;
    const root: HTMLElement = fixture.nativeElement;
    const cards = () => Array.from(root.querySelectorAll<HTMLElement>('.row'));
    const selected = () => cards().map((card) => card.classList.contains('row--selected'));
    component.sourceKind.set('preset');
    fixture.detectChanges();

    // Presets: three cards, an icon on each, the checked one marked on the card itself.
    expect(cards()).toHaveLength(PRESETS.length);
    expect(root.querySelectorAll('.row-icon app-icon')).toHaveLength(PRESETS.length);
    expect(selected()).toEqual([true, false, false]);
    component.selectPreset(MODEL);
    fixture.detectChanges();
    expect(selected()).toEqual([false, true, false]);

    // The same card for a projection and for a shared board: radio, icon, outline and meta.
    for (const kind of ['projection', 'following'] as const) {
      component.sourceKind.set(kind);
      fixture.detectChanges();
      expect(cards()).toHaveLength(1);
      expect(root.querySelectorAll('.row-icon app-icon')).toHaveLength(1);
      expect(root.querySelectorAll('.row-choice input[type="radio"]')).toHaveLength(1);
      expect(selected()).toEqual([true]);
      expect(root.querySelector('.row-meta')).not.toBeNull();
    }
  });

  // The badge says the AI projection is sold. Rendered once per state rather than twice in one
  // test: two live fixtures over a flipped flag re-check the first against the new value, which
  // Angular reports as ExpressionChangedAfterItHasBeenChecked.
  it('marks the AI projection as Premium', async () => {
    listAll.mockReturnValue(of([]));
    const fixture = await renderFixture();
    const component = fixture.point.componentInstance;

    expect(component.showsPremiumBadge(MODEL)).toBe(true);
    // Only the one that is sold: last season's stats is in every build.
    expect(component.showsPremiumBadge(LAST_SEASON)).toBe(false);
    expect(texts(fixture, '.row-badge')).toEqual(['Premium']);
  });

  // A kind with nothing in it still has its segment, with a 0 on it: the count is what keeps the
  // fold honest, and the panel's empty state says the rest once it is pressed.
  it('counts an empty kind as 0 on its segment rather than dropping it', async () => {
    listAll.mockReturnValue(
      of([
        summary('lastSeason1', 'draft', 'in_progress'),
        summary('model1', 'draft', 'finished', '2026-06-02T00:00:00Z', MODEL),
      ]),
    );

    const fixture = await renderFixture();

    // The presets are always there to draft against; the user has no board of either kind.
    expect(texts(fixture, '.kind-count')).toEqual(['2', '0', '0']);

    fixture.point.componentInstance.sourceKind.set('following');
    fixture.detectChanges();
    expect(texts(fixture, '.group-empty')[0]).toContain('not following any projections');
  });

  // One press to a draft: the first row of the open kind is checked from the start, and the
  // one Start button on the page drafts against it.
  it('checks the first preset from the start, so one press opens its setup', async () => {
    listAll.mockReturnValue(of([]));
    const fixture = await renderFixture();
    const component = fixture.point.componentInstance;

    expect(component.selection()).toEqual({ kind: 'preset', preset: LAST_SEASON });
    expect(texts(fixture, '.start')).toEqual(['Start draft']);

    (fixture.nativeElement.querySelector('.start') as HTMLButtonElement).click();

    expect(navigate).toHaveBeenCalledWith(['/draft/new/preset', 'last_season']);
  });

  it('switches the rows with the tile, and checks the first of the new kind', async () => {
    listAll.mockReturnValue(
      of([
        summary('p1', 'projection', 'none', '2026-06-01T00:00:00Z'),
        summary('p2', 'projection', 'none', '2026-06-10T00:00:00Z'),
      ]),
    );

    const fixture = await renderFixture();
    const component = fixture.point.componentInstance;

    component.sourceKind.set('projection');
    fixture.detectChanges();

    expect(texts(fixture, '.row-name')).toEqual(['Projection p2', 'Projection p1']);
    expect(component.selection()).toEqual({ kind: 'board', id: 'p2' });
    expect(component.isBoardSelected('p2')).toBe(true);

    component.selectBoard('p1');
    component.start();

    // Nothing is saved from here; the setup on the draft page is what creates the draft.
    expect(createProjection).not.toHaveBeenCalled();
    expect(startDraft).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith(['/draft/new/board', 'p1']);
  });

  // A card's name is one line, cut with an ellipsis; the full name must still be reachable.
  it('carries the whole name in a tooltip, so a cut name can be read on hover', async () => {
    const name = 'Kopia av Apples & Ginos 2024-25 NHL Skater Projections_';
    listAll.mockReturnValue(of([{ ...summary('p1', 'projection'), name }]));

    const fixture = await renderFixture();
    fixture.point.componentInstance.sourceKind.set('projection');
    fixture.detectChanges();

    const rowName = ngMocks.find(fixture, '.row-name');
    expect(rowName.nativeElement.textContent?.trim()).toEqual(name);
    expect(ngMocks.input(rowName, 'appTooltip')).toEqual(name);
  });

  // What the user built is what they came to draft against, so their own boards come first,
  // the ones they follow next, and the presets only when there is neither.
  it('opens on your projections when you have one, whatever else there is', async () => {
    listAll.mockReturnValue(
      of([
        summary('model1', 'draft', 'finished', '2026-06-02T00:00:00Z', MODEL),
        imported('i1', 'alex'),
        spreadsheet('s1'),
      ]),
    );

    const component = await render();

    expect(component.sourceKind()).toEqual('projection');
    expect(component.selection()).toEqual({ kind: 'board', id: 's1' });
  });

  it('opens on the boards you follow when you have none of your own', async () => {
    listAll.mockReturnValue(
      of([summary('lastSeason1', 'draft', 'in_progress'), imported('i1', 'alex')]),
    );

    const component = await render();

    expect(component.sourceKind()).toEqual('following');
    expect(component.selection()).toEqual({ kind: 'board', id: 'i1' });
  });

  // A preset is never used up by a draft, so it is still there for someone with no boards at all.
  it('opens on the presets when you have no boards, drafted against or not', async () => {
    listAll.mockReturnValue(
      of([
        summary('lastSeason1', 'draft', 'in_progress'),
        summary('model1', 'draft', 'finished', '2026-06-02T00:00:00Z', MODEL),
      ]),
    );

    const component = await render();

    expect(component.sourceKind()).toEqual('preset');
    expect(component.selection()).toEqual({ kind: 'preset', preset: LAST_SEASON });
  });

  it('disables Start when the open kind has nothing to draft against', async () => {
    listAll.mockReturnValue(of([]));

    const fixture = await renderFixture();
    const component = fixture.point.componentInstance;

    component.sourceKind.set('projection');
    fixture.detectChanges();

    expect(component.selection()).toBeNull();
    expect((fixture.nativeElement.querySelector('.start') as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(texts(fixture, '.group-empty')[0]).toContain('No projections yet.');
  });

  // The paste field lives with the followed boards; the tile says the kind is there to be used.
  it('keeps the follow box with the followed boards, and picks the board once one is followed', async () => {
    listAll.mockReturnValue(of([imported('i1', 'alex')]));

    const fixture = await renderFixture();
    const component = fixture.point.componentInstance;

    component.sourceKind.set('following');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('app-share-import')).not.toBeNull();
    expect(component.selection()).toEqual({ kind: 'board', id: 'i1' });

    listAll.mockReturnValue(
      of([
        imported('i1', 'alex'),
        { ...imported('i9', 'bulle'), updatedAt: '2026-07-01T00:00:00Z' },
      ]),
    );
    component.sourceKind.set('preset');
    component.onFollowed('i9');
    await fixture.whenStable();

    expect(component.sourceKind()).toEqual('following');
    expect(component.selection()).toEqual({ kind: 'board', id: 'i9' });
  });

  it('leads with the drafts, with the boards to start another against below', async () => {
    listAll.mockReturnValue(
      of([
        summary('p1', 'projection', 'none'),
        summary('p2', 'projection', 'none', '2026-05-01T00:00:00Z'),
        boardDraft('d1', 'p1', 'Beer League'),
      ]),
    );

    const fixture = await renderFixture();
    fixture.point.componentInstance.sourceKind.set('projection');
    fixture.detectChanges();

    expect(texts(fixture, '.section-title')).toEqual(['Your drafts', 'Start a new draft']);
    expect(texts(fixture, '.draft-name')).toEqual(['Beer League']);
    // The board the draft was played against is still there to draft against again.
    expect(texts(fixture, '.row-name')).toEqual(['Projection p1', 'Projection p2']);
  });

  // The card is the button. A "Resume draft" on every card was a column of buttons before the
  // page had asked its second question; the one filled button on the page is Start.
  it('opens a draft from its card, worded by its state, with no button of its own', async () => {
    listAll.mockReturnValue(
      of([
        boardDraft('d1', 'p1', 'Beer League'),
        { ...boardDraft('d2', 'p1', 'Mock #2'), draftStatus: 'finished' as const },
      ]),
    );

    const fixture = await renderFixture();

    const cards = Array.from(
      fixture.nativeElement.querySelectorAll('.draft-open') as NodeListOf<HTMLButtonElement>,
    );
    expect(cards.map((card) => card.getAttribute('aria-label'))).toEqual([
      'Resume draft: Beer League',
      'View draft: Mock #2',
    ]);
    expect(texts(fixture, '.draft-status')).toEqual(['In progress', 'Complete']);
    expect(fixture.nativeElement.querySelectorAll('.draft .btn')).toHaveLength(0);
    expect(fixture.nativeElement.querySelectorAll('.btn-primary')).toHaveLength(1);

    cards[1].click();

    expect(navigate).toHaveBeenCalledWith(['/drafts', 'd2']);
  });

  it('keeps the discard behind the card menu rather than on the card', async () => {
    listAll.mockReturnValue(of([summary('d1', 'draft', 'in_progress')]));

    const fixture = await renderFixture();

    const buttons = Array.from(
      fixture.nativeElement.querySelectorAll('.draft button') as NodeListOf<HTMLElement>,
    ).map((button) => button.className);
    expect(buttons).toEqual(['draft-open', 'draft-menu']);

    (fixture.nativeElement.querySelector('.draft-menu') as HTMLElement).click();

    const items = Array.from(menuPanel()?.querySelectorAll('.menu-item') ?? []).map((item) =>
      item.textContent?.trim(),
    );
    expect(items).toEqual(['Rename', 'Discard draft']);
    expect(menuPanel()?.querySelector('.discard')?.classList.contains('menu-item--danger')).toBe(
      true,
    );
  });

  // The kebab is still on the card while the question is asked, so nothing but the menu item
  // itself can close the menu, and left open it sat over "Yes, discard".
  it('closes the menu when Discard draft is chosen, and puts focus on the question', async () => {
    listAll.mockReturnValue(of([summary('d1', 'draft', 'in_progress')]));

    const fixture = await renderFixture();
    (fixture.nativeElement.querySelector('.draft-menu') as HTMLElement).click();
    (menuPanel()?.querySelector('.discard') as HTMLElement).click();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(menuPanel()).toBeNull();
    const prompt = fixture.nativeElement.querySelector('.confirm-text') as HTMLElement;
    expect(prompt.textContent?.trim()).toEqual('Discard this draft?');
    expect(document.activeElement).toBe(prompt);
  });

  // A draft started from a preset has no board of the user's behind it; one started from a
  // board does, until that board is deleted — the draft holds its own copy and outlives it.
  it('offers a way into the board only where there is still one', async () => {
    listAll.mockReturnValue(of([summary('p1', 'projection'), boardDraft('d1', 'p1')]));

    const component = await render();

    expect(component.canOpenBoard(component.drafts()[0])).toBe(true);
    expect(component.canOpenBoard(summary('preset1', 'draft', 'in_progress'))).toBe(false);
    expect(component.canOpenBoard(boardDraft('d2', 'gone'))).toBe(false);
  });

  it('opens the board a draft was played against, rather than the draft', async () => {
    listAll.mockReturnValue(of([summary('p1', 'projection'), boardDraft('d1', 'p1')]));

    const component = await render();
    component.openBoard(component.drafts()[0]);

    expect(navigate).toHaveBeenCalledWith(['/projections', 'p1']);
  });

  /**
   * A draft is a row of its own, so discarding it deletes that row — picks, league and the copy
   * of the numbers it was played against. The board those were copied from is untouched, and was
   * never waiting on this draft to be drafted against again.
   */
  it('discards a draft by deleting it, leaving the board it was played against alone', async () => {
    listAll.mockReturnValue(of([summary('p1', 'projection'), boardDraft('d1', 'p1')]));

    const component = await render();
    const draft = component.drafts()[0];
    component.requestDiscard(draft);
    expect(component.isConfirmingDiscard(draft)).toEqual(true);
    component.confirmDiscard(draft);

    expect(deleteProjection).toHaveBeenCalledWith('d1');
    expect(updateProjection).not.toHaveBeenCalled();
    expect(component.confirmingDiscard()).toBeNull();
    expect(component.isDiscarding(draft)).toEqual(false);
  });

  // Nothing in the list changes but the one row, so the page takes it out where it stands rather
  // than reading everything again behind a spinner.
  it('takes a discarded draft out of the list without reading the list again', async () => {
    listAll.mockReturnValue(
      of([summary('p1', 'projection'), boardDraft('d1', 'p1'), boardDraft('d2', 'p1')]),
    );

    const fixture = await renderFixture();
    const component = fixture.point.componentInstance;
    component.confirmDiscard(component.drafts()[0]);
    fixture.detectChanges();

    expect(component.drafts().map((draft) => draft.id)).toEqual(['d2']);
    expect(component.projections().map((board) => board.id)).toEqual(['p1']);
    expect(texts(fixture, '.draft-name')).toEqual(['Projection p1']);
    expect(listAll).toHaveBeenCalledTimes(1);
  });

  // A rename or a follow still re-reads the list, and the page it re-reads under stays put: it
  // used to be swapped for a spinner until the list came back.
  it('keeps the page on screen while the list is read again', async () => {
    listAll.mockReturnValue(of([summary('p1', 'projection'), boardDraft('d1', 'p1')]));
    const fixture = await renderFixture();
    const pending = new Subject<ProjectionSummaryResponse[]>();
    listAll.mockReturnValue(pending);

    fixture.point.componentInstance.retry();
    fixture.detectChanges();

    expect(fixture.point.componentInstance.sourcesResource.isLoading()).toBe(true);
    expect(fixture.nativeElement.querySelector('app-loading-indicator')).toBeNull();
    expect(texts(fixture, '.section-title')).toEqual(['Your drafts', 'Start a new draft']);

    pending.next([summary('p1', 'projection')]);
    pending.complete();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(texts(fixture, '.section-title')).toEqual(['Start a new draft']);
  });

  it('shows the spinner while there is nothing to show yet', async () => {
    listAll.mockReturnValue(new Subject<ProjectionSummaryResponse[]>());

    const fixture = MockRender(DraftStartComponent);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('app-loading-indicator')).not.toBeNull();
    expect(texts(fixture, '.section-title')).toEqual([]);
  });

  // After a failed load there is no list to keep, only the error, so Try again shows the spinner.
  it('shows the spinner, not an empty page, while a failed load is tried again', async () => {
    listAll.mockReturnValue(throwError(() => new Error('boom')));
    const fixture = await renderFixture();
    listAll.mockReturnValue(new Subject<ProjectionSummaryResponse[]>());

    fixture.point.componentInstance.retry();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('app-loading-indicator')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('app-error-state')).toBeNull();
    expect(texts(fixture, '.section-title')).toEqual([]);
  });

  it('surfaces a failed discard and leaves the row where it was', async () => {
    const draft = summary('d1', 'draft', 'in_progress');
    listAll.mockReturnValue(of([draft]));
    deleteProjection.mockReturnValue(throwError(() => new Error('boom')));

    const component = await render();
    component.confirmDiscard(draft);

    expect(notifyError).toHaveBeenCalledOnce();
    expect(component.isDiscarding(draft)).toEqual(false);
    expect(component.drafts().map((row) => row.id)).toEqual(['d1']);
  });

  it('backing out of the confirmation discards nothing', async () => {
    const draft = summary('d1', 'draft', 'in_progress');
    listAll.mockReturnValue(of([draft]));

    const component = await render();
    component.requestDiscard(draft);
    component.cancelDiscard();

    expect(component.isConfirmingDiscard(draft)).toEqual(false);
    expect(deleteProjection).not.toHaveBeenCalled();
  });

  it('says what a discard costs, and that the projection is not part of it', async () => {
    listAll.mockReturnValue(of([summary('p1', 'projection'), boardDraft('d1', 'p1')]));

    const component = await render();

    expect(component.discardPrompt(component.drafts()[0])).toEqual(
      'Discard this draft? The picks go, the projection stays.',
    );
    expect(component.discardPrompt(summary('preset1', 'draft', 'in_progress'))).toEqual(
      'Discard this draft?',
    );
  });

  it('asks before it discards, in the card the draft lives in', async () => {
    listAll.mockReturnValue(of([summary('d1', 'draft', 'in_progress')]));

    const fixture = MockRender(DraftStartComponent);
    await fixture.whenStable();
    fixture.point.componentInstance.requestDiscard(summary('d1', 'draft', 'in_progress'));
    fixture.detectChanges();

    expect(texts(fixture, '.draft-actions button')).toEqual(['Yes, discard', 'Cancel']);
    expect(texts(fixture, '.confirm-text')).toEqual(['Discard this draft?']);
  });

  /**
   * Naming a draft is what tells ten drafts off one projection apart, so it is done where they
   * are listed. A name the user typed is theirs: a clash is reported rather than numbered.
   */
  it('renames a draft from its row and re-reads the list', async () => {
    listAll.mockReturnValue(of([summary('d1', 'draft', 'in_progress')]));

    const fixture = MockRender(DraftStartComponent);
    await fixture.whenStable();
    const component = fixture.point.componentInstance;
    const draft = component.drafts()[0];

    component.requestRename(draft);
    expect(component.isRenaming(draft)).toBe(true);
    component.renameValue.set('Mock #3');
    component.saveRename(draft);
    await fixture.whenStable();

    expect(renameProjection).toHaveBeenCalledWith('d1', 'Mock #3');
    expect(component.isRenaming(draft)).toBe(false);
    expect(listAll).toHaveBeenCalledTimes(2);
  });

  it('says so when another draft already holds the name, and keeps the input open', async () => {
    listAll.mockReturnValue(of([summary('d1', 'draft', 'in_progress')]));
    renameProjection.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 409 })));

    const component = await render();
    const draft = component.drafts()[0];
    component.requestRename(draft);
    component.renameValue.set('Taken');
    component.saveRename(draft);

    expect(component.renameError()).toEqual('You already have a draft with that name.');
    expect(component.isRenaming(draft)).toBe(true);
  });

  it('refuses to save an empty name', async () => {
    listAll.mockReturnValue(of([summary('d1', 'draft', 'in_progress')]));

    const component = await render();
    const draft = component.drafts()[0];
    component.requestRename(draft);
    component.renameValue.set('   ');
    component.saveRename(draft);

    expect(renameProjection).not.toHaveBeenCalled();
    expect(component.renameError()).toEqual('Name cannot be empty.');
  });

  // The empty state links to the new-projection page; a list that is not empty used to lose
  // that door, though it is the only way to more projections from here.
  it('keeps the way to a new projection beside the projections already listed', async () => {
    listAll.mockReturnValue(of([summary('p1', 'projection', 'none')]));

    const fixture = await renderFixture();
    fixture.point.componentInstance.sourceKind.set('projection');
    fixture.detectChanges();

    // RouterLink is mocked away with the rest of the router here, so the anchor carries no
    // href; the directive's input is what says where it goes.
    const link = ngMocks.find(fixture, '.create-projection');

    expect(ngMocks.input(link, 'routerLink')).toEqual('/projections/new');
    expect(link.nativeElement.textContent?.trim()).toEqual('Create a new projection');
    expect(ngMocks.input(ngMocks.find(link, 'app-icon'), 'name')).toEqual('plus');
  });

  /**
   * Locked, not hidden. Someone who cannot see the AI projection has no reason to buy it, so
   * the card keeps its place among the presets and the padlock and the button say the rest.
   */
  describe('when the AI projection is behind a subscription', () => {
    const withRendered = async (
      test: (fixture: Awaited<ReturnType<typeof renderFixture>>) => void,
    ) => {
      listAll.mockReturnValue(of([]));
      test(await renderFixture());
    };

    it('keeps the card on the page, marked and locked', async () => {
      await withRendered((fixture) => {
        const component = fixture.point.componentInstance;

        expect(component.isPresetLocked(MODEL)).toBe(true);
        expect(component.isPresetLocked(LAST_SEASON)).toBe(false);
        // Still listed, still named, still one of the two starting points on offer.
        expect(texts(fixture, '.row-name')).toEqual([LAST_SEASON_PRESET_NAME, MODEL_PRESET_NAME]);
        expect(fixture.nativeElement.querySelectorAll('.row--locked').length).toEqual(1);
      });
    });

    /**
     * The Start button is the page's one primary action. Over a locked preset it could only
     * produce a refusal, so it becomes the thing that can actually be done next.
     */
    it('turns the Start button into the way to Premium once the locked card is picked', async () => {
      await withRendered((fixture) => {
        const component = fixture.point.componentInstance;
        component.selectPreset(MODEL);
        fixture.detectChanges();

        expect(component.selectionLocked()).toBe(true);
        const link = fixture.nativeElement.querySelector('.start-row a');
        expect(link?.textContent?.trim()).toEqual('Unlock with Premium');
        expect(link?.getAttribute('routerLink')).toEqual('/premium');
        expect(fixture.nativeElement.querySelector('.start-row button')).toBeNull();
      });
    });

    it('leaves the free preset able to start a draft as it always could', async () => {
      await withRendered((fixture) => {
        const component = fixture.point.componentInstance;
        component.selectPreset(LAST_SEASON);
        fixture.detectChanges();

        expect(component.selectionLocked()).toBe(false);
        expect(
          fixture.nativeElement.querySelector('.start-row button')?.textContent?.trim(),
        ).toEqual('Start draft');
      });
    });

    it('unlocks the card for a subscriber, badge and all', async () => {
      premium.set(true);
      await withRendered((fixture) => {
        expect(fixture.point.componentInstance.isPresetLocked(MODEL)).toBe(false);
        expect(fixture.nativeElement.querySelector('.row--locked')).toBeNull();
        // The badge stays: it names the plan the starting point belongs to.
        expect(texts(fixture, '.row-badge')).toEqual(['Premium']);
      });
    });
  });
  describe('the preset a link asks for', () => {
    // The home page's AI card says what it opens; the user's own boards must not override it.
    it('opens on the presets for the link even where there are boards of your own', async () => {
      queryParams['start'] = 'model';
      listAll.mockReturnValue(of([summary('p1', 'projection'), imported('i1', 'alex')]));
      const fixture = MockRender(DraftStartComponent);
      await fixture.whenStable();
      const component = fixture.point.componentInstance;

      expect(component.sourceKind()).toEqual('preset');
      expect(component.selection()).toEqual({ kind: 'preset', preset: MODEL });
    });

    it('opens on the AI projection when the link says so', async () => {
      queryParams['start'] = 'model';
      const fixture = MockRender(DraftStartComponent);
      await fixture.whenStable();

      expect(fixture.point.componentInstance.sourceKind()).toEqual('preset');
      expect(fixture.point.componentInstance.selection()).toEqual({
        kind: 'preset',
        preset: MODEL,
      });
    });

    /**
     * The AI preset is offered only once the BFF has said it serves the model, and the page falls
     * back to the first row whenever the picked one is not offered. The pick has to wait for the
     * answer, or the answer would undo it.
     */
    it('waits for the environment to offer the preset before picking it', async () => {
      queryParams['start'] = 'model';
      aiProjection.set(false);
      const fixture = MockRender(DraftStartComponent);
      await fixture.whenStable();
      const component = fixture.point.componentInstance;
      expect(component.selection()).toEqual({ kind: 'preset', preset: LAST_SEASON });

      aiProjection.set(true);
      fixture.detectChanges();
      expect(component.selection()).toEqual({ kind: 'preset', preset: MODEL });
    });

    /**
     * A preset already drafted against has no row, only its draft card at the top. The page must
     * not keep waiting for the row either: discarding that draft later would suddenly pick it.
     */
    // A preset that has been drafted against is still the one the link asks for: the draft it
    // produced is its own row, and starting another is exactly what the link is for.
    it('picks the preset even where it already has a draft', async () => {
      queryParams['start'] = 'model';
      listAll.mockReturnValue(
        of([summary('m1', 'draft', 'in_progress', '2026-06-01T00:00:00Z', MODEL)]),
      );
      const fixture = MockRender(DraftStartComponent);
      await fixture.whenStable();
      const component = fixture.point.componentInstance;

      expect(component.selection()).toEqual({ kind: 'preset', preset: MODEL });
    });

    it('ignores a value that names no preset', async () => {
      queryParams['start'] = 'blank';
      listAll.mockReturnValue(of([]));
      const fixture = MockRender(DraftStartComponent);
      await fixture.whenStable();

      expect(fixture.point.componentInstance.selection()).toEqual({
        kind: 'preset',
        preset: LAST_SEASON,
      });
    });
  });
});
