// Hide & Seize: the rules. No DOM, so it runs under Node for the tests and the computer-vs-computer runs.
// x runs across (0..W-1) and y down (0..H-1). Blue's half is below the middle row, Red's above it.
// Every change goes through these functions, which return a list of events for the page to show.
import { MAPS, buildMap, checkMap, rng } from './maps.js';

// block: 1 = blocks the view unless you look from a hill, 2 = always blocks it.
export const TERRAIN = [
	{ key: 'grass', name: 'Grass', cost: 1, hide: 0, pass: true, block: 0, note: 'Open ground.' },
	{ key: 'scrub', name: 'Long grass', cost: 1, hide: 1, pass: true, block: 0, note: 'Gives 1 cover.' },
	{ key: 'forest', name: 'Woods', cost: 2, hide: 2, pass: true, block: 1, note: 'Costs 2 moves. Gives 2 cover, and nobody sees past it (except from a hill).' },
	{ key: 'hill', name: 'Hill', cost: 2, hide: -1, pass: true, block: 0, sight: 2, note: 'Costs 2 moves. See 2 further, and over woods, but you stand out (−1 cover).' },
	{ key: 'rock', name: 'Rocks', cost: 0, hide: 0, pass: false, block: 2, note: 'Impassable, and nobody sees past it.' },
	{ key: 'water', name: 'Water', cost: 3, hide: -1, pass: true, block: 0, wet: true, note: 'Costs 3 moves, like a ford, and soaks you: 1 less Speed, Sight, Stealth and Strength until the end of your next turn. You stand out (−1 cover).' },
	{ key: 'bridge', name: 'Bridge', cost: 1, hide: 0, pass: true, block: 0, note: 'Crosses the water.' },
	{ key: 'ford', name: 'Ford', cost: 3, hide: -1, pass: true, block: 0, note: 'Shallow water: costs 3 moves, and you stand out (−1 cover).' },
];

// The four traits, 1 to 5. Moves = Speed + 2; sight = Sight + 2 squares; cover = Stealth − 2;
// Strength decides tackles. Each map's letters decide how many of each a side has.
export const ROLES = {
	scout: { name: 'Scout', speed: 4, sight: 5, stealth: 3, strength: 1, blurb: 'Sees furthest. Quick and fairly quiet, but easily tackled.' },
	runner: { name: 'Runner', speed: 5, sight: 3, stealth: 2, strength: 3, blurb: 'The fastest. Made for snatching the flag.' },
	shadow: { name: 'Shadow', speed: 3, sight: 3, stealth: 5, strength: 2, blurb: 'Hardest to spot, above all when sneaking or hiding.' },
	hunter: { name: 'Hunter', speed: 4, sight: 3, stealth: 3, strength: 3, blurb: 'Quick and quiet: lies in wait for raiders.' },
	guard: { name: 'Guard', speed: 2, sight: 4, stealth: 2, strength: 5, blurb: 'The best tackler and a good lookout, but slow.' },
};
export const TEAM = ['scout', 'runner', 'shadow', 'hunter', 'guard']; // (the order roles are listed in)
export const RULES = { baseOdds: 0.5, winScore: 3, outTurns: 2, maxRounds: 200, sneakCost: 2, tackleCost: 3, strengthStep: 0.08, unseenBonus: 0.15, windedBonus: 0.2, minOdds: 0.15, maxOdds: 0.85, carrierCover: 'terrain', carrierBonus: 1, carrierGrip: 0.15, pickupCost: 1, soakTurns: 2 };
// Names and looks, handed out at random each game (the same seed gives the same ones).
export const NAMES = ['Ash', 'Bea', 'Cal', 'Dot', 'Eli', 'Fay', 'Gus', 'Hal', 'Ivy', 'Jo', 'Kit', 'Lou', 'Max', 'Ned', 'Ola', 'Pip', 'Quin', 'Rae', 'Sam', 'Tess', 'Uma', 'Vic', 'Wren', 'Yuki', 'Zac', 'Alba', 'Bo', 'Cleo', 'Dex', 'Effie', 'Finn', 'Gil', 'Hana', 'Iggy', 'Jas', 'Kai', 'Lola', 'Milo', 'Nia', 'Otto', 'Pia', 'Remy', 'Suki', 'Teo', 'Vera', 'Wim', 'Zia', 'Arlo'];
export const SKINS = 5, HAIRS = 7;
export const other = (t) => (t === 'blue' ? 'red' : 'blue');
// Directions in each team's own frame: Red's are Blue's turned round, so that when two routes cost
// the same, both sides choose alike (the halves are each other turned 180°, which maps square i to N−1−i).
const DIRS4 = [[1, 0], [-1, 0], [0, 1], [0, -1]], DIRS4R = DIRS4.map(([x, y]) => [-x, -y]);
export const dirsFor = (team) => (team === 'blue' ? DIRS4 : DIRS4R);

