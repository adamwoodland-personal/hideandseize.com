// Hide & Seize: the computer player. It knows only what a player in its place would: the enemies its own
// units can see, where it last saw the others (s.lastSeen), and the ground its units have seen. It plans
// on that ground, guessing the rest from its own half (the far half mirrors it, before each game's shuffle),
// and like a player it moves only onto ground it has seen. Hidden enemies never enter its sums: a square
// counts as taken only by a teammate or an enemy in sight. One action at a time, so the page can animate
// each: aiStep() says what to do next.
import * as R from './rules.js';

// tackle: how good a tackle must look (chance × what it wins − chance it fails × what it loses);
// danger: how hard it steers round enemies it knows of; sneak/hide: whether it uses the stances;
// wander: the share of moves made at random; hold: turns a raider waits for a guarded flag to clear;
// steady: rounds the Hunter keeps a post (long enough to hide there); safeStop: a move may stop
// short, in cover, rather than end beside an enemy; escape: moves a raider wants left after grabbing
// the flag (short of that it waits, hidden, where next turn it can grab and run). (Easy wins about 1 game in 5 against Normal.
// Tuned settings for a "Hard" never beat Normal by more than chance in sim runs, so there isn't one yet.)
export const LEVELS = {
	easy: { name: 'Easy', tackle: -0.15, danger: 0, sneak: false, hide: false, wander: 0.5, hold: 0, steady: 1, escape: 0 },
	normal: { name: 'Normal', tackle: 0.12, danger: 1, sneak: true, hide: true, wander: 0, hold: 0, steady: 5, safeStop: true, escape: 3 },
};
// Everything that breaks a tie runs in the team's own frame (Red's turned round, square i ↔ N−1−i),
// so the two sides play alike on their mirrored halves.
const DIRS8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]], DIRS8R = DIRS8.map(([x, y]) => [-x, -y]);
const dirs8 = (team) => (team === 'blue' ? DIRS8 : DIRS8R);
const OFFS2 = []; for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) OFFS2.push([dx, dy]);
const offs2 = (team) => (team === 'blue' ? OFFS2 : OFFS2.map(([x, y]) => [-x, -y]));
function* squares(s, team) { const N = s.W * s.H; if (team === 'blue') for (let i = 0; i < N; i++) yield i; else for (let i = N - 1; i >= 0; i--) yield i; }
const ORDER = { guard: 1, hunter: 2, scout: 3, shadow: 4, runner: 5 };
const WADE = 2; // (what being soaked is worth avoiding, in moves, when it plans a route)

// The next thing for `team` to do: { type: 'stance' | 'move' | 'tackle' | 'end', ... }.
export function aiStep(s, team, level = s.level) {
	const L = LEVELS[level] || LEVELS.normal;
	if (s.winner || s.turn !== team) return { type: 'none' };
	if (s.mustEnd) return { type: 'end' };
	const ctx = context(s, team);
	s.aiHold ||= {};
	const mine = s.units.filter((u) => u.team === team && !u.off)
		.sort((a, b) => (b.carrying - a.carrying) || (ORDER[a.role] - ORDER[b.role]));
	for (const u of mine) {
		if (s.aiDone.includes(u.id)) continue;
		s.aiCount[u.id] = (s.aiCount[u.id] || 0) + 1;
		const act = s.aiCount[u.id] > 6 ? null : decide(s, u, ctx, L);
		if (act && act.type === 'move') { (s.aiPlan ||= {})[u.id] = { i: act.path[act.path.length - 1], carrying: u.carrying }; s.aiMoves = s.aiMoves || {}; s.aiMoves[u.id] = (s.aiMoves[u.id] || 0) + 1; }
		if (act) return act;
		s.aiDone.push(u.id);
	}
	return { type: 'end' };
}

