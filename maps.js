// Hide & Seize maps: the file format, checking a map, and building the field from it.
//
// A map is a JSON file (the built-in ones are in maps/, listed in maps/index.json):
//   {
//     "format": "hide-and-seize-map", "version": 1,
//     "name": "Meadow", "author": "…", "blurb": "One line about it",
//     "shuffle": 0.2,         the share of each half's woods and long grass nudged one square each game
//                             (0 to 0.4), so the far side has to be explored rather than mirrored
//     "blueHalf": [ "…" ]     Blue's half, one string a row, from the middle row down to Blue's back
//                             row. Red's half is the same turned round (180°), so the sides always
//                             match; the middle row must read the same both ways.
//   }
// The key:  .  grass    ,  long grass    T  woods    ^  hill    #  rocks    ~  water    =  bridge    :  ford
//           F  Blue's flag    s  Scout   r  Runner   d  Shadow   h  Hunter   g  Guard
// Players and the flag stand on grass; the letters also set how many of each a side has.
export const FORMAT = 'hide-and-seize-map';
export const LIMITS = { minW: 11, maxW: 45, minRows: 8, maxRows: 31, maxTeam: 12, shuffle: 0.4 };
export const T = { GRASS: 0, SCRUB: 1, FOREST: 2, HILL: 3, ROCK: 4, WATER: 5, BRIDGE: 6, FORD: 7 };
export const CHAR = { '.': 0, ',': 1, T: 2, '^': 3, '#': 4, '~': 5, '=': 6, ':': 7 };
export const ROLE_LETTER = { s: 'scout', r: 'runner', d: 'shadow', h: 'hunter', g: 'guard' };
export const LETTER = Object.fromEntries(Object.entries(ROLE_LETTER).map(([k, v]) => [v, k]));
const ROLE_ORDER = ['scout', 'runner', 'shadow', 'hunter', 'guard'];
const PASS = [true, true, true, true, false, true, true, true], COST = [1, 1, 2, 2, 0, 3, 1, 3]; // (as rules.js TERRAIN: rocks block, water is waded)

// The maps the game knows: the built-in ones, then the player's own (added by the page).
export const MAPS = [];
export function addMap(def) {
	const i = MAPS.findIndex((m) => m.id === def.id);
	if (i >= 0) MAPS[i] = def; else MAPS.push(def);
	return def;
}
export const slug = (t) => String(t).toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'map';

// A file (text or parsed JSON) → { def, errors }. def is { id, name, author, blurb, vary, rows }.
// Only the shape is checked here; checkMap() says whether it can be played.
// Text without control, zero-width or reordering characters (a map file can come from anyone).
const clean = (t) => [...t].filter((c) => { const k = c.codePointAt(0); return !(k < 32 || (k >= 127 && k < 160) || (k >= 0x200b && k <= 0x200f) || (k >= 0x202a && k <= 0x202e) || (k >= 0x2066 && k <= 0x2069) || k === 0xfeff); }).join('');
export function parseMap(input) {
	let o = input;
	if (typeof input === 'string') { try { o = JSON.parse(input); } catch (e) { return { def: null, errors: ["That isn't a map file (it isn't valid JSON)."] }; } }
	if (!o || typeof o !== 'object' || Array.isArray(o)) return { def: null, errors: ["That isn't a map file."] };
	if (o.format !== FORMAT) return { def: null, errors: [`That isn't a Hide & Seize map (its "format" should be "${FORMAT}").`] };
	if (o.version !== 1) return { def: null, errors: [`This map is version ${o.version}; this game reads version 1.`] };
	const errors = [], text = (k, max, need) => {
		const v = o[k] === undefined ? '' : o[k];
		if (typeof v !== 'string') { errors.push(`"${k}" should be text.`); return ''; }
		const t = clean(v).trim();
		if (need && !t) errors.push(`The map needs a ${k}.`);
		if (t.length > max) errors.push(`"${k}" is longer than ${max} characters.`);
		return t.slice(0, max);
	};
	const name = text('name', 40, true), author = text('author', 40), blurb = text('blurb', 200);
	let vary = o.shuffle === undefined ? 0.2 : o.shuffle;
	if (typeof vary !== 'number' || !Number.isFinite(vary) || vary < 0 || vary > LIMITS.shuffle) { errors.push(`"shuffle" should be a number from 0 to ${LIMITS.shuffle}.`); vary = 0.2; }
	const rows = o.blueHalf;
	if (!Array.isArray(rows) || !rows.length || !rows.every((r) => typeof r === 'string')) { errors.push('"blueHalf" should be a list of rows of text.'); return { def: null, errors }; }
	if (rows.length > LIMITS.maxRows || rows.some((r) => r.length > LIMITS.maxW)) { errors.push(`The map is bigger than ${LIMITS.maxW} wide by ${LIMITS.maxRows * 2 - 1} long.`); return { def: null, errors }; }
	const id = typeof o.id === 'string' && /^[a-z0-9-]{1,48}$/.test(o.id) ? o.id : slug(name);
	return { def: { id, name, author, blurb, vary: Math.round(vary * 100) / 100, rows: rows.slice() }, errors };
}

