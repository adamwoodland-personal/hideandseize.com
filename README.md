# Hide & Seize

**https://hideandseize.com/**

A turn-based stealth game of capture the flag, played in the browser against the computer. Sneak into Red's half, hide in the long grass, steal their flag and bring it home before they take yours. First to 3 points wins.

Each side has eight players: a Scout, two Runners, a Shadow, two Hunters and two Guards, each with their own Speed, Sight, Stealth and Strength. You start knowing only your own half of the field, Red's players show only while one of yours can see them, and tackles succeed by chance. How to play (the **?** button) has the full rules.

## How it's built

Static files, no framework, no build step, no backend:

- `index.html`, `style.css`: the page, its dialogs and How to play, with the questions at the end (the FAQPage JSON-LD in `<head>` says the same, word for word).
- `app.js`: the game page: picking and moving players, tackles, the turn, Red's moves played back, zoom and pan, keys, and the saved game.
- `rules.js`: the rules, with no DOM, so they run under Node: movement, sight and cover, tackles, scoring, the turn order, and the checks on a saved game (`validState`).
- `ai.js`: the computer (Easy, Normal, Hard and Really Hard). It knows only what a player in its place would: it sees Blue's players only through its own and remembers where it last saw them, plans on the ground its players have seen (guessing the rest from its own half, which the far half mirrors) and moves only onto that. The harder levels get no extra moves, luck or sight. Hard plans its tackles as a team (a miss winds the target, so the order matters), takes the flag the moment its carrier could get clear, and keeps a carrier out of reach of the players it can see. Really Hard also stands four players on the four squares its flag can be reached from.
- `view.js`: the field on a canvas (ground, figures, flags, trails), with zoom and pan. `figures.js`: the players, drawn by role (Scout, Runner, Shadow, Hunter, Guard), and their portraits.
- `maps.js`: the map format (parse, check, write, build a field from a map). `library.js`: the maps the browser knows, built in (`maps/`, listed in `maps/index.json`) and the player's own (localStorage).
- `editor.html`, `editor.css`, `editor.js`: the map editor.

## Map files

A map is a JSON file such as `maps/meadow.json`:

```json
{
  "format": "hide-and-seize-map",
  "version": 1,
  "id": "meadow",
  "name": "Meadow",
  "author": "Hide & Seize",
  "blurb": "Open fields, copses and two low hills. A good first game.",
  "shuffle": 0.2,
  "blueHalf": [
    ".,..TT......,......TT..,.",
    "..TT.....,,......,,...T..",
    "..."
  ]
}
```

`blueHalf` is Blue's half, one string per row, from the middle row (shared by both halves) back to Blue's back row. Red's half is Blue's turned 180°, so the two sides are always the same ground, and the middle row must read the same both ways. In each row:

| Letter | Square | Letter | Square |
|---|---|---|---|
| `.` | grass | `~` | water |
| `,` | long grass | `=` | bridge |
| `T` | woods | `:` | ford |
| `^` | hill | `F` | Blue's flag |
| `#` | rocks | `s` `r` `d` `h` `g` | a Scout, Runner, Shadow, Hunter or Guard (the team, and where it starts) |

Rows can be 11 to 45 squares wide, and there can be 8 to 31 of them (a field 15 to 61 long). A map needs one flag, at least 3 rows back from the middle, with nothing impassable round it; 1 to 12 players, none on the middle row or the flag; and a way for every player to reach the other flag, and for it to be carried home from there (rocks block the way; water can be waded, at 3 moves a square). `shuffle` (0 to 0.4) is the share of each half's woods and long grass that moves a square each game.

The map editor (`editor.html`) makes these files, checks them as you go, and keeps your maps in the browser. To add a map to the game for everyone, put its file in `maps/` and its name in `maps/index.json`.

## Licence

MIT (see `LICENSE`).

Design, code and content developed with the assistance of AI (Anthropic Claude).
