// Hide & Seize: the page. You are Blue; Red is the computer (ai.js); the rules are in rules.js.
// Red's moves are shown only where Blue's players can see them.
import * as R from './rules.js';
import { aiStep, LEVELS } from './ai.js';
import { MAPS, buildMap } from './maps.js';
import { Board, svgIcon, preview } from './view.js';
import { portrait } from './figures.js';
import { loadBuiltIn, addMine } from './library.js';

const SAVE = 'hide-and-seize-save-v1', PREFS = 'hide-and-seize-prefs-v1', STATS = 'hide-and-seize-stats-v1';
const $ = (id) => document.getElementById(id);
const store = {
	get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
	set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode: play on without saving */ } },
	del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } },
};
const calm = matchMedia('(prefers-reduced-motion: reduce)');
// How fast Red's turn plays out on screen (per square, and the pause after each player's move that Blue
// sees): New game's "Show Red's turn". It changes only the animation, never how Red plays.
const SPEEDS = { quick: { step: 70, pause: 0 }, normal: { step: 160, pause: 220 }, slow: { step: 280, pause: 500 } };
const STEP_MS = { blue: 90 };
const redSpeed = () => SPEEDS[prefs.speed] || SPEEDS.normal;

let S = null;
const board = new Board($('board'));
const ui = { trails: [], facing: {}, selected: null, hover: null, moves: null, path: null, targets: [], armed: null, visible: new Set(), ready: new Set(), ghosts: [], anim: {}, fx: [], now: 0, busy: false };
let backdrop = null; // a game drawn behind the first New game dialog
// The maps come from files (and the player's own from the map editor), so wait for them first.
let mapsFailed = false;
try { await loadBuiltIn(); } catch (e) { mapsFailed = true; }
addMine();
const prefs = readPrefs();

// ---- Names and words ------------------------------------------------------------------------------------------
const roleName = (u) => R.ROLES[u.role].name;
const who = (u) => (u.team === 'blue' ? `${u.name} the ${roleName(u)}` : `Red's ${roleName(u)} ${u.name}`);
const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const outText = (u) => (u.out === 0 ? 'back next turn' : `back in ${u.out + 1} turns`);

// ---- Drawing ------------------------------------------------------------------------------------------------------
const tweens = new Set();
let running = false;
function kick() { if (!running) { running = true; requestAnimationFrame(frame); } }
function frame(now) {
	ui.now = now;
	ui.anim = {};
	for (const tw of tweens) {
		const k = Math.min(1, (now - tw.t0) / tw.ms);
		ui.anim[tw.id] = { x0: tw.from.x, y0: tw.from.y, x1: tw.to.x, y1: tw.to.y, k: k < 0.5 ? 2 * k * k : 1 - (2 - 2 * k) ** 2 / 2 };
		if (k >= 1) { tweens.delete(tw); tw.done(); }
	}
	ui.fx = ui.fx.filter((f) => now - f.t0 < f.dur);
	if (S || backdrop) board.draw(S || backdrop, ui);
	// (keep going while stars spin over a winded player or a carried flag waves)
	const live = S && (Object.keys(S.winded || {}).length > 0 || S.units.some((u) => u.carrying && !u.off && (u.team === 'blue' || ui.visible.has(u.id)))
		|| ui.trails.some((tr) => now - tr.t0 < 3000));
	if (tweens.size || ui.fx.length || live) requestAnimationFrame(frame);
	else running = false;
}
const tween = (u, from, to, ms) => (calm.matches || ms <= 0 ? Promise.resolve()
	: new Promise((done) => { tweens.add({ id: u.id, from, to, t0: performance.now(), ms, done }); kick(); }));
const sleep = (ms) => new Promise((r) => setTimeout(r, calm.matches ? Math.min(ms, 150) : ms));
// A delayed step for the game now in play: if a new game has started by then, it does nothing.
const later = (fn, ms) => { const game = S; setTimeout(() => { if (S && S === game) fn(); }, ms); };
function fx(x, y, text, color, ring = false, dur = 1100) { ui.fx.push({ x, y, text, color, ring, t0: performance.now(), dur }); kick(); }

new ResizeObserver(() => fit()).observe($('boardWrap'));
function fit() {
	if (!S && !backdrop) return;
	const r = $('boardWrap').getBoundingClientRect();
	board.layout(S || backdrop, Math.max(50, Math.floor(r.width)), Math.max(50, Math.floor(r.height)));
	kick();
}

