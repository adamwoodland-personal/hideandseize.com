// Hide & Seize: drawing the field on a canvas. The map is stored with Blue at the bottom; on a wide
// screen it is turned a quarter (Blue's end on the left). The view can be zoomed (1× fits the whole
// field) and panned; the players are figures (figures.js) drawn back to front.
import * as R from './rules.js';
import { drawFigure, KIT } from './figures.js';

// Icons as SVG paths on a 24-unit grid (the score flags, and anywhere a figure is too big).
export const ICON = {
	flag: 'M4.5 1.5h2.2v21H4.5zM6.7 2.5h12l-3 4.5 3 4.5h-12z',
};
export const svgIcon = (k, cls = '') => `<svg class="ico ${cls}" viewBox="0 0 24 24" aria-hidden="true"><path fill-rule="evenodd" d="${ICON[k]}"/></svg>`;

export const COLOR = { blue: KIT.blue.main, red: KIT.red.main, unknown: '#1d2430', unknownLine: '#262f3d' };
const GRASS = [142, 40, 62], SCRUB = [96, 44, 58], FOREST = [125, 32, 36], HILL = [44, 38, 64];
const hsl = ([h, s, l], dl = 0) => `hsl(${h} ${s}% ${l + dl}%)`;
const TAU = Math.PI * 2;
const hash = (i, k = 0) => { const v = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453; return v - Math.floor(v); };
const PAPER_MAX = 40; // the ground is painted at up to 40 px a square, and scaled beyond that

