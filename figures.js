// Hide & Seize: the players, drawn as little figures standing on their squares, each role with its
// own kit: the Scout's ranger hat and binoculars, the Runner's headband, the Shadow's hood and cloak,
// the Hunter's cap and net, the Guard's helmet and shield. Drawn in a unit box (feet at 0, the top of
// the head at about −1), scaled to the size asked for.
export const SKIN = ['#f3cfae', '#e3b08a', '#c98e62', '#9c6842', '#6b4429'];
export const HAIR = ['#2a1d15', '#5b3a22', '#8b5a2b', '#d9b25e', '#a5432b', '#151515', '#c8c8c8'];
export const KIT = { blue: { main: '#2f6be0', dark: '#1d4aa8', light: '#8db0ff' }, red: { main: '#dd4339', dark: '#a3271f', light: '#ff9a90' } };
const PANTS = '#2b3142', SHOE = '#191d26', TAU = Math.PI * 2;

// Feet at (x, y), h pixels tall. o: { role, team, skin, hair, facing (1 right, −1 left),
// pose: 'stand' | 'walk' | 'sneak' | 'hide', phase (0–1 through a stride), flag (colour of a carried
// flag's team, or null), winded (count), time (ms, for the stars), alpha, shadow (default true),
// wading (stands in water: the legs are under it), soaked (drips) }.
export function drawFigure(g, x, y, h, o) {
	const C = KIT[o.team], skin = SKIN[o.skin ?? 0], hair = HAIR[o.hair ?? 0], pose = o.pose || 'stand';
	g.save();
	g.translate(x, y);
	g.globalAlpha *= o.alpha ?? 1;
	if (o.shadow !== false && !o.wading) { g.fillStyle = 'rgba(0,0,0,0.28)'; g.beginPath(); g.ellipse(0, 0, h * 0.25, h * 0.075, 0, 0, TAU); g.fill(); }
	g.scale(h, h);
	if ((o.facing ?? 1) < 0) g.scale(-1, 1);
	const walk = pose === 'walk', low = pose === 'sneak' ? 0.84 : pose === 'hide' ? 0.7 : 1;
	const stride = walk ? Math.sin((o.phase || 0) * TAU) : 0;
	g.translate(0, walk ? -Math.abs(stride) * 0.03 : 0);
	g.save();
	g.scale(1, low);
	if (low < 1) g.transform(1, 0, -0.2, 1, 0, 0); // a crouch leans forward
	g.lineCap = 'round'; g.lineJoin = 'round';
	const wide = o.role === 'guard' ? 0.19 : o.role === 'runner' ? 0.135 : 0.16;

	// Shadow's cloak hangs behind everything.
	if (o.role === 'shadow') {
		g.fillStyle = C.dark;
		g.beginPath(); g.moveTo(-0.15, -0.7); g.lineTo(0.12, -0.7); g.lineTo(0.2, -0.16); g.quadraticCurveTo(0, -0.1, -0.24, -0.14); g.closePath(); g.fill();
	}
	// Legs, swinging when walking.
	const legSwing = walk ? stride * 0.1 : pose === 'sneak' ? 0.06 : 0;
	for (const [lx, sw] of [[-0.055, legSwing], [0.055, -legSwing]]) {
		g.strokeStyle = PANTS; g.lineWidth = 0.085;
		g.beginPath(); g.moveTo(lx, -0.36); g.lineTo(lx + sw, -0.05); g.stroke();
		g.fillStyle = o.role === 'runner' ? '#f2f4f8' : SHOE;
		g.beginPath(); g.ellipse(lx + sw + 0.025, -0.03, 0.058, 0.032, 0, 0, TAU); g.fill();
	}
	// The back arm, then the body, then the front arm.
	const armSwing = walk ? -stride * 0.08 : pose === 'sneak' ? 0.08 : 0;
	arm(g, -0.12, -armSwing, C.dark, skin);
	g.fillStyle = C.main;
	round(g, -wide, -0.73, wide * 2, 0.4, 0.085); g.fill();
	g.fillStyle = C.dark; g.fillRect(-wide, -0.39, wide * 2, 0.045); // belt
	torsoKit(g, o.role, C, wide);
	if (o.role !== 'guard') arm(g, 0.12, armSwing, C.main, skin);
	// Head.
	g.fillStyle = skin; g.fillRect(-0.035, -0.75, 0.07, 0.05);
	g.beginPath(); g.arc(0, -0.85, 0.135, 0, TAU); g.fill();
	headKit(g, o.role, C, skin, hair);
	// Kit held in the front hand, drawn over the body.
	if (o.role === 'guard') { arm(g, 0.12, armSwing, C.main, skin); shield(g, C); }
	if (o.role === 'hunter') net(g, armSwing);
	if (o.flag) carried(g, o.role === 'guard' || o.role === 'hunter' ? -1 : 1, o.flag, o.time || 0);
	g.restore();
	if (o.wading) wade(g);
	if (pose === 'hide') bush(g);
	if (o.soaked) drips(g, low);
	if (o.winded) stars(g, o.winded, o.time || 0, low);
	g.restore();
}

