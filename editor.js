// Hide & Seize map editor. A map is edited as Blue's half, rows of letters just as in the file;
// Red's half is drawn turned round, and painting either half writes to Blue's (the middle row also
// mirrors left to right). Saved maps live in this browser (library.js); files are JSON (maps.js).
import { LIMITS, CHAR, ROLE_LETTER, MAPS, parseMap, checkMap, mapFile, slug, buildMap } from './maps.js';
import { loadBuiltIn, myMaps, saveMine, deleteMine } from './library.js';
import { paintTile, preview } from './view.js';
import { drawFigure, KIT } from './figures.js';

const $ = (id) => document.getElementById(id);
const DRAFT = 'hide-and-seize-editor-draft-v1';
const GROUND = [['.', 'Grass'], [',', 'Long grass'], ['T', 'Woods'], ['^', 'Hill'], ['#', 'Rocks'], ['~', 'Water'], ['=', 'Bridge'], [':', 'Ford']];
const PIECES = [['F', 'Flag'], ['s', 'Scout'], ['r', 'Runner'], ['d', 'Shadow'], ['h', 'Hunter'], ['g', 'Guard']];
const NAME = Object.fromEntries([...GROUND, ...PIECES]);
const store = {
	get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
	set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode: no draft */ } },
};

let def = null;          // the map being edited: { id, name, author, blurb, vary, rows }
let tool = 'T', brush = 1, dirty = false, hover = null, stroke = null;
const undo = [], redo = [];

// ---- The field from Blue's half ------------------------------------------------------------------------------
// Lenient (a map being made may have no flag yet): tiles for both halves, and the pieces on Blue's.
function field(d) {
	const rows = d.rows, W = rows[0].length, H = rows.length * 2 - 1, mid = rows.length - 1;
	const tiles = new Array(W * H).fill(0), pieces = [];
	rows.forEach((row, i) => {
		for (let x = 0; x < W; x++) {
			const c = row[x] ?? '.', y = mid + i;
			if (c in CHAR) tiles[y * W + x] = CHAR[c];
			else pieces.push({ x, y, c });
		}
	});
	for (let y = 0; y < mid; y++) for (let x = 0; x < W; x++) tiles[y * W + x] = tiles[(H - 1 - y) * W + (W - 1 - x)];
	return { W, H, mid, tiles, pieces };
}
// A new map: grass, a flag 3 rows from Blue's back edge, and a team of eight in a starting spread.
function blank(W, H) {
	const n = (H + 1) / 2, rows = Array.from({ length: n }, () => '.'.repeat(W).split(''));
	const cx = Math.floor(W / 2), at = (i, x, c) => { i = Math.max(1, Math.min(n - 2, i)); rows[i][Math.max(0, Math.min(W - 1, x))] = c; };
	at(n - 4, cx, 'F');
	at(3, cx, 's'); at(5, 1, 'r'); at(5, W - 2, 'r'); at(6, cx - 4, 'd');
	at(Math.round(n * 0.5), Math.round(W * 0.25), 'h'); at(Math.round(n * 0.5), Math.round(W * 0.75), 'h');
	at(n - 6, cx - 1, 'g'); at(n - 6, cx + 1, 'g');
	return { id: '', name: '', author: '', blurb: '', vary: 0.2, rows: rows.map((r) => r.join('')) };
}
const newId = (name) => `my-${slug(name || 'map').slice(0, 38)}-${Math.random().toString(36).slice(2, 6)}`;

