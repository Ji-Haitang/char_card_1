//#region scene3d/src/render-defaults.js
var DEFAULT_PAPER_COLOR = "#f6f0e0";
var NIGHT_PAPER_COLOR = "#101c32";
var SUBSCENE_TILT_SHIFT = 1.5;
var RENDER_DEFAULTS = Object.freeze({
	tiltShift: 2,
	dofSharp: 4.5,
	dofBlur: 1.5,
	bloom: 1,
	shaftStrength: .85,
	saturation: 1.4,
	contrast: 1.4,
	gamma: .88,
	warmth: .38,
	vignette: .85,
	hazeStrength: .6
});
function calculateDofRanges(sharp, zoom, sceneScale = 1) {
	if (!Number.isFinite(sharp) || sharp < 0 || !Number.isFinite(zoom) || !Number.isFinite(sceneScale) || sceneScale <= 0) throw new TypeError("DOF requires finite sharp/zoom and a positive scene scale");
	const scale = sceneScale / Math.sqrt(Math.max(.1, zoom));
	return {
		sharpRange: sharp * scale,
		falloff: 22 * scale
	};
}
//#endregion
export { calculateDofRanges as a, SUBSCENE_TILT_SHIFT as i, NIGHT_PAPER_COLOR as n, RENDER_DEFAULTS as r, DEFAULT_PAPER_COLOR as t };
