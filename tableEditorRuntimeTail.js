
;(() => {
  const RELATION_FIELDS = new Set(['prerequisites', 'corequisites', 'electivePrerequisites']);
  const RELATION_LABELS = {
    prerequisites: 'Prerequisite',
    corequisites: 'Corequisite',
    electivePrerequisites: 'Elective prerequisite',
  };
  const YEAR_ORDER = ['First Year', 'Second Year', 'Third Year', 'Fourth Year', 'Fifth Year'];
  const TERM_ORDER = ['First Semester', 'Second Semester', 'Short Term', 'Summer'];
  const editorMessages = new Map();
  const normalize = value => String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
  const uniq = values => [...new Set(values.filter(Boolean))];
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

  const originalRenderTable = renderTable;
  const originalUpdateField = updateField;

  function courseColumnIndex(course) {
    if (!course) return Number.MAX_SAFE_INTEGER;
    const cols = columns();
    const index = cols.findIndex(column => column.year === course.yearLevel && column.term === course.semester);
    if (index >= 0) return index;
    const year = YEAR_ORDER.indexOf(course.yearLevel);
    const term = TERM_ORDER.indexOf(course.semester);
    return (year >= 0 ? year : 99) * 10 + (term >= 0 ? term : 9);
  }

  function prefixOf(code) {
    return normalize(code).replace(/\d.*$/, '').trim();
  }

  function tokenScore(needle, candidate) {
    if (!needle) return 0;
    const code = normalize(candidate.courseNo);
    const title = normalize(candidate.title);
    if (code === needle) return 200;
    if (code.startsWith(needle)) return 130;
    if (code.includes(needle)) return 100;
    if (title.startsWith(needle)) return 85;
    if (title.includes(needle)) return 70;
    const words = needle.split(/\s+/).filter(Boolean);
    return words.length && words.every(word => code.includes(word) || title.includes(word)) ? 55 : -1000;
  }

  function recommendationScore(target, candidate, field, query = '') {
    if (!candidate || candidate.id === target.id) return -Infinity;
    const needle = normalize(query);
    const textScore = tokenScore(needle, candidate);
    if (needle && textScore < 0) return -Infinity;
    const targetColumn = courseColumnIndex(target);
    const candidateColumn = courseColumnIndex(candidate);
    let score = textScore;
    if (prefixOf(target.courseNo) && prefixOf(target.courseNo) === prefixOf(candidate.courseNo)) score += 32;
    const targetDigits = Number(String(target.courseNo || '').match(/\d+/)?.[0]);
    const candidateDigits = Number(String(candidate.courseNo || '').match(/\d+/)?.[0]);
    if (Number.isFinite(targetDigits) && Number.isFinite(candidateDigits)) score += Math.max(0, 20 - Math.abs(targetDigits - candidateDigits) / 20);
    if (field === 'corequisites') {
      if (candidateColumn === targetColumn) score += 120;
      else score -= Math.min(90, Math.abs(candidateColumn - targetColumn) * 22);
    } else {
      if (candidateColumn < targetColumn) score += 90 - Math.min(60, (targetColumn - candidateColumn) * 8);
      else if (candidateColumn === targetColumn) score += 10;
      else score -= 80 + Math.min(80, (candidateColumn - targetColumn) * 15);
    }
    return score;
  }

  function dependencyAdjacency() {
    const adjacency = new Map();
    const add = (sourceCode, targetCode) => {
      const source = normalize(sourceCode);
      const target = normalize(targetCode);
      if (!source || !target) return;
      const values = adjacency.get(source) || new Set();
      values.add(target);
      adjacency.set(source, values);
    };
    for (const course of state.courses) {
      for (const source of [...course.prerequisites, ...course.electivePrerequisites]) add(source, course.courseNo);
    }
    return adjacency;
  }

  function pathExists(adjacency, fromCode, toCode) {
    const from = normalize(fromCode);
    const target = normalize(toCode);
    const queue = [from];
    const visited = new Set();
    while (queue.length) {
      const current = queue.shift();
      if (!current || visited.has(current)) continue;
      if (current === target) return true;
      visited.add(current);
      for (const next of adjacency.get(current) || []) queue.push(next);
    }
    return false;
  }

  function wouldCreateCycle(targetCourse, candidateCourse) {
    if (!targetCourse || !candidateCourse) return false;
    const adjacency = dependencyAdjacency();
    return pathExists(adjacency, targetCourse.courseNo, candidateCourse.courseNo);
  }

  function relationWarnings(course, field, codes) {
    const warnings = [];
    const seen = new Set();
    const currentColumn = courseColumnIndex(course);
    for (const raw of codes) {
      const key = normalize(raw);
      if (!key) continue;
      if (seen.has(key)) warnings.push(`Duplicate reference: ${raw}`);
      seen.add(key);
      if (key === normalize(course.courseNo)) {
        warnings.push(`${RELATION_LABELS[field] || 'Relationship'} cannot reference the course itself.`);
        continue;
      }
      const related = byCode(raw);
      if (!related) {
        warnings.push(`Unknown course: ${raw}`);
        continue;
      }
      const relatedColumn = courseColumnIndex(related);
      if ((field === 'prerequisites' || field === 'electivePrerequisites') && relatedColumn > currentColumn) {
        warnings.push(`${related.courseNo} is scheduled after ${course.courseNo}.`);
      }
      if (field === 'corequisites' && relatedColumn !== currentColumn) {
        warnings.push(`${related.courseNo} is not in the same term as ${course.courseNo}.`);
      }
      const otherFields = [...RELATION_FIELDS].filter(name => name !== field);
      if (otherFields.some(name => (course[name] || []).some(code => normalize(code) === key))) {
        warnings.push(`${related.courseNo} is already used in another relationship type.`);
      }
      if ((field === 'prerequisites' || field === 'electivePrerequisites') && wouldCreateCycle(course, related)) {
        warnings.push(`Adding ${related.courseNo} would create a prerequisite cycle.`);
      }
    }
    return uniq(warnings);
  }

  function hardValidateRelation(course, field, codes) {
    const normalized = codes.map(normalize).filter(Boolean);
    if (normalized.length !== new Set(normalized).size) return 'The same course cannot be added twice.';
    for (const raw of codes) {
      const key = normalize(raw);
      if (!key) continue;
      if (key === normalize(course.courseNo)) return 'A course cannot reference itself.';
      const related = byCode(raw);
      if (!related) return `No course with Course No. “${raw}” exists.`;
      if ((field === 'prerequisites' || field === 'electivePrerequisites') && wouldCreateCycle(course, related)) {
        return `Adding ${related.courseNo} would create a prerequisite cycle.`;
      }
    }
    return null;
  }

  function setEditorMessage(courseId, message, kind = 'error') {
    if (!message) editorMessages.delete(courseId);
    else editorMessages.set(courseId, { message, kind });
  }

  function decorateCourseCodeInput(row, course) {
    const input = row.querySelector('input[data-f="courseNo"]');
    if (!(input instanceof HTMLInputElement)) return;
    const validate = () => {
      const value = input.value.trim();
      const duplicate = state.courses.find(item => item.id !== course.id && normalize(item.courseNo) === normalize(value));
      const invalid = !value ? 'Course No. is required.' : duplicate ? `Already used by ${duplicate.title || duplicate.courseNo}.` : '';
      input.classList.toggle('table-input-invalid', Boolean(invalid));
      input.setCustomValidity(invalid);
      let note = input.parentElement?.querySelector('.field-validation-note');
      if (invalid) {
        if (!note) {
          note = document.createElement('div');
          note.className = 'field-validation-note error';
          input.insertAdjacentElement('afterend', note);
        }
        note.textContent = invalid;
      } else note?.remove();
    };
    input.addEventListener('input', validate);
    validate();
  }

  function recommendationList(course, field, query = '', excluded = []) {
    const excludedSet = new Set(excluded.map(normalize));
    return state.courses
      .filter(candidate => candidate.id !== course.id && !excludedSet.has(normalize(candidate.courseNo)))
      .map(candidate => ({ candidate, score: recommendationScore(course, candidate, field, query) }))
      .filter(item => Number.isFinite(item.score))
      .sort((a, b) => b.score - a.score || courseColumnIndex(a.candidate) - courseColumnIndex(b.candidate) || normalize(a.candidate.courseNo).localeCompare(normalize(b.candidate.courseNo)))
      .slice(0, 10)
      .map(item => item.candidate);
  }

  function commitRelation(course, field, nextCodes, options = {}) {
    const error = hardValidateRelation(course, field, nextCodes);
    if (error) {
      setEditorMessage(course.id, error, 'error');
      renderTable();
      return false;
    }
    const warnings = relationWarnings(course, field, nextCodes).filter(message => !message.includes('would create a prerequisite cycle'));
    setEditorMessage(course.id, warnings[0] || '', warnings.length ? 'warning' : '');
    const before = [...course[field]];
    originalUpdateField(course.id, field, nextCodes.join(', '));

    if (field === 'corequisites') {
      const beforeSet = new Set(before.map(normalize));
      const nextSet = new Set(nextCodes.map(normalize));
      const currentCode = course.courseNo;
      for (const code of before) {
        if (nextSet.has(normalize(code))) continue;
        const other = byCode(code);
        if (!other) continue;
        const cleaned = other.corequisites.filter(value => normalize(value) !== normalize(currentCode));
        if (cleaned.length !== other.corequisites.length) originalUpdateField(other.id, 'corequisites', cleaned.join(', '));
      }
      for (const code of nextCodes) {
        if (beforeSet.has(normalize(code))) continue;
        const other = byCode(code);
        if (!other) continue;
        if (!other.corequisites.some(value => normalize(value) === normalize(currentCode))) {
          originalUpdateField(other.id, 'corequisites', [...other.corequisites, currentCode].join(', '));
        }
      }
    }

    if (!options.deferRender) renderTable();
    return true;
  }

  function buildPicker(row, course, field) {
    const input = row.querySelector(`input[data-f="${field}"]`);
    if (!(input instanceof HTMLInputElement) || input.dataset.enhancedRelation === 'true') return;
    input.dataset.enhancedRelation = 'true';
    input.classList.add('relation-input-native');
    input.tabIndex = -1;
    input.setAttribute('aria-hidden', 'true');

    const wrapper = document.createElement('div');
    wrapper.className = 'relation-picker';
    input.insertAdjacentElement('afterend', wrapper);

    const render = () => {
      const currentCourse = byId(course.id);
      if (!currentCourse) return;
      const values = [...currentCourse[field]];
      const warnings = relationWarnings(currentCourse, field, values);
      wrapper.innerHTML = `
        <div class="relation-chips">
          ${values.map(code => {
            const related = byCode(code);
            const invalid = !related;
            return `<span class="relation-chip${invalid ? ' invalid' : ''}" title="${escapeHtml(related ? `${related.title} · ${related.yearLevel} · ${related.semester}` : 'Unknown course reference')}">
              <span>${escapeHtml(code)}</span><button type="button" data-remove-code="${escapeHtml(code)}" aria-label="Remove ${escapeHtml(code)}">×</button>
            </span>`;
          }).join('')}
          <button class="relation-add-button" type="button" aria-expanded="false">+ Add</button>
        </div>
        ${warnings.length ? `<div class="relation-validation warning">${escapeHtml(warnings[0])}${warnings.length > 1 ? ` · +${warnings.length - 1} more` : ''}</div>` : ''}
        <div class="relation-popover" hidden>
          <input class="relation-search" type="search" autocomplete="off" placeholder="Search course no. or title…" aria-label="Search ${escapeHtml(RELATION_LABELS[field] || field)}" />
          <div class="relation-suggestions" role="listbox"></div>
        </div>`;

      const addButton = wrapper.querySelector('.relation-add-button');
      const popover = wrapper.querySelector('.relation-popover');
      const searchInput = wrapper.querySelector('.relation-search');
      const suggestions = wrapper.querySelector('.relation-suggestions');

      const refreshSuggestions = () => {
        if (!(searchInput instanceof HTMLInputElement) || !(suggestions instanceof HTMLElement)) return;
        const list = recommendationList(currentCourse, field, searchInput.value, currentCourse[field]);
        suggestions.innerHTML = list.length ? list.map(candidate => {
          const candidateColumn = courseColumnIndex(candidate);
          const targetColumn = courseColumnIndex(currentCourse);
          const relationHint = field === 'corequisites'
            ? candidateColumn === targetColumn ? 'Same term · recommended' : 'Different term'
            : candidateColumn < targetColumn ? 'Earlier term · recommended' : candidateColumn === targetColumn ? 'Same term' : 'Later term';
          return `<button type="button" class="relation-suggestion" data-course-id="${candidate.id}" role="option">
            <strong>${escapeHtml(candidate.courseNo)}</strong>
            <span>${escapeHtml(candidate.title || 'Untitled course')}</span>
            <small>${escapeHtml(`${candidate.yearLevel} · ${candidate.semester} · ${candidate.units || '—'} units · ${relationHint}`)}</small>
          </button>`;
        }).join('') : '<div class="relation-empty">No matching courses.</div>';
      };

      addButton?.addEventListener('click', () => {
        const open = popover?.hasAttribute('hidden');
        if (open) {
          popover.removeAttribute('hidden');
          addButton.setAttribute('aria-expanded', 'true');
          refreshSuggestions();
          requestAnimationFrame(() => searchInput?.focus());
        } else {
          popover?.setAttribute('hidden', '');
          addButton.setAttribute('aria-expanded', 'false');
        }
      });
      searchInput?.addEventListener('input', refreshSuggestions);
      searchInput?.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
          popover?.setAttribute('hidden', '');
          addButton?.setAttribute('aria-expanded', 'false');
          addButton?.focus();
        }
      });
      suggestions?.addEventListener('click', event => {
        const button = event.target instanceof Element ? event.target.closest('.relation-suggestion') : null;
        if (!(button instanceof HTMLButtonElement)) return;
        const candidate = state.courses.find(item => item.id === button.dataset.courseId);
        if (!candidate) return;
        const next = [...currentCourse[field], candidate.courseNo];
        commitRelation(currentCourse, field, next);
      });
      wrapper.querySelectorAll('[data-remove-code]').forEach(button => {
        button.addEventListener('click', () => {
          const code = button.getAttribute('data-remove-code') || '';
          commitRelation(currentCourse, field, currentCourse[field].filter(value => normalize(value) !== normalize(code)));
        });
      });
    };

    render();
  }

  function decorateRows() {
    tbody.querySelectorAll('tr[data-id]').forEach(row => {
      const course = byId(row.getAttribute('data-id') || '');
      if (!course) return;
      decorateCourseCodeInput(row, course);
      for (const field of RELATION_FIELDS) buildPicker(row, course, field);
      const message = editorMessages.get(course.id);
      if (message) {
        const actionCell = row.querySelector('.row-actions');
        if (actionCell && !actionCell.querySelector('.row-validation-note')) {
          const note = document.createElement('div');
          note.className = `row-validation-note ${message.kind || 'warning'}`;
          note.textContent = message.message;
          actionCell.prepend(note);
        }
      }
    });
  }

  renderTable = () => {
    originalRenderTable();
    decorateRows();
  };

  updateField = (id, field, value, oldCode) => {
    const course = byId(id);
    if (!course) return;
    if (field === 'courseNo') {
      const next = String(value || '').trim();
      if (!next) {
        setEditorMessage(id, 'Course No. is required.', 'error');
        renderTable();
        return;
      }
      const duplicate = state.courses.find(item => item.id !== id && normalize(item.courseNo) === normalize(next));
      if (duplicate) {
        setEditorMessage(id, `Course No. ${next} already exists.`, 'error');
        renderTable();
        return;
      }
      setEditorMessage(id, '', '');
      originalUpdateField(id, field, next, oldCode);
      renderTable();
      return;
    }
    if (RELATION_FIELDS.has(field)) {
      const nextCodes = String(value || '').split(',').map(part => part.trim()).filter(Boolean);
      commitRelation(course, field, nextCodes);
      return;
    }
    originalUpdateField(id, field, value, oldCode);
  };

  function installStyles() {
    if (document.querySelector('#curriculum-smart-editor-styles')) return;
    const style = document.createElement('style');
    style.id = 'curriculum-smart-editor-styles';
    style.textContent = `
      .relation-input-native{display:none!important}
      .relation-picker{position:relative;min-width:190px}
      .relation-chips{display:flex;flex-wrap:wrap;gap:5px;align-items:center;min-height:34px}
      .relation-chip{display:inline-flex;align-items:center;gap:4px;max-width:170px;padding:4px 6px;border:1px solid #c8d4e6;border-radius:999px;background:#f5f8fd;color:#23324a;font-size:.74rem;font-weight:650}
      .relation-chip.invalid{border-color:#d92d20;background:#fff1f0;color:#9f1c12}
      .relation-chip button{border:0;background:transparent;color:inherit;font:inherit;font-size:1rem;line-height:.8;cursor:pointer;padding:0 1px}
      .relation-add-button{border:1px dashed #9aa9be;border-radius:999px;background:#fff;color:#334a6f;padding:4px 8px;font:inherit;font-size:.74rem;font-weight:700;cursor:pointer}
      .relation-popover{position:absolute;z-index:80;left:0;top:calc(100% + 5px);width:min(360px,75vw);padding:8px;border:1px solid #cfd8e6;border-radius:10px;background:#fff;box-shadow:0 12px 32px rgba(24,39,70,.18)}
      .relation-search{width:100%;border:1px solid #c9d3e2;border-radius:7px;padding:8px 9px;font:inherit;font-size:.8rem}
      .relation-suggestions{display:grid;gap:4px;margin-top:7px;max-height:280px;overflow:auto}
      .relation-suggestion{display:grid;grid-template-columns:auto 1fr;gap:2px 8px;text-align:left;border:0;border-radius:7px;background:#fff;padding:7px 8px;cursor:pointer;color:#1d2a3e}
      .relation-suggestion:hover,.relation-suggestion:focus{background:#eef4ff;outline:none}
      .relation-suggestion strong{grid-row:1 / span 2;align-self:center;color:#174d99;white-space:nowrap}
      .relation-suggestion span{font-size:.78rem;font-weight:650}
      .relation-suggestion small{font-size:.68rem;color:#65738a}
      .relation-empty{padding:10px;color:#6c788b;font-size:.76rem;text-align:center}
      .relation-validation,.field-validation-note,.row-validation-note{margin-top:4px;font-size:.68rem;line-height:1.25}
      .relation-validation.warning,.row-validation-note.warning{color:#9a5c00}
      .field-validation-note.error,.row-validation-note.error{color:#b42318}
      .table-input-invalid{border-color:#d92d20!important;box-shadow:0 0 0 1px rgba(217,45,32,.12)}
      .smart-course-dialog{border:0;border-radius:14px;padding:0;width:min(760px,calc(100vw - 28px));max-height:88vh;box-shadow:0 24px 70px rgba(18,31,54,.28)}
      .smart-course-dialog::backdrop{background:rgba(15,23,42,.45)}
      .smart-course-form{display:grid;gap:14px;padding:18px}
      .smart-course-form h2{margin:0;font-size:1.12rem;color:#172033}
      .smart-course-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
      .smart-course-field{display:grid;gap:4px;font-size:.75rem;font-weight:700;color:#425069}
      .smart-course-field.full{grid-column:1/-1}
      .smart-course-field input,.smart-course-field select{width:100%;border:1px solid #cbd5e3;border-radius:7px;padding:8px 9px;font:inherit;color:#172033;background:#fff}
      .draft-relations{display:grid;gap:10px}
      .draft-relation{border:1px solid #dde4ee;border-radius:9px;padding:9px}
      .draft-relation-title{font-size:.75rem;font-weight:800;color:#33445e;margin-bottom:6px}
      .draft-relation-search{width:100%;border:1px solid #cbd5e3;border-radius:7px;padding:7px 8px;font:inherit;font-size:.78rem;margin-top:6px}
      .draft-suggestions{display:grid;gap:3px;margin-top:5px;max-height:150px;overflow:auto}
      .dialog-actions{display:flex;justify-content:flex-end;gap:8px}
      .dialog-error{color:#b42318;font-size:.75rem;font-weight:650;min-height:1em}
      @media(max-width:700px){.smart-course-grid{grid-template-columns:1fr}.smart-course-field.full{grid-column:auto}.relation-popover{position:fixed;left:12px;right:12px;top:auto;bottom:12px;width:auto}}
    `;
    document.head.append(style);
  }

  function createDialog() {
    let dialog = document.querySelector('#smart-add-course-dialog');
    if (dialog instanceof HTMLDialogElement) return dialog;
    dialog = document.createElement('dialog');
    dialog.id = 'smart-add-course-dialog';
    dialog.className = 'smart-course-dialog';
    dialog.innerHTML = `
      <form method="dialog" class="smart-course-form">
        <h2>Add course</h2>
        <div class="smart-course-grid">
          <label class="smart-course-field"><span>Course No.</span><input name="courseNo" autocomplete="off" required /></label>
          <label class="smart-course-field"><span>Units</span><input name="units" value="3" autocomplete="off" /></label>
          <label class="smart-course-field full"><span>Course descriptive title</span><input name="title" autocomplete="off" required /></label>
          <label class="smart-course-field"><span>Year level</span><select name="yearLevel"></select></label>
          <label class="smart-course-field"><span>Semester</span><select name="semester"></select></label>
          <label class="smart-course-field full"><span>Track</span><input name="track" value="Common" list="track-options" /></label>
        </div>
        <div class="draft-relations"></div>
        <div class="dialog-error" role="alert"></div>
        <div class="dialog-actions"><button type="button" class="secondary-button" data-dialog-cancel>Cancel</button><button type="submit" class="primary-button">Add course</button></div>
      </form>`;
    document.body.append(dialog);
    return dialog;
  }

  function openAddCourseDialog() {
    const dialog = createDialog();
    const form = dialog.querySelector('form');
    const relationHost = dialog.querySelector('.draft-relations');
    const errorHost = dialog.querySelector('.dialog-error');
    if (!(form instanceof HTMLFormElement) || !(relationHost instanceof HTMLElement) || !(errorHost instanceof HTMLElement)) return;
    const draft = {
      courseNo: '', title: '', units: '3', yearLevel: 'First Year', semester: 'First Semester', track: 'Common',
      prerequisites: [], corequisites: [], electivePrerequisites: [], otherRequirements: [],
    };
    const yearSelect = form.elements.namedItem('yearLevel');
    const termSelect = form.elements.namedItem('semester');
    if (yearSelect instanceof HTMLSelectElement) yearSelect.innerHTML = uniq([...YEAR_ORDER, ...state.courses.map(course => course.yearLevel)]).map(value => `<option>${escapeHtml(value)}</option>`).join('');
    if (termSelect instanceof HTMLSelectElement) termSelect.innerHTML = uniq([...TERM_ORDER, ...state.courses.map(course => course.semester)]).map(value => `<option>${escapeHtml(value)}</option>`).join('');

    const syncDraft = () => {
      const data = new FormData(form);
      draft.courseNo = String(data.get('courseNo') || '').trim();
      draft.title = String(data.get('title') || '').trim();
      draft.units = String(data.get('units') || '').trim();
      draft.yearLevel = String(data.get('yearLevel') || 'First Year');
      draft.semester = String(data.get('semester') || 'First Semester');
      draft.track = String(data.get('track') || 'Common').trim() || 'Common';
    };

    const renderDraftRelations = () => {
      syncDraft();
      relationHost.innerHTML = [...RELATION_FIELDS].map(field => `
        <div class="draft-relation" data-draft-field="${field}">
          <div class="draft-relation-title">${escapeHtml(RELATION_LABELS[field])}</div>
          <div class="relation-chips">${draft[field].map(code => `<span class="relation-chip"><span>${escapeHtml(code)}</span><button type="button" data-draft-remove="${escapeHtml(code)}">×</button></span>`).join('')}</div>
          <input class="draft-relation-search" type="search" placeholder="Search existing courses…" autocomplete="off" />
          <div class="draft-suggestions"></div>
        </div>`).join('');

      relationHost.querySelectorAll('.draft-relation').forEach(section => {
        const field = section.getAttribute('data-draft-field');
        const searchBox = section.querySelector('.draft-relation-search');
        const suggestions = section.querySelector('.draft-suggestions');
        if (!RELATION_FIELDS.has(field) || !(searchBox instanceof HTMLInputElement) || !(suggestions instanceof HTMLElement)) return;
        const pseudoTarget = { id: '__draft__', ...draft };
        const refresh = () => {
          syncDraft();
          Object.assign(pseudoTarget, draft);
          const list = recommendationList(pseudoTarget, field, searchBox.value, draft[field]);
          suggestions.innerHTML = list.slice(0, 6).map(candidate => `<button type="button" class="relation-suggestion" data-draft-add="${candidate.id}"><strong>${escapeHtml(candidate.courseNo)}</strong><span>${escapeHtml(candidate.title)}</span><small>${escapeHtml(`${candidate.yearLevel} · ${candidate.semester}`)}</small></button>`).join('') || '<div class="relation-empty">No matching courses.</div>';
        };
        refresh();
        searchBox.addEventListener('input', refresh);
        suggestions.addEventListener('click', event => {
          const button = event.target instanceof Element ? event.target.closest('[data-draft-add]') : null;
          if (!(button instanceof HTMLButtonElement)) return;
          const candidate = state.courses.find(course => course.id === button.getAttribute('data-draft-add'));
          if (!candidate || draft[field].some(code => normalize(code) === normalize(candidate.courseNo))) return;
          draft[field].push(candidate.courseNo);
          renderDraftRelations();
        });
        section.querySelectorAll('[data-draft-remove]').forEach(button => button.addEventListener('click', () => {
          const code = button.getAttribute('data-draft-remove') || '';
          draft[field] = draft[field].filter(value => normalize(value) !== normalize(code));
          renderDraftRelations();
        }));
      });
    };

    form.oninput = event => {
      syncDraft();
      if (event.target instanceof HTMLInputElement && event.target.name === 'courseNo') {
        const duplicate = state.courses.find(course => normalize(course.courseNo) === normalize(draft.courseNo));
        errorHost.textContent = !draft.courseNo ? '' : duplicate ? `Course No. ${draft.courseNo} already exists (${duplicate.title}).` : 'Course No. is available.';
        errorHost.style.color = duplicate ? '#b42318' : '#18794e';
      }
    };
    form.onchange = () => { syncDraft(); renderDraftRelations(); };
    dialog.querySelector('[data-dialog-cancel]')?.addEventListener('click', () => dialog.close(), { once: true });
    form.onsubmit = event => {
      event.preventDefault();
      syncDraft();
      const duplicate = state.courses.find(course => normalize(course.courseNo) === normalize(draft.courseNo));
      if (!draft.courseNo) { errorHost.textContent = 'Course No. is required.'; return; }
      if (duplicate) { errorHost.textContent = `Course No. ${draft.courseNo} already exists.`; return; }
      if (!draft.title) { errorHost.textContent = 'Course descriptive title is required.'; return; }
      const id = `course-${crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`}`;
      const course = { id, ...draft };
      state.courses.push(course);
      state.positions[id] = defaultPos(course);
      setBasicRouting();
      renderTrackControls();
      save();
      renderTable();
      renderFlow();
      dialog.close();
      status.textContent = 'Saved locally';
    };
    errorHost.textContent = '';
    errorHost.style.color = '';
    renderDraftRelations();
    dialog.showModal();
    requestAnimationFrame(() => form.elements.namedItem('courseNo')?.focus());
  }

  function installAddCourseOverride() {
    const button = document.querySelector('#add-course');
    if (!(button instanceof HTMLButtonElement)) return;
    document.addEventListener('click', event => {
      const target = event.target instanceof Element ? event.target.closest('#add-course') : null;
      if (target !== button) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      openAddCourseDialog();
    }, true);
  }

  installStyles();
  installAddCourseOverride();
  renderTable();
})();