// ---- Map helpers ----------------------------------------------------------------------------------------
export const inside = (s, x, y) => x >= 0 && y >= 0 && x < s.W && y < s.H;
export const terrainAt = (s, x, y) => TERRAIN[s.tiles[y * s.W + x]];
export const unitById = (s, id) => s.units.find((u) => u.id === id);
export const unitAt = (s, x, y) => s.units.find((u) => !u.off && u.x === x && u.y === y);
export const onHalf = (s, team, y) => (team === 'blue' ? y > s.mid : y < s.mid);
export const isFlagSquare = (s, team, x, y) => s.flagHome[team].x === x && s.flagHome[team].y === y;
// A team's base: the eight squares round its flag. A flag carrier scores by reaching its own.
export const inBase = (s, team, x, y) => {
	const f = s.flagHome[team];
	return Math.abs(x - f.x) <= 1 && Math.abs(y - f.y) <= 1 && !(x === f.x && y === f.y);
};
export const near = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) === 1;

// ---- A unit's numbers -----------------------------------------------------------------------------------
// A soaked unit (it waded through water this turn or last) has 1 less of every trait. u.wet counts the
// ends of its own turns still to go: 2 on entering water, so it lasts through its next turn.
export const soaked = (u) => (u.wet || 0) > 0;
const damp = (u) => (soaked(u) ? 1 : 0);
export const movesOf = (u) => Math.max(1, ROLES[u.role].speed - damp(u) + 2 + (u.carrying ? RULES.carrierBonus : 0));
export const stanceMoves = (u) => (u.stance === 'hide' ? 0 : u.stance === 'sneak' ? Math.max(1, movesOf(u) - RULES.sneakCost) : movesOf(u));
export const sightOf = (s, u) => ROLES[u.role].sight - damp(u) + 2 + (terrainAt(s, u.x, u.y).sight || 0);
// Cover subtracts from the distance others can see you at. A flag shows: its carrier loses its own
// stealth and can't sneak or hide, but woods and long grass still screen it (carrierCover 'terrain').
export const coverOf = (s, u) => (u.carrying ? (RULES.carrierCover === 'terrain' ? terrainAt(s, u.x, u.y).hide : RULES.carrierCover === 'all' ? Math.max(0, ROLES[u.role].stealth - 2) + terrainAt(s, u.x, u.y).hide : 0)
	: Math.max(0, ROLES[u.role].stealth - damp(u) - 2) + terrainAt(s, u.x, u.y).hide + (u.stance === 'sneak' ? 1 : u.stance === 'hide' ? 2 : 0));
// How far a sees b: its sight less b's cover, but never less than next door (1.5 takes in diagonals).
export const spotRange = (s, a, b) => Math.max(1.5, sightOf(s, a) - coverOf(s, b));

