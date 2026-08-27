
;(() => {
  const FORMAT = 'curriculum-flowchart-state';
  const VERSION = 1;
  const LIBRARY_KEY = 'curriculum-flowchart:curricula:v1';
  const TERM_LAYOUT_KEY = 'curriculum-flowchart:term-layout:v1';
  const VERTICAL_SPACING_KEY = 'curriculum-flowchart:vertical-lane-spacing:v1';
  const HORIZONTAL_SPACING_KEY = 'curriculum-flowchart:horizontal-lane-spacing:v1';
  const MANUAL_ROUTES_KEY = 'curriculum-flowchart:manual-routes:v1';
  const LINE_VISUAL_KEY = 'curriculum-flowchart:line-visual-mode:v1';
  const SORT_STRATEGY_KEY = 'curriculum-flowchart:sort-strategies:v1';
  const LAYOUT_CHECKPOINT_KEY = 'curriculum-flowchart:layout-checkpoints:v1';

  const clone = value => JSON.parse(JSON.stringify(value));
  const safeParse = value => { try { return value ? JSON.parse(value) : null; } catch { return null; } };
  const isObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const text = (value, fallback = '') => typeof value === 'string' ? value : fallback;
  const stringArray = value => Array.isArray(value) ? value.map(item => String(item ?? '').trim()).filter(Boolean) : [];

  function activeCurriculum() {
    const library = safeParse(localStorage.getItem(LIBRARY_KEY));
    const activeId = String(library?.activeId || 'default');
    const profile = Array.isArray(library?.profiles) ? library.profiles.find(item => String(item?.id) === activeId) : null;
    return {
      id: activeId,
      title: String(profile?.title || document.documentElement.dataset.curriculumTitle || window.__CURRICULUM_TITLE__ || 'Curriculum Flowchart'),
      subtitle: String(profile?.subtitle || ''),
    };
  }

  function mapEntry(key, curriculumId) {
    const map = safeParse(localStorage.getItem(key));
    return isObject(map) && Object.prototype.hasOwnProperty.call(map, curriculumId) ? clone(map[curriculumId]) : null;
  }

  function setMapEntry(key, curriculumId, value) {
    if (value == null) return;
    const stored = safeParse(localStorage.getItem(key));
    const map = isObject(stored) ? stored : {};
    map[curriculumId] = clone(value);
    localStorage.setItem(key, JSON.stringify(map));
  }

  function sanitizeCourse(course, index) {
    if (!isObject(course)) return null;
    const id = text(course.id).trim() || `imported-${Date.now()}-${index + 1}`;
    return {
      id,
      yearLevel: text(course.yearLevel, 'First Year'),
      semester: text(course.semester, 'First Semester'),
      track: text(course.track, 'Common'),
      courseNo: text(course.courseNo, `COURSE ${index + 1}`),
      title: text(course.title, 'Untitled Course'),
      units: text(course.units, ''),
      prerequisites: stringArray(course.prerequisites),
      corequisites: stringArray(course.corequisites),
      electivePrerequisites: stringArray(course.electivePrerequisites),
      otherRequirements: stringArray(course.otherRequirements),
    };
  }

  function sanitizeState(raw) {
    if (!isObject(raw) || !Array.isArray(raw.courses)) throw new Error('The JSON file does not contain a valid curriculum state.');
    const courses = raw.courses.map(sanitizeCourse).filter(Boolean);
    if (!courses.length) throw new Error('The JSON file contains no valid courses.');
    const validIds = new Set(courses.map(course => course.id));
    const positions = {};
    if (isObject(raw.positions)) {
      for (const [id, position] of Object.entries(raw.positions)) {
        if (!validIds.has(id) || !isObject(position)) continue;
        const x = Number(position.x);
        const y = Number(position.y);
        if (Number.isFinite(x) && Number.isFinite(y)) positions[id] = { x: Math.max(0, x), y: Math.max(0, y) };
      }
    }
    const viewport = isObject(raw.viewport) ? {
      scale: Math.max(0.05, finite(raw.viewport.scale, 1)),
      x: finite(raw.viewport.x, 24),
      y: finite(raw.viewport.y, 24),
    } : { scale: 1, x: 24, y: 24 };
    return {
      courses,
      positions,
      snapToGrid: raw.snapToGrid !== false,
      viewport,
      layoutMode: raw.layoutMode === 'optimized' ? 'optimized' : 'basic',
      sortStrategy: raw.sortStrategy ? String(raw.sortStrategy) : null,
      trackFilter: text(raw.trackFilter, 'all') || 'all',
      hiddenTracks: stringArray(raw.hiddenTracks),
      updatedAt: Date.now(),
    };
  }

  function displayOptions() {
    const get = id => {
      const input = document.querySelector(id);
      return input instanceof HTMLInputElement ? input.checked : true;
    };
    return {
      code: get('#display-code-toggle'),
      description: get('#display-description-toggle'),
      units: get('#display-units-toggle'),
      track: get('#display-track-toggle'),
    };
  }

  function buildPayload() {
    const curriculum = activeCurriculum();
    const runtimeState = window.CurriculumFlowchartRuntime?.getState?.() || state;
    return {
      format: FORMAT,
      version: VERSION,
      exportedAt: new Date().toISOString(),
      app: 'Curriculum Flowchart',
      curriculum: {
        id: curriculum.id,
        title: curriculum.title,
        subtitle: curriculum.subtitle,
      },
      state: clone(runtimeState),
      settings: {
        termLayout: window.CurriculumTermLayout?.exportState?.() ?? mapEntry(TERM_LAYOUT_KEY, curriculum.id),
        verticalLineSpacing: Number(window.CurriculumVerticalLaneSpacing?.get?.()) || 7,
        horizontalLineSpacing: Number(window.CurriculumHorizontalLaneSpacing?.get?.()) || 7,
        manualRouting: window.CurriculumManualRouting?.exportState?.() ?? mapEntry(MANUAL_ROUTES_KEY, curriculum.id),
        lineVisualMode: mapEntry(LINE_VISUAL_KEY, curriculum.id),
        sortStrategy: mapEntry(SORT_STRATEGY_KEY, curriculum.id),
        layoutCheckpoint: mapEntry(LAYOUT_CHECKPOINT_KEY, curriculum.id),
        display: displayOptions(),
      },
    };
  }

  function safeFilename(value) {
    const normalized = String(value || 'curriculum-flowchart')
      .normalize('NFKD')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase();
    return normalized || 'curriculum-flowchart';
  }

  function downloadJson() {
    const payload = buildPayload();
    const json = JSON.stringify(payload, null, 2);
    const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${safeFilename(payload.curriculum.title)}-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    window.CurriculumFlowchartRuntime?.setHint?.('Flowchart state saved as JSON.');
  }

  function restoreDisplay(settings) {
    if (!isObject(settings?.display)) return;
    const pairs = [
      ['#display-code-toggle', settings.display.code],
      ['#display-description-toggle', settings.display.description],
      ['#display-units-toggle', settings.display.units],
      ['#display-track-toggle', settings.display.track],
    ];
    for (const [selector, checked] of pairs) {
      const input = document.querySelector(selector);
      if (!(input instanceof HTMLInputElement) || typeof checked !== 'boolean') continue;
      input.checked = checked;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  function restoreAuxiliarySettings(settings, curriculumId) {
    if (!isObject(settings)) return;
    if (settings.termLayout != null) window.CurriculumTermLayout?.importState?.(settings.termLayout, { silent: true });
    if (Number.isFinite(Number(settings.verticalLineSpacing))) window.CurriculumVerticalLaneSpacing?.set?.(Number(settings.verticalLineSpacing));
    if (Number.isFinite(Number(settings.horizontalLineSpacing))) window.CurriculumHorizontalLaneSpacing?.set?.(Number(settings.horizontalLineSpacing));
    if (settings.manualRouting != null) window.CurriculumManualRouting?.importState?.(settings.manualRouting, { render: false });
    setMapEntry(LINE_VISUAL_KEY, curriculumId, settings.lineVisualMode);
    setMapEntry(SORT_STRATEGY_KEY, curriculumId, settings.sortStrategy);
    setMapEntry(LAYOUT_CHECKPOINT_KEY, curriculumId, settings.layoutCheckpoint);
  }

  function importPayload(payload) {
    if (!isObject(payload) || payload.format !== FORMAT) throw new Error('This is not a Curriculum Flowchart state file.');
    if (Number(payload.version) > VERSION) throw new Error(`This file uses a newer state format (v${payload.version}).`);
    const nextState = sanitizeState(payload.state);
    const curriculum = activeCurriculum();

    state = nextState;
    routePlans = null;
    selected.clear();
    setMultiSelect(false);
    restoreAuxiliarySettings(payload.settings, curriculum.id);
    ensurePositions();
    snap.checked = state.snapToGrid;
    renderTrackControls();
    save();
    renderTable();
    renderFlow();
    restoreDisplay(payload.settings);
    window.CurriculumConnectorGeometry?.request?.();
    window.CurriculumConnectorRouting?.request?.();
    window.CurriculumLineVisualPersistence?.apply?.();
    switchView('flow');
    window.CurriculumFlowchartRuntime?.setHint?.(`JSON state restored${payload.curriculum?.title ? ` from “${payload.curriculum.title}”` : ''}.`);
  }

  async function importFile(file) {
    if (!(file instanceof File)) return;
    const textContent = await file.text();
    let payload;
    try { payload = JSON.parse(textContent); }
    catch { throw new Error('The selected file is not valid JSON.'); }
    const courseCount = Array.isArray(payload?.state?.courses) ? payload.state.courses.length : 0;
    const label = payload?.curriculum?.title ? `“${payload.curriculum.title}”` : 'the selected JSON state';
    if (!confirm(`Restore ${label}${courseCount ? ` (${courseCount} courses)` : ''}? This will replace the current curriculum state and layout.`)) return;
    importPayload(payload);
  }

  function installControls() {
    if (document.querySelector('#save-flow-state-json')) return;
    const downloadPng = document.querySelector('#download-image');
    const exportGroup = downloadPng?.closest('.toolbar-group');
    if (!(exportGroup instanceof HTMLElement)) return;

    const saveButton = document.createElement('button');
    saveButton.id = 'save-flow-state-json';
    saveButton.className = 'toolbar-button';
    saveButton.type = 'button';
    saveButton.textContent = 'Save JSON';
    saveButton.title = 'Download the current curriculum, node layout, connector settings, and visual state as a JSON file';

    const loadButton = document.createElement('button');
    loadButton.id = 'load-flow-state-json';
    loadButton.className = 'toolbar-button';
    loadButton.type = 'button';
    loadButton.textContent = 'Load JSON';
    loadButton.title = 'Restore a previously saved Curriculum Flowchart JSON state file';

    const input = document.createElement('input');
    input.id = 'load-flow-state-json-input';
    input.type = 'file';
    input.accept = '.json,application/json';
    input.hidden = true;

    exportGroup.append(saveButton, loadButton, input);
    saveButton.addEventListener('click', downloadJson);
    loadButton.addEventListener('click', () => { input.value = ''; input.click(); });
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;
      loadButton.disabled = true;
      const previousText = loadButton.textContent;
      loadButton.textContent = 'Loading…';
      try { await importFile(file); }
      catch (error) {
        console.error(error);
        const message = error instanceof Error ? error.message : 'Could not restore the JSON state.';
        alert(message);
        window.CurriculumFlowchartRuntime?.setHint?.(message);
      } finally {
        loadButton.disabled = false;
        loadButton.textContent = previousText;
      }
    });
  }

  window.CurriculumFlowchartJsonState = {
    exportState: buildPayload,
    importState: importPayload,
    download: downloadJson,
  };

  installControls();
})();