// ---- Drawing ----------------------------------------------------------------------------------------------------
const cv = $('ed'), g = cv.getContext('2d'), paper = document.createElement('canvas');
let L = null, paperKey = '';
function layout() {
	const r = $('edWrap').getBoundingClientRect(), w = Math.max(100, Math.floor(r.width)), h = Math.max(100, Math.floor(r.height));
	const f = field(def), pad = 14;
	const tall = Math.min((w - pad * 2) / f.W, (h - pad * 2) / f.H), wide = Math.min((w - pad * 2) / f.H, (h - pad * 2) / f.W);
	const isWide = wide > tall, t = Math.max(6, Math.floor(isWide ? wide : tall)), cols = isWide ? f.H : f.W, rws = isWide ? f.W : f.H;
	const dpr = Math.min(2, window.devicePixelRatio || 1);
	cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); cv.style.width = w + 'px'; cv.style.height = h + 'px';
	L = { W: f.W, H: f.H, mid: f.mid, wide: isWide, t, cols, rows: rws, ox: Math.floor((w - cols * t) / 2), oy: Math.floor((h - rws * t) / 2), w, h, dpr };
	paperKey = '';
	draw();
}
const at = (x, y) => { const c = L.wide ? L.H - 1 - y : x, r = L.wide ? x : y; return { px: L.ox + c * L.t, py: L.oy + r * L.t }; };
const mid = (x, y) => { const p = at(x, y); return { px: p.px + L.t / 2, py: p.py + L.t / 2 }; };
function pick(px, py) {
	const c = Math.floor((px - L.ox) / L.t), r = Math.floor((py - L.oy) / L.t);
	if (c < 0 || r < 0 || c >= L.cols || r >= L.rows) return null;
	return L.wide ? { x: r, y: L.H - 1 - c } : { x: c, y: r };
}
let drawing = false;
function draw() { if (!drawing) { drawing = true; requestAnimationFrame(() => { drawing = false; frame(); }); } }
function frame() {
	const f = field(def), t = L.t, d = L.dpr, key = `${def.rows.join('/')}:${t}:${L.wide}`;
	if (key !== paperKey) { // the ground, repainted when the map changes
		paperKey = key;
		paper.width = Math.round(L.cols * t * d); paper.height = Math.round(L.rows * t * d);
		const pg = paper.getContext('2d');
		pg.setTransform(d, 0, 0, d, 0, 0);
		const s = { W: f.W, H: f.H, tiles: f.tiles };
		for (let y = 0; y < f.H; y++) for (let x = 0; x < f.W; x++) {
			const p = at(x, y), px = p.px - L.ox, py = p.py - L.oy;
			pg.save(); pg.beginPath(); pg.rect(px, py, t, t); pg.clip();
			paintTile(pg, s, x, y, px, py, t, L.wide);
			if (y < f.mid) { pg.fillStyle = 'rgba(8,12,20,0.2)'; pg.fillRect(px, py, t, t); } // (Red's half: a copy, drawn a shade darker)
			pg.strokeStyle = 'rgba(0,0,0,0.12)'; pg.lineWidth = 1 / d; pg.strokeRect(px, py, t, t);
			pg.restore();
		}
	}
	g.setTransform(d, 0, 0, d, 0, 0);
	g.clearRect(0, 0, L.w, L.h);
	g.drawImage(paper, L.ox, L.oy, L.cols * t, L.rows * t);
	// The middle row, shared by both halves.
	const a = at(0, f.mid), b = at(f.W - 1, f.mid);
	g.save(); g.strokeStyle = 'rgba(255,211,77,0.8)'; g.lineWidth = 2; g.setLineDash([6, 5]);
	g.strokeRect(Math.min(a.px, b.px), Math.min(a.py, b.py), L.wide ? t : f.W * t, L.wide ? f.W * t : t);
	g.restore();
	// Flags, bases and players, on both halves.
	const flag = f.pieces.find((p) => p.c === 'F');
	const items = [];
	for (const p of f.pieces) for (const team of ['blue', 'red']) {
		const q = team === 'blue' ? p : { x: f.W - 1 - p.x, y: f.H - 1 - p.y }, c = mid(q.x, q.y);
		if (p.c === 'F') items.push({ y: c.py, draw: () => drawFlag(q, team) });
		else items.push({ y: c.py + t * 0.3, draw: () => drawFigure(g, c.px, c.py + t * 0.32, t * 1.1, { role: ROLE_LETTER[p.c], team, skin: (p.x + p.y) % 5, hair: (p.x * 3 + p.y) % 7, facing: (team === 'blue') === L.wide ? 1 : -1 }) });
	}
	if (flag) for (const team of ['blue', 'red']) {
		const q = team === 'blue' ? flag : { x: f.W - 1 - flag.x, y: f.H - 1 - flag.y }, p = at(q.x - 1, q.y - 1), p2 = at(q.x + 1, q.y + 1);
		g.save(); g.strokeStyle = team === 'blue' ? 'rgba(90,140,255,0.9)' : 'rgba(255,110,100,0.9)'; g.lineWidth = 2; g.setLineDash([5, 4]);
		g.strokeRect(Math.min(p.px, p2.px) + 1, Math.min(p.py, p2.py) + 1, t * 3 - 2, t * 3 - 2);
		g.restore();
	}
	items.sort((m, n) => m.y - n.y);
	for (const it of items) it.draw();
	// Where the brush will paint, and its mirror on the other half.
	if (hover) {
		const k = tool in CHAR ? Math.floor(brush / 2) : 0;
		for (const [hx, hy, dash] of [[hover.x, hover.y, false], [f.W - 1 - hover.x, f.H - 1 - hover.y, true]]) {
			const p = at(hx - (L.wide ? 0 : k), hy + (L.wide ? k : -k)), size = (2 * k + 1) * t;
			const tl = at(hx - k, hy - k), br = at(hx + k, hy + k);
			g.save(); g.strokeStyle = dash ? 'rgba(255,255,255,0.55)' : '#fff'; g.lineWidth = 2; g.setLineDash(dash ? [4, 4] : []);
			g.strokeRect(Math.min(tl.px, br.px), Math.min(tl.py, br.py), size, size);
			g.restore();
			void p;
		}
	}
}
function drawFlag(q, team) {
	const c = mid(q.x, q.y), size = L.t * 0.5;
	g.save();
	g.translate(c.px - size * 0.2, c.py + size * 0.5);
	g.fillStyle = '#4b3a2a'; g.fillRect(-size * 0.04, -size * 1.5, Math.max(1.5, size * 0.08), size * 1.5);
	g.fillStyle = KIT[team].main; g.strokeStyle = '#fff'; g.lineWidth = Math.max(1, size * 0.05);
	g.beginPath(); g.moveTo(size * 0.04, -size * 1.48); g.lineTo(size * 0.75, -size * 1.28); g.lineTo(size * 0.04, -size * 1.05); g.closePath(); g.fill(); g.stroke();
	g.restore();
}