// ---- Seeing -----------------------------------------------------------------------------------------------
// Whether the view between two squares is clear: rocks always block it, woods unless looking from a
// hill. The two end squares never block (you can see into woods, and out of them).
export function clearView(s, x0, y0, x1, y1, overWoods) {
	const dx = x1 - x0, dy = y1 - y0, m = Math.max(Math.abs(dx), Math.abs(dy));
	if (m <= 1) return true;
	// Sample the line between square centres; a sample on a square's edge touches both squares, so
	// the answer is the same with the map turned round (the two halves stay alike).
	const n = m * 4, blocks = (tx, ty) => {
		if ((tx === x0 && ty === y0) || (tx === x1 && ty === y1)) return false;
		const b = TERRAIN[s.tiles[ty * s.W + tx]].block;
		return b === 2 || (b === 1 && !overWoods);
	};
	for (let i = 1; i < n; i++) {
		const fx = x0 + 0.5 + (dx * i) / n, fy = y0 + 0.5 + (dy * i) / n;
		const xs = Number.isInteger(fx) ? [fx - 1, fx] : [Math.floor(fx)], ys = Number.isInteger(fy) ? [fy - 1, fy] : [Math.floor(fy)];
		for (const tx of xs) for (const ty of ys) if (blocks(tx, ty)) return false;
	}
	return true;
}
// Whether a sees b (checked both ways along the line, so it never depends on who looks).
export function sees(s, a, b) {
	if (a.off || b.off) return false;
	const r = spotRange(s, a, b), dx = a.x - b.x, dy = a.y - b.y;
	if (dx * dx + dy * dy > r * r + 1e-9) return false;
	const over = terrainAt(s, a.x, a.y).key === 'hill';
	return clearView(s, a.x, a.y, b.x, b.y, over) && clearView(s, b.x, b.y, a.x, a.y, over);
}
// The ids of the other team's units that a team can see now (or walked into this turn).
export function spotted(s, team) {
	const out = new Set(), mine = s.units.filter((u) => u.team === team && !u.off);
	for (const b of s.units) if (b.team !== team && !b.off && (s.bumped[b.id] === team || mine.some((a) => sees(s, a, b)))) out.add(b.id);
	return out;
}
// The ground a team's units can see becomes known to it for good (the far half starts unknown).
export function reveal(s, team) {
	const k = s.known[team];
	let changed = false;
	for (const u of s.units) {
		if (u.team !== team || u.off) continue;
		const R = sightOf(s, u), r = Math.ceil(R), over = terrainAt(s, u.x, u.y).key === 'hill';
		for (let y = u.y - r; y <= u.y + r; y++) for (let x = u.x - r; x <= u.x + r; x++) {
			if (!inside(s, x, y) || k[y * s.W + x]) continue;
			const dx = x - u.x, dy = y - u.y;
			if (dx * dx + dy * dy <= R * R + 1e-9 && clearView(s, u.x, u.y, x, y, over)) { k[y * s.W + x] = 1; changed = true; }
		}
	}
	if (changed) s.knownRev++;
	return changed;
}
// What each team last saw of each enemy, for the faded markers and the computer's memory (with whose
// turn it was, so the computer can tell how many turns the enemy has had since). A unit sent off is
// forgotten by both sides (everyone hears a tackle).
export function observe(s) {
	for (const team of ['blue', 'red']) {
		const seen = spotted(s, team), mem = s.lastSeen[team];
		for (const b of s.units) {
			if (b.team === team) continue;
			if (b.off) delete mem[b.id];
			else if (seen.has(b.id)) mem[b.id] = { x: b.x, y: b.y, round: s.round, carrying: b.carrying, turn: s.turn };
		}
	}
}

