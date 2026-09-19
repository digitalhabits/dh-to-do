/*
 * Events from the reader's calendars on the plan, as pure rules.
 *
 * The events are fetched, not saved. What is saved, and shared, is only
 * what the reader did to one: moved a note along its day, moved a line, or
 * gave it a label of their own. These rules tell those changes apart from
 * the event as it was fetched, and put them back on the next fetch.
 *
 * Loaded before plan.js, which reads them as window.PlanCalendarEvents.
 * No DOM and no storage in this file, so a test can require it.
 */
(function (root) {
    // The fields a reader can change on a calendar item.
    const FIELDS = { note: ['offsetX', 'label'], line: ['verticalLineX', 'label'] };

    function isCalendarItem(item) {
        return Boolean(item) && (item.source === 'calendar' || item.isCalendarEvent === true);
    }

    // The reader's own items, and the calendar items, from one list.
    function splitCalendarItems(items) {
        const own = [];
        const calendar = [];
        for (const item of items || []) (isCalendarItem(item) ? calendar : own).push(item);
        return { own, calendar };
    }

    // { notes: { id: changes }, lines: { id: changes } }, whatever was stored.
    function normaliseCustomisations(value) {
        const pick = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
        return {
            notes: { ...pick(value && value.notes) },
            lines: { ...pick(value && value.lines) },
        };
    }

    /*
     * What the reader changed on each calendar item, against the item as it
     * was fetched. A field put back to the fetched value is forgotten, so an
     * event renamed in the calendar shows its new name. An item that is not
     * in this fetch keeps what was stored for it: it may be back next time.
     */
    function collectCustomisations(current, fetched, kind, previous) {
        const fields = FIELDS[kind];
        const originals = new Map((fetched || []).map((item) => [item.id, item]));
        const out = { ...(previous || {}) };
        for (const item of current || []) {
            if (!isCalendarItem(item)) continue;
            const original = originals.get(item.id);
            if (!original) continue;
            const changed = {};
            for (const field of fields) {
                if (item[field] !== undefined && item[field] !== original[field]) {
                    changed[field] = item[field];
                }
            }
            if (Object.keys(changed).length) out[item.id] = changed;
            else delete out[item.id];
        }
        return out;
    }

    /*
     * The fetched items with the reader's changes on them. Always copies:
     * a drag changes the item on screen, and the fetched one has to stay as
     * it was to tell the change apart.
     */
    function applyCustomisations(items, customisations) {
        return (items || []).map((item) => {
            const changed = customisations && customisations[item.id];
            return changed ? { ...item, ...changed } : { ...item };
        });
    }

    /*
     * Calendar items that an older version saved into the shared notes.
     * Their moves are all that can be told apart from a fetched copy: a
     * fetched note starts at offset 0 and a fetched line has no position.
     */
    function legacyCustomisations(items, kind) {
        const out = {};
        for (const item of items || []) {
            if (!isCalendarItem(item)) continue;
            if (kind === 'note' && typeof item.offsetX === 'number' && item.offsetX !== 0) {
                out[item.id] = { offsetX: item.offsetX };
            }
            if (kind === 'line' && typeof item.verticalLineX === 'number') {
                out[item.id] = { verticalLineX: item.verticalLineX };
            }
        }
        return out;
    }

    // Those same items as a fetch would have given them, with the moves taken off.
    function legacyAsFetched(items, kind) {
        return (items || []).map((item) => {
            const copy = { ...item };
            if (kind === 'note' && 'offsetX' in copy) copy.offsetX = 0;
            if (kind === 'line') delete copy.verticalLineX;
            return copy;
        });
    }

    const api = {
        isCalendarItem,
        splitCalendarItems,
        normaliseCustomisations,
        collectCustomisations,
        applyCustomisations,
        legacyCustomisations,
        legacyAsFetched,
    };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.PlanCalendarEvents = api;
})(typeof window !== 'undefined' ? window : globalThis);