// ---- Painting ---------------------------------------------------------------------------------------------------
const toBlue = (x, y) => (y >= L.mid ? { x, y } : { x: L.W - 1 - x, y: L.H - 1 - y });
// Paint at a square (either half). Ground uses the brush and goes round the flag and players; erasing
// (right-click) clears a square to grass, piece and all. The flag and players take one square of a half
// (never the middle row), never each other's: clicking a player that's already there takes it away.
function apply(sq, erase) {
	const rows = def.rows.slice(), want = erase ? '.' : tool;
	let changed = false;
	const put = (bx, by, ch, keepPieces) => {
		const i = by - L.mid;
		if (i < 0 || i >= rows.length || bx < 0 || bx >= L.W || rows[i][bx] === ch) return;
		if (keepPieces && !(rows[i][bx] in CHAR)) return;
		rows[i] = rows[i].slice(0, bx) + ch + rows[i].slice(bx + 1);
		if (i === 0) { const mx = L.W - 1 - bx; rows[0] = rows[0].slice(0, mx) + ch + rows[0].slice(mx + 1); }
		changed = true;
	};
	if (want in CHAR) {
		const k = Math.floor((erase ? 1 : brush) / 2);
		for (let dy = -k; dy <= k; dy++) for (let dx = -k; dx <= k; dx++) {
			const x = sq.x + dx, y = sq.y + dy;
			if (x < 0 || y < 0 || x >= L.W || y >= L.H) continue;
			const b = toBlue(x, y);
			put(b.x, b.y, want, !erase);
		}
	} else {
		const b = toBlue(sq.x, sq.y), i = b.y - L.mid;
		if (i < 1) { say('The flag and the players go on a half, not on the shared middle row.'); return false; }
		const here = rows[i][b.x];
		if (want === 'F' && ROLE_LETTER[here]) { say('A player starts there: move it first.'); return false; }
		if (want !== 'F' && here === 'F') { say("That's the flag's square."); return false; }
		if (want === 'F') {
			for (let r = 0; r < rows.length; r++) if (rows[r].includes('F')) rows[r] = rows[r].replace('F', '.');
			rows[i] = rows[i].slice(0, b.x) + 'F' + rows[i].slice(b.x + 1);
			changed = true;
		} else if (rows[i][b.x] === want) put(b.x, b.y, '.');
		else {
			const team = rows.join('').split('').filter((c) => ROLE_LETTER[c]).length;
			if (team >= LIMITS.maxTeam && !ROLE_LETTER[rows[i][b.x]]) { say(`At most ${LIMITS.maxTeam} players a side.`); return false; }
			put(b.x, b.y, want);
		}
	}
	if (changed) { def.rows = rows; touched(); }
	return changed;
}
function remember() { undo.push(JSON.stringify(def)); if (undo.length > 200) undo.shift(); redo.length = 0; buttons(); }
function back(from, to) {
	if (!from.length) return;
	to.push(JSON.stringify(def));
	const size = `${def.rows.length}:${def.rows[0].length}`;
	def = JSON.parse(from.pop());
	fillProps();
	if (size !== `${def.rows.length}:${def.rows[0].length}`) layout();
	touched();
}
{
	const sqOf = (e) => { const r = cv.getBoundingClientRect(); return pick(e.clientX - r.left, e.clientY - r.top); };
	const key = (q) => q && `${q.x},${q.y}`;
	cv.addEventListener('pointerdown', (e) => {
		const sq = sqOf(e);
		if (!sq) return;
		e.preventDefault();
		try { cv.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
		const erase = e.button === 2;
		remember();
		stroke = { erase, changed: apply(sq, erase), last: key(sq), drag: erase || tool in CHAR };
		if (!stroke.drag) end();
	});
	cv.addEventListener('pointermove', (e) => {
		const sq = sqOf(e);
		if (key(sq) !== key(hover)) { hover = sq; tipFor(sq); draw(); }
		if (stroke && stroke.drag && sq && key(sq) !== stroke.last) { stroke.changed = apply(sq, stroke.erase) || stroke.changed; stroke.last = key(sq); }
	});
	const end = () => { if (stroke && !stroke.changed) { undo.pop(); buttons(); } stroke = null; };
	cv.addEventListener('pointerup', end);
	cv.addEventListener('pointercancel', end);
	cv.addEventListener('pointerleave', () => { hover = null; $('edTip').hidden = true; draw(); });
	cv.addEventListener('contextmenu', (e) => e.preventDefault());
}
function tipFor(sq) {
	const tip = $('edTip');
	if (!sq) { tip.hidden = true; return; }
	const b = toBlue(sq.x, sq.y), i = b.y - L.mid, c = def.rows[i][b.x], half = sq.y === L.mid ? 'The middle row (shared)' : sq.y > L.mid ? `Blue's half, ${i} back from the middle` : `Red's half (a copy of Blue's), ${i} back`;
	tip.textContent = `${half} · ${NAME[c] || c} · ${sq.x + 1} across`;
	tip.hidden = false;
}

// ---- Keeping the page in step ----------------------------------------------------------------------------------
let checkTimer = 0, draftTimer = 0;
function touched() {
	dirty = true;
	draw();
	clearTimeout(checkTimer); checkTimer = setTimeout(checks, 120);
	clearTimeout(draftTimer); draftTimer = setTimeout(() => store.set(DRAFT, { def, dirty }), 300);
	buttons();
}
function buttons() {
	$('undoBtn').disabled = !undo.length;
	$('redoBtn').disabled = !redo.length;
}
function checks() {
	const { errors, warnings, stats } = checkMap(def), box = $('checks');
	box.replaceChildren();
	const h = document.createElement('h3');
	h.className = errors.length ? 'bad' : warnings.length ? 'warn' : 'good';
	h.textContent = errors.length ? "Can't be played yet" : warnings.length ? 'Ready to play, with some advice' : 'Ready to play';
	box.append(h);
	if (errors.length || warnings.length) {
		const ul = document.createElement('ul');
		for (const [list, cls] of [[errors, 'bad'], [warnings, 'warn']]) for (const t of list) { const li = document.createElement('li'); li.className = cls; li.textContent = t; ul.append(li); }
		box.append(ul);
	}
	const f = field(def), p = document.createElement('p');
	p.className = 'stats';
	const count = {};
	for (const q of f.pieces) if (ROLE_LETTER[q.c]) count[q.c] = (count[q.c] || 0) + 1;
	const team = ['s', 'r', 'd', 'h', 'g'].filter((c) => count[c]).map((c) => `${count[c]} ${NAME[c]}${count[c] > 1 ? 's' : ''}`).join(', ');
	p.textContent = [`${f.W} × ${f.H}`, team ? `${Object.values(count).reduce((a, b) => a + b, 0)} a side (${team})` : 'no players yet',
		stats ? `cover ${Math.round(stats.cover * 100)}%` : '', stats ? `furthest start ${stats.run} moves from Red's flag` : ''].filter(Boolean).join(' · ');
	box.append(p);
	$('playBtn').disabled = errors.length > 0;
}
function fillProps() {
	$('mName').value = def.name; $('mAuthor').value = def.author; $('mBlurb').value = def.blurb;
	$('mVary').value = Math.round(def.vary * 100); $('mVaryOut').textContent = `${Math.round(def.vary * 100)}%`;
	$('mW').value = def.rows[0].length; $('mH').value = def.rows.length * 2 - 1;
}
function open(d, isDirty = false) {
	def = { id: d.id || '', name: d.name || '', author: d.author || '', blurb: d.blurb || '', vary: d.vary ?? 0.2, rows: d.rows.slice() };
	undo.length = 0; redo.length = 0;
	fillProps(); layout(); checks(); buttons(); mine();
	dirty = isDirty;
	store.set(DRAFT, { def, dirty });
}
let sayTimer = 0;
function say(t, warn = false) { const m = $('edMsg'); m.textContent = t; m.classList.toggle('warnText', warn); clearTimeout(sayTimer); sayTimer = setTimeout(() => { m.textContent = ''; m.classList.remove('warnText'); }, 6000); }

for (const [k, inp] of [['name', 'mName'], ['author', 'mAuthor'], ['blurb', 'mBlurb']]) $(inp).addEventListener('input', () => { def[k] = $(inp).value; dirty = true; store.set(DRAFT, { def, dirty }); clearTimeout(checkTimer); checkTimer = setTimeout(checks, 200); });
$('mVary').addEventListener('input', () => { def.vary = +$('mVary').value / 100; $('mVaryOut').textContent = `${$('mVary').value}%`; dirty = true; store.set(DRAFT, { def, dirty }); });
$('sizeBtn').addEventListener('click', () => {
	let W2 = Math.round(+$('mW').value), H2 = Math.round(+$('mH').value);
	if (!Number.isFinite(W2) || !Number.isFinite(H2)) return;
	W2 = Math.max(LIMITS.minW, Math.min(LIMITS.maxW, W2));
	H2 = Math.max(LIMITS.minRows * 2 - 1, Math.min(LIMITS.maxRows * 2 - 1, H2));
	if (H2 % 2 === 0) H2 += H2 < LIMITS.maxRows * 2 - 1 ? 1 : -1;
	if (W2 === def.rows[0].length && H2 === def.rows.length * 2 - 1) return;
	remember();
	def = resized(def, W2, H2);
	fillProps(); layout(); touched();
	say(`Now ${W2} × ${H2}.`);
});
// Resize, keeping the middle row (and centring across); rows are added or trimmed at Blue's back edge.
function resized(d, W2, H2) {
	const n = (H2 + 1) / 2, W1 = d.rows[0].length, off = Math.floor((W2 - W1) / 2), rows = [];
	for (let i = 0; i < n; i++) {
		const src = d.rows[i] ?? '.'.repeat(W1);
		let r = '';
		for (let x = 0; x < W2; x++) { const sx = x - off; r += sx >= 0 && sx < W1 ? src[sx] : '.'; }
		rows.push(r);
	}
	const m = rows[0].split('');
	for (let x = 0; x < W2; x++) if (x > W2 - 1 - x) m[x] = m[W2 - 1 - x]; // (the middle row stays mirrored)
	rows[0] = m.join('');
	return { ...d, rows };
}

// ---- Tools -----------------------------------------------------------------------------------------------------------
function toolButtons() {
	const mk = (host, list, draw1) => {
		for (const [c, name] of list) {
			const b = document.createElement('button'), sw = document.createElement('canvas');
			b.type = 'button'; b.dataset.t = c; b.title = `${name} (${c === 'F' ? 'F' : ROLE_LETTER[c] ? c.toUpperCase() : GROUND.findIndex(([k]) => k === c) + 1})`;
			const dpr = Math.min(2, window.devicePixelRatio || 1);
			sw.width = 22 * dpr; sw.height = 22 * dpr; sw.style.width = '22px'; sw.style.height = '22px';
			const sg = sw.getContext('2d'); sg.setTransform(dpr, 0, 0, dpr, 0, 0);
			draw1(sg, c);
			const label = document.createElement('span'); label.textContent = name;
			b.append(sw, label);
			b.addEventListener('click', () => { tool = c; mark(); });
			host.append(b);
		}
	};
	mk($('ground'), GROUND, (sg, c) => { const s = { W: 1, H: 1, tiles: [CHAR[c]] }; paintTile(sg, s, 0, 0, 0, 0, 22, false); });
	mk($('pieces'), PIECES, (sg, c) => {
		if (c === 'F') { sg.fillStyle = '#4b3a2a'; sg.fillRect(6, 3, 2, 17); sg.fillStyle = KIT.blue.main; sg.beginPath(); sg.moveTo(8, 3); sg.lineTo(19, 7); sg.lineTo(8, 11); sg.closePath(); sg.fill(); }
		else drawFigure(sg, 11, 21, 19, { role: ROLE_LETTER[c], team: 'blue', skin: 1, hair: 2, facing: 1, shadow: false });
	});
	for (const b of $('brush').querySelectorAll('button')) b.addEventListener('click', () => { brush = +b.dataset.b; mark(); });
	mark();
}
function mark() {
	for (const b of document.querySelectorAll('.toolGrid button')) b.setAttribute('aria-pressed', String(b.dataset.t === tool));
	for (const b of $('brush').querySelectorAll('button')) { b.setAttribute('aria-pressed', String(+b.dataset.b === brush)); b.disabled = !(tool in CHAR); }
	draw();
}
$('undoBtn').addEventListener('click', () => back(undo, redo));
$('redoBtn').addEventListener('click', () => back(redo, undo));
document.addEventListener('keydown', (e) => {
	if (document.querySelector('dialog[open]') || /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName)) return;
	const k = e.key.toLowerCase();
	if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); back(...(e.shiftKey ? [redo, undo] : [undo, redo])); return; }
	if ((e.ctrlKey || e.metaKey) && k === 'y') { e.preventDefault(); back(redo, undo); return; }
	if (e.ctrlKey || e.metaKey || e.altKey) return;
	if (k >= '1' && k <= '8') { tool = GROUND[+k - 1][0]; mark(); }
	else if (k === 'f') { tool = 'F'; mark(); }
	else if (ROLE_LETTER[k]) { tool = k; mark(); }
	else if (k === '[' || k === ']') { brush = Math.max(1, Math.min(5, brush + (k === ']' ? 2 : -2))); mark(); }
});