// Carry out an action at once (the computer-vs-computer runs; the page animates moves itself).
export function applyAi(s, act) {
	const u = act.unit && R.unitById(s, act.unit);
	if (act.type === 'stance') return R.setStance(s, u, act.stance) ? [] : (s.aiDone.push(u.id), []);
	if (act.type === 'move') {
		const ev = R.moveAlong(s, u, act.path);
		if (!ev.some((e) => e.type === 'step')) s.aiDone.push(u.id);
		return ev;
	}
	if (act.type === 'tackle') return R.tackle(s, u, R.unitById(s, act.target));
	if (act.type === 'end') return R.endTurn(s);
	return [];
}

// ---- What the team knows ------------------------------------------------------------------------------------
function context(s, team) {
	const seen = R.spotted(s, team), known = [];
	for (const b of s.units) {
		if (b.team === team || b.off) continue;
		if (seen.has(b.id)) { known.push({ id: b.id, role: b.role, x: b.x, y: b.y, carrying: b.carrying, fresh: true, age: 0 }); continue; }
		const m = s.lastSeen[team][b.id];
		if (m && s.round - m.round <= 2) known.push({ id: b.id, role: b.role, x: m.x, y: m.y, carrying: m.carrying, fresh: false, age: s.round - m.round });
	}
	// The ground as the team believes it, and a copy of the state with it for working out routes.
	const tiles = believed(s, team), sb = { ...s, tiles }, st = site(s, team);
	const occ = new Uint8Array(s.W * s.H); // (squares it knows are taken: its own units and enemies in sight)
	for (const b of s.units) if (!b.off && (b.team === team || seen.has(b.id))) occ[b.y * s.W + b.x] = 1;
	return { team, seen, known, site: st, tiles, sb, occ, fromFlag: costsFrom(s, team, tiles, st.their) };
}
// What a team believes the ground to be: what its units have seen, and for the rest the square it
// mirrors on the team's own half (which it always knows).
function believed(s, team) {
	const N = s.W * s.H, k = s.known[team], t = s.tiles.slice();
	for (let i = 0; i < N; i++) if (!k[i]) t[i] = s.tiles[N - 1 - i];
	return t;
}
// Move costs out from a square over the believed ground (4-way, as units move).
function costsFrom(s, team, tiles, p) {
	const W = s.W, N = W * s.H, d = new Float64Array(N).fill(Infinity), q = [[p.y * W + p.x]];
	d[p.y * W + p.x] = 0;
	for (let c = 0; c < q.length; c++) for (const i of q[c] || []) {
		if (d[i] !== c) continue;
		for (const [dx, dy] of dirs8(team).slice(0, 4)) {
			const x = (i % W) + dx, y = Math.floor(i / W) + dy, j = y * W + x;
			if (!R.inside(s, x, y) || !R.TERRAIN[tiles[j]].pass) continue;
			const nc = c + R.TERRAIN[tiles[j]].cost;
			if (nc < d[j]) { d[j] = nc; (q[nc] ||= []).push(j); }
		}
	}
	return d;
}

