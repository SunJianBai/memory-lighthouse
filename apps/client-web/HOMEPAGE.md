# Public homepage refinement

Scope: public `/openBMB/` only. Retain the selected B family-archive identity, real routes, product name, existing brand icon and formal Chinese copy. No changes to authenticated workflows, permissions, Android or deployment. User requested a bolder layout and motion inspired by https://88api.ai/, with meaningful visual content rather than repeated feature prose.

## Direction contract

THESIS: An explorable family-care workspace, not a brochure. Demonstrate capabilities once in a full-width interactive exhibit, then explain setup and access.

OWN-WORLD: Existing pine-green and paper tokens; brand serif, readable sans; ruled record lists. A dark green functional index anchors an open paper workspace. No decorative gradients, metrics, testimonials or visual identity replacement.

STORY: Understand the product, explore labelled synthetic memories/voice/routines/call examples, learn binding, enter the family workspace or download Android. Default local answering and explicit permissions remain accurate.

FIRST VIEWPORT: Compact navigation, large brand title beside concise product purpose and primary entry. A full-width exhibit below occupies the main visual field: green feature index, large working example, supporting context. Mobile stacks the intro and places a two-column tab bar over the example. Targets: 1440x1000, 1280x900, 768x1024, 390x844, 320x740. Signature interaction is a sliding selection rail plus a short content handoff; the routine sample supports completion/undo. Motion starts from visible content, does not autoplay, and respects reduced motion. Binding is a geometric device-to-device diagram, not filler artwork.

FORM: User-pinned refinement, code-led, existing identity plus the reference's interactive preview and varied section pacing. No new direction roll; seed: none (user-pinned).

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## State and evidence plan

- Loading: auth restoration keeps public content available; entry control reports loading until status resolves.
- Empty/partial: no private data is fetched; all previews are authored synthetic examples, explicitly labelled.
- Error: no network-dependent preview actions; auth failures fall back to the existing anonymous entry. No invented service-status messages.
- Success: preview tab switch, sample completion/undo, FAQ expand/collapse and actual navigation links.
- Permission: previews never request microphone/camera or open a call. Actual permission rules remain on authenticated routes.
- Keyboard: roving tabs, arrow/Home/End keys, visible focus, native details and links. Verify narrow layouts, 200% text, reduced motion and no overflow.
- Reference evidence: local screenshots under ignored `tmp/homepage-refresh/`. Preserve global DESIGN.md and design.json; existing design.json staleness is outside scope.

## Local scale and delivery evidence

This homepage deliberately uses a 1280px reading frame, a larger fluid brand title (up to 5.5rem), a three-part functional exhibit and smaller typography inside the illustrative devices. These are route-local choices for the user's requested bolder layout, not new shared design tokens. Existing DESIGN.md and design.json remain unchanged. The one mechanical detector pass reported off-ramp font-size advisories; it was not a clean-detector claim. The pre-existing stale design.json index is recorded here and was not repaired.

Independent finish review: **ship**, no material findings. Reviewer inspected five viewport captures, 200% text, all four preview states on desktop/mobile, expanded FAQ, implementation and checks. The static review does not independently establish animation smoothness or actual model/device behavior.

Verified locally: 363 Web tests passed; production build passed (existing large media-chunk warning remains); 31 responsive/state checks had no horizontal overflow or runtime page errors; Arrow/Home/End focus and reduced-motion behavior passed. Sampled resting text contrast across 85 elements was at least 5.02:1. Image provenance scan found one raster with no missing provenance. Rendered evidence is local under `.impeccable/review/homepage/`, with a validated `evidence.json` record. The initial 200% tab overlap was fixed before the final review.

At the implementation handoff, the preview remained at `http://127.0.0.1:4311/openBMB/`; no commit, push or deployment had yet been performed. No authenticated workflow or Android changes are included. Live model sessions, device calling and an APK download/install were not exercised by this homepage-only work. A subsequent publication is authorized separately from this design task.

## Image provenance

Generated with the built-in imagegen tool, 2026-11-14. Fictional home-use scene, visibly labelled AI-generated, not a customer testimonial. Delivered asset: `public/images/home-family-companion.webp`, optimized to 1280px. Original retained under the local generated-images directory. The provenance tool stores the prompt in the accompanying `.webp.json` sidecar for this format; it is also reproduced below.

Use case: photorealistic-natural. Asset type: supporting editorial image for the Memory Lighthouse family-care application homepage, not a UI mockup. A natural candid photograph of an older Chinese woman and her adult daughter sitting together at a light oak dining table in a modest contemporary Chinese home, calmly setting up a tablet on a small stand. Both people looking at the tablet, relaxed and focused, not posing for the camera. The tablet is viewed from its back or side so no invented interface or text is visible. Soft window daylight, linen curtains, a small green plant, muted pine-green clothing and warm cream surroundings. Authentic skin texture and age, realistic hands, understated editorial photography rather than glossy stock advertising. Medium-wide horizontal 3:2 composition, show the people, their hands and the tablet clearly, uncluttered background, no text, no logos, no watermark, no medical equipment, no science-fiction effects. This is an illustrative fictional scene, not a real customer testimonial.
