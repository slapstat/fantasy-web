import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Api } from '../api/api';
import { RoleChangeListResponse } from '../api/models/role-change-list-response';
import { RoleChangesComponent } from './role-changes';

const ANSWER: RoleChangeListResponse = {
  season: 2026,
  recentGames: 5,
  players: [
    {
      playerId: 1,
      name: 'Vasily Podkolzin',
      teamAbbrev: 'EDM',
      defence: false,
      recent: { games: 4, toiPerGame: 1080, ppToiPerGame: 240, ppShare: 0.8 },
      baseline: { games: 70, toiPerGame: 720, ppToiPerGame: 10, ppShare: 0.05 },
      baselineSource: 'LAST_SEASON',
      firstRecentGameDate: '2026-09-29',
      lastRecentGameDate: '2026-10-04',
      listedBefore: { seenOn: '2026-09-28', line: 'f4', outOfLineup: false },
      listedNow: { seenOn: '2026-10-04', line: 'f2', powerPlayUnit: 1, outOfLineup: false },
    },
    {
      playerId: 2,
      name: 'Ryan Nugent-Hopkins',
      teamAbbrev: 'EDM',
      defence: false,
      recent: { games: 4, toiPerGame: 900, ppToiPerGame: 60, ppShare: 0.2 },
      baseline: { games: 75, toiPerGame: 1150, ppToiPerGame: 220, ppShare: 0.75 },
      baselineSource: 'LAST_SEASON',
      firstRecentGameDate: '2026-09-29',
      lastRecentGameDate: '2026-10-04',
    },
  ],
};

describe('RoleChangesComponent', () => {
  let fixture: ComponentFixture<RoleChangesComponent>;
  let invoke: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    invoke = vi.fn().mockResolvedValue(ANSWER);
    await TestBed.configureTestingModule({
      imports: [RoleChangesComponent],
      providers: [{ provide: Api, useValue: { invoke } }],
    }).compileComponents();
    fixture = TestBed.createComponent(RoleChangesComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  function names(): string[] {
    const element: HTMLElement = fixture.nativeElement;
    return Array.from(element.querySelectorAll('tbody .name')).map((cell) =>
      (cell.textContent ?? '').trim(),
    );
  }

  function press(label: string): void {
    const element: HTMLElement = fixture.nativeElement;
    const button = Array.from(element.querySelectorAll('button')).find(
      (candidate) => (candidate.textContent ?? '').trim() === label,
    );
    button!.click();
    fixture.detectChanges();
  }

  it('opens on the risers in ice, with the lineup page move beside them', () => {
    expect(invoke).toHaveBeenCalledWith(expect.anything(), { recentGames: 5 });
    expect(names()).toEqual(['Vasily Podkolzin']);
    const element: HTMLElement = fixture.nativeElement;
    expect(element.querySelector('tbody')!.textContent).toContain('+6:00');
    expect(element.querySelector('tbody')!.textContent).toContain('L4');
    expect(element.querySelector('.lineup .badge app-icon')).not.toBeNull();
  });

  it('shows the fallers one switch away', () => {
    press('Falling');

    expect(names()).toEqual(['Ryan Nugent-Hopkins']);
  });

  it('asks again for another stretch of games', async () => {
    const select: HTMLSelectElement = fixture.nativeElement.querySelector('select');
    select.value = '10';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    await fixture.whenStable();

    expect(invoke).toHaveBeenLastCalledWith(expect.anything(), { recentGames: 10 });
  });
});
