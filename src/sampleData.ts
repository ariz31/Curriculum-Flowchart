import type { CurriculumCourse } from './types.js';

type RawCourse = [string, string, string, string, string, string?];

const RAW_COURSES: RawCourse[] = [
  ['First Year','First Semester','CFE 101',"God's Journey with His People",'3'],
  ['First Year','First Semester','GCORDI','Cordillera: History and Socio-Cultural Heritage','3'],
  ['First Year','First Semester','GSTS','Science, Technology, and Society','3'],
  ['First Year','First Semester','GETHICS','Ethics','3'],
  ['First Year','First Semester','ComProg','Computer Fundamentals and Programming (Lab)','2'],
  ['First Year','First Semester','CEOr','Civil Engineering Orientation','2'],
  ['First Year','First Semester','CE Math 1','Pre-calculus','3'],
  ['First Year','First Semester','CE Math 2','Differential Calculus','4'],
  ['First Year','First Semester','CE 1102','Geology for Civil Engineers','2'],
  ['First Year','First Semester','CE 1112','Engg Drawings and Plans (Lab)','2'],
  ['First Year','First Semester','FIT HW','Physical Activity Towards Health and Fitness (Health and Fitness)','2'],
  ['First Year','Second Semester','CFE 102','Christian Morality in our Times','3'],
  ['First Year','Second Semester','GIT','Living in the IT Era','3'],
  ['First Year','Second Semester','GRIZAL','The Life and Works of Rizal','3'],
  ['First Year','Second Semester','GMATH','Mathematics in the Modern World','3'],
  ['First Year','Second Semester','CE Math 4','Integral Calculus','4','CE Math 1, CE Math 2'],
  ['First Year','Second Semester','CE Phys','Physics for Engineers','3','CE Math 1, CE Math 2'],
  ['First Year','Second Semester','CE PhysL','Physics for Engineers (Lab)','1','CE Math 1, CE Math 2, CE Phys'],
  ['First Year','Second Semester','CE Chem','Chemistry for Engineers','3'],
  ['First Year','Second Semester','CE Chem L','Chemistry for Engineers (Lab)','1','CE Chem'],
  ['First Year','Second Semester','CE 1202','Computer-Aided Drafting (Lab)','1','CE 1112'],
  ['First Year','Second Semester','FIT CS','Physical Activity Towards Health and Fitness (Combative Sports)','2'],
  ['First Year','Second Semester','NSTP-CWTS 1','Foundations of Service','3'],
  ['First Year','Short Term','CE 1203','Engineering Utilities 2','2','CE Phys, CE PhysL'],
  ['First Year','Short Term','CE 1203D','Engineering Utilities 2 (Drafting)','1','CE Phys, CE PhysL, CE 2202'],
  ['First Year','Short Term','CE Math 3','Engineering Data Analysis','3','CE Math 4'],
  ['First Year','Short Term','GPCOM','Purposive Communication','3'],
  ['Second Year','First Semester','CFE 103','Catholic Foundation of Mission','3'],
  ['Second Year','First Semester','GART','Art Appreciation','3'],
  ['Second Year','First Semester','GHIST','Readings in Philippine History','3'],
  ['Second Year','First Semester','CE Math 5','Differential Equations','3','CE Math 3'],
  ['Second Year','First Semester','CE 2102','Statics of Rigid Bodies','5','CE Phys, CE PhysL'],
  ['Second Year','First Semester','CE 2112','Fundamentals of Surveying','3','CE Math 1, CE 1112'],
  ['Second Year','First Semester','CE 2112L','Fundamentals of Surveying (Lab)','2','CE Math 1, CE 1112, CE 2112'],
  ['Second Year','First Semester','CE 2122','Engineering Utilities 1','2','CE Phys, CE PhysL'],
  ['Second Year','First Semester','CE 2122D','Engineering Utilities 1 (Lab)','1','CE Phys, CE PhysL, CE 2122'],
  ['Second Year','First Semester','NSTP-CWTS 2','Social Awareness and Empowerment for Service','3','NSTP-CWTS 1'],
  ['Second Year','Second Semester','CFE 104','CICM Missionary Identity','3','CFE 103'],
  ['Second Year','Second Semester','GCWorld','The Contemporary World','3'],
  ['Second Year','Second Semester','GSELF','Understanding the Self','3'],
  ['Second Year','Second Semester','CE 2202','Mechanics of Deformable Bodies','5','CE 2102'],
  ['Second Year','Second Semester','CE 2212','Dynamics of Rigid Bodies','2','CE 2102'],
  ['Second Year','Second Semester','CE 2222','Hydraulics','4','CE 2102'],
  ['Second Year','Second Semester','CE 2222L','Hydraulics (Lab)','1','CE 2102, CE 2222'],
  ['Second Year','Second Semester','CE 2232','Building Systems Design','2','CE 1203, CE 1203D, CE 2122, CE 2122D'],
  ['Second Year','Second Semester','CE 2232D','Building Systems Design (Drafting)','1','CE 1203, CE 1203D, CE 2122, CE 2122D, CE 2232'],
  ['Second Year','Second Semester','CE 2242','Highway and Railroad Engg','3','CE 2112, CE 2112L'],
  ['Second Year','Second Semester','FIT OA','Physical Activity Towards Health and Fitness (Outdoor and Adventure Activities)','2'],
  ['Second Year','Short Term','GENTREP','The Entrepreneurial Mind','3'],
  ['Second Year','Short Term','CE 2252','Numerical Solutions to CE Problems','2','CE Math 5'],
  ['Second Year','Short Term','CE 2252L','Numerical Solutions to CE Problems (Lab)','1','CE Math 5, CE 2252'],
  ['Second Year','Short Term','FIT AQ','Physical Activity Towards Health and Fitness (Aquatics)','2'],
  ['Third Year','First Semester','CFE 105A','CICM in Action : Justice, Peace and Integrity of Creation; Indigenous Peoples; and Interreligious Dialogue','1.5','CFE 103, CFE 104'],
  ['Third Year','First Semester','CE 3102','Structural Theory','4','CE 2202'],
  ['Third Year','First Semester','CE 3102D','Structural Theory (Design)','1','CE 2202, CE 3102'],
  ['Third Year','First Semester','CE 3112','Construction Materials and Testing','2','CE 2202'],
  ['Third Year','First Semester','CE 3112L','Construction Materials and Testing (Lab)','1','CE 2202, CE 3112'],
  ['Third Year','First Semester','CE 3122','Geotechnical Engineering 1','3','CE 2222, CE 2222L, CE 2202'],
  ['Third Year','First Semester','CE 3122L','Geotechnical Engineering 1 (Lab)','1','CE 2222, CE 2222L, CE 2202, CE 3122'],
  ['Third Year','First Semester','CE 3132','Hydrology','2','CE 2222, CE 2222L'],
  ['Third Year','First Semester','CE 3142','Quantity Surveying','3','CE 2232, CE 2232D'],
  ['Third Year','First Semester','CE 3142C','Quantity Surveying Computation','1','CE 2232, CE 2232D'],
  ['Third Year','First Semester','CE 3152','Principles of Transportation Engineering','3','CE 2242'],
  ['Third Year','Second Semester','CFE 105B','CICM in Action : Environmental Planning and Management, and Disaster Risk Reduction Management','1.5','CFE 105A'],
  ['Third Year','Second Semester','CE 3202','Principles of Steel Design','3','CE 3102, CE 3102D'],
  ['Third Year','Second Semester','CE 3202D','Principles of Steel Design (Design)','1','CE 3102, CE 3102D, CE 3202'],
  ['Third Year','Second Semester','CE 3212','Principles of Reinforced/Prestressed Concrete','5','CE 3102, CE 3102D'],
  ['Third Year','Second Semester','CE 3212D','Principles of Reinforced/Prestressed Concrete (Design)','1','CE 3102, CE 3102D, CE 3212'],
  ['Third Year','Second Semester','CE 3222','Geotechnical Engineering 2','2','CE 3122, CE 3122L'],
  ['Third Year','Second Semester','CE 3222L','Geotechnical Engineering 2 (Lab)','1','CE 3122, CE 3122L, CE 3222'],
  ['Third Year','Second Semester','CE 3232','Construction Engineering and Project Management','3','CE 3142, CE 3142C'],
  ['Third Year','Second Semester','CE 3242','Lateral Loads and Analysis','3','CE 3102, CE 3102D'],
  ['Third Year','Second Semester','CE 3252L','Civil Engg Software Applications (Lab)','2','CE 3202, CE 3212'],
  ['Third Year','Short Term','CE 3262','On the Job Training (240 hours minimum)','2','CE 3202, CE 3202D, CE 3212, CE 3212D, CE 3142, CE 3142C, CE 3252L, 3rd year standing'],
  ['Third Year','Short Term','CE 3262L','On the Job Training (240 hours minimum)','1','CE 3202, CE 3202D, CE 3212, CE 3212D, CE 3142, CE 3142C, CE 3252L, CE 3262, 3rd year standing'],
  ['Fourth Year','First Semester','CFE 106A','Embracing the CICM Mission','1.5','CFE 105B'],
  ['Fourth Year','First Semester','CE Econ','Engineering Economics','3','CE 3142, CE 3142C'],
  ['Fourth Year','First Semester','CE 4102','CE Project 1','1','CE 3262, CE 3262L'],
  ['Fourth Year','First Semester','CE 4102D','CE Project 1 (Design)','1','CE 3262, CE 3262L'],
  ['Fourth Year','First Semester','CE 4112','Advanced Theory of Structures','3','CE 3102, CE 3102D, CE 2252, CE 2252L'],
  ['Fourth Year','First Semester','CE 4122 S1','Specialized Prof CE Course 1: Reinforced Concrete Design','3','CE 3212, CE 3212D'],
  ['Fourth Year','First Semester','CE 4132 S2','Specialized Prof CE Course 2: Foundation and Retaining Wall Design','3','CE 3212, CE 3212D'],
  ['Fourth Year','First Semester','CE 4142 S3','Specialized Prof CE Course 3: Design of Steel Structures','3','CE 3202, CE 3202D'],
  ['Fourth Year','First Semester','CE 4122 G1','Specialized Prof CE Course 1: Ground Improvement','3','CE 3122, CE 3122L'],
  ['Fourth Year','First Semester','CE 4132 G2','Specialized Prof CE Course 2: Foundation Engineering','3','CE 3122, CE 3122L, CE 3212, CE 3212D'],
  ['Fourth Year','First Semester','CE 4142 G3','Specialized Prof CE Course 3: Rock Mechanics','3','CE 3122, CE 3122L, CE 1102'],
  ['Fourth Year','Second Semester','CFE 106B','Embracing the CICM Mission','1.5','CFE 106A'],
  ['Fourth Year','Second Semester','CE Techno 101','Technopreneurship 101','2','GENTREP, 4th year standing'],
  ['Fourth Year','Second Semester','CE Techno 101L','Technopreneurship 101 (Lab)','1','GENTREP, CE Techno 101, 4th year standing'],
  ['Fourth Year','Second Semester','CE Mngt','Engineering Management','2','CE 3142, CE 3142C'],
  ['Fourth Year','Second Semester','CE 4202','CE Project 2','1','CE 4102'],
  ['Fourth Year','Second Semester','CE 4202D','CE Project 2 (Design)','1','CE 4202'],
  ['Fourth Year','Second Semester','CE 4212C','Civil Engineering Board Review (w/ Mock Board)','1','CE 4122 S1, CE 4132 S2, CE 4142 S3'],
  ['Fourth Year','Second Semester','CE 4222','CE Laws, Ethics and Contracts','2','CE 3142, CE 3142C'],
  ['Fourth Year','Second Semester','CE 4232 S4','Specialized Prof CE Course 4: Bridge Engineering','3','CE 4122 S1, CE 4132 S2, CE 4142 S3'],
  ['Fourth Year','Second Semester','CE 4242 S5','Specialized Prof CE Course 5: Prestressed Concrete','3','CE 4122 S1'],
  ['Fourth Year','Second Semester','CE 4232 G4','Specialized Prof CE Course 4: Geotechnical Earthquake Engineering','3','CE 4122 G1, CE 4132 G2, CE 4142 G3'],
  ['Fourth Year','Second Semester','CE 4242 G5','Specialized Prof CE Course 5: Slope Engineering and Retaining Structures','3','CE 4122 G1, CE 4132 G2, CE 4142 G3'],
];

