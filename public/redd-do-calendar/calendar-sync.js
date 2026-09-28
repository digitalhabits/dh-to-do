// Calendar Sync Module for Plan Mode
// Fetches and parses ICS calendar feeds, filtering events by "REDD-DO" prefix

const CalendarSync = (function () {
    'use strict';

    // Parse ICS data and return events
    function parseICS(icsData) {
        try {
            // ICAL.js is loaded as a module, access via window.ICAL or global ICAL
            const ICAL = window.ICAL || (typeof require !== 'undefined' ? require('../lib/ical.js').default : null);
            if (!ICAL) {
                throw new Error('ICAL.js library not loaded');
            }

            const jcalData = ICAL.parse(icsData);
            const comp = new ICAL.Component(jcalData);
            const vevents = comp.getAllSubcomponents('vevent');

            const events = [];
            for (const vevent of vevents) {
                const event = new ICAL.Event(vevent);
                const isAllDay = event.startDate ? event.startDate.isDate : false;

                let startDate, endDate;

                if (isAllDay) {
                    // For all-day events, use raw date components to avoid timezone issues
                    // ICAL.Time stores year, month (1-based), day directly
                    if (event.startDate) {
                        startDate = new Date(Date.UTC(
                            event.startDate.year,
                            event.startDate.month - 1,  // JS months are 0-based
                            event.startDate.day
                        ));
                    }
                    if (event.endDate) {
                        endDate = new Date(Date.UTC(
                            event.endDate.year,
                            event.endDate.month - 1,
                            event.endDate.day
                        ));
                    }
                } else {
                    // For timed events, use toJSDate() which handles timezone correctly
                    startDate = event.startDate ? event.startDate.toJSDate() : null;
                    endDate = event.endDate ? event.endDate.toJSDate() : null;
                }

                // Debug logging for date parsing
                if (event.description && event.description.toLowerCase().includes('redd-do')) {
                    console.log('[CalendarSync] Parsing event:', event.summary, {
                        isAllDay,
                        rawStartObj: event.startDate ? JSON.stringify(event.startDate) : null,
                        rawEndObj: event.endDate ? JSON.stringify(event.endDate) : null,
                        jsStart: startDate ? startDate.toISOString() : null,
                        jsEnd: endDate ? endDate.toISOString() : null,
                        durationDays: startDate && endDate ?
                            Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24)) : 1
                    });
                }

                events.push({
                    uid: event.uid,
                    summary: event.summary || '',
                    description: event.description || '',
                    startDate: startDate,
                    endDate: endDate,
                    isAllDay: isAllDay,
                    location: event.location || '',
                    // Duration in days for multi-day events
                    durationDays: startDate && endDate ?
                        Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24)) : 1
                });
            }

            return events;
        } catch (error) {
            console.error('[CalendarSync] Error parsing ICS:', error);
            throw error;
        }
    }

    // What at the start of an event's description puts the event on the plan:
    // "REDD-DO" or "DH-TO-DO", in any case.
    const PLAN_MARKER = /^(redd-do|dh-to-do)/i;

    /*
     * The events that belong on the board.
     *
     * Marked only by default: the marker keeps a busy calendar off the
     * board. A calendar set to show everything skips that test and keeps
     * the dates, because a board two years wide helps nobody.
     */
    function filterReddDoEvents(events, options) {
        const markedOnly = !options || options.markedOnly !== false;
        const now = new Date();
        const twoMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 2, now.getDate());
        const oneYearAhead = new Date(now.getFullYear() + 1, now.getMonth(), now.getDate());

        return events.filter(event => {
            // Check description prefix
            const desc = (event.description || '').trim();
            if (markedOnly && !PLAN_MARKER.test(desc)) return false;

            // Check date range
            const eventStart = event.startDate;
            const eventEnd = event.endDate || event.startDate;
            if (!eventStart) return false;

            // Event must overlap with our date range
            return eventEnd >= twoMonthsAgo && eventStart <= oneYearAhead;
        });
    }

    // The text an event shows: its title. The marker in the description only
    // says the event belongs on the plan; the rest of the description is the
    // event's details, not its name. An event with no title shows what the
    // description says after the marker.
    function getDisplayText(event) {
        const title = (event.summary || '').trim();
        if (title) return title;
        const desc = (event.description || '').trim();
        const cleaned = desc.replace(/^(redd-do|dh-to-do)[\s:,-]*/i, '').trim();
        return cleaned || 'Calendar Event';
    }

    // Convert event to internal note format
    function convertToNote(event) {
        const startDate = event.startDate;
        if (!startDate) return null;

        // Use UTC for all-day events to avoid timezone issues
        const dateKey = formatDateKey(startDate, event.isAllDay);

        return {
            id: 'cal-' + event.uid,
            text: getDisplayText(event),
            dateKey: dateKey,
            offsetX: 0,
            isCalendarEvent: true,
            calendarEventUid: event.uid,
            isAllDay: event.isAllDay,
            startMinutes: event.isAllDay
                ? null
                : startDate.getHours() * 60 + startDate.getMinutes(),
            endMinutes: event.isAllDay || !event.endDate
                ? null
                : event.endDate.getHours() * 60 + event.endDate.getMinutes(),
        };
    }

    // Convert multi-day event to internal line format  
    function convertToLine(event) {
        const startDate = event.startDate;
        const endDate = event.endDate;
        if (!startDate || !endDate) return null;

        // For all-day events, end date is exclusive, so subtract one day
        let adjustedEndDate = new Date(endDate);
        if (event.isAllDay && event.durationDays > 1) {
            adjustedEndDate.setUTCDate(adjustedEndDate.getUTCDate() - 1);
        }

        // Use UTC for all-day events to avoid timezone issues
        const startDateKey = formatDateKey(startDate, event.isAllDay);
        const endDateKey = formatDateKey(adjustedEndDate, event.isAllDay);

        // Debug logging for specific event
        if (event.description && event.description.toLowerCase().includes('redd-do') && event.durationDays > 1) {
            console.log('[CalendarSync] Converting Line:', getDisplayText(event), {
                isAllDay: event.isAllDay,
                startDate: startDate.toISOString(),
                endDate: endDate.toISOString(),
                adjustedEndDate: adjustedEndDate.toISOString(),
                startDateKey,
                endDateKey,
                durationDays: event.durationDays
            });
        }

        return {
            id: 'cal-line-' + event.uid,
            label: getDisplayText(event),
            startDate: startDateKey,
            endDate: endDateKey,
            startOffsetX: 40,  // Position after day name/number
            endOffsetX: 200,   // Near end of note area
            color: '#4a90e2',  // ReDD brand blue for calendar events
            width: 8,
            isCalendarEvent: true,
            calendarEventUid: event.uid
        };
    }

    // Format date as YYYY-MM-DD key
    // Use UTC for all-day events to avoid timezone conversion issues
    function formatDateKey(date, useUTC = false) {
        if (useUTC) {
            const year = date.getUTCFullYear();
            const month = String(date.getUTCMonth() + 1).padStart(2, '0');
            const day = String(date.getUTCDate()).padStart(2, '0');
            const key = `${year}-${month}-${day}`;
            // console.log(`[CalendarSync] formatDateKey UTC: ${date.toISOString()} -> ${key}`);
            return key;
        }
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    /**
     * A feed that answers 429 is a feed that is being asked too often.
     *
     * An ICS address throttles, and it goes on answering 429 for a while
     * after that. Two surfaces run this file — the Calendar tab and the
     * planner view inside To-Do — and each of them asks on its own timer,
     * when the window comes forward, and every time it is drawn again. So
     * the wait is kept here: by address, not by surface, and in storage, so
     * that a tab which opens again does not forget it and ask straight away.
     *
     * A press on Sync asks anyway. The reader is in front of it.
     */
    const ASKED_KEY = 'redd-calendar-asked';
    /** How long to leave a feed alone after it answers 429. */
    const THROTTLE_MS = 30 * 60 * 1000;
    /** The least time between two asks of one address, however often we draw. */
    const FLOOR_MS = 5 * 60 * 1000;

    function askedTable() {
        try {
            const raw = window.localStorage.getItem(ASKED_KEY);
            const table = raw ? JSON.parse(raw) : {};
            return table && typeof table === 'object' ? table : {};
        } catch {
            return {};
        }
    }

    function skipped(message) {
        const error = new Error(message);
        error.calendarSkipped = true;
        return error;
    }

    function askedAbout(url) {
        const row = askedTable()[url];
        return {
            at: Number(row && row.at) || 0,
            until: Number(row && row.until) || 0,
        };
    }

    function remember(url, patch) {
        try {
            const table = askedTable();
            const now = Date.now();
            // Rows nothing waits on any more are dropped, so it cannot grow.
            for (const [key, row] of Object.entries(table)) {
                const at = Number(row && row.at) || 0;
                const until = Number(row && row.until) || 0;
                if (until < now && at < now - THROTTLE_MS) delete table[key];
            }
            table[url] = { ...(table[url] || {}), ...patch };
            window.localStorage.setItem(ASKED_KEY, JSON.stringify(table));
        } catch {
            /* private mode: the app then asks as often as it draws */
        }
    }

    // Fetch ICS data from URL
    async function fetchCalendarData(url, options) {
        const force = Boolean(options && options.force);
        const asked = askedAbout(url);
        const now = Date.now();
        // A skip is not a failure: the caller keeps what the feed gave last
        // time and says nothing, because nothing went wrong.
        if (!force && asked.until > now) {
            const minutes = Math.ceil((asked.until - now) / 60000);
            throw skipped(
                `This calendar answered 429 (too many requests). Waiting ${minutes} more minutes.`
            );
        }
        if (!force && asked.at > now - FLOOR_MS) {
            throw skipped('This calendar was read a moment ago.');
        }
        remember(url, { at: now });
        try {
            // Handle webcal:// protocol by converting to https://
            let fetchUrl = url;
            if (fetchUrl.startsWith('webcal://')) {
                fetchUrl = 'https://' + fetchUrl.slice(9);
            }

            // Add cache buster
            const separator = fetchUrl.includes('?') ? '&' : '?';
            fetchUrl += `${separator}_=${new Date().getTime()}`;

            const tauriFetch =
                (typeof tauriAPI !== 'undefined' && tauriAPI && typeof tauriAPI.fetch === 'function')
                    ? tauriAPI.fetch.bind(tauriAPI)
                    : (typeof window !== 'undefined'
                        && window.__TAURI__
                        && window.__TAURI__.http
                        && typeof window.__TAURI__.http.fetch === 'function')
                        ? window.__TAURI__.http.fetch.bind(window.__TAURI__.http)
                        : null;

            const fetchFn = tauriFetch || fetch;

            const response = await fetchFn(fetchUrl, {
                method: 'GET'
            });
            if (response.status === 429) remember(url, { until: Date.now() + THROTTLE_MS });
            // An answer lifts the wait: the feed is talking to us again.
            else if (response.ok) remember(url, { until: 0 });
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const icsData = await response.text();
            return icsData;
        } catch (error) {
            // The caller says which calendar it was and keeps what it had.
            // An error here is an answer, not a fault of the page, so it is
            // not written as one.
            throw error;
        }
    }

    /**
     * Events to what the board draws.
     *
     * Where the events came from is already forgotten here: an address and a
     * Google calendar both arrive as the same events, and the marker, the
     * dates and the shapes are worked out the one way.
     */
    function itemsFromEvents(allEvents, options) {
        console.log('[CalendarSync] Parsed events:', allEvents.length);

        const filteredEvents = filterReddDoEvents(allEvents, options);
        console.log('[CalendarSync] Filtered REDD-DO events:', filteredEvents.length);

        const notes = [];
        const lines = [];

        for (const event of filteredEvents) {
            // Multi-day all-day events become lines
            if (event.isAllDay && event.durationDays > 1) {
                const line = convertToLine(event);
                if (line) lines.push(line);
            } else {
                // Single-day or timed events become notes
                const note = convertToNote(event);
                if (note) notes.push(note);
            }
        }

        console.log('[CalendarSync] Generated:', { notes: notes.length, lines: lines.length });

        return {
            notes,
            lines,
            lastSync: new Date().toISOString(),
            eventCount: filteredEvents.length
        };
    }

    /** A date with no time, as the day itself and not as a moment somewhere. */
    function dayToDate(value) {
        const parts = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value));
        if (!parts) return null;
        return new Date(Date.UTC(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3])));
    }

    /**
     * The events the server read from a Google calendar, in the shape the
     * board works in.
     *
     * The server sends dates as text, because JSON has no date. A whole day
     * is "2026-09-29" and is read as that day everywhere; an event with a
     * time carries its own offset and is read as the moment it names. That
     * is what parseICS does with the same two cases, so both kinds of
     * calendar land in the same places on the board.
     */
    function eventsFromBoard(boardEvents) {
        const events = [];
        for (const event of boardEvents || []) {
            const isAllDay = Boolean(event.isAllDay);
            const startDate = isAllDay ? dayToDate(event.start) : new Date(event.start);
            const endDate = isAllDay ? dayToDate(event.end) : new Date(event.end);
            if (!startDate || Number.isNaN(startDate.getTime())) continue;
            const end = endDate && !Number.isNaN(endDate.getTime()) ? endDate : null;
            events.push({
                uid: event.uid,
                summary: event.summary || '',
                description: event.description || '',
                startDate,
                endDate: end,
                isAllDay,
                location: event.location || '',
                // The same count as an ICS feed gives: an end is the morning
                // after, so a single day comes out as one.
                durationDays: end ? Math.ceil((end - startDate) / (1000 * 60 * 60 * 24)) : 1
            });
        }
        return events;
    }

    /** What the board draws for one Google calendar the server read. */
    function syncBoardEvents(boardEvents, options) {
        return itemsFromEvents(eventsFromBoard(boardEvents), options);
    }

    // Main sync function - fetches, parses, filters, and converts events
    async function syncCalendar(url, options) {
        console.log('[CalendarSync] Syncing calendar from:', url);

        const icsData = await fetchCalendarData(url, options);
        console.log('[CalendarSync] Fetched ICS data, length:', icsData.length);

        return itemsFromEvents(parseICS(icsData), options);
    }

    return {
        syncCalendar,
        syncBoardEvents,
        eventsFromBoard,
        itemsFromEvents,
        fetchCalendarData,
        parseICS,
        filterReddDoEvents,
        convertToNote,
        convertToLine,
        getDisplayText,
        formatDateKey
    };
})();

// Make available globally for plan.js
window.CalendarSync = CalendarSync;

// Export for Node/Electron
if (typeof module !== 'undefined' && module.exports) {
    module.exports = CalendarSync;
}