// The file for a map: JSON with one row a line, so it reads (and diffs) like the map itself.
export function mapFile(def) {
	const o = { format: FORMAT, version: 1, id: def.id, name: def.name, author: def.author || '', blurb: def.blurb || '', shuffle: def.vary ?? 0.2, blueHalf: def.rows };
	return JSON.stringify(o, null, '\t') + '\n';
}

// Whether a map can be played: { errors, warnings, stats }. Errors stop it being played; warnings are
// advice. The messages are written for the person making the map.
export function checkMap(def) {
	const errors = [], warnings = [], rows = def && def.rows;
	if (!Array.isArray(rows) || !rows.length) return { errors: ['The map has no rows.'], warnings, stats: null };
	const W = rows[0].length, H = rows.length * 2 - 1, mid = rows.length - 1;
	if (rows.some((r) => r.length !== W)) errors.push('Every row must be the same width.');
	if (W < LIMITS.minW || W > LIMITS.maxW) errors.push(`The width must be ${LIMITS.minW} to ${LIMITS.maxW} squares (it's ${W}).`);
	if (rows.length < LIMITS.minRows || rows.length > LIMITS.maxRows) errors.push(`The length must be ${LIMITS.minRows * 2 - 1} to ${LIMITS.maxRows * 2 - 1} squares (it's ${H}).`);
	const bad = new Set();
	rows.forEach((r) => { for (const c of r) if (!(c in CHAR) && c !== 'F' && !ROLE_LETTER[c]) bad.add(c); });
	if (bad.size) errors.push(`Unknown letters in the map: ${[...bad].map((c) => `"${c}"`).join(', ')}.`);
	if (errors.length) return { errors, warnings, stats: null };
	const mr = rows[0];
	if ([...mr].some((c, x) => c !== mr[W - 1 - x])) errors.push("The middle row must read the same both ways (it's shared by both sides).");
	if (/[F]/.test(mr) || [...mr].some((c) => ROLE_LETTER[c])) errors.push("The flag and the players can't start on the middle row.");
	let flags = 0, team = 0, flag = null;
	const roles = {};
	rows.forEach((r, i) => { for (let x = 0; x < W; x++) { const c = r[x]; if (c === 'F') { flags++; flag = { x, y: mid + i }; } else if (ROLE_LETTER[c]) { team++; roles[ROLE_LETTER[c]] = (roles[ROLE_LETTER[c]] || 0) + 1; } } });
	if (flags !== 1) errors.push(flags ? 'There should be one flag, not ' + flags + '.' : "There's no flag. Put Blue's flag (F) somewhere on Blue's half.");
	if (!team) errors.push('There are no players. Place some (s r d h g) on Blue\'s half.');
	if (team > LIMITS.maxTeam) errors.push(`At most ${LIMITS.maxTeam} players a side (there are ${team}).`);
	if (errors.length) return { errors, warnings, stats: null };
	const m = buildMap(def, 0, 0), N = m.W * m.H;
	const f = m.flags.blue;
	if (f.x < 1 || f.x > W - 2 || f.y > H - 2) errors.push('The flag needs a square of room on every side for its base.');
	else for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const v = m.tiles[(f.y + dy) * W + f.x + dx]; if (v === T.ROCK || v === T.WATER) { errors.push("The eight squares round the flag (its base) can't be rocks or water."); dy = dx = 2; } }
	if (f.y - mid < 3) errors.push('The flag must be at least 3 rows back from the middle.');
	// Every start must be able to reach the other flag, and the flag must be able to come home from there.
	const from = (sx, sy, ownFlag) => {
		const dist = new Float64Array(N).fill(Infinity), q = [[sy * W + sx]];
		dist[sy * W + sx] = 0;
		for (let c = 0; c < q.length; c++) for (const i of q[c] || []) {
			if (dist[i] !== c) continue;
			const x = i % W, y = (i - x) / W;
			for (const [ex, ey] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
				const nx = x + ex, ny = y + ey, j = ny * W + nx;
				if (nx < 0 || ny < 0 || nx >= W || ny >= H || !PASS[m.tiles[j]] || j === ownFlag) continue;
				const nc = c + COST[m.tiles[j]];
				if (nc < dist[j]) { dist[j] = nc; (q[nc] ||= []).push(j); }
			}
		}
		return dist;
	};
	const ownFlag = f.y * W + f.x, theirs = m.flags.red, stuck = [];
	let far = 0;
	for (const p of m.starts.blue) {
		const d = from(p.x, p.y, ownFlag), c = d[theirs.y * W + theirs.x];
		if (!Number.isFinite(c)) stuck.push(p);
		else far = Math.max(far, c);
	}
	if (stuck.length) errors.push(`${stuck.length === 1 ? 'A player' : stuck.length + ' players'} can't reach Red's flag (rocks are in the way): ${stuck.map((p) => `${p.role} at ${p.x + 1},${p.y - mid}`).join('; ')}.`);
	// (from Red's flag, a carrier must be able to get back to a square of its own base: a wall down the
	// middle of each half would let both sides steal a flag that could never be scored)
	if (stuck.length < m.starts.blue.length) {
		const home = from(theirs.x, theirs.y, ownFlag), base = [];
		for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx || dy) base.push((f.y + dy) * W + f.x + dx);
		if (!base.some((i) => Number.isFinite(home[i]))) errors.push("Red's flag can't be carried back to Blue's base from where it stands: rocks cut the way home off.");
	}
	if (m.starts.blue.some((p) => p.x === f.x && p.y === f.y)) errors.push("A player can't start on the flag.");
	// Advice.
	const cover = m.tiles.filter((t) => t === T.SCRUB || t === T.FOREST).length / N;
	if (cover < 0.05) warnings.push('There is very little cover: hiding and sneaking will hardly help.');
	if (cover > 0.55) warnings.push("Over half the field is cover: it'll be slow going, and hard to see anyone.");
	if (f.y - mid < 6) warnings.push('The flags are close to the middle: raids will be short.');
	if (team > Math.max(3, Math.round((W * H) / 110))) warnings.push(`${team} a side is a crowd on a field this size.`);
	if (!roles.runner && !roles.shadow && !roles.scout) warnings.push('No Runners, Shadows or Scouts: a team of Hunters and Guards is slow at stealing flags.');
	if (!roles.guard && !roles.hunter) warnings.push('No Guards or Hunters: nobody is built for defending.');
	return { errors, warnings, stats: { W, H, team, roles, cover, run: far } };
}

