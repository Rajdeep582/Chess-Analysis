/** Famous historical games (game scores are public facts) used as samples on the home page. */
export interface SampleGame {
  id: string;
  title: string;
  player: string;
  white: string;
  black: string;
  year: number;
  event: string;
  tagline: string;
  /** Side to show at the bottom of the preview board (the hero's colour). */
  orientation: 'w' | 'b';
  pgn: string;
}

const pgn = (h: Record<string, string>, moves: string) =>
  `${Object.entries(h)
    .map(([k, v]) => `[${k} "${v}"]`)
    .join('\n')}\n\n${moves}`;

export const SAMPLE_GAMES: SampleGame[] = [
  {
    id: 'carlsen-ernst',
    title: 'Teenage Magnus',
    player: 'Magnus Carlsen',
    white: 'Magnus Carlsen',
    black: 'Sipke Ernst',
    year: 2004,
    event: 'Corus C, Wijk aan Zee',
    tagline: 'A 13-year-old sacrifices knight and bishop and mates with the queen.',
    orientation: 'w',
    pgn: pgn(
      { Event: 'Corus C', Site: 'Wijk aan Zee NED', Date: '2004.01.24', Round: '12', White: 'Magnus Carlsen', Black: 'Sipke Ernst', Result: '1-0', ECO: 'B19' },
      `1. e4 c6 2. d4 d5 3. Nc3 dxe4 4. Nxe4 Bf5 5. Ng3 Bg6 6. h4 h6 7. Nf3 Nd7 8. h5 Bh7
9. Bd3 Bxd3 10. Qxd3 e6 11. Bf4 Ngf6 12. O-O-O Be7 13. Ne4 Qa5 14. Kb1 O-O
15. Nxf6+ Nxf6 16. Ne5 Rad8 17. Qe2 c5 18. Ng6 fxg6 19. Qxe6+ Kh8 20. hxg6 Ng8
21. Bxh6 gxh6 22. Rxh6+ Nxh6 23. Qxe7 Nf7 24. gxf7 Kg7 25. Rd3 Rd6 26. Rg3+ Rg6
27. Qe5+ Kxf7 28. Qf5+ Rf6 29. Qd7# 1-0`,
    ),
  },
  {
    id: 'byrne-fischer',
    title: 'The Game of the Century',
    player: 'Bobby Fischer',
    white: 'Donald Byrne',
    black: 'Robert James Fischer',
    year: 1956,
    event: 'Rosenwald Memorial, New York',
    tagline: '13-year-old Fischer gives up his queen with 17…Be6!! and hunts the king.',
    orientation: 'b',
    pgn: pgn(
      { Event: 'Third Rosenwald Trophy', Site: 'New York USA', Date: '1956.10.17', Round: '8', White: 'Donald Byrne', Black: 'Robert James Fischer', Result: '0-1', ECO: 'D92' },
      `1. Nf3 Nf6 2. c4 g6 3. Nc3 Bg7 4. d4 O-O 5. Bf4 d5 6. Qb3 dxc4 7. Qxc4 c6 8. e4 Nbd7
9. Rd1 Nb6 10. Qc5 Bg4 11. Bg5 Na4 12. Qa3 Nxc3 13. bxc3 Nxe4 14. Bxe7 Qb6 15. Bc4 Nxc3
16. Bc5 Rfe8+ 17. Kf1 Be6 18. Bxb6 Bxc4+ 19. Kg1 Ne2+ 20. Kf1 Nxd4+ 21. Kg1 Ne2+
22. Kf1 Nc3+ 23. Kg1 axb6 24. Qb4 Ra4 25. Qxb6 Nxd1 26. h3 Rxa2 27. Kh2 Nxf2 28. Re1 Rxe1
29. Qd8+ Bf8 30. Nxe1 Bd5 31. Nf3 Ne4 32. Qb8 b5 33. h4 h5 34. Ne5 Kg7 35. Kg1 Bc5+
36. Kf1 Ng3+ 37. Ke1 Bb4+ 38. Kd1 Bb3+ 39. Kc1 Ne2+ 40. Kb1 Nc3+ 41. Kc1 Rc2# 0-1`,
    ),
  },
  {
    id: 'aronian-anand',
    title: "Anand's Immortal",
    player: 'Viswanathan Anand',
    white: 'Levon Aronian',
    black: 'Viswanathan Anand',
    year: 2013,
    event: 'Tata Steel, Wijk aan Zee',
    tagline: 'Vishy sacrifices on g4 and lets his pieces flood the white king.',
    orientation: 'b',
    pgn: pgn(
      { Event: 'Tata Steel Masters', Site: 'Wijk aan Zee NED', Date: '2013.01.15', Round: '4', White: 'Levon Aronian', Black: 'Viswanathan Anand', Result: '0-1', ECO: 'D47' },
      `1. d4 d5 2. c4 c6 3. Nf3 Nf6 4. Nc3 e6 5. e3 Nbd7 6. Bd3 dxc4 7. Bxc4 b5 8. Bd3 Bd6
9. O-O O-O 10. Qc2 Bb7 11. a3 Rc8 12. Ng5 c5 13. Nxh7 Ng4 14. f4 cxd4 15. exd4 Bc5
16. Be2 Nde5 17. Bxg4 Bxd4+ 18. Kh1 Nxg4 19. Nxf8 f5 20. Ng6 Qf6 21. h3 Qxg6
22. Qe2 Qh5 23. Qd3 Be3 0-1`,
    ),
  },
  {
    id: 'tal-smyslov',
    title: 'The Magician from Riga',
    player: 'Mikhail Tal',
    white: 'Mikhail Tal',
    black: 'Vasily Smyslov',
    year: 1959,
    event: 'Candidates Tournament, Yugoslavia',
    tagline: 'Tal leaves pieces hanging all over the board against a former world champion.',
    orientation: 'w',
    pgn: pgn(
      { Event: 'Candidates Tournament', Site: 'Bled YUG', Date: '1959.09.11', Round: '?', White: 'Mikhail Tal', Black: 'Vasily Smyslov', Result: '1-0', ECO: 'B10' },
      `1. e4 c6 2. d3 d5 3. Nd2 e5 4. Ngf3 Nd7 5. d4 dxe4 6. Nxe4 exd4 7. Qxd4 Ngf6 8. Bg5 Be7
9. O-O-O O-O 10. Nd6 Qa5 11. Bc4 b5 12. Bd2 Qa6 13. Nf5 Bd8 14. Qh4 bxc4 15. Qg5 Nh5
16. Nh6+ Kh8 17. Qxh5 Qxa2 18. Bc3 Nf6 19. Qxf7 Qa1+ 20. Kd2 Rxf7 21. Nxf7+ Kg8
22. Rxa1 Kxf7 23. Ne5+ Ke6 24. Nxc6 Ne4+ 25. Ke3 Bb6+ 26. Bd4 1-0`,
    ),
  },
  {
    id: 'kasparov-topalov',
    title: "Kasparov's Immortal",
    player: 'Garry Kasparov',
    white: 'Garry Kasparov',
    black: 'Veselin Topalov',
    year: 1999,
    event: 'Hoogovens, Wijk aan Zee',
    tagline: '24.Rxd4!! starts a king hunt that drags Black’s king across the board.',
    orientation: 'w',
    pgn: pgn(
      { Event: 'Hoogovens', Site: 'Wijk aan Zee NED', Date: '1999.01.20', Round: '4', White: 'Garry Kasparov', Black: 'Veselin Topalov', Result: '1-0', ECO: 'B07' },
      `1. e4 d6 2. d4 Nf6 3. Nc3 g6 4. Be3 Bg7 5. Qd2 c6 6. f3 b5 7. Nge2 Nbd7 8. Bh6 Bxh6
9. Qxh6 Bb7 10. a3 e5 11. O-O-O Qe7 12. Kb1 a6 13. Nc1 O-O-O 14. Nb3 exd4 15. Rxd4 c5
16. Rd1 Nb6 17. g3 Kb8 18. Na5 Ba8 19. Bh3 d5 20. Qf4+ Ka7 21. Rhe1 d4 22. Nd5 Nbxd5
23. exd5 Qd6 24. Rxd4 cxd4 25. Re7+ Kb6 26. Qxd4+ Kxa5 27. b4+ Ka4 28. Qc3 Qxd5
29. Ra7 Bb7 30. Rxb7 Qc4 31. Qxf6 Kxa3 32. Qxa6+ Kxb4 33. c3+ Kxc3 34. Qa1+ Kd2
35. Qb2+ Kd1 36. Bf1 Rd2 37. Rd7 Rxd7 38. Bxc4 bxc4 39. Qxh8 Rd3 40. Qa8 c3 41. Qa4+ Ke1
42. f4 f5 43. Kc1 Rd2 44. Qa7 1-0`,
    ),
  },
  {
    id: 'opera',
    title: 'The Opera Game',
    player: 'Paul Morphy',
    white: 'Paul Morphy',
    black: 'Duke Karl / Count Isouard',
    year: 1858,
    event: 'Casual game, Paris Opera',
    tagline: 'Rapid development, a queen sacrifice and mate on the back rank.',
    orientation: 'w',
    pgn: pgn(
      { Event: 'Casual game, Paris Opera', Site: 'Paris FRA', Date: '1858.??.??', Round: '?', White: 'Paul Morphy', Black: 'Duke Karl / Count Isouard', Result: '1-0', ECO: 'C41' },
      `1. e4 e5 2. Nf3 d6 3. d4 Bg4 4. dxe5 Bxf3 5. Qxf3 dxe5 6. Bc4 Nf6 7. Qb3 Qe7
8. Nc3 c6 9. Bg5 b5 10. Nxb5 cxb5 11. Bxb5+ Nbd7 12. O-O-O Rd8 13. Rxd7 Rxd7
14. Rd1 Qe6 15. Bxd7+ Nxd7 16. Qb8+ Nxb8 17. Rd8# 1-0`,
    ),
  },
  {
    id: 'immortal',
    title: 'The Immortal Game',
    player: 'Adolf Anderssen',
    white: 'Adolf Anderssen',
    black: 'Lionel Kieseritzky',
    year: 1851,
    event: 'Casual game, London',
    tagline: 'Both rooks and the queen given away — then mate with the minor pieces.',
    orientation: 'w',
    pgn: pgn(
      { Event: 'London casual game', Site: 'London ENG', Date: '1851.06.21', Round: '?', White: 'Adolf Anderssen', Black: 'Lionel Kieseritzky', Result: '1-0', ECO: 'C33' },
      `1. e4 e5 2. f4 exf4 3. Bc4 Qh4+ 4. Kf1 b5 5. Bxb5 Nf6 6. Nf3 Qh6 7. d3 Nh5 8. Nh4 Qg5
9. Nf5 c6 10. g4 Nf6 11. Rg1 cxb5 12. h4 Qg6 13. h5 Qg5 14. Qf3 Ng8 15. Bxf4 Qf6
16. Nc3 Bc5 17. Nd5 Qxb2 18. Bd6 Bxg1 19. e5 Qxa1+ 20. Ke2 Na6 21. Nxg7+ Kd8
22. Qf6+ Nxf6 23. Be7# 1-0`,
    ),
  },
];