// ---- Moving -----------------------------------------------------------------------------------------------
// Cheapest move costs from u's square across ground its team knows (all of it when known is null),
// never through a teammate, an enemy its team can see, or its own flag's square.
export function reach(s, u, known = s.known[u.team], seen = spotted(s, u.team)) {
	const N = s.W * s.H, dist = new Float64Array(N).fill(Infinity), prev = new Int32Array(N).fill(-1);
	const block = new Uint8Array(N);
	for (const b of s.units) if (!b.off && b !== u && (b.team === u.team || seen.has(b.id))) block[b.y * s.W + b.x] = 1;
	const own = s.flagHome[u.team], ownFlag = own.y * s.W + own.x, start = u.y * s.W + u.x;
	dist[start] = 0;
	const buckets = [[start]], dirs = dirsFor(u.team);
	for (let c = 0; c < buckets.length; c++) {
		for (const i of buckets[c] || []) {
			if (dist[i] !== c) continue;
			const x = i % s.W, y = (i - x) / s.W;
			for (const [dx, dy] of dirs) {
				const nx = x + dx, ny = y + dy;
				if (!inside(s, nx, ny)) continue;
				const j = ny * s.W + nx, t = TERRAIN[s.tiles[j]];
				if (!t.pass || j === ownFlag || block[j] || (known && !known[j])) continue;
				const nc = c + t.cost;
				if (nc < dist[j]) { dist[j] = nc; prev[j] = i; (buckets[nc] ||= []).push(j); }
			}
		}
	}
	return { dist, prev };
}
// The squares u can move to this turn, with the path to each.
export function destinations(s, u, known = s.known[u.team], seen) {
	const out = new Map();
	if (u.off || u.team !== s.turn || s.winner || u.mp <= 0) return out;
	const { dist, prev } = reach(s, u, known, seen), start = u.y * s.W + u.x;
	for (let i = 0; i < dist.length; i++) if (i !== start && dist[i] <= u.mp) out.set(i, { cost: dist[i], path: pathFrom(prev, start, i) });
	return out;
}
export function pathFrom(prev, from, to) {
	const p = [];
	for (let i = to; i !== from; i = prev[i]) { if (i < 0) return null; p.push(i); }
	return p.reverse();
}
// One step along a path. It stops short when it walks into a hidden enemy (who is then seen) and
// stops after a step that brings a new enemy into view (the moves left can still be used).
export function step(s, u, j) {
	const ev = [], x = j % s.W, y = (j - x) / s.W;
	if (u.off || s.winner || s.mustEnd || u.team !== s.turn || !inside(s, x, y)) return { moved: false, stop: true, ev };
	const t = TERRAIN[s.tiles[j]];
	if (Math.abs(x - u.x) + Math.abs(y - u.y) !== 1 || !t.pass || t.cost > u.mp || isFlagSquare(s, u.team, x, y)) return { moved: false, stop: true, ev };
	const there = unitAt(s, x, y);
	if (there && there.team === u.team) return { moved: false, stop: true, ev };
	if (there) {
		s.bumped[there.id] = u.team;
		ev.push({ type: 'bump', unit: u.id, other: there.id });
		observe(s);
		return { moved: false, stop: true, ev };
	}
	const before = spotted(s, u.team), trail = ((s.trail ||= {})[u.id] ||= [u.y * s.W + u.x]);
	u.x = x; u.y = y; u.mp -= t.cost; u.moved = true;
	trail.push(j);
	ev.push({ type: 'step', unit: u.id, x, y });
	if (t.wet) { if (!soaked(u)) ev.push({ type: 'soak', unit: u.id }); u.wet = RULES.soakTurns; }
	const enemy = other(u.team), fl = s.flags[enemy], fh = s.flagHome[enemy];
	if (fl.home && x === fh.x && y === fh.y) {
		fl.home = false; fl.carrier = u.id; u.carrying = true; u.stance = 'walk'; u.mp = Math.max(0, u.mp - RULES.pickupCost); // (picking it up takes a move)
		s.stats[u.team].grabs++;
		ev.push({ type: 'grab', unit: u.id });
	}
	reveal(s, u.team);
	observe(s);
	const sc = checkScore(s, u.team, u.id);
	ev.push(...sc);
	if (s.winner || s.mustEnd) return { moved: true, stop: true, ev };
	const fresh = [...spotted(s, u.team)].filter((id) => !before.has(id));
	if (fresh.length) ev.push({ type: 'spot', unit: u.id, ids: fresh });
	return { moved: true, stop: fresh.length > 0 || u.mp <= 0, ev };
}
// A whole path, step by step (the page animates step() itself).
export function moveAlong(s, u, path) {
	const ev = [];
	for (const j of path) {
		const r = step(s, u, j);
		ev.push(...r.ev);
		if (r.stop) break;
	}
	return ev;
}

// ---- Stances ------------------------------------------------------------------------------------------------
// Walk; sneak (2 fewer moves, +1 cover); or hide (no moves, +2 cover). Chosen before moving, and kept
// until changed, so a hiding unit stays hidden turn after turn. A flag carrier can only walk.
export const canStance = (s, u, st) => u.team === s.turn && !u.off && !u.moved && !u.acted && !s.winner && !s.mustEnd
	&& ['walk', 'sneak', 'hide'].includes(st) && (st === 'walk' || !u.carrying);
export function setStance(s, u, st) {
	if (!canStance(s, u, st)) return false;
	u.stance = st; u.mp = stanceMoves(u);
	observe(s);
	return true;
}