export class Board {
	constructor(canvas) {
		this.c = canvas;
		this.ctx = canvas.getContext('2d');
		this.paper = document.createElement('canvas');
		this.paperKey = '';
		this.zoom = 1; this.panX = 0; this.panY = 0;
		this.zooming = false;
	}
	// Fit the field into w×h CSS pixels, turning it a quarter if that gives bigger squares.
	layout(s, w, h) {
		const tall = Math.min(w / s.W, h / s.H), wide = Math.min(w / s.H, h / s.W);
		this.wide = wide > tall;
		this.fitT = Math.max(6, Math.floor(this.wide ? wide : tall));
		this.cols = this.wide ? s.H : s.W; this.rows = this.wide ? s.W : s.H;
		this.w = w; this.h = h;
		this.dpr = Math.min(2, window.devicePixelRatio || 1);
		this.c.width = Math.round(w * this.dpr); this.c.height = Math.round(h * this.dpr);
		this.c.style.width = w + 'px'; this.c.style.height = h + 'px';
		this.apply();
	}
	// Square size and offsets from the zoom and pan, keeping the field on screen.
	apply() {
		this.t = Math.max(6, Math.round(this.fitT * this.zoom));
		this.bw = this.cols * this.t; this.bh = this.rows * this.t;
		const room = (size, view) => Math.max(0, (size - view) / 2 + 40);
		const mx = room(this.bw, this.w), my = room(this.bh, this.h);
		this.panX = this.bw + 80 <= this.w ? 0 : Math.max(-mx, Math.min(mx, this.panX));
		this.panY = this.bh + 80 <= this.h ? 0 : Math.max(-my, Math.min(my, this.panY));
		this.ox = Math.round((this.w - this.bw) / 2 + this.panX);
		this.oy = Math.round((this.h - this.bh) / 2 + this.panY);
	}
	zoomAt(px, py, f) {
		const fx = (px - this.ox) / this.t, fy = (py - this.oy) / this.t;
		this.zoom = Math.max(1, Math.min(4, this.zoom * f));
		const t = Math.max(6, Math.round(this.fitT * this.zoom));
		this.panX = px - fx * t - (this.w - this.cols * t) / 2;
		this.panY = py - fy * t - (this.h - this.rows * t) / 2;
		this.apply();
	}
	panBy(dx, dy) { this.panX += dx; this.panY += dy; this.apply(); }
	fitAll() { this.zoom = 1; this.panX = 0; this.panY = 0; this.apply(); }
	// Bring a square into view if it is off the edge (or close to it).
	show(s, x, y, margin = 60) {
		const m = this.mid(s, x, y);
		if (m.px >= margin && m.py >= margin && m.px <= this.w - margin && m.py <= this.h - margin) return false;
		this.panX += this.w / 2 - m.px; this.panY += this.h / 2 - m.py;
		this.apply();
		return true;
	}
	// Map square → top-left corner on screen (CSS px), and back.
	at(s, x, y) {
		const c = this.wide ? s.H - 1 - y : x, r = this.wide ? x : y;
		return { px: this.ox + c * this.t, py: this.oy + r * this.t };
	}
	mid(s, x, y) { const p = this.at(s, x, y); return { px: p.px + this.t / 2, py: p.py + this.t / 2 }; }
	pick(s, px, py) {
		const c = Math.floor((px - this.ox) / this.t), r = Math.floor((py - this.oy) / this.t);
		if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) return null;
		return this.wide ? { x: r, y: s.H - 1 - c } : { x: c, y: r };
	}

	// The ground, painted into an offscreen canvas: in full when the size changes, otherwise only the
	// squares Blue has just seen (and their neighbours, whose edge lines change).
	paint(s) {
		const pt = Math.min(this.t, PAPER_MAX), key = `${pt}:${this.wide}:${this.dpr}:${s.mapId}:${s.seed}`, N = s.W * s.H, k = s.known.blue;
		if (key !== this.paperKey) {
			if (this.zooming && this.paperKey) return; // (while the wheel turns, the old picture is stretched)
			this.paperKey = key; this.pt = pt; this.painted = new Uint8Array(N);
			const p = this.paper, d = this.dpr;
			p.width = Math.round(this.cols * pt * d); p.height = Math.round(this.rows * pt * d);
			const g = p.getContext('2d');
			g.setTransform(d, 0, 0, d, 0, 0);
			for (let i = 0; i < N; i++) this.square(g, s, i);
			this.paperRev = s.knownRev;
			return;
		}
		if (s.knownRev === this.paperRev) return;
		this.paperRev = s.knownRev;
		const g = this.paper.getContext('2d'), redo = new Set();
		for (let i = 0; i < N; i++) {
			if (!k[i] || this.painted[i]) continue;
			redo.add(i);
			const x = i % s.W, y = (i - x) / s.W;
			for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (R.inside(s, x + dx, y + dy)) redo.add((y + dy) * s.W + x + dx);
		}
		for (const i of redo) this.square(g, s, i);
	}
	square(g, s, i) {
		const pt = this.pt, x = i % s.W, y = (i - x) / s.W, k = s.known.blue;
		const c = this.wide ? s.H - 1 - y : x, r = this.wide ? x : y, px = c * pt, py = r * pt;
		g.save();
		g.beginPath(); g.rect(px, py, pt, pt); g.clip();
		if (k[i]) { tile(g, s, x, y, px, py, pt, this.wide); this.painted[i] = 1; }
		else unknownTile(g, i, px, py, pt);
		g.strokeStyle = 'rgba(0,0,0,0.07)'; g.lineWidth = 1 / this.dpr;
		g.strokeRect(px, py, pt, pt);
		if (k[i]) { // a soft line where explored ground meets the unknown
			g.strokeStyle = 'rgba(10,14,20,0.6)'; g.lineWidth = Math.max(1, pt * 0.08);
			for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
				const nx = x + dx, ny = y + dy;
				if (!R.inside(s, nx, ny) || k[ny * s.W + nx]) continue;
				const sc = this.wide ? -dy : dx, sr = this.wide ? dx : dy; // the side on screen
				g.beginPath();
				if (sc) { const xx = sc > 0 ? px + pt : px; g.moveTo(xx, py); g.lineTo(xx, py + pt); }
				else { const yy = sr > 0 ? py + pt : py; g.moveTo(px, yy); g.lineTo(px + pt, yy); }
				g.stroke();
			}
		}
		g.restore();
	}

	// One frame. ui: { selected, moves (Map idx→{path}), path, targets, armed, visible (Set of Red ids
	// Blue can see), ready (Set of Blue ids with something left to do), ghosts, anim (mid-move),
	// facing ({id: ±1}), fx, now }.
	draw(s, ui) {
		const g = this.ctx, d = this.dpr, t = this.t;
		g.setTransform(d, 0, 0, d, 0, 0);
		g.clearRect(0, 0, this.w, this.h);
		this.paint(s);
		g.save();
		g.shadowColor = 'rgba(0,0,0,0.35)'; g.shadowBlur = 18;
		g.imageSmoothingEnabled = true;
		g.drawImage(this.paper, this.ox, this.oy, this.bw, this.bh);
		g.restore();

		// Bases: a tinted ring round each flag's eight squares.
		for (const team of ['blue', 'red']) {
			const f = s.flagHome[team], a = this.at(s, f.x - 1, f.y - 1), b = this.at(s, f.x + 1, f.y + 1);
			const x0 = Math.min(a.px, b.px), y0 = Math.min(a.py, b.py);
			g.save();
			g.fillStyle = team === 'blue' ? 'rgba(47,107,224,0.10)' : 'rgba(221,67,57,0.10)';
			g.strokeStyle = team === 'blue' ? 'rgba(47,107,224,0.75)' : 'rgba(221,67,57,0.75)';
			g.lineWidth = Math.max(1.5, t * 0.06); g.setLineDash([t * 0.22, t * 0.14]);
			roundRect(g, x0 + 2, y0 + 2, t * 3 - 4, t * 3 - 4, t * 0.3);
			g.fill(); g.stroke();
			g.restore();
		}
		// Where the selected player can go, and the path to the square under the pointer.
		if (ui.moves) {
			g.fillStyle = 'rgba(255,255,255,0.28)';
			for (const i of ui.moves.keys()) { const { px, py } = this.at(s, i % s.W, Math.floor(i / s.W)); g.fillRect(px + 1, py + 1, t - 2, t - 2); }
			g.fillStyle = 'rgba(255,255,255,0.7)';
			for (const i of ui.moves.keys()) { const { px, py } = this.mid(s, i % s.W, Math.floor(i / s.W)); g.beginPath(); g.arc(px, py, Math.max(1.5, t * 0.06), 0, TAU); g.fill(); }
		}
		if (ui.path && ui.selected) {
			const u = R.unitById(s, ui.selected), pts = [this.mid(s, u.x, u.y), ...ui.path.map((i) => this.mid(s, i % s.W, Math.floor(i / s.W)))];
			g.save();
			g.strokeStyle = '#fff'; g.lineWidth = Math.max(2, t * 0.11); g.lineCap = 'round'; g.lineJoin = 'round';
			g.shadowColor = 'rgba(0,0,0,0.35)'; g.shadowBlur = 4;
			g.beginPath(); pts.forEach((p, k) => (k ? g.lineTo(p.px, p.py) : g.moveTo(p.px, p.py))); g.stroke();
			const e = pts[pts.length - 1];
			g.beginPath(); g.arc(e.px, e.py, t * 0.16, 0, TAU); g.fillStyle = '#fff'; g.fill();
			g.restore();
		}
		// Red's moves Blue saw this turn: dashed trails, fading from strong to faint.
		for (const tr of ui.trails || []) {
			const a = this.mid(s, tr.x0, tr.y0), b = this.mid(s, tr.x1, tr.y1), age = (ui.now - tr.t0) / 3000;
			g.save();
			g.globalAlpha = Math.max(0.3, 0.9 - age * 0.6);
			g.strokeStyle = '#ff7a70'; g.lineWidth = Math.max(2, t * 0.09); g.lineCap = 'round'; g.setLineDash([t * 0.2, t * 0.16]);
			g.beginPath(); g.moveTo(a.px, a.py + t * 0.2); g.lineTo(b.px, b.py + t * 0.2); g.stroke();
			g.restore();
		}
		// How far the selected player sees.
		const sel = ui.selected && R.unitById(s, ui.selected);
		if (sel && !sel.off && sel.team === 'blue') {
			const c = this.drawnMid(s, sel, ui), r = R.sightOf(s, sel) * t;
			g.save();
			g.strokeStyle = 'rgba(255,255,255,0.55)'; g.lineWidth = 1.5; g.setLineDash([4, 5]);
			g.beginPath(); g.arc(c.px, c.py, r, 0, TAU); g.stroke();
			g.restore();
		}

		// Everything that stands up (flags, players, the faded last-seen figures), back to front.
		const items = [];
		for (const team of ['blue', 'red']) {
			const f = s.flagHome[team], c = this.mid(s, f.x, f.y);
			items.push({ y: c.py + t * 0.3, draw: () => (s.flags[team].home ? this.flag(g, c.px, c.py, t * 0.5, team) : this.emptyPole(c.px, c.py, t * 0.5)) });
		}
		for (const gh of ui.ghosts || []) {
			const c = this.mid(s, gh.x, gh.y);
			items.push({ y: c.py + t * 0.34, draw: () => {
				g.save();
				g.strokeStyle = COLOR.red; g.globalAlpha = 0.6; g.lineWidth = 1.5; g.setLineDash([3, 3]);
				g.beginPath(); g.ellipse(c.px, c.py + t * 0.32, t * 0.36, t * 0.12, 0, 0, TAU); g.stroke();
				g.restore();
				drawFigure(g, c.px, c.py + t * 0.32, t * 1.15, { ...gh.unit, pose: 'stand', facing: -1, alpha: gh.age === 0 ? 0.42 : gh.age === 1 ? 0.3 : 0.2, shadow: false });
			} });
		}
		for (const u of s.units) {
			if (u.off || !(u.team === 'blue' || ui.visible.has(u.id))) continue;
			const c = this.drawnMid(s, u, ui);
			items.push({ y: c.py + t * 0.34, draw: () => this.figure(s, u, c, ui) });
		}
		items.sort((a, b) => a.y - b.y);
		for (const it of items) it.draw();

		// Tackle chances on the enemies the selected player can reach.
		for (const tg of ui.targets || []) {
			const c = this.drawnMid(s, tg.unit, ui), armed = ui.armed === tg.unit.id;
			g.save();
			g.strokeStyle = armed ? '#ffd34d' : '#fff'; g.lineWidth = armed ? 3 : 2;
			g.setLineDash(armed ? [] : [5, 4]);
			g.beginPath(); g.ellipse(c.px, c.py + t * 0.32, t * 0.48, t * 0.18, 0, 0, TAU); g.stroke();
			label(g, `${Math.round(tg.p * 100)}%`, c.px, c.py - t * 0.95, Math.max(11, t * 0.38), armed ? '#ffd34d' : '#fff');
			g.restore();
		}
		// Effects: rings and words that float up and fade.
		for (const f of ui.fx || []) {
			const k = Math.min(1, (ui.now - f.t0) / f.dur);
			if (k >= 1) continue;
			const c = this.mid(s, f.x, f.y);
			g.save();
			g.globalAlpha = 1 - k * k;
			if (f.ring) { g.strokeStyle = f.color; g.lineWidth = 3; g.beginPath(); g.ellipse(c.px, c.py + t * 0.3, t * (0.4 + k * 0.9), t * (0.15 + k * 0.33), 0, 0, TAU); g.stroke(); }
			if (f.text) label(g, f.text, c.px, c.py - t * (1 + k * 0.6), Math.max(13, t * 0.45), f.color);
			g.restore();
		}
	}
	drawnMid(s, u, ui) {
		const a = ui.anim && ui.anim[u.id];
		if (!a) return this.mid(s, u.x, u.y);
		const p = this.mid(s, a.x0, a.y0), q = this.mid(s, a.x1, a.y1);
		return { px: p.px + (q.px - p.px) * a.k, py: p.py + (q.py - p.py) * a.k };
	}
	figure(s, u, c, ui) {
		const g = this.ctx, t = this.t, feet = c.py + t * 0.32, a = ui.anim && ui.anim[u.id];
		const spent = u.team === 'blue' && s.turn === 'blue' && !s.winner && (u.acted || (u.moved && u.mp <= 0));
		// The ring at the feet: team colour, gold when picked.
		g.save();
		g.lineWidth = Math.max(1.5, t * 0.07);
		g.strokeStyle = ui.selected === u.id ? '#ffd34d' : u.team === 'blue' ? 'rgba(90,140,255,0.95)' : 'rgba(255,110,100,0.95)';
		g.fillStyle = u.team === 'blue' ? 'rgba(47,107,224,0.25)' : 'rgba(221,67,57,0.25)';
		if (ui.selected === u.id) { g.shadowColor = 'rgba(255,211,77,0.9)'; g.shadowBlur = 8; }
		g.beginPath(); g.ellipse(c.px, feet, t * 0.38, t * 0.14, 0, 0, TAU); g.fill(); g.stroke();
		g.restore();
		const pose = a ? 'walk' : u.stance === 'hide' ? 'hide' : u.stance === 'sneak' ? 'sneak' : 'stand';
		drawFigure(g, c.px, feet, t * 1.15, {
			...u, pose, phase: a ? a.k * 2 : 0, facing: ui.facing?.[u.id] ?? (u.team === 'blue' ? 1 : -1),
			flag: u.carrying ? R.other(u.team) : null, winded: s.winded?.[u.id] || 0, time: ui.now,
			wading: !a && !!R.terrainAt(s, u.x, u.y).wet, soaked: R.soaked(u),
			alpha: spent ? 0.55 : u.stance === 'hide' ? 0.85 : 1,
		});
		if (ui.ready && ui.ready.has(u.id)) { // a dot over players that still have something to do
			g.save(); g.fillStyle = '#ffd34d'; g.strokeStyle = 'rgba(30,25,0,0.7)'; g.lineWidth = 1;
			g.beginPath(); g.arc(c.px + t * 0.36, feet - t * 1.05, Math.max(2.5, t * 0.09), 0, TAU); g.fill(); g.stroke();
			g.restore();
		}
	}
	flag(g, x, y, size, team) {
		g.save();
		g.translate(x - size * 0.2, y + size * 0.5);
		g.fillStyle = 'rgba(0,0,0,0.25)'; g.beginPath(); g.ellipse(size * 0.05, 0, size * 0.3, size * 0.09, 0, 0, TAU); g.fill();
		g.fillStyle = '#4b3a2a'; g.fillRect(-size * 0.04, -size * 1.5, Math.max(1.5, size * 0.08), size * 1.5);
		g.fillStyle = KIT[team].main; g.strokeStyle = '#fff'; g.lineWidth = Math.max(1, size * 0.05);
		g.beginPath(); g.moveTo(size * 0.04, -size * 1.48); g.quadraticCurveTo(size * 0.4, -size * 1.4, size * 0.75, -size * 1.28);
		g.quadraticCurveTo(size * 0.4, -size * 1.12, size * 0.04, -size * 1.05); g.closePath(); g.fill(); g.stroke();
		g.restore();
	}
	emptyPole(x, y, size) {
		const g = this.ctx;
		g.save(); g.globalAlpha = 0.55;
		g.fillStyle = '#4b3a2a'; g.fillRect(x - size * 0.24, y + size * 0.5 - size * 1.5, Math.max(1.5, size * 0.08), size * 1.5);
		g.restore();
	}
}

