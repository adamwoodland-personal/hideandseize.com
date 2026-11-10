// Hide & Seize: the computer player. It knows only what a player in its place would: the enemies its own
// units can see, where it last saw the others (s.lastSeen), who has been sent off (everyone hears a tackle),
// and the ground its units have seen. It plans on that ground, guessing the rest from its own half (the far
// half mirrors it, before each game's shuffle), and like a player it moves only onto ground it has seen.
// Hidden enemies never enter its sums: a square counts as taken only by a teammate or an enemy in sight.
// That holds at every level: the harder ones get no extra moves, luck or sight, and never read the dice.
// One action at a time, so the page can animate each: aiStep() says what to do next.
import * as R from './rules.js';

// tackle: how good a tackle must look (chance × what it wins − chance it fails × what it loses);
// danger: how hard it steers round enemies it knows of; sneak/hide: whether it uses the stances;
// wander: the share of moves made at random; hold: turns a raider waits for a guarded flag to clear;
// steady: rounds the Hunter keeps a post (long enough to hide there); safeStop: a move may stop
// short, in cover, rather than end beside an enemy; escape: moves a raider wants left after grabbing
// the flag (short of that it waits, hidden, where next turn it can grab and run).
// Hard and Really Hard are Normal with more worked out (see "The harder levels" below):
// gang: tackles are planned by the team, weighed in turns of a player's time, the tacklers sent in the best order;
// grab: the flag is taken as soon as the carrier could get clear of every enemy it can place, part-way
//   through a move if need be; carry: a carrier ends each move where the fewest known enemies could reach it;
// fort: how many players stand on the squares the flag can be reached from (with stand-ins while one is out).
// In computer-against-computer runs of 200 paired games (both colours, each side moving first): Easy never beat
// Normal; Hard won 84% of its decided games against Normal (4% were drawn); Really Hard won 94% against Normal
// (13% drawn) and 91% against Hard (37% drawn). Settings that wait for a safer moment did worse than Normal,
// and nothing here can break a flag that is shut in as Really Hard shuts its own.
const NORMAL = { tackle: 0.12, danger: 1, sneak: true, hide: true, wander: 0, hold: 0, steady: 5, safeStop: true, escape: 3 };
export const LEVELS = {
	easy: { name: 'Easy', tackle: -0.15, danger: 0, sneak: false, hide: false, wander: 0.5, hold: 0, steady: 1, escape: 0 },
	normal: { name: 'Normal', ...NORMAL },
	hard: { name: 'Hard', ...NORMAL, gang: true, grab: true, carry: true },
	reallyhard: { name: 'Really Hard', ...NORMAL, gang: true, grab: true, carry: true, fort: 4 },
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
	const ctx = context(s, team, L);
	s.aiHold ||= {};
	if (L.gang) { const act = gang(s, ctx, L); if (act) return act; }
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
function context(s, team, L = LEVELS.normal) {
	const seen = R.spotted(s, team), known = [];
	for (const b of s.units) {
		if (b.team === team || b.off) continue;
		if (seen.has(b.id)) { known.push({ id: b.id, role: b.role, x: b.x, y: b.y, carrying: b.carrying, fresh: true, age: 0 }); continue; }
		const m = s.lastSeen[team][b.id], age = m ? Math.floor(sightingAge(s, team, m)) : 9; // (whole turns: seen during the enemy's last turn counts as none)
		if (age <= 2) known.push({ id: b.id, role: b.role, x: m.x, y: m.y, carrying: m.carrying, fresh: false, age });
	}
	// The ground as the team believes it, and a copy of the state with it for working out routes.
	const tiles = believed(s, team), sb = { ...s, tiles }, st = site(s, team);
	const occ = new Uint8Array(s.W * s.H); // (squares it knows are taken: its own units and enemies in sight)
	for (const b of s.units) if (!b.off && (b.team === team || seen.has(b.id))) occ[b.y * s.W + b.x] = 1;
	const ctx = { team, seen, known, site: st, tiles, sb, occ, fromFlag: costsFrom(s, team, tiles, st.their) };
	if (L.gang || L.carry || L.grab) ctx.tac = tactics(s, ctx);
	return ctx;
}
// How many turns the other side has had since `team` made sighting m: 0 if seen this turn (it hasn't moved
// since), 0.5 if seen during its last turn (it may have moved on), 1 if seen a turn before that, and so on.
// Counted in turns, not rounds, so the computer plays the same whichever side moves first in a round. (A
// save from before sightings carried their turn: taken as seen in the enemy's.)
function sightingAge(s, team, m) {
	const half = (round, turn) => round * 2 + (turn === s.first ? 0 : 1);
	return Math.max(0, half(s.round, team) - half(m.round, m.turn === team ? team : R.other(team))) / 2;
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
	// The four squares a flag can be reached from (units move up, down and across, never diagonally), the
	// one facing the middle first: whoever stands on them shuts the flag in.
	const doors = (t) => {
		const f = s.flagHome[t], fy = t === 'blue' ? -1 : 1;
		return [[0, fy], [-fy, 0], [fy, 0], [0, -fy]].filter(([dx, dy]) => R.inside(s, f.x + dx, f.y + dy)).map(([dx, dy]) => (f.y + dy) * W + f.x + dx).filter(passable);
	};
	// (move costs from their flag, for staging a raid, change as the team sees more: see context())
	const out = { own, their, ownBase: baseOf(team), theirBase: baseOf(enemy), defend: defend.map((d) => d.i), look: look.slice(0, 3).map((d) => d.i), patrol, doors: doors(team) };
	SITES.set(key, out);
	return out;
}

// ---- Choosing ------------------------------------------------------------------------------------------------
function decide(s, u, ctx, L) {
	const W = s.W, st = ctx.site;
	// Which of its kind this is (two Guards take two posts, and so on).
	const k = s.units.filter((m) => m.team === u.team && m.role === u.role).indexOf(u);
	const mine = (list) => (list.length ? [...list.slice(k % list.length), ...list.slice(0, k % list.length)] : list);
	const tk = L.gang ? null : bestTackle(s, u, ctx, L);
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

	if (u.carrying && L.carry) return carry(s, u, ctx, L);
	if (u.carrying) return R.inBase(s, u.team, u.x, u.y) ? null : goTo(s, u, new Set(st.ownBase), danger, L, 'walk', ctx); // (in base, it waits for our flag)

	// A door keeper stands on its door, hidden. Guards stay even when the flag has gone (it comes straight
	// back when its carrier is tackled); the quicker keepers join the chase and return afterwards.
	const door = L.fort ? doorOf(s, u, ctx, L) : -1;
	if (door >= 0 && (!ourFlagGone || u.role === 'guard')) return settle(s, u, [door], danger, L, ctx);

	// Anyone who can snatch the flag this turn and still get away does, unless it is plainly guarded.
	// (picking the flag up takes a move of its own)
	if (theirFlagHome && L.grab) {
		const grab = door < 0 && grabPlan(s, u, ctx, L);
		if (grab) return grab;
	} else if (theirFlagHome && !u.moved) {
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
		const spots = R.near(u, b) ? [{ path: null, cost: 0 }] : [];
		for (const [dx, dy] of dirs8(u.team)) {
			if (!R.inside(s, b.x + dx, b.y + dy)) continue;
			const i = (b.y + dy) * W + (b.x + dx), d = reachable.get(i);
			if (d && d.cost <= u.mp - R.RULES.tackleCost && !d.path.some((j) => s.trail?.[u.id]?.includes(j))) spots.push({ path: d.path, cost: d.cost });
		}
		for (const sp of spots) {
			// (from where it stands, the odds a player is shown; after a move, the odds as far as it can tell: see blindOdds)
			const p = sp.path ? clampOdds(blindOdds(s, u, b) + R.RULES.windedBonus * (s.winded?.[b.id] || 0)) : R.tackleOdds(s, u, b).p;
			const ev = p * tv - (1 - p) * sv - sp.cost * 0.01;
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
// (or, if it was last seen a turn or two ago, from as far along that route as it could have got).
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

// ---- The harder levels ---------------------------------------------------------------------------------------
// Hard and Really Hard play by the same rules and know no more than Normal does (the enemies in sight, where
// the others were last seen, the ground its players have seen). What they add is working things out exactly,
// as a careful player would: who could reach whom next turn and at what odds, in which order to send
// tacklers in, and how to shut the flag in. Everything is weighed in turns of one player's time: a player
// sent off misses 2 turns and then has to walk back from its base.
const POINT = 30; // what a point is worth, in those turns
const CONF = [0.85, 0.5, 0.3, 0.2]; // how far to trust a sighting, by how many turns the enemy has had since (1 while in sight)
const MARGIN = 0.2; // how much a tackle attempt must be worth before it is made
const RISK = 0.4; // the most chance of being caught at which the flag is taken early (see grabPlan)
const UNSEEN = 0.5; // how likely a player is taken to have been unseen when the turn began, before it can tell
const clampOdds = (p) => Math.round(Math.min(R.RULES.maxOdds, Math.max(R.RULES.minOdds, p)) * 100) / 100;
const movesFor = (role, carrying, wet) => Math.max(1, R.ROLES[role].speed - (wet ? 1 : 0) + 2 + (carrying ? R.RULES.carrierBonus : 0));
// Turns a unit needs to walk from its own flag to where it stands: what being sent off costs on top of the 2 out.
const trek = (s, u) => dist(u, s.flagHome[u.team]) / (R.ROLES[u.role].speed + 2);
// What a carried flag is worth to its carrier's side: more the nearer home it is.
function carryWorth(s, c) {
	const home = s.flagHome[c.team], from = s.flagHome[R.other(c.team)];
	return POINT * (0.25 + 0.5 * Math.min(1, Math.max(0, 1 - dist(c, home) / Math.max(1, dist(from, home)))));
}

// The enemies the team knows of, each with how far it could get next turn (over the ground as the team
// believes it, round the players the team knows are in the way) and the squares it could tackle on.
function tactics(s, ctx) {
	const team = ctx.team, enemy = R.other(team), W = s.W, N = W * s.H, foes = [], foe = {};
	const fl = s.flagHome[enemy], theirFlag = fl.y * W + fl.x;
	// Where a player sent off comes back: its base, behind its flag (rules.js respawn).
	const back = ctx.site.theirBase.slice().sort((a, b) => Math.abs(Math.floor(b / W) - s.mid) - Math.abs(Math.floor(a / W) - s.mid) || Math.abs((a % W) - fl.x) - Math.abs((b % W) - fl.x))[0];
	for (const b of s.units) {
		if (b.team === team || (b.off && (b.out > 0 || back === undefined))) continue;
		let f = null;
		// Everyone hears a tackle, so the team knows who is out and when they are due back: one due next
		// turn will be standing in its base with a full turn's moves.
		if (b.off) f = { id: b.id, role: b.role, x: back % W, y: Math.floor(back / W), carrying: false, wet: false, fresh: false, due: true, age: 0, conf: 0.9 };
		else if (ctx.seen.has(b.id)) f = { id: b.id, role: b.role, x: b.x, y: b.y, carrying: b.carrying, wet: R.soaked(b), fresh: true, age: 0, conf: 1 };
		else {
			// (The game forgets a sighting by rounds, which is half a turn later for the side that moves second:
			// anything older than 3 turns is left out, so both sides have the same to go on.)
			const m = s.lastSeen[team][b.id], age = m ? sightingAge(s, team, m) : 9;
			if (age <= 3) f = { id: b.id, role: b.role, x: m.x, y: m.y, carrying: m.carrying, wet: false, fresh: false, age, conf: age === 0 ? 0.95 : CONF[Math.floor(age)] };
		}
		if (!f) continue;
		f.i = f.y * W + f.x;
		f.moves = movesFor(f.role, f.carrying, f.wet);
		// Out of sight it has had time to move on: allow for that, and count it for less.
		const slack = f.fresh || f.due ? 0 : Math.round(f.moves * Math.min(2, f.age));
		const d = new Float64Array(N).fill(Infinity), q = [[f.i]], budget = f.moves + slack;
		d[f.i] = 0;
		for (let c = 0; c < q.length; c++) for (const i of q[c] || []) {
			if (d[i] !== c) continue;
			const x = i % W, y = (i - x) / W;
			for (const [dx, dy] of R.dirsFor(enemy)) {
				const nx = x + dx, ny = y + dy;
				if (!R.inside(s, nx, ny)) continue;
				const j = ny * W + nx, t = R.TERRAIN[ctx.tiles[j]], nc = c + t.cost;
				if (!t.pass || j === theirFlag || ctx.occ[j] || nc > budget) continue;
				if (nc < d[j]) { d[j] = nc; (q[nc] ||= []).push(j); }
			}
		}
		// Where it could tackle: any square next to one it can reach with the moves for a tackle to spare.
		const zone = new Uint8Array(N), lim = budget - R.RULES.tackleCost;
		for (let i = 0; i < N; i++) {
			if (d[i] > lim) continue;
			const x = i % W, y = (i - x) / W;
			for (const [dx, dy] of DIRS8) if (R.inside(s, x + dx, y + dy)) zone[(y + dy) * W + x + dx] = 1;
		}
		f.d = d; f.zone = zone;
		foes.push(f); foe[f.id] = f;
	}
	return { foes, foe };
}
// The chance foe f would have tackling unit u (as rules.js tackleOdds, from what the team can tell: a foe
// out of sight is taken to be unseen when its turn begins).
function foeOdds(f, u) {
	const d = R.ROLES[f.role].strength - (f.wet ? 1 : 0) - (R.ROLES[u.role].strength - (R.soaked(u) ? 1 : 0));
	return clampOdds(R.RULES.baseOdds + R.RULES.strengthStep * d + (f.fresh ? 0 : R.RULES.unseenBonus) - (u.carrying ? R.RULES.carrierGrip : 0));
}
// The chance unit u, standing on square i, is sent off next turn by the foes that could reach it: the
// weakest tackles first (each miss winds u for the next), as a careful side would.
function exposure(ctx, u, i, sure = 0) {
	const ps = [];
	for (const f of ctx.tac.foes) if (f.conf >= sure && f.zone[i]) ps.push([foeOdds(f, u), f.conf]);
	if (!ps.length) return 0;
	ps.sort((a, b) => a[0] - b[0]);
	let safe = 1;
	ps.forEach(([p, conf], k) => { safe *= 1 - conf * clampOdds(p + R.RULES.windedBonus * k); });
	return 1 - safe;
}

// Which door (a square the flag can be reached from) a unit keeps, or -1. The strongest keep the doors:
// Guards first, then Hunters, and never so many that fewer than two are left to raid.
const KEEPERS = { guard: 0, hunter: 1, shadow: 2, scout: 3, runner: 4 };
function doorOf(s, u, ctx, L) {
	if (!L.fort) return -1;
	const mine = s.units.filter((m) => m.team === u.team), doors = ctx.site.doors, W = s.W;
	const n = Math.min(L.fort, doors.length, Math.max(0, mine.length - 2));
	const keepers = mine.map((m, k) => [m, k]).sort((a, b) => KEEPERS[a[0].role] - KEEPERS[b[0].role] || a[1] - b[1]).slice(0, n).map(([m]) => m);
	const k = keepers.indexOf(u);
	if (k >= 0) return doors[k];
	// While a keeper is out, whoever else is nearest its door (within 6 squares) stands in.
	if (u.off || u.carrying) return -1;
	const taken = new Set();
	for (const [j, m] of keepers.entries()) {
		if (!m.off) continue;
		const d = { x: doors[j] % W, y: Math.floor(doors[j] / W) };
		const sub = mine.filter((c) => !c.off && !c.carrying && !keepers.includes(c) && !taken.has(c) && dist(c, d) <= 6).sort((x, y) => dist(x, d) - dist(y, d))[0];
		if (!sub) continue;
		if (sub === u) return doors[j];
		taken.add(sub);
	}
	return -1;
}

// What sending enemy b off is worth, and what losing one of ours costs, in turns of a player's time.
function worthOf(s, b, ctx) {
	const team = ctx.team, W = s.W, st = ctx.site, f = ctx.tac.foe[b.id], plain = R.RULES.outTurns + trek(s, b);
	let t = plain;
	if (b.carrying) t += carryWorth(s, b) + (s.flags[R.other(team)].home ? 0 : POINT * 0.5); // (and if we hold theirs, ours going home lets us score)
	else if (s.flags[team].home && f && st.doors.some((i) => f.d[i] + 1 + R.RULES.pickupCost <= f.moves)) t += POINT * 0.3; // (it could take our flag next turn)
	const mate = s.units.find((m) => m.team === team && m.carrying && !m.off);
	if (mate && f && f.zone[mate.y * W + mate.x]) t += foeOdds(f, mate) * carryWorth(s, mate); // (it could reach our carrier)
	return { t, urgent: t > plain };
}
function lossOf(s, a, ctx, L, moving) {
	let c = R.RULES.outTurns + trek(s, a);
	if (a.carrying) c += carryWorth(s, a) + 5;
	if (L.fort && s.flags[a.team].home && doorOf(s, a, ctx, L) >= 0) c += moving ? 3 : 1; // (a door left open)
	return c;
}
// The best order to send tacklers in. Each miss winds the target (+20% for the next) and costs the one
// who missed, so the value of going first counts those who could follow. cands: [{ raw, loss }].
function sequence(cands, worth, w0) {
	const n = cands.length, memo = new Map();
	const V = (mask, k) => {
		if (memo.has(mask)) return memo.get(mask);
		let v = 0, first = -1;
		for (let i = 0; i < n; i++) {
			if (mask & (1 << i)) continue;
			const p = clampOdds(cands[i].raw + R.RULES.windedBonus * (w0 + k));
			const x = p * worth + (1 - p) * (V(mask | (1 << i), k + 1).v - cands[i].loss);
			if (x > v + 1e-9) { v = x; first = i; }
		}
		const out = { v, first };
		memo.set(mask, out);
		return out;
	};
	return V(0, 0);
}
// The team's tackles, planned together: for each enemy in sight, who could tackle it this turn (from
// where they stand, or after a move), and whether the attempt as a whole is worth its cost. Returns the
// next action of the best attempt, or null.
function gang(s, ctx, L) {
	const W = s.W, team = ctx.team, cost = R.RULES.tackleCost;
	const mine = s.units.filter((u) => u.team === team && !u.off && !u.acted);
	if (!mine.length || !ctx.seen.size) return null;
	const reach = new Map();
	const movesTo = (a) => { // (the squares a could still move to this turn, standing up first if it hasn't moved)
		if (reach.has(a.id)) return reach.get(a.id);
		let r = null;
		const stuck = s.aiDone.includes(a.id) || (s.aiMoves?.[a.id] || 0) >= 3 || (s.aiCount[a.id] || 0) > 8;
		const mp = a.stance === 'walk' || a.moved ? a.mp : R.movesOf(a);
		if (!stuck && !(a.stance === 'hide' && a.moved) && mp > cost) r = { mp, d: R.destinations(s, { ...a, mp, stance: 'walk' }, undefined, ctx.seen) };
		reach.set(a.id, r);
		return r;
	};
	let best = null;
	for (const b of s.units) {
		if (b.team === team || b.off || !ctx.seen.has(b.id)) continue;
		const cands = [], worth = worthOf(s, b, ctx);
		for (const a of mine) {
			// A raider on its way keeps to the raid: beyond its own half it tackles only what matters.
			if (!worth.urgent && (a.role === 'runner' || a.role === 'shadow') && s.flags[R.other(team)].home && !R.onHalf(s, team, a.y)) continue;
			if (R.near(a, b) && (a.stance === 'hide' || a.mp >= cost) && (s.aiCount[a.id] || 0) <= 12) { cands.push({ a, path: null, raw: rawOdds(s, a, b), loss: lossOf(s, a, ctx, L, false) }); continue; }
			const r = movesTo(a);
			if (!r) continue;
			let go = null;
			for (const [dx, dy] of dirs8(team)) {
				if (!R.inside(s, b.x + dx, b.y + dy)) continue;
				const d = r.d.get((b.y + dy) * W + b.x + dx);
				if (d && d.cost <= r.mp - cost && (!go || d.cost < go.cost) && !d.path.some((j) => s.trail?.[a.id]?.includes(j))) go = d;
			}
			if (go) cands.push({ a, path: go.path, raw: blindOdds(s, a, b), loss: lossOf(s, a, ctx, L, true) + go.cost * 0.01 });
		}
		if (!cands.length) continue;
		cands.sort((x, y) => y.raw - x.raw);
		const r = sequence(cands.slice(0, 8), worth.t, s.winded?.[b.id] || 0);
		if (r.first >= 0 && r.v > MARGIN && (!best || r.v > best.v + 1e-9)) best = { v: r.v, b, c: cands[r.first] };
	}
	if (!best) return null;
	const { a, path } = best.c;
	s.aiCount[a.id] = (s.aiCount[a.id] || 0) + 1;
	if (!path) return { type: 'tackle', unit: a.id, target: best.b.id };
	if (a.stance !== 'walk' && !a.moved) return { type: 'stance', unit: a.id, stance: 'walk' };
	(s.aiPlan ||= {})[a.id] = { i: path[path.length - 1], carrying: a.carrying };
	(s.aiMoves ||= {})[a.id] = (s.aiMoves[a.id] || 0) + 1;
	return { type: 'move', unit: a.id, path };
}
// a's chance on b before any dodges this turn (rules.js tackleOdds, less the winded part).
function rawOdds(s, a, b) {
	return R.tackleOdds(s, a, b).parts.reduce((t, [, v]) => t + v, 0) - R.RULES.windedBonus * (s.winded?.[b.id] || 0);
}
// The same for a tackle that starts with a move, as far as a player can tell before making it. Whether a
// player was unseen when the turn began, worth +15%, is shown to a person only once the tackle is on offer,
// next to the target, and it depends on enemies that may be hidden. So at every level such a tackle is
// weighed on a guess, worked out without the truth: half the bonus.
function blindOdds(s, a, b) {
	return rawOdds({ ...s, ambush: {} }, a, b) + R.RULES.unseenBonus * UNSEEN;
}

// Move costs from every square to the nearest of `goals`, over the ground as the team believes it (the
// team's own flag square can't be stepped on).
function costsTo(s, ctx, goals) {
	const W = s.W, N = W * s.H, d = new Float64Array(N).fill(Infinity), q = [[]];
	const own = s.flagHome[ctx.team], ownFlag = own.y * W + own.x;
	for (const g of goals) { d[g] = 0; q[0].push(g); }
	for (let c = 0; c < q.length; c++) for (const i of q[c] || []) {
		if (d[i] !== c) continue;
		const x = i % W, y = (i - x) / W, nc = c + R.TERRAIN[ctx.tiles[i]].cost; // (stepping from j into i)
		for (const [dx, dy] of R.dirsFor(ctx.team)) {
			const nx = x + dx, ny = y + dy;
			if (!R.inside(s, nx, ny)) continue;
			const j = ny * W + nx;
			if (j !== ownFlag && R.TERRAIN[ctx.tiles[j]].pass && nc < d[j]) { d[j] = nc; (q[nc] ||= []).push(j); }
		}
	}
	return d;
}
// Where to end this move: of the squares u can reach (or staying put), in any of the stances allowed, the
// one that scores best. Returns the next action towards it, or null to stay as it is.
function choose(s, u, ctx, score, stances = ['walk'], avoid = -1) {
	const here = u.y * s.W + u.x, free = !u.moved && !u.acted, trail = s.trail?.[u.id] || [];
	let best = null;
	for (const st of free ? stances : [u.stance]) {
		const mp = free ? R.stanceMoves({ ...u, stance: st }) : u.mp, cands = [];
		if (st !== 'hide' && mp > 0) for (const [i, d] of R.destinations(s, { ...u, mp, stance: st }, undefined, ctx.seen)) if (!d.path.some((j) => j === avoid || trail.includes(j))) cands.push([i, d]);
		if (u.team !== 'blue') cands.reverse(); // (ties go the same way for both sides, and to staying put before either)
		for (const [i, d] of [[here, null], ...cands]) {
			const v = score(i, st, d);
			if (v > -Infinity && (!best || v > best.v + 1e-9)) best = { v, st, d };
		}
	}
	if (!best) return null;
	if (best.st !== u.stance) return R.canStance(s, u, best.st) ? { type: 'stance', unit: u.id, stance: best.st } : null;
	return best.d ? { type: 'move', unit: u.id, path: best.d.path } : null;
}
// A flag carrier heads home by the squares where the fewest known enemies could reach it.
function carry(s, u, ctx, L) {
	const st = ctx.site, home = costsTo(s, ctx, st.ownBase), mv = R.movesOf(u);
	const loss = lossOf(s, u, ctx, L, true), canScore = s.flags[u.team].home;
	return choose(s, u, ctx, (i) => {
		if (canScore && home[i] === 0) return 1e6;
		return -home[i] / mv - exposure(ctx, u, i) * loss + Math.max(0, R.TERRAIN[ctx.tiles[i]].hide) * 0.05;
	});
}
// Whether to take their flag now: the way there, if what's left after picking it up gets the carrier
// somewhere the enemies it can place are unlikely to catch it. This is what lets any player take the flag
// part-way through a move. It doesn't hold a raider back: a Runner or Shadow already close enough goes for
// the flag by Normal's rule in decide() even when this says no (waiting for a safer moment did worse).
function grabPlan(s, u, ctx, L) {
	const W = s.W, st = ctx.site, flag = st.their.y * W + st.their.x, free = !u.moved && !u.acted;
	if (u.acted || (!free && u.stance === 'hide')) return null;
	const mp = free ? R.movesOf(u) : u.mp, c = mp > 0 && R.destinations(s, { ...u, mp, stance: 'walk' }, undefined, ctx.seen).get(flag);
	if (!c || c.path.some((j) => s.trail?.[u.id]?.includes(j))) return null;
	const left = mp - c.cost - R.RULES.pickupCost;
	if (left < L.escape) return null;
	// Where it could get to from the flag with the moves left: over ground the team has seen, round the players
	// it knows are in the way (its own square is free: it will have left it).
	const known = s.known[u.team], own = s.flagHome[u.team], ownFlag = own.y * W + own.x, here = u.y * W + u.x;
	const d = new Map([[flag, 0]]), q = [[flag]], as = { ...u, carrying: true };
	for (let c = 0; c < q.length && c < left; c++) for (const i of q[c] || []) {
		if (d.get(i) !== c) continue;
		const x = i % W, y = (i - x) / W;
		for (const [dx, dy] of R.dirsFor(u.team)) {
			const nx = x + dx, ny = y + dy, j = ny * W + nx;
			if (!R.inside(s, nx, ny) || !known[j] || j === ownFlag || (ctx.occ[j] && j !== here)) continue;
			const t = R.TERRAIN[s.tiles[j]], nc = c + t.cost;
			if (t.pass && nc <= left && !(d.get(j) <= nc)) { d.set(j, nc); (q[nc] ||= []).push(j); }
		}
	}
	// (only the enemies it can place: in sight, seen this turn or during their last one, or due back)
	let risk = 1;
	for (const i of d.keys()) risk = Math.min(risk, exposure(ctx, as, i, 0.8));
	if (risk > RISK) return null;
	if (u.stance !== 'walk') return { type: 'stance', unit: u.id, stance: 'walk' };
	return { type: 'move', unit: u.id, path: c.path };
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