// ---- Tackles -------------------------------------------------------------------------------------------------
// The chance a tackles b from square `at` (a's own by default), with the reasons, for the page to show.
// (`at` is kept for the computer, which weighs up tackles from squares it hasn't moved to yet.)
export function tackleOdds(s, a, b, at = a) {
	const parts = [[RULES.baseOdds === 0.5 ? 'Even chance' : 'To start with', RULES.baseOdds]];
	const d = ROLES[a.role].strength - ROLES[b.role].strength;
	if (d) parts.push([d > 0 ? `Stronger by ${d}` : `Weaker by ${-d}`, RULES.strengthStep * d]);
	if (soaked(a)) parts.push(['Soaked: 1 less Strength', -RULES.strengthStep]);
	if (soaked(b)) parts.push(['They are soaked', RULES.strengthStep]);
	if (s.ambush[a.id]) parts.push(['Unseen when the turn began', RULES.unseenBonus]);
	if (b.carrying && RULES.carrierGrip) parts.push(['They hang on to the flag', -RULES.carrierGrip]);
	const w = s.winded?.[b.id] || 0;
	if (w) parts.push([w === 1 ? 'Winded from a dodge' : `Winded from ${w} dodges`, RULES.windedBonus * w]);
	const raw = parts.reduce((t, [, v]) => t + v, 0);
	return { p: Math.round(Math.min(RULES.maxOdds, Math.max(RULES.minOdds, raw)) * 100) / 100, parts };
}
// A tackle takes 3 moves, except from hiding: a hidden unit can always tackle whoever comes next to it.
export const canTackle = (s, a, b) => !!a && !!b && a.team === s.turn && b.team !== a.team && !a.off && !b.off && !a.acted
	&& (a.stance === 'hide' || a.mp >= RULES.tackleCost)
	&& !s.winner && !s.mustEnd && near(a, b) && spotted(s, a.team).has(b.id);
export function tackleTargets(s, a) {
	return s.units.filter((b) => canTackle(s, a, b)).map((b) => ({ unit: b, ...tackleOdds(s, a, b) }));
}
// Win and the other unit sits out; lose and you do. Either way a flag the loser carried goes home.
export function tackle(s, a, b) {
	if (!canTackle(s, a, b)) return [];
	const { p } = tackleOdds(s, a, b), won = rand(s) < p;
	a.acted = true; a.moved = true; a.mp = 0; a.stance = 'walk';
	s.stats[a.team].tackles++;
	if (won) s.stats[a.team].won++;
	const ev = [{ type: 'tackle', unit: a.id, other: b.id, p, won }];
	// Dodging takes it out of you: for the rest of this turn every tackle on you is likelier.
	if (!won) { s.winded[b.id] = (s.winded[b.id] || 0) + 1; ev[0].winded = s.winded[b.id]; }
	ev.push(...sendOff(s, won ? b : a));
	observe(s);
	ev.push(...checkScore(s, a.team));
	return ev;
}
function sendOff(s, u) {
	const ev = [];
	if (u.carrying) {
		const f = s.flags[other(u.team)];
		f.home = true; f.carrier = null; u.carrying = false;
		ev.push({ type: 'return', team: other(u.team) });
	}
	u.off = true; u.out = RULES.outTurns; u.stance = 'walk'; u.mp = 0; u.wet = 0;
	ev.push({ type: 'out', unit: u.id });
	return ev;
}