// ---- Painting a square --------------------------------------------------------------------------------------
function tile(g, s, x, y, px, py, t, wide) {
	const i = y * s.W + x, v = s.tiles[i], n = hash(i) - 0.5;
	const grass = () => { g.fillStyle = hsl(GRASS, n * 4); g.fillRect(px, py, t, t); };
	switch (v) {
		case 0: grass(); break;
		case 1: // long grass: tufts
			g.fillStyle = hsl(SCRUB, n * 3); g.fillRect(px, py, t, t);
			g.strokeStyle = hsl(SCRUB, -16); g.lineWidth = Math.max(1, t * 0.05); g.lineCap = 'round';
			for (let k = 0; k < 5; k++) {
				const cx = px + t * (0.18 + 0.64 * hash(i, k)), cy = py + t * (0.25 + 0.6 * hash(i, k + 9));
				g.beginPath();
				g.moveTo(cx - t * 0.07, cy); g.lineTo(cx - t * 0.1, cy - t * 0.16);
				g.moveTo(cx, cy); g.lineTo(cx, cy - t * 0.2);
				g.moveTo(cx + t * 0.07, cy); g.lineTo(cx + t * 0.1, cy - t * 0.16);
				g.stroke();
			}
			break;
		case 2: // woods: overlapping crowns
			g.fillStyle = hsl(FOREST, -6 + n * 3); g.fillRect(px, py, t, t);
			for (let k = 0; k < 3; k++) {
				const cx = px + t * (0.28 + 0.44 * hash(i, k)), cy = py + t * (0.28 + 0.44 * hash(i, k + 5)), r = t * (0.24 + 0.08 * hash(i, k + 2));
				g.fillStyle = hsl(FOREST, -2); g.beginPath(); g.arc(cx, cy, r, 0, TAU); g.fill();
				g.fillStyle = hsl(FOREST, 6); g.beginPath(); g.arc(cx - r * 0.25, cy - r * 0.3, r * 0.55, 0, TAU); g.fill();
			}
			break;
		case 3: { // hill: a mound with contour lines
			grass();
			const cx = px + t / 2, cy = py + t / 2, gr = g.createRadialGradient(cx - t * 0.15, cy - t * 0.18, t * 0.05, cx, cy, t * 0.62);
			gr.addColorStop(0, hsl(HILL, 12)); gr.addColorStop(1, hsl(HILL, -6));
			g.fillStyle = gr; roundRect(g, px + t * 0.04, py + t * 0.04, t * 0.92, t * 0.92, t * 0.38); g.fill();
			g.strokeStyle = hsl(HILL, -16); g.lineWidth = Math.max(1, t * 0.04);
			g.beginPath(); g.ellipse(cx, cy + t * 0.04, t * 0.3, t * 0.22, 0, 0, TAU); g.stroke();
			g.beginPath(); g.ellipse(cx, cy, t * 0.14, t * 0.1, 0, 0, TAU); g.stroke();
			break;
		}
		case 4: { // rocks
			grass();
			const cx = px + t / 2, cy = py + t / 2, r = t * 0.42;
			g.fillStyle = '#5d636c';
			g.beginPath();
			for (let k = 0; k < 7; k++) { const a = (k / 7) * TAU + hash(i, 3), rr = r * (0.78 + 0.25 * hash(i, k + 11)); g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * 0.9); }
			g.closePath(); g.fill();
			g.fillStyle = '#8a9099';
			g.beginPath();
			for (let k = 0; k < 7; k++) { const a = (k / 7) * TAU + hash(i, 3), rr = r * (0.62 + 0.2 * hash(i, k + 11)); g.lineTo(cx - t * 0.05 + Math.cos(a) * rr, cy - t * 0.07 + Math.sin(a) * rr * 0.85); }
			g.closePath(); g.fill();
			break;
		}
		case 5: case 6: case 7: { // water, bridge, ford
			g.fillStyle = v === 7 ? '#8fc6e6' : '#5aa5d8'; g.fillRect(px, py, t, t);
			g.strokeStyle = v === 7 ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.3)'; g.lineWidth = Math.max(1, t * 0.04);
			for (let k = 0; k < 2; k++) {
				const yy = py + t * (0.3 + 0.4 * k + 0.08 * n), xx = px + t * (0.15 + 0.2 * hash(i, k));
				g.beginPath(); g.moveTo(xx, yy); g.quadraticCurveTo(xx + t * 0.12, yy - t * 0.06, xx + t * 0.24, yy); g.quadraticCurveTo(xx + t * 0.36, yy + t * 0.06, xx + t * 0.48, yy); g.stroke();
			}
			if (v === 7) { // stepping stones
				g.fillStyle = '#d4dde3';
				for (let k = 0; k < 3; k++) { g.beginPath(); g.ellipse(px + t * (0.25 + 0.25 * k), py + t * (0.5 + 0.12 * (hash(i, k) - 0.5)), t * 0.1, t * 0.07, 0, 0, TAU); g.fill(); }
			}
			if (v === 6) { // planks across the line of travel
				const along = waterBeside(s, x, y) ? 'y' : 'x', vertical = (along === 'y') === !wide;
				g.fillStyle = '#b8895a'; g.strokeStyle = '#7f5a37'; g.lineWidth = Math.max(1, t * 0.04);
				if (vertical) { g.fillRect(px + t * 0.14, py, t * 0.72, t); for (let k = 1; k < 5; k++) { g.beginPath(); g.moveTo(px + t * 0.14, py + (k * t) / 5); g.lineTo(px + t * 0.86, py + (k * t) / 5); g.stroke(); } }
				else { g.fillRect(px, py + t * 0.14, t, t * 0.72); for (let k = 1; k < 5; k++) { g.beginPath(); g.moveTo(px + (k * t) / 5, py + t * 0.14); g.lineTo(px + (k * t) / 5, py + t * 0.86); g.stroke(); } }
			}
			break;
		}
	}
}
// Whether the water runs past a bridge on its left and right (so it is crossed going up and down).
function waterBeside(s, x, y) {
	const w = (xx) => R.inside(s, xx, y) && [5, 7].includes(s.tiles[y * s.W + xx]);
	return w(x - 1) || w(x + 1);
}
function unknownTile(g, i, px, py, t) {
	g.fillStyle = COLOR.unknown; g.fillRect(px, py, t, t);
	g.strokeStyle = COLOR.unknownLine; g.lineWidth = 1;
	g.beginPath(); g.moveTo(px, py + t); g.lineTo(px + t, py); g.stroke();
	if (hash(i) > 0.8) { g.fillStyle = '#2a3442'; g.beginPath(); g.arc(px + t * 0.5, py + t * 0.5, t * 0.06, 0, TAU); g.fill(); }
}