// ---- Keeping the panel in step ------------------------------------------------------------------------------------
function refresh() {
	if (!S) return;
	const wr = $('boardWrap').getBoundingClientRect();
	if (Math.floor(wr.width) !== board.w || Math.floor(wr.height) !== board.h) fit(); // (the panel changed height)
	ui.visible = R.spotted(S, 'blue');
	ui.ghosts = [];
	for (const [id, m] of Object.entries(S.lastSeen.blue)) {
		const u = R.unitById(S, id), age = S.round - m.round;
		if (u && !u.off && !ui.visible.has(id) && age <= 2) ui.ghosts.push({ x: m.x, y: m.y, role: u.role, age, id, unit: u });
	}
	const u = ui.selected && R.unitById(S, ui.selected);
	const mine = u && u.team === 'blue' && !u.off && myTurn();
	ui.moves = mine ? R.destinations(S, u) : null;
	ui.targets = mine ? R.tackleTargets(S, u) : [];
	if (ui.armed && !ui.targets.some((t) => t.unit.id === ui.armed)) ui.armed = null;
	if (ui.path && (!ui.moves || !ui.hover || !ui.moves.has(ui.hover.y * S.W + ui.hover.x))) ui.path = null;
	ui.ready = new Set(myTurn() ? S.units.filter((m) => m.team === 'blue' && readyUnit(m)).map((m) => m.id) : []);
	panel();
	kick();
}
const myTurn = () => S && S.turn === 'blue' && !S.winner && !ui.busy;
const readyUnit = (u) => !u.off && !u.acted && (R.tackleTargets(S, u).length > 0 || (u.mp > 0 && R.destinations(S, u).size > 0));
// The next of your players with something left to do, along the roster from player `from` (or back along it),
// coming round from the end to the start, `from` itself last. With nobody picked, the first (or the last).
function nextReady(from, back = false) {
	const mine = S.units.filter((m) => m.team === 'blue'), n = mine.length, k0 = mine.findIndex((m) => m.id === from);
	const at = k0 >= 0 ? k0 : back ? 0 : -1;
	for (let k = 1; k <= n; k++) { const m = mine[(at + (back ? n - k : k) + n) % n]; if (readyUnit(m)) return m; }
	return null;
}

function panel() {
	$('scoreBlue').textContent = S.score.blue;
	$('scoreRed').textContent = S.score.red;
	$('pillBlue').classList.toggle('gone', !S.flags.blue.home);
	$('pillRed').classList.toggle('gone', !S.flags.red.home);
	$('pillBlue').title = S.flags.blue.home ? 'Your flag is at home' : 'Red has your flag';
	$('pillRed').title = S.flags.red.home ? "Red's flag is at home" : "You have Red's flag";
	const t = $('turn');
	t.classList.toggle('red', S.turn === 'red' && !S.winner);
	t.innerHTML = S.winner ? 'Game over' : S.turn === 'blue' ? `Your turn<small>Round ${S.round} · ${LEVELS[S.level]?.name || ''}</small>` : `Red is moving<small>Round ${S.round}</small>`;
	$('endBtn').disabled = !myTurn();

	const ro = $('roster');
	ro.replaceChildren(...S.units.filter((u) => u.team === 'blue').map((u, k) => {
		const li = document.createElement('li'), b = document.createElement('button');
		b.type = 'button';
		const state = u.off ? (u.out === 0 ? 'back next' : `out ${u.out + 1}`) : u.carrying ? 'Flag!' : S.turn === 'blue' && !S.winner
			? (u.acted || (u.moved && u.mp <= 0) ? 'done' : u.stance === 'hide' ? 'hidden' : `${u.mp} moves`) : u.stance === 'walk' ? '' : u.stance === 'hide' ? 'hidden' : 'sneaking';
		b.className = [u.off ? 'out' : '', u.carrying ? 'flag' : '', S.turn === 'blue' && !u.off && (u.acted || (u.moved && u.mp <= 0)) ? 'done' : '',
			myTurn() && readyUnit(u) ? 'ready' : ''].join(' ').trim();
		b.setAttribute('aria-pressed', String(ui.selected === u.id));
		b.title = `${u.name} the ${roleName(u)} (${k + 1})`;
		b.innerHTML = `<canvas class="pt"></canvas><span class="nm">${u.name}</span><span class="st">${state || '&nbsp;'}</span>`;
		portrait(b.querySelector('canvas'), u, 34, 42);
		b.setAttribute('aria-label', `${u.name} the ${roleName(u)}${state ? ', ' + state : ''}`);
		b.addEventListener('click', () => select(u.id));
		li.append(b);
		return li;
	}));

	const u = ui.selected && R.unitById(S, ui.selected);
	const icon = $('cIcon');
	if (!u) {
		icon.getContext('2d').clearRect(0, 0, icon.width, icon.height);
		$('cName').textContent = myTurn() ? 'Pick a player' : S.turn === 'red' ? 'Red is moving…' : 'Pick a player';
		$('cState').textContent = 'Click one of yours on the field, or press 1 to 8.';
		$('cTraits').replaceChildren(); $('cSum').textContent = '';
		$('stances').hidden = true; $('tackles').replaceChildren();
		return;
	}
	const rl = R.ROLES[u.role];
	portrait(icon, u, 52, 62);
	$('cName').textContent = u.team === 'blue' ? `${u.name} · ${roleName(u)}` : `Red's ${roleName(u)} ${u.name}`;
	$('cState').textContent = stateLine(u);
	// (a soaked unit's lost point shows as a damp pip)
	const pips = (n, lost = 0) => `<span class="pips">${[1, 2, 3, 4, 5].map((k) => `<i class="${k <= n ? 'on' : k <= n + lost ? 'wet' : ''}"></i>`).join('')}</span>`;
	const onField = !u.off;
	const nums = { moves: R.movesOf(u), sight: onField ? R.sightOf(S, u) : rl.sight + 2, cover: onField ? R.coverOf(S, u) : Math.max(0, rl.stealth - 2) };
	const signed = (n) => (n < 0 ? `−${-n}` : `${n}`); // (standing out, on a hill or a ford or in water, is less than none)
	const wet = R.soaked(u) ? 1 : 0, strength = Math.max(0, rl.strength - wet);
	$('cSum').textContent = `${nums.moves} moves · sees ${nums.sight} · cover ${signed(nums.cover)} · strength ${strength}${wet ? ' · soaked' : ''}`;
	$('cTraits').innerHTML = [
		['Speed', rl.speed, `${nums.moves} moves`],
		['Sight', rl.sight, `${nums.sight} squares`],
		['Stealth', rl.stealth, `cover ${signed(nums.cover)}`],
		['Strength', rl.strength, `${strength}`],
	].map(([n, v, x]) => `<dt>${n}</dt><dd>${pips(v - wet, wet)}</dd><dd class="val">${x}</dd>`).join('');
	const st = $('stances');
	st.hidden = !(u.team === 'blue' && onField);
	for (const b of st.querySelectorAll('button')) {
		const k = b.dataset.st;
		b.setAttribute('aria-pressed', String(u.stance === k));
		b.disabled = !myTurn() || (u.stance !== k && !R.canStance(S, u, k));
	}
	const tk = $('tackles');
	tk.replaceChildren(...ui.targets.flatMap((tg) => {
		const b = document.createElement('button');
		b.type = 'button';
		b.className = ui.armed === tg.unit.id ? 'armed' : '';
		b.innerHTML = `<span>${ui.armed === tg.unit.id ? 'Click again to tackle' : 'Tackle'} ${roleName(tg.unit)} ${tg.unit.name}${S.winded[tg.unit.id] ? ' (winded)' : ''}</span><span class="pc">${Math.round(tg.p * 100)}%</span>`;
		b.title = tg.parts.map(([w, v]) => `${w} ${v >= 0 && w !== 'Even chance' ? '+' : ''}${Math.round(v * 100)}%`).join(', ');
		b.addEventListener('click', () => (ui.armed === tg.unit.id ? doTackle(u, tg.unit) : arm(tg.unit.id)));
		if (ui.armed !== tg.unit.id) return [b];
		const why = document.createElement('p');
		why.className = 'why';
		why.textContent = `${b.title}. Win: they're out for 2 turns. Lose: you are.`;
		return [b, why];
	}));
}
function stateLine(u) {
	if (u.team === 'red') {
		if (!ui.visible.has(u.id)) return 'Not in sight';
		return [u.carrying ? 'Carrying your flag!' : '', R.soaked(u) ? 'Soaked' : '', u.stance === 'hide' ? 'Hiding' : u.stance === 'sneak' ? 'Sneaking' : '', R.ROLES[u.role].blurb].filter(Boolean).join(' · ');
	}
	if (u.off) return `Out: ${outText(u)}, at your base.`;
	const bits = [];
	if (u.carrying) bits.push("Carrying Red's flag: get it to your base");
	if (R.soaked(u)) bits.push(`Soaked: 1 less of everything ${u.wet > 1 ? 'until the end of your next turn' : 'for this turn'}`);
	if (S.turn === 'blue') {
		if (u.acted) bits.push('Done this turn');
		else if (u.stance === 'hide') bits.push('Hiding: no moves, but can tackle anyone next to it');
		else bits.push(`${u.mp} of ${R.stanceMoves({ ...u })} moves left${u.stance === 'sneak' ? ' (sneaking)' : ''}`);
	} else bits.push(u.stance === 'hide' ? 'Hiding' : u.stance === 'sneak' ? 'Sneaking' : 'Waiting');
	return bits.join(' · ');
}