// ---- Flags and scoring ---------------------------------------------------------------------------------------
// A carrier in its own base scores, but only while its own flag is at home.
function checkScore(s, team, mover = null) {
	const c = s.units.find((u) => u.team === team && u.carrying && !u.off);
	if (!c || !inBase(s, team, c.x, c.y) || s.turn !== team) return [];
	if (!s.flags[team].home) return mover === c.id ? [{ type: 'wait', unit: c.id }] : [];
	s.score[team]++;
	c.carrying = false;
	Object.assign(s.flags[other(team)], { home: true, carrier: null });
	const ev = [{ type: 'score', team, unit: c.id, score: { ...s.score } }];
	if (s.score[team] >= RULES.winScore) { s.winner = team; ev.push({ type: 'win', team }); }
	else { resetPositions(s); s.mustEnd = true; ev.push({ type: 'reset', next: other(team) }); }
	return ev;
}
// After a point everyone goes back to the start, both flags at home. Explored ground stays explored.
// The scorer's turn ends there (mustEnd), so the side that lost the point moves first; the coin toss
// (newGame's `first`) only decides the game's first turn.
function resetPositions(s) {
	for (const u of s.units) {
		const p = s.starts[u.team][u.slot];
		Object.assign(u, { x: p.x, y: p.y, off: false, out: 0, stance: 'walk', mp: 0, moved: true, acted: true, carrying: false, wet: 0 });
	}
	for (const t of ['blue', 'red']) Object.assign(s.flags[t], { home: true, carrier: null });
	s.lastSeen = { blue: {}, red: {} };
	s.bumped = {};
	reveal(s, 'blue'); reveal(s, 'red');
	observe(s);
}
// Back on the board in its own base, on the free square furthest from the middle.
function respawn(s, u) {
	const f = s.flagHome[u.team], sq = [];
	for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
		const x = f.x + dx, y = f.y + dy;
		if ((dx || dy) && inside(s, x, y) && terrainAt(s, x, y).pass && !unitAt(s, x, y)) sq.push({ x, y });
	}
	if (!sq.length) return false;
	const side = u.team === 'blue' ? 1 : -1; // (ties go the same way for both teams)
	sq.sort((a, b) => Math.abs(b.y - s.mid) - Math.abs(a.y - s.mid) || Math.abs(a.x - f.x) - Math.abs(b.x - f.x) || side * (a.x - b.x));
	Object.assign(u, sq[0], { off: false, out: 0, stance: 'walk' });
	return true;
}

// ---- Turns ------------------------------------------------------------------------------------------------------
// A unit sent off misses its team's next two turns and comes back at the start of the third.
export function startTurn(s) {
	const team = s.turn, ev = [];
	s.bumped = {}; s.winded = {}; s.trail = {}; s.aiDone = []; s.aiCount = {}; s.aiPlan = {}; s.aiClaims = {}; s.aiMoves = {}; s.mustEnd = false;
	for (const u of s.units) {
		if (u.team !== team || !u.off) continue;
		if (u.out > 0) u.out--;
		else if (respawn(s, u)) ev.push({ type: 'back', unit: u.id });
	}
	for (const u of s.units) if (u.team === team && !u.off) Object.assign(u, { moved: false, acted: false, mp: stanceMoves(u) });
	const watched = spotted(s, other(team));
	s.ambush = {};
	for (const u of s.units) if (u.team === team && !u.off) s.ambush[u.id] = !watched.has(u.id);
	for (const t of ['blue', 'red']) for (const id in s.lastSeen[t]) if (s.round - s.lastSeen[t][id].round > 3) delete s.lastSeen[t][id];
	reveal(s, team);
	observe(s);
	ev.push(...checkScore(s, team));
	if (!s.winner && s.round > RULES.maxRounds) { s.winner = 'draw'; ev.push({ type: 'win', team: 'draw' }); }
	return ev;
}
export function endTurn(s) {
	if (s.winner) return [];
	for (const u of s.units) if (u.team === s.turn && u.wet > 0) u.wet--; // (drying off: soaked lasts to the end of its next turn)
	s.turn = other(s.turn);
	if (s.turn === (s.first || 'blue')) s.round++;
	return [{ type: 'turn', team: s.turn, round: s.round }, ...startTurn(s)];
}