// Fixed facts about a map for one side, worked out once: bases, lookouts and posts. They are worked out on
// the field as the team first sees it, its own half and that half mirrored, so they never use ground it
// hasn't seen.
const SITES = new Map();
function site(s, team) {
	const key = `${s.mapId}:${s.seed}:${team}:${s.tiles.join('')}`; // (an edited map with the same id is a new site)
	if (SITES.has(key)) return SITES.get(key);
	const W = s.W, N = W * s.H, enemy = R.other(team), own = s.flagHome[team], their = s.flagHome[enemy];
	const first = s.tiles.map((v, i) => (R.onHalf(s, enemy, Math.floor(i / W)) ? s.tiles[N - 1 - i] : v)), sv = { ...s, tiles: first };
	const passable = (i) => R.TERRAIN[first[i]].pass;
	const baseOf = (t) => { const f = s.flagHome[t], out = []; for (const [dx, dy] of dirs8(team)) { const x = f.x + dx, y = f.y + dy; if (R.inside(s, x, y) && passable(y * W + x)) out.push(y * W + x); } return out; };
	const cover = (i) => Math.max(0, R.TERRAIN[first[i]].hide);
	const toMid = (i) => Math.abs(Math.floor(i / W) - s.mid);
	const ownSide = (i) => R.onHalf(s, team, Math.floor(i / W));
	// Posts for the Guard: cover close to the flag, on the side the raiders come from.
	const defend = [];
	for (const [dx, dy] of offs2(team)) {
		const x = own.x + dx, y = own.y + dy, i = y * W + x;
		if (Math.max(Math.abs(dx), Math.abs(dy)) === 2 && R.inside(s, x, y) && passable(i)) defend.push({ i, v: cover(i) * 2 - toMid(i) * 0.5 - Math.abs(dx) * 0.3 });
	}
	defend.sort((a, b) => b.v - a.v);
	// Lookouts for the Scout: squares near the middle that see the most of the far half.
	const look = [];
	for (const i of squares(s, team)) {
		if (!passable(i) || !ownSide(i) || toMid(i) > 5) continue;
		const x = i % W, y = (i - x) / W, t = R.TERRAIN[first[i]], Rng = 7 + (t.sight || 0);
		let n = 0;
		for (let j = 0; j < W * s.H; j++) {
			const jx = j % W, jy = (j - jx) / W;
			if (R.onHalf(s, enemy, jy) && (jx - x) ** 2 + (jy - y) ** 2 <= Rng * Rng && R.clearView(sv, x, y, jx, jy, t.key === 'hill')) n++;
		}
		look.push({ i, v: n + cover(i) * 4 - toMid(i) });
	}
	look.sort((a, b) => b.v - a.v);
	// Posts for the Hunters, one in each third across, in cover a little back from the middle.
	const patrol = [], near = Math.round(s.mid * 0.2), far = Math.round(s.mid * 0.5), aim = Math.round(s.mid * 0.33);
	for (const third of [0, 1, 2]) {
		let best = null;
		for (const i of squares(s, team)) {
			const x = team === 'blue' ? i % W : W - 1 - (i % W); // (left and right as the team sees them)
			if (!passable(i) || !ownSide(i) || toMid(i) < near || toMid(i) > far || Math.floor((x * 3) / W) !== third) continue;
			const v = cover(i) * 2 - Math.abs(toMid(i) - aim);
			if (!best || v > best.v) best = { i, v };
		}
		if (best) patrol.push(best.i);
	}
	// (move costs from their flag, for staging a raid, change as the team sees more: see context())
	const out = { own, their, ownBase: baseOf(team), theirBase: baseOf(enemy), defend: defend.map((d) => d.i), look: look.slice(0, 3).map((d) => d.i), patrol };
	SITES.set(key, out);
	return out;
}

