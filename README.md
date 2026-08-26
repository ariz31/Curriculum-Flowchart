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
- Distinct prerequisite, elective-prerequisite, and corequisite line styles
- One-finger canvas panning on empty space
- Two-finger pinch-to-zoom around the gesture focal point
- Trackpad pinch / Ctrl-wheel zoom and wheel/trackpad panning
- Zoom in, zoom out, Fit, and 100% reset controls
- Zoom range from 15% to 250%
- Zoom-aware node dragging so movement remains correct at every scale
- Keyboard arrow movement for selected nodes as a non-drag alternative
- Local browser persistence for curriculum data, node positions, zoom, and pan state
- Responsive touch targets and horizontally scrollable tool groups on small screens

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
