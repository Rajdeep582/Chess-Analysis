import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { nameMatches, normalizeName, parseQuery } from '../src/database/query';
import { clearLocalDb, importPgnDatabase, localDbStats, pgnToRecords, searchLocalDb } from '../src/database/localDb';
import { SAMPLE_GAMES } from '../src/state/samples';

describe('search query parsing', () => {
  it('understands "name vs name", dashes and years', () => {
    expect(parseQuery('Carlsen vs Anand')).toMatchObject({ a: 'Carlsen', b: 'Anand' });
    expect(parseQuery('Kasparov - Topalov 1999')).toMatchObject({ a: 'Kasparov', b: 'Topalov', year: 1999 });
    expect(parseQuery('Fischer v. Spassky')).toMatchObject({ a: 'Fischer', b: 'Spassky' });
    expect(parseQuery('hikaru')).toMatchObject({ a: 'hikaru', b: undefined });
    expect(parseQuery('   ')).toBeNull();
  });
  it('matches PGN-style names loosely', () => {
    expect(normalizeName('Carlsen, Magnus')).toBe('carlsen magnus');
    expect(nameMatches('carlsen', 'Carlsen, Magnus')).toBe(true);
    expect(nameMatches('Magnus Carlsen', 'Carlsen,M')).toBe(true);
    expect(nameMatches('Anand', 'Aronian, Levon')).toBe(false);
    expect(nameMatches('Ljubojevic', 'Ljubojević, Ljubomir')).toBe(true);
  });
});

describe('local PGN database', () => {
  const db = SAMPLE_GAMES.map((g) => g.pgn).join('\n\n');
  it('splits a multi-game PGN into records', () => {
    const recs = pgnToRecords(db, 'classics');
    expect(recs.length).toBe(SAMPLE_GAMES.length);
    expect(recs[0].white).toBe('Magnus Carlsen');
  });
  it('imports, de-duplicates and searches by players and year', async () => {
    await clearLocalDb();
    const r1 = await importPgnDatabase(db, 'classics');
    expect(r1.added).toBe(SAMPLE_GAMES.length);
    const r2 = await importPgnDatabase(db, 'classics');
    expect(r2.added).toBe(0);
    expect((await localDbStats()).games).toBe(SAMPLE_GAMES.length);
    const vs = await searchLocalDb(parseQuery('Topalov vs Kasparov')!, 50);
    expect(vs.map((h) => h.white)).toEqual(['Garry Kasparov']);
    const single = await searchLocalDb(parseQuery('Fischer')!, 50);
    expect(single.length).toBe(1);
    const year = await searchLocalDb(parseQuery('Anand 2013')!, 50);
    expect(year.length).toBe(1);
    expect((await searchLocalDb(parseQuery('Anand 1999')!, 50)).length).toBe(0);
  });
});