// ---- Choosing and acting --------------------------------------------------------------------------------------------
function select(id, bring = false) {
	ui.selected = id; ui.armed = null; ui.path = null;
	const u = id && R.unitById(S, id);
	if (bring && u && !u.off) board.show(S, u.x, u.y);
	refresh();
}
function arm(id) { ui.armed = id; refresh(); }
const selectedBlue = () => { const u = ui.selected && R.unitById(S, ui.selected); return u && u.team === 'blue' && !u.off ? u : null; };

function onTap(sq) {
	if (!S) return;
	if (!sq) { select(null); return; }
	const i = sq.y * S.W + sq.x, u = R.unitAt(S, sq.x, sq.y), sel = selectedBlue();
	if (u && u.team === 'blue') { select(u.id); return; }
	if (u && ui.visible.has(u.id)) {
		const tg = sel && ui.targets.find((t) => t.unit.id === u.id);
		if (tg && myTurn()) { if (ui.armed === u.id) doTackle(sel, u); else arm(u.id); return; }
		select(u.id); tip(sq, 4000); return;
	}
	if (sel && myTurn() && ui.moves && ui.moves.has(i)) { doMove(sel, ui.moves.get(i).path); return; }
	tip(sq, 3500);
}
async function doMove(u, path) {
	ui.busy = true; ui.path = null; ui.armed = null;
	try {
		refresh();
		for (const j of path) {
			const from = { x: u.x, y: u.y }, r = R.step(S, u, j);
			face(u, from);
			if (r.moved) await tween(u, from, { x: u.x, y: u.y }, STEP_MS.blue);
			events(r.ev);
			if (r.stop) break;
		}
	} catch (e) { // (an error never leaves the controls locked)
		console.warn('A move stopped on an error:', e);
		log('Something went wrong, so that move stopped there.');
	}
	ui.busy = false;
	after(u);
}
async function doTackle(a, b) {
	if (!myTurn()) return;
	ui.busy = true; ui.armed = null;
	try {
		const ev = R.tackle(S, a, b);
		events(ev);
		refresh();
		await sleep(700);
	} catch (e) {
		console.warn('A tackle stopped on an error:', e);
		log('Something went wrong, so that tackle stopped there.');
	}
	ui.busy = false;
	after(a);
}
function setStance(st) {
	const u = selectedBlue();
	if (!u || !myTurn() || u.stance === st) return;
	if (R.setStance(S, u, st)) { log(`${cap(who(u))} ${st === 'hide' ? 'hides' : st === 'sneak' ? 'sneaks' : 'walks'}.`, 'blue'); save(); refresh(); }
}
// After one of your actions: score/turn changes, and on to the next player with something to do.
function after(u) {
	save();
	if (S.winner) { refresh(); gameOver(); return; }
	if (S.mustEnd) { endSoon(); return; }
	if (u && !readyUnit(u)) {
		const next = nextReady(u.id);
		ui.selected = next ? next.id : u.id;
	}
	refresh();
}
// A point ends the scorer's turn, so the side that lost it moves first. That includes a point scored as
// your turn begins (your carrier waiting in base when Red's carrier is sent off), so it ends by itself.
function endSoon() { refresh(); later(() => S.mustEnd && endTurn(), calm.matches ? 300 : 1400); }
function endTurn() {
	if (!S || S.winner || S.turn !== 'blue' || (ui.busy && !S.mustEnd)) return;
	ui.selected = null;
	events(R.endTurn(S));
	save();
	refresh();
	if (S.turn === 'red' && !S.winner) runRed();
}