// ---- Saving and sharing ----------------------------------------------------------------------------------------------
function save(copy = false) {
	if (!def.name.trim()) { say('Give the map a name first.'); $('mName').focus(); return null; }
	if (copy || !def.id.startsWith('my-')) def.id = newId(def.name);
	if (!saveMine(def, JSON.parse(mapFile(def)))) { say("This browser wouldn't save it (its storage may be full or switched off). Export the file instead."); return null; }
	dirty = false;
	store.set(DRAFT, { def, dirty });
	mine();
	const bad = checkMap(def).errors.length;
	say(bad ? 'Saved. Fix the problems listed above and it can be played.' : copy ? 'Saved as a copy.' : 'Saved. It is in the game under Your maps.');
	return def.id;
}
$('saveBtn').addEventListener('click', () => save());
$('dupBtn').addEventListener('click', () => save(true));
$('playBtn').addEventListener('click', () => {
	if (checkMap(def).errors.length) { say('Fix the problems first.'); return; }
	const id = save();
	if (id) location.href = `./#play=${encodeURIComponent(id)}`;
});
$('exportBtn').addEventListener('click', () => {
	const blob = new Blob([mapFile({ ...def, id: def.id || slug(def.name) })], { type: 'application/json' }), a = document.createElement('a');
	a.href = URL.createObjectURL(blob);
	a.download = `${slug(def.name || 'map')}.json`;
	document.body.append(a); a.click(); a.remove();
	setTimeout(() => URL.revokeObjectURL(a.href), 2000);
	say(`Downloaded ${a.download}.`);
});
$('copyBtn').addEventListener('click', async () => {
	const text = mapFile({ ...def, id: def.id || slug(def.name) });
	try { await navigator.clipboard.writeText(text); say('Copied the map file. Paste it anywhere (a message, an email) to share it.'); }
	catch (e) { $('pasteText').value = text; $('pasteErr').textContent = 'The clipboard is blocked here: select the text and copy it yourself.'; $('pasteDlg').showModal(); $('pasteText').select(); }
});
function openText(text, from) {
	const { def: d, errors } = parseMap(text);
	if (!d) return errors.join(' ');
	if (dirty && !confirmLeave()) return null;
	open({ ...d, id: newId(d.name) }, true);
	say(`Opened “${d.name}” from ${from}${errors.length ? ` (${errors.join(' ')})` : ''}. Save it to keep it.`);
	return null;
}
$('importBtn').addEventListener('click', () => $('importFile').click());
$('importFile').addEventListener('change', async () => {
	const f = $('importFile').files[0];
	$('importFile').value = '';
	if (!f) return;
	if (f.size > 200000) { say("That file is too big to be a map."); return; }
	const err = openText(await f.text(), f.name);
	if (err) say(err);
});
$('pasteBtn').addEventListener('click', () => { $('pasteText').value = ''; $('pasteErr').textContent = ''; $('pasteDlg').showModal(); });
$('pasteGo').addEventListener('click', () => {
	const err = openText($('pasteText').value, 'the pasted text');
	if (err) { $('pasteErr').textContent = err; return; }
	$('pasteDlg').close();
});
// (an unsaved map is kept as a draft, so this only guards against losing work in one step)
let leaveArmed = 0;
function confirmLeave() {
	if (Date.now() - leaveArmed < 6000) return true;
	leaveArmed = Date.now();
	say('This map has unsaved changes: do that again to drop them, or Save first.', true);
	return false;
}