// ---- Choosing ------------------------------------------------------------------------------------------------
function decide(s, u, ctx, L) {
	const W = s.W, st = ctx.site;
	// Which of its kind this is (two Guards take two posts, and so on).
	const k = s.units.filter((m) => m.team === u.team && m.role === u.role).indexOf(u);
	const mine = (list) => (list.length ? [...list.slice(k % list.length), ...list.slice(0, k % list.length)] : list);
	const tk = bestTackle(s, u, ctx, L);
	if (tk) return tk.path ? { type: 'move', unit: u.id, path: tk.path } : { type: 'tackle', unit: u.id, target: tk.target };
	// A unit that has moved and can't move further is done. So is one that got where it meant to go
	// (only a move cut short, by someone coming into view, is planned again), and one that has moved
	// three times: no dithering back and forth.
	if (u.moved && u.mp <= 0) return null;
	const here = u.y * W + u.x;
	// (picking up the flag on the way is new news: it runs on)
	const was = s.aiPlan?.[u.id];
	if (u.moved && ((was && was.i === here && was.carrying === u.carrying) || (s.aiMoves?.[u.id] || 0) >= 3)) return null;
	const danger = dangerFor(s, u, ctx, L);
	const theirFlag = st.their.y * W + st.their.x;
	const ourFlagGone = !s.flags[u.team].home, theirFlagHome = s.flags[R.other(u.team)].home;
	const mate = s.units.find((m) => m.team === u.team && m.carrying && !m.off);

	if (u.carrying) return R.inBase(s, u.team, u.x, u.y) ? null : goTo(s, u, new Set(st.ownBase), danger, L, 'walk', ctx); // (in base, it waits for our flag)

	// Anyone who can snatch the flag this turn and still get away does, unless it is plainly guarded.
	// (picking the flag up takes a move of its own)
	if (theirFlagHome && !u.moved) {
		const d = R.destinations(ctx.sb, { ...u, mp: R.movesOf(u), stance: 'walk' }, null, ctx.seen), c = d.get(theirFlag);
		if (c && R.movesOf(u) - c.cost - R.RULES.pickupCost >= L.escape && danger[theirFlag] < 6) return goTo(s, u, new Set([theirFlag]), danger, L, 'walk', ctx);
	}

	// Our flag has gone: the Hunters and the Scout go after it, the others if it passes close by. If we
	// hold theirs as well, nobody can score until a carrier falls, so all but one Guard go.
	if (ourFlagGone) {
		const c = ctx.known.find((e) => e.carrying), standoff = !theirFlagHome;
		const chaser = u.role === 'hunter' || u.role === 'scout' || (standoff && !(u.role === 'guard' && k === 0))
			|| (c && dist(u, c) <= (u.role === 'guard' ? 6 : 5));
		if (chaser) {
			if (!c) return goTo(s, u, new Set(st.theirBase), danger, L, 'walk', ctx);
			return cutOff(s, u, c, new Set(st.theirBase), L, null, ctx) || goTo(s, u, around(s, ahead(s, u.team, c, new Set(st.theirBase), ctx), ctx.tiles), null, L, 'walk', ctx);
		}
	}

	if (u.role === 'guard') {
		const raider = ctx.known.filter((e) => e.fresh && dist(e, st.own) <= 6).sort((a, b) => dist(a, st.own) - dist(b, st.own))[0];
		if (raider) {
			const cut = cutOff(s, u, raider, new Set([st.own.y * W + st.own.x]), L, { p: st.own, r: 4 }, ctx);
			if (cut) return cut;
			const goals = new Set([...around(s, raider, ctx.tiles)].filter((i) => cheb(i % W, Math.floor(i / W), st.own) <= 4));
			if (goals.size) return goTo(s, u, goals, null, L, 'walk', ctx);
		}
		return settle(s, u, mine(st.defend.slice(0, 4)).slice(0, 3), danger, L, ctx);
	}
	if (u.role === 'hunter') {
		const target = ctx.known.filter((e) => (e.fresh || e.age <= 1) && !R.onHalf(s, R.other(u.team), e.y))
			.sort((a, b) => dist(a, st.own) - dist(b, st.own))[0];
		if (target) return cutOff(s, u, target, new Set([st.own.y * W + st.own.x]), L, null, ctx) || goTo(s, u, around(s, ahead(s, u.team, target, new Set([st.own.y * W + st.own.x]), ctx), ctx.tiles), null, L, 'walk', ctx);
		// (a post is kept for `steady` rounds, long enough to settle in and hide)
		const post = st.patrol[(k + Math.floor(s.round / (L.steady || 1))) % st.patrol.length] ?? st.defend[0];
		return settle(s, u, [post], danger, L, ctx);
	}
	if (mate) return goTo(s, u, around(s, mate, ctx.tiles), danger, L, 'walk', ctx); // stay by our carrier
	if (u.role === 'scout') return settle(s, u, mine(st.look), danger, L, ctx);
	// The raiders: Runner and Shadow go for the flag, sneaking (the Shadow) once near the other side,
	// and holding back in cover for a few turns if someone is standing over it.
	if (!theirFlagHome) return settle(s, u, st.ownBase, danger, L, ctx);
	const guarded = danger[theirFlag] >= 4;
	if (guarded && (s.aiHold[u.id] || 0) < L.hold && dist(u, st.their) <= 8) {
		if (!u.moved) s.aiHold[u.id] = (s.aiHold[u.id] || 0) + 1;
		const hold = coverNear(s, u.team, st.their, 4, 7, danger, ctx.tiles);
		if (hold.length) return settle(s, u, hold, danger, L, ctx);
	} else if (!guarded) s.aiHold[u.id] = 0;
	const sneak = L.sneak && u.role === 'shadow' && (R.onHalf(s, R.other(u.team), u.y) || Math.abs(u.y - s.mid) <= 3);
	// Close, but not close enough to grab and run: wait (hidden) where next turn it can.
	const walk = R.movesOf(u), want = walk - L.escape - R.RULES.pickupCost, ff = ctx.fromFlag;
	if (L.escape && ff[here] > want && ff[here] <= walk * 2 + 2) {
		const stage = [];
		for (const i of squares(s, u.team)) {
			const f = ff[i];
			if (f <= want && f >= want - 1 && R.TERRAIN[ctx.tiles[i]].pass && (i === here || !ctx.occ[i])) stage.push(i);
		}
		const hide = (i) => Math.max(0, R.TERRAIN[ctx.tiles[i]].hide) * 2;
		// (the safest first, then the nearest: a square behind the flag is no place to wait, and on the way
		// there it would be picked up too early, so the walk there goes round the flag)
		const near = (i) => Math.abs((i % W) - u.x) + Math.abs(Math.floor(i / W) - u.y);
		stage.sort((a, b) => (danger[a] - hide(a)) - (danger[b] - hide(b)) || near(a) - near(b));
		if (stage.length) return settle(s, u, stage.slice(0, 4), danger, L, ctx, theirFlag);
	}
	return goTo(s, u, new Set([theirFlag]), danger, L, sneak ? 'sneak' : 'walk', ctx);
}