// Red's turn, one action at a time. Moves are animated only where Blue can see them.
async function runRed() {
	ui.busy = true;
	ui.trails = []; // (Red's moves Blue sees leave a trail until Red's next turn)
	const game = S;
	try {
		refresh();
		await sleep(350);
		let guard = 0;
		while (S && S === game && S.turn === 'red' && !S.winner && guard++ < 400) {
			const act = aiStep(S, 'red', S.level);
			if (act.type === 'none') break;
			if (act.type === 'end') { events(R.endTurn(S)); break; }
			const u = R.unitById(S, act.unit);
			if (act.type === 'stance') { if (!R.setStance(S, u, act.stance)) S.aiDone.push(u.id); continue; }
			if (act.type === 'move') {
				let moved = false, shown = false;
				for (const j of act.path) {
					const seen0 = R.spotted(S, 'blue').has(u.id), from = { x: u.x, y: u.y }, r = R.step(S, u, j);
					face(u, from);
					moved ||= r.moved;
					if (r.moved && (seen0 || R.spotted(S, 'blue').has(u.id))) {
						shown = true;
						ui.trails.push({ x0: from.x, y0: from.y, x1: u.x, y1: u.y, t0: performance.now() });
						refresh();
						await tween(u, from, { x: u.x, y: u.y }, redSpeed().step);
					}
					events(r.ev);
					if (r.stop) break;
				}
				if (!moved) S.aiDone.push(u.id);
				refresh();
				if (shown) await sleep(redSpeed().pause);
			}
			if (act.type === 'tackle') {
				events(R.tackle(S, u, R.unitById(S, act.target)));
				refresh();
				await sleep(800);
			}
			if (S.mustEnd) { await sleep(1300); events(R.endTurn(S)); break; }
		}
		if (S && S === game && S.turn === 'red' && !S.winner) events(R.endTurn(S)); // (a stuck computer never holds the game up)
	} catch (e) {
		// (and nor does an error: Red's turn ends there, or if even that can't be done, a new game is offered)
		console.warn("Red's turn stopped on an error:", e);
		try {
			log("Something went wrong in Red's turn, so it ends here.");
			if (S === game && S.turn === 'red' && !S.winner) events(R.endTurn(S));
		} catch (e2) {
			console.warn('The game could not go on, so a new one starts:', e2);
			startOver();
			return;
		}
	}
	ui.busy = false;
	save();
	if (S.winner) { refresh(); gameOver(); return; }
	if (S.mustEnd && S.turn === 'blue') { ui.selected = null; endSoon(); return; }
	const first = S.units.find((m) => m.team === 'blue' && readyUnit(m));
	ui.selected = first ? first.id : null;
	refresh();
}

