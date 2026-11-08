// Hide & Seize: the maps a browser knows. The built-in ones come from maps/ (listed in index.json);
// the player's own live in localStorage, written by the map editor. Shared by the game and the editor.
import { MAPS, addMap, parseMap, checkMap } from './maps.js';

export const MY_MAPS = 'hide-and-seize-maps-v1';

// Fetch the built-in maps (once). A file that fails to load or check is skipped, not fatal.
let loaded = null;
export function loadBuiltIn() {
	loaded ||= (async () => {
		const index = await (await fetch('maps/index.json')).json();
		const files = await Promise.all((index.maps || []).map((f) => fetch(`maps/${f}`).then((r) => r.text()).catch(() => '')));
		for (const text of files) {
			const { def, errors } = parseMap(text);
			if (def && !errors.length && !checkMap(def).errors.length) addMap({ ...def, builtIn: true });
		}
		if (!MAPS.length) throw new Error('No maps could be loaded');
	})();
	return loaded;
}

// The player's own maps, from localStorage; anything that doesn't check out is left out.
export function myMaps() {
	let list = [];
	try { const o = JSON.parse(localStorage.getItem(MY_MAPS)); if (o && Array.isArray(o.maps)) list = o.maps; } catch (e) { /* none, or unreadable */ }
	return list.map((o) => {
		const { def, errors } = parseMap({ ...o.file, id: o.id });
		return def && !errors.length ? { ...def, id: o.id, mine: true, saved: typeof o.saved === 'string' ? o.saved : '', playable: !checkMap(def).errors.length } : null;
	}).filter(Boolean);
}
function writeMine(list) {
	try { localStorage.setItem(MY_MAPS, JSON.stringify({ maps: list })); return true; } catch (e) { return false; }
}
// Save (or replace) one of the player's maps. Returns false if the browser wouldn't store it.
export function saveMine(def, file) {
	const raw = rawMine().filter((o) => o.id !== def.id);
	raw.push({ id: def.id, saved: new Date().toISOString(), file });
	return writeMine(raw);
}
export function deleteMine(id) { return writeMine(rawMine().filter((o) => o.id !== id)); }
function rawMine() {
	try { const o = JSON.parse(localStorage.getItem(MY_MAPS)); return o && Array.isArray(o.maps) ? o.maps.filter((m) => m && typeof m.id === 'string') : []; } catch (e) { return []; }
}
// Put the player's playable maps alongside the built-in ones in MAPS (after loadBuiltIn).
export function addMine() {
	for (let i = MAPS.length - 1; i >= 0; i--) if (MAPS[i].mine) MAPS.splice(i, 1);
	for (const d of myMaps()) if (d.playable) addMap(d);
}
