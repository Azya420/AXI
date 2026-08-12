// Style prompt used when turning a customer's photo into an AXI preview render.
//
// This is a first draft, not a final answer - it needs to be refined by testing
// against real generations and comparing the result to actual AXI preview
// models (see lewmodelpog.png in the repo root for a reference of the target
// look: an unpainted grey resin miniature, studio-lit, on a round textured
// base). Edit PREVIEW_STYLE_PROMPT and redeploy to iterate.

const PREVIEW_STYLE_PROMPT = `
Transform the uploaded reference photo into a single studio-lit product render
of an unpainted 3D-printed resin tabletop miniature figurine based on the
subject in the photo, in the following exact style:

- Uniform light grey / off-white unpainted resin material, matte surface,
  no color, no paint, subtle visible layer texture consistent with resin
  printing (not plastic-toy smooth, not stone).
- The subject sculpted as a miniature in dynamic RPG/tabletop-game pose,
  keeping the pose, outfit, proportions, and key silhouette details of the
  reference photo, but reinterpreted as a heroic miniature sculpt.
- Standing on a round textured display base (cracked stone / dungeon-tile
  pattern), consistent with 28-32mm tabletop miniature bases.
- Soft three-point studio lighting on a plain dark neutral background,
  gentle shadow beneath the base, no color cast, no scene/environment.
- Single character, centered, full body visible from a 3/4 front angle,
  camera at chest height.
- Photoreal render quality (not a cartoon, not a sketch, not a 3D-engine
  screenshot) - like a professional photo of a real physical resin print.

Do not add color, paint, background scenery, additional characters, text, or
watermarks. The output must look like an unpainted preview render used to
show a customer what their commissioned miniature will look like before
printing.
`.trim();

module.exports = { PREVIEW_STYLE_PROMPT };