// The whole field from a map: { W, H, mid, tiles[], flags: {blue, red}, starts: {blue, red} },
// where starts are [{ x, y, role }] in team order (by role, then across the field). Assumes the
// map passed checkMap() (it throws on the worst problems).
export function buildMap(def, seed = 0, vary = def.vary || 0) {
	const rows = def.rows, W = rows[0].length, H = rows.length * 2 - 1, mid = rows.length - 1;
	const tiles = new Array(W * H).fill(0), blue = [];
	let flag = null;
	rows.forEach((row, i) => {
		if (row.length !== W) throw new Error(`${def.id}: row ${i} is ${row.length} wide, not ${W}`);
		const y = mid + i;
		for (let x = 0; x < W; x++) {
			const c = row[x];
			if (c === 'F' || ROLE_LETTER[c]) {
				if (i === 0) throw new Error(`${def.id}: no flag or start on the middle row`);
				if (c === 'F') flag = { x, y }; else blue.push({ x, y, role: ROLE_LETTER[c] });
				tiles[y * W + x] = T.GRASS;
			} else if (c in CHAR) tiles[y * W + x] = CHAR[c];
			else throw new Error(`${def.id}: unknown map character "${c}"`);
		}
	});
	if (!flag) throw new Error(`${def.id}: no flag`);
	blue.sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) || a.x - b.x || a.y - b.y);
	const turn = (p) => ({ ...p, x: W - 1 - p.x, y: H - 1 - p.y });
	for (let y = 0; y < mid; y++) for (let x = 0; x < W; x++) tiles[y * W + x] = tiles[(H - 1 - y) * W + (W - 1 - x)];
	const starts = { blue, red: blue.map(turn) };
	const flags = { blue: flag, red: turn(flag) };
	if (vary > 0) shuffleCover(tiles, W, H, mid, flags, starts, vary, seed);
	return { W, H, mid, tiles, flags, starts };
}