// ---- Small drawing helpers ------------------------------------------------------------------------------------
function label(g, text, x, y, size, color) {
	g.save();
	g.font = `700 ${size}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
	g.textAlign = 'center'; g.textBaseline = 'middle';
	g.lineWidth = Math.max(3, size * 0.28); g.strokeStyle = 'rgba(15,20,30,0.85)'; g.lineJoin = 'round';
	g.strokeText(text, x, y); g.fillStyle = color; g.fillText(text, x, y);
	g.restore();
}
function roundRect(g, x, y, w, h, r) {
	g.beginPath();
	g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
	g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}

// A small picture of a map for the new-game screen (all of it: the halves are the same ground).
export function preview(canvas, map) {
	const t = Math.max(3, Math.floor(Math.min(canvas.width / map.W, canvas.height / map.H)));
	const g = canvas.getContext('2d');
	canvas.width = map.W * t; canvas.height = map.H * t;
	const col = ['#8cc47a', '#7fb56a', '#3f7a43', '#c9b37c', '#6d737c', '#5aa5d8', '#b8895a', '#8fc6e6'];
	for (let y = 0; y < map.H; y++) for (let x = 0; x < map.W; x++) { g.fillStyle = col[map.tiles[y * map.W + x]]; g.fillRect(x * t, y * t, t, t); }
	for (const [team, c] of [['blue', COLOR.blue], ['red', COLOR.red]]) {
		const f = map.flags[team];
		g.fillStyle = c; g.fillRect((f.x - 1) * t, (f.y - 1) * t, t * 3, t * 3);
		g.fillStyle = '#fff'; g.fillRect(f.x * t + t * 0.25, f.y * t + t * 0.25, t * 0.5, t * 0.5);
	}
	for (const [team, c] of [['blue', '#bcd0ff'], ['red', '#ffc2bb']]) for (const p of map.starts[team]) { g.fillStyle = c; g.fillRect(p.x * t + 1, p.y * t + 1, t - 2, t - 2); }
}

// The ground painter, for the map editor too.
export { tile as paintTile };