// The player's saved maps: open one, or delete it (two clicks).
function mine() {
	const ul = $('mine'), list = myMaps().sort((a, b) => (b.saved || '').localeCompare(a.saved || ''));
	ul.replaceChildren();
	if (!list.length) { const li = document.createElement('li'); li.className = 'empty'; li.textContent = 'None yet. Saved maps appear here, and in the game.'; ul.append(li); return; }
	for (const d of list) {
		const li = document.createElement('li'), o = document.createElement('button'), del = document.createElement('button');
		li.className = d.id === def.id ? 'on' : '';
		o.type = 'button'; o.className = 'open';
		o.textContent = d.name;
		const sm = document.createElement('small');
		sm.textContent = `${d.rows[0].length} × ${d.rows.length * 2 - 1}${d.playable ? '' : ' · not playable yet'}${d.saved ? ' · ' + new Date(d.saved).toLocaleDateString() : ''}`;
		o.append(sm);
		o.addEventListener('click', () => { if (!dirty || confirmLeave()) { open(d); say(`Opened “${d.name}”.`); } });
		del.type = 'button'; del.className = 'del'; del.textContent = 'Delete';
		del.addEventListener('click', () => {
			if (!del.classList.contains('sure')) { del.classList.add('sure'); del.textContent = 'Sure?'; setTimeout(() => { del.classList.remove('sure'); del.textContent = 'Delete'; }, 4000); return; }
			deleteMine(d.id);
			if (d.id === def.id) def.id = '';
			mine();
			say(`Deleted “${d.name}”.`);
		});
		li.append(o, del);
		ul.append(li);
	}
}