// ---- A new game ---------------------------------------------------------------------------------------------------
// `map` is a map (from maps.js parseMap), or give `mapId` for one in MAPS. The game keeps its own copy
// of the map, so a saved game still loads after the map is changed or deleted.
export function newGame({ map = null, mapId = MAPS[0]?.id, seed = (Math.random() * 2 ** 32) >>> 0, level = 'normal', first = 'blue' } = {}) {
	const def = map || MAPS.find((m) => m.id === mapId) || MAPS[0];
	if (!def) throw new Error('No maps loaded');
	const m = buildMap(def, seed);
	const N = m.W * m.H;
	const s = {
		v: 1, mapId: def.id, map: { id: def.id, name: def.name, author: def.author || '', blurb: def.blurb || '', vary: def.vary ?? 0.2, rows: def.rows.slice() }, seed, level, W: m.W, H: m.H, mid: m.mid, tiles: m.tiles, flagHome: m.flags, starts: m.starts,
		flags: { blue: { home: true, carrier: null }, red: { home: true, carrier: null } },
		units: [], round: 1, turn: first, first, score: { blue: 0, red: 0 }, winner: null,
		known: { blue: new Array(N).fill(0), red: new Array(N).fill(0) }, knownRev: 0,
		lastSeen: { blue: {}, red: {} }, ambush: {}, bumped: {}, winded: {}, rng: (seed ^ 0x5BD1E995) >>> 0,
		aiDone: [], aiCount: {}, mustEnd: false,
		stats: { blue: { tackles: 0, won: 0, grabs: 0 }, red: { tackles: 0, won: 0, grabs: 0 } },
	};
	const pick = rng((seed ^ 0x2545F491) >>> 0), names = NAMES.slice();
	for (let i = names.length - 1; i > 0; i--) { const j = Math.floor(pick() * (i + 1)); [names[i], names[j]] = [names[j], names[i]]; }
	for (const team of ['blue', 'red']) m.starts[team].forEach((p, i) => {
		s.units.push({
			id: team[0] + i, team, role: p.role, slot: i, x: p.x, y: p.y, off: false, out: 0, stance: 'walk', mp: 0, moved: false, acted: false, carrying: false, wet: 0,
			name: names[s.units.length % names.length], skin: Math.floor(pick() * SKINS), hair: Math.floor(pick() * HAIRS),
		});
	});
	// Each side starts knowing its own half, the middle row and where the other flag stands.
	for (let i = 0; i < N; i++) {
		const y = Math.floor(i / m.W);
		if (y >= m.mid) s.known.blue[i] = 1;
		if (y <= m.mid) s.known.red[i] = 1;
	}
	s.known.blue[m.flags.red.y * m.W + m.flags.red.x] = 1;
	s.known.red[m.flags.blue.y * m.W + m.flags.blue.x] = 1;
	reveal(s, 'red');
	startTurn(s);
	return s;
}