// ---- What happened ----------------------------------------------------------------------------------------------------
function events(list) {
	for (const e of list) {
		const u = e.unit && R.unitById(S, e.unit), o = e.other && R.unitById(S, e.other);
		switch (e.type) {
			case 'bump':
				fx(o.x, o.y, '!', '#ffd34d', true);
				log(u.team === 'blue' ? `${cap(who(u))} walked into ${who(o)}, hiding.` : `${cap(who(u))} found ${who(o)} hiding.`, u.team);
				break;
			case 'spot':
				if (u.team === 'blue') tipText(`Stopped: ${e.ids.map((id) => who(R.unitById(S, id))).join(' and ')} in sight. You can keep moving.`, 3000);
				break;
			case 'soak':
				if (u.team === 'blue' || R.spotted(S, 'blue').has(u.id)) log(`${cap(who(u))} is soaked: 1 less Speed, Sight, Stealth and Strength until the end of ${u.team === 'blue' ? 'your' : "Red's"} next turn.`, u.team);
				break;
			case 'grab':
				banner(u.team === 'blue' ? "You've got Red's flag!" : 'Red has your flag!', u.team === 'blue' ? 'Get it back to your base.' : 'Tackle the carrier to send it home.', u.team);
				log(u.team === 'blue' ? `${cap(who(u))} grabbed Red's flag!` : `${cap(who(u))} grabbed your flag!`, u.team, true);
				break;
			case 'wait':
				if (u.team === 'blue') tipText('Red has your flag: you can score once it is back home.', 3500);
				break;
			case 'tackle': {
				const pc = `${Math.round(e.p * 100)}%`;
				if (e.won) { fx(o.x, o.y, 'Tackled!', u.team === 'blue' ? '#ffd34d' : '#ff8a80', true); log(`${cap(who(u))} tackled ${who(o)} (${pc}).`, u.team, true); }
				else {
					fx(u.x, u.y, 'Missed!', u.team === 'blue' ? '#ff8a80' : '#ffd34d', true);
					fx(o.x, o.y, 'Dodged!', '#ffd34d', false, 1300);
					const more = Math.round(R.RULES.windedBonus * e.winded * 100);
					log(`${cap(who(u))} missed ${who(o)} (${pc}) and is out for 2 turns. ${o.name} is winded: +${more}% to any tackle on them this turn.`, u.team, true);
				}
				break;
			}
			case 'return':
				log(e.team === 'blue' ? 'Your flag is back home.' : "Red's flag is back home.", e.team === 'blue' ? 'blue' : 'red');
				break;
			case 'score':
				banner(e.team === 'blue' ? 'You score!' : 'Red scores', `${e.score.blue} to ${e.score.red}${S.winner ? '' : e.team === 'blue' ? ' · Red moves first' : ' · You move first'}`, e.team);
				log(e.team === 'blue' ? `You scored! ${e.score.blue}–${e.score.red}` : `Red scored. ${e.score.blue}–${e.score.red}`, e.team, true);
				break;
			case 'reset':
				log(e.next === 'red' ? 'Everyone back to the start. Red lost the point, so Red moves first.' : 'Everyone back to the start. You lost the point, so you move first.');
				break;
			case 'back':
				if (u.team === 'blue') log(`${cap(who(u))} is back at your base.`, 'blue');
				break;
			case 'turn':
				if (e.team === 'blue') log(`Round ${e.round}: your turn.`);
				break;
		}
	}
}
function log(text, cls = '', big = false) {
	S.log ||= [];
	S.log.unshift({ text, cls: cls + (big ? ' big' : '') });
	S.log.length = Math.min(S.log.length, 40);
	const ul = $('log');
	ul.replaceChildren(...S.log.slice(0, 12).map((l) => { const li = document.createElement('li'); li.textContent = l.text; li.className = l.cls.trim(); return li; }));
}
let bannerTimer = 0;
function banner(text, small, team) {
	const b = $('banner');
	b.className = `banner ${team || ''}`;
	b.innerHTML = '';
	b.append(text);
	if (small) { const s = document.createElement('small'); s.textContent = small; b.append(s); }
	b.hidden = false;
	clearTimeout(bannerTimer);
	bannerTimer = setTimeout(() => (b.hidden = true), 2200);
}

// The info line over the field: what a square is, and who is on it.
let tipTimer = 0;
function tipText(text, ms) {
	const t = $('tip');
	t.textContent = text; t.hidden = !text;
	clearTimeout(tipTimer);
	if (ms && text) tipTimer = setTimeout(() => (t.hidden = true), ms);
}
function tip(sq, ms) {
	if (!sq) { tipText(''); return; }
	const i = sq.y * S.W + sq.x;
	if (!S.known.blue[i]) { tipText('Unexplored ground.', ms); return; }
	const T = R.terrainAt(S, sq.x, sq.y), at = R.unitAt(S, sq.x, sq.y), bits = [];
	const u = at && (at.team === 'blue' || ui.visible.has(at.id)) ? at : null; // (never anyone Blue can't see)
	if (R.isFlagSquare(S, 'blue', sq.x, sq.y)) bits.push(S.flags.blue.home ? 'Your flag.' : 'Your flag should be here: Red has it.');
	else if (R.isFlagSquare(S, 'red', sq.x, sq.y)) bits.push(S.flags.red.home ? "Red's flag: walk onto it to take it." : "Red's flag square.");
	else if (R.inBase(S, 'blue', sq.x, sq.y)) bits.push('Your base: bring Red\'s flag here.');
	else if (R.inBase(S, 'red', sq.x, sq.y)) bits.push("Red's base.");
	if (u) bits.push(`${cap(who(u))}${u.carrying ? ', with a flag' : ''}${R.soaked(u) ? ', soaked' : ''}.`);
	const g = ui.ghosts.find((h) => h.x === sq.x && h.y === sq.y);
	if (g && !u) bits.push(`Red's ${R.ROLES[g.role].name} was seen here ${g.age === 0 ? 'this round' : g.age === 1 ? 'last round' : '2 rounds ago'}.`);
	bits.push(`${T.name}: ${T.note}`);
	const mv = ui.moves && ui.moves.get(i);
	if (mv) bits.push(`${plural(mv.cost, 'move')} away.`);
	tipText(bits.join(' '), ms);
}

