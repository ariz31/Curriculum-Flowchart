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
- **Auto sort** that reorders courses within semester columns to reduce connector crossings
- Fixed horizontal semester-column spacing during optimization
- Dynamic **vertical** spacing between course rows to create dedicated routing tracks
- Separate connector lanes for adjacent-semester relationships
- Dedicated horizontal routing tracks for long prerequisite links so they can pass between course rows rather than through course boxes
- Individually draggable course boxes after optimization
- One base color family per year level
- Distinct shades within each year for First Semester, Second Semester, and Short Term
- Shift/Ctrl/Cmd multi-selection on desktop
- Dedicated touch-friendly Multi-select mode on mobile
- Align left/center/right/top/middle/bottom
- Horizontal and vertical distribution
- Align selected nodes back to their term columns
- Optional 10 px snap-to-grid
- Orthogonal prerequisite routing
- Distinct prerequisite, elective-prerequisite, and corequisite line styles
- One-finger canvas panning on empty space
- Two-finger pinch-to-zoom around the gesture focal point
- Trackpad pinch / Ctrl-wheel zoom and wheel/trackpad panning
- Zoom in, zoom out, Fit, and 100% reset controls
- Zoom range from 15% to 250%
- Zoom-aware node dragging so movement remains correct at every scale
- Keyboard arrow movement for selected nodes as a non-drag alternative
- **Download PNG** export of the complete curriculum map independent of the current zoom/pan viewport
- Local browser persistence for curriculum data, node positions, zoom, and pan state
- Responsive touch targets and horizontally scrollable tool groups on small screens

## Auto-sort behavior

The optimizer keeps the semester columns at their normal horizontal locations. It then uses repeated barycentric sweeps to reorder courses vertically according to their prerequisite relationships. This reduces graph crossings without changing the curriculum's year/semester structure.

For relationships that span multiple semester columns, the optimizer assigns horizontal routing tracks in the empty space **between course rows**. The vertical gap after a row grows according to the number of tracks that need that corridor. This is intentional: readability and line traceability take priority over minimizing the total height of the diagram.

Adjacent-semester connections use separate vertical lanes in the normal space between the two semester columns. Course connection ports are also offset when a course has several incident links so that multiple lines do not begin on exactly the same segment.

The optimizer strongly reduces avoidable line overlaps and node intersections, but arbitrary curriculum graphs can still contain topological crossings that cannot be eliminated without changing the graph itself. Manual dragging and alignment remain available after optimization.

## Image export

Use **Download PNG** from the flowchart toolbar to export the complete curriculum diagram. The export includes year headers, semester shades, course boxes, prerequisite/elective/corequisite connectors, and the optimized routing geometry. Export is generated from curriculum coordinates, so it is not cropped to the currently visible mobile/desktop viewport.

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