// The best tackle from here, or after a short move; null if none is worth it.
function bestTackle(s, u, ctx, L) {
	if (u.acted || (u.stance !== 'hide' && u.mp < R.RULES.tackleCost)) return null;
	const W = s.W, st = ctx.site;
	const reachable = u.mp > R.RULES.tackleCost ? R.destinations(s, u) : new Map();
	let best = null;
	for (const b of s.units) {
		if (b.team === u.team || b.off || !ctx.seen.has(b.id)) continue;
		const tv = b.carrying ? 3 : dist(b, st.own) <= 4 ? 1.6 : R.onHalf(s, u.team, b.y) ? 1.2 : 0.8;
		const sv = u.carrying ? 3 : 1;
		const raiding = (u.role === 'runner' || u.role === 'shadow') && s.flags[R.other(u.team)].home && !R.onHalf(s, u.team, u.y);
		if (raiding && tv < 1.5) continue;
		const spots = R.near(u, b) ? [{ at: u, path: null, cost: 0 }] : [];
		for (const [dx, dy] of dirs8(u.team)) {
			const i = (b.y + dy) * W + (b.x + dx), d = reachable.get(i);
			if (d && d.cost <= u.mp - R.RULES.tackleCost && !d.path.some((j) => s.trail?.[u.id]?.includes(j))) spots.push({ at: { x: b.x + dx, y: b.y + dy }, path: d.path, cost: d.cost });
		}
		for (const sp of spots) {
			const { p } = R.tackleOdds(s, u, b, sp.at), ev = p * tv - (1 - p) * sv - sp.cost * 0.01;
			if (ev > L.tackle && (!best || ev > best.ev)) best = { ev, target: b.id, path: sp.path };
		}
	}
	return best;
}