// New map: blank, or a copy of a built-in map or one of your own, in any of the sizes (a copy can keep
// its own). It starts at once: with unsaved changes the dialog says they'll be dropped.
let from = 'blank';
const sizePick = () => $('newMapDlg').querySelector('input[name="size"]:checked');
function pickFrom(id) {
	from = id;
	for (const x of $('fromList').querySelectorAll('button')) x.setAttribute('aria-pressed', String(x.dataset.id === from));
	// (a blank map has no size of its own; a copy keeps its own unless another size is picked)
	const same = $('newMapDlg').querySelector('input[value="same"]');
	$('sameSize').hidden = id === 'blank';
	if (id === 'blank' && same.checked) $('newMapDlg').querySelector('input[value="25x37"]').checked = true;
	if (id !== 'blank') same.checked = true;
	sizeNote();
}
const sizeNote = () => { $('sizeNote').hidden = from === 'blank' || sizePick().value === 'same'; };
for (const r of document.querySelectorAll('#newMapDlg input[name="size"]')) r.addEventListener('change', sizeNote);
$('newBtn').addEventListener('click', () => {
	const host = $('fromList');
	host.replaceChildren();
	const add = (id, label, m) => {
		const b = document.createElement('button');
		b.type = 'button'; b.dataset.id = id;
		if (m) { const c = document.createElement('canvas'); c.width = 100; c.height = 150; preview(c, m); b.append(c); }
		const s = document.createElement('span'); s.textContent = label; b.append(s);
		b.addEventListener('click', () => pickFrom(id));
		host.append(b);
	};
	add('blank', 'Blank');
	for (const d of [...MAPS.filter((m) => m.builtIn), ...myMaps().filter((m) => m.playable)]) { try { add(d.id, d.name, buildMap(d, 0, 0)); } catch (e) { /* skip */ } }
	pickFrom('blank');
	$('newDirty').hidden = !dirty;
	$('newMapDlg').showModal();
});
$('newGo').addEventListener('click', () => {
	const size = sizePick().value, [W, H] = size === 'same' ? [0, 0] : size.split('x').map(Number);
	if (from === 'blank') {
		open(blank(W, H));
		say(`A blank ${W} × ${H} map, with a flag and a team of eight to start you off.`);
	} else {
		const src = [...MAPS, ...myMaps()].find((m) => m.id === from);
		let d = { ...src, id: '', name: `${src.name} (copy)`, author: '' };
		const W0 = d.rows[0].length, H0 = d.rows.length * 2 - 1;
		if (W && (W !== W0 || H !== H0)) d = resized(d, W, H);
		open(d, true);
		const lost = W && checkMap(d).errors.length ? ' Some of it was cut off: the checks say what to fix.' : '';
		say(W && (W !== W0 || H !== H0) ? `A copy of ${src.name} at ${W} × ${H} (it was ${W0} × ${H0}).${lost} Rename it and save.` : `A copy of ${src.name}. Rename it and save.`);
	}
	$('newMapDlg').close();
});
for (const d of document.querySelectorAll('dialog')) {
	for (const c of d.querySelectorAll('.close')) c.addEventListener('click', () => d.close());
	d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
}
$('edHelpBtn').addEventListener('click', () => $('edHelp').showModal());
window.addEventListener('beforeunload', (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });
new ResizeObserver(() => { if (def) layout(); }).observe($('edWrap'));

// ---- Start: the draft you were working on, or a blank map --------------------------------------------------------------
try { await loadBuiltIn(); } catch (e) { say("The built-in maps couldn't be loaded (they're only needed to start from)."); }
toolButtons();
const draft = store.get(DRAFT);
const dd = draft && draft.def && parseMap({ format: 'hide-and-seize-map', version: 1, id: draft.def.id || undefined, name: draft.def.name || 'Untitled', author: draft.def.author, blurb: draft.def.blurb, shuffle: draft.def.vary, blueHalf: draft.def.rows }).def;
if (dd && dd.rows.length >= LIMITS.minRows && dd.rows.every((r) => r.length === dd.rows[0].length && r.length >= LIMITS.minW)) {
	open({ ...dd, id: draft.def.id || '', name: draft.def.name || '' }, !!draft.dirty);
} else open(blank(25, 37));
window.__ED = { get def() { return def; }, apply: (x, y, t, erase) => { if (t) tool = t; remember(); return apply({ x, y }, erase); }, at: (x, y) => mid(x, y), get L() { return L; }, save, checks: () => checkMap(def), open };
