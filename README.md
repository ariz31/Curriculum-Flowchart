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
- Add, edit, locate, and delete courses
- Course-code reference updates when a code is renamed
- Automatic year/semester flowchart generation
- Individually draggable course boxes
- Shift/Ctrl/Cmd multi-selection
- Align left/center/right/top/middle/bottom
- Horizontal and vertical distribution
- Align selected nodes back to their term columns
- Optional 10 px snap-to-grid
- Orthogonal prerequisite routing
- Distinct prerequisite, elective-prerequisite, and corequisite line styles
- Local browser persistence for curriculum data and node positions
- Responsive editor shell with a horizontally scrollable large canvas

## Development

```bash
npm install
npm run typecheck
npm run build
```

The production build is emitted to `dist/`.

## Vercel

`vercel.json` configures Vercel to run `npm run build` and publish `dist/`. No backend or environment variables are required for the current local-first version.