// How dangerous each square is for u: near enemies it knows of, more so the stronger they are.
function dangerFor(s, u, ctx, L) {
	const W = s.W, d = new Float32Array(W * s.H);
	for (const e of ctx.known) {
		const threat = Math.min(0.9, Math.max(0.1, 0.6 + 0.1 * (R.ROLES[e.role].strength - R.ROLES[u.role].strength)));
		const w = (e.fresh ? 1 : e.age <= 1 ? 0.6 : 0.3) * threat * L.danger * (u.carrying ? 2 : 1);
		const r = R.movesOf(e) + 1; // (as far as it could move, then reach)
		for (let y = e.y - r; y <= e.y + r; y++) for (let x = e.x - r; x <= e.x + r; x++) {
			if (!R.inside(s, x, y)) continue;
			const m = Math.abs(x - e.x) + Math.abs(y - e.y);
			if (m <= r) d[y * W + x] += w * (m <= 1 ? 10 : m <= 2 ? 5 : 1.5);
		}
	}
	return d;
}

// Head for the nearest of `goals`, as far as this turn's moves go (and only over ground it has seen),
// avoiding danger.
function goTo(s, u, goals, danger, L, stance, ctx, avoid = -1) {
	if (!goals.size) return null;
	if (!u.moved && u.stance !== stance && R.canStance(s, u, stance)) return { type: 'stance', unit: u.id, stance };
	if (u.mp <= 0) return null;
	if (L.wander && !u.moved && R.rand(s) < L.wander) {
		const d = [...R.destinations(s, u).values()];
		if (d.length) return { type: 'move', unit: u.id, path: d[Math.floor(R.rand(s) * d.length)].path };
	}
	const path = plan(s, u, goals, danger, ctx, avoid);
	if (!path || !path.length) return null;
	const cut = [], spentAt = [], seenGround = s.known[u.team];
	let spent = 0;
	const total = path.reduce((t, j) => t + R.TERRAIN[ctx.tiles[j]].cost, 0);
	for (const j of path) {
		const c = R.TERRAIN[s.tiles[j]].cost;
		if (!seenGround[j] || spent + c > u.mp) break; // (like a player, it can only move onto ground it has seen)
		spent += c; cut.push(j); spentAt.push(spent);
	}
	const free = (k) => !ctx.occ[cut[k]];
	let end = cut.length - 1;
	while (end >= 0 && !free(end)) end--;
	if (end >= 0 && L.safeStop && danger && !goals.has(cut[end])) {
		// Weigh how far each stop gets against how exposed it is.
		const score = (k) => -(total - spentAt[k]) - 0.8 * danger[cut[k]] + 0.6 * Math.max(0, R.TERRAIN[s.tiles[cut[k]]].hide);
		for (let k = end - 1; k >= 0; k--) if (free(k) && score(k) > score(end)) end = k;
	}
	return end >= 0 ? { type: 'move', unit: u.id, path: cut.slice(0, end + 1) } : null;
}
// Go to the first free post in `posts` (free as far as it knows), then (if the level allows) hide there.
function settle(s, u, posts, danger, L, ctx, avoid = -1) {
	const here = u.y * s.W + u.x;
	const free = posts.filter((i) => i === here || !ctx.occ[i]);
	if (free.includes(here) || !free.length) {
		if (L.hide && !u.moved && u.stance !== 'hide' && R.canStance(s, u, 'hide')) return { type: 'stance', unit: u.id, stance: 'hide' };
		return null;
	}
	return goTo(s, u, new Set(free), danger, L, 'walk', ctx, avoid);
}

