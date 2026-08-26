export type YearLevel = 'First Year' | 'Second Year' | 'Third Year' | 'Fourth Year' | string;
export type Semester = 'First Semester' | 'Second Semester' | 'Short Term' | string;

export interface CurriculumCourse {
  id: string;
  yearLevel: YearLevel;
  semester: Semester;
  courseNo: string;
  title: string;
  units: string;
  prerequisites: string[];
  corequisites: string[];
  electivePrerequisites: string[];
  otherRequirements: string[];
}

export interface NodePosition {
  x: number;
  y: number;
}

export interface CanvasViewportState {
  scale: number;
  x: number;
  y: number;
}

export interface PersistedState {
  courses: CurriculumCourse[];
  positions: Record<string, NodePosition>;
  snapToGrid: boolean;
  viewport?: CanvasViewportState;
  updatedAt: number;
}

export type AlignmentAction =
  | 'left'
  | 'center'
  | 'right'
  | 'top'
  | 'middle'
  | 'bottom'
  | 'distribute-horizontal'
  | 'distribute-vertical';

export type RelationshipType = 'prerequisite' | 'corequisite' | 'elective';

export interface Relationship {
  fromId: string;
  toId: string;
  type: RelationshipType;
}
