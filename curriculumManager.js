(() => {
  const APP_STATE_KEY = 'curriculum-flowchart:v1';
  const LIBRARY_KEY = 'curriculum-flowchart:curricula:v1';
  const CURRENT_ID = 'current-ce';
  const CE_2018_ID = 'slu-ce-2018';

  const nativeGetItem = Storage.prototype.getItem;
  const nativeSetItem = Storage.prototype.setItem;
  const nativeRemoveItem = Storage.prototype.removeItem;

  const safeParse = value => {
    try { return value ? JSON.parse(value) : null; } catch { return null; }
  };

  const raw2018 = [
    ['First Year','First Semester','CFE 101',"God's Journey with His People",'3'],
    ['First Year','First Semester','GRVA','Reading Visual Art','3'],
    ['First Year','First Semester','CEOr','Civil Engineering Orientation','2'],
    ['First Year','First Semester','GETHICS','Ethics','3'],
    ['First Year','First Semester','EnggMath 1','Pre-calculus','4'],
    ['First Year','First Semester','CE 1111','Mathematics of Engineering','3'],
    ['First Year','First Semester','ComProg','Computer Fundamentals and Programming (Lab)','2'],
    ['First Year','First Semester','CE 1121','Engg Drawings and Plans (Lab)','2'],
    ['First Year','First Semester','FIT HW','Physical Activity Towards Health and Fitness (Health and Fitness)','2'],

    ['First Year','Second Semester','CFE 102','Christian Morality in our Times','3'],
    ['First Year','Second Semester','GIT','Living in the IT Era','3'],
    ['First Year','Second Semester','GRIZAL','The Life and Works of Rizal','3'],
    ['First Year','Second Semester','GMATH','Mathematics in the Modern World','3'],
    ['First Year','Second Semester','EnggMath 2','Differential Calculus','4',['EnggMath 1']],
    ['First Year','Second Semester','EnggChem','Chemistry for Engineers','3'],
    ['First Year','Second Semester','EnggChemL','Chemistry for Engineers (Lab)','1',[],['EnggChem']],
    ['First Year','Second Semester','EnggCAD','Computer-Aided Drafting (Lab)','1',['CE 1121']],
    ['First Year','Second Semester','FIT CS','Physical Activity Towards Health and Fitness (Combative Sports)','2'],
    ['First Year','Second Semester','NSTP-CWTS 1','Foundations of Service','3'],

    ['First Year','Short Term','EnggMath 4','Integral Calculus','4',['EnggMath 2']],
    ['First Year','Short Term','EnggPhys','Physics for Engineers','3',['EnggMath 2']],
    ['First Year','Short Term','EnggPhysL','Physics for Engineers (Lab)','1',[],['EnggPhys']],

    ['Second Year','First Semester','CFE 103','Catholic Foundation of Mission','3'],
    ['Second Year','First Semester','GART','Art Appreciation','3'],
    ['Second Year','First Semester','GHIST','Readings in Philippine History','3'],
    ['Second Year','First Semester','GSTS','Science, Technology, and Society','3'],
    ['Second Year','First Semester','EnggMath 3','Engineering Data Analysis','3',['EnggMath 4']],
    ['Second Year','First Semester','CE 2111','Statics of Rigid Bodies','5',['EnggPhys']],
    ['Second Year','First Semester','CE 2121','Fundamentals of Surveying','3',['CE 1121']],
    ['Second Year','First Semester','CE 2121L','Fundamentals of Surveying (Lab)','2',[],['CE 2121']],
    ['Second Year','First Semester','CE 2131','Geology for Civil Engineers','2',['EnggChem']],
    ['Second Year','First Semester','FIT AQ','Physical Activity Towards Health and Fitness (Aquatics)','2'],

    ['Second Year','Second Semester','CFE 104','CICM Missionary Identity','3',['CFE 103']],
    ['Second Year','Second Semester','GCWorld','The Contemporary World','3'],
    ['Second Year','Second Semester','GPCOM','Purposive Communication','3'],
    ['Second Year','Second Semester','EnggMath 5','Differential Equations','3',['EnggMath 3']],
    ['Second Year','Second Semester','CE 2211','Mechanics of Deformable Bodies','5',['CE 2111']],
    ['Second Year','Second Semester','CE 2221','Dynamics of Rigid Bodies','2',['CE 2111']],
    ['Second Year','Second Semester','CE 2231','Hydraulics','4',['CE 2111']],
    ['Second Year','Second Semester','CE 2231L','Hydraulics (Lab)','1',[],['CE 2231']],
    ['Second Year','Second Semester','CE 2241','Engineering Utilities 1','3',['EnggPhys']],
    ['Second Year','Second Semester','CE 2241D','Engineering Utilities 1 (Lab)','1',[],['CE 2241']],
    ['Second Year','Second Semester','FIT OA','Physical Activity Towards Health and Fitness (Outdoor and Adventure Activities)','2'],

    ['Second Year','Short Term','GENTREP','The Entrepreneurial Mind','3'],
    ['Second Year','Short Term','GSELF','Understanding the Self','3'],
    ['Second Year','Short Term','NSTP-CWTS 2','Social Awareness and Empowerment for Service','3',['NSTP-CWTS 1']],

    ['Third Year','First Semester','CFE 105A','CICM in Action: Justice, Peace and Integrity of Creation; Indigenous Peoples; and Interreligious Dialogue','1.5',['CFE 103','CFE 104']],
    ['Third Year','First Semester','Techno 101','Technopreneurship 101','2',['GENTREP']],
    ['Third Year','First Semester','Techno 101L','Technopreneurship 101 (Lab)','1',[],['Techno 101']],
    ['Third Year','First Semester','CE 3111','Structural Theory','4',['CE 2211']],
    ['Third Year','First Semester','CE 3111D','Structural Theory (Design)','1',[],['CE 3111']],
    ['Third Year','First Semester','CE 3121','Construction Materials and Testing','2',['CE 2211']],
    ['Third Year','First Semester','CE 3121L','Construction Materials and Testing (Lab)','1',[],['CE 3121']],
    ['Third Year','First Semester','CE 3131','Geotechnical Engineering 1','3',['CE 2231']],
    ['Third Year','First Semester','CE 3131L','Geotechnical Engineering 1 (Lab)','1',[],['CE 3131']],
    ['Third Year','First Semester','CE 3141','Hydrology','2',['CE 2231']],
    ['Third Year','First Semester','CE 3151','Numerical Solutions to CE Problems','2',['EnggMath 4']],
    ['Third Year','First Semester','CE 3151L','Numerical Solutions to CE Problems (Lab)','1',[],['CE 3151']],
    ['Third Year','First Semester','CE 3161','Engineering Utilities 2','3',['CE 2241']],
    ['Third Year','First Semester','CE 3161D','Engineering Utilities 2 (Drafting)','1',[],['CE 3161']],

    ['Third Year','Second Semester','CFE 105B','CICM in Action: Environmental Planning and Management, and Disaster Risk Reduction Management','1.5',['CFE 105A']],
    ['Third Year','Second Semester','CE 3211','Principles of Steel Design','3',['CE 3111']],
    ['Third Year','Second Semester','CE 3211D','Principles of Steel Design (Design)','1',[],['CE 3211']],
    ['Third Year','Second Semester','CE 3221','Principles of Reinforced/Prestressed Concrete','4',['CE 3111']],
    ['Third Year','Second Semester','CE 3221D','Principles of Reinforced/Prestressed Concrete (Design)','1',[],['CE 3221']],
    ['Third Year','Second Semester','CE 3231','Geotechnical Engineering 2','3',['CE 3131']],
    ['Third Year','Second Semester','CE 3231L','Geotechnical Engineering 2 (Lab)','1',[],['CE 3231']],
    ['Third Year','Second Semester','CE 3241','Quantity Surveying','1',['CE 3121']],
    ['Third Year','Second Semester','CE 3241C','Quantity Surveying Computation','1',[],['CE 3241']],
    ['Third Year','Second Semester','CE 3251','Construction Engineering and Project Management','3',['CE 3121']],
    ['Third Year','Second Semester','CE 3261','Building Systems Design','2',['CE 3161']],
    ['Third Year','Second Semester','CE 3261D','Building Systems Design (Drafting)','1',[],['CE 3261']],

    ['Third Year','Short Term','CE 3281','On the Job Training (240 hours minimum)','2',['CE 3211']],
    ['Third Year','Short Term','CE 3281L','On the Job Training (240 hours minimum)','1',['CE 3211']],

    ['Fourth Year','First Semester','CFE 106A','Embracing the CICM Mission','1.5',['CFE 105B']],
    ['Fourth Year','First Semester','CE 4111','Highway and Railroad Engg','3',['CE 2121']],
    ['Fourth Year','First Semester','CE 4121','CE Project 1','1',['CE 3211','CE 3221','CE 3241']],
    ['Fourth Year','First Semester','CE 4121D','CE Project 1 (Design)','1',[],['CE 4121']],
    ['Fourth Year','First Semester','CE 4151','Civil Engg Software Applications','1',['CE 3211','CE 3221']],
    ['Fourth Year','First Semester','CE 4151L','Civil Engg Software Applications (Lab)','2',[],['CE 4151']],
    ['Fourth Year','First Semester','CE 4161','Engineering Economics','3',['CE 3281','CE 3281L']],

    ['Fourth Year','First Semester','CE 4131 S1','Reinforced Concrete Design','3',['CE 3221','CE 3221D']],
    ['Fourth Year','First Semester','CE 4131D S1D','Reinforced Concrete Design (Design)','1',['CE 3221','CE 3221D'],[],['Source checklist also states “w/ CE 4131D S1D”.']],
    ['Fourth Year','First Semester','CE 4141 S2','Foundation and Retaining Wall Design','3',['CE 3231','CE 3231L']],
    ['Fourth Year','First Semester','CE 4141D S2D','Foundation and Retaining Wall Design (Design)','1',['CE 3231','CE 3231L'],['CE 4141 S2']],

    ['Fourth Year','First Semester','CE 4131 G1','Geotechnical Earthquake Engineering','3',['CE 3231','CE 3231L']],
    ['Fourth Year','First Semester','CE 4131D G1D','Geotechnical Earthquake Engineering (Design)','1',['CE 3231','CE 3231L'],['CE 4131 G1']],
    ['Fourth Year','First Semester','CE 4141 G2','Foundation Engineering','3',['CE 3231','CE 3231L']],
    ['Fourth Year','First Semester','CE 4141D G2D','Foundation Engineering (Design)','1',['CE 3231','CE 3231L'],['CE 4141 G2']],

    ['Fourth Year','Second Semester','CFE 106B','Embracing the CICM Mission','1.5',['CFE 106A']],
    ['Fourth Year','Second Semester','CE 4211','Principles of Transportation Engineering','3',['CE 4111']],
    ['Fourth Year','Second Semester','CE 4221','CE Project 2','1',['CE 4121']],
    ['Fourth Year','Second Semester','CE 4221D','CE Project 2; Specialized CE Course (Design)','1',[],['CE 4221']],
    ['Fourth Year','Second Semester','CE 4251','Civil Engineering Board Review (w/ Mock Board)','1',['CE 3281','CE 3281L']],
    ['Fourth Year','Second Semester','CE 4261','Engineering Management','3',['CE 4161']],
    ['Fourth Year','Second Semester','CE 4271','CE Laws, Ethics and Contracts','2',['CE 3281','CE 3281L']],

    ['Fourth Year','Second Semester','CE 4231 S3','Design of Steel Structures','3',['CE 3211','CE 3211D']],
    ['Fourth Year','Second Semester','CE 4231D S3D','Design of Steel Structures (Design)','1',['CE 3211','CE 3211D'],['CE 4231 S3']],
    ['Fourth Year','Second Semester','CE 4241 S4','Bridge Engineering','3',['CE 3211','CE 3221']],
    ['Fourth Year','Second Semester','CE 4241D S4D','Bridge Engineering (Design)','1',['CE 3211','CE 3221'],['CE 4241 S4']],

    ['Fourth Year','Second Semester','CE 4231 G3','Rock Mechanics','3',['CE 3221','CE 3221D']],
    ['Fourth Year','Second Semester','CE 4231D G3D','Rock Mechanics (Design)','1',['CE 3221','CE 3221D'],['CE 4231 G3']],
    ['Fourth Year','Second Semester','CE 4241 G4','Ground Improvement','3',['CE 3221','CE 3221D']],
    ['Fourth Year','Second Semester','CE 4241D G4D','Ground Improvement (Design)','1',['CE 3221','CE 3221D'],['CE 4241 G4']],
  ];

  const inferTrack = code => {
    if (/\sS\dD?$/i.test(code.trim())) return 'Structural';
    if (/\sG\dD?$/i.test(code.trim())) return 'Geotechnical';
    return 'Common';
  };

  const make2018Courses = () => raw2018.map((row, index) => {
    const [yearLevel, semester, courseNo, title, units, prerequisites = [], corequisites = [], otherRequirements = []] = row;
    return {
      id: `ce2018-${index + 1}`,
      yearLevel,
      semester,
      track: inferTrack(courseNo),
      courseNo,
      title,
      units,
      prerequisites: [...prerequisites],
      corequisites: [...corequisites],
      electivePrerequisites: [],
      otherRequirements: [...otherRequirements],
    };
  });

  const makeState = courses => ({
    courses,
    positions: {},
    snapToGrid: true,
    viewport: { scale: 1, x: 24, y: 24 },
    layoutMode: 'basic',
    trackFilter: 'all',
    hiddenTracks: [],
    updatedAt: Date.now(),
  });

  const create2018Profile = () => ({
    id: CE_2018_ID,
    title: 'BS Civil Engineering — Effective A.Y. 2018–2019',
    subtitle: 'Saint Louis University · Revision 01',
    builtIn: true,
    state: makeState(make2018Courses()),
  });

  const createStarterState = () => makeState([{
    id: `custom-${Date.now()}-1`,
    yearLevel: 'First Year',
    semester: 'First Semester',
    track: 'Common',
    courseNo: 'NEW 101',
    title: 'New Course',
    units: '3',
    prerequisites: [],
    corequisites: [],
    electivePrerequisites: [],
    otherRequirements: [],
  }]);

  const existingAppState = safeParse(nativeGetItem.call(localStorage, APP_STATE_KEY));
  let library = safeParse(nativeGetItem.call(localStorage, LIBRARY_KEY));

  if (!library || !Array.isArray(library.profiles)) {
    library = {
      version: 1,
      activeId: CURRENT_ID,
      profiles: [
        {
          id: CURRENT_ID,
          title: 'BS Civil Engineering — Current Curriculum',
          subtitle: 'Current curriculum workspace',
          builtIn: true,
          state: existingAppState,
        },
        create2018Profile(),
      ],
    };
  } else {
    if (!library.profiles.some(profile => profile.id === CURRENT_ID)) {
      library.profiles.unshift({
        id: CURRENT_ID,
        title: 'BS Civil Engineering — Current Curriculum',
        subtitle: 'Current curriculum workspace',
        builtIn: true,
        state: existingAppState,
      });
    }
    if (!library.profiles.some(profile => profile.id === CE_2018_ID)) library.profiles.push(create2018Profile());
    if (!library.profiles.some(profile => profile.id === library.activeId)) library.activeId = CURRENT_ID;
  }

  const persistLibrary = () => nativeSetItem.call(localStorage, LIBRARY_KEY, JSON.stringify(library));
  const activeProfile = () => library.profiles.find(profile => profile.id === library.activeId) || library.profiles[0];

  let syncing = true;
  const applyActiveState = () => {
    const profile = activeProfile();
    window.__CURRICULUM_TITLE__ = profile?.title || 'Curriculum Flowchart';
    document.documentElement.dataset.curriculumTitle = window.__CURRICULUM_TITLE__;
    if (profile?.state) nativeSetItem.call(localStorage, APP_STATE_KEY, JSON.stringify(profile.state));
    else nativeRemoveItem.call(localStorage, APP_STATE_KEY);
  };
  applyActiveState();
  persistLibrary();
  syncing = false;

  Storage.prototype.setItem = function patchedSetItem(key, value) {
    nativeSetItem.call(this, key, value);
    if (this !== localStorage || key !== APP_STATE_KEY || syncing) return;
    const parsed = safeParse(value);
    if (!parsed) return;
    const profile = activeProfile();
    if (!profile) return;
    profile.state = parsed;
    persistLibrary();
  };

  Storage.prototype.removeItem = function patchedRemoveItem(key) {
    nativeRemoveItem.call(this, key);
    if (this !== localStorage || key !== APP_STATE_KEY || syncing) return;
    const profile = activeProfile();
    if (!profile) return;
    profile.state = null;
    persistLibrary();
  };

  const switchTo = profileId => {
    const next = library.profiles.find(profile => profile.id === profileId);
    if (!next) return;
    library.activeId = next.id;
    syncing = true;
    if (next.state) nativeSetItem.call(localStorage, APP_STATE_KEY, JSON.stringify(next.state));
    else nativeRemoveItem.call(localStorage, APP_STATE_KEY);
    persistLibrary();
    syncing = false;
    window.location.reload();
  };

  const installControls = () => {
    const headerActions = document.querySelector('.header-actions');
    if (!(headerActions instanceof HTMLElement) || document.querySelector('#curriculum-profile-select')) return;

    const style = document.createElement('style');
    style.textContent = `
      .curriculum-profile-controls {
        display: inline-flex;
        align-items: center;
        gap: 7px;
        flex-wrap: wrap;
        padding: 5px 7px;
        border: 1px solid #d8deea;
        border-radius: 9px;
        background: #f8fafc;
      }
      .curriculum-profile-label {
        color: #667085;
        font-size: .72rem;
        font-weight: 800;
        text-transform: uppercase;
        letter-spacing: .04em;
      }
      #curriculum-profile-select {
        max-width: min(360px, 42vw);
        min-height: 34px;
        border: 1px solid #d8deea;
        border-radius: 7px;
        background: #fff;
        color: #172033;
        padding: 5px 8px;
        font: inherit;
        font-size: .8rem;
        font-weight: 650;
      }
      #new-curriculum-profile { min-height: 34px; padding: 5px 9px; }
      @media (max-width: 760px) {
        .curriculum-profile-controls { width: 100%; align-items: stretch; }
        #curriculum-profile-select { flex: 1 1 190px; max-width: none; min-height: 42px; }
        #new-curriculum-profile { min-height: 42px; }
      }
    `;
    document.head.append(style);

    const controls = document.createElement('div');
    controls.className = 'curriculum-profile-controls';
    controls.setAttribute('aria-label', 'Curriculum selection');

    const label = document.createElement('span');
    label.className = 'curriculum-profile-label';
    label.textContent = 'Curriculum';

    const select = document.createElement('select');
    select.id = 'curriculum-profile-select';
    select.setAttribute('aria-label', 'Select curriculum');
    select.innerHTML = library.profiles.map(profile =>
      `<option value="${profile.id.replace(/"/g, '&quot;')}">${profile.title.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</option>`
    ).join('');
    select.value = library.activeId;

    const newButton = document.createElement('button');
    newButton.id = 'new-curriculum-profile';
    newButton.className = 'secondary-button';
    newButton.type = 'button';
    newButton.textContent = '+ New';
    newButton.title = 'Create a new curriculum workspace';

    controls.append(label, select, newButton);
    headerActions.prepend(controls);

    select.addEventListener('change', () => switchTo(select.value));

    newButton.addEventListener('click', () => {
      const requested = window.prompt('Name the new curriculum:', `New Curriculum ${library.profiles.length + 1}`);
      const title = (requested || '').trim();
      if (!title) return;
      const id = `custom-${Date.now()}`;
      const profile = {
        id,
        title,
        subtitle: 'Custom curriculum workspace',
        builtIn: false,
        state: createStarterState(),
      };
      library.profiles.push(profile);
      library.activeId = id;
      syncing = true;
      nativeSetItem.call(localStorage, APP_STATE_KEY, JSON.stringify(profile.state));
      persistLibrary();
      syncing = false;
      window.location.reload();
    });

    const resetButton = document.querySelector('#reset-sample');
    if (resetButton instanceof HTMLButtonElement) {
      resetButton.addEventListener('click', event => {
        const profile = activeProfile();
        if (!profile || profile.id === CURRENT_ID) return;
        event.preventDefault();
        event.stopImmediatePropagation();

        const resetState = profile.id === CE_2018_ID ? makeState(make2018Courses()) : createStarterState();
        profile.state = resetState;
        syncing = true;
        nativeSetItem.call(localStorage, APP_STATE_KEY, JSON.stringify(resetState));
        persistLibrary();
        syncing = false;
        window.location.reload();
      }, true);
    }
  };

  installControls();
})();