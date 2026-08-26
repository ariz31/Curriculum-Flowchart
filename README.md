# Curriculum Flowchart Maker

A Vercel-ready curriculum editor built with TypeScript, HTML, and CSS. The app combines an editable curriculum table with a draggable prerequisite/corequisite flowchart.

## Included sample

The initial dataset is transcribed from the **Curriculum Map Generator** Google Sheet used for the project. Its original `Co/Prerequisite` column is normalized during sample creation:

- references to courses in earlier terms become **prerequisites**;
- references to courses in the same term become **corequisites**;
- non-course requirements such as year-standing requirements are preserved under **Other requirements**.

This heuristic is only used to seed the sample. In the table editor, prerequisite, corequisite, elective-prerequisite, and other-requirement fields are independently editable.

## Features

- Spreadsheet-style curriculum table editor
- Mobile card-style table editing below tablet widths
- Add, edit, locate, and delete courses
- Course-code reference updates when a code is renamed
- Automatic year/semester flowchart generation
- **Auto sort** with repeated topology-aware ordering and chain alignment
- Fixed horizontal semester-column spacing during optimization
- Non-uniform **vertical** spacing that expands only where routing clearance is needed
- Straight horizontal prerequisite chains whenever geometry permits
- Separate vertical lanes for adjacent-semester relationships
- Dedicated horizontal corridors for long prerequisite links
- Corequisite pairs treated as compound layout units
- Corequisites rendered as a vertical **double-line two-way arrow** from the upper course bottom-center to the lower course top-center
- If both members of a corequisite pair are prerequisites of a later course, the redundant pair of prerequisite lines is collapsed into one prerequisite branch from the shared corequisite connector
- Corequisite partners move together so the vertical corequisite geometry is preserved during manual editing
- Optimized routing remains active and is recomputed after manual node movement instead of falling back to generic arrows
- Individually draggable course boxes
- One base color family per year level
- Distinct shades within each year for First Semester, Second Semester, and Short Term
- Shift/Ctrl/Cmd multi-selection on desktop
- Dedicated touch-friendly Multi-select mode on mobile
- Align left/center/right/top/middle/bottom
- Horizontal and vertical distribution
- Align selected nodes back to their term columns
- Optional 10 px snap-to-grid
- Orthogonal prerequisite routing
- Distinct prerequisite and elective-prerequisite line styles
- One-finger canvas panning on empty space
- Two-finger pinch-to-zoom around the gesture focal point
- Trackpad pinch / Ctrl-wheel zoom and wheel/trackpad panning
- Zoom in, zoom out, Fit, and 100% reset controls
- Zoom range from 15% to 250%
- Zoom-aware node dragging so movement remains correct at every scale
- Keyboard arrow movement for selected nodes as a non-drag alternative
- **Download PNG** export of the complete curriculum map independent of the current zoom/pan viewport
- Local browser persistence for curriculum data, node positions, zoom, pan state, and optimized/basic layout mode
- Responsive touch targets and horizontally scrollable tool groups on small screens

## Auto-sort behavior

The optimizer keeps semester columns at their normal horizontal positions. Corequisite-connected courses are first grouped into compound units so no unrelated course is inserted between the members of a corequisite pair.

The layout then performs repeated barycentric ordering passes to reduce crossings, followed by weighted center alignment. Direct prerequisite chains receive stronger alignment weight, so courses such as `A -> B -> C` are placed on the same horizontal path whenever there is enough room to do so.

Vertical spacing is not a global row multiplier. After alignment, the optimizer measures routing demand between vertical levels and expands only the boundaries that need additional tracks. Unused boundaries remain compact. Long relationships search for clear horizontal corridors that do not intersect unrelated course boxes, while adjacent-semester edges receive separate vertical lanes.

The optimizer strongly reduces avoidable line overlaps and node intersections. Arbitrary curriculum graphs can still contain topological crossings that cannot be eliminated without changing the graph itself, but the solver prefers straight, non-overlapping, individually traceable paths before compactness.

### Corequisite propagation

A same-term corequisite pair is rendered vertically using two parallel lines with opposite arrow directions. The connector is attached only to the bottom-center of the upper course and the top-center of the lower course.

When a later course lists **both** members of that pair as prerequisites, the two redundant prerequisite edges are collapsed into a single outgoing prerequisite branch from the shared corequisite line. Multiple downstream courses receive distinct branch points along that connector when space allows.

### Moving nodes after Auto Sort

Auto Sort is now a persistent layout mode. Moving, aligning, or keyboard-nudging an optimized node recomputes the optimized routing plan against the new coordinates instead of invalidating the plan and reverting to generic midpoint arrows. Corequisite partners are moved as a group so their required vertical connection remains valid.

## Image export

Use **Download PNG** from the flowchart toolbar to export the complete curriculum diagram. The export includes year headers, semester shades, course boxes, prerequisite/elective connectors, double-line corequisite arrows, propagated prerequisite branches, and the optimized routing geometry. Export is generated from curriculum coordinates, so it is not cropped to the currently visible mobile/desktop viewport.

## Mobile interaction

- **Tap a course** to select it.
- **Drag a course** with one finger to move it.
- **Drag empty canvas space** with one finger to pan.
- **Pinch with two fingers** to zoom and pan around the pinch focal point.
- Enable **Multi-select** to tap several courses without needing desktop modifier keys.
- Alignment and distribution tools apply to the current selection.
- Use **Fit** to frame the complete curriculum, or **100%** to restore the default viewport.

## Color system

The flowchart uses two visual dimensions:

- **Hue = year level**
- **Shade = semester / term**

Each year retains its own main color family, while First Semester uses the strongest shade, Second Semester a lighter shade, and Short Term the lightest shade. The same rule is applied to term headers and course boxes.

## Development

```bash
npm install
npm run typecheck
npm run build
```

The production build is emitted to `dist/`.

## Vercel

`vercel.json` configures Vercel to run `npm run build` and publish `dist/`. No backend or environment variables are required for the current local-first version.