// Water to the knees: the legs disappear under a surface with a ring of ripples round them.
function wade(g) {
	g.fillStyle = '#5aa5d8'; // (the water square's own colour)
	g.beginPath(); g.moveTo(-0.34, -0.2); g.quadraticCurveTo(0, -0.27, 0.34, -0.2); g.lineTo(0.34, 0.06); g.lineTo(-0.34, 0.06); g.closePath(); g.fill();
	g.strokeStyle = 'rgba(255,255,255,0.75)'; g.lineWidth = 0.028;
	g.beginPath(); g.ellipse(0, -0.21, 0.24, 0.045, 0, 0, TAU); g.stroke();
	g.strokeStyle = 'rgba(255,255,255,0.4)';
	g.beginPath(); g.ellipse(0, -0.19, 0.32, 0.065, 0, 0.15 * Math.PI, 0.85 * Math.PI); g.stroke();
}
// Soaked: drops falling from the head and hands.
function drips(g, low) {
	g.fillStyle = '#7fbfff'; g.strokeStyle = 'rgba(20,50,90,0.55)'; g.lineWidth = 0.012;
	for (const [x, y, r] of [[-0.2, -0.86, 0.04], [0.21, -0.7, 0.034], [-0.17, -0.5, 0.03]]) {
		const yy = y * low;
		g.beginPath(); g.moveTo(x, yy - r * 1.9); g.quadraticCurveTo(x + r * 1.1, yy - r * 0.2, x, yy + r); g.quadraticCurveTo(x - r * 1.1, yy - r * 0.2, x, yy - r * 1.9); g.fill(); g.stroke();
	}
}
function arm(g, sx, swing, color, skin) {
	const hx = sx * 1.4 + swing, hy = -0.45;
	g.strokeStyle = color; g.lineWidth = 0.07;
	g.beginPath(); g.moveTo(sx, -0.67); g.lineTo(hx, hy); g.stroke();
	g.fillStyle = skin; g.beginPath(); g.arc(hx, hy, 0.037, 0, TAU); g.fill();
}
function round(g, x, y, w, h, r) {
	g.beginPath();
	g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
	g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
function eyes(g, color = '#1b1b22', r = 0.02) {
	g.fillStyle = color;
	for (const ex of [0.03, 0.09]) { g.beginPath(); g.arc(ex, -0.855, r, 0, TAU); g.fill(); }
}
function hairCap(g, hair) {
	g.fillStyle = hair;
	g.beginPath(); g.arc(0, -0.86, 0.14, Math.PI * 1.02, Math.PI * 2.02); g.lineTo(-0.135, -0.83); g.closePath(); g.fill();
	g.beginPath(); g.arc(-0.1, -0.83, 0.06, 0, TAU); g.fill(); // the back of the head
}

function torsoKit(g, role, C, wide) {
	if (role === 'scout') { // binoculars on a strap
		g.strokeStyle = '#3a2c1f'; g.lineWidth = 0.02;
		g.beginPath(); g.moveTo(-0.07, -0.72); g.lineTo(0.02, -0.6); g.lineTo(0.1, -0.72); g.stroke();
		g.fillStyle = '#26282e';
		for (const bx of [0, 0.075]) { g.beginPath(); g.arc(bx, -0.58, 0.036, 0, TAU); g.fill(); }
		g.fillStyle = '#7fb0d8';
		for (const bx of [0, 0.075]) { g.beginPath(); g.arc(bx + 0.01, -0.585, 0.014, 0, TAU); g.fill(); }
	} else if (role === 'runner') { // a racing stripe and a number patch
		g.fillStyle = '#fff'; g.fillRect(-0.03, -0.73, 0.028, 0.34);
		g.fillStyle = 'rgba(255,255,255,0.9)'; round(g, 0.02, -0.64, 0.09, 0.09, 0.015); g.fill();
		g.fillStyle = C.dark; g.fillRect(0.058, -0.625, 0.016, 0.06);
	} else if (role === 'hunter') { // a satchel strap across the chest
		g.strokeStyle = '#7a5531'; g.lineWidth = 0.045;
		g.beginPath(); g.moveTo(-wide + 0.02, -0.71); g.lineTo(wide - 0.02, -0.42); g.stroke();
	} else if (role === 'guard') { // shoulder pads
		g.fillStyle = '#9aa5b2';
		g.beginPath(); g.ellipse(-wide + 0.02, -0.69, 0.07, 0.04, 0, 0, TAU); g.fill();
	} else if (role === 'shadow') { // the cloak's clasp
		g.fillStyle = '#d6c37a'; g.beginPath(); g.arc(0.02, -0.7, 0.022, 0, TAU); g.fill();
	}
}

function headKit(g, role, C, skin, hair) {
	if (role === 'scout') { // ranger hat
		hairCap(g, hair); eyes(g);
		g.fillStyle = '#9c7d42'; g.beginPath(); g.ellipse(0.01, -0.95, 0.22, 0.045, 0, 0, TAU); g.fill();
		g.fillStyle = '#b8964f'; round(g, -0.1, -1.07, 0.21, 0.13, 0.05); g.fill();
		g.fillStyle = '#5d4826'; g.fillRect(-0.1, -0.985, 0.21, 0.03);
	} else if (role === 'runner') { // spiky hair and a headband with tails
		g.fillStyle = hair;
		g.beginPath(); g.moveTo(-0.14, -0.86);
		for (let k = 0; k <= 5; k++) { const a = Math.PI * (1.05 + k * 0.19); g.lineTo(Math.cos(a) * 0.17, -0.86 + Math.sin(a) * 0.17); g.lineTo(Math.cos(a + 0.3) * 0.12, -0.86 + Math.sin(a + 0.3) * 0.12); }
		g.closePath(); g.fill();
		eyes(g);
		g.fillStyle = '#fff'; g.fillRect(-0.135, -0.935, 0.27, 0.045);
		g.strokeStyle = '#fff'; g.lineWidth = 0.03;
		g.beginPath(); g.moveTo(-0.13, -0.915); g.lineTo(-0.24, -0.88); g.moveTo(-0.13, -0.915); g.lineTo(-0.23, -0.95); g.stroke();
	} else if (role === 'shadow') { // a hood with the face in shade and bright eyes
		g.fillStyle = C.dark;
		g.beginPath(); g.arc(-0.01, -0.86, 0.175, 0, TAU); g.fill();
		g.beginPath(); g.moveTo(-0.17, -0.82); g.lineTo(-0.2, -0.7); g.lineTo(0.12, -0.7); g.closePath(); g.fill();
		g.fillStyle = shade(skin, 0.45); g.beginPath(); g.ellipse(0.04, -0.85, 0.095, 0.11, 0, 0, TAU); g.fill();
		g.fillStyle = '#20232c'; g.fillRect(0, -0.83, 0.135, 0.06); // a mask over mouth and nose
		eyes(g, '#fff6c8', 0.022);
	} else if (role === 'hunter') { // a cap with its peak forward
		hairCap(g, hair); eyes(g);
		g.fillStyle = C.main; g.beginPath(); g.arc(0, -0.88, 0.145, Math.PI, TAU); g.closePath(); g.fill();
		g.fillStyle = C.dark; g.beginPath(); g.ellipse(0.13, -0.885, 0.11, 0.028, 0, 0, TAU); g.fill();
		g.fillStyle = '#fff'; g.beginPath(); g.arc(0, -1.02, 0.025, 0, TAU); g.fill();
	} else if (role === 'guard') { // a helmet with a crest and a cheek guard
		eyes(g);
		g.fillStyle = '#a9b3bf'; g.beginPath(); g.arc(0, -0.87, 0.155, Math.PI * 0.95, Math.PI * 2.05); g.closePath(); g.fill();
		g.fillStyle = '#c9d1da'; g.beginPath(); g.arc(-0.03, -0.92, 0.07, Math.PI * 1.1, Math.PI * 1.7); g.lineTo(-0.03, -0.92); g.fill();
		g.fillStyle = '#8b96a3'; g.fillRect(-0.15, -0.88, 0.07, 0.11);
		g.fillStyle = C.main; round(g, -0.04, -1.07, 0.08, 0.08, 0.03); g.fill();
	}
}
function shield(g, C) {
	g.save();
	g.translate(0.2, -0.56);
	g.fillStyle = C.main; g.strokeStyle = '#fff'; g.lineWidth = 0.03;
	g.beginPath(); g.moveTo(-0.1, -0.15); g.lineTo(0.1, -0.15); g.lineTo(0.1, 0.03); g.quadraticCurveTo(0.08, 0.16, 0, 0.2); g.quadraticCurveTo(-0.08, 0.16, -0.1, 0.03); g.closePath();
	g.fill(); g.stroke();
	g.strokeStyle = '#fff'; g.lineWidth = 0.035;
	g.beginPath(); g.moveTo(0, -0.1); g.lineTo(0, 0.13); g.moveTo(-0.065, -0.02); g.lineTo(0.065, -0.02); g.stroke();
	g.restore();
}
function net(g, swing) {
	const hx = 0.17 + swing, hy = -0.45;
	g.strokeStyle = '#7a5531'; g.lineWidth = 0.03;
	g.beginPath(); g.moveTo(hx - 0.03, hy + 0.08); g.lineTo(hx + 0.11, -0.98); g.stroke();
	g.strokeStyle = '#e8e2d2'; g.lineWidth = 0.018;
	g.beginPath(); g.ellipse(hx + 0.13, -1.05, 0.09, 0.075, 0.3, 0, TAU); g.stroke();
	g.beginPath(); g.moveTo(hx + 0.06, -1.07); g.lineTo(hx + 0.2, -1.03); g.moveTo(hx + 0.13, -1.12); g.lineTo(hx + 0.12, -0.98); g.stroke();
}
function carried(g, side, team, time) {
	const hx = 0.17 * side, top = -1.3, wave = Math.sin(time / 220) * 0.03;
	g.strokeStyle = '#4b3a2a'; g.lineWidth = 0.03;
	g.beginPath(); g.moveTo(hx, -0.4); g.lineTo(hx + 0.03 * side, top); g.stroke();
	g.fillStyle = KIT[team].main; g.strokeStyle = '#fff'; g.lineWidth = 0.02;
	g.beginPath(); g.moveTo(hx + 0.03 * side, top); g.quadraticCurveTo(hx + 0.18 * side, top + 0.03 + wave, hx + 0.3 * side, top + 0.08);
	g.quadraticCurveTo(hx + 0.18 * side, top + 0.13 - wave, hx + 0.03 * side, top + 0.18); g.closePath(); g.fill(); g.stroke();
}
function bush(g) {
	for (const [bx, by, r, c] of [[-0.13, -0.12, 0.14, '#4a8445'], [0.14, -0.11, 0.13, '#4a8445'], [0.01, -0.17, 0.16, '#57964f'], [-0.05, -0.24, 0.09, '#6aab61'], [0.09, -0.22, 0.08, '#6aab61']]) {
		g.fillStyle = c; g.beginPath(); g.arc(bx, by, r, 0, TAU); g.fill();
	}
}
function stars(g, n, time, low) {
	const cy = -0.85 * low - 0.2;
	for (let k = 0; k < Math.min(3, n + 1); k++) {
		const a = time / 260 + (k * TAU) / 3, sx = Math.cos(a) * 0.17, sy = cy + Math.sin(a) * 0.05;
		g.fillStyle = '#ffd34d'; g.strokeStyle = 'rgba(40,30,0,0.6)'; g.lineWidth = 0.012;
		g.beginPath();
		for (let p = 0; p < 10; p++) { const r = p % 2 ? 0.018 : 0.045, b = (p * Math.PI) / 5 - Math.PI / 2; g.lineTo(sx + Math.cos(b) * r, sy + Math.sin(b) * r); }
		g.closePath(); g.fill(); g.stroke();
	}
}
function shade(hex, k) {
	const v = [1, 3, 5].map((o) => Math.round(parseInt(hex.slice(o, o + 2), 16) * (1 - k)));
	return `rgb(${v.join(',')})`;
}

// A small portrait for the panel: the figure standing in a canvas of w×h CSS pixels.
export function portrait(canvas, u, w, h) {
	const d = Math.min(3, window.devicePixelRatio || 1);
	canvas.width = Math.round(w * d); canvas.height = Math.round(h * d);
	canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
	const g = canvas.getContext('2d');
	g.setTransform(d, 0, 0, d, 0, 0);
	g.clearRect(0, 0, w, h);
	drawFigure(g, w * 0.48, h * 0.97, h * 0.84, { ...u, facing: 1, pose: u.stance === 'hide' ? 'hide' : u.stance === 'sneak' ? 'sneak' : 'stand', flag: u.carrying ? (u.team === 'blue' ? 'red' : 'blue') : null, shadow: false, soaked: (u.wet || 0) > 0 });
}