// ---- Input ----------------------------------------------------------------------------------------------------------
{
	const cv = $('board');
	let down = null;
	const sqOf = (e) => { const r = cv.getBoundingClientRect(); return board.pick(S, e.clientX - r.left, e.clientY - r.top); };
	// Click a square; drag (with any button) to pan; the wheel zooms where the pointer is.
	cv.addEventListener('pointerdown', (e) => {
		down = { x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY, id: e.pointerId, pan: e.button === 1 || e.button === 2, button: e.button };
		try { cv.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
	});
	cv.addEventListener('pointerup', (e) => {
		if (!down || down.id !== e.pointerId) return;
		const tap = !down.pan && down.button === 0;
		down = null;
		if (tap && S) onTap(sqOf(e));
	});
	cv.addEventListener('pointercancel', () => { down = null; });
	cv.addEventListener('contextmenu', (e) => e.preventDefault());
	cv.addEventListener('wheel', (e) => {
		if (!S) return;
		e.preventDefault();
		const r = cv.getBoundingClientRect();
		board.zooming = true;
		board.zoomAt(e.clientX - r.left, e.clientY - r.top, e.deltaY < 0 ? 1.15 : 1 / 1.15);
		clearTimeout(zoomTimer);
		zoomTimer = setTimeout(() => { board.zooming = false; kick(); }, 160);
		kick();
	}, { passive: false });
	cv.addEventListener('pointermove', (e) => {
		if (down && down.id === e.pointerId) {
			if (!down.pan && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 8) down.pan = true;
			if (down.pan) { board.panBy(e.clientX - down.lx, e.clientY - down.ly); down.lx = e.clientX; down.ly = e.clientY; kick(); return; }
		}
		if (e.pointerType !== 'mouse' || !S) return;
		const sq = sqOf(e), same = sq && ui.hover && sq.x === ui.hover.x && sq.y === ui.hover.y;
		if (same) return;
		ui.hover = sq;
		const m = sq && ui.moves && ui.moves.get(sq.y * S.W + sq.x);
		ui.path = m && myTurn() ? m.path : null;
		tip(sq);
		kick();
	});
	cv.addEventListener('pointerleave', () => { ui.hover = null; ui.path = null; tipText(''); kick(); });
}
let zoomTimer = 0;
function zoomBy(f) { board.zooming = true; board.zoomAt(board.w / 2, board.h / 2, f); clearTimeout(zoomTimer); zoomTimer = setTimeout(() => { board.zooming = false; kick(); }, 160); kick(); }
$('zoomIn').addEventListener('click', () => zoomBy(1.25));
$('zoomOut').addEventListener('click', () => zoomBy(1 / 1.25));
$('zoomFit').addEventListener('click', () => { board.fitAll(); kick(); });
// Which way a figure faces: the way it last moved across the screen.
function face(u, from) {
	const a = board.mid(S, from.x, from.y), b = board.mid(S, u.x, u.y);
	if (Math.abs(b.px - a.px) > 0.5) ui.facing[u.id] = b.px > a.px ? 1 : -1;
}
$('endBtn').addEventListener('click', endTurn);
for (const b of $('stances').querySelectorAll('button')) b.addEventListener('click', () => setStance(b.dataset.st));
document.addEventListener('keydown', (e) => {
	if (!S || document.querySelector('dialog[open]') || e.ctrlKey || e.metaKey || e.altKey) return;
	const k = e.key.toLowerCase(), mine = S.units.filter((u) => u.team === 'blue');
	if (k >= '1' && k <= '9' && mine[+k - 1]) { select(mine[+k - 1].id, true); e.preventDefault(); }
	else if (k === '+' || k === '=') zoomBy(1.25);
	else if (k === '-' || k === '_') zoomBy(1 / 1.25);
	else if (k === '0') { board.fitAll(); kick(); }
	else if (k.startsWith('arrow') && board.zoom > 1) { const d = 60; board.panBy(k === 'arrowleft' ? d : k === 'arrowright' ? -d : 0, k === 'arrowup' ? d : k === 'arrowdown' ? -d : 0); kick(); e.preventDefault(); }
	else if (k === 'tab' && myTurn()) {
		const next = nextReady(ui.selected, e.shiftKey);
		if (!next) return;
		select(next.id, true);
		e.preventDefault();
	} else if (k === 'w') setStance('walk');
	else if (k === 's') setStance('sneak');
	else if (k === 'h') setStance('hide');
	else if (k === 't' && myTurn() && ui.targets.length) {
		const tg = ui.targets.find((t) => t.unit.id === ui.armed);
		if (tg) doTackle(selectedBlue(), tg.unit); else arm(ui.targets[0].unit.id);
	} else if (k === 'e' && myTurn()) endTurn();
	else if (k === 'escape') { if (ui.armed) arm(null); else select(null); }
});

// ---- Saving --------------------------------------------------------------------------------------------------------------
function save() { if (S && !S.winner) store.set(SAVE, S); else store.del(SAVE); }
function readPrefs() {
	const p = store.get(PREFS) || {};
	return {
		mapId: MAPS.some((m) => m.id === p.mapId) ? p.mapId : MAPS[0]?.id,
		level: LEVELS[p.level] ? p.level : 'normal',
		first: p.first === 'blue' ? 'blue' : 'toss',
		speed: SPEEDS[p.speed] ? p.speed : 'normal',
	};
}
function record(result) {
	const st = store.get(STATS);
	const all = st && typeof st === 'object' && !Array.isArray(st) ? st : {};
	const key = `${S.mapId}:${S.level}`, r = all[key] && Number.isInteger(all[key].w) && Number.isInteger(all[key].l) ? all[key] : { w: 0, l: 0 };
	if (result === 'blue') r.w++; else if (result === 'red') r.l++;
	all[key] = r;
	store.set(STATS, all);
	return r;
}
function recordFor(mapId, level) {
	const st = store.get(STATS), r = st && st[`${mapId}:${level}`];
	return r && Number.isInteger(r.w) && Number.isInteger(r.l) ? r : null;
}

// ---- New game, help and game over ------------------------------------------------------------------------------------------
function startGame(mapId, level, firstPref) {
	const first = firstPref === 'blue' ? 'blue' : Math.random() < 0.5 ? 'blue' : 'red';
	const map = MAPS.find((m) => m.id === mapId) || (S && S.mapId === mapId ? S.map : MAPS[0]);
	S = R.newGame({ map, level, first });
	S.log = [];
	ui.trails = [];
	ui.facing = {};
	board.fitAll();
	backdrop = null;
	ui.selected = null; ui.armed = null; ui.path = null; ui.fx = []; tweens.clear();
	$('log').replaceChildren();
	fit();
	log(`${map.name}${map.author ? ` by ${map.author}` : ''}, against the ${LEVELS[level].name.toLowerCase()} computer. First to 3.`);
	if (firstPref !== 'blue') banner(first === 'blue' ? 'You won the toss' : 'Red won the toss', first === 'blue' ? 'You move first' : 'Red moves first', first);
	save();
	if (first === 'red') { refresh(); later(() => S.turn === 'red' && !ui.busy && runRed(), 900); }
	else { ui.selected = S.units.find((u) => u.team === 'blue').id; refresh(); }
}
function openNew() {
	const dlg = $('newDlg'), maps = $('maps');
	// The built-in maps, then the player's own (made or imported in the map editor).
	addMine();
	if (!MAPS.some((m) => m.id === prefs.mapId)) prefs.mapId = MAPS[0]?.id;
	maps.replaceChildren();
	for (const [title, list] of [['', MAPS.filter((m) => !m.mine)], ['Your maps', MAPS.filter((m) => m.mine)]]) {
		if (!list.length) continue;
		if (title) { const h = document.createElement('p'); h.className = 'mapsHead'; h.textContent = title; maps.append(h); }
		for (const def of list) {
			const b = document.createElement('button'), cv = document.createElement('canvas'), m = buildMap(def, 0, 0);
			b.type = 'button'; b.dataset.id = def.id;
			cv.width = 150; cv.height = 230;
			preview(cv, m);
			const name = document.createElement('b'), blurb = document.createElement('span');
			name.textContent = def.name;
			blurb.textContent = [def.mine && def.author ? `by ${def.author}` : '', def.blurb, `${m.W}×${m.H}, ${m.starts.blue.length} a side`].filter(Boolean).join(' · ');
			b.append(cv, name, blurb);
			b.addEventListener('click', () => { prefs.mapId = def.id; markMap(); });
			maps.append(b);
		}
	}
	if (mapsFailed && !MAPS.length) maps.textContent = "The maps couldn't be loaded. Check the connection and reload the page.";
	const markMap = () => {
		for (const b of maps.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.id === prefs.mapId));
		const r = recordFor(prefs.mapId, levelPicked()), def = MAPS.find((m) => m.id === prefs.mapId);
		$('record').textContent = r && def ? `On ${def.name} (${LEVELS[levelPicked()].name}): won ${r.w}, lost ${r.l}.` : '';
	};
	const levelPicked = () => dlg.querySelector('input[name="level"]:checked')?.value || 'normal';
	dlg.querySelector(`input[name="level"][value="${prefs.level}"]`).checked = true;
	dlg.querySelector(`input[name="first"][value="${prefs.first}"]`).checked = true;
	dlg.querySelector(`input[name="speed"][value="${prefs.speed}"]`).checked = true;
	for (const r of dlg.querySelectorAll('input[name="level"]')) r.onchange = markMap;
	markMap();
	$('contBtn').hidden = !(S && !S.winner);
	$('intro').open = !S && !store.get(PREFS); // (open for a first visit; a heading to open after that)
	if (!dlg.open) dlg.showModal();
	dlg.scrollTop = 0;
	// Start takes the focus, so Enter starts, but the dialog stays at its top. It is focused once the dialog has been
	// laid out: WebKit scrolls to a button focused before then, preventScroll or not.
	const was = document.activeElement;
	requestAnimationFrame(() => requestAnimationFrame(() => { if (dlg.open && document.activeElement === was) $('startBtn').focus({ preventScroll: true }); }));
}
$('startBtn').addEventListener('click', () => {
	const dlg = $('newDlg');
	prefs.level = dlg.querySelector('input[name="level"]:checked').value;
	prefs.first = dlg.querySelector('input[name="first"]:checked').value;
	prefs.speed = dlg.querySelector('input[name="speed"]:checked').value;
	store.set(PREFS, prefs);
	dlg.close();
	startGame(prefs.mapId, prefs.level, prefs.first);
});
$('contBtn').addEventListener('click', () => $('newDlg').close());
$('newDlg').addEventListener('cancel', (e) => { if (!S || S.winner) e.preventDefault(); });
$('newBtn').addEventListener('click', () => { if (!ui.busy) openNew(); });
$('helpBtn').addEventListener('click', () => $('helpDlg').showModal());
$('rulesBtn').addEventListener('click', () => $('helpDlg').showModal()); // (over New game, which the ? can't be reached behind)
for (const d of document.querySelectorAll('dialog')) {
	d.querySelector('.close')?.addEventListener('click', () => d.close());
	d.addEventListener('click', (e) => { if (e.target === d && d.id === 'helpDlg') d.close(); });
}
$('roleTable').innerHTML = `<table><thead><tr><th>Player</th><th>Speed</th><th>Sight</th><th>Stealth</th><th>Strength</th><th></th></tr></thead><tbody>${
	R.TEAM.map((k) => { const r = R.ROLES[k]; return `<tr><td><span class="who"><canvas data-role="${k}"></canvas>${r.name}</span></td><td class="n">${r.speed}</td><td class="n">${r.sight}</td><td class="n">${r.stealth}</td><td class="n">${r.strength}</td><td>${r.blurb}</td></tr>`; }).join('')
}</tbody></table>`;
for (const [k, cv] of [...$('roleTable').querySelectorAll('canvas')].entries()) portrait(cv, { role: cv.dataset.role, team: 'blue', skin: (k * 2) % 5, hair: (k * 3) % 7, stance: 'walk' }, 30, 36);
$('flagBlue').innerHTML = svgIcon('flag');
$('flagRed').innerHTML = svgIcon('flag');