// Cheapest path to any goal over the ground as the team believes it, with danger added to each step's
// cost (and a little for wading, which soaks).
function plan(s, u, goals, danger, ctx, avoid = -1) {
	const W = s.W, N = W * s.H, cost = new Float64Array(N).fill(Infinity), prev = new Int32Array(N).fill(-1);
	const own = s.flagHome[u.team], start = u.y * W + u.x, block = ctx.occ.slice();
	block[start] = 0;
	block[own.y * W + own.x] = 1;
	if (avoid >= 0) block[avoid] = 1; // (a square not to step on on the way, such as their flag when it's too soon to take it)
	const used = new Uint8Array(N); // (squares already walked this turn: never again, goal or not)
	for (const j of s.trail?.[u.id] || []) if (j !== start) used[j] = 1;
	cost[start] = 0;
	const open = new Heap(), done = new Uint8Array(N);
	open.push(0, start);
	while (open.size) {
		const i = open.pop();
		if (done[i]) continue;
		done[i] = 1;
		if (goals.has(i) && i !== start) return R.pathFrom(prev, start, i);
		const x = i % W, y = (i - x) / W;
		for (const [dx, dy] of R.dirsFor(u.team)) {
			const nx = x + dx, ny = y + dy;
			if (!R.inside(s, nx, ny)) continue;
			const j = ny * W + nx, t = R.TERRAIN[ctx.tiles[j]];
			// A goal square held by a teammate or a seen enemy is still a goal: we stop next to it.
			if (!t.pass || used[j] || (block[j] && !goals.has(j)) || done[j]) continue;
			const c = cost[i] + t.cost + (t.wet ? WADE : 0) + (danger ? danger[j] : 0);
			if (c < cost[j]) { cost[j] = c; prev[j] = i; open.push(c, j); }
		}
	}
	return null;
}

// ---- Getting in the way ----------------------------------------------------------------------------------------
// The way an enemy is likely to go: the cheapest route over open ground to `goals`, from where it is
// (or, if it was last seen a round or two ago, from as far along that route as it could have got).
// [{ i, c }]: each square and the enemy's move cost to it.
function routeOf(s, team, e, goals, ctx) {
	const W = s.W, N = W * s.H, d = new Float64Array(N).fill(Infinity), q = [[]];
	for (const g of goals) { d[g] = 0; q[0].push(g); }
	const pass = (i) => R.TERRAIN[ctx.tiles[i]].pass, cost = (i) => R.TERRAIN[ctx.tiles[i]].cost;
	for (let c = 0; c < q.length; c++) for (const i of q[c] || []) {
		if (d[i] !== c) continue;
		const x = i % W, y = (i - x) / W;
		for (const [dx, dy] of R.dirsFor(team)) {
			const nx = x + dx, ny = y + dy;
			if (!R.inside(s, nx, ny)) continue;
			const j = ny * W + nx, nc = c + cost(i); // (stepping from j into i)
			if (pass(j) && nc < d[j]) { d[j] = nc; (q[nc] ||= []).push(j); }
		}
	}
	let cur = e.y * W + e.x, spent = 0;
	const route = [], budget = e.fresh ? 0 : (e.age || 0) * R.movesOf(e);
	for (let n = 0; n < N && d[cur] > 0 && Number.isFinite(d[cur]); n++) {
		const x = cur % W, y = (cur - x) / W;
		let next = -1;
		for (const [dx, dy] of R.dirsFor(team)) {
			const nx = x + dx, ny = y + dy, j = ny * W + nx;
			if (R.inside(s, nx, ny) && pass(j) && (next < 0 || d[j] + cost(j) < d[next] + cost(next))) next = j;
		}
		if (next < 0) break;
		spent += cost(next); cur = next;
		if (spent > budget) route.push({ i: cur, c: spent - budget });
	}
	return route;
}
// Where an enemy may be by now: its route's first square still ahead of it (its own square if seen).
function ahead(s, team, e, goals, ctx) {
	if (e.fresh) return e;
	const r = routeOf(s, team, e, goals, ctx)[0];
	return r ? { x: r.i % s.W, y: Math.floor(r.i / s.W) } : e;
}
// Head for the first square on the enemy's route that this unit can reach (or stand next to) no later
// than the enemy does, so it gets in the way instead of chasing. A square another teammate is already
// covering (within 2) is skipped, so chasers spread along the route rather than queue behind each
// other. keep: { p, r } limits it to squares within r of p (a Guard stays near its flag).
function cutOff(s, u, e, goals, L, keep, ctx) {
	const route = routeOf(s, u.team, e, goals, ctx);
	if (!route.length) return null;
	const { dist } = R.reach(ctx.sb, u, null, ctx.seen), mU = R.movesOf(u), mE = R.movesOf(e);
	const claims = ((s.aiClaims ||= {})[e.id] ||= []);
	for (const p of route) {
		const px = p.i % s.W, py = Math.floor(p.i / s.W);
		if (keep && cheb(px, py, keep.p) > keep.r) continue;
		if (claims.some((c) => c.by !== u.id && cheb(px, py, c) <= 2)) continue;
		const there = [p.i, ...around(s, { x: px, y: py }, ctx.tiles)];
		const best = Math.min(...there.map((q) => dist[q]));
		if (!Number.isFinite(best)) continue;
		if ((best === 0 ? 0 : Math.ceil(best / mU)) > Math.ceil(p.c / mE)) continue;
		const go = goTo(s, u, new Set(there), null, L, 'walk', ctx);
		if (go) { claims.push({ x: px, y: py, by: u.id }); return go; }
	}
	return null;
}