// The game's dice: mulberry32 on a state field, so a saved game carries on with the same rolls.
export function rand(s) {
	let t = (s.rng = (s.rng + 0x6D2B79F5) >>> 0);
	t = Math.imul(t ^ (t >>> 15), t | 1);
	t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
	return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

// A saved game is used only if every part of it makes sense; otherwise the page starts afresh.
const plain = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
const same = (p, q) => plain(p) && p.x === q.x && p.y === q.y;
export function validState(s) {
	try {
		if (!s || s.v !== 1 || !s.map || typeof s.map !== 'object' || s.map.id !== s.mapId || typeof s.map.name !== 'string') return false;
		if (!Array.isArray(s.map.rows) || !s.map.rows.every((r) => typeof r === 'string') || typeof s.map.vary !== 'number' || s.map.vary < 0 || s.map.vary > 0.4) return false;
		if (checkMap(s.map).errors.length) return false;
		const m = buildMap(s.map, s.seed), N = m.W * m.H;
		if (s.W !== m.W || s.H !== m.H || s.mid !== m.mid || !Array.isArray(s.tiles) || s.tiles.length !== N || s.tiles.some((v, i) => v !== m.tiles[i])) return false;
		if (!['blue', 'red'].includes(s.turn) || !(s.winner === null || ['blue', 'red', 'draw'].includes(s.winner))) return false;
		if (!Number.isInteger(s.round) || s.round < 1 || !Number.isInteger(s.rng) || !Number.isInteger(s.seed) || !['blue', 'red'].includes(s.first)) return false;
		if (typeof s.level !== 'string' || typeof s.mustEnd !== 'boolean' || !Number.isInteger(s.knownRev)) return false;
		// The flags and starts must be the map's own.
		for (const t of ['blue', 'red']) {
			if (!same(s.flagHome?.[t], m.flags[t])) return false;
			if (!Array.isArray(s.starts?.[t]) || s.starts[t].length !== m.starts[t].length || s.starts[t].some((p, k) => !same(p, m.starts[t][k]) || p.role !== m.starts[t][k].role)) return false;
		}
		// The bookkeeping, which every turn sets up afresh, so every save has it (the code relies on that): plain
		// objects keyed by player, or a list of players, of the right kind. Only aiHold is made when first needed.
		const ids = new Set(m.starts.blue.flatMap((_, k) => ['b' + k, 'r' + k]));
		const table = (o, ok) => plain(o) && Object.entries(o).every(([k, v]) => ids.has(k) && ok(v));
		if (!table(s.ambush, (v) => typeof v === 'boolean') || !table(s.bumped, (v) => v === 'blue' || v === 'red') || !table(s.winded, (v) => Number.isInteger(v) && v >= 1)
			|| !table(s.aiCount, Number.isInteger) || !table(s.aiMoves, Number.isInteger) || !(s.aiHold === undefined || table(s.aiHold, Number.isInteger))
			|| !table(s.trail, (v) => Array.isArray(v) && v.every((i) => Number.isInteger(i) && i >= 0 && i < N))
			|| !table(s.aiPlan, (v) => plain(v) && Number.isInteger(v.i) && typeof v.carrying === 'boolean')
			|| !table(s.aiClaims, (l) => Array.isArray(l) && l.every((c) => plain(c) && Number.isInteger(c.x) && Number.isInteger(c.y)))
			|| !(Array.isArray(s.aiDone) && s.aiDone.every((id) => ids.has(id)))) return false;
		for (const t of ['blue', 'red']) {
			if (!Array.isArray(s.known?.[t]) || s.known[t].length !== N || s.known[t].some((v) => v !== 0 && v !== 1)) return false;
			if (!Number.isInteger(s.score?.[t]) || s.score[t] < 0 || s.score[t] > RULES.winScore) return false;
			if (typeof s.flags?.[t]?.home !== 'boolean' || !plain(s.lastSeen?.[t]) || !plain(s.stats?.[t])) return false;
			if (!['tackles', 'won', 'grabs'].every((k) => Number.isInteger(s.stats[t][k]) && s.stats[t][k] >= 0)) return false;
			for (const [id, e] of Object.entries(s.lastSeen[t])) {
				if (!ids.has(id) || id[0] === t[0] || !plain(e) || !Number.isInteger(e.x) || !Number.isInteger(e.y) || !inside(s, e.x, e.y) || !Number.isInteger(e.round) || typeof e.carrying !== 'boolean') return false;
			}
		}
		if (!Array.isArray(s.units) || s.units.length !== m.starts.blue.length * 2) return false;
		const taken = new Set();
		for (const [k, u] of s.units.entries()) {
			const slot = k % m.starts.blue.length, team = k < m.starts.blue.length ? 'blue' : 'red';
			if (u.id !== team[0] + slot || u.team !== team || u.slot !== slot || u.role !== m.starts[team][slot].role) return false;
			if (typeof u.name !== 'string' || u.name.length > 20 || !Number.isInteger(u.skin) || u.skin < 0 || u.skin >= SKINS || !Number.isInteger(u.hair) || u.hair < 0 || u.hair >= HAIRS) return false;
			if (!ROLES[u.role] || !['blue', 'red'].includes(u.team) || !['walk', 'sneak', 'hide'].includes(u.stance)) return false;
			if (typeof u.off !== 'boolean' || !Number.isInteger(u.out) || u.out < 0 || u.out > RULES.outTurns || !Number.isFinite(u.mp)) return false;
			if (typeof u.moved !== 'boolean' || typeof u.acted !== 'boolean' || typeof u.carrying !== 'boolean') return false;
			if (u.wet !== undefined && (!Number.isInteger(u.wet) || u.wet < 0 || u.wet > RULES.soakTurns)) return false;
			if (!u.off) {
				if (!Number.isInteger(u.x) || !Number.isInteger(u.y) || !inside(s, u.x, u.y) || !TERRAIN[s.tiles[u.y * s.W + u.x]].pass) return false;
				if (taken.has(u.y * s.W + u.x)) return false;
				taken.add(u.y * s.W + u.x);
			}
		}
		for (const t of ['blue', 'red']) {
			const f = s.flags[t], c = f.carrier && unitById(s, f.carrier);
			if (f.home ? f.carrier !== null : !(c && c.team !== t && c.carrying && !c.off)) return false;
		}
		return true;
	} catch (e) {
		return false;
	}
}