function gameOver() {
	store.del(SAVE);
	const r = record(S.winner), won = S.winner === 'blue';
	$('overTitle').textContent = S.winner === 'draw' ? 'A draw' : won ? 'You win!' : 'Red wins';
	$('overText').textContent = S.winner === 'draw' ? `Nobody won in ${S.round - 1} rounds.`
		: `${S.score.blue} to ${S.score.red}, in ${S.round} rounds. ${won ? 'Their flag is yours.' : 'Better luck next time.'}`;
	const b = S.stats.blue, rd = S.stats.red;
	$('overStats').innerHTML = `<dt></dt><dd><b>You</b></dd><dd><b>Red</b></dd>
		<dt>Tackles won</dt><dd>${b.won} of ${b.tackles}</dd><dd>${rd.won} of ${rd.tackles}</dd>
		<dt>Flags grabbed</dt><dd>${b.grabs}</dd><dd>${rd.grabs}</dd>
		<dt>On this map</dt><dd>won ${r.w}</dd><dd>lost ${r.l}</dd>`;
	later(() => !$('overDlg').open && $('overDlg').showModal(), 900);
}
$('againBtn').addEventListener('click', () => { $('overDlg').close(); startGame(S.mapId, S.level, prefs.first); }); // (its own copy of the map, if it has since gone)
$('overNewBtn').addEventListener('click', () => { $('overDlg').close(); openNew(); });