// A small seeded generator (mulberry32), so a game's map can be rebuilt from its seed.
export function rng(seed) {
	let a = seed >>> 0;
	return () => {
		let t = (a = (a + 0x6D2B79F5) >>> 0);
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

// Nudge some long grass and woods one square on each half, each half with its own draw, keeping the
// ground round the bases and the starts as drawn. Rocks, water and hills never move, so every route
// stays open and the two halves keep the same amount of cover.
function shuffleCover(tiles, W, H, mid, flags, starts, vary, seed) {
	const keep = new Set();
	const guard = (p, r) => { for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) keep.add((p.y + dy) * W + (p.x + dx)); };
	for (const t of ['blue', 'red']) { guard(flags[t], 2); for (const p of starts[t]) guard(p, 1); }
	const cover = (v) => v === T.SCRUB || v === T.FOREST;
	for (const [half, salt] of [['blue', 0x9E3779B9], ['red', 0x85EBCA6B]]) {
		const r = rng((seed ^ salt) >>> 0);
		const inHalf = (y) => (half === 'blue' ? y > mid + 1 : y < mid - 1);
		const list = [];
		for (let y = 0; y < H; y++) if (inHalf(y)) for (let x = 0; x < W; x++) if (cover(tiles[y * W + x]) && !keep.has(y * W + x)) list.push(y * W + x);
		const n = Math.round(list.length * vary);
		for (let k = 0, tries = 0; k < n && tries < n * 20; tries++) {
			const i = list[Math.floor(r() * list.length)], x = i % W, y = (i - x) / W;
			if (!cover(tiles[i])) continue;
			const [dx, dy] = [[1, 0], [-1, 0], [0, 1], [0, -1]][Math.floor(r() * 4)];
			const nx = x + dx, ny = y + dy, j = ny * W + nx;
			if (nx < 0 || nx >= W || ny < 0 || ny >= H || !inHalf(ny) || keep.has(j) || tiles[j] !== T.GRASS) continue;
			tiles[j] = tiles[i]; tiles[i] = T.GRASS;
			list[list.indexOf(i)] = j;
			k++;
		}
	}
}