const normalize = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase();

function splitRequirements(value?: string): string[] {
  if (!value) return [];
  return value.split(',').map((part) => part.trim()).filter(Boolean);
}

function inferTrack(courseNo: string): string {
  if (/\sS\d+$/i.test(courseNo.trim())) return 'Structural';
  if (/\sG\d+$/i.test(courseNo.trim())) return 'Geotechnical';
  return 'Common';
}

export function createSampleCourses(): CurriculumCourse[] {
  const knownCodes = new Map(RAW_COURSES.map((row) => [normalize(row[2]), row]));

  return RAW_COURSES.map((row, index) => {
    const [yearLevel, semester, courseNo, title, units, combinedRequirements] = row;
    const prerequisites: string[] = [];
    const corequisites: string[] = [];
    const otherRequirements: string[] = [];

    for (const requirement of splitRequirements(combinedRequirements)) {
      const referenced = knownCodes.get(normalize(requirement));
      if (!referenced) {
        otherRequirements.push(requirement);
        continue;
      }

      const sameTerm = referenced[0] === yearLevel && referenced[1] === semester;
      (sameTerm ? corequisites : prerequisites).push(referenced[2]);
    }

    return {
      id: `course-${index + 1}`,
      yearLevel,
      semester,
      track: inferTrack(courseNo),
      courseNo,
      title,
      units,
      prerequisites,
      corequisites,
      electivePrerequisites: [],
      otherRequirements,
    };
  });
}