// ---- Start ----------------------------------------------------------------------------------------------------------------------
// A fresh start, when there's no game to carry on with or the one there was can't go on.
function startOver() {
	store.del(SAVE);
	S = null; ui.selected = null; ui.busy = false; ui.trails = []; tweens.clear();
	$('log').replaceChildren();
	if (MAPS.length) backdrop = R.newGame({ mapId: prefs.mapId, level: prefs.level, seed: 1 });
	fit();
	openNew();
}
{
	const saved = store.get(SAVE);
	let carried = false;
	if (saved && R.validState(saved) && !saved.winner && LEVELS[saved.level]) {
		try {
			S = saved;
			if (!Array.isArray(S.log) || !S.log.every((l) => l && typeof l.text === 'string' && typeof l.cls === 'string')) S.log = [];
			for (const u of S.units) u.wet ||= 0; // (saves from before water could be waded)
			fit();
			log('Carrying on where you left off.');
			ui.selected = S.turn === 'blue' ? (S.units.find((u) => u.team === 'blue' && readyUnit(u)) || {}).id || null : null;
			refresh();
			carried = true;
			if (S.turn === 'red') later(() => S.turn === 'red' && !ui.busy && runRed(), 600);
			else if (S.mustEnd) endSoon(); // (saved just after your point: Red still moves first)
		} catch (e) {
			console.warn('The saved game could not be loaded, so a new one starts:', e);
		}
	}
	if (!carried) startOver();
	// From the map editor's Play button: #play=<map id> opens New game with that map picked.
	const want = new URLSearchParams(location.hash.slice(1)).get('play');
	if (want) {
		history.replaceState(null, '', location.pathname + location.search);
		addMine();
		if (MAPS.some((m) => m.id === want)) { prefs.mapId = want; openNew(); }
	}
}
window.__HS = { get S() { return S; }, ui, R, board, startGame, endTurn, onTap, runRed, refresh, tip };
