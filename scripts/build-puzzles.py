#!/usr/bin/env python3
"""
Build public/data/puzzles.json — an offline, theme-categorised sample of the Lichess puzzle
database (CC0, https://database.lichess.org/#puzzles).

Usage:
  curl -r 0-25000000 https://database.lichess.org/lichess_db_puzzle.csv.zst -o part.zst   # ~500k puzzles
  pip install zstandard
  python3 scripts/build-puzzles.py part.zst puzzleTheme.xml

puzzleTheme.xml: https://raw.githubusercontent.com/lichess-org/lila/master/translation/source/puzzleTheme.xml
"""
import csv, io, json, re, sys, html
import xml.etree.ElementTree as ET

PER_THEME = 60
BANDS = [(0, 1000), (1000, 1400), (1400, 1800), (1800, 2200), (2200, 2600), (2600, 9999)]

GROUPS = [
    ('Mates', ['mate', 'mateIn1', 'mateIn2', 'mateIn3', 'mateIn4', 'mateIn5', 'backRankMate', 'smotheredMate', 'anastasiaMate', 'arabianMate',
               'bodenMate', 'doubleBishopMate', 'dovetailMate', 'hookMate', 'epauletteMate', 'operaMate', 'pillsburysMate', 'morphysMate',
               'cornerMate', 'swallowstailMate', 'triangleMate', 'killBoxMate', 'vukovicMate', 'blindSwineMate', 'balestraMate']),
    ('Motifs', ['fork', 'pin', 'skewer', 'discoveredAttack', 'discoveredCheck', 'doubleCheck', 'hangingPiece', 'trappedPiece', 'sacrifice',
                'capturingDefender', 'exposedKing', 'kingsideAttack', 'queensideAttack', 'attackingF2F7', 'advancedPawn']),
    ('Advanced', ['deflection', 'attraction', 'clearance', 'interference', 'intermezzo', 'quietMove', 'defensiveMove', 'xRayAttack',
                  'zugzwang', 'collinearMove']),
    ('Phases', ['opening', 'middlegame', 'endgame', 'rookEndgame', 'pawnEndgame', 'bishopEndgame', 'knightEndgame', 'queenEndgame',
                'queenRookEndgame']),
    ('Special moves', ['promotion', 'underPromotion', 'castling', 'enPassant']),
    ('Length & goal', ['oneMove', 'short', 'long', 'veryLong', 'equality', 'advantage', 'crushing']),
    ('Origin', ['master', 'masterVsMaster', 'superGM']),
]


def theme_texts(path):
    strings = [(e.get('name'), html.unescape(e.text or '')) for e in ET.parse(path).getroot().iter('string')]
    out = {}
    for i, (k, v) in enumerate(strings):
        if k and not k.endswith('Description') and i + 1 < len(strings) and 'Description' in (strings[i + 1][0] or '') or k == 'promotion':
            desc = strings[i + 1][1] if i + 1 < len(strings) else ''
            out[k] = {'name': v, 'desc': re.sub(r'\s+', ' ', desc).strip()}
    return out


def rows(path):
    import zstandard
    with open(path, 'rb') as f:
        r = io.TextIOWrapper(zstandard.ZstdDecompressor().stream_reader(f), encoding='utf-8')
        try:
            yield from csv.DictReader(r)
        except Exception:
            return  # truncated range download


def main(zst, xml_path, out='public/data/puzzles.json'):
    texts = theme_texts(xml_path)
    wanted = [t for _, ts in GROUPS for t in ts]
    buckets = {t: [[] for _ in BANDS] for t in wanted}
    cap = PER_THEME // len(BANDS)
    for r in rows(zst):
        try:
            if not r['Themes'] or int(r['Popularity']) < 85 or int(r['NbPlays']) < 400 or int(r['RatingDeviation']) > 90:
                continue
            rating = int(r['Rating'])
        except (KeyError, ValueError, TypeError):
            continue
        b = next(i for i, (lo, hi) in enumerate(BANDS) if lo <= rating < hi)
        for t in r['Themes'].split():
            if t in buckets and len(buckets[t][b]) < cap * 3:
                buckets[t][b].append(r)

    chosen, theme_ids = {}, {}
    for t in wanted:
        picked = []
        for band in buckets[t]:
            band.sort(key=lambda r: -int(r['NbPlays']))
            picked += band[:cap]
        # top up from other bands when a band is thin
        if len(picked) < PER_THEME:
            rest = sorted((r for band in buckets[t] for r in band[cap:]), key=lambda r: -int(r['NbPlays']))
            picked += rest[: PER_THEME - len(picked)]
        for r in picked:
            chosen[r['PuzzleId']] = r
        theme_ids[t] = [r['PuzzleId'] for r in picked]

    ids = sorted(chosen)
    index = {pid: i for i, pid in enumerate(ids)}
    puzzles = [[pid, chosen[pid]['FEN'], chosen[pid]['Moves'], int(chosen[pid]['Rating']), chosen[pid]['Themes'],
                (chosen[pid]['OpeningTags'] or '').split(' ')[0]] for pid in ids]
    data = {
        'source': 'Lichess puzzle database (CC0) — https://database.lichess.org/#puzzles',
        'groups': [{'name': g, 'themes': [t for t in ts if theme_ids.get(t)]} for g, ts in GROUPS],
        'themes': {t: {**texts.get(t, {'name': t, 'desc': ''}), 'ids': sorted(index[i] for i in theme_ids[t])} for t in wanted if theme_ids[t]},
        'puzzles': puzzles,
    }
    with open(out, 'w') as f:
        json.dump(data, f, separators=(',', ':'), ensure_ascii=False)
    print(f'puzzles={len(puzzles)} themes={len(data["themes"])} -> {out}')


if __name__ == '__main__':
    main(*sys.argv[1:])