// ---- Small helpers -------------------------------------------------------------------------------------------
// A min-heap of squares by cost; equal costs come out in the order they went in (so ties go the
// same way for both teams).
class Heap {
	constructor() { this.k = []; this.v = []; this.q = []; this.n = 0; }
	get size() { return this.k.length; }
	less(a, b) { return this.k[a] < this.k[b] || (this.k[a] === this.k[b] && this.q[a] < this.q[b]); }
	swap(a, b) { for (const arr of [this.k, this.v, this.q]) [arr[a], arr[b]] = [arr[b], arr[a]]; }
	push(key, val) {
		this.k.push(key); this.v.push(val); this.q.push(this.n++);
		for (let i = this.k.length - 1; i > 0;) { const p = (i - 1) >> 1; if (!this.less(i, p)) break; this.swap(i, p); i = p; }
	}
	pop() {
		const top = this.v[0], last = this.k.length - 1;
		this.swap(0, last); this.k.pop(); this.v.pop(); this.q.pop();
		for (let i = 0; ;) {
			const l = 2 * i + 1, r = l + 1;
			let m = i;
			if (l < this.k.length && this.less(l, m)) m = l;
			if (r < this.k.length && this.less(r, m)) m = r;
			if (m === i) break;
			this.swap(i, m); i = m;
		}
		return top;
	}
}
const dist = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
const cheb = (x, y, p) => Math.max(Math.abs(x - p.x), Math.abs(y - p.y));
// The passable squares round p (on the believed ground).
function around(s, p, tiles) {
	const out = new Set();
	for (const [dx, dy] of DIRS8) {
		const x = p.x + dx, y = p.y + dy;
		if (R.inside(s, x, y) && R.TERRAIN[tiles[y * s.W + x]].pass) out.add(y * s.W + x);
	}
	return out;
}
// Cover squares between rmin and rmax of p, the least dangerous first.
function coverNear(s, team, p, rmin, rmax, danger, tiles) {
	const out = [];
	for (const i of squares(s, team)) {
		const x = i % s.W, y = (i - x) / s.W;
		if (Math.abs(x - p.x) > rmax || Math.abs(y - p.y) > rmax) continue;
		const m = Math.abs(x - p.x) + Math.abs(y - p.y), t = R.TERRAIN[tiles[y * s.W + x]];
		if (m >= rmin && m <= rmax && t.pass && t.hide > 0) out.push(y * s.W + x);
	}
	return out.sort((a, b) => danger[a] - danger[b]).slice(0, 4);
}
