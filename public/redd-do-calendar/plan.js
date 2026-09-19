// Plan Module - Wraps redd-plan functionality for use in redd-do
// This module can be initialized/destroyed and uses namespaced storage

const PlanModule = (function () {
    'use strict';

    let isInitialized = false;
    let container = null;

    // Storage prefix to avoid conflicts with main redd-do storage.
    // The default serves the planner's Calendar tab. A host can pass its
    // own prefix to init() so two surfaces on one origin keep separate
    // state (the To-Do tab's Planner View does this).
    const DEFAULT_STORAGE_PREFIX = 'redd-do-plan-';
    let STORAGE_PREFIX = DEFAULT_STORAGE_PREFIX;

    // State variables (same as redd-plan but scoped to module)
    let currentYear = new Date().getFullYear();
    // Start month and year for the leftmost visible column
    let startMonth = new Date().getMonth(); // 0-11
    let startYear = currentYear;
    const MONTHS_TO_RENDER = 12; // Render 12 months at a time
    const COLUMN_WIDTH = 252; // 240px + 12px gap
    let VIEW_MODE_KEY;
    let WEEK_GOALS_KEY;
    let TASK_TIMES_KEY;
    const WEEK_VIEW_START_HOUR = 7;
    const WEEK_VIEW_END_HOUR = 22;
    const WEEK_VIEW_HOUR_HEIGHT = 44;
    let calendarViewMode = 'months'; // 'months' | 'week'
    let weekStartDate = getMondayOfWeek(new Date());
    let weekGoalsByWeek = {};
    let editingGoalId = null;
    let weekGoalDropHighlightEl = null;
    let isWeekGoalDragInProgress = false;
    let currentLanguage = 'en';
    let freeformNotes = [];
    let freeformLines = [];
    let groups = [];
    let activeGroup = 'personal';
    let selectedElements = [];  // Array for multi-select support
    let lastDeletedItem = null;
    let undoStack = [];
    let redoStack = [];
    const MAX_HISTORY = 50;

    // DOM references (will be set on init)
    let calendarContainer = null;
    let canvasLayer = null;
    let resizeObserver = null;
    let resizeTimer = null;
    let onWindowResize = null;

    // Flag to prevent re-rendering during drag operations
    let isDragInProgress = false;

    // Constants
    const MONTHS_DA = ['Januar', 'Februar', 'Marts', 'April', 'Maj', 'Juni',
        'Juli', 'August', 'September', 'Oktober', 'November', 'December'];
    const MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'];
    const WEEKDAYS_DA = ['Ma', 'Ti', 'On', 'To', 'Fr', 'Lø', 'Sø'];
    const WEEKDAYS_EN = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
    // Three letters, for the head of a day in the week view: a full name went
    // onto two lines in a narrow day, and that day then stood lower than the rest.
    const WEEKDAYS_THREE_DA = ['Man', 'Tir', 'Ons', 'Tor', 'Fre', 'Lør', 'Søn'];
    const WEEKDAYS_THREE_EN = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const WEEKDAYS_FULL_DA = ['Mandag', 'Tirsdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lørdag', 'Søndag'];
    const WEEKDAYS_FULL_EN = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    // Who a week goal can be for. The host gives the list and it is the To-Do
    // people list, the same one a task is assigned from. So a person added
    // here can be given a task, and a person added on the board shows here.
    // This file holds no names of its own.
    let goalPeople = [];        // [{ id, name, colour, photoUrl, initials, shortName }]
    let addGoalPerson = null;   // (name) => Promise<{ id, name, colour } | null>
    // The host's own menu for "who is it for": the one a task is assigned
    // from, so a goal and a task show the same people in the same way. Called
    // with { anchorEl, assigneeId, onPick(id | null), onLeave() } to open it, and with
    // null to put it away. With no host menu, the card draws a plain list.
    let pickGoalPerson = null;
    let goalPeopleKey = '';

    // A person as the host gives one. The photo, the letters and the short
    // name are the host's, so they are the same as on a task.
    function toGoalPerson(p) {
        return {
            id: String(p.id),
            name: String(p.name),
            colour: typeof p.colour === 'string' ? p.colour : null,
            photoUrl: typeof p.photoUrl === 'string' && p.photoUrl ? p.photoUrl : null,
            initials: typeof p.initials === 'string' && p.initials ? p.initials : null,
            shortName: typeof p.shortName === 'string' && p.shortName ? p.shortName : null,
        };
    }
    const GOAL_ADD_PERSON_VALUE = '__add-person__';

    function firstNameOf(name) {
        return String(name || '').trim().split(/\s+/)[0] || '';
    }

    // "Vera" when one Vera is on the list, "Vera H." when there are two.
    function shortGoalPersonName(person) {
        if (person.shortName) return person.shortName;
        const first = firstNameOf(person.name);
        const sameFirst = goalPeople.filter(
            (p) => firstNameOf(p.name).toLowerCase() === first.toLowerCase()
        );
        if (sameFirst.length < 2) return first;
        const parts = String(person.name).trim().split(/\s+/);
        const last = parts.length > 1 ? parts[parts.length - 1] : '';
        return last ? `${first} ${last[0].toUpperCase()}.` : first;
    }

    // A goal keeps the id of a person. A goal made before the people list was
    // shared kept a first name in lower case. Such a goal is matched by first
    // name, and only when exactly one person has that name. The stored value is
    // left as it is until the goal is next saved.
    function findGoalPerson(key) {
        if (!key) return null;
        const byId = goalPeople.find((p) => p.id === key);
        if (byId) return byId;
        const wanted = String(key).toLowerCase();
        const byName = goalPeople.filter(
            (p) => firstNameOf(p.name).toLowerCase() === wanted
        );
        return byName.length === 1 ? byName[0] : null;
    }

    function setPeople(people) {
        const next = (Array.isArray(people) ? people : [])
            .filter((p) => p && p.id && p.name)
            .map(toGoalPerson);
        // The same people as before: nothing to draw again. See setTasks.
        const key = JSON.stringify(next);
        if (key === goalPeopleKey && isInitialized) return;
        goalPeopleKey = key;
        goalPeople = next;
        if (!container) return;
        const select = container.querySelector('.plan-week-goal-assignee-select');
        fillGoalAssigneeSelect(select ? select.value : '');
        renderWeekGoals();
    }

    function fillGoalAssigneeSelect(selected) {
        const select = container?.querySelector('.plan-week-goal-assignee-select');
        if (!select) return;
        select.textContent = '';
        const option = (value, label) => {
            const el = document.createElement('option');
            el.value = value;
            el.textContent = label;
            select.appendChild(el);
        };
        option('', 'No one');
        for (const person of goalPeople) option(person.id, person.name);
        if (addGoalPerson) option(GOAL_ADD_PERSON_VALUE, 'Add a person…');
        const person = findGoalPerson(selected);
        select.value = person ? person.id : '';
        // With nobody to pick and no way to add one, the menu says nothing.
        select.classList.toggle('hidden', goalPeople.length === 0 && !addGoalPerson);
    }

    function hideGoalPersonInput() {
        const input = container?.querySelector('.plan-week-goal-person-input');
        if (!input) return;
        input.value = '';
        input.classList.add('hidden');
    }

    async function addGoalPersonFromInput() {
        const input = container?.querySelector('.plan-week-goal-person-input');
        const name = input?.value.trim();
        if (!name || !addGoalPerson) return;
        input.disabled = true;
        try {
            const person = await addGoalPerson(name);
            if (person && person.id) {
                if (!goalPeople.some((p) => p.id === person.id)) {
                    goalPeople = [...goalPeople, toGoalPerson({ ...person, name: person.name || name })];
                }
                fillGoalAssigneeSelect(String(person.id));
                renderWeekGoals();
            }
        } catch (err) {
            console.error('[plan] could not add the person', err);
        } finally {
            input.disabled = false;
            hideGoalPersonInput();
            container?.querySelector('.plan-week-goal-text-input')?.focus();
        }
    }
    const GOAL_DRAG_THRESHOLD_PX = 6;

    function getMondayOfWeek(date) {
        const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
        const weekday = d.getDay() === 0 ? 6 : d.getDay() - 1;
        d.setDate(d.getDate() - weekday);
        return d;
    }

    function formatDateKey(date) {
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    }

    // ------------------------------------------------------------------
    // One space for the pointer and for the places of elements.
    //
    // The desktop app zooms its page with the CSS `zoom` of the shell (Cmd +
    // and Cmd -). Under a zoom, the pointer of an event is in the pixels of
    // the screen. The place of an element comes back from the web view in one
    // of two ways: in unzoomed pixels (the Mac app's web view), or in the
    // pixels of the screen (a newer Chromium, as on Windows). A style such as
    // `left` always counts in unzoomed pixels. This file mixed the three, so
    // at 120% a click, a drag and a drop all went off to the bottom right.
    //
    // Everything here now counts in unzoomed pixels: `pointerX(e)` and
    // `pointerY(e)` for an event, `rectOf(el)` for an element. The raw
    // `clientX` is for the browser only (elementsFromPoint, the caret), and
    // `toScreen` turns a place back for the host and for a thing on the body.
    // ------------------------------------------------------------------
    let zoomRead = { at: 0, zoom: 1, rectScale: 1 };

    function zoomInfo() {
        const now = Date.now();
        if (now - zoomRead.at < 200) return zoomRead;
        let zoom = 1;
        let rectScale = 1;
        if (container) {
            const declared = parseFloat(getComputedStyle(container).getPropertyValue('--todo-zoom'));
            if (Number.isFinite(declared) && declared > 0) zoom = declared;
            // How the web view gives the place of an element: as wide as it is
            // drawn (then it is zoomed already), or as wide as its style says.
            const drawn = container.getBoundingClientRect().width;
            const styled = container.offsetWidth;
            if (zoom !== 1 && styled > 0 && Math.abs(drawn / styled - zoom) < 0.03) rectScale = zoom;
        }
        zoomRead = { at: now, zoom, rectScale };
        return zoomRead;
    }

    function pointerX(event) { return event.clientX / zoomInfo().zoom; }
    function pointerY(event) { return event.clientY / zoomInfo().zoom; }

    function rectOf(el) {
        const r = el.getBoundingClientRect();
        const k = zoomInfo().rectScale;
        if (k === 1) return r;
        return {
            left: r.left / k, top: r.top / k, right: r.right / k, bottom: r.bottom / k,
            width: r.width / k, height: r.height / k, x: r.x / k, y: r.y / k,
        };
    }

    // Unzoomed pixels to the pixels of the screen: for the host, and for a
    // thing that is put on the body, outside the zoomed shell.
    function toScreen(value) { return value * zoomInfo().zoom; }

    // "2026-09-21" as a date at local midnight.
    function parseDateKey(dateKey) {
        const [y, m, d] = String(dateKey).split('-').map(Number);
        return new Date(y, (m || 1) - 1, d || 1);
    }

    function addDays(date, days) {
        const next = new Date(date.getFullYear(), date.getMonth(), date.getDate());
        next.setDate(next.getDate() + days);
        return next;
    }

    function formatMinutesAsTime(minutes) {
        const hours = Math.floor(minutes / 60);
        const mins = minutes % 60;
        const date = new Date(2000, 0, 1, hours, mins);
        return date.toLocaleTimeString([], {
            hour: 'numeric',
            minute: mins ? '2-digit' : undefined,
        });
    }

    // The week view scrolls sideways by the day. It draws one more day at each
    // side of the seven, out of sight, so a day can slide in. A narrow window
    // scrolls its seven days in the old way, with no hidden days.
    function weekCarouselOn() {
        return !window.matchMedia('(max-width: 900px)').matches;
    }

    function weekRenderedRange() {
        const buffer = weekCarouselOn() ? 1 : 0;
        return { first: -buffer, last: 6 + buffer };
    }

    function isDateInVisibleWeek(dateKey) {
        const { first, last } = weekRenderedRange();
        const weekStartKey = formatDateKey(addDays(weekStartDate, first));
        const weekEndKey = formatDateKey(addDays(weekStartDate, last));
        return dateKey >= weekStartKey && dateKey <= weekEndKey;
    }

    function noteDisplayText(note) {
        if (note.html) {
            const tmp = document.createElement('div');
            tmp.innerHTML = note.html;
            return tmp.textContent || 'Note';
        }
        return note.text || 'Note';
    }

    // Calculate Easter Sunday using the Anonymous Gregorian algorithm
    function getEasterSunday(year) {
        const a = year % 19;
        const b = Math.floor(year / 100);
        const c = year % 100;
        const d = Math.floor(b / 4);
        const e = b % 4;
        const f = Math.floor((b + 8) / 25);
        const g = Math.floor((b - f + 1) / 3);
        const h = (19 * a + b - d - g + 15) % 30;
        const i = Math.floor(c / 4);
        const k = c % 4;
        const l = (32 + 2 * e + 2 * i - h - k) % 7;
        const m = Math.floor((a + 11 * h + 22 * l) / 451);
        const month = Math.floor((h + l - 7 * m + 114) / 31) - 1;
        const day = ((h + l - 7 * m + 114) % 31) + 1;
        return new Date(year, month, day);
    }

    // Get holidays for a given year (cached per year/language)
    let holidayCache = {};
    function getHolidays(year) {
        const cacheKey = `${year}-${currentLanguage}`;
        if (holidayCache[cacheKey]) return holidayCache[cacheKey];

        const easter = getEasterSunday(year);
        const holidays = {};

        const addDays = (date, days) => {
            const result = new Date(date);
            result.setDate(result.getDate() + days);
            return result;
        };

        const formatKey = (date) => {
            const m = String(date.getMonth() + 1).padStart(2, '0');
            const d = String(date.getDate()).padStart(2, '0');
            return `${date.getFullYear()}-${m}-${d}`;
        };

        if (currentLanguage === 'da') {
            // Danish holidays
            holidays[formatKey(addDays(easter, -7))] = 'Palmesøndag';
            holidays[formatKey(addDays(easter, -3))] = 'Skærtorsdag';
            holidays[formatKey(addDays(easter, -2))] = 'Langfredag';
            holidays[formatKey(easter)] = 'Påskedag';
            holidays[formatKey(addDays(easter, 1))] = '2. påskedag';
            holidays[formatKey(addDays(easter, 39))] = 'Kr. himmelfartsdag';
            holidays[formatKey(addDays(easter, 49))] = 'Pinsedag';
            holidays[formatKey(addDays(easter, 50))] = '2. pinsedag';
            holidays[`${year}-01-01`] = 'Nytårsdag';
            holidays[`${year}-06-05`] = 'Grundlovsdag';
            holidays[`${year}-12-24`] = 'Juleaften';
            holidays[`${year}-12-25`] = 'Juledag';
            holidays[`${year}-12-26`] = '2. Juledag';
        } else {
            // English holidays (universal)
            holidays[formatKey(addDays(easter, -7))] = 'Palm Sunday';
            holidays[formatKey(addDays(easter, -3))] = 'Maundy Thursday';
            holidays[formatKey(addDays(easter, -2))] = 'Good Friday';
            holidays[formatKey(easter)] = 'Easter Sunday';
            holidays[formatKey(addDays(easter, 1))] = 'Easter Monday';
            holidays[`${year}-01-01`] = "New Year's Day";
            holidays[`${year}-12-24`] = 'Christmas Eve';
            holidays[`${year}-12-25`] = 'Christmas Day';
        }

        holidayCache[cacheKey] = holidays;
        return holidays;
    }

    // Open application deadlines, when the Applications tab has them on.
    // CalendarView puts them on window before a render. Like holidays, they
    // are drawn fresh each time and never saved into the notes.
    function createDeadlineEl(dateKey, className) {
        const all = window.PlanApplicationDeadlines;
        if (!Array.isArray(all)) return null;
        const names = all.filter(d => d && d.dateKey === dateKey).map(d => d.name);
        if (!names.length) return null;
        const el = document.createElement('span');
        el.className = className + ' application-deadline';
        el.appendChild(createDeadlineIcon());
        el.appendChild(document.createTextNode(names.join(' · ')));
        return el;
    }

    // A small flag in place of the word "Deadline". Its size is set on the
    // SVG itself, so it stays small wherever it lands.
    function createDeadlineIcon() {
        const label = currentLanguage === 'da' ? 'Frist' : 'Deadline';
        const wrap = document.createElement('span');
        wrap.innerHTML = `<svg class="application-deadline-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" role="img" aria-label="${label}"><title>${label}</title><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" x2="4" y1="22" y2="15"/></svg>`;
        return wrap.firstChild;
    }

    // Tasks from the To-Do board that the reader asked to see here: a task
    // with a due date, on its due day. The host gives the list with
    // setTasks, as it gives the people. Like deadlines and holidays, they
    // are drawn fresh each time and never saved into the notes, so a task
    // that is done, or that loses its date, is gone at the next draw.
    let calendarTasks = [];   // [{ id, dateKey, name, minutes, listName, initials, icon }]

    // The hours a task has in the week view: { [taskId]: { startMinutes, endMinutes } }.
    // The day is the task's own due day, so only the hours are kept here. The
    // host can let a task go to another day (onTaskDueChange); with no host
    // for that, a task moves up and down in its own day.
    let taskTimes = {};
    let changeTaskDue = null;
    // The host opens a task for editing (a double click on it here), beside
    // the place it is given.
    let openTask = null;
    // The host makes a new task for a day (a double click on the day here).
    // It gets the day, the time when the click was in the hours of the week
    // view, and the place on the screen to put its box beside.
    let createTask = null;
    // Every task of the board, for a goal to be linked to: [{ id, name,
    // listName, completed }]. The host gives them, as it gives the people.
    let linkableTasks = [];
    // The person who is the reader, when the host knows: a new goal is theirs.
    let mePersonId = null;

    // The host sends its tasks again at each change of the board: a tick
    // elsewhere, the time that a focus window saves every 30 seconds. When the
    // tasks that matter here are the same as before, nothing is drawn again.
    let linkableTasksKey = '';
    let calendarTasksKey = '';

    function setLinkableTasks(tasks) {
        const next = (Array.isArray(tasks) ? tasks : [])
            .filter((t) => t && t.id && t.name)
            .map((t) => ({ id: String(t.id), name: String(t.name), listName: t.listName ? String(t.listName) : '', completed: Boolean(t.completed) }));
        const key = JSON.stringify(next);
        if (key === linkableTasksKey) return;
        linkableTasksKey = key;
        linkableTasks = next;
        // Only the counts on the goals change with this. An open goal card stays as it is.
        if (container && isInitialized && calendarViewMode === 'week' && !goalEditorEl) renderWeekGoals();
    }

    function setMe(personId) {
        mePersonId = personId ? String(personId) : null;
    }

    function loadTaskTimes() {
        try {
            const stored = JSON.parse(localStorage.getItem(TASK_TIMES_KEY) || '{}');
            taskTimes = stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {};
        } catch {
            taskTimes = {};
        }
    }

    function saveTaskTimes() {
        try {
            localStorage.setItem(TASK_TIMES_KEY, JSON.stringify(taskTimes));
        } catch {
            /* private mode */
        }
    }

    // For the host: a task that it made for a time of the day gets its hours.
    function setTaskTime(taskId, startMinutes, endMinutes) {
        if (!taskId || !Number.isFinite(startMinutes) || !Number.isFinite(endMinutes)) return;
        taskTimes[String(taskId)] = { startMinutes, endMinutes };
        saveTaskTimes();
        if (container && isInitialized && calendarViewMode === 'week') rerenderWeek();
    }

    function taskTimeOf(taskId) {
        const time = taskTimes[taskId];
        return time && Number.isFinite(time.startMinutes) && Number.isFinite(time.endMinutes) ? time : null;
    }

    // The shapes an icon can have. The host gives an icon as shape data, and
    // only these tags are made from it.
    const TASK_ICON_TAGS = ['path', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'rect'];

    function setTasks(tasks) {
        const next = (Array.isArray(tasks) ? tasks : [])
            .filter((t) => t && t.id && t.name && /^\d{4}-\d{2}-\d{2}$/.test(String(t.dateKey)))
            .map((t) => ({
                id: String(t.id),
                dateKey: String(t.dateKey),
                name: String(t.name),
                minutes: Number.isFinite(Number(t.minutes)) && Number(t.minutes) > 0 ? Number(t.minutes) : null,
                listName: t.listName ? String(t.listName) : '',
                initials: t.initials ? String(t.initials).slice(0, 2) : '',
                icon: Array.isArray(t.icon)
                    ? t.icon.filter((shape) => Array.isArray(shape) && TASK_ICON_TAGS.includes(shape[0]))
                    : [],
            }));
        const key = JSON.stringify(next);
        if (key === calendarTasksKey && isInitialized) return;
        calendarTasksKey = key;
        calendarTasks = next;
        if (!container || !isInitialized) return;
        renderCalendar();
        renderWeekGoals();
        scheduleLayoutRefresh();
    }

    // The mark of the task's list, as the board shows that list: its icon, or
    // its two letters when it has no icon. A task on no list gets a small
    // ticked circle, so it reads as a task and not as a note.
    function createTaskIcon(task) {
        const SVG = 'http://www.w3.org/2000/svg';
        if (!task.icon.length && task.initials) {
            const letters = document.createElement('span');
            letters.className = 'calendar-task-initials';
            letters.textContent = task.initials;
            return letters;
        }
        const svg = document.createElementNS(SVG, 'svg');
        svg.setAttribute('class', 'calendar-task-icon');
        svg.setAttribute('width', '12');
        svg.setAttribute('height', '12');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('fill', 'none');
        svg.setAttribute('stroke', 'currentColor');
        svg.setAttribute('stroke-width', task.icon.length ? '2.2' : '2.4');
        svg.setAttribute('stroke-linecap', 'round');
        svg.setAttribute('stroke-linejoin', 'round');
        svg.setAttribute('aria-hidden', 'true');
        const shapes = task.icon.length
            ? task.icon
            : [['circle', { cx: '12', cy: '12', r: '9' }], ['path', { d: 'm8.5 12.5 2.5 2.5 4.5-5' }]];
        shapes.forEach(([tag, attrs]) => {
            const shape = document.createElementNS(SVG, tag);
            Object.entries(attrs || {}).forEach(([name, value]) => {
                // "key" is the icon library's own label, not an SVG attribute.
                if (name !== 'key' && /^[a-z][a-z0-9-]*$/i.test(name) && !/^on/i.test(name)) {
                    shape.setAttribute(name, String(value));
                }
            });
            svg.appendChild(shape);
        });
        return svg;
    }

    // Where the task is on the screen, so the host can put its card beside it.
    function taskAnchorOf(el) {
        const r = rectOf(el);
        // The host counts in the pixels of the screen.
        return { left: toScreen(r.left), top: toScreen(r.top), right: toScreen(r.right), bottom: toScreen(r.bottom) };
    }

    // A click on a task opens it for editing, when the host can do that. In
    // the week view a task can also be dragged, and there the drag code says
    // when a press was a click (see setupWeekBlockDrag), so `byDrag` is set.
    function setupTaskOpen(el, task, byDrag) {
        if (!openTask) return;
        el.classList.add('calendar-task--opens');
        if (!byDrag) {
            el.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                openTask(task.id, taskAnchorOf(el));
            });
        }
        // A press on a task must not start a note or a highlight under it.
        el.addEventListener('mousedown', (event) => event.stopPropagation());
    }

    function createTaskItemEl(task, className) {
        const el = document.createElement('span');
        el.className = (className || 'plan-note-text') + ' calendar-task';
        const name = task.listName ? `${task.listName}: ${task.name}` : task.name;
        el.title = openTask ? `${name} — click to open` : name;
        el.appendChild(createTaskIcon(task));
        el.appendChild(document.createTextNode(task.name));
        // With a class name it is the week's all-day row, where it can be dragged too.
        setupTaskOpen(el, task, Boolean(className));
        return el;
    }

    // One application deadline, as one item of a month day (see renderMonthDays).
    function createDeadlineItemEl(deadline) {
        const el = document.createElement('span');
        el.className = 'plan-note-text application-deadline';
        el.appendChild(createDeadlineIcon());
        el.appendChild(document.createTextNode(deadline.name));
        return el;
    }

    const UI_TEXT = {
        da: {
            settings: 'Indstillinger', theme: 'Tema', language: 'Sprog',
            newItems: 'Nye elementer:', addGroup: 'Tilføj gruppe', personal: 'Personligt',
            work: 'Arbejde', data: 'Data', exportData: 'Eksporter', importData: 'Importer'
        },
        en: {
            settings: 'Settings', theme: 'Theme', language: 'Language',
            newItems: 'New items:', addGroup: 'Add Group', personal: 'Personal',
            work: 'Work', data: 'Data', exportData: 'Export', importData: 'Import'
        }
    };

    const DEFAULT_GROUPS = [
        { id: 'personal', translationKey: 'personal', color: '#2a9d8f', visible: true },
        { id: 'work', translationKey: 'work', color: '#d4605a', visible: true }
    ];

    // Storage keys — derived from the prefix, so a host-supplied prefix
    // renames all of them together. Set below and again in init().
    let NOTES_KEY;
    let LINES_KEY;
    let GROUPS_KEY;
    let ACTIVE_GROUP_KEY;
    let CALENDARS_KEY; // Array of {id, name, url, fontFamily, fontColor, lineColor}
    let CALENDAR_LAST_SYNC_KEY;
    let CALENDAR_CUSTOM_KEY; // Shared: where the reader moved or relabelled calendar events
    let CALENDAR_EVENTS_KEY; // This device only: the events as last fetched, for the first paint

    function applyStoragePrefix(prefix) {
        STORAGE_PREFIX = prefix;
        VIEW_MODE_KEY = STORAGE_PREFIX + 'calendar-view-mode';
        WEEK_GOALS_KEY = STORAGE_PREFIX + 'week-goals';
        TASK_TIMES_KEY = STORAGE_PREFIX + 'task-times';
        NOTES_KEY = STORAGE_PREFIX + 'freeform-notes';
        LINES_KEY = STORAGE_PREFIX + 'freeform-lines';
        GROUPS_KEY = STORAGE_PREFIX + 'groups';
        ACTIVE_GROUP_KEY = STORAGE_PREFIX + 'active-group';
        CALENDARS_KEY = STORAGE_PREFIX + 'calendars';
        CALENDAR_LAST_SYNC_KEY = STORAGE_PREFIX + 'calendar-last-sync';
        CALENDAR_CUSTOM_KEY = STORAGE_PREFIX + 'calendar-customisations';
        CALENDAR_EVENTS_KEY = STORAGE_PREFIX + 'calendar-events';
    }
    applyStoragePrefix(DEFAULT_STORAGE_PREFIX);
    // Use shared keys for theme and language (no prefix) so they sync with main app
    const SHARED_LANGUAGE_KEY = 'language';

    // Calendar sync state - supports multiple calendars with per-calendar styling
    let calendars = []; // [{id, name, url, fontFamily, fontColor, lineColor}, ...]
    let calendarLastSync = null;
    // The events as fetched, and what the reader changed on them: see loadCalendarItems.
    let calendarEventsCache = { notes: [], lines: [] };
    let calendarCustomisations = { notes: {}, lines: {} };
    // Syncing on its own: see startCalendarAutoSync.
    let syncCalendarsNow = null;
    let calendarSyncInFlight = null;
    let lastCalendarSyncStartedAt = 0;
    let calendarAutoSyncTimer = null;
    let onCalendarReturn = null;
    // The month day opened in place to show all its items: see renderMonthDays.
    let expandedDateKey = null;

    // Fresh in-memory state for init. Without this a destroy/init cycle
    // under a different storage prefix would keep the previous surface's
    // notes and calendars in memory (loadData only overwrites keys that
    // exist in storage).
    function resetState() {
        // A calendar that starts again takes the host's tasks as new.
        linkableTasksKey = '';
        calendarTasksKey = '';
        goalPeopleKey = '';
        currentYear = new Date().getFullYear();
        startMonth = new Date().getMonth();
        startYear = currentYear;
        calendarViewMode = 'months';
        weekStartDate = getMondayOfWeek(new Date());
        weekGoalsByWeek = {};
        editingGoalId = null;
        freeformNotes = [];
        freeformLines = [];
        groups = JSON.parse(JSON.stringify(DEFAULT_GROUPS));
        activeGroup = 'personal';
        selectedElements = [];
        lastDeletedItem = null;
        undoStack = [];
        redoStack = [];
        calendars = [];
        calendarLastSync = null;
        calendarEventsCache = { notes: [], lines: [] };
        calendarCustomisations = { notes: {}, lines: {} };
        expandedDateKey = null;
    }

    // options (all optional):
    //   storagePrefix — localStorage namespace; default 'redd-do-plan-'
    //   language     — 'en' | 'da'; default reads the shared 'language' key
    //   people       — [{ id, name, colour }], who a week goal can be for
    //   onAddPerson  — (name) => Promise<person>; adds to the host's people list
    //   onPickGoalPerson — the host's menu for who a goal is for; see pickGoalPerson
    //   tasks        — [{ id, dateKey, name }], tasks to show on their due day
    function init(containerElement, options) {
        if (isInitialized) return;
        container = containerElement;
        const opts = options || {};
        applyStoragePrefix(opts.storagePrefix || DEFAULT_STORAGE_PREFIX);
        resetState();

        addGoalPerson = typeof opts.onAddPerson === 'function' ? opts.onAddPerson : null;
        pickGoalPerson = typeof opts.onPickGoalPerson === 'function' ? opts.onPickGoalPerson : null;
        changeTaskDue = typeof opts.onTaskDueChange === 'function' ? opts.onTaskDueChange : null;
        openTask = typeof opts.onTaskOpen === 'function' ? opts.onTaskOpen : null;
        createTask = typeof opts.onTaskCreate === 'function' ? opts.onTaskCreate : null;
        setLinkableTasks(opts.linkableTasks);
        mePersonId = opts.mePersonId ? String(opts.mePersonId) : null;
        loadTaskTimes();
        setTasks(opts.tasks);

        // Create DOM structure
        container.innerHTML = getPlanHTML();
        setPeople(opts.people);

        // Get DOM references
        calendarContainer = container.querySelector('.plan-calendar-container');
        canvasLayer = container.querySelector('.plan-canvas-layer');

        // Initialize
        loadData();
        if (opts.language === 'en' || opts.language === 'da') {
            currentLanguage = opts.language;
        } else {
            loadLanguage();
        }
        setupEventListeners();
        setupCanvasInteraction();
        renderCalendar();
        updatePeriodDisplay();
        updateViewModeButtons();

        // Delay initial render of freeform elements to ensure DOM is fully laid out
        setTimeout(() => {
            renderFreeformElements();
            if (calendarViewMode === 'week') scrollWeekViewToCurrentTime();
        }, 100);
        setupToolbarListeners();
        setupResizeObserver();
        startCalendarAutoSync();
        onWindowResize = () => scheduleLayoutRefresh();
        window.addEventListener('resize', onWindowResize);

        isInitialized = true;
    }

    function setupResizeObserver() {
        const observeTarget = calendarContainer || container;
        if (!observeTarget || typeof ResizeObserver === 'undefined') return;

        let lastWidth = 0;
        resizeObserver = new ResizeObserver((entries) => {
            const width = entries[0]?.contentRect.width ?? 0;
            if (width <= 0) return;

            const widthDelta = lastWidth > 0 ? Math.abs(width - lastWidth) : 0;
            lastWidth = width;

            if (widthDelta > 200 && calendarViewMode === 'months') {
                renderCalendar();
            }
            scheduleLayoutRefresh();
        });
        resizeObserver.observe(observeTarget);
    }

    function scheduleLayoutRefresh() {
        if (!isInitialized || isDragInProgress) return;
        if (resizeTimer) clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            renderFreeformElements();
        }, 50);
    }

    function destroy() {
        if (!isInitialized) return;
        if (onCalendarKeyDown) {
            document.removeEventListener('keydown', onCalendarKeyDown);
            onCalendarKeyDown = null;
        }
        clearTimeout(redrawAfterWritingTimer);
        resizeObserver?.disconnect();
        resizeObserver = null;
        if (onWindowResize) {
            window.removeEventListener('resize', onWindowResize);
            onWindowResize = null;
        }
        if (resizeTimer) clearTimeout(resizeTimer);
        resizeTimer = null;
        stopCalendarAutoSync();
        container.innerHTML = '';
        isInitialized = false;
    }

    function getPlanHTML() {
        return `
            <div class="plan-app-container">
                <div class="plan-title-bar" data-tauri-drag-region="deep">
                    <div class="plan-period-nav">
                        <button class="plan-nav-btn plan-prev-period-btn" title="Previous Period">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"></polyline></svg>
                        </button>
                        <span class="plan-period-display">Jan – Jun 2026</span>
                        <button class="plan-nav-btn plan-today-btn hidden" title="Go to Today">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                        </button>
                        <button class="plan-nav-btn plan-next-period-btn" title="Next Period">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"></polyline></svg>
                        </button>
                    </div>

                    <div class="plan-view-switcher" role="group" aria-label="Calendar view">
                        <button type="button" class="plan-view-mode-btn active" data-view="months">Months</button>
                        <button type="button" class="plan-view-mode-btn" data-view="week">Week</button>
                    </div>

                    <div class="plan-undo-redo-nav">
                        <button class="plan-nav-btn plan-undo-btn" title="Undo" disabled>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11"/></svg>
                        </button>
                        <button class="plan-nav-btn plan-redo-btn" title="Redo" disabled>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 14 5-5-5-5"/><path d="M20 9H9.5A5.5 5.5 0 0 0 4 14.5A5.5 5.5 0 0 0 9.5 20H13"/></svg>
                        </button>
                    </div>
                    <div class="plan-calendar-sync-nav">
                        <div class="plan-calendar-toggles"></div>
                        <button class="plan-nav-btn plan-calendar-sync-all-btn" title="Sync All Calendars">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 16h5v5"/></svg>
                        </button>
                        <button class="plan-nav-btn plan-calendar-add-btn" title="Add Calendar">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 19h6"/><path d="M16 2v4"/><path d="M19 16v6"/><path d="M21 12.598V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h8.5"/><path d="M3 10h18"/><path d="M8 2v4"/></svg>
                        </button>
                    </div>
                </div>
                <div class="plan-week-goals hidden">
                    <div class="plan-week-goals-row">
                        <span class="plan-week-goals-label">Goals:</span>
                        <button type="button" class="plan-week-goal-add-btn" title="Add goal" aria-label="Add goal">+</button>
                        <div class="plan-week-goals-list"></div>
                    </div>
                    <div class="plan-week-goal-form hidden">
                        <input type="text" class="plan-week-goal-text-input" placeholder="Goal..." maxlength="120">
                        <select class="plan-week-goal-assignee-select" aria-label="Assign to"></select>
                        <input type="text" class="plan-week-goal-person-input hidden" placeholder="Name of the person..." maxlength="200" aria-label="Name of the person">
                        <button type="button" class="plan-week-goal-save-btn">Add</button>
                        <button type="button" class="plan-week-goal-cancel-btn">Cancel</button>
                    </div>
                </div>
                <div class="plan-calendar-container">
                    <div class="plan-calendar-grid"></div>
                    <div class="plan-canvas-layer"></div>
                </div>
            </div>
            <!-- Note Toolbar -->
            <div class="plan-note-toolbar plan-inline-toolbar hidden">
                <button class="plan-toolbar-btn" data-command="bold" title="Bold">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M15.6 10.79c.97-.67 1.65-1.77 1.65-2.79 0-2.26-1.75-4-4-4H7v14h7.04c2.09 0 3.71-1.7 3.71-3.79 0-1.52-.86-2.82-2.15-3.42zM10 6.5h3c.83 0 1.5.67 1.5 1.5s-.67 1.5-1.5 1.5h-3v-3zm3.5 9H10v-3h3.5c.83 0 1.5.67 1.5 1.5s-.67 1.5-1.5 1.5z"/></svg>
                </button>
                <button class="plan-toolbar-btn" data-command="italic" title="Italic">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M10 4v3h2.21l-3.42 8H6v3h8v-3h-2.21l3.42-8H18V4z"/></svg>
                </button>
                <button class="plan-toolbar-btn" data-command="underline" title="Underline">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 17c3.31 0 6-2.69 6-6V3h-2.5v8c0 1.93-1.57 3.5-3.5 3.5S8.5 12.93 8.5 11V3H6v8c0 3.31 2.69 6 6 6zm-7 2v2h14v-2H5z"/></svg>
                </button>
                <div class="plan-toolbar-divider"></div>
                <label class="plan-toolbar-color" title="Font Color">
                    <span class="plan-font-color-indicator" style="background: #333;"></span>
                    <input type="color" class="plan-font-color-picker" value="#333333">
                </label>
                <div class="plan-toolbar-color-group" title="Background Color">
                    <label class="plan-toolbar-color">
                        <span class="plan-bg-color-indicator"></span>
                        <input type="color" class="plan-bg-color-picker" value="#ffff00">
                    </label>
                    <button class="plan-toolbar-btn small plan-clear-bg-btn" title="Clear Background">×</button>
                </div>
                <div class="plan-toolbar-divider"></div>
                <label class="plan-toolbar-snap" title="Snap to date row">
                    <input type="checkbox" class="plan-note-snap-toggle" checked>
                    <span>Snap</span>
                </label>
                <button class="plan-toolbar-btn plan-delete-btn plan-note-delete-btn" title="Delete note">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
                </button>
            </div>
            <!-- Line Toolbar -->
            <div class="plan-line-toolbar plan-inline-toolbar hidden">
                <input type="text" class="plan-line-label-field" placeholder="Label..." title="Line label">
                <div class="plan-toolbar-divider"></div>
                <select class="plan-line-width-select" title="Line Width">
                    <option value="4">Thin</option>
                    <option value="8" selected>Medium</option>
                    <option value="14">Thick</option>
                </select>
                <label class="plan-toolbar-color" title="Line Color">
                    <span class="plan-line-color-indicator" style="background: #333;"></span>
                    <input type="color" class="plan-line-color-picker" value="#333333">
                </label>
                <button class="plan-toolbar-btn plan-delete-btn plan-line-delete-btn" title="Delete line">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
                </button>
            </div>
            <!-- Calendar Popover (Add/Manage Calendars) -->
            <div class="plan-calendar-popover hidden">
                <div class="plan-calendar-popover-header">
                    Calendars
                    <span class="plan-calendar-help-icon">?</span>
                </div>
                <div class="plan-calendar-help-content hidden">
                    <p>A calendar has a private address. Copy it from your calendar, and paste it below.</p>
                    <p><strong>Google Calendar</strong></p>
                    <ol>
                        <li>On calendar.google.com, point at the calendar in the list on the left, and click ⋮</li>
                        <li>Click "Settings and sharing"</li>
                        <li>Go down to "Integrate calendar"</li>
                        <li>Copy "Secret address in iCal format"</li>
                    </ol>
                    <p><strong>iCloud Calendar</strong></p>
                    <ol>
                        <li>In the Calendar app on a Mac, right-click the calendar, and click "Share Calendar…"</li>
                        <li>Tick "Public Calendar", and copy the link</li>
                    </ol>
                    <p><strong>Outlook</strong></p>
                    <ol>
                        <li>On outlook.com, open Settings, then Calendar, then "Shared calendars"</li>
                        <li>Under "Publish a calendar", choose the calendar, and click Publish</li>
                        <li>Copy the ICS link</li>
                    </ol>
                    <p>Keep the address to yourself. A person who has it can read the calendar.</p>
                </div>
                <div class="plan-calendar-popover-body">
                    <div class="plan-calendar-list"></div>
                    <div class="plan-calendar-add-form">
                        <input type="text" class="plan-calendar-name-input" placeholder="Calendar name">
                        <input type="text" class="plan-calendar-url-input" placeholder="Calendar address (https:// or webcal://)">
                        <button type="button" class="plan-calendar-help-link">Where do I find the address?</button>
                        <button class="plan-calendar-add-save-btn">Add Calendar</button>
                    </div>
                    <p class="plan-calendar-hint">Only the events that you mark show here, so the calendar stays calm. To mark an event, start its description with DH-TO-DO. (REDD-DO works too.)</p>
                    <div class="plan-calendar-status"></div>
                </div>
            </div>
        `;
    }

    function cleanupPhantomLines() {
        const before = freeformLines.length;
        freeformLines = freeformLines.filter((line) => {
            if (line.source === 'calendar') return true;
            if (line.label?.trim()) return true;
            // Unlabeled date-keyed lines were accidental canvas artifacts (e.g. goal drags).
            if (line.startDate && line.endDate) return false;
            return true;
        });
        if (freeformLines.length !== before) {
            saveData();
        }
    }

    // Data functions
    function loadData() {
        try {
            const storedNotes = localStorage.getItem(NOTES_KEY);
            if (storedNotes) freeformNotes = JSON.parse(storedNotes);
            const storedLines = localStorage.getItem(LINES_KEY);
            if (storedLines) freeformLines = JSON.parse(storedLines);
            loadCalendarItems();
            cleanupPhantomLines();
            const storedGroups = localStorage.getItem(GROUPS_KEY);
            if (storedGroups) groups = JSON.parse(storedGroups);
            else groups = JSON.parse(JSON.stringify(DEFAULT_GROUPS));
            const storedActiveGroup = localStorage.getItem(ACTIVE_GROUP_KEY);
            if (storedActiveGroup) activeGroup = storedActiveGroup;

            console.log('[Plan] Loaded data:', {
                notes: freeformNotes.length,
                lines: freeformLines.map(l => ({ id: l.id, x1: Math.round(l.x1), x2: Math.round(l.x2), label: l.label }))
            });

            // Load calendar metadata (multiple calendars with per-calendar styling)
            const storedCalendars = localStorage.getItem(CALENDARS_KEY);
            if (storedCalendars) calendars = JSON.parse(storedCalendars);
            const storedLastSync = localStorage.getItem(CALENDAR_LAST_SYNC_KEY);
            if (storedLastSync) calendarLastSync = storedLastSync;

            const storedViewMode = localStorage.getItem(VIEW_MODE_KEY);
            if (storedViewMode === 'week' || storedViewMode === 'months') {
                calendarViewMode = storedViewMode;
            }
            if (calendarViewMode === 'week') {
                weekStartDate = getMondayOfWeek(new Date());
            }

            loadWeekGoals();
            const calendarEventNotes = freeformNotes.filter(n => n.source === 'calendar').length;
            const calendarEventLines = freeformLines.filter(l => l.source === 'calendar').length;
            console.log('[Plan] Loaded data:', {
                calendars: calendars.length,
                totalNotes: freeformNotes.length,
                totalLines: freeformLines.length,
                calendarEventNotes,
                calendarEventLines
            });
        } catch (e) {
            console.error('Failed to load plan data:', e);
            freeformNotes = []; freeformLines = [];
            groups = JSON.parse(JSON.stringify(DEFAULT_GROUPS));
        }
    }

    function saveData() {
        try {
            const events = window.PlanCalendarEvents;
            rememberCalendarCustomisations();
            // The reader's own notes and lines only. Calendar events are
            // fetched, never saved into the shared notes: see loadCalendarItems.
            localStorage.setItem(NOTES_KEY, JSON.stringify(freeformNotes.filter(n => !events.isCalendarItem(n))));
            localStorage.setItem(LINES_KEY, JSON.stringify(freeformLines.filter(l => !events.isCalendarItem(l))));
            const customisations = JSON.stringify(calendarCustomisations);
            if (customisations !== localStorage.getItem(CALENDAR_CUSTOM_KEY)) {
                localStorage.setItem(CALENDAR_CUSTOM_KEY, customisations);
            }
            localStorage.setItem(GROUPS_KEY, JSON.stringify(groups));
            localStorage.setItem(ACTIVE_GROUP_KEY, activeGroup);

            console.log('[Plan] Saved data:', {
                notes: freeformNotes.length,
                lines: freeformLines.map(l => ({ id: l.id, x1: Math.round(l.x1), x2: Math.round(l.x2), label: l.label }))
            });
        } catch (e) { console.error('Failed to save plan data:', e); }
    }

    /*
     * Calendar events.
     *
     * Events from the reader's calendars are not the reader's notes. They
     * used to be saved into the shared notes, and every open calendar sends
     * its whole copy of those when it saves: a calendar opened before a sync
     * wrote the old events back over the new ones, and a reopen brought the
     * old ones back from the server. So the events live in memory and in a
     * copy on this device, and are fetched again on opening and every so
     * often. Only what the reader did to an event (moved it, relabelled it)
     * is saved and shared. The rules are in calendar-events.js.
     */
    const CALENDAR_AUTO_SYNC_MS = 15 * 60 * 1000;
    const CALENDAR_RETURN_SYNC_GAP_MS = 60 * 1000;

    function readStoredJson(key, fallback) {
        try {
            const raw = localStorage.getItem(key);
            return raw ? JSON.parse(raw) : fallback;
        } catch {
            return fallback;
        }
    }

    // After the notes and lines are read: the reader's own items stay, and the
    // events come from this device's copy with the reader's changes on them.
    function loadCalendarItems() {
        const events = window.PlanCalendarEvents;
        const notes = events.splitCalendarItems(freeformNotes);
        const lines = events.splitCalendarItems(freeformLines);
        const stored = events.normaliseCustomisations(readStoredJson(CALENDAR_CUSTOM_KEY, null));
        // Events an older version saved into the shared notes. Where the reader
        // moved them is kept; they leave the notes at the next save.
        calendarCustomisations = {
            notes: { ...events.legacyCustomisations(notes.calendar, 'note'), ...stored.notes },
            lines: { ...events.legacyCustomisations(lines.calendar, 'line'), ...stored.lines },
        };
        const cached = readStoredJson(CALENDAR_EVENTS_KEY, null);
        calendarEventsCache = cached && Array.isArray(cached.notes) && Array.isArray(cached.lines)
            ? { notes: cached.notes, lines: cached.lines }
            : {
                // Nothing fetched on this device yet: show what the notes held
                // until the first sync, which starts as the calendar opens.
                notes: events.legacyAsFetched(notes.calendar, 'note'),
                lines: events.legacyAsFetched(lines.calendar, 'line'),
            };
        freeformNotes = notes.own.concat(events.applyCustomisations(calendarEventsCache.notes, calendarCustomisations.notes));
        freeformLines = lines.own.concat(events.applyCustomisations(calendarEventsCache.lines, calendarCustomisations.lines));
    }

    // What the reader has changed on the calendar items on screen.
    function rememberCalendarCustomisations() {
        const events = window.PlanCalendarEvents;
        calendarCustomisations = {
            notes: events.collectCustomisations(freeformNotes, calendarEventsCache.notes, 'note', calendarCustomisations.notes),
            lines: events.collectCustomisations(freeformLines, calendarEventsCache.lines, 'line', calendarCustomisations.lines),
        };
    }

    // Freshly fetched events on screen, and kept on this device. Not saved to
    // the shared notes, so a sync never writes over anybody's notes.
    function showCalendarItems(notes, lines) {
        if (isDragInProgress) {
            // A drag holds the item it moves; replacing it now would lose the drop.
            setTimeout(() => { if (isInitialized) showCalendarItems(notes, lines); }, 1000);
            return;
        }
        const events = window.PlanCalendarEvents;
        rememberCalendarCustomisations();
        calendarEventsCache = { notes, lines };
        try {
            localStorage.setItem(CALENDAR_EVENTS_KEY, JSON.stringify(calendarEventsCache));
        } catch (e) {
            console.warn('[Plan] Could not keep calendar events on this device:', e);
        }
        freeformNotes = events.splitCalendarItems(freeformNotes).own
            .concat(events.applyCustomisations(notes, calendarCustomisations.notes));
        freeformLines = events.splitCalendarItems(freeformLines).own
            .concat(events.applyCustomisations(lines, calendarCustomisations.lines));
        renderFreeformElements();
    }

    // Sync as the calendar opens, every quarter of an hour while it is open,
    // and when the reader comes back to it (at most once a minute).
    function startCalendarAutoSync() {
        stopCalendarAutoSync();
        if (!syncCalendarsNow) return;
        syncCalendarsNow();
        calendarAutoSyncTimer = setInterval(() => {
            if (syncCalendarsNow) syncCalendarsNow();
        }, CALENDAR_AUTO_SYNC_MS);
        onCalendarReturn = () => {
            if (document.visibilityState === 'hidden' || !syncCalendarsNow) return;
            if (Date.now() - lastCalendarSyncStartedAt < CALENDAR_RETURN_SYNC_GAP_MS) return;
            syncCalendarsNow();
        };
        window.addEventListener('focus', onCalendarReturn);
        document.addEventListener('visibilitychange', onCalendarReturn);
    }

    function stopCalendarAutoSync() {
        if (calendarAutoSyncTimer) clearInterval(calendarAutoSyncTimer);
        calendarAutoSyncTimer = null;
        if (onCalendarReturn) {
            window.removeEventListener('focus', onCalendarReturn);
            document.removeEventListener('visibilitychange', onCalendarReturn);
            onCalendarReturn = null;
        }
    }

    function loadLanguage() {
        // Read language from shared key (set by main app)
        const saved = localStorage.getItem(SHARED_LANGUAGE_KEY);
        if (saved) currentLanguage = saved;
    }

    function pushHistory() {
        undoStack.push({ notes: JSON.parse(JSON.stringify(freeformNotes)), lines: JSON.parse(JSON.stringify(freeformLines)) });
        if (undoStack.length > MAX_HISTORY) undoStack.shift();
        redoStack = [];
        updateUndoRedoButtons();
    }

    function updateUndoRedoButtons() {
        const undoBtn = container.querySelector('.plan-undo-btn');
        const redoBtn = container.querySelector('.plan-redo-btn');
        if (undoBtn) undoBtn.disabled = undoStack.length === 0;
        if (redoBtn) redoBtn.disabled = redoStack.length === 0;
    }

    function loadWeekGoals() {
        try {
            const stored = localStorage.getItem(WEEK_GOALS_KEY);
            weekGoalsByWeek = stored ? JSON.parse(stored) : {};
        } catch {
            weekGoalsByWeek = {};
        }
        // A goal is on a day now: there is no bar over the week any more. A
        // goal that was in the bar, with no day, goes to the Monday of its week.
        Object.keys(weekGoalsByWeek).forEach((weekKey) => {
            if (!Array.isArray(weekGoalsByWeek[weekKey]) || !/^\d{4}-\d{2}-\d{2}$/.test(weekKey)) return;
            weekGoalsByWeek[weekKey].forEach((goal) => {
                if (goal && !goal.dateKey) goal.dateKey = weekKey;
            });
        });
    }

    function saveWeekGoals() {
        try {
            localStorage.setItem(WEEK_GOALS_KEY, JSON.stringify(weekGoalsByWeek));
        } catch {
            /* private mode */
        }
    }

    // A week's goals are kept under the Monday of that week. The week view can
    // start on any day (it scrolls day by day), so the seven days on screen can
    // be parts of two weeks. The goals bar shows the week that fills most of
    // the view, and a goal on a day is drawn with its day, whichever week.
    function weekKeyForDate(date) {
        return formatDateKey(getMondayOfWeek(date));
    }

    function getCurrentWeekKey() {
        return weekKeyForDate(addDays(weekStartDate, 3));
    }

    function goalsOfWeek(key) {
        if (!Array.isArray(weekGoalsByWeek[key])) {
            weekGoalsByWeek[key] = [];
        }
        return weekGoalsByWeek[key];
    }

    // The goals of the week in the goals bar.
    function getGoalsForCurrentWeek() {
        return goalsOfWeek(getCurrentWeekKey());
    }

    // The goals of every week that has a day on screen, the hidden day at each side too.
    function getVisibleGoals() {
        const keys = new Set();
        const { first, last } = weekRenderedRange();
        for (let i = first; i <= last; i++) keys.add(weekKeyForDate(addDays(weekStartDate, i)));
        return [...keys].flatMap((key) => goalsOfWeek(key));
    }

    function findVisibleGoal(goalId) {
        return getVisibleGoals().find((goal) => goal.id === goalId) || null;
    }

    // Keep a goal in the list of the week of its day. A goal with no day goes
    // to the week in the goals bar.
    function rehomeGoal(goal) {
        const key = goal.dateKey ? weekKeyForDate(parseDateKey(goal.dateKey)) : getCurrentWeekKey();
        Object.keys(weekGoalsByWeek).forEach((other) => {
            if (other === key || !Array.isArray(weekGoalsByWeek[other])) return;
            weekGoalsByWeek[other] = weekGoalsByWeek[other].filter((item) => item.id !== goal.id);
        });
        const home = goalsOfWeek(key);
        if (!home.some((item) => item.id === goal.id)) home.push(goal);
    }

    function createGoalId() {
        return `goal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    }

    function hideWeekGoalForm() {
        closeGoalEditor(true);
        editingGoalId = null;
        const form = container.querySelector('.plan-week-goal-form');
        const input = container.querySelector('.plan-week-goal-text-input');
        const assigneeSelect = container.querySelector('.plan-week-goal-assignee-select');
        if (form) form.classList.add('hidden');
        if (input) input.value = '';
        if (assigneeSelect) assigneeSelect.value = '';
        hideGoalPersonInput();
        updateGoalFormUI();
        renderWeekGoals();
    }

    function updateGoalFormUI() {
        const saveBtn = container.querySelector('.plan-week-goal-save-btn');
        if (saveBtn) {
            saveBtn.textContent = editingGoalId ? 'Save' : 'Add';
        }
    }

    function showWeekGoalForm(goal = null) {
        const form = container.querySelector('.plan-week-goal-form');
        const input = container.querySelector('.plan-week-goal-text-input');
        const assigneeSelect = container.querySelector('.plan-week-goal-assignee-select');
        if (!form || !input || !assigneeSelect) return;

        editingGoalId = goal?.id ?? null;
        input.value = goal?.text || '';
        fillGoalAssigneeSelect(goal?.assignee || '');
        hideGoalPersonInput();
        updateGoalFormUI();
        form.classList.remove('hidden');
        input.focus();
        if (goal) {
            input.select();
        }
        renderWeekGoals();
    }

    function startEditingWeekGoal(goalId) {
        const goal = findVisibleGoal(goalId);
        if (!goal) return;
        const anchor = container.querySelector(`.plan-week-block--goal[data-goal-id="${goalId}"], .plan-week-goal-pill[data-goal-id="${goalId}"]`);
        if (anchor) openGoalEditor({ goal, dateKey: goal.dateKey, anchorEl: anchor });
    }

    function saveWeekGoalFromForm() {
        const input = container.querySelector('.plan-week-goal-text-input');
        const assigneeSelect = container.querySelector('.plan-week-goal-assignee-select');
        const text = input?.value || '';
        const picked = assigneeSelect?.value || '';
        const assignee = picked === GOAL_ADD_PERSON_VALUE ? '' : picked;

        if (editingGoalId) {
            updateWeekGoal(editingGoalId, text, assignee);
            return;
        }

        addWeekGoal(text, assignee);
    }

    function addWeekGoal(text, assignee) {
        const trimmed = text.trim();
        if (!trimmed) return;

        const person = findGoalPerson(assignee);
        getGoalsForCurrentWeek().push({
            id: createGoalId(),
            text: trimmed,
            assignee: person ? person.id : null,
            dateKey: null,
        });
        saveWeekGoals();
        hideWeekGoalForm();
        renderWeekGoals();
    }

    function updateWeekGoal(goalId, text, assignee) {
        const trimmed = text.trim();
        if (!trimmed) return;

        const goal = findVisibleGoal(goalId);
        if (!goal) return;

        goal.text = trimmed;
        // The form shows who the goal is for now, so what it says is the answer:
        // a person, or no one.
        const person = findGoalPerson(assignee);
        goal.assignee = person ? person.id : null;
        saveWeekGoals();
        hideWeekGoalForm();
    }

    function removeWeekGoal(goalId) {
        Object.keys(weekGoalsByWeek).forEach((key) => {
            if (!Array.isArray(weekGoalsByWeek[key])) return;
            weekGoalsByWeek[key] = weekGoalsByWeek[key].filter((goal) => goal.id !== goalId);
        });
        saveWeekGoals();
        if (editingGoalId === goalId) {
            editingGoalId = null;
            const form = container.querySelector('.plan-week-goal-form');
            const input = container.querySelector('.plan-week-goal-text-input');
            const assigneeSelect = container.querySelector('.plan-week-goal-assignee-select');
            form?.classList.add('hidden');
            if (input) input.value = '';
            if (assigneeSelect) assigneeSelect.value = '';
            hideGoalPersonInput();
            updateGoalFormUI();
        }
        renderWeekGoals();
    }

    function moveWeekGoal(goalId, dateKey) {
        const goal = findVisibleGoal(goalId);
        if (!goal) return;

        const nextDateKey = dateKey || null;
        if (goal.dateKey === nextDateKey && !goalHasTime(goal)) return;

        goal.dateKey = nextDateKey;
        // The day row and the goals bar hold goals with no hours.
        delete goal.startMinutes;
        delete goal.endMinutes;
        rehomeGoal(goal);
        saveWeekGoals();
        renderWeekGoals();
    }

    function findWeekGoalDropTarget(clientX, clientY) {
        const goalsBar = container.querySelector('.plan-week-goals');
        if (goalsBar) {
            const barRect = rectOf(goalsBar);
            if (
                clientX >= barRect.left &&
                clientX <= barRect.right &&
                clientY >= barRect.top &&
                clientY <= barRect.bottom
            ) {
                return { dateKey: null, element: goalsBar.querySelector('.plan-week-goals-list') };
            }
        }

        const columns = container.querySelectorAll('.plan-week-day-column');
        let bestMatch = null;
        let bestDistance = Infinity;

        columns.forEach((col) => {
            const header = col.querySelector('.plan-week-day-header');
            const goalsRow = col.querySelector('.plan-week-day-goals');
            if (!header || !goalsRow) return;

            const colRect = rectOf(col);
            const headerRect = rectOf(header);
            const snapLineY = headerRect.bottom;
            const zoneTop = headerRect.top;
            const zoneBottom = snapLineY + 56;

            if (
                clientX < colRect.left ||
                clientX > colRect.right ||
                clientY < zoneTop ||
                clientY > zoneBottom
            ) {
                return;
            }

            const distance = Math.abs(clientY - snapLineY);
            if (distance < bestDistance) {
                bestDistance = distance;
                bestMatch = {
                    dateKey: col.dataset.dateKey,
                    element: goalsRow,
                };
            }
        });

        return bestMatch;
    }

    function setWeekGoalDropHighlight(element) {
        if (weekGoalDropHighlightEl === element) return;
        weekGoalDropHighlightEl?.classList.remove('plan-week-goal-drop-highlight');
        weekGoalDropHighlightEl = element || null;
        weekGoalDropHighlightEl?.classList.add('plan-week-goal-drop-highlight');
    }

    function weekHasPlacedGoals() {
        // A goal with hours is a block in the hours, not in the row.
        return getVisibleGoals().some((goal) => goal.dateKey && !goalHasTime(goal));
    }

    // The all-day rows of a week are one height: the height of the tallest.
    // A day with a task, a holiday or an all-day event made its own row
    // taller, and the hour lines of that day then stood lower than the lines
    // of the other days and the hours in the gutter.
    function syncWeekAllDayRows() {
        const rows = container.querySelectorAll('.plan-week-allday-row');
        const spacer = container.querySelector('.plan-week-allday-spacer');
        // The row of each day is always drawn, empty or not: it is where a
        // note for the day is written, where a line is drawn across the days,
        // and where a thing is dropped to take its hours away.
        rows.forEach((row) => {
            row.style.minHeight = '';
            row.classList.add('plan-week-allday-row--synced');
        });

        // Only the seven days in view say how tall the rows are. A day that
        // waits at the side, out of view, for the sideways scroll is drawn
        // too, and a long task on it made the rows of the whole week tall
        // with nothing to show for it. Such a day is cut to the height of the
        // others until it comes into view: the rows are then measured again.
        const firstKey = formatDateKey(weekStartDate);
        const lastKey = formatDateKey(addDays(weekStartDate, 6));
        const inView = (row) => row.dataset.dateKey >= firstKey && row.dataset.dateKey <= lastKey;
        rows.forEach((row) => {
            row.style.maxHeight = '';
            row.style.overflow = '';
        });

        let tallest = 0;
        rows.forEach((row) => { if (inView(row)) tallest = Math.max(tallest, row.offsetHeight); });
        if (tallest <= 0) return;

        rows.forEach((row) => {
            row.style.minHeight = `${tallest}px`;
            if (!inView(row)) {
                row.style.maxHeight = `${tallest}px`;
                row.style.overflow = 'hidden';
            }
        });
        if (spacer) {
            spacer.style.display = 'block';
            spacer.style.minHeight = `${tallest}px`;
        }
    }

    function syncWeekGoalGutterSpacer() {
        syncWeekAllDayRows();
        const dayGoalRows = container.querySelectorAll('.plan-week-day-goals');
        const spacer = container.querySelector('.plan-week-day-goals-spacer');
        if (!spacer) return;

        dayGoalRows.forEach((row) => {
            row.style.minHeight = '';
            row.classList.remove('plan-week-day-goals--synced');
        });

        if (!weekHasPlacedGoals()) {
            spacer.style.display = 'none';
            spacer.style.minHeight = '';
            return;
        }

        let maxHeight = 0;
        dayGoalRows.forEach((row) => {
            if (row.querySelector('.plan-week-goal-pill')) {
                maxHeight = Math.max(maxHeight, row.offsetHeight);
            }
        });

        if (maxHeight <= 0) return;

        spacer.style.display = 'block';
        spacer.style.minHeight = `${maxHeight}px`;

        dayGoalRows.forEach((row) => {
            row.classList.add('plan-week-day-goals--synced');
            row.style.minHeight = `${maxHeight}px`;
        });
    }

    function clearWeekGoalDropHighlight() {
        setWeekGoalDropHighlight(null);
    }

    // ------------------------------------------------------------------
    // Goals and tasks at a time of the day, in the week view.
    //
    // A goal or a task that is dropped in the time grid becomes a block. The
    // block can be moved, to another time and another day, and its top and
    // bottom edges set the start and the end. A task starts with its own
    // duration. A block is never shorter than its words. A drop on the day
    // row or on the goals bar takes the hours away again.
    // ------------------------------------------------------------------
    const WEEK_BLOCK_SNAP_MINUTES = 15;
    const WEEK_BLOCK_SHORTEST_MINUTES = 15;
    const WEEK_GOAL_DEFAULT_MINUTES = 60;
    const WEEK_TASK_DEFAULT_MINUTES = 30;
    let weekBlockGhostEl = null;

    // Which notes the reader has on (their group, their calendars). Set by
    // renderFreeformElements, and read again when only the blocks are drawn.
    let weekNotesVisible = () => true;
    const WEEK_NOTE_DEFAULT_MINUTES = 60;

    // A note that the reader wrote, and not an event of a linked calendar.
    function isOwnNote(note) {
        return Boolean(note) && note.source !== 'calendar' && !note.isCalendarEvent;
    }

    function findOwnNote(noteId) {
        return freeformNotes.find((note) => note.id === noteId && isOwnNote(note)) || null;
    }

    function noteHasTime(note) {
        return !note.isAllDay && Number.isFinite(note.startMinutes) && Number.isFinite(note.endMinutes);
    }

    function goalHasTime(goal) {
        return Number.isFinite(goal.startMinutes) && Number.isFinite(goal.endMinutes);
    }

    function goalDurationMinutes(goal) {
        return goalHasTime(goal) ? goal.endMinutes - goal.startMinutes : WEEK_GOAL_DEFAULT_MINUTES;
    }

    function weekGridRange() {
        return { start: WEEK_VIEW_START_HOUR * 60, end: (WEEK_VIEW_END_HOUR + 1) * 60 };
    }

    function snapWeekMinutes(minutes) {
        return Math.round(minutes / WEEK_BLOCK_SNAP_MINUTES) * WEEK_BLOCK_SNAP_MINUTES;
    }

    // "08:45 – 09:00": both ends with their minutes, so a block reads the same at each size.
    function formatWeekBlockHours(startMinutes, endMinutes) {
        const clock = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
        return `${clock(startMinutes)} – ${clock(endMinutes)}`;
    }

    function weekMinutesToTop(minutes) {
        return ((minutes - weekGridRange().start) / 60) * WEEK_VIEW_HOUR_HEIGHT;
    }

    // The day and the time under the pointer, or null when it is not over a time grid.
    function findWeekTimeDropTarget(clientX, clientY) {
        const range = weekGridRange();
        for (const grid of container.querySelectorAll('.plan-week-time-grid')) {
            const rect = rectOf(grid);
            if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) continue;
            const raw = range.start + ((clientY - rect.top) / WEEK_VIEW_HOUR_HEIGHT) * 60;
            const minutes = Math.min(Math.max(snapWeekMinutes(raw), range.start), range.end - WEEK_BLOCK_SHORTEST_MINUTES);
            return { dateKey: grid.dataset.dateKey, minutes, grid };
        }
        return null;
    }

    // A pale block where the dragged thing will land.
    function showWeekBlockGhost(target, durationMinutes, grabOffsetMinutes = 0) {
        if (!target) {
            weekBlockGhostEl?.remove();
            weekBlockGhostEl = null;
            return;
        }
        if (!weekBlockGhostEl) {
            weekBlockGhostEl = document.createElement('div');
            weekBlockGhostEl.className = 'plan-week-block plan-week-block--ghost';
        }
        const range = weekGridRange();
        const start = Math.min(Math.max(target.minutes - grabOffsetMinutes, range.start), range.end - WEEK_BLOCK_SHORTEST_MINUTES);
        const end = Math.min(start + durationMinutes, range.end);
        weekBlockGhostEl.style.top = `${weekMinutesToTop(start)}px`;
        weekBlockGhostEl.style.height = `${Math.max(weekMinutesToTop(end) - weekMinutesToTop(start), 12)}px`;
        weekBlockGhostEl.textContent = formatWeekBlockHours(start, end);
        if (weekBlockGhostEl.parentElement !== target.grid) target.grid.appendChild(weekBlockGhostEl);
    }

    function weekItemDuration(item) {
        if (item.kind === 'note') {
            const note = findOwnNote(item.id);
            return note && noteHasTime(note) ? note.endMinutes - note.startMinutes : WEEK_NOTE_DEFAULT_MINUTES;
        }
        if (item.kind === 'goal') {
            const goal = findVisibleGoal(item.id);
            return goal ? goalDurationMinutes(goal) : WEEK_GOAL_DEFAULT_MINUTES;
        }
        const time = taskTimeOf(item.id);
        if (time) return time.endMinutes - time.startMinutes;
        const task = calendarTasks.find((t) => t.id === item.id);
        return (task && task.minutes) || WEEK_TASK_DEFAULT_MINUTES;
    }

    function rerenderWeek() {
        renderCalendar();
        renderWeekGoals();
        scheduleLayoutRefresh();
    }

    // Put a goal or a task at a time. `minutes` is where its top goes.
    function placeWeekItemAtTime(item, dateKey, minutes) {
        const range = weekGridRange();
        const duration = Math.max(weekItemDuration(item), WEEK_BLOCK_SHORTEST_MINUTES);
        const start = Math.min(Math.max(snapWeekMinutes(minutes), range.start), range.end - WEEK_BLOCK_SHORTEST_MINUTES);
        const end = Math.min(start + duration, range.end);

        if (item.kind === 'goal') {
            const goal = findVisibleGoal(item.id);
            if (!goal) return;
            goal.dateKey = dateKey;
            goal.startMinutes = start;
            goal.endMinutes = end;
            rehomeGoal(goal);
            saveWeekGoals();
            renderWeekGoals();
            return;
        }

        if (item.kind === 'note') {
            const note = findOwnNote(item.id);
            if (!note) return;
            pushHistory();
            note.dateKey = dateKey;
            note.startMinutes = start;
            note.endMinutes = end;
            note.isAllDay = false;
            saveData();
            renderFreeformElements();
            return;
        }

        const task = calendarTasks.find((t) => t.id === item.id);
        if (!task) return;
        taskTimes[task.id] = { startMinutes: start, endMinutes: end };
        saveTaskTimes();
        moveTaskToDay(task, dateKey);
        rerenderWeek();
    }

    // A task shows on its due day. Another day means another due date, and
    // that is the host's to write. With no host for it, the task stays.
    function moveTaskToDay(task, dateKey) {
        if (!dateKey || task.dateKey === dateKey || !changeTaskDue) return;
        task.dateKey = dateKey;
        Promise.resolve(changeTaskDue(task.id, dateKey)).catch((err) => {
            console.error('[Plan] Could not change the due date of the task:', err);
        });
    }

    function takeWeekItemTimeAway(item, dateKey) {
        if (item.kind === 'goal') {
            moveWeekGoal(item.id, dateKey);
            return;
        }
        if (item.kind === 'note') {
            const note = findOwnNote(item.id);
            if (!note || !dateKey) return;
            pushHistory();
            note.dateKey = dateKey;
            note.startMinutes = null;
            note.endMinutes = null;
            saveData();
            renderFreeformElements();
            return;
        }
        const task = calendarTasks.find((t) => t.id === item.id);
        if (!task) return;
        delete taskTimes[task.id];
        saveTaskTimes();
        moveTaskToDay(task, dateKey);
        rerenderWeek();
    }

    // The day whose header, day row or all-day row is under the pointer.
    function findWeekDayRowTarget(clientX, clientY) {
        for (const col of container.querySelectorAll('.plan-week-day-column')) {
            const grid = col.querySelector('.plan-week-time-grid');
            const colRect = rectOf(col);
            const gridTop = grid ? rectOf(grid).top : colRect.bottom;
            if (clientX >= colRect.left && clientX <= colRect.right && clientY >= colRect.top && clientY < gridTop) {
                return { dateKey: col.dataset.dateKey, element: col.querySelector('.plan-week-allday-row') };
            }
        }
        return null;
    }

    // Drag for a task in the all-day row, and for a block in the time grid.
    function setupWeekBlockDrag(el, item, { onClick } = {}) {
        el.addEventListener('pointerdown', (event) => {
            if (event.button !== 0) return;
            if (event.target.closest('.plan-week-block-handle, .plan-week-goal-remove')) return;
            // Words that are being changed: the press is for the caret.
            if (event.target.closest('[contenteditable="true"]')) { event.stopPropagation(); return; }
            event.preventDefault();
            event.stopPropagation();

            const startX = pointerX(event);
            const startY = pointerY(event);
            const isBlock = el.classList.contains('plan-week-block');
            // Where in the block the pointer took hold, so the block does not jump.
            const grabOffsetMinutes = isBlock
                ? snapWeekMinutes(((pointerY(event) - rectOf(el).top) / WEEK_VIEW_HOUR_HEIGHT) * 60)
                : 0;
            let dragging = false;
            let chip = null;

            const cleanup = () => {
                isWeekGoalDragInProgress = false;
                document.removeEventListener('pointermove', onMove);
                document.removeEventListener('pointerup', onUp);
                document.removeEventListener('pointercancel', onUp);
                chip?.remove();
                el.classList.remove('plan-week-block--source-hidden');
                showWeekBlockGhost(null);
                clearWeekGoalDropHighlight();
            };

            const onMove = (moveEvent) => {
                if (!dragging) {
                    if (Math.hypot(pointerX(moveEvent) - startX, pointerY(moveEvent) - startY) < GOAL_DRAG_THRESHOLD_PX) return;
                    dragging = true;
                    isWeekGoalDragInProgress = true;
                    chip = document.createElement('div');
                    chip.className = 'plan-week-drag-chip';
                    chip.textContent = el.dataset.dragLabel || el.textContent;
                    document.body.appendChild(chip);
                    el.classList.add('plan-week-block--source-hidden');
                }
                moveEvent.preventDefault();
                // The label is on the body, outside the zoomed shell: screen pixels.
                chip.style.left = `${moveEvent.clientX + 10}px`;
                chip.style.top = `${moveEvent.clientY + 10}px`;
                const timeTarget = findWeekTimeDropTarget(pointerX(moveEvent), pointerY(moveEvent));
                showWeekBlockGhost(timeTarget, weekItemDuration(item), grabOffsetMinutes);
                const rowTarget = timeTarget ? null : findWeekDayRowTarget(pointerX(moveEvent), pointerY(moveEvent));
                setWeekGoalDropHighlight(rowTarget?.element || null);
            };

            const onUp = (upEvent) => {
                if (dragging) {
                    upEvent.preventDefault();
                    const timeTarget = findWeekTimeDropTarget(pointerX(upEvent), pointerY(upEvent));
                    const rowTarget = timeTarget ? null : findWeekDayRowTarget(pointerX(upEvent), pointerY(upEvent));
                    const barTarget = timeTarget || rowTarget || item.kind !== 'goal'
                        ? null
                        : findWeekGoalDropTarget(pointerX(upEvent), pointerY(upEvent));
                    cleanup();
                    if (timeTarget) placeWeekItemAtTime(item, timeTarget.dateKey, timeTarget.minutes - grabOffsetMinutes);
                    else if (rowTarget) takeWeekItemTimeAway(item, rowTarget.dateKey);
                    else if (barTarget) takeWeekItemTimeAway(item, barTarget.dateKey);
                    return;
                }
                cleanup();
                if (onClick) onClick(upEvent);
            };

            document.addEventListener('pointermove', onMove);
            document.addEventListener('pointerup', onUp);
            document.addEventListener('pointercancel', onUp);
        });
        // The canvas must not start a highlight under a block.
        el.addEventListener('mousedown', (event) => event.stopPropagation());
    }

    // The top and the bottom edge of a block set its start and its end.
    function setupWeekBlockResize(handle, blockEl, item, edge) {
        handle.addEventListener('pointerdown', (event) => {
            if (event.button !== 0) return;
            event.preventDefault();
            event.stopPropagation();
            const grid = blockEl.parentElement;
            const range = weekGridRange();
            const time = currentWeekItemTime(item);
            if (!grid || !time) return;
            let { startMinutes, endMinutes } = time;
            const from = { startMinutes, endMinutes, y: pointerY(event) };
            isWeekGoalDragInProgress = true;

            // By how far the pointer went, not by where it is: a short block is
            // drawn taller than its hours, so its bottom edge is not at its end.
            const onMove = (moveEvent) => {
                moveEvent.preventDefault();
                const moved = snapWeekMinutes(((pointerY(moveEvent) - from.y) / WEEK_VIEW_HOUR_HEIGHT) * 60);
                if (edge === 'top') {
                    startMinutes = Math.min(Math.max(from.startMinutes + moved, range.start), endMinutes - WEEK_BLOCK_SHORTEST_MINUTES);
                } else {
                    endMinutes = Math.max(Math.min(from.endMinutes + moved, range.end), startMinutes + WEEK_BLOCK_SHORTEST_MINUTES);
                }
                sizeWeekBlock(blockEl, startMinutes, endMinutes);
            };
            const onUp = () => {
                isWeekGoalDragInProgress = false;
                document.removeEventListener('pointermove', onMove);
                document.removeEventListener('pointerup', onUp);
                document.removeEventListener('pointercancel', onUp);
                setWeekItemTime(item, startMinutes, endMinutes);
            };
            document.addEventListener('pointermove', onMove);
            document.addEventListener('pointerup', onUp);
            document.addEventListener('pointercancel', onUp);
        });
        handle.addEventListener('mousedown', (event) => event.stopPropagation());
    }

    function currentWeekItemTime(item) {
        if (item.kind === 'note') {
            const note = findOwnNote(item.id);
            return note && noteHasTime(note) ? { startMinutes: note.startMinutes, endMinutes: note.endMinutes } : null;
        }
        if (item.kind === 'goal') {
            const goal = findVisibleGoal(item.id);
            return goal && goalHasTime(goal) ? { startMinutes: goal.startMinutes, endMinutes: goal.endMinutes } : null;
        }
        return taskTimeOf(item.id);
    }

    function setWeekItemTime(item, startMinutes, endMinutes) {
        if (item.kind === 'note') {
            const note = findOwnNote(item.id);
            if (!note) return;
            pushHistory();
            note.startMinutes = startMinutes;
            note.endMinutes = endMinutes;
            saveData();
            renderWeekBlocks();
            return;
        }
        if (item.kind === 'goal') {
            const goal = findVisibleGoal(item.id);
            if (!goal) return;
            goal.startMinutes = startMinutes;
            goal.endMinutes = endMinutes;
            saveWeekGoals();
        } else {
            taskTimes[item.id] = { startMinutes, endMinutes };
            saveTaskTimes();
        }
        renderWeekBlocks();
    }

    // The place, the height and the hours of a block. Never shorter than its words.
    function sizeWeekBlock(el, startMinutes, endMinutes) {
        el.style.top = `${weekMinutesToTop(startMinutes)}px`;
        el.style.height = `${weekMinutesToTop(endMinutes) - weekMinutesToTop(startMinutes)}px`;
        const timeEl = el.querySelector('.plan-week-block-time');
        if (timeEl) timeEl.textContent = formatWeekBlockHours(startMinutes, endMinutes);
        if (el.isConnected && el.scrollHeight > el.clientHeight + 1) {
            el.style.height = `${el.scrollHeight + 2}px`;
        }
    }

    function createWeekBlock(item, label, startMinutes, endMinutes, iconEl) {
        const el = document.createElement('div');
        el.className = `plan-week-block plan-week-block--${item.kind}`;
        el.dataset.dragLabel = label;
        if (item.kind === 'note') el.dataset.noteId = item.id;
        if (item.kind === 'goal') el.dataset.goalId = item.id;
        el.title = 'Drag to move. Drag the top or the bottom edge to change the time.';

        const top = document.createElement('div');
        top.className = 'plan-week-block-handle plan-week-block-handle--top';
        const bottom = document.createElement('div');
        bottom.className = 'plan-week-block-handle plan-week-block-handle--bottom';

        const titleEl = document.createElement('div');
        titleEl.className = 'plan-week-block-title';
        if (iconEl) titleEl.appendChild(iconEl);
        titleEl.appendChild(document.createTextNode(label));
        const timeEl = document.createElement('div');
        timeEl.className = 'plan-week-block-time';

        el.appendChild(top);
        el.appendChild(titleEl);
        el.appendChild(timeEl);
        el.appendChild(bottom);
        setupWeekBlockResize(top, el, item, 'top');
        setupWeekBlockResize(bottom, el, item, 'bottom');
        return el;
    }

    function renderWeekBlocks() {
        if (!container || calendarViewMode !== 'week') return;
        // Not the box where the reader types: a re-draw of the blocks must not take the caret away.
        container.querySelectorAll('.plan-week-block:not(.plan-week-block--ghost):not(.plan-week-block--writing)').forEach((el) => el.remove());
        const range = weekGridRange();
        const draw = (item, dateKey, label, time, iconEl, onClick) => {
            const grid = container.querySelector(`.plan-week-time-grid[data-date-key="${dateKey}"]`);
            if (!grid) return null;
            const start = Math.min(Math.max(time.startMinutes, range.start), range.end - WEEK_BLOCK_SHORTEST_MINUTES);
            const end = Math.min(Math.max(time.endMinutes, start + WEEK_BLOCK_SHORTEST_MINUTES), range.end);
            const el = createWeekBlock(item, label, start, end, iconEl);
            grid.appendChild(el);
            sizeWeekBlock(el, start, end);
            setupWeekBlockDrag(el, item, { onClick });
            return el;
        };

        getVisibleGoals().forEach((goal) => {
            if (!goal.dateKey || !goalHasTime(goal)) return;
            draw({ kind: 'goal', id: goal.id }, goal.dateKey, goal.text, goal, null, () => startEditingWeekGoal(goal.id));
        });
        freeformNotes.filter(weekNotesVisible).forEach((note) => {
            if (!isOwnNote(note) || !note.dateKey || !noteHasTime(note)) return;
            const noteEl = draw({ kind: 'note', id: note.id }, note.dateKey, noteDisplayText(note), note, null,
                (event) => selectWeekNote(note, noteEl?.querySelector('.plan-week-block-title'), event));
            if (noteEl) dressWeekNoteText(noteEl.querySelector('.plan-week-block-title'), note);
        });
        calendarTasks.forEach((task) => {
            const time = taskTimeOf(task.id);
            if (!time) return;
            let blockEl = null;
            blockEl = draw({ kind: 'task', id: task.id }, task.dateKey, task.name, time, createTaskIcon(task), () => {
                if (openTask && blockEl) openTask(task.id, taskAnchorOf(blockEl));
            });
            if (blockEl && openTask) blockEl.title = `${blockEl.title} Click to open.`;
        });
    }

    function setupWeekGoalPointerDrag(pill, goal) {
        pill.addEventListener('pointerdown', (event) => {
            if (event.button !== 0) return;
            if (event.target.closest('.plan-week-goal-remove')) return;

            event.preventDefault();
            event.stopPropagation();

            const startX = pointerX(event);
            const startY = pointerY(event);
            let dragging = false;
            let dragClone = null;

            const cleanup = () => {
                isWeekGoalDragInProgress = false;
                showWeekBlockGhost(null);
                document.removeEventListener('pointermove', onPointerMove);
                document.removeEventListener('pointerup', onPointerUp);
                document.removeEventListener('pointercancel', onPointerUp);
                dragClone?.remove();
                pill.classList.remove('plan-week-goal-pill--source-hidden');
                container.querySelectorAll('.plan-week-day-goals').forEach((row) => {
                    row.classList.remove('plan-week-goal-drop-active');
                });
                clearWeekGoalDropHighlight();
            };

            const onPointerMove = (moveEvent) => {
                const deltaX = pointerX(moveEvent) - startX;
                const deltaY = pointerY(moveEvent) - startY;

                if (!dragging) {
                    if (Math.hypot(deltaX, deltaY) < GOAL_DRAG_THRESHOLD_PX) return;

                    dragging = true;
                    isWeekGoalDragInProgress = true;
                    moveEvent.preventDefault();
                    moveEvent.stopPropagation();
                    pill.setPointerCapture(event.pointerId);

                    dragClone = pill.cloneNode(true);
                    dragClone.classList.add('plan-week-goal-pill--dragging');
                    dragClone.style.width = `${toScreen(pill.offsetWidth)}px`;
                    document.body.appendChild(dragClone);
                    pill.classList.add('plan-week-goal-pill--source-hidden');
                    container.querySelectorAll('.plan-week-day-goals').forEach((row) => {
                        row.classList.add('plan-week-goal-drop-active');
                    });
                }

                // The copy is on the body, outside the zoomed shell: screen pixels.
                dragClone.style.left = `${moveEvent.clientX - dragClone.offsetWidth / 2}px`;
                dragClone.style.top = `${moveEvent.clientY - dragClone.offsetHeight / 2}px`;

                const timeTarget = findWeekTimeDropTarget(pointerX(moveEvent), pointerY(moveEvent));
                showWeekBlockGhost(timeTarget, goalDurationMinutes(goal));
                const dropTarget = timeTarget ? null : findWeekGoalDropTarget(pointerX(moveEvent), pointerY(moveEvent));
                setWeekGoalDropHighlight(dropTarget?.element || null);
            };

            const onPointerUp = (upEvent) => {
                if (dragging) {
                    upEvent.preventDefault();
                    if (pill.hasPointerCapture?.(event.pointerId)) {
                        pill.releasePointerCapture(event.pointerId);
                    }
                    const timeTarget = findWeekTimeDropTarget(pointerX(upEvent), pointerY(upEvent));
                    const dropTarget = timeTarget ? null : findWeekGoalDropTarget(pointerX(upEvent), pointerY(upEvent));
                    if (timeTarget) {
                        placeWeekItemAtTime({ kind: 'goal', id: goal.id }, timeTarget.dateKey, timeTarget.minutes);
                    } else if (dropTarget) {
                        moveWeekGoal(goal.id, dropTarget.dateKey);
                    } else {
                        renderWeekGoals();
                    }
                } else if (!event.target.closest('.plan-week-goal-remove')) {
                    startEditingWeekGoal(goal.id);
                }

                cleanup();
            };

            document.addEventListener('pointermove', onPointerMove);
            document.addEventListener('pointerup', onPointerUp);
            document.addEventListener('pointercancel', onPointerUp);
        });

        pill.addEventListener('mousedown', (event) => {
            event.stopPropagation();
        });
    }

    // How many of a goal's linked tasks are done: { done, total }, over the
    // tasks that the board still has.
    function goalProgress(goal) {
        const ids = Array.isArray(goal.taskIds) ? goal.taskIds : [];
        const found = ids.map((id) => linkableTasks.find((t) => t.id === id)).filter(Boolean);
        return { done: found.filter((t) => t.completed).length, total: found.length };
    }

    function goalPersonDot(person) {
        const dot = document.createElement('span');
        dot.className = 'plan-goal-person-dot';
        const letters = person.initials || (firstNameOf(person.name)[0] || '?').toUpperCase();
        dot.textContent = letters;
        if (person.colour) dot.style.background = person.colour;
        dot.title = person.name;
        if (person.photoUrl) {
            // A photo that will not load shows the letters, not a broken picture.
            const img = document.createElement('img');
            img.alt = '';
            img.src = person.photoUrl;
            img.addEventListener('error', () => { img.remove(); dot.textContent = letters; });
            dot.textContent = '';
            dot.appendChild(img);
        }
        return dot;
    }

    // A goal in the head of its day: who it is for, its words, and how many
    // of its linked tasks are done. A click opens its card, a drag takes it
    // to another day or to a time.
    function createWeekGoalPill(goal) {
        const person = findGoalPerson(goal.assignee);
        const pill = document.createElement('div');
        pill.className = 'plan-week-goal-pill';
        if (goal.id === editingGoalId) pill.classList.add('plan-week-goal-pill--editing');
        pill.dataset.goalId = goal.id;
        pill.setAttribute('role', 'button');
        pill.tabIndex = 0;
        pill.title = `${goal.text} — click to change, drag to move`;

        if (person) pill.appendChild(goalPersonDot(person));
        const textEl = document.createElement('span');
        textEl.className = 'plan-week-goal-pill-text';
        textEl.textContent = goal.text;
        pill.appendChild(textEl);

        const progress = goalProgress(goal);
        if (progress.total > 0) {
            const count = document.createElement('span');
            count.className = 'plan-week-goal-pill-progress';
            if (progress.done === progress.total) count.classList.add('is-done');
            count.textContent = `${progress.done}/${progress.total}`;
            pill.appendChild(count);
        }

        setupWeekGoalPointerDrag(pill, goal);
        pill.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                startEditingWeekGoal(goal.id);
            }
        });
        return pill;
    }

    function renderWeekGoals() {
        if (calendarViewMode !== 'week') return;

        const goalsBar = container.querySelector('.plan-week-goals');
        const list = container.querySelector('.plan-week-goals-list');
        if (!goalsBar || !list) return;

        list.innerHTML = '';
        container.querySelectorAll('.plan-week-day-goals').forEach((row) => {
            row.innerHTML = '';
        });

        const barWeek = getGoalsForCurrentWeek();
        getVisibleGoals().forEach((goal) => {
            // A goal with no day shows in the bar of its own week only.
            if (!goal.dateKey && !barWeek.includes(goal)) return;
            // A goal with hours is drawn in the time grid, by renderWeekBlocks.
            if (goal.dateKey && goalHasTime(goal) && container.querySelector(
                `.plan-week-time-grid[data-date-key="${goal.dateKey}"]`
            )) return;
            const pill = createWeekGoalPill(goal);
            if (goal.dateKey) {
                const dayGoals = container.querySelector(
                    `.plan-week-day-goals[data-date-key="${goal.dateKey}"]`
                );
                if (dayGoals) {
                    dayGoals.appendChild(pill);
                    return;
                }
                // Its day is not on screen. It comes back when the day does.
                return;
            }
            list.appendChild(pill);
        });

        // The way to a new goal: words under the day's name while the pointer
        // is in that day, and a small "+" when the day has a goal already.
        container.querySelectorAll('.plan-week-day-goals').forEach((row) => {
            const add = document.createElement('button');
            add.type = 'button';
            add.className = 'plan-week-add-goal' + (row.childElementCount > 0 ? ' plan-week-add-goal--more' : '');
            add.textContent = row.childElementCount > 0 ? '+' : (currentLanguage === 'da' ? '+ Tilføj et mål' : '+ Add a goal');
            add.title = currentLanguage === 'da' ? 'Tilføj et mål for dagen' : 'Add a goal for this day';
            add.addEventListener('mousedown', (event) => event.stopPropagation());
            add.addEventListener('click', (event) => {
                event.stopPropagation();
                openGoalEditor({ goal: null, dateKey: row.dataset.dateKey, anchorEl: row });
            });
            row.appendChild(add);
        });

        renderWeekBlocks();
        requestAnimationFrame(() => syncWeekGoalGutterSpacer());
    }

    function updateWeekGoalsVisibility() {
        const goalsBar = container.querySelector('.plan-week-goals');
        if (!goalsBar) return;

        const showGoals = calendarViewMode === 'week';
        goalsBar.classList.toggle('hidden', !showGoals);
        if (showGoals) {
            renderWeekGoals();
        } else {
            hideWeekGoalForm();
        }
    }

    function updateViewModeButtons() {
        container.querySelectorAll('.plan-view-mode-btn').forEach((btn) => {
            btn.classList.toggle('active', btn.dataset.view === calendarViewMode);
        });
        calendarContainer?.classList.toggle('plan-week-mode', calendarViewMode === 'week');
        updateWeekGoalsVisibility();
    }

    function setCalendarViewMode(mode) {
        if (mode !== 'months' && mode !== 'week') return;
        if (calendarViewMode === mode) return;

        calendarViewMode = mode;
        if (mode === 'week') {
            weekStartDate = getMondayOfWeek(new Date());
        }
        try {
            localStorage.setItem(VIEW_MODE_KEY, mode);
        } catch {
            /* private mode */
        }

        updateViewModeButtons();
        renderCalendar();
        renderFreeformElements();
        updatePeriodDisplay();
        if (calendarContainer) {
            calendarContainer.scrollLeft = 0;
        }
        if (mode === 'week') {
            requestAnimationFrame(() => scrollWeekViewToCurrentTime());
        }
    }

    // Calendar functions
    function updatePeriodDisplay() {
        const display = container.querySelector('.plan-period-display');
        const todayBtn = container.querySelector('.plan-today-btn');

        if (calendarViewMode === 'week') {
            const weekEnd = addDays(weekStartDate, 6);
            const months = currentLanguage === 'da' ? MONTHS_DA : MONTHS_EN;
            const startLabel = `${weekStartDate.getDate()} ${months[weekStartDate.getMonth()].slice(0, 3)}`;
            const endLabel = `${weekEnd.getDate()} ${months[weekEnd.getMonth()].slice(0, 3)}`;

            if (weekStartDate.getFullYear() === weekEnd.getFullYear()) {
                display.textContent = `${startLabel} – ${endLabel} ${weekStartDate.getFullYear()}`;
            } else {
                display.textContent = `${startLabel} ${weekStartDate.getFullYear()} – ${endLabel} ${weekEnd.getFullYear()}`;
            }

            if (todayBtn) {
                // Any seven days that hold today count as "this week".
                const todayKey = formatDateKey(new Date());
                const isCurrentWeek =
                    todayKey >= formatDateKey(weekStartDate) && todayKey <= formatDateKey(weekEnd);
                todayBtn.classList.toggle('hidden', isCurrentWeek);
            }
            return;
        }

        const grid = container.querySelector('.plan-calendar-grid');
        const columns = grid.querySelectorAll('.plan-month-column');

        if (columns.length === 0) {
            display.textContent = '';
            return;
        }

        // Find visible columns based on scroll position
        const scrollLeft = calendarContainer.scrollLeft;
        const containerWidth = calendarContainer.clientWidth;
        const scrollRight = scrollLeft + containerWidth;

        let firstVisible = null;
        let lastVisible = null;

        columns.forEach(col => {
            const colLeft = col.offsetLeft;
            const colRight = colLeft + col.offsetWidth;

            // Check if column is at least partially visible
            if (colRight > scrollLeft && colLeft < scrollRight) {
                if (!firstVisible) firstVisible = col;
                lastVisible = col;
            }
        });

        if (!firstVisible || !lastVisible) {
            firstVisible = columns[0];
            lastVisible = columns[columns.length - 1];
        }

        const firstMonth = parseInt(firstVisible.dataset.month);
        const firstYear = parseInt(firstVisible.dataset.year);
        const lastMonth = parseInt(lastVisible.dataset.month);
        const lastYear = parseInt(lastVisible.dataset.year);

        const months = currentLanguage === 'da' ? MONTHS_DA : MONTHS_EN;
        const firstMonthShort = months[firstMonth].slice(0, 3);
        const lastMonthShort = months[lastMonth].slice(0, 3);

        // Format: "Jan - Jun 2026" or "Dec 2025 - Jan 2026" if spanning years
        // On mobile, drop the year when same year to save space
        const isMobile = window.innerWidth <= 768;
        if (firstYear === lastYear) {
            display.textContent = isMobile
                ? `${firstMonthShort} – ${lastMonthShort}`
                : `${firstMonthShort} – ${lastMonthShort} ${firstYear}`;
        } else {
            display.textContent = `${firstMonthShort} ${firstYear} – ${lastMonthShort} ${lastYear}`;
        }

        // Show/hide "Go to Today" button based on whether today's month is visible
        if (todayBtn) {
            const today = new Date();
            const todayMonth = today.getMonth();
            const todayYear = today.getFullYear();

            // Check if today's month is in the visible range
            let isTodayVisible = false;
            columns.forEach(col => {
                const m = parseInt(col.dataset.month);
                const y = parseInt(col.dataset.year);
                const colLeft = col.offsetLeft;
                const colRight = colLeft + col.offsetWidth;

                if (m === todayMonth && y === todayYear && colRight > scrollLeft && colLeft < scrollRight) {
                    isTodayVisible = true;
                }
            });

            if (isTodayVisible) {
                todayBtn.classList.add('hidden');
            } else {
                todayBtn.classList.remove('hidden');
            }
        }
    }

    function renderCalendar() {
        const grid = container.querySelector('.plan-calendar-grid');
        grid.innerHTML = '';
        grid.classList.toggle('plan-week-grid', calendarViewMode === 'week');

        if (calendarViewMode === 'week') {
            renderWeekView(grid);
            renderWeekGoals();
            return;
        }

        // Render MONTHS_TO_RENDER months starting from startMonth/startYear
        let month = startMonth;
        let year = startYear;

        for (let i = 0; i < MONTHS_TO_RENDER; i++) {
            grid.appendChild(createMonthColumn(month, year));
            month++;
            if (month > 11) {
                month = 0;
                year++;
            }
        }

        // Update the grid template for the number of months
        grid.style.gridTemplateColumns = `repeat(${MONTHS_TO_RENDER}, 240px)`;
    }

    function renderWeekView(grid) {
        const { first, last } = weekRenderedRange();
        const carousel = first < 0;
        grid.classList.toggle('plan-week-grid--carousel', carousel);
        // Seven days fill the width. The hidden days are as wide, outside it.
        grid.style.gridTemplateColumns = carousel
            ? `36px repeat(${last - first + 1}, calc((100% - 36px - 84px) / 7))`
            : `36px repeat(7, minmax(0, 1fr))`;
        grid.appendChild(createWeekTimeGutter());

        for (let i = first; i <= last; i++) {
            grid.appendChild(createWeekDayColumn(addDays(weekStartDate, i)));
        }
        applyWeekShift(false);
    }

    // ---- Sideways scroll, a day at a time ----
    let weekShiftPx = 0;
    let weekSnapTimer = null;
    let weekLastDirection = 0;   // 1: to later days, -1: to earlier days

    function weekColumnStep() {
        const col = container.querySelector('.plan-week-day-column');
        return col ? rectOf(col).width + 12 : 0;
    }

    function applyWeekShift(glide) {
        const grid = container.querySelector('.plan-calendar-grid');
        if (!grid) return;
        grid.classList.toggle('plan-week-grid--snapping', Boolean(glide));
        grid.style.setProperty('--week-shift', `${-weekShiftPx}px`);
    }

    function shiftWeekByDays(days) {
        const top = calendarContainer.scrollTop;
        const barWeekBefore = getCurrentWeekKey();
        weekStartDate = addDays(weekStartDate, days);
        if (getCurrentWeekKey() !== barWeekBefore) hideWeekGoalForm();
        renderCalendar();
        renderFreeformElements();
        updatePeriodDisplay();
        calendarContainer.scrollTop = top;
    }

    // The days follow the scroll. When half a day has gone by, the first day
    // changes. When the scroll stops, the days glide on to a whole day.
    function onWeekWheel(event) {
        if (calendarViewMode !== 'week' || !weekCarouselOn() || isWeekGoalDragInProgress) return;
        if (Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return;
        event.preventDefault();
        const step = weekColumnStep();
        if (!step) return;

        weekShiftPx += event.deltaMode === 1 ? event.deltaX * 16 : event.deltaX;
        if (event.deltaX !== 0) weekLastDirection = event.deltaX > 0 ? 1 : -1;
        while (weekShiftPx >= step / 2) {
            shiftWeekByDays(1);
            weekShiftPx -= step;
        }
        while (weekShiftPx <= -step / 2) {
            shiftWeekByDays(-1);
            weekShiftPx += step;
        }
        applyWeekShift(false);

        clearTimeout(weekSnapTimer);
        weekSnapTimer = setTimeout(settleWeekScroll, 140);
    }

    // The scroll stopped between two days. Go on to the next whole day in the
    // way the scroll was going, and never back: a scroll that goes a little
    // too far and then comes back by itself feels wrong under the fingers.
    // A touch of a few pixels is not a scroll, and goes back to where it was.
    function settleWeekScroll() {
        const step = weekColumnStep();
        const barely = 8;
        if (step) {
            if (weekLastDirection > 0 && weekShiftPx > barely) {
                shiftWeekByDays(1);
                weekShiftPx -= step;
            } else if (weekLastDirection < 0 && weekShiftPx < -barely) {
                shiftWeekByDays(-1);
                weekShiftPx += step;
            }
        }
        // Put the new days where the old ones were, with no glide, and let the
        // page take that in. Then glide to the whole day.
        applyWeekShift(false);
        const grid = container.querySelector('.plan-calendar-grid');
        if (grid) void grid.offsetWidth;
        weekShiftPx = 0;
        applyWeekShift(true);
    }

    function createWeekTimeGutter() {
        const gutter = document.createElement('div');
        gutter.className = 'plan-week-time-gutter';

        const headerSpacer = document.createElement('div');
        headerSpacer.className = 'plan-week-time-gutter-header';
        gutter.appendChild(headerSpacer);

        const dayGoalsSpacer = document.createElement('div');
        dayGoalsSpacer.className = 'plan-week-day-goals-spacer';
        gutter.appendChild(dayGoalsSpacer);

        const alldaySpacer = document.createElement('div');
        alldaySpacer.className = 'plan-week-allday-spacer';
        gutter.appendChild(alldaySpacer);

        const hours = document.createElement('div');
        hours.className = 'plan-week-time-hours';
        for (let hour = WEEK_VIEW_START_HOUR; hour <= WEEK_VIEW_END_HOUR; hour++) {
            const label = document.createElement('div');
            label.className = 'plan-week-hour-label';
            label.style.height = `${WEEK_VIEW_HOUR_HEIGHT}px`;
            label.textContent = formatMinutesAsTime(hour * 60);
            hours.appendChild(label);
        }
        gutter.appendChild(hours);
        return gutter;
    }

    function createWeekDayColumn(date) {
        const weekday = date.getDay() === 0 ? 6 : date.getDay() - 1;
        const isWeekend = weekday >= 5;
        const isToday = date.toDateString() === new Date().toDateString();

        const col = document.createElement('div');
        col.className =
            'plan-week-day-column' + (isWeekend ? ' weekend' : '') + (isToday ? ' today' : '');
        col.dataset.dateKey = formatDateKey(date);
        const weekdayLabels =
            currentLanguage === 'da' ? WEEKDAYS_THREE_DA : WEEKDAYS_THREE_EN;
        const weekdayFullLabels =
            currentLanguage === 'da' ? WEEKDAYS_FULL_DA : WEEKDAYS_FULL_EN;
        const dateKey = formatDateKey(date);

        const header = document.createElement('div');
        header.className = 'plan-week-day-header';
        header.innerHTML = `
            <span class="plan-week-day-name" title="${weekdayFullLabels[weekday]} ${date.getDate()}">${weekdayLabels[weekday]} ${date.getDate()}</span>
        `;
        col.appendChild(header);

        const dayGoals = document.createElement('div');
        dayGoals.className = 'plan-week-day-goals';
        dayGoals.dataset.dateKey = dateKey;
        col.appendChild(dayGoals);

        const body = document.createElement('div');
        body.className = 'plan-week-day-body';

        const alldayRow = document.createElement('div');
        alldayRow.className =
            'plan-week-allday-row' + (isWeekend ? ' weekend' : '') + (isToday ? ' today' : '');
        alldayRow.dataset.dateKey = dateKey;

        const holidays = getHolidays(date.getFullYear());
        if (holidays[dateKey]) {
            const holidayEl = document.createElement('span');
            holidayEl.className = 'plan-week-allday-item holiday';
            holidayEl.textContent = holidays[dateKey];
            alldayRow.appendChild(holidayEl);
        }
        const deadlineEl = createDeadlineEl(dateKey, 'plan-week-allday-item');
        if (deadlineEl) alldayRow.appendChild(deadlineEl);
        calendarTasks
            .filter((task) => task.dateKey === dateKey && !taskTimeOf(task.id))
            .forEach((task) => {
                const item = createTaskItemEl(task, 'plan-week-allday-item');
                item.title = `${item.title}. Drag it to a time of the day.`;
                setupWeekBlockDrag(item, { kind: 'task', id: task.id }, {
                    onClick: () => { if (openTask) openTask(task.id, taskAnchorOf(item)); },
                });
                alldayRow.appendChild(item);
            });
        body.appendChild(alldayRow);

        const timeGrid = document.createElement('div');
        timeGrid.className = 'plan-week-time-grid';
        timeGrid.dataset.dateKey = dateKey;
        const gridHeight =
            (WEEK_VIEW_END_HOUR - WEEK_VIEW_START_HOUR + 1) * WEEK_VIEW_HOUR_HEIGHT;
        timeGrid.style.height = `${gridHeight}px`;

        for (let hour = WEEK_VIEW_START_HOUR; hour <= WEEK_VIEW_END_HOUR; hour++) {
            const slot = document.createElement('div');
            slot.className =
                'plan-week-hour-slot' + (isWeekend ? ' weekend' : '') + (isToday ? ' today' : '');
            slot.dataset.hour = String(hour);
            slot.dataset.dateKey = dateKey;
            slot.style.height = `${WEEK_VIEW_HOUR_HEIGHT}px`;
            timeGrid.appendChild(slot);
        }
        body.appendChild(timeGrid);
        col.appendChild(body);

        // Legacy hook for month-style note queries (hidden, unused in week layout)
        const legacyRow = document.createElement('div');
        legacyRow.className = 'plan-day-row plan-week-day-row hidden';
        legacyRow.dataset.dateKey = dateKey;
        const legacyNoteArea = document.createElement('div');
        legacyNoteArea.className = 'plan-note-area';
        legacyRow.appendChild(legacyNoteArea);
        col.appendChild(legacyRow);

        return col;
    }

    // A line with hours: drawn down the hours of one day in the week view.
    function lineHasTime(line) {
        return Boolean(line) && Number.isFinite(line.startMinutes) && Number.isFinite(line.endMinutes);
    }

    // The words of the reader's own note in the week view, as the Months view
    // shows a note: the hand font, the note's own colours, and the same menu.
    function dressWeekNoteText(textEl, note) {
        if (!textEl) return;
        textEl.classList.add('plan-week-note-text');
        textEl.dataset.noteId = note.id;
        if (note.fontColor) textEl.style.color = note.fontColor;
        if (note.bgColor) textEl.style.backgroundColor = note.bgColor;
        // While the words are changed in place (the second click).
        textEl.addEventListener('input', () => {
            note.html = textEl.innerHTML;
            note.text = textEl.textContent.trim();
            saveData();
        });
        textEl.addEventListener('blur', () => {
            if (textEl.getAttribute('contenteditable') !== 'true') return;
            textEl.setAttribute('contenteditable', 'false');
            // No words left: the note goes, as in the week view before.
            if (!textEl.textContent.trim()) {
                pushHistory();
                freeformNotes = freeformNotes.filter((item) => item.id !== note.id);
                saveData();
                deselectElement();
                renderFreeformElements();
            }
        });
    }

    // A click on the reader's own note: the first one selects it and gives the
    // menu of the Months view, the second one puts the caret in its words.
    function selectWeekNote(note, textEl, event) {
        if (!textEl) return;
        if (event) window._lastClickEvent = { clientX: event.clientX, clientY: event.clientY };
        showNoteEditor(note.id, textEl, Boolean(event && event.shiftKey));
    }

    function createWeekTimedLine(line) {
        const range = weekGridRange();
        const start = Math.min(Math.max(line.startMinutes, range.start), range.end);
        const end = Math.min(Math.max(line.endMinutes, start + WEEK_BLOCK_SHORTEST_MINUTES), range.end);
        const el = document.createElement('div');
        el.className = 'plan-week-line' + (line.source === 'calendar' ? ' calendar-event' : '');
        el.dataset.weekLineId = line.id;
        el.style.top = `${weekMinutesToTop(start)}px`;
        el.style.height = `${weekMinutesToTop(end) - weekMinutesToTop(start)}px`;
        const bar = document.createElement('div');
        bar.className = 'plan-week-line-bar vertical';
        bar.style.width = `${line.width || 8}px`;
        if (line.color) bar.style.background = line.color;
        const name = document.createElement('span');
        name.className = 'plan-week-line-label';
        name.textContent = line.label || '';
        el.appendChild(bar);
        el.appendChild(name);
        if (line.source !== 'calendar') {
            el.title = `${formatWeekBlockHours(start, end)} — click for the menu`;
            el.addEventListener('mousedown', (event) => event.stopPropagation());
            el.addEventListener('click', (event) => {
                event.stopPropagation();
                showLineEditor(line.id, bar);
            });
        }
        return el;
    }

    function createWeekAllDayEvent(note) {
        const el = document.createElement('div');
        el.className =
            'plan-week-allday-item' +
            (note.source === 'calendar' ? ' calendar-event' : ' user-event');
        el.textContent = noteDisplayText(note);
        if (note.source === 'calendar') {
            el.title = `From calendar: ${note.calendarName || 'Unknown'}`;
        }
        return el;
    }

    function createWeekTimedEvent(note) {
        const el = document.createElement('div');
        el.className =
            'plan-week-event' +
            (note.source === 'calendar' ? ' calendar-event' : ' user-event');

        const startMin = note.startMinutes ?? 9 * 60;
        let endMin = note.endMinutes ?? startMin + 60;
        if (endMin <= startMin) endMin = startMin + 60;

        const rangeStart = WEEK_VIEW_START_HOUR * 60;
        const rangeEnd = (WEEK_VIEW_END_HOUR + 1) * 60;
        const clampedStart = Math.max(startMin, rangeStart);
        const clampedEnd = Math.min(endMin, rangeEnd);
        if (clampedEnd <= rangeStart || clampedStart >= rangeEnd) {
            el.classList.add('hidden');
            return el;
        }

        const top = ((clampedStart - rangeStart) / 60) * WEEK_VIEW_HOUR_HEIGHT;
        const height = Math.max(
            ((clampedEnd - clampedStart) / 60) * WEEK_VIEW_HOUR_HEIGHT,
            22
        );
        el.style.top = `${top}px`;
        el.style.height = `${height}px`;

        const timeEl = document.createElement('span');
        timeEl.className = 'plan-week-event-time';
        timeEl.textContent =
            endMin > startMin
                ? `${formatMinutesAsTime(startMin)} – ${formatMinutesAsTime(endMin)}`
                : formatMinutesAsTime(startMin);

        const titleEl = document.createElement('span');
        titleEl.className = 'plan-week-event-title';
        titleEl.textContent = noteDisplayText(note);

        el.appendChild(timeEl);
        el.appendChild(titleEl);

        if (note.source === 'calendar') {
            el.title = `From calendar: ${note.calendarName || 'Unknown'}`;
        }

        return el;
    }

    function renderWeekFreeformElements(isVisible) {
        weekNotesVisible = isVisible;
        freeformNotes.filter(isVisible).forEach((note) => {
            if (!note.dateKey || !isDateInVisibleWeek(note.dateKey)) return;

            if (note.isAllDay || note.startMinutes == null) {
                const allday = container.querySelector(
                    `.plan-week-allday-row[data-date-key="${note.dateKey}"]`
                );
                if (!allday) return;
                const el = createWeekAllDayEvent(note);
                if (isOwnNote(note)) {
                    // The reader's own note: a drag takes it to a time, a click changes its words.
                    el.classList.add('plan-week-own-note');
                    el.title = 'Drag to a time. Click to change.';
                    dressWeekNoteText(el, note);
                    setupWeekBlockDrag(el, { kind: 'note', id: note.id }, {
                        onClick: (event) => selectWeekNote(note, el, event),
                    });
                }
                allday.appendChild(el);
                return;
            }

            // The reader's own note with hours is a block (see renderWeekBlocks).
            if (isOwnNote(note)) return;

            const grid = container.querySelector(
                `.plan-week-time-grid[data-date-key="${note.dateKey}"]`
            );
            if (grid) grid.appendChild(createWeekTimedEvent(note));
        });

        freeformLines.filter(isVisible).forEach((line) => {
            if (!line.startDate || !line.endDate) return;

            // A line drawn down the hours of one day.
            if (lineHasTime(line)) {
                if (!isDateInVisibleWeek(line.startDate)) return;
                const grid = container.querySelector(`.plan-week-time-grid[data-date-key="${line.startDate}"]`);
                if (grid) grid.appendChild(createWeekTimedLine(line));
                return;
            }

            const label = line.label?.trim();
            if (!label) return;

            const drawn = weekRenderedRange();
            for (let i = drawn.first; i <= drawn.last; i++) {
                const dayKey = formatDateKey(addDays(weekStartDate, i));
                if (dayKey < line.startDate || dayKey > line.endDate) continue;

                const allday = container.querySelector(
                    `.plan-week-allday-row[data-date-key="${dayKey}"]`
                );
                if (!allday) continue;

                const el = document.createElement('div');
                el.className =
                    'plan-week-allday-item line-event' +
                    (line.source === 'calendar' ? ' calendar-event' : ' user-event');
                if (line.source === 'calendar') {
                    el.textContent = label;
                } else {
                    // The reader's own line, as the Months view has it: its
                    // name in the hand font over a bar of its colour. A click
                    // gives the menu of the Months view.
                    el.classList.add('plan-week-own-line');
                    el.dataset.weekLineId = line.id;
                    const name = document.createElement('span');
                    name.className = 'plan-week-line-label';
                    // The name stands on the first day that shows. The bar goes on.
                    name.textContent = dayKey === line.startDate || i === drawn.first ? label : '\u00a0';
                    const bar = document.createElement('span');
                    bar.className = 'plan-week-line-bar';
                    bar.style.height = `${Math.min(line.width || 8, 8)}px`;
                    if (line.color) bar.style.background = line.color;
                    el.appendChild(name);
                    el.appendChild(bar);
                    el.addEventListener('mousedown', (event) => event.stopPropagation());
                    el.addEventListener('click', (event) => {
                        event.stopPropagation();
                        showLineEditor(line.id, bar);
                    });
                }
                allday.appendChild(el);
            }
        });

        renderWeekBlocks();
        markWeekCurrentTimeIndicator();
        // Notes and calendar events came into the all-day rows above.
        requestAnimationFrame(() => { if (isInitialized) syncWeekGoalGutterSpacer(); });
    }

    function markWeekCurrentTimeIndicator() {
        container.querySelectorAll('.plan-week-now-marker').forEach((el) => el.remove());

        const now = new Date();
        const todayKey = formatDateKey(now);
        if (!isDateInVisibleWeek(todayKey)) return;

        const minutes = now.getHours() * 60 + now.getMinutes();
        const rangeStart = WEEK_VIEW_START_HOUR * 60;
        const rangeEnd = (WEEK_VIEW_END_HOUR + 1) * 60;
        if (minutes < rangeStart || minutes > rangeEnd) return;

        const grid = container.querySelector(
            `.plan-week-time-grid[data-date-key="${todayKey}"]`
        );
        if (!grid) return;

        const marker = document.createElement('div');
        marker.className = 'plan-week-now-marker';
        marker.style.top = `${((minutes - rangeStart) / 60) * WEEK_VIEW_HOUR_HEIGHT}px`;
        grid.appendChild(marker);
    }

    function scrollWeekViewToCurrentTime() {
        if (calendarViewMode !== 'week' || !calendarContainer) return;

        const todayKey = formatDateKey(new Date());
        if (!isDateInVisibleWeek(todayKey)) {
            calendarContainer.scrollTop = 0;
            return;
        }

        const now = new Date();
        const minutes = now.getHours() * 60 + now.getMinutes();
        const rangeStart = WEEK_VIEW_START_HOUR * 60;
        const targetTop = Math.max(0, ((minutes - rangeStart) / 60) * WEEK_VIEW_HOUR_HEIGHT - 120);
        calendarContainer.scrollTop = targetTop;
    }

    function createMonthColumn(month, year) {
        const col = document.createElement('div');
        col.className = 'plan-month-column';
        col.dataset.month = month;
        col.dataset.year = year;

        const header = document.createElement('div');
        header.className = 'plan-month-header';
        const monthName = currentLanguage === 'da' ? MONTHS_DA[month] : MONTHS_EN[month];
        // Add year if different from today's year
        const showYear = year !== new Date().getFullYear();
        header.textContent = showYear ? `${monthName} ${year}` : monthName;
        col.appendChild(header);

        const days = document.createElement('div');
        days.className = 'plan-days-container';
        const daysInMonth = new Date(year, month + 1, 0).getDate();

        for (let d = 1; d <= daysInMonth; d++) {
            const date = new Date(year, month, d);
            const weekday = date.getDay() === 0 ? 6 : date.getDay() - 1;
            const isWeekend = weekday >= 5;
            const isToday = date.toDateString() === new Date().toDateString();

            const row = document.createElement('div');
            row.className = 'plan-day-row' + (isWeekend ? ' weekend' : '') + (isToday ? ' today' : '');
            row.dataset.dateKey = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

            const dayName = document.createElement('span');
            dayName.className = 'plan-day-name';
            dayName.textContent = currentLanguage === 'da' ? WEEKDAYS_DA[weekday] : WEEKDAYS_EN[weekday];
            row.appendChild(dayName);

            const dayNum = document.createElement('span');
            dayNum.className = 'plan-day-number';
            dayNum.textContent = d;
            row.appendChild(dayNum);

            const noteArea = document.createElement('div');
            noteArea.className = 'plan-note-area';

            // Add holiday if applicable
            const dateKey = row.dataset.dateKey;
            const holidays = getHolidays(year);
            if (holidays[dateKey]) {
                const holidayEl = document.createElement('span');
                holidayEl.className = 'plan-note-text holiday';
                holidayEl.textContent = holidays[dateKey];
                noteArea.appendChild(holidayEl);
            }
            row.appendChild(noteArea);

            if (weekday === 6) {
                const weekNum = document.createElement('span');
                weekNum.className = 'plan-week-number';
                weekNum.textContent = getWeekNumber(date);
                row.appendChild(weekNum);
            }

            days.appendChild(row);
        }
        col.appendChild(days);
        return col;
    }

    function getWeekNumber(date) {
        const start = new Date(date.getFullYear(), 0, 1);
        const diff = (date - start + ((start.getDay() + 6) % 7) * 86400000) / 86400000;
        return Math.ceil(diff / 7);
    }



    let onCalendarKeyDown = null;
    let redrawAfterWritingTimer = null;

    function readerIsWriting() {
        if (!container) return false;
        return Boolean(container.querySelector(
            '.plan-note-input-inline, .plan-week-inline-input, .plan-note-text[contenteditable="true"], .plan-week-note-text[contenteditable="true"], .plan-line-label[contenteditable="true"]'
        ));
    }

    // A re-draw makes new elements. What was selected is found again by its
    // id, so it keeps its mark and Delete still takes away what is on screen.
    function restoreSelectionAfterRedraw() {
        if (selectedElements.length === 0) return;
        selectedElements = selectedElements.filter((sel) => {
            const found = sel.type === 'note'
                ? container.querySelector(`.plan-note-text[data-note-id="${sel.id}"], .plan-week-note-text[data-note-id="${sel.id}"]`)
                : container.querySelector(`.plan-note-line-container[data-line-id="${sel.id}"], .plan-note-line-container[data-line-id^="${sel.id}-seg-"], [data-week-line-id="${sel.id}"] .plan-week-line-bar`);
            if (!found) return false;
            sel.element = found;
            found.classList.add('selected');
            return true;
        });
        if (selectedElements.length === 0) deselectElement();
    }

    function renderFreeformElements() {
        // Skip rendering if a drag operation is in progress
        if (isDragInProgress) {
            console.log('[Plan] Skipping render - drag in progress');
            return;
        }

        // A re-draw takes every note and line away and makes them again. The
        // box of a new note is one of them, and so is a note whose words are
        // being changed. The host asks for a re-draw when the tasks change, a
        // linked calendar does when it syncs, and the window does when it is
        // resized: the caret then went away under the reader's hands. The
        // re-draw waits until the writing is done.
        if (readerIsWriting()) {
            clearTimeout(redrawAfterWritingTimer);
            redrawAfterWritingTimer = setTimeout(() => { if (isInitialized) renderFreeformElements(); }, 400);
            return;
        }

        // Clear canvas layer (for lines)
        canvasLayer.innerHTML = '';

        if (calendarViewMode === 'week') {
            container.querySelectorAll('.plan-week-allday-row').forEach((row) => {
                // The notes and the calendar events are drawn again below. A holiday,
                // a deadline and a To-Do task are made with the column, and stay.
                row.querySelectorAll('.plan-week-allday-item:not(.holiday):not(.application-deadline):not(.calendar-task)').forEach((el) => el.remove());
            });
            container.querySelectorAll('.plan-week-time-grid').forEach((grid) => {
                grid.querySelectorAll('.plan-week-event, .plan-week-now-marker, .plan-week-line').forEach((el) => el.remove());
            });
        } else {
            // Clear all note-areas
            container.querySelectorAll('.plan-note-area').forEach(area => area.innerHTML = '');

            // Re-add holidays to note-areas
            container.querySelectorAll('.plan-day-row').forEach(row => {
                const dateKey = row.dataset.dateKey;
                if (!dateKey) return;

                const year = parseInt(dateKey.split('-')[0]);
                const holidays = getHolidays(year);

                if (holidays[dateKey]) {
                    const noteArea = row.querySelector('.plan-note-area');
                    if (noteArea) {
                        const holidayEl = document.createElement('span');
                        holidayEl.className = 'plan-note-text holiday';
                        holidayEl.textContent = holidays[dateKey];
                        noteArea.appendChild(holidayEl);
                    }
                }            });
        }

        // Use requestAnimationFrame to ensure DOM is laid out before measuring positions
        requestAnimationFrame(() => {
            // Force reflow to ensure all layout calculations are complete
            // This is needed because getBoundingClientRect needs accurate positions
            // Get IDs of visible calendars
            const visibleCalendarIds = calendars.filter(c => c.visible !== false).map(c => c.id);

            // Filter function to check if item should be shown
            const isVisible = item => {
                if (item.source !== 'calendar') return true; // User items always visible
                const visible = visibleCalendarIds.includes(item.calendarId);
                return visible;
            };

            if (calendarViewMode === 'week') {
                renderWeekFreeformElements(isVisible);
                return;
            }

            // The days first: a day opened in place is taller, and the lines
            // are measured against the rows.
            renderMonthDays(freeformNotes.filter(isVisible));

            // Render all lines (user-drawn AND calendar-synced)
            freeformLines.filter(isVisible).forEach(l => {
                renderLineOrSplit(l, canvasLayer);
            });


            // Helper to render a line, splitting it if it crosses month boundaries
            function renderLineOrSplit(line, container) {
                if (!line.startDate || !line.endDate) {
                    // Legacy line without dates, just render
                    container.appendChild(createLine(line));
                    return;
                }

                const startParts = line.startDate.split('-').map(Number);
                const endParts = line.endDate.split('-').map(Number);

                // Check if year and month are the same
                if (startParts[0] === endParts[0] && startParts[1] === endParts[1]) {
                    // Same month, render normally
                    container.appendChild(createLine(line));
                    return;
                }

                // Crosses month boundary - split into segments
                let currentYear = startParts[0];
                let currentMonth = startParts[1];

                // Loop from start month to end month
                while (currentYear < endParts[0] || (currentYear === endParts[0] && currentMonth <= endParts[1])) {
                    const isFirstSegment = currentYear === startParts[0] && currentMonth === startParts[1];
                    const isLastSegment = currentYear === endParts[0] && currentMonth === endParts[1];

                    const segmentStart = isFirstSegment ? line.startDate :
                        `${currentYear}-${String(currentMonth).padStart(2, '0')}-01`;

                    // Calculate last day of current month
                    const daysInMonth = new Date(currentYear, currentMonth, 0).getDate();
                    const segmentEnd = isLastSegment ? line.endDate :
                        `${currentYear}-${String(currentMonth).padStart(2, '0')}-${daysInMonth}`;

                    // Clone line properties
                    const segment = { ...line };
                    // Generate a transient ID for the segment so it doesn't conflict
                    segment.id = line.id + `-seg-${currentYear}-${currentMonth}`;
                    segment.startDate = segmentStart;
                    segment.endDate = segmentEnd;
                    // Tag so createLine still renders single-day tail segments as vertical bars
                    segment.isMultiDaySegment = true;

                    // Render this segment
                    container.appendChild(createLine(segment));

                    // Move to next month
                    currentMonth++;
                    if (currentMonth > 12) {
                        currentMonth = 1;
                        currentYear++;
                    }
                }
            }

            restoreSelectionAfterRedraw();
        });
    }

    /*
     * The items of each month day: notes, calendar events and application
     * deadlines.
     *
     * A day with one item draws it where it was put. A day with more used to
     * draw them all at their own positions, on the same pixels. Now it keeps
     * one line, so the weeks keep their rhythm: a holiday's name, the first
     * item, and a count of the rest that opens the day in place.
     */
    function dayItemRank(item) {
        if (item.kind === 'deadline') return [0, 0];
        if (item.kind === 'task') return [0, 1];
        const note = item.note;
        if (note.source === 'calendar') {
            if (note.isAllDay || note.startMinutes == null) return [1, 0];
            return [3, note.startMinutes];
        }
        return [2, note.offsetX || 0];
    }

    function renderMonthDays(notes) {
        const byDay = new Map();
        const add = (dateKey, item) => {
            if (!byDay.has(dateKey)) byDay.set(dateKey, []);
            byDay.get(dateKey).push(item);
        };
        notes.forEach(note => {
            if (note.dateKey) add(note.dateKey, { kind: 'note', note });
        });
        const deadlines = window.PlanApplicationDeadlines;
        if (Array.isArray(deadlines)) {
            deadlines.forEach(deadline => {
                if (deadline && deadline.dateKey) add(deadline.dateKey, { kind: 'deadline', deadline });
            });
        }

        calendarTasks.forEach(task => add(task.dateKey, { kind: 'task', task }));

        container.querySelectorAll('.plan-day-row.is-expanded').forEach(row => row.classList.remove('is-expanded'));
        const itemEl = item => item.kind === 'deadline'
            ? createDeadlineItemEl(item.deadline)
            : item.kind === 'task'
                ? createTaskItemEl(item.task)
                : createNote(item.note);

        byDay.forEach((items, dateKey) => {
            const row = container.querySelector(`.plan-day-row[data-date-key="${dateKey}"]`);
            const noteArea = row && row.querySelector('.plan-note-area');
            if (!noteArea) return;
            const holidayEl = noteArea.querySelector('.plan-note-text.holiday');

            if (items.length === 1 && !holidayEl) {
                noteArea.appendChild(itemEl(items[0]));
                return;
            }

            items.sort((a, b) => {
                const x = dayItemRank(a);
                const y = dayItemRank(b);
                return x[0] - y[0] || x[1] - y[1];
            });
            const expanded = expandedDateKey === dateKey && items.length > 1;
            const wrap = document.createElement('div');
            wrap.className = expanded ? 'plan-day-stack' : 'plan-day-line';
            if (holidayEl) wrap.appendChild(holidayEl);
            (expanded ? items : items.slice(0, 1)).forEach(item => {
                const el = itemEl(item);
                // In the line, not at the position it was put.
                el.style.position = '';
                el.style.left = '';
                el.style.zIndex = '';
                if (!expanded) el.classList.add('plan-day-first');
                wrap.appendChild(el);
            });
            if (items.length > 1) wrap.appendChild(createDayMoreButton(dateKey, items.length, expanded));
            if (expanded) row.classList.add('is-expanded');
            noteArea.appendChild(wrap);
        });
    }

    function createDayMoreButton(dateKey, count, expanded) {
        const button = document.createElement('button');
        const da = currentLanguage === 'da';
        button.type = 'button';
        button.className = 'plan-day-more';
        button.textContent = expanded ? (da ? 'Vis mindre' : 'Show less') : `+${count - 1}`;
        button.title = expanded
            ? (da ? 'Vis dagen på én linje' : 'Show this day on one line')
            : (da ? `Vis alle ${count} på denne dag` : `Show all ${count} items on this day`);
        button.setAttribute('aria-expanded', expanded ? 'true' : 'false');
        // A press on the day starts a new note; a press here only opens or closes the day.
        ['pointerdown', 'mousedown', 'mouseup', 'dblclick'].forEach(type => {
            button.addEventListener(type, e => e.stopPropagation());
        });
        button.addEventListener('click', e => {
            e.stopPropagation();
            expandedDateKey = expanded ? null : dateKey;
            renderFreeformElements();
        });
        return button;
    }

    function createNote(note) {
        const el = document.createElement('span');
        el.className = 'plan-note-text freeform';

        // Add class for calendar-sourced notes
        if (note.source === 'calendar') {
            el.classList.add('calendar-event');
        }

        el.innerHTML = note.html || note.text || 'Note';

        // Absolute positioning within note-area using offsetX
        // Note: top position is handled by CSS (.plan-note-text.freeform { top: -4px })
        el.style.position = 'absolute';
        el.style.left = (note.offsetX || 0) + 'px';
        el.style.zIndex = note.source === 'calendar' ? '50' : '100'; // User notes on top of calendar events

        // Apply styling
        if (note.fontFamily) el.style.fontFamily = note.fontFamily + ', sans-serif';
        if (note.fontColor) el.style.color = note.fontColor;
        if (note.bgColor) el.style.backgroundColor = note.bgColor;

        el.dataset.noteId = note.id;
        if (note.source === 'calendar') {
            el.title = `From calendar: ${note.calendarName || 'Unknown'}`;
        }

        // Track dragging to distinguish from click
        let hasDragged = false;

        el.addEventListener('mousedown', e => {
            if (el.getAttribute('contenteditable') === 'true') return;

            e.preventDefault();
            e.stopPropagation();

            isDragInProgress = true;  // Prevent render during drag
            hasDragged = false;
            const mouseStartX = pointerX(e);
            const mouseStartY = pointerY(e);

            // Create a temporary dragging clone on canvas
            const rect = rectOf(el);
            const canvasRect = rectOf(canvasLayer);
            let dragX = rect.left - canvasRect.left;
            let dragY = rect.top - canvasRect.top;

            // Track where within the note the user clicked (for maintaining relative position on drop)
            const clickOffsetX = mouseStartX - rect.left;

            const dragClone = el.cloneNode(true);
            dragClone.classList.add('dragging');
            dragClone.style.position = 'absolute';
            dragClone.style.left = dragX + 'px';
            dragClone.style.top = dragY + 'px';
            dragClone.style.pointerEvents = 'none';
            dragClone.style.opacity = '0.9';
            dragClone.style.zIndex = '9999';
            canvasLayer.appendChild(dragClone);

            // Hide original while dragging
            el.style.opacity = '0.3';

            const onMouseMove = moveEvent => {
                const deltaX = pointerX(moveEvent) - mouseStartX;
                const deltaY = pointerY(moveEvent) - mouseStartY;

                if (Math.abs(deltaX) > 5 || Math.abs(deltaY) > 5) {
                    hasDragged = true;
                }

                dragClone.style.left = (dragX + deltaX) + 'px';
                dragClone.style.top = (dragY + deltaY) + 'px';
            };

            const onMouseUp = moveEvent => {
                document.removeEventListener('mousemove', onMouseMove);
                document.removeEventListener('mouseup', onMouseUp);

                isDragInProgress = false;  // Re-enable render
                dragClone.remove();
                el.style.opacity = '1';

                if (hasDragged) {
                    // Use cursor position for snapping
                    // findClosestDateRowPosition expects viewport-relative coordinates 
                    // (matching how it uses getBoundingClientRect for row positions)
                    const canvasRect = rectOf(canvasLayer);
                    const cursorX = pointerX(moveEvent) - canvasRect.left;
                    const cursorY = pointerY(moveEvent) - canvasRect.top;

                    // Subtract click offset so the note's left edge maintains relative position to cursor
                    const adjustedX = cursorX - clickOffsetX;
                    const snapped = findClosestDateRowPosition(adjustedX, cursorY);

                    console.log('[Plan] Note drag drop:', {
                        cursorX, cursorY, adjustedX,
                        snapped,
                        originalDateKey: note.dateKey
                    });

                    if (snapped.dateKey) {
                        // Update note data
                        note.dateKey = snapped.dateKey;
                        note.offsetX = snapped.offsetX;
                        saveData();

                        // Re-render to move note to new location
                        renderFreeformElements();
                    } else {
                        // No valid drop target found - just re-render to restore original position
                        console.warn('[Plan] No valid drop target, restoring original position');
                        renderFreeformElements();
                    }
                } else {
                    // It was a click, show editor
                    // Store click position for cursor placement
                    window._lastClickEvent = { clientX: moveEvent.clientX, clientY: moveEvent.clientY };
                    showNoteEditor(note.id, el, moveEvent.shiftKey);
                }
            };

            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        });

        // Handle input for inline editing
        el.addEventListener('input', () => {
            note.html = el.innerHTML;
            note.text = el.textContent.trim();
            saveData();
        });


        return el;
    }

    function createLine(line) {
        // Container for line and handles
        const containerEl = document.createElement('div');
        containerEl.className = 'plan-note-line-container';
        containerEl.dataset.lineId = line.id;

        const color = line.color || '#333333';
        const width = line.width || 8;

        // Check if this is a calendar multi-day event (vertical line)
        const isCalendarLine = line.source === 'calendar' || line.isCalendarEvent;
        const isCalendarMultiDay = isCalendarLine && line.startDate && line.endDate && (line.startDate !== line.endDate || line.isMultiDaySegment);

        if (isCalendarMultiDay) {
            // Render as VERTICAL line spanning multiple dates
            containerEl.classList.add('calendar-event', 'vertical-line');

            // Find all rows for the date range
            const startRow = container.querySelector(`.plan-day-row[data-date-key="${line.startDate}"]`);
            const endRow = container.querySelector(`.plan-day-row[data-date-key="${line.endDate}"]`);

            if (!startRow || !endRow) {
                containerEl.style.display = 'none';
                return containerEl;
            }

            const containerRect = rectOf(calendarContainer);
            const startRect = rectOf(startRow);
            const endRect = rectOf(endRow);

            // Calculate vertical line position relative to the start row
            // verticalLineX stores extra offset from default (50px from row start)
            const rowLeftRelative = startRect.left - containerRect.left + calendarContainer.scrollLeft;
            const userOffset = line.verticalLineX !== undefined ? line.verticalLineX : 50;
            const xPos = rowLeftRelative + userOffset;
            const topY = startRect.top - containerRect.top + calendarContainer.scrollTop;
            const bottomY = endRect.bottom - containerRect.top + calendarContainer.scrollTop;
            const lineHeight = bottomY - topY;

            containerEl.style.position = 'absolute';
            containerEl.style.left = xPos + 'px';
            containerEl.style.top = topY + 'px';
            containerEl.style.width = width + 'px'; // Just fit the line bar itself
            containerEl.style.height = lineHeight + 'px';
            containerEl.style.overflow = 'visible'; // Allow label to overflow

            // Create vertical line element
            const lineEl = document.createElement('div');
            lineEl.className = 'plan-note-line vertical';
            lineEl.style.position = 'absolute';
            lineEl.style.left = '0';
            lineEl.style.top = '0';
            lineEl.style.width = width + 'px';
            lineEl.style.height = '100%';
            lineEl.style.background = color;
            lineEl.style.borderRadius = '4px';
            lineEl.style.cursor = 'pointer';

            // Create label (positioned to the right of the line, centered vertically)
            const labelEl = document.createElement('div');
            labelEl.className = 'plan-line-label vertical';
            labelEl.textContent = line.label || '';
            labelEl.style.position = 'absolute';
            labelEl.style.left = (width + 4) + 'px';
            labelEl.style.top = '50%';
            labelEl.style.transform = 'translateY(-50%)';
            labelEl.style.maxWidth = '150px';
            labelEl.style.wordWrap = 'break-word';
            labelEl.style.whiteSpace = 'normal';
            labelEl.style.cursor = 'pointer';
            if (line.fontFamily) labelEl.style.fontFamily = line.fontFamily + ', sans-serif';
            if (line.fontColor) labelEl.style.color = line.fontColor;

            containerEl.title = `From calendar: ${line.calendarName || 'Unknown'}`;
            containerEl.appendChild(lineEl);
            containerEl.appendChild(labelEl);

            // Horizontal drag to move vertical line left/right
            let isDragging = false;
            let dragStartX = 0;
            let initialLeft = 0;

            containerEl.style.cursor = 'ew-resize'; // Show horizontal resize cursor
            labelEl.style.cursor = 'ew-resize'; // Also on label

            containerEl.addEventListener('mousedown', (e) => {
                if (labelEl.getAttribute('contenteditable') === 'true') return;

                isDragInProgress = true;  // Prevent render during drag
                isDragging = true;
                dragStartX = pointerX(e);
                initialLeft = parseFloat(containerEl.style.left) || 0;
                e.preventDefault();
                e.stopPropagation();

                const onMouseMove = (moveEvent) => {
                    if (!isDragging) return;
                    const deltaX = pointerX(moveEvent) - dragStartX;
                    const newLeft = initialLeft + deltaX;
                    containerEl.style.left = newLeft + 'px';
                };

                const onMouseUp = () => {
                    isDragInProgress = false;  // Re-enable render
                    if (isDragging) {
                        isDragging = false;
                        // Save the new horizontal position as relative offset from row
                        const newLeft = parseFloat(containerEl.style.left) || 0;
                        // Calculate relative offset: newLeft - rowLeftRelative = userOffset
                        line.verticalLineX = newLeft - rowLeftRelative;
                        saveData();
                    }
                    document.removeEventListener('mousemove', onMouseMove);
                    document.removeEventListener('mouseup', onMouseUp);
                };

                document.addEventListener('mousemove', onMouseMove);
                document.addEventListener('mouseup', onMouseUp);
            });

            // Click to select and show line toolbar (same as user-drawn lines)
            const selectLine = (e) => {
                if (isDragging) return; // Don't select during drag
                e.stopPropagation();
                showLineEditor(line.id, containerEl);
            };

            lineEl.addEventListener('click', selectLine);
            labelEl.addEventListener('click', selectLine);

            // Double-click to edit label in place
            const editLabel = (e) => {
                e.preventDefault();
                e.stopPropagation();
                labelEl.setAttribute('contenteditable', 'true');
                labelEl.focus();
                // Select all text
                const range = document.createRange();
                range.selectNodeContents(labelEl);
                const sel = window.getSelection();
                sel.removeAllRanges();
                sel.addRange(range);
            };

            lineEl.addEventListener('dblclick', editLabel);
            labelEl.addEventListener('dblclick', editLabel);

            // Save on blur/enter
            labelEl.addEventListener('blur', () => {
                labelEl.removeAttribute('contenteditable');
                line.label = labelEl.textContent.trim();
                saveData();
            });

            labelEl.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    labelEl.blur();
                }
                if (e.key === 'Escape') {
                    labelEl.textContent = line.label || '';
                    labelEl.blur();
                }
            });

            return containerEl;
        }

        // Check if using new date-relative format or old pixel format
        const usesDateCoords = line.startDate && line.endDate;

        let x1, y1, x2, y2;

        if (usesDateCoords) {
            // New format: convert date-relative to screen coords
            const start = dateCoordsToScreen(line.startDate, line.startOffsetX || 0);
            const end = dateCoordsToScreen(line.endDate, line.endOffsetX || 0);
            if (!start || !end) {
                console.warn('[Plan] createLine: Could not convert date coords, line may be off-screen', line.id);
                // Return an invisible placeholder if dates are not in DOM
                containerEl.style.display = 'none';
                return containerEl;
            }
            x1 = start.x; y1 = start.y;
            x2 = end.x; y2 = end.y;
        } else {
            // Old format: use pixel coords directly (backward compatibility)
            x1 = line.x1; y1 = line.y1 || line.y;
            x2 = line.x2; y2 = line.y2 || line.y;
        }

        // The line element
        const lineEl = document.createElement('div');
        lineEl.className = 'plan-note-line';

        // Add class for calendar-sourced lines
        if (line.source === 'calendar') {
            containerEl.classList.add('calendar-event');
        }

        lineEl.style.transformOrigin = '0 50%';
        // Only set inline color if explicitly specified, otherwise let CSS control it
        if (color && color !== '#333' && color !== '#333333') {
            lineEl.style.background = color;
        }
        lineEl.style.height = width + 'px';

        // Label element (positioned at center of line)
        const labelEl = document.createElement('div');
        labelEl.className = 'plan-line-label';
        labelEl.textContent = line.label || '';
        if (!line.label) labelEl.classList.add('empty');

        // Apply calendar styling to label
        if (line.fontFamily) labelEl.style.fontFamily = line.fontFamily + ', sans-serif';
        if (line.fontColor) labelEl.style.color = line.fontColor;

        if (line.source === 'calendar') {
            containerEl.title = `From calendar: ${line.calendarName || 'Unknown'}`;
        }

        // Endpoint handles (hidden by default, shown when selected)
        const handle1 = document.createElement('div');
        handle1.className = 'plan-line-handle';
        handle1.dataset.endpoint = '1';

        const handle2 = document.createElement('div');
        handle2.className = 'plan-line-handle';
        handle2.dataset.endpoint = '2';

        function updateLineGeometry() {
            const dx = x2 - x1;
            const dy = y2 - y1;
            const length = Math.sqrt(dx * dx + dy * dy);
            const angle = Math.atan2(dy, dx) * (180 / Math.PI);

            lineEl.style.left = x1 + 'px';
            lineEl.style.top = y1 + 'px';
            lineEl.style.width = length + 'px';
            lineEl.style.transform = `rotate(${angle}deg)`;

            // Update handle positions
            handle1.style.left = (x1 - 6) + 'px';
            handle1.style.top = (y1 - 6) + 'px';
            handle2.style.left = (x2 - 6) + 'px';
            handle2.style.top = (y2 - 6) + 'px';

            // Position label at center of line
            const centerX = (x1 + x2) / 2;
            const centerY = (y1 + y2) / 2;
            labelEl.style.left = centerX + 'px';
            labelEl.style.top = centerY + 'px';
        }

        containerEl.appendChild(lineEl);
        containerEl.appendChild(labelEl);
        containerEl.appendChild(handle1);
        containerEl.appendChild(handle2);
        updateLineGeometry();

        // Double-click to edit label
        lineEl.addEventListener('dblclick', e => {
            e.preventDefault();
            e.stopPropagation();
            // Make label editable for inline editing
            if (!line.label) {
                line.label = '';
                labelEl.textContent = '';
                labelEl.classList.remove('empty');
            }
            labelEl.setAttribute('contenteditable', 'true');
            labelEl.focus();
            // Select all text
            const range = document.createRange();
            range.selectNodeContents(labelEl);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
        });

        labelEl.addEventListener('dblclick', e => {
            e.preventDefault();
            e.stopPropagation();
            // Make label editable for inline editing
            labelEl.setAttribute('contenteditable', 'true');
            labelEl.focus();
            // Select all text
            const range = document.createRange();
            range.selectNodeContents(labelEl);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
        });

        // Handle blur to save label changes
        labelEl.addEventListener('blur', () => {
            labelEl.setAttribute('contenteditable', 'false');
            line.label = labelEl.textContent.trim();
            if (line.label) {
                labelEl.classList.remove('empty');
            } else {
                labelEl.classList.add('empty');
            }
            saveData();
            // Update toolbar label field if visible
            const labelField = container.querySelector('.plan-line-label-field');
            if (labelField) labelField.value = line.label;
        });

        // Handle Enter key to finish editing
        labelEl.addEventListener('keydown', e => {
            if (e.key === 'Enter') {
                e.preventDefault();
                labelEl.blur();
            } else if (e.key === 'Escape') {
                labelEl.textContent = line.label || '';
                labelEl.blur();
            }
        });

        // Track if label was dragged (used by click handler)
        let labelWasDragged = false;

        // Click handler for label - select the line on single click
        labelEl.addEventListener('click', e => {
            // Don't interfere with editing
            if (labelEl.getAttribute('contenteditable') === 'true') return;

            // If we just finished dragging, don't select
            if (labelWasDragged) {
                labelWasDragged = false;
                return;
            }

            e.preventDefault();
            e.stopPropagation();

            // Select the line
            containerEl.classList.add('selected');
            showLineEditor(line.id, lineEl);
        });

        // Mousedown on label - supports drag to move
        labelEl.addEventListener('mousedown', e => {
            // Don't interfere with editing
            if (labelEl.getAttribute('contenteditable') === 'true') return;

            e.preventDefault();
            e.stopPropagation();

            labelWasDragged = false;
            const mouseStartX = pointerX(e);
            const mouseStartY = pointerY(e);
            const origX1 = x1, origY1 = y1, origX2 = x2, origY2 = y2;

            const onMouseMove = moveEvent => {
                const deltaX = pointerX(moveEvent) - mouseStartX;
                const deltaY = pointerY(moveEvent) - mouseStartY;

                if (Math.abs(deltaX) > 5 || Math.abs(deltaY) > 5) {
                    labelWasDragged = true;
                    lineEl.classList.add('dragging');
                }

                if (labelWasDragged) {
                    x1 = origX1 + deltaX;
                    y1 = origY1 + deltaY;
                    x2 = origX2 + deltaX;
                    y2 = origY2 + deltaY;
                    updateLineGeometry();
                }
            };

            const onMouseUp = () => {
                document.removeEventListener('mousemove', onMouseMove);
                document.removeEventListener('mouseup', onMouseUp);
                lineEl.classList.remove('dragging');

                if (labelWasDragged) {
                    // Convert new pixel positions to date-relative coords
                    const startCoords = screenToDateCoords(x1, y1);
                    const endCoords = screenToDateCoords(x2, y2);

                    line.startDate = startCoords.dateKey;
                    line.startOffsetX = startCoords.offsetX;
                    line.endDate = endCoords.dateKey;
                    line.endOffsetX = endCoords.offsetX;
                    delete line.x1; delete line.y1; delete line.x2; delete line.y2;
                    saveData();
                }
                // Note: click handler will handle selection for non-drag clicks
            };

            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        });

        // Handle dragging for endpoints
        function setupHandleDrag(handle, isEndpoint2) {
            handle.addEventListener('mousedown', e => {
                e.preventDefault();
                e.stopPropagation();

                const onMouseMove = moveEvent => {
                    const rect = rectOf(canvasLayer);
                    const newX = pointerX(moveEvent) - rect.left;
                    const newY = pointerY(moveEvent) - rect.top + calendarContainer.scrollTop;

                    if (isEndpoint2) {
                        x2 = newX;
                        y2 = newY;
                    } else {
                        x1 = newX;
                        y1 = newY;
                    }
                    updateLineGeometry();
                };

                const onMouseUp = () => {
                    document.removeEventListener('mousemove', onMouseMove);
                    document.removeEventListener('mouseup', onMouseUp);

                    // Convert new pixel positions to date-relative coords
                    const startCoords = screenToDateCoords(x1, y1);
                    const endCoords = screenToDateCoords(x2, y2);

                    line.startDate = startCoords.dateKey;
                    line.startOffsetX = startCoords.offsetX;
                    line.endDate = endCoords.dateKey;
                    line.endOffsetX = endCoords.offsetX;
                    // Remove old pixel coords if present
                    delete line.x1; delete line.y1; delete line.x2; delete line.y2;
                    saveData();
                };

                document.addEventListener('mousemove', onMouseMove);
                document.addEventListener('mouseup', onMouseUp);
            });
        }

        setupHandleDrag(handle1, false);
        setupHandleDrag(handle2, true);

        // Track dragging to distinguish from click
        let hasDragged = false;
        let lastClickTime = 0;

        // Drag line to move (also handles click and double-click detection)
        lineEl.addEventListener('mousedown', e => {
            e.preventDefault();
            e.stopPropagation();

            const clickTime = Date.now();
            const isDoubleClick = (clickTime - lastClickTime) < 400;
            lastClickTime = clickTime;

            // If double-click, enable inline label editing
            if (isDoubleClick) {
                if (!line.label) {
                    line.label = '';
                    labelEl.textContent = '';
                    labelEl.classList.remove('empty');
                }
                labelEl.setAttribute('contenteditable', 'true');
                labelEl.focus();
                return;
            }

            hasDragged = false;
            const mouseStartX = pointerX(e);
            const mouseStartY = pointerY(e);
            const origX1 = x1, origY1 = y1, origX2 = x2, origY2 = y2;

            lineEl.classList.add('dragging');

            const onMouseMove = moveEvent => {
                const deltaX = pointerX(moveEvent) - mouseStartX;
                const deltaY = pointerY(moveEvent) - mouseStartY;

                if (Math.abs(deltaX) > 5 || Math.abs(deltaY) > 5) {
                    hasDragged = true;
                }

                x1 = origX1 + deltaX;
                y1 = origY1 + deltaY;
                x2 = origX2 + deltaX;
                y2 = origY2 + deltaY;
                updateLineGeometry();
            };

            const onMouseUp = () => {
                document.removeEventListener('mousemove', onMouseMove);
                document.removeEventListener('mouseup', onMouseUp);
                lineEl.classList.remove('dragging');

                if (hasDragged) {
                    // Convert new pixel positions to date-relative coords
                    const startCoords = screenToDateCoords(x1, y1);
                    const endCoords = screenToDateCoords(x2, y2);

                    // Update line with new date-relative coords
                    line.startDate = startCoords.dateKey;
                    line.startOffsetX = startCoords.offsetX;
                    line.endDate = endCoords.dateKey;
                    line.endOffsetX = endCoords.offsetX;
                    // Remove old pixel coords if present
                    delete line.x1; delete line.y1; delete line.x2; delete line.y2;
                    saveData();
                } else {
                    // It was a click (not drag), show line editor and show handles
                    containerEl.classList.add('selected');
                    showLineEditor(line.id, lineEl);
                }
            };

            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        });

        return containerEl;
    }

    // Create inline text input for new notes
    function createFreeformInput(x, y, dateKey, offsetX) {
        // Remove any existing input (check if still attached to DOM to avoid race condition with blur handler)
        const existingInput = canvasLayer.querySelector('.plan-note-input-inline');
        if (existingInput && existingInput.parentNode) existingInput.remove();

        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'plan-note-input-inline';
        input.style.left = x + 'px';
        input.style.top = y + 'px';

        const finishEditing = () => {
            const text = input.value.trim();
            if (input.parentNode) input.remove();

            if (text && dateKey) {
                pushHistory();
                const noteId = Date.now().toString();
                const note = {
                    id: noteId,
                    text: text,
                    dateKey: dateKey,
                    offsetX: offsetX || 0,
                    group: activeGroup
                };
                freeformNotes.push(note);
                saveData();

                // Create and add note element to the date row's note-area
                const el = createNote(note);
                if (el) {
                    const row = container.querySelector(`.plan-day-row[data-date-key="${dateKey}"]`);
                    if (row) {
                        const noteArea = row.querySelector('.plan-note-area');
                        if (noteArea) noteArea.appendChild(el);
                    }
                }
            } else if (text && !dateKey) {
                console.warn('[Plan] Note not saved - dateKey is missing. Text:', text);
            }
        };

        input.addEventListener('blur', finishEditing);
        input.addEventListener('keydown', e => {
            if (e.key === 'Enter') {
                e.preventDefault();
                input.blur();
            } else if (e.key === 'Escape') {
                input.value = '';
                input.blur();
            }
        });

        canvasLayer.appendChild(input);
        input.focus();
        giveWideCaret(input);
        // The caret can be taken in the same moment by what comes after the
        // click (the window, a menu that closes). Ask for it one more time.
        requestAnimationFrame(() => {
            if (input.isConnected && document.activeElement !== input) input.focus();
        });
    }

    // A caret that is easy to see. The caret of a text box has one width, and
    // CSS cannot change it. While the caret is at the end of the words (where
    // it is while the reader types), the box hides its own caret and a bar of
    // 2px is drawn in its place. Anywhere else, the box shows its own caret.
    function giveWideCaret(input) {
        // A bar from a box that is gone must not stay. A box that is taken
        // out of the page with the caret in it gets no "blur" in the desktop
        // app's web view, so the bar of that box is looked for here too.
        input.parentNode.querySelectorAll(':scope > .plan-note-caret').forEach((old) => old.remove());
        const bar = document.createElement('span');
        bar.className = 'plan-note-caret';
        input._wideCaretBar = bar;
        const ruler = document.createElement('canvas').getContext('2d');
        const place = () => {
            if (!input.isConnected) { bar.remove(); return; }
            const atEnd = input.selectionStart === input.value.length && input.selectionEnd === input.value.length;
            const on = atEnd && document.activeElement === input;
            input.classList.toggle('plan-note-input-inline--own-caret', on);
            bar.style.display = on ? 'block' : 'none';
            if (!on) return;
            const style = getComputedStyle(input);
            ruler.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
            const words = ruler.measureText(input.value).width;
            const height = parseFloat(style.fontSize) * 1.1;
            bar.style.left = `${input.offsetLeft + parseFloat(style.paddingLeft) + words}px`;
            // A text box puts its words in the middle of its height. In a row
            // that stretches the box, the top of the box is not the top of the words.
            bar.style.top = `${input.offsetTop + Math.max(0, (input.offsetHeight - height) / 2)}px`;
            bar.style.height = `${height}px`;
            // Start the blink again, so the bar shows at once after a key.
            bar.style.animation = 'none';
            void bar.offsetWidth;
            bar.style.animation = '';
        };
        ['input', 'keyup', 'click', 'focus', 'select'].forEach((type) => input.addEventListener(type, place));
        input.addEventListener('blur', () => bar.remove());
        input.parentNode.appendChild(bar);
        place();
    }
    // Find the closest date row position for snapping
    // Input: x, y are canvas-relative (from mouse event relative to canvasLayer.getBoundingClientRect())
    // Since canvas scrolls with content, these are effectively content-relative
    function findClosestDateRowPosition(x, y) {
        const dayRows = container.querySelectorAll('.plan-day-row');
        let targetRow = null;
        let closestDistance = Infinity;
        // Use canvasLayer rect as reference since coords are relative to it
        const canvasRect = rectOf(canvasLayer);

        // Find the row that contains this point
        // Use center-based matching for more intuitive snapping behavior
        for (const row of dayRows) {
            if (row.classList.contains('hidden')) continue;
            const rect = rectOf(row);
            // Convert row position to canvas-relative coordinates
            const rowLeft = rect.left - canvasRect.left;
            const rowRight = rowLeft + rect.width;
            const rowTop = rect.top - canvasRect.top;
            const rowCenterY = rowTop + rect.height / 2;

            // Check if point is within this row's horizontal bounds and closer to this row's center
            if (x >= rowLeft && x < rowRight) {
                const yDistToCenter = Math.abs(y - rowCenterY);
                if (yDistToCenter < closestDistance) {
                    closestDistance = yDistToCenter;
                    targetRow = row;
                }
            } else {
                // Track closest row as fallback (for points outside columns)
                const xDist = x < rowLeft ? rowLeft - x : (x > rowRight ? x - rowRight : 0);
                const yDistToCenter = Math.abs(y - rowCenterY);
                const distance = Math.sqrt(xDist * xDist + yDistToCenter * yDistToCenter);

                if (distance < closestDistance) {
                    closestDistance = distance;
                    targetRow = row;
                }
            }
        }

        if (targetRow) {
            const rect = rectOf(targetRow);
            const noteArea = targetRow.querySelector('.plan-note-area');
            const dateKey = targetRow.dataset.dateKey;

            // Row's canvas-relative Y position
            const rowY = rect.top - canvasRect.top;

            let snappedX = x;
            let offsetX = 0;
            if (noteArea) {
                const noteAreaRect = rectOf(noteArea);
                const noteAreaLeft = noteAreaRect.left - canvasRect.left;
                snappedX = Math.max(noteAreaLeft, x);
                // Calculate offset relative to note-area left edge
                offsetX = x - noteAreaLeft;
                if (offsetX < 0) offsetX = 0;
            }

            // Return canvas-relative position, dateKey, and offsetX
            return {
                x: snappedX,
                y: rowY,
                dateKey: dateKey,
                offsetX: offsetX
            };
        }

        return { x, y, dateKey: null, offsetX: 0 };
    }

    // Convert screen coordinates to date-relative coordinates
    // screenX/screenY are canvas-relative (from mouse event relative to canvasLayer.getBoundingClientRect())
    // Returns { dateKey, offsetX } where offsetX is relative to the month column's left edge
    function screenToDateCoords(screenX, screenY) {
        const canvasRect = rectOf(canvasLayer);
        const dayRows = container.querySelectorAll('.plan-day-row');

        let closestRow = null;
        let closestDistance = Infinity;
        let columnLeft = 0;

        for (const row of dayRows) {
            if (row.classList.contains('hidden')) continue;
            const rect = rectOf(row);
            const rowTop = rect.top - canvasRect.top;
            const rowCenterY = rowTop + rect.height / 2;
            const dist = Math.abs(screenY - rowCenterY);

            if (dist < closestDistance) {
                closestDistance = dist;
                closestRow = row;
                // Get the month column's left edge (canvas-relative)
                const monthCol = row.closest('.plan-month-column');
                if (monthCol) {
                    columnLeft = rectOf(monthCol).left - canvasRect.left;
                }
            }
        }

        if (closestRow) {
            const dateKey = closestRow.dataset.dateKey;
            const offsetX = screenX - columnLeft;
            return { dateKey, offsetX };
        }

        return { dateKey: null, offsetX: screenX };
    }

    // Convert date-relative coordinates back to screen coordinates
    // Returns { x, y } in canvas-layer pixel coordinates
    function dateCoordsToScreen(dateKey, offsetX) {
        const row = container.querySelector(`.plan-day-row[data-date-key="${dateKey}"]`);
        if (!row) {
            console.warn('[Plan] dateCoordsToScreen: Row not found for', dateKey);
            return null;
        }

        const canvasRect = rectOf(canvasLayer);
        const rowRect = rectOf(row);
        const monthCol = row.closest('.plan-month-column');

        // X = column left + offsetX (canvas-relative)
        let x = offsetX;
        if (monthCol) {
            x = (rectOf(monthCol).left - canvasRect.left) + offsetX;
        }

        // Y = row center (canvas-relative)
        const y = rowRect.top - canvasRect.top + rowRect.height / 2;

        return { x, y };
    }

    // Show inline input for editing line label
    function showLineLabelInput(line, labelEl, updateGeometryCallback) {
        // Remove any existing line label input
        const existingInput = canvasLayer.querySelector('.plan-line-label-input');
        if (existingInput && existingInput.parentNode) existingInput.remove();

        // Get label position
        const labelRect = rectOf(labelEl);
        const containerRect = rectOf(calendarContainer);

        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'plan-line-label-input';
        input.value = line.label || '';
        input.placeholder = 'Add label...';
        input.style.left = (labelRect.left - containerRect.left) + 'px';
        input.style.top = (labelRect.top - containerRect.top + calendarContainer.scrollTop - 10) + 'px';

        const finishEditing = () => {
            const text = input.value.trim();
            if (input.parentNode) input.remove();

            line.label = text;
            labelEl.textContent = text;
            if (text) {
                labelEl.classList.remove('empty');
            } else {
                labelEl.classList.add('empty');
            }
            saveData();
        };

        input.addEventListener('blur', finishEditing);
        input.addEventListener('keydown', e => {
            if (e.key === 'Enter') {
                e.preventDefault();
                input.blur();
            } else if (e.key === 'Escape') {
                if (input.parentNode) input.remove();
            }
        });

        canvasLayer.appendChild(input);
        input.focus();
        input.select();
    }

    // Show note editor toolbar
    function showNoteEditor(noteId, noteElement, shiftKey = false) {
        const note = freeformNotes.find(n => n.id === noteId);
        if (!note) return;

        // Check if this note is already selected
        const existingIndex = selectedElements.findIndex(s => s.type === 'note' && s.id === noteId);

        // If already selected and only one item selected - enter edit mode on second click
        if (existingIndex >= 0 && selectedElements.length === 1 && !shiftKey) {
            // Already selected, enter edit mode
            noteElement.setAttribute('contenteditable', 'true');
            noteElement.focus();

            // Place cursor at click position (if we have click coordinates)
            if (window._lastClickEvent) {
                const range = document.caretRangeFromPoint(window._lastClickEvent.clientX, window._lastClickEvent.clientY);
                if (range) {
                    const sel = window.getSelection();
                    sel.removeAllRanges();
                    sel.addRange(range);
                }
            }
            return;
        }

        // Shift+click: add to selection (or remove if already selected)
        if (shiftKey) {
            if (existingIndex >= 0) {
                // Already selected, remove from selection
                selectedElements[existingIndex].element.classList.remove('selected');
                selectedElements.splice(existingIndex, 1);
                if (selectedElements.length === 0) {
                    container.classList.remove('has-selection');
                }
            } else {
                // Add to selection
                selectedElements.push({ type: 'note', id: noteId, element: noteElement });
                noteElement.classList.add('selected');
                container.classList.add('has-selection');
            }
        } else {
            // Normal click: deselect all and select just this one
            deselectElement();
            selectedElements.push({ type: 'note', id: noteId, element: noteElement });
            noteElement.classList.add('selected');
            container.classList.add('has-selection');
        }

        // Note is selected but NOT in edit mode yet
        // User can click again to enter edit mode, or press delete to remove

        // Exit editing on Enter (if in edit mode)
        const enterHandler = e => {
            if (e.key === 'Enter') {
                e.preventDefault();
                noteElement.blur();
                noteElement.setAttribute('contenteditable', 'false');
            }
        };
        noteElement.addEventListener('keydown', enterHandler);

        const toolbar = container.querySelector('.plan-note-toolbar');

        // Position toolbar centered above the element
        const rect = rectOf(noteElement);
        const containerRect = rectOf(container);
        const toolbarWidth = 280; // Approximate toolbar width

        // Center horizontally above the element
        const elementCenterX = rect.left - containerRect.left + rect.width / 2;
        let leftPos = elementCenterX - toolbarWidth / 2;
        // Ensure toolbar stays within bounds
        const maxLeft = containerRect.width - toolbarWidth - 8;
        leftPos = Math.max(8, Math.min(leftPos, maxLeft));

        toolbar.style.left = leftPos + 'px';
        toolbar.style.top = Math.max(8, rect.top - containerRect.top - 12) + 'px';

        toolbar.classList.remove('hidden');

        // Update snap toggle state
        const snapToggle = container.querySelector('.plan-note-snap-toggle');
        if (snapToggle) snapToggle.checked = note.snapToDate !== false;

        // Update color pickers
        const fontColorPicker = container.querySelector('.plan-font-color-picker');
        const fontColorIndicator = container.querySelector('.plan-font-color-indicator');
        const bgColorPicker = container.querySelector('.plan-bg-color-picker');
        const bgColorIndicator = container.querySelector('.plan-bg-color-indicator');

        if (fontColorPicker) fontColorPicker.value = note.fontColor || '#333333';
        if (fontColorIndicator) fontColorIndicator.style.background = note.fontColor || '#333333';
        if (bgColorPicker) bgColorPicker.value = note.bgColor || '#ffff00';
        if (bgColorIndicator) bgColorIndicator.style.background = note.bgColor || 'transparent';
    }

    // Show line editor toolbar
    function showLineEditor(lineId, lineElement) {
        // A part of a line over two months has the line's id and "-seg-…".
        // Without this, such a line could not be selected, so not deleted.
        lineId = String(lineId).replace(/-seg-\d+-\d+$/, '');
        const line = freeformLines.find(l => l.id === lineId);
        if (!line) return;

        deselectElement();
        selectedElements.push({ type: 'line', id: lineId, element: lineElement });
        lineElement.classList.add('selected');
        container.classList.add('has-selection');

        const toolbar = container.querySelector('.plan-line-toolbar');

        // Position toolbar centered above the element
        const rect = rectOf(lineElement);
        const containerRect = rectOf(container);
        const toolbarWidth = 280; // Approximate line toolbar width

        // Center horizontally above the element
        const elementCenterX = rect.left - containerRect.left + rect.width / 2;
        let leftPos = elementCenterX - toolbarWidth / 2;
        // Ensure toolbar stays within bounds
        const maxLeft = containerRect.width - toolbarWidth - 8;
        leftPos = Math.max(8, Math.min(leftPos, maxLeft));

        toolbar.style.left = leftPos + 'px';
        toolbar.style.top = Math.max(8, rect.top - containerRect.top - 12) + 'px';

        toolbar.classList.remove('hidden');

        // Update label field
        const labelField = container.querySelector('.plan-line-label-field');
        if (labelField) {
            labelField.value = line.label || '';
            // Remove old listener and add new one
            labelField.onchange = null;
            labelField.oninput = () => {
                line.label = labelField.value.trim();
                // Update the label element in the line container
                const lineContainer = canvasLayer.querySelector(`.plan-note-line-container[data-line-id="${lineId}"]`);
                if (lineContainer) {
                    const labelEl = lineContainer.querySelector('.plan-line-label');
                    if (labelEl) {
                        labelEl.textContent = line.label;
                        if (line.label) {
                            labelEl.classList.remove('empty');
                        } else {
                            labelEl.classList.add('empty');
                        }
                    }
                }
                container.querySelectorAll(`[data-week-line-id="${lineId}"] .plan-week-line-label`).forEach((el) => {
                    el.textContent = line.label;
                });
                saveData();
            };
        }

        // Update color picker
        const colorPicker = container.querySelector('.plan-line-color-picker');
        const colorIndicator = container.querySelector('.plan-line-color-indicator');
        if (colorPicker) colorPicker.value = line.color || '#333333';
        if (colorIndicator) colorIndicator.style.background = line.color || '#333333';

        // Update width select
        const widthSelect = container.querySelector('.plan-line-width-select');
        if (widthSelect) widthSelect.value = line.width || 8;
    }

    // Deselect all selected elements and hide toolbars
    function deselectElement() {
        selectedElements.forEach(sel => {
            sel.element.classList.remove('selected');

            if (sel.type === 'note') {
                sel.element.setAttribute('contenteditable', 'false');
                const note = freeformNotes.find(n => n.id === sel.id);
                if (note) {
                    note.html = sel.element.innerHTML;
                    note.text = sel.element.textContent.trim();
                }
            }

            // Remove selected class from line containers (hides handles)
            if (sel.type === 'line') {
                const lineContainer = sel.element.closest('.plan-note-line-container');
                if (lineContainer) lineContainer.classList.remove('selected');
            }
        });

        if (selectedElements.length > 0) {
            saveData();
        }
        selectedElements = [];

        container.classList.remove('has-selection');
        container.querySelector('.plan-note-toolbar')?.classList.add('hidden');
        container.querySelector('.plan-line-toolbar')?.classList.add('hidden');
    }

    // Delete all selected elements
    function deleteSelectedElement() {
        if (selectedElements.length === 0) return;

        pushHistory();

        selectedElements.forEach(sel => {
            if (sel.type === 'note') {
                freeformNotes = freeformNotes.filter(n => n.id !== sel.id);
                sel.element.remove();
            } else if (sel.type === 'line') {
                freeformLines = freeformLines.filter(l => l.id !== sel.id);
                const containerEl = sel.element.closest('.plan-note-line-container');
                if (containerEl) containerEl.remove();
                else sel.element.remove();
            }
        });

        saveData();
        selectedElements = [];
        container.classList.remove('has-selection');
        container.querySelector('.plan-note-toolbar')?.classList.add('hidden');
        container.querySelector('.plan-line-toolbar')?.classList.add('hidden');
        // The element that was kept with the selection can be an old one, from
        // before a re-draw, and a line over two months is drawn in parts. The
        // data is right now, so draw from the data.
        renderFreeformElements();
    }

    function setupEventListeners() {
        container.querySelectorAll('.plan-view-mode-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
                setCalendarViewMode(btn.dataset.view);
            });
        });

        const goalAddBtn = container.querySelector('.plan-week-goal-add-btn');
        const goalSaveBtn = container.querySelector('.plan-week-goal-save-btn');
        const goalCancelBtn = container.querySelector('.plan-week-goal-cancel-btn');
        const goalTextInput = container.querySelector('.plan-week-goal-text-input');
        const goalAssigneeSelect = container.querySelector('.plan-week-goal-assignee-select');

        goalAddBtn?.addEventListener('click', () => {
            const form = container.querySelector('.plan-week-goal-form');
            if (form?.classList.contains('hidden') || editingGoalId) {
                showWeekGoalForm();
            } else {
                hideWeekGoalForm();
            }
        });

        goalSaveBtn?.addEventListener('click', saveWeekGoalFromForm);

        goalCancelBtn?.addEventListener('click', hideWeekGoalForm);

        goalTextInput?.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                saveWeekGoalFromForm();
            } else if (event.key === 'Escape') {
                hideWeekGoalForm();
            }
        });

        // "Add a person…" opens a box for the name. The host adds the person to
        // its people list, and the menu then has that person picked.
        const goalPersonInput = container.querySelector('.plan-week-goal-person-input');
        goalAssigneeSelect?.addEventListener('change', () => {
            if (goalAssigneeSelect.value !== GOAL_ADD_PERSON_VALUE) {
                hideGoalPersonInput();
                return;
            }
            goalPersonInput?.classList.remove('hidden');
            goalPersonInput?.focus();
        });
        goalPersonInput?.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                void addGoalPersonFromInput();
            } else if (event.key === 'Escape') {
                event.stopPropagation();
                hideGoalPersonInput();
                if (goalAssigneeSelect) goalAssigneeSelect.value = '';
            }
        });

        // Scroll 3 months to the left / navigate previous week
        container.querySelector('.plan-prev-period-btn').addEventListener('click', () => {
            if (calendarViewMode === 'week') {
                hideWeekGoalForm();
                weekStartDate = addDays(weekStartDate, -7);
                renderCalendar();
                renderFreeformElements();
                updatePeriodDisplay();
                renderWeekGoals();
                requestAnimationFrame(() => scrollWeekViewToCurrentTime());
                return;
            }

            const scrollAmount = COLUMN_WIDTH * 3;
            calendarContainer.scrollBy({ left: -scrollAmount, behavior: 'smooth' });
        });

        // Scroll 3 months to the right / navigate next week
        container.querySelector('.plan-next-period-btn').addEventListener('click', () => {
            if (calendarViewMode === 'week') {
                hideWeekGoalForm();
                weekStartDate = addDays(weekStartDate, 7);
                renderCalendar();
                renderFreeformElements();
                updatePeriodDisplay();
                renderWeekGoals();
                requestAnimationFrame(() => scrollWeekViewToCurrentTime());
                return;
            }

            const scrollAmount = COLUMN_WIDTH * 3;
            calendarContainer.scrollBy({ left: scrollAmount, behavior: 'smooth' });
        });

        // Go to today button
        container.querySelector('.plan-today-btn')?.addEventListener('click', () => {
            const today = new Date();

            if (calendarViewMode === 'week') {
                hideWeekGoalForm();
                weekStartDate = getMondayOfWeek(today);
                renderCalendar();
                renderFreeformElements();
                updatePeriodDisplay();
                renderWeekGoals();
                requestAnimationFrame(() => scrollWeekViewToCurrentTime());
                return;
            }

            const todayMonth = today.getMonth();
            const todayYear = today.getFullYear();

            // Find today's month column
            const todayCol = container.querySelector(`.plan-month-column[data-month="${todayMonth}"][data-year="${todayYear}"]`);

            if (todayCol) {
                // Scroll to put today's column at far left (like app's opening position)
                const colLeft = todayCol.offsetLeft;
                calendarContainer.scrollTo({ left: colLeft, behavior: 'smooth' });
            } else {
                // Today's column not in DOM, re-render starting from today
                startMonth = todayMonth;
                startYear = todayYear;
                renderCalendar();
                renderFreeformElements();
                updatePeriodDisplay();
            }
        });

        // Update period display and handle infinite loading as user scrolls
        let scrollTimeout;
        let lastScrollLeft = calendarContainer.scrollLeft;

        // Not passive: the week view takes the sideways scroll for itself.
        calendarContainer.addEventListener('wheel', onWeekWheel, { passive: false });
        setupDayDoubleClick();
        setupDayMenu();
        setupWeekPress();

        calendarContainer.addEventListener('scroll', () => {
            clearTimeout(scrollTimeout);
            // Canvas scrolls with content naturally, no need to re-render lines

            scrollTimeout = setTimeout(() => {
                updatePeriodDisplay();

                if (calendarViewMode === 'week') return;

                // Only check for loading more months if horizontal scroll changed
                const currentScrollLeft = calendarContainer.scrollLeft;
                if (currentScrollLeft !== lastScrollLeft) {
                    console.log('[Plan] Horizontal scroll changed:', lastScrollLeft, '->', currentScrollLeft);
                    lastScrollLeft = currentScrollLeft;
                    checkAndLoadMoreMonths();
                }
            }, 100);
        });
    }

    // Check scroll position and load more months if near edge
    function checkAndLoadMoreMonths() {
        const grid = container.querySelector('.plan-calendar-grid');
        const scrollLeft = calendarContainer.scrollLeft;
        const scrollRight = scrollLeft + calendarContainer.clientWidth;
        const totalWidth = grid.scrollWidth;

        const LOAD_THRESHOLD = COLUMN_WIDTH * 3; // Load more when within 3 columns of edge
        const MONTHS_TO_ADD = 6;

        // Near right edge - append more months
        if (scrollRight > totalWidth - LOAD_THRESHOLD) {
            appendMonths(MONTHS_TO_ADD);
        }

        // Near left edge - prepend more months
        if (scrollLeft < LOAD_THRESHOLD) {
            prependMonths(MONTHS_TO_ADD);
        }
    }

    // Append months to the right
    function appendMonths(count) {
        const grid = container.querySelector('.plan-calendar-grid');
        const lastCol = grid.querySelector('.plan-month-column:last-child');
        if (!lastCol) return;

        let month = parseInt(lastCol.dataset.month) + 1;
        let year = parseInt(lastCol.dataset.year);

        if (month > 11) { month = 0; year++; }

        for (let i = 0; i < count; i++) {
            grid.appendChild(createMonthColumn(month, year));
            month++;
            if (month > 11) { month = 0; year++; }
        }

        // Update grid template
        const colCount = grid.querySelectorAll('.plan-month-column').length;
        grid.style.gridTemplateColumns = `repeat(${colCount}, 240px)`;
    }

    // Prepend months to the left
    function prependMonths(count) {
        const grid = container.querySelector('.plan-calendar-grid');
        const firstCol = grid.querySelector('.plan-month-column:first-child');
        if (!firstCol) return;

        let month = parseInt(firstCol.dataset.month) - 1;
        let year = parseInt(firstCol.dataset.year);

        if (month < 0) { month = 11; year--; }

        // Save current scroll position
        const oldScrollLeft = calendarContainer.scrollLeft;

        for (let i = 0; i < count; i++) {
            grid.insertBefore(createMonthColumn(month, year), grid.firstChild);
            month--;
            if (month < 0) { month = 11; year--; }
        }

        // Update grid template
        const colCount = grid.querySelectorAll('.plan-month-column').length;
        grid.style.gridTemplateColumns = `repeat(${colCount}, 240px)`;

        // Adjust scroll position to maintain visual position
        const addedWidth = COLUMN_WIDTH * count;
        calendarContainer.scrollLeft = oldScrollLeft + addedWidth;

        // Re-render freeform elements since their screen positions have changed
        // With date-relative coordinates, lines will automatically render in correct positions
        renderFreeformElements();

        // Update start tracking
        startMonth = month + 1;
        if (startMonth > 11) { startMonth = 0; startYear = year + 1; }
        else startYear = year;
    }

    // ------------------------------------------------------------------
    // The menu of a day: a right click on an empty place of a day.
    //
    // "Add task" is there when the host can make a task. "Add note" and "Draw
    // a line" do what a click and a drag do in the months view, for a reader
    // who does not know those. The week view has no rows to write on, so a
    // note or a line there is made from a small text box in the day's row
    // over the hours, and shows in that row. A right click on a thing that is
    // there already keeps the menu of the app or the browser.
    // ------------------------------------------------------------------
    let dayMenuEl = null;

    function closeDayMenu() {
        dayMenuEl?.remove();
        dayMenuEl = null;
        document.removeEventListener('pointerdown', onDayMenuOutside, true);
        document.removeEventListener('keydown', onDayMenuKey, true);
        calendarContainer?.removeEventListener('scroll', closeDayMenu);
    }

    function onDayMenuOutside(event) {
        if (dayMenuEl && !dayMenuEl.contains(event.target)) closeDayMenu();
    }

    function onDayMenuKey(event) {
        if (event.key === 'Escape') {
            event.stopPropagation();
            closeDayMenu();
        }
    }

    function openDayMenu(clientX, clientY, items) {
        closeDayMenu();
        const menu = document.createElement('div');
        menu.className = 'plan-day-menu';
        menu.setAttribute('role', 'menu');
        items.forEach((item) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'plan-day-menu-item';
            button.setAttribute('role', 'menuitem');
            button.innerHTML = item.icon;
            button.appendChild(document.createTextNode(item.label));
            button.addEventListener('click', () => {
                closeDayMenu();
                item.run();
            });
            menu.appendChild(button);
        });
        container.appendChild(menu);
        dayMenuEl = menu;
        // Inside the window: the menu opens to the left or upwards near an edge.
        const rect = rectOf(menu);
        const zoom = zoomInfo().zoom;
        menu.style.left = `${Math.max(8, Math.min(clientX, window.innerWidth / zoom - rect.width - 8))}px`;
        menu.style.top = `${Math.max(8, Math.min(clientY, window.innerHeight / zoom - rect.height - 8))}px`;
        document.addEventListener('pointerdown', onDayMenuOutside, true);
        document.addEventListener('keydown', onDayMenuKey, true);
        calendarContainer.addEventListener('scroll', closeDayMenu);
        menu.querySelector('button')?.focus();
    }

    // A small text box in the row over the hours of a day, for a note or a
    // line made in the week view. Enter keeps it, Escape or a press elsewhere drops it.
    function askInWeekRow(dateKey, placeholder, keep, initial = '') {
        const row = container.querySelector(`.plan-week-allday-row[data-date-key="${dateKey}"]`);
        if (!row) return;
        closeWeekTextBoxes();
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'plan-week-inline-input';
        input.placeholder = placeholder;
        input.value = initial;
        let done = false;
        const finish = (save) => {
            if (done) return;
            done = true;
            const text = input.value.trim();
            input._wideCaretBar?.remove();
            if (input.isConnected) input.remove();
            // With a start value, no words means "take it away", and the caller decides.
            if (save && (text || initial)) keep(text);
            else syncWeekGoalGutterSpacer();
        };
        input.addEventListener('keydown', (event) => {
            event.stopPropagation();
            if (event.key === 'Enter') finish(true);
            if (event.key === 'Escape') finish(false);
        });
        input.addEventListener('blur', () => finish(true));
        ['mousedown', 'pointerdown', 'dblclick', 'click'].forEach((type) => {
            input.addEventListener(type, (event) => event.stopPropagation());
        });
        row.appendChild(input);
        syncWeekGoalGutterSpacer();
        input.focus();
        giveWideCaret(input);
    }

    // ------------------------------------------------------------------
    // The card of a goal: its words, who it is for, and the tasks it is
    // linked to. It opens under the day's name for a new goal, and beside a
    // goal for a change. Enter, Done or a press elsewhere keeps it. Escape
    // leaves things as they were. No words and no goal before: nothing is made.
    // ------------------------------------------------------------------
    let goalEditorEl = null;
    let closeGoalEditorNow = null;

    function closeGoalEditor(save) {
        if (closeGoalEditorNow) closeGoalEditorNow(save);
    }

    function openGoalEditor({ goal, dateKey, anchorEl }) {
        closeGoalEditor(true);
        closeDayMenu();
        const da = currentLanguage === 'da';
        const draft = {
            text: goal ? goal.text : '',
            assignee: goal ? (goal.assignee || null) : (findGoalPerson(mePersonId) ? mePersonId : null),
            taskIds: goal && Array.isArray(goal.taskIds) ? [...goal.taskIds] : [],
        };
        let searchOpen = false;
        let query = '';
        let listTab = null; // the list whose tasks show, or null for every list

        const card = document.createElement('div');
        card.className = 'plan-goal-editor';
        card.setAttribute('role', 'dialog');
        card.innerHTML = `
            <input type="text" class="plan-goal-editor-text" placeholder="${da ? 'Et mål for dagen…' : 'A goal for the day…'}">
            <div class="plan-goal-editor-row">
                <button type="button" class="plan-goal-editor-person"></button>
                <button type="button" class="plan-goal-editor-link">+ ${da ? 'Tilknyt opgave' : 'Link task'}</button>
            </div>
            <div class="plan-goal-editor-people hidden"></div>
            <div class="plan-goal-editor-linked"></div>
            <div class="plan-goal-editor-search hidden">
                <input type="text" class="plan-goal-editor-query" placeholder="${da ? 'Søg i opgaver…' : 'Search tasks…'}">
                <div class="plan-goal-editor-tabs"></div>
                <div class="plan-goal-editor-results"></div>
            </div>
            <div class="plan-goal-editor-foot">
                <button type="button" class="plan-goal-editor-delete${goal ? '' : ' hidden'}">${da ? 'Slet mål' : 'Delete goal'}</button>
                <button type="button" class="plan-goal-editor-done">${da ? 'Færdig' : 'Done'}</button>
            </div>`;
        const textInput = card.querySelector('.plan-goal-editor-text');
        const personBtn = card.querySelector('.plan-goal-editor-person');
        const peopleBox = card.querySelector('.plan-goal-editor-people');
        const linkedBox = card.querySelector('.plan-goal-editor-linked');
        const searchBox = card.querySelector('.plan-goal-editor-search');
        const queryInput = card.querySelector('.plan-goal-editor-query');
        const tabsBox = card.querySelector('.plan-goal-editor-tabs');
        const resultsBox = card.querySelector('.plan-goal-editor-results');
        textInput.value = draft.text;

        const drawPerson = () => {
            personBtn.innerHTML = '';
            const person = findGoalPerson(draft.assignee);
            if (person) {
                personBtn.appendChild(goalPersonDot(person));
                personBtn.appendChild(document.createTextNode(shortGoalPersonName(person)));
            } else {
                personBtn.textContent = da ? 'Tildel' : 'Assign';
            }
            personBtn.classList.toggle('is-set', Boolean(person));
        };

        const drawPeople = () => {
            peopleBox.innerHTML = '';
            const option = (label, id, dot) => {
                const b = document.createElement('button');
                b.type = 'button';
                b.className = 'plan-goal-editor-option' + ((draft.assignee || null) === id ? ' is-on' : '');
                if (dot) b.appendChild(dot);
                b.appendChild(document.createTextNode(label));
                b.addEventListener('click', () => {
                    draft.assignee = id;
                    peopleBox.classList.add('hidden');
                    drawPerson();
                });
                peopleBox.appendChild(b);
            };
            goalPeople.forEach((person) => option(person.name, person.id, goalPersonDot(person)));
            option(da ? 'Ingen' : 'No one', null, null);
            if (addGoalPerson) {
                const add = document.createElement('input');
                add.type = 'text';
                add.className = 'plan-goal-editor-add-person';
                add.placeholder = da ? 'Ny person…' : 'New person…';
                add.addEventListener('keydown', async (event) => {
                    event.stopPropagation();
                    if (event.key === 'Escape') { peopleBox.classList.add('hidden'); return; }
                    if (event.key !== 'Enter' || !add.value.trim()) return;
                    add.disabled = true;
                    const person = await Promise.resolve(addGoalPerson(add.value.trim())).catch(() => null);
                    if (person && person.id) {
                        if (!goalPeople.some((p) => p.id === String(person.id))) {
                            goalPeople.push(toGoalPerson(person));
                        }
                        draft.assignee = String(person.id);
                    }
                    peopleBox.classList.add('hidden');
                    drawPerson();
                });
                peopleBox.appendChild(add);
            }
        };

        const drawLinked = () => {
            linkedBox.innerHTML = '';
            draft.taskIds.forEach((id) => {
                const task = linkableTasks.find((t) => t.id === id);
                if (!task) return;
                const row = document.createElement('div');
                row.className = 'plan-goal-editor-linked-task' + (task.completed ? ' is-done' : '');
                const name = document.createElement('span');
                name.textContent = task.name;
                name.title = task.listName ? `${task.listName}: ${task.name}` : task.name;
                const off = document.createElement('button');
                off.type = 'button';
                off.textContent = '×';
                off.title = da ? 'Fjern tilknytning' : 'Take the link away';
                off.addEventListener('click', () => {
                    draft.taskIds = draft.taskIds.filter((other) => other !== id);
                    drawLinked();
                    drawResults();
                });
                row.appendChild(name);
                row.appendChild(off);
                linkedBox.appendChild(row);
            });
        };

        // The search of the focus window: with no words, one list at a time from
        // a row of tabs that say how many open tasks each list has. With words,
        // the hits of every list, under the name of their list, and the tabs say
        // how many hits each list has.
        const drawResults = () => {
            const words = query.trim().toLowerCase();
            const open = linkableTasks.filter((t) => !t.completed);
            const hits = words ? open.filter((t) => t.name.toLowerCase().includes(words)) : open;
            const noList = da ? 'Ingen liste' : 'No list';
            const byList = new Map();
            hits.forEach((t) => {
                const key = t.listName || noList;
                if (!byList.has(key)) byList.set(key, []);
                byList.get(key).push(t);
            });
            const names = [...byList.keys()];
            if (listTab && !byList.has(listTab)) listTab = null;
            if (!words && !listTab) listTab = names[0] || null;

            tabsBox.innerHTML = '';
            names.forEach((name) => {
                const tab = document.createElement('button');
                tab.type = 'button';
                tab.className = 'plan-goal-editor-tab' + (listTab === name ? ' is-on' : '');
                tab.textContent = `${name} ${byList.get(name).length}`;
                tab.addEventListener('click', () => {
                    listTab = listTab === name && words ? null : name;
                    drawResults();
                });
                tabsBox.appendChild(tab);
            });

            resultsBox.innerHTML = '';
            const shown = listTab ? [listTab] : names;
            if (shown.length === 0) {
                const none = document.createElement('div');
                none.className = 'plan-goal-editor-none';
                none.textContent = linkableTasks.length === 0
                    ? (da ? 'Ingen opgaver at tilknytte her.' : 'No tasks to link here.')
                    : (da ? 'Ingen opgaver fundet.' : 'No tasks found.');
                resultsBox.appendChild(none);
            }
            shown.forEach((name) => {
                if (!listTab) {
                    const head = document.createElement('div');
                    head.className = 'plan-goal-editor-group';
                    head.textContent = name;
                    resultsBox.appendChild(head);
                }
                byList.get(name).slice(0, 40).forEach((task) => {
                    const linked = draft.taskIds.includes(task.id);
                    const row = document.createElement('button');
                    row.type = 'button';
                    row.className = 'plan-goal-editor-result' + (linked ? ' is-on' : '');
                    row.textContent = task.name;
                    row.addEventListener('click', () => {
                        draft.taskIds = linked ? draft.taskIds.filter((id) => id !== task.id) : [...draft.taskIds, task.id];
                        drawLinked();
                        drawResults();
                    });
                    resultsBox.appendChild(row);
                });
            });
        };

        const finish = (save) => {
            if (!goalEditorEl) return;
            document.removeEventListener('pointerdown', onOutside, true);
            calendarContainer.removeEventListener('scroll', onScroll);
            card.remove();
            if (pickGoalPerson) pickGoalPerson(null);
            container.querySelector('.plan-calendar-grid')?.classList.remove('has-goal-card');
            goalEditorEl = null;
            closeGoalEditorNow = null;
            editingGoalId = null;
            const text = textInput.value.trim();
            if (save && text) {
                if (goal) {
                    goal.text = text;
                    goal.assignee = draft.assignee;
                    goal.taskIds = draft.taskIds;
                } else {
                    const made = { id: createGoalId(), text, assignee: draft.assignee, dateKey, taskIds: draft.taskIds };
                    goalsOfWeek(weekKeyForDate(parseDateKey(dateKey))).push(made);
                }
                saveWeekGoals();
            }
            renderWeekGoals();
        };
        // The host's people menu is not in the card, but a press in it is a
        // press for the card.
        const inHostPeople = (target) =>
            target instanceof Element && Boolean(target.closest('.assign-menu-portal-root'));
        const onOutside = (event) => { if (!card.contains(event.target) && !inHostPeople(event.target)) finish(true); };
        const onScroll = () => finish(true);

        personBtn.addEventListener('click', () => {
            if (pickGoalPerson) {
                const person = findGoalPerson(draft.assignee);
                pickGoalPerson({
                    anchorEl: personBtn,
                    assigneeId: person ? person.id : null,
                    onPick: (id) => {
                        draft.assignee = id || null;
                        drawPerson();
                    },
                    // "Edit people…" opens the host's people list over the
                    // page. The card keeps what it has and goes.
                    onLeave: () => finish(true),
                });
                return;
            }
            const show = peopleBox.classList.contains('hidden');
            if (show) drawPeople();
            peopleBox.classList.toggle('hidden', !show);
        });
        card.querySelector('.plan-goal-editor-link').addEventListener('click', () => {
            searchOpen = !searchOpen;
            searchBox.classList.toggle('hidden', !searchOpen);
            if (searchOpen) { drawResults(); queryInput.focus(); }
        });
        queryInput.addEventListener('input', () => {
            // The first letter looks in every list. With no words again, one list at a time.
            if (Boolean(query.trim()) !== Boolean(queryInput.value.trim())) listTab = null;
            query = queryInput.value;
            drawResults();
        });
        queryInput.addEventListener('keydown', (event) => {
            event.stopPropagation();
            if (event.key === 'Escape') { searchOpen = false; searchBox.classList.add('hidden'); textInput.focus(); }
        });
        textInput.addEventListener('keydown', (event) => {
            event.stopPropagation();
            if (event.key === 'Enter') finish(true);
            if (event.key === 'Escape') finish(false);
        });
        card.querySelector('.plan-goal-editor-done').addEventListener('click', () => finish(true));
        card.querySelector('.plan-goal-editor-delete').addEventListener('click', () => {
            const id = goal && goal.id;
            finish(false);
            if (id) removeWeekGoal(id);
        });
        card.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') { event.stopPropagation(); finish(false); }
        });
        ['mousedown', 'dblclick', 'click', 'contextmenu'].forEach((type) => {
            card.addEventListener(type, (event) => event.stopPropagation());
        });

        container.appendChild(card);
        // While the card is up, the row under the days' names stays open.
        container.querySelector('.plan-calendar-grid')?.classList.add('has-goal-card');
        goalEditorEl = card;
        closeGoalEditorNow = finish;
        if (goal) editingGoalId = goal.id;
        drawPerson();
        drawLinked();

        // Under the day's name, as wide as the day but not narrower than the
        // card needs, and inside the window.
        const zoom = zoomInfo().zoom;
        const at = rectOf(anchorEl);
        const width = Math.max(at.width, 280);
        card.style.width = `${width}px`;
        card.style.left = `${Math.max(8, Math.min(at.left, window.innerWidth / zoom - width - 8))}px`;
        card.style.top = `${Math.min(at.top, window.innerHeight / zoom - 160)}px`;

        // After this press is over, so the press that opened the card does not close it.
        setTimeout(() => {
            document.addEventListener('pointerdown', onOutside, true);
            calendarContainer.addEventListener('scroll', onScroll);
        }, 0);
        textInput.focus();
        textInput.select();
    }

    function closeWeekTextBoxes() {
        container.querySelectorAll('.plan-week-inline-input').forEach((input) => input.blur());
        container.querySelectorAll('.plan-week-inline-input, .plan-week-block--writing').forEach((el) => el.remove());
    }

    // A text box in the hours of a day, in the shape of the block it will be.
    function askInWeekGrid(dateKey, startMinutes, endMinutes, placeholder, keep, initial = '', besideLine = false) {
        const grid = container.querySelector(`.plan-week-time-grid[data-date-key="${dateKey}"]`);
        if (!grid) return;
        closeWeekTextBoxes();
        const box = document.createElement('div');
        box.className = 'plan-week-block plan-week-block--writing' + (besideLine ? ' plan-week-block--beside-line' : '');
        box.style.top = `${weekMinutesToTop(startMinutes)}px`;
        box.style.height = `${Math.max(weekMinutesToTop(endMinutes) - weekMinutesToTop(startMinutes), 26)}px`;
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'plan-week-inline-input';
        input.placeholder = placeholder;
        input.value = initial;
        box.appendChild(input);
        let done = false;
        const finish = (save) => {
            if (done) return;
            done = true;
            const text = input.value.trim();
            input._wideCaretBar?.remove();
            if (box.isConnected) box.remove();
            if (save && (text || initial)) keep(text);
        };
        input.addEventListener('keydown', (event) => {
            event.stopPropagation();
            if (event.key === 'Enter') finish(true);
            if (event.key === 'Escape') finish(false);
        });
        input.addEventListener('blur', () => finish(true));
        // A press in the box is for the box. A double click goes on to the day,
        // which takes an empty box away and asks for a task.
        ['mousedown', 'pointerdown', 'click'].forEach((type) => {
            box.addEventListener(type, (event) => {
                event.stopPropagation();
                // A press on the box beside the words must not take the caret
                // away: the box would go under the pointer, and the second
                // click of a double click would find nothing to land on.
                if (type === 'mousedown' && event.target !== input) event.preventDefault();
            });
        });
        grid.appendChild(box);
        input.focus();
        giveWideCaret(input);
    }

    function addWeekNote(dateKey, text, startMinutes, endMinutes) {
        pushHistory();
        const note = { id: Date.now().toString(), text, dateKey, offsetX: 0, group: activeGroup };
        if (Number.isFinite(startMinutes)) {
            note.startMinutes = startMinutes;
            note.endMinutes = endMinutes;
            note.isAllDay = false;
        }
        freeformNotes.push(note);
        saveData();
        renderFreeformElements();
    }

    function addWeekLine(startDate, endDate, label) {
        pushHistory();
        freeformLines.push({
            id: Date.now().toString(),
            label,
            startDate: startDate <= endDate ? startDate : endDate,
            startOffsetX: 40,
            endDate: startDate <= endDate ? endDate : startDate,
            endOffsetX: 200,
            color: null,
            width: 8,
            group: activeGroup,
        });
        saveData();
        renderFreeformElements();
    }

    // A line down the hours of one day, from a drag in the week view. It has
    // one day and its hours. The Months view shows it as a short line on that day.
    function addWeekTimedLine(dateKey, startMinutes, endMinutes) {
        pushHistory();
        const line = {
            id: Date.now().toString(),
            label: '',
            startDate: dateKey,
            startOffsetX: 40,
            endDate: dateKey,
            endOffsetX: 200,
            startMinutes,
            endMinutes,
            color: null,
            width: 8,
            group: activeGroup,
        };
        freeformLines.push(line);
        saveData();
        renderFreeformElements();
        return line;
    }

    // The week view takes a press as the months view does: a click gives a
    // caret to write a note, a drag draws a line. In the hours a drag goes down
    // the day, and the line goes from its start to its end. In the rows over the
    // hours a drag goes across the days. With a text box open or a thing
    // selected, a press only puts that away.
    function setupWeekPress() {
        calendarContainer.addEventListener('mousedown', (event) => {
            if (calendarViewMode !== 'week' || event.button !== 0 || isWeekGoalDragInProgress) return;
            const target = event.target;
            if (!target || !target.closest) return;
            if (target.closest(
                '.plan-week-block, .plan-week-allday-item, .plan-week-goal-pill, .plan-week-event, ' +
                '.plan-week-goals, .plan-week-day-goals, .plan-week-day-header, button, input'
            )) return;
            const col = target.closest('.plan-week-day-column');
            if (!col) return;
            const wasWriting = Boolean(container.querySelector('.plan-week-inline-input, .plan-week-note-text[contenteditable="true"]'));
            if (selectedElements.length > 0) {
                // As in the Months view: a press elsewhere takes the mark and the menu away.
                deselectElement();
                return;
            }
            const startDay = col.dataset.dateKey;
            const startTime = findWeekTimeDropTarget(pointerX(event), pointerY(event));
            const startX = pointerX(event);
            const startY = pointerY(event);
            let drawing = false;
            let endMinutes = startTime ? startTime.minutes : null;
            let endDay = startDay;
            let lineGhost = null;

            const markDays = (on) => {
                container.querySelectorAll('.plan-week-allday-row').forEach((row) => {
                    const key = row.dataset.dateKey;
                    const from = startDay <= endDay ? startDay : endDay;
                    const to = startDay <= endDay ? endDay : startDay;
                    row.classList.toggle('plan-week-allday-row--drawing', Boolean(on) && key >= from && key <= to);
                });
            };

            const onMove = (moveEvent) => {
                const dx = pointerX(moveEvent) - startX;
                const dy = pointerY(moveEvent) - startY;
                if (!drawing && Math.hypot(dx, dy) < 6) return;
                drawing = true;
                moveEvent.preventDefault();
                if (startTime) {
                    const range = weekGridRange();
                    const rect = rectOf(startTime.grid);
                    const at = snapWeekMinutes(range.start + ((pointerY(moveEvent) - rect.top) / WEEK_VIEW_HOUR_HEIGHT) * 60);
                    endMinutes = Math.min(Math.max(at, range.start), range.end);
                    const from = Math.min(startTime.minutes, endMinutes);
                    const to = Math.max(Math.max(startTime.minutes, endMinutes), from + WEEK_BLOCK_SHORTEST_MINUTES);
                    if (!lineGhost) {
                        lineGhost = document.createElement('div');
                        lineGhost.className = 'plan-week-line plan-week-line--drawing';
                        const bar = document.createElement('div');
                        bar.className = 'plan-week-line-bar vertical';
                        bar.style.width = '8px';
                        const hours = document.createElement('span');
                        hours.className = 'plan-week-line-hours';
                        lineGhost.appendChild(bar);
                        lineGhost.appendChild(hours);
                        startTime.grid.appendChild(lineGhost);
                    }
                    lineGhost.style.top = `${weekMinutesToTop(from)}px`;
                    lineGhost.style.height = `${weekMinutesToTop(to) - weekMinutesToTop(from)}px`;
                    lineGhost.querySelector('.plan-week-line-hours').textContent = formatWeekBlockHours(from, to);
                } else {
                    const under = findWeekDayRowTarget(pointerX(moveEvent), pointerY(moveEvent))
                        || findWeekTimeDropTarget(pointerX(moveEvent), pointerY(moveEvent));
                    if (under && under.dateKey) endDay = under.dateKey;
                    markDays(true);
                }
            };

            const onUp = () => {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
                lineGhost?.remove();
                markDays(false);
                if (wasWriting) return; // the press put a text box away, and that is all
                if (startTime && drawing) {
                    // A drag: a line from its start to its end. Then a caret for its name,
                    // which can stay empty.
                    const from = Math.min(startTime.minutes, endMinutes);
                    const to = Math.min(
                        Math.max(Math.max(startTime.minutes, endMinutes), from + WEEK_BLOCK_SHORTEST_MINUTES),
                        weekGridRange().end
                    );
                    const line = addWeekTimedLine(startDay, from, to);
                    askInWeekGrid(startDay, from, to, 'Name of the line…', (text) => {
                        if (!text) return;
                        line.label = text;
                        saveData();
                        renderFreeformElements();
                    }, '', true);
                } else if (startTime) {
                    // A click: a caret at that time, as a click gives one in the Months view.
                    const from = startTime.minutes;
                    const to = Math.min(from + WEEK_NOTE_DEFAULT_MINUTES, weekGridRange().end);
                    askInWeekGrid(startDay, from, to, '', (text) => addWeekNote(startDay, text, from, to));
                } else if (drawing && endDay !== startDay) {
                    const first = startDay <= endDay ? startDay : endDay;
                    askInWeekRow(first, 'Name of the line…', (text) => addWeekLine(startDay, endDay, text));
                } else {
                    askInWeekRow(startDay, '', (text) => addWeekNote(startDay, text));
                }
            };

            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });
    }

    function setupDayMenu() {
        const da = () => currentLanguage === 'da';
        const icon = (paths) => `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
        const ICON_TASK = icon('<circle cx="12" cy="12" r="9"/><path d="m8.5 12.5 2.5 2.5 4.5-5"/>');
        const ICON_NOTE = icon('<path d="M12 20h9"/><path d="M16.4 3.6a2 2 0 0 1 2.8 2.8L7.5 18.1 4 19l.9-3.5Z"/>');
        const ICON_LINE = icon('<path d="M4 12h16"/><path d="M4 9v6"/><path d="M20 9v6"/>');

        calendarContainer.addEventListener('contextmenu', (event) => {
            const target = event.target;
            if (!target || !target.closest) return;
            if (target.closest(
                '.plan-note-text, .plan-note-line, .plan-line-label, .plan-line-handle, .plan-day-more, ' +
                '.plan-week-block, .plan-week-allday-item, .plan-week-goal-pill, .plan-week-event, ' +
                'button, input, textarea, [contenteditable="true"]'
            )) return;

            const items = [];
            if (calendarViewMode === 'week') {
                const col = target.closest('.plan-week-day-column');
                if (!col) return;
                const dateKey = col.dataset.dateKey;
                const time = findWeekTimeDropTarget(pointerX(event), pointerY(event));
                const colRect = rectOf(col);
                const top = time
                    ? rectOf(time.grid).top + weekMinutesToTop(time.minutes)
                    : pointerY(event) - 10;
                if (createTask) {
                    items.push({
                        label: da() ? 'Tilføj opgave' : 'Add task',
                        icon: ICON_TASK,
                        run: () => createTask({
                            dateKey,
                            startMinutes: time ? time.minutes : null,
                            anchor: { left: toScreen(colRect.left), right: toScreen(colRect.right), top: toScreen(top), bottom: toScreen(top + 22) },
                        }),
                    });
                }
                items.push({
                    label: da() ? 'Tilføj note' : 'Add note',
                    icon: ICON_NOTE,
                    run: () => {
                        // At the time of the click when it was in the hours, else in the day's row.
                        if (time) {
                            const to = Math.min(time.minutes + WEEK_NOTE_DEFAULT_MINUTES, weekGridRange().end);
                            askInWeekGrid(dateKey, time.minutes, to, 'Note…', (text) => addWeekNote(dateKey, text, time.minutes, to));
                        } else {
                            askInWeekRow(dateKey, 'Note…', (text) => addWeekNote(dateKey, text));
                        }
                    },
                });
                items.push({
                    label: da() ? 'Tegn en linje' : 'Draw a line',
                    icon: ICON_LINE,
                    run: () => askInWeekRow(dateKey, da() ? 'Linjens navn…' : 'Name of the line…', (text) => addWeekLine(dateKey, dateKey, text)),
                });
            } else {
                const under = document.elementsFromPoint(event.clientX, event.clientY);
                const row = under.map((el) => el.closest && el.closest('.plan-day-row')).find(Boolean);
                if (!row || !row.dataset.dateKey) return;
                const dateKey = row.dataset.dateKey;
                const canvasRect = rectOf(canvasLayer);
                const at = { x: pointerX(event) - canvasRect.left, y: pointerY(event) - canvasRect.top };
                if (createTask) {
                    const area = rectOf(row.querySelector('.plan-note-area') || row);
                    items.push({
                        label: da() ? 'Tilføj opgave' : 'Add task',
                        icon: ICON_TASK,
                        run: () => createTask({
                            dateKey,
                            startMinutes: null,
                            anchor: { left: toScreen(area.left), right: toScreen(area.right), top: toScreen(area.top), bottom: toScreen(area.bottom) },
                        }),
                    });
                }
                items.push({
                    label: da() ? 'Tilføj note' : 'Add note',
                    icon: ICON_NOTE,
                    run: () => {
                        const snapped = findClosestDateRowPosition(at.x, at.y);
                        createFreeformInput(snapped.x, snapped.y, snapped.dateKey, snapped.offsetX);
                    },
                });
                items.push({
                    label: da() ? 'Tegn en linje' : 'Draw a line',
                    icon: ICON_LINE,
                    run: () => {
                        // A line on this day, of a length that is easy to take hold
                        // of. It is selected, so its ends, its colour and its name
                        // are there to change, as after a drag.
                        const snapped = findClosestDateRowPosition(at.x, at.y);
                        pushHistory();
                        const line = {
                            id: Date.now().toString(),
                            startDate: snapped.dateKey || dateKey,
                            startOffsetX: snapped.offsetX || 0,
                            endDate: snapped.dateKey || dateKey,
                            endOffsetX: (snapped.offsetX || 0) + 110,
                            color: null,
                            width: 8,
                            group: activeGroup,
                        };
                        freeformLines.push(line);
                        saveData();
                        renderFreeformElements();
                        // After this click is over: a click on the page takes a
                        // selection away, and the click on the menu is still going.
                        setTimeout(() => {
                            const lineEl = canvasLayer.querySelector(`.plan-note-line-container[data-line-id="${line.id}"]`);
                            if (lineEl) showLineEditor(line.id, lineEl);
                        }, 0);
                    },
                });
            }
            if (!items.length) return;
            event.preventDefault();
            openDayMenu(pointerX(event), pointerY(event), items);
        });
    }

    // A double click on a day asks the host for a new task on that day.
    //
    // Months view: a click on a day starts a note, so the first click of a
    // double click has put a note box there. An empty box is taken away, and
    // the task box of the host comes in its place. Week view: a double click
    // in the hours also gives the time, and one in the rows over the hours
    // gives the day alone. A double click on a thing that is there already (a
    // note, a highlight, a task, a goal, an event) is that thing's own.
    function setupDayDoubleClick() {
        calendarContainer.addEventListener('dblclick', (event) => {
            if (!createTask) return;
            const target = event.target;
            if (!target || !target.closest) return;
            if (target.closest(
                '.plan-note-text, .plan-note-line, .plan-line-label, .plan-line-handle, .plan-day-more, ' +
                '.plan-week-block:not(.plan-week-block--writing), .plan-week-allday-item, .plan-week-goal-pill, .plan-week-event, button'
            )) return;

            if (calendarViewMode === 'week') {
                const col = target.closest('.plan-week-day-column');
                if (!col) return;
                const writing = container.querySelector('.plan-week-inline-input');
                if (writing) {
                    if (writing.value.trim()) return; // the reader is writing a note
                    closeWeekTextBoxes();
                }
                const time = findWeekTimeDropTarget(pointerX(event), pointerY(event));
                const colRect = rectOf(col);
                const top = time
                    ? rectOf(time.grid).top + weekMinutesToTop(time.minutes)
                    : pointerY(event) - 10;
                event.preventDefault();
                createTask({
                    dateKey: col.dataset.dateKey,
                    startMinutes: time ? time.minutes : null,
                    anchor: { left: toScreen(colRect.left), right: toScreen(colRect.right), top: toScreen(top), bottom: toScreen(top + 22) },
                });
                return;
            }

            const under = document.elementsFromPoint(event.clientX, event.clientY);
            const row = under.map((el) => el.closest && el.closest('.plan-day-row')).find(Boolean);
            if (!row || !row.dataset.dateKey) return;
            const noteBox = canvasLayer.querySelector('.plan-note-input-inline');
            if (noteBox) {
                if (noteBox.value.trim()) return; // the reader is writing a note
                // The box takes itself away when it loses the caret, and an
                // empty box saves nothing. Taking it away here too made an error.
                noteBox.blur();
                if (noteBox.isConnected) {
                    try { noteBox.remove(); } catch { /* it went by itself */ }
                }
            }
            const area = rectOf(row.querySelector('.plan-note-area') || row);
            event.preventDefault();
            createTask({
                dateKey: row.dataset.dateKey,
                startMinutes: null,
                anchor: { left: toScreen(area.left), right: toScreen(area.right), top: toScreen(area.top), bottom: toScreen(area.bottom) },
            });
        });
    }

    function setupCanvasInteraction() {
        calendarContainer.addEventListener('mousedown', e => {
            if (
                e.target.closest('.plan-note-text') ||
                e.target.closest('.plan-note-line') ||
                e.target.closest('.plan-line-handle') ||
                e.target.closest('.plan-line-label') ||
                e.target.closest('.plan-week-goal-pill') ||
                // A press in the box of a new note is for the box. Without this,
                // the second click of a double click made a second box, took the
                // first away under the pointer, and no double click came.
                e.target.closest('.plan-note-input-inline') ||
                e.target.closest('.plan-week-block') ||
                e.target.closest('.plan-week-allday-item') ||
                e.target.closest('.plan-week-goals') ||
                e.target.closest('.plan-week-day-goals') ||
                e.target.closest('.plan-week-day-header')
            ) {
                return;
            }

            if (isWeekGoalDragInProgress) return;

            // If something is selected, deselect it and don't create new content
            if (selectedElements.length > 0) {
                deselectElement();
                return;
            }

            // The week view shows the days by the hour, and it has no day rows
            // to pin a note or a highlight to. A drag there made a grey bar that
            // went away on release, and could save a line with no dates. Notes
            // and highlights are made in the months view.
            if (calendarViewMode === 'week') return;

            // A note is being written. This press ends it (the box keeps its
            // words when it loses the caret), and that is all the press does:
            // it must not start a second note where it landed.
            const wasWritingNote = Boolean(canvasLayer.querySelector('.plan-note-input-inline'));

            // Get fresh rect at mousedown time
            const getRect = () => rectOf(canvasLayer);
            const initialRect = getRect();
            // canvasLayer scrolls with content, so its getBoundingClientRect() already 
            // accounts for scroll position. No need to add scrollTop/scrollLeft.
            const startX = pointerX(e) - initialRect.left;
            const startY = pointerY(e) - initialRect.top;
            let isDragging = false;

            const tempLine = document.createElement('div');
            tempLine.className = 'plan-note-line temp';
            tempLine.style.left = startX + 'px';
            tempLine.style.top = startY + 'px';
            tempLine.style.width = '0';
            canvasLayer.appendChild(tempLine);

            const move = ev => {
                // Get fresh rect in case window was resized
                const rect = getRect();
                // No scroll offset needed - rect already reflects scroll
                const x = pointerX(ev) - rect.left;
                const y = pointerY(ev) - rect.top;
                const dx = x - startX, dy = y - startY;
                const len = Math.sqrt(dx * dx + dy * dy);
                if (len > 5) {
                    isDragging = true;
                    tempLine.style.width = len + 'px';
                    tempLine.style.transform = `rotate(${Math.atan2(dy, dx) * 180 / Math.PI}deg)`;
                    tempLine.style.transformOrigin = '0 50%';
                }
            };

            const up = ev => {
                document.removeEventListener('mousemove', move);
                document.removeEventListener('mouseup', up);
                tempLine.remove();

                // Get fresh rect for final coordinates
                const rect = getRect();
                // No scroll offset needed - rect already reflects scroll
                const endX = pointerX(ev) - rect.left;
                const endY = pointerY(ev) - rect.top;

                if (isDragging && Math.sqrt((endX - startX) ** 2 + (endY - startY) ** 2) > 10) {
                    pushHistory();

                    // Convert pixel coords to date-relative coords for stable storage
                    const startCoords = screenToDateCoords(startX, startY);
                    const endCoords = screenToDateCoords(endX, endY);

                    const line = {
                        id: Date.now().toString(),
                        // New date-relative format
                        startDate: startCoords.dateKey,
                        startOffsetX: startCoords.offsetX,
                        endDate: endCoords.dateKey,
                        endOffsetX: endCoords.offsetX,
                        color: null, // Let CSS control color for dark/light mode support
                        width: 8,
                        group: activeGroup
                    };

                    console.log('[Plan] New line created with date coords:', line);
                    freeformLines.push(line);
                    saveData();
                    canvasLayer.appendChild(createLine(line));
                } else if (wasWritingNote) {
                    // The press only put the note box away.
                } else {
                    // Show input for new note
                    const snapped = findClosestDateRowPosition(startX, startY);
                    createFreeformInput(snapped.x, snapped.y, snapped.dateKey, snapped.offsetX);
                }
            };

            document.addEventListener('mousemove', move);
            document.addEventListener('mouseup', up);
        });
    }

    function setupToolbarListeners() {
        // Undo/Redo
        container.querySelector('.plan-undo-btn').addEventListener('click', () => {
            if (undoStack.length === 0) return;
            redoStack.push({ notes: JSON.parse(JSON.stringify(freeformNotes)), lines: JSON.parse(JSON.stringify(freeformLines)) });
            const prev = undoStack.pop();
            freeformNotes = prev.notes; freeformLines = prev.lines;
            saveData(); renderFreeformElements(); updateUndoRedoButtons();
        });

        container.querySelector('.plan-redo-btn').addEventListener('click', () => {
            if (redoStack.length === 0) return;
            undoStack.push({ notes: JSON.parse(JSON.stringify(freeformNotes)), lines: JSON.parse(JSON.stringify(freeformLines)) });
            const next = redoStack.pop();
            freeformNotes = next.notes; freeformLines = next.lines;
            saveData(); renderFreeformElements(); updateUndoRedoButtons();
        });

        // Calendar sync buttons
        const calendarSyncAllBtn = container.querySelector('.plan-calendar-sync-all-btn');
        const calendarAddBtn = container.querySelector('.plan-calendar-add-btn');
        const calendarPopover = container.querySelector('.plan-calendar-popover');
        const calendarList = container.querySelector('.plan-calendar-list');
        const calendarNameInput = container.querySelector('.plan-calendar-name-input');
        const calendarUrlInput = container.querySelector('.plan-calendar-url-input');
        const calendarAddSaveBtn = container.querySelector('.plan-calendar-add-save-btn');
        const calendarStatus = container.querySelector('.plan-calendar-status');

        // Render calendar list in popover
        function renderCalendarList() {
            if (!calendarList) return;
            if (calendars.length === 0) {
                calendarList.innerHTML = '<div class="plan-calendar-empty">No calendars added yet</div>';
                return;
            }
            calendarList.innerHTML = calendars.map(cal => `
                <div class="plan-calendar-item" data-id="${cal.id}">
                    <div class="plan-calendar-item-info">
                        <span class="plan-calendar-item-name">${cal.name || 'Unnamed'}</span>
                        <span class="plan-calendar-item-url">${cal.url.substring(0, 40)}...</span>
                    </div>
                    <button class="plan-calendar-item-delete" data-id="${cal.id}" title="Remove calendar">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
                    </button>
                </div>
            `).join('');

            // Add delete handlers
            calendarList.querySelectorAll('.plan-calendar-item-delete').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const id = btn.dataset.id;
                    calendars = calendars.filter(c => c.id !== id);
                    localStorage.setItem(CALENDARS_KEY, JSON.stringify(calendars));
                    renderCalendarList();
                    syncAllCalendars(); // Re-sync to update events
                });
            });
        }

        // Sync all calendars. One at a time: a sync asked for while one runs
        // shares its result.
        function syncAllCalendars() {
            if (calendarSyncInFlight) return calendarSyncInFlight;
            lastCalendarSyncStartedAt = Date.now();
            calendarSyncInFlight = runCalendarSync().finally(() => {
                calendarSyncInFlight = null;
            });
            return calendarSyncInFlight;
        }
        syncCalendarsNow = syncAllCalendars;

        async function runCalendarSync() {
            // Start spinning animation
            if (calendarSyncAllBtn) calendarSyncAllBtn.classList.add('syncing');
            if (calendarStatus) calendarStatus.textContent = 'Syncing...';

            try {
                // The events stay on screen while the new ones are fetched; the
                // reader's changes to them are put back on the new copies.
                const previousNotes = calendarEventsCache.notes;
                const previousLines = calendarEventsCache.lines;
                const fetchedNotes = [];
                const fetchedLines = [];

                if (calendars.length === 0) {
                    calendarLastSync = null;
                    localStorage.removeItem(CALENDAR_LAST_SYNC_KEY);
                    showCalendarItems([], []);
                    updateCalendarStatus();
                    renderCalendarToggles();
                    return;
                }

                const CalendarSync = window.CalendarSync;
                if (!CalendarSync) throw new Error('CalendarSync module not loaded');

                for (const cal of calendars) {
                    try {
                        const result = await CalendarSync.syncCalendar(cal.url);

                        // Add calendar styling and source markers to notes
                        result.notes.forEach(n => {
                            n.source = 'calendar';
                            n.calendarId = cal.id;
                            n.calendarName = cal.name;
                            n.fontFamily = cal.fontFamily || 'Inter';
                            n.fontColor = cal.fontColor || '#4a90e2';
                        });

                        // Add calendar styling and source markers to lines
                        result.lines.forEach(l => {
                            l.source = 'calendar';
                            l.calendarId = cal.id;
                            l.calendarName = cal.name;
                            l.color = cal.lineColor || '#4a90e2';
                            l.fontFamily = cal.fontFamily || 'Inter';
                            l.fontColor = cal.fontColor || '#4a90e2';
                        });

                        fetchedNotes.push(...result.notes);
                        fetchedLines.push(...result.lines);
                    } catch (err) {
                        // A calendar that could not be read keeps what it showed
                        // before, rather than going blank until the next sync.
                        console.warn(`[Plan] Failed to sync calendar "${cal.name}":`, err);
                        fetchedNotes.push(...previousNotes.filter(n => n.calendarId === cal.id));
                        fetchedLines.push(...previousLines.filter(l => l.calendarId === cal.id));
                    }
                }

                calendarLastSync = new Date().toISOString();
                localStorage.setItem(CALENDAR_LAST_SYNC_KEY, calendarLastSync);

                // On screen and kept on this device; never saved into the shared notes.
                if (!isInitialized) return;
                showCalendarItems(fetchedNotes, fetchedLines);
                updateCalendarStatus();
                renderCalendarToggles();

                console.log('[Plan] All calendars synced and merged:', {
                    calendars: calendars.length,
                    totalNotes: freeformNotes.length,
                    totalLines: freeformLines.length
                });
            } catch (error) {
                console.error('[Plan] Calendar sync error:', error);
                if (calendarStatus) calendarStatus.textContent = 'Sync failed: ' + error.message;
            } finally {
                // Stop spinning animation
                if (calendarSyncAllBtn) calendarSyncAllBtn.classList.remove('syncing');
            }
        }

        // Sync All button
        if (calendarSyncAllBtn) {
            calendarSyncAllBtn.addEventListener('click', () => {
                syncAllCalendars();
            });
        }

        // Add Calendar button - opens popover
        if (calendarAddBtn && calendarPopover) {
            calendarAddBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                calendarPopover.classList.toggle('hidden');
                const btnRect = rectOf(calendarAddBtn);
                const containerRect = rectOf(container);
                calendarPopover.style.top = (btnRect.bottom - containerRect.top + 5) + 'px';
                calendarPopover.style.right = (containerRect.right - btnRect.right) + 'px';
                renderCalendarList();
                updateCalendarStatus();
                renderCalendarToggles();
            });

            // Help icon - toggle help content
            const helpIcon = calendarPopover.querySelector('.plan-calendar-help-icon');
            const helpContent = calendarPopover.querySelector('.plan-calendar-help-content');
            if (helpIcon && helpContent) {
                const toggleHelp = (e) => {
                    e.stopPropagation();
                    helpContent.classList.toggle('hidden');
                    helpIcon.classList.toggle('active');
                };
                helpIcon.addEventListener('click', toggleHelp);
                // The same help, from words under the address box: a "?" is easy to miss.
                const helpLink = calendarPopover.querySelector('.plan-calendar-help-link');
                if (helpLink) helpLink.addEventListener('click', toggleHelp);
            }
        }

        // Close popover when clicking outside (anywhere in document)
        if (calendarPopover) {
            document.addEventListener('click', (e) => {
                const isInsidePopover = calendarPopover.contains(e.target);
                const isAddBtn = calendarAddBtn && calendarAddBtn.contains(e.target);
                const isSyncBtn = calendarSyncAllBtn && calendarSyncAllBtn.contains(e.target);
                if (!isInsidePopover && !isAddBtn && !isSyncBtn) {
                    calendarPopover.classList.add('hidden');
                }
            });
        }

        // Add Calendar save button
        if (calendarAddSaveBtn) {
            calendarAddSaveBtn.addEventListener('click', async () => {
                const name = calendarNameInput?.value?.trim() || 'Calendar ' + (calendars.length + 1);
                const url = calendarUrlInput?.value?.trim();
                if (!url) {
                    if (calendarStatus) calendarStatus.textContent = 'Please enter a calendar URL';
                    return;
                }

                // Generate unique ID
                const id = 'cal-' + Date.now();
                calendars.push({ id, name, url });
                localStorage.setItem(CALENDARS_KEY, JSON.stringify(calendars));

                // Clear inputs
                if (calendarNameInput) calendarNameInput.value = '';
                if (calendarUrlInput) calendarUrlInput.value = '';

                renderCalendarList();
                await syncAllCalendars();
            });
        }

        // Initial render of calendar list
        renderCalendarList();

        function updateCalendarStatus() {
            if (!calendarStatus) return;
            if (calendarLastSync) {
                const date = new Date(calendarLastSync);
                const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                const dateStr = date.toLocaleDateString();
                // Count calendar events from freeformNotes/Lines
                const totalEvents = freeformNotes.filter(n => n.source === 'calendar').length +
                    freeformLines.filter(l => l.source === 'calendar').length;
                calendarStatus.textContent = `Last synced: ${dateStr} ${timeStr} • ${calendars.length} cal${calendars.length !== 1 ? 's' : ''} • ${totalEvents} events`;
            } else if (calendars.length > 0) {
                calendarStatus.textContent = 'Click the sync button to get the events';
            } else {
                calendarStatus.textContent = 'Add a calendar to see its marked events here';
            }
        }

        // Render calendar visibility toggles in the navbar as chips with eye icons
        function renderCalendarToggles() {
            // With no calendar there is nothing to sync, so the sync button goes.
            const syncAllBtn = container.querySelector('.plan-calendar-sync-all-btn');
            if (syncAllBtn) syncAllBtn.classList.toggle('hidden', calendars.length === 0);

            const togglesContainer = container.querySelector('.plan-calendar-toggles');
            if (!togglesContainer) return;
            togglesContainer.innerHTML = '';

            // SVG paths for eye icons
            const eyeOpenSVG = `<svg class="calendar-toggle-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/></svg>`;
            const eyeClosedSVG = `<svg class="calendar-toggle-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"/><path d="M14.084 14.158a3 3 0 0 1-4.242-4.242"/><path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"/><path d="m2 2 20 20"/></svg>`;

            calendars.forEach(cal => {
                // Default to visible if not set
                if (cal.visible === undefined) cal.visible = true;

                const chip = document.createElement('div');
                chip.className = 'plan-calendar-toggle' + (cal.visible ? '' : ' hidden-cal');
                chip.title = 'Toggle visibility • Click name to rename';

                // Build chip inner HTML
                const calColor = cal.fontColor || '#4a90e2';
                const emoji = cal.emoji || '';
                chip.innerHTML = `
                    <span class="calendar-toggle-eye">${cal.visible ? eyeOpenSVG : eyeClosedSVG}</span>
                    ${emoji ? `<span class="calendar-toggle-emoji">${emoji}</span>` : ''}
                    <span class="calendar-name">${cal.name || 'Calendar'}</span>
                    <span class="calendar-toggle-color" title="Change calendar color">
                        <span class="calendar-color-dot" style="background: ${calColor}"></span>
                    </span>
                `;

                // Toggle visibility when clicking the eye icon
                const eyeSpan = chip.querySelector('.calendar-toggle-eye');
                eyeSpan.addEventListener('click', e => {
                    e.stopPropagation();
                    cal.visible = !cal.visible;
                    localStorage.setItem(CALENDARS_KEY, JSON.stringify(calendars));
                    renderFreeformElements();
                    eyeSpan.innerHTML = cal.visible ? eyeOpenSVG : eyeClosedSVG;
                    chip.classList.toggle('hidden-cal', !cal.visible);
                });

                // Color palette popover
                const colorWrapper = chip.querySelector('.calendar-toggle-color');
                const colorDot = chip.querySelector('.calendar-color-dot');
                // redd-do editorial palette: Sky, Ice, Mint, Buttercup, Blush, Apricot, Sunset, Lavender
                // Keep in sync with PLAN_CALENDAR_COLOR_PRESETS in redd-plan/lib/canvasBackground.ts
                const PALETTE = ['#7da9c8', '#8eb5b0', '#8cb89c', '#d4ba6a', '#d4a5a8', '#d99a6c', '#d4605a', '#a896c0'];

                function applyColor(newColor) {
                    cal.fontColor = newColor;
                    cal.lineColor = newColor;
                    colorDot.style.background = newColor;
                    localStorage.setItem(CALENDARS_KEY, JSON.stringify(calendars));
                    freeformNotes.filter(n => n.calendarId === cal.id).forEach(n => {
                        n.fontColor = newColor;
                    });
                    freeformLines.filter(l => l.calendarId === cal.id).forEach(l => {
                        l.color = newColor;
                        l.fontColor = newColor;
                    });
                    saveData();
                    renderFreeformElements();
                }

                colorDot.addEventListener('click', e => {
                    e.stopPropagation();

                    // Close any other open palette popovers
                    container.querySelectorAll('.calendar-color-popover').forEach(p => p.remove());

                    const popover = document.createElement('div');
                    popover.className = 'calendar-color-popover';
                    const currentColor = cal.fontColor || '#7da9c8';
                    // Build palette swatches
                    const swatchesHTML = PALETTE.map(c =>
                        `<button type="button" class="calendar-color-swatch${c === currentColor ? ' selected' : ''}" data-color="${c}" style="background-color: ${c}" title="${c}"></button>`
                    ).join('');
                    popover.innerHTML = `
                        <div class="calendar-color-swatches">
                            ${swatchesHTML}
                            <label class="calendar-color-swatch calendar-color-swatch-custom" title="More colors…">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none"><circle cx="5" cy="12" r="2.5"/><circle cx="12" cy="12" r="2.5"/><circle cx="19" cy="12" r="2.5"/></svg>
                                <input type="color" class="calendar-color-custom-input" value="${currentColor}">
                            </label>
                        </div>
                        <div class="calendar-color-hex-row">
                            <span class="calendar-color-hex-preview" style="background: ${currentColor}"></span>
                            <input type="text" class="calendar-color-hex-input" value="${currentColor}" maxlength="7" spellcheck="false" placeholder="#000000">
                        </div>
                    `;

                    // Position below the dot
                    colorWrapper.appendChild(popover);

                    // Swatch click handlers
                    popover.querySelectorAll('.calendar-color-swatch:not(.calendar-color-swatch-custom)').forEach(swatch => {
                        swatch.addEventListener('click', ev => {
                            ev.stopPropagation();
                            applyColor(swatch.dataset.color);
                            popover.remove();
                        });
                    });

                    // Custom color picker
                    const customInput = popover.querySelector('.calendar-color-custom-input');
                    const hexInput = popover.querySelector('.calendar-color-hex-input');
                    const hexPreview = popover.querySelector('.calendar-color-hex-preview');

                    customInput.addEventListener('input', ev => {
                        const c = ev.target.value;
                        applyColor(c);
                        hexInput.value = c;
                        hexPreview.style.background = c;
                    });

                    // Hex input: apply on Enter or blur
                    const applyHex = () => {
                        let val = hexInput.value.trim();
                        if (!val.startsWith('#')) val = '#' + val;
                        if (/^#[0-9a-fA-F]{6}$/.test(val)) {
                            applyColor(val);
                            hexPreview.style.background = val;
                            customInput.value = val;
                        } else {
                            // Reset to current
                            hexInput.value = cal.fontColor || '#7da9c8';
                        }
                    };
                    hexInput.addEventListener('keydown', ev => {
                        if (ev.key === 'Enter') { ev.preventDefault(); applyHex(); }
                    });
                    hexInput.addEventListener('blur', applyHex);

                    // Close on outside click
                    const closePopover = ev => {
                        if (!popover.contains(ev.target) && ev.target !== colorDot) {
                            popover.remove();
                            document.removeEventListener('click', closePopover, true);
                        }
                    };
                    // Use setTimeout so the current click doesn't immediately close it
                    setTimeout(() => document.addEventListener('click', closePopover, true), 0);
                });

                // Click to rename calendar
                const nameSpan = chip.querySelector('.calendar-name');
                nameSpan.addEventListener('click', e => {
                    e.preventDefault();
                    e.stopPropagation();

                    nameSpan.contentEditable = 'true';
                    nameSpan.focus();

                    // Select all text
                    const range = document.createRange();
                    range.selectNodeContents(nameSpan);
                    const sel = window.getSelection();
                    sel.removeAllRanges();
                    sel.addRange(range);

                    const finishEdit = () => {
                        nameSpan.contentEditable = 'false';
                        const newName = nameSpan.textContent.trim();
                        if (newName && newName !== cal.name) {
                            cal.name = newName;
                            localStorage.setItem(CALENDARS_KEY, JSON.stringify(calendars));
                        } else {
                            nameSpan.textContent = cal.name || 'Calendar';
                        }
                    };

                    nameSpan.addEventListener('blur', finishEdit, { once: true });
                    nameSpan.addEventListener('keydown', ke => {
                        if (ke.key === 'Enter') {
                            ke.preventDefault();
                            nameSpan.blur();
                        } else if (ke.key === 'Escape') {
                            nameSpan.textContent = cal.name || 'Calendar';
                            nameSpan.blur();
                        }
                    });
                });

                togglesContainer.appendChild(chip);
            });
        }

        // Formatting buttons (bold, italic, underline)
        container.querySelectorAll('.plan-note-toolbar .plan-toolbar-btn[data-command]').forEach(btn => {
            btn.addEventListener('mousedown', e => {
                e.preventDefault(); // Prevent losing focus from note
                const command = btn.dataset.command;
                document.execCommand(command, false, null);
            });
        });

        // Note toolbar handlers
        container.querySelector('.plan-note-delete-btn')?.addEventListener('click', deleteSelectedElement);

        container.querySelector('.plan-note-snap-toggle')?.addEventListener('change', e => {
            const selectedNotes = selectedElements.filter(s => s.type === 'note');
            if (selectedNotes.length > 0) {
                selectedNotes.forEach(sel => {
                    const note = freeformNotes.find(n => n.id === sel.id);
                    if (note) {
                        note.snapToDate = e.target.checked;
                        // If turning snap on, immediately snap the note
                        if (note.snapToDate) {
                            const snapped = findClosestDateRowPosition(note.x, note.y);
                            note.x = snapped.x;
                            note.y = snapped.y;
                            sel.element.style.left = snapped.x + 'px';
                            sel.element.style.top = snapped.y + 'px';
                        }
                    }
                });
                saveData();
            }
        });

        container.querySelector('.plan-font-color-picker')?.addEventListener('input', e => {
            const color = e.target.value;
            container.querySelector('.plan-font-color-indicator').style.background = color;

            const selectedNotes = selectedElements.filter(s => s.type === 'note');
            if (selectedNotes.length > 0) {
                pushHistory();
                selectedNotes.forEach(sel => {
                    const note = freeformNotes.find(n => n.id === sel.id);
                    if (note) {
                        note.fontColor = color;
                        sel.element.style.color = color;
                    }
                });
                saveData();
            }
        });

        container.querySelector('.plan-bg-color-picker')?.addEventListener('input', e => {
            const color = e.target.value;
            container.querySelector('.plan-bg-color-indicator').style.background = color;

            const selectedNotes = selectedElements.filter(s => s.type === 'note');
            if (selectedNotes.length > 0) {
                pushHistory();
                selectedNotes.forEach(sel => {
                    const note = freeformNotes.find(n => n.id === sel.id);
                    if (note) {
                        note.bgColor = color;
                        sel.element.style.backgroundColor = color;
                    }
                });
                saveData();
            }
        });

        container.querySelector('.plan-clear-bg-btn')?.addEventListener('click', () => {
            const selectedNotes = selectedElements.filter(s => s.type === 'note');
            if (selectedNotes.length > 0) {
                pushHistory();
                selectedNotes.forEach(sel => {
                    const note = freeformNotes.find(n => n.id === sel.id);
                    if (note) {
                        note.bgColor = null;
                        sel.element.style.backgroundColor = 'transparent';
                    }
                });
                container.querySelector('.plan-bg-color-indicator').style.background = 'transparent';
                saveData();
            }
        });

        // Line toolbar handlers
        container.querySelector('.plan-line-delete-btn')?.addEventListener('click', deleteSelectedElement);

        container.querySelector('.plan-line-color-picker')?.addEventListener('input', e => {
            const color = e.target.value;
            container.querySelector('.plan-line-color-indicator').style.background = color;

            const selectedLines = selectedElements.filter(s => s.type === 'line');
            if (selectedLines.length > 0) {
                pushHistory();
                selectedLines.forEach(sel => {
                    const line = freeformLines.find(l => l.id === sel.id);
                    if (line) {
                        line.color = color;
                        const lineEl = sel.element.closest('.plan-note-line-container')?.querySelector('.plan-note-line') || sel.element;
                        lineEl.style.background = color;
                    }
                });
                saveData();
            }
        });

        container.querySelector('.plan-line-width-select')?.addEventListener('change', e => {
            const width = parseInt(e.target.value);

            const selectedLines = selectedElements.filter(s => s.type === 'line');
            if (selectedLines.length > 0) {
                pushHistory();
                selectedLines.forEach(sel => {
                    const line = freeformLines.find(l => l.id === sel.id);
                    if (line) {
                        line.width = width;
                        const container = sel.element.closest('.plan-note-line-container') || sel.element;
                        const lineEl = container.querySelector('.plan-note-line') || sel.element;

                        // Vertical lines use width for bar thickness, horizontal use height
                        if (lineEl.classList.contains('vertical')) {
                            lineEl.style.width = width + 'px';
                        } else {
                            lineEl.style.height = width + 'px';
                        }
                    }
                });
                saveData();
            }
        });

        // Click outside to deselect
        document.addEventListener('click', e => {
            if (!e.target.closest('.plan-inline-toolbar') &&
                !e.target.closest('.plan-note-text') &&
                !e.target.closest('.plan-note-line') &&
                !e.target.closest('.plan-week-note-text, .plan-week-block--note, .plan-week-line, .plan-week-own-line') &&
                selectedElements.length > 0) {
                deselectElement();
            }
        });

        // Keyboard delete (Backspace/Delete key). One handler: the calendar is
        // started again each time its view opens, and with two handlers one
        // Cmd+Z went back two steps.
        if (onCalendarKeyDown) document.removeEventListener('keydown', onCalendarKeyDown);
        onCalendarKeyDown = e => {
            if (!isInitialized) return;
            // Undo: Cmd/Ctrl + Z
            if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) {
                e.preventDefault();
                if (undoStack.length > 0) {
                    redoStack.push({ notes: JSON.parse(JSON.stringify(freeformNotes)), lines: JSON.parse(JSON.stringify(freeformLines)) });
                    const prev = undoStack.pop();
                    freeformNotes = prev.notes; freeformLines = prev.lines;
                    saveData(); renderFreeformElements(); updateUndoRedoButtons();
                }
                return;
            }

            // Redo: Cmd/Ctrl + Shift + Z
            if ((e.metaKey || e.ctrlKey) && e.key === 'z' && e.shiftKey) {
                e.preventDefault();
                if (redoStack.length > 0) {
                    undoStack.push({ notes: JSON.parse(JSON.stringify(freeformNotes)), lines: JSON.parse(JSON.stringify(freeformLines)) });
                    const next = redoStack.pop();
                    freeformNotes = next.notes; freeformLines = next.lines;
                    saveData(); renderFreeformElements(); updateUndoRedoButtons();
                }
                return;
            }

            // Delete selected elements
            if ((e.key === 'Backspace' || e.key === 'Delete') && selectedElements.length > 0) {
                // A key that is typed in a text box belongs to the text box: the
                // label box of a highlight, the goal form, the calendar dialog.
                // Backspace there deleted the whole highlight, not one letter.
                const typingIn = e.target;
                const box = typingIn && typingIn.closest && typingIn.closest('input, textarea, [contenteditable="true"]');
                const holdsText = box && !(box.tagName === 'INPUT' && /^(checkbox|radio|range|color|button|submit)$/i.test(box.type));
                // An empty label box has nothing to delete: the key is for the line.
                if (holdsText && !(box.classList.contains('plan-line-label-field') && box.value === '')) {
                    return;
                }
                // The colour or the width of a line was the last thing pressed. The key is for the line.
                if (box && !holdsText) box.blur();
                // Don't delete if we're editing text (contenteditable) - check notes and line labels
                const editingNote = selectedElements.find(s =>
                    s.type === 'note' && s.element.getAttribute('contenteditable') === 'true'
                );
                // Also check if any line label is being edited
                const editingLabel = document.querySelector('.plan-line-label[contenteditable="true"]');
                if (editingNote || editingLabel) {
                    return; // Let normal text editing happen
                }
                e.preventDefault();
                deleteSelectedElement();
            }
        };
        document.addEventListener('keydown', onCalendarKeyDown);

        // Initialize calendar toggles
        renderCalendarToggles();
    }

    function refresh() {
        // Re-read localStorage (server hydrate writes here) then re-render
        loadData();
        loadLanguage();
        loadWeekGoals();
        updateViewModeButtons();
        renderCalendar();
        renderWeekGoals();
        scheduleLayoutRefresh();
    }

    return { init, destroy, refresh, setPeople, setTasks, setTaskTime, setLinkableTasks, setMe };
})();

// Expose globally so React (or other host code) can call init/destroy.
if (typeof window !== 'undefined') {
    window.PlanModule = PlanModule;
}

// Export for Node/Electron
if (typeof module !== 'undefined' && module.exports) {
    module.exports = PlanModule;
}
