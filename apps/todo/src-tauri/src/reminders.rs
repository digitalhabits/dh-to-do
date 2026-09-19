use serde::{Deserialize, Serialize};
use tauri::command;

#[derive(Debug, Serialize, Deserialize)]
pub struct RemindersList {
    pub id: String,
    pub name: String,
    #[serde(rename = "groupName", default)]
    pub group_name: Option<String>,
    #[serde(rename = "sourceName", default)]
    pub source_name: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RemindersTask {
    pub id: String,
    pub name: String,
    pub completed: bool,
    pub notes: String,
    #[serde(rename = "creationDate")]
    pub creation_date: f64,
    #[serde(rename = "completionDate")]
    pub completion_date: f64,
    #[serde(rename = "lastModifiedDate")]
    pub last_modified_date: f64,
    /// The due day as "YYYY-MM-DD", the shape the board keeps. None when
    /// the reminder has no due date.
    #[serde(rename = "dueOn", default)]
    pub due_on: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RemindersResult {
    pub success: Option<bool>,
    pub error: Option<String>,
    pub id: Option<String>,
}

#[cfg(target_os = "macos")]
mod native_eventkit {
    use super::{RemindersList, RemindersResult, RemindersTask};
    use block2::RcBlock;
    use objc2::rc::Retained;
    use objc2::runtime::Bool;
    use objc2::AnyThread;
    use objc2::{msg_send, sel};
    use objc2_event_kit::{
        EKAuthorizationStatus, EKCalendar, EKEntityMask, EKEntityType, EKEventStore, EKReminder,
    };
    use objc2_foundation::{
        NSArray, NSCalendar, NSDate, NSDateComponentUndefined, NSDateComponents, NSError,
        NSInteger, NSObjectProtocol, NSString,
    };
    use std::sync::mpsc;

    const REMINDER_ENTITY_TYPE: EKEntityType = EKEntityType(1);
    const REMINDER_ENTITY_MASK: EKEntityMask = EKEntityMask::from_bits_retain(1 << 1);

    const STATUS_NOT_DETERMINED: EKAuthorizationStatus = EKAuthorizationStatus(0);
    const STATUS_RESTRICTED: EKAuthorizationStatus = EKAuthorizationStatus(1);
    const STATUS_DENIED: EKAuthorizationStatus = EKAuthorizationStatus(2);
    const STATUS_AUTHORIZED: EKAuthorizationStatus = EKAuthorizationStatus(3);
    const STATUS_FULL_ACCESS: EKAuthorizationStatus = EKAuthorizationStatus(4);
    const STATUS_WRITE_ONLY: EKAuthorizationStatus = EKAuthorizationStatus(5);

    fn authorization_status_string(status: EKAuthorizationStatus) -> &'static str {
        match status {
            STATUS_NOT_DETERMINED => "notDetermined",
            STATUS_RESTRICTED => "restricted",
            STATUS_DENIED => "denied",
            STATUS_AUTHORIZED => "authorized",
            STATUS_FULL_ACCESS => "fullAccess",
            STATUS_WRITE_ONLY => "writeOnly",
            _ => "unknown",
        }
    }

    fn has_read_access(status: EKAuthorizationStatus) -> bool {
        status == STATUS_AUTHORIZED || status == STATUS_FULL_ACCESS
    }

    #[allow(deprecated)]
    fn reminders_store() -> Retained<EKEventStore> {
        unsafe {
            EKEventStore::initWithAccessToEntityTypes(EKEventStore::alloc(), REMINDER_ENTITY_MASK)
        }
    }

    fn ns_string(value: &str) -> Retained<NSString> {
        NSString::from_str(value)
    }

    fn permission_denied(status: EKAuthorizationStatus, error: Option<String>) -> String {
        match error {
            Some(error) if !error.trim().is_empty() => {
                format!("Permission denied ({})", error.trim())
            }
            _ => format!(
                "Permission denied ({})",
                authorization_status_string(status)
            ),
        }
    }

    fn ns_date_to_timestamp(date: Option<Retained<NSDate>>) -> f64 {
        match date {
            Some(date) => unsafe { msg_send![&*date, timeIntervalSince1970] },
            None => 0.0,
        }
    }

    fn source_title(calendar: &EKCalendar) -> String {
        unsafe {
            calendar
                .source()
                .map(|source| {
                    let title: Retained<NSString> = msg_send![&*source, title];
                    title.to_string()
                })
                .unwrap_or_default()
        }
    }

    fn reminder_notes(reminder: &EKReminder) -> String {
        unsafe {
            let notes: Option<Retained<NSString>> = msg_send![reminder, notes];
            notes.map(|value| value.to_string()).unwrap_or_default()
        }
    }

    fn reminder_creation_date(reminder: &EKReminder) -> Option<Retained<NSDate>> {
        unsafe { msg_send![reminder, creationDate] }
    }

    fn reminder_last_modified_date(reminder: &EKReminder) -> Option<Retained<NSDate>> {
        unsafe { msg_send![reminder, lastModifiedDate] }
    }

    /// The due day, or None. Reminders keeps a due date as calendar
    /// components rather than an instant, so the day is read straight off
    /// them and never crosses a time zone on the way to the board.
    fn reminder_due_on(reminder: &EKReminder) -> Option<String> {
        let components = unsafe { reminder.dueDateComponents() }?;
        let (year, month, day) = (components.year(), components.month(), components.day());
        if year == NSDateComponentUndefined
            || month == NSDateComponentUndefined
            || day == NSDateComponentUndefined
        {
            return None;
        }
        Some(format!("{year:04}-{month:02}-{day:02}"))
    }

    /// "YYYY-MM-DD" to the components Reminders wants: a day in the user's
    /// calendar with no time, which Reminders shows as an all-day due date.
    fn due_on_components(due_on: &str) -> Result<Retained<NSDateComponents>, String> {
        let bad = || format!("Bad due date: {due_on}");
        let mut parts = due_on.split('-');
        let (Some(year), Some(month), Some(day), None) =
            (parts.next(), parts.next(), parts.next(), parts.next())
        else {
            return Err(bad());
        };
        let parse = |part: &str| part.parse::<NSInteger>().map_err(|_| bad());
        let (year, month, day) = (parse(year)?, parse(month)?, parse(day)?);
        let components = NSDateComponents::new();
        components.setCalendar(Some(&NSCalendar::currentCalendar()));
        components.setYear(year);
        components.setMonth(month);
        components.setDay(day);
        Ok(components)
    }

    fn set_due_on(reminder: &EKReminder, due_on: Option<&str>) -> Result<(), String> {
        let components = match due_on {
            Some(due_on) => Some(due_on_components(due_on)?),
            None => None,
        };
        unsafe {
            reminder.setDueDateComponents(components.as_deref());
        }
        Ok(())
    }

    fn reminder_to_task(reminder: &EKReminder) -> RemindersTask {
        RemindersTask {
            id: unsafe { reminder.calendarItemIdentifier() }.to_string(),
            name: unsafe { reminder.title() }.to_string(),
            completed: unsafe { reminder.isCompleted() },
            notes: reminder_notes(reminder),
            creation_date: ns_date_to_timestamp(reminder_creation_date(reminder)),
            completion_date: ns_date_to_timestamp(unsafe { reminder.completionDate() }),
            last_modified_date: ns_date_to_timestamp(reminder_last_modified_date(reminder)),
            due_on: reminder_due_on(reminder),
        }
    }

    fn find_calendar(store: &EKEventStore, list_id: &str) -> Result<Retained<EKCalendar>, String> {
        let identifier = ns_string(list_id);
        unsafe { store.calendarWithIdentifier(&identifier) }
            .ok_or_else(|| "List not found".to_string())
    }

    fn find_reminder(store: &EKEventStore, task_id: &str) -> Result<Retained<EKReminder>, String> {
        let identifier = ns_string(task_id);
        let item = unsafe { store.calendarItemWithIdentifier(&identifier) }
            .ok_or_else(|| "Task not found".to_string())?;

        item.downcast::<EKReminder>()
            .map_err(|_| "Task not found".to_string())
    }

    fn save_reminder(store: &EKEventStore, reminder: &EKReminder) -> Result<(), String> {
        unsafe { store.saveReminder_commit_error(reminder, true) }
            .map_err(|err| format!("Failed to save: {}", err))
    }

    fn remove_reminder(store: &EKEventStore, reminder: &EKReminder) -> Result<(), String> {
        unsafe { store.removeReminder_commit_error(reminder, true) }
            .map_err(|err| format!("Failed to delete: {}", err))
    }

    pub fn ensure_access() -> Result<(), String> {
        let initial_status =
            unsafe { EKEventStore::authorizationStatusForEntityType(REMINDER_ENTITY_TYPE) };

        if has_read_access(initial_status) {
            return Ok(());
        }

        if initial_status == STATUS_RESTRICTED
            || initial_status == STATUS_DENIED
            || initial_status == STATUS_WRITE_ONLY
        {
            return Err(permission_denied(initial_status, None));
        }

        let store = reminders_store();
        let (tx, rx) = mpsc::channel();
        let block = RcBlock::new(move |granted: Bool, error: *mut NSError| {
            let error_message = if error.is_null() {
                None
            } else {
                Some(unsafe { (&*error).to_string() })
            };
            let _ = tx.send((granted.as_bool(), error_message));
        });

        unsafe {
            if store.respondsToSelector(sel!(requestFullAccessToRemindersWithCompletion:)) {
                store.requestFullAccessToRemindersWithCompletion(RcBlock::as_ptr(&block));
            } else {
                #[allow(deprecated)]
                store.requestAccessToEntityType_completion(
                    REMINDER_ENTITY_TYPE,
                    RcBlock::as_ptr(&block),
                );
            }
        }

        let (granted, error_message) = rx
            .recv()
            .map_err(|_| "Reminders permission request did not complete".to_string())?;
        let final_status =
            unsafe { EKEventStore::authorizationStatusForEntityType(REMINDER_ENTITY_TYPE) };

        if granted && has_read_access(final_status) {
            return Ok(());
        }

        // The request finished and the status did not move. The user made no
        // choice, because macOS showed no prompt. It shows one for a signed app
        // bundle only, and a development build is a bare executable with an
        // Info.plist that the signature does not seal. "Permission denied" is
        // wrong here, and it sends the reader to a settings pane that does not
        // list the app.
        if final_status == STATUS_NOT_DETERMINED && error_message.is_none() {
            return Err(
                "macOS did not ask for Reminders access. Run the built app: the \
                 system prompts for a signed app only."
                    .to_string(),
            );
        }

        Err(permission_denied(final_status, error_message))
    }

    pub fn fetch_lists() -> Result<Vec<RemindersList>, String> {
        ensure_access()?;

        let store = reminders_store();
        let calendars = unsafe { store.calendarsForEntityType(REMINDER_ENTITY_TYPE) };
        let mut lists = Vec::with_capacity(calendars.len());

        for calendar in &*calendars {
            let source_name = source_title(&calendar);
            let source_value = (!source_name.is_empty()).then_some(source_name.clone());

            lists.push(RemindersList {
                id: unsafe { calendar.calendarIdentifier() }.to_string(),
                name: unsafe { calendar.title() }.to_string(),
                group_name: source_value.clone(),
                source_name: source_value,
            });
        }

        Ok(lists)
    }

    pub fn fetch_tasks(list_id: String) -> Result<Vec<RemindersTask>, String> {
        ensure_access()?;

        let store = reminders_store();
        let calendar = find_calendar(&store, &list_id)?;
        let calendars = NSArray::from_retained_slice(&[calendar]);
        let predicate = unsafe { store.predicateForRemindersInCalendars(Some(&calendars)) };
        let (tx, rx) = mpsc::channel();
        let block = RcBlock::new(move |reminders: *mut NSArray<EKReminder>| {
            let tasks = if reminders.is_null() {
                Vec::new()
            } else {
                let reminders = unsafe { &*reminders };
                reminders
                    .iter()
                    .map(|reminder| reminder_to_task(&reminder))
                    .collect()
            };
            let _ = tx.send(tasks);
        });

        unsafe {
            store.fetchRemindersMatchingPredicate_completion(&predicate, &block);
        }

        rx.recv()
            .map_err(|_| "Failed to fetch reminders tasks".to_string())
    }

    pub fn update_status(task_id: String, completed: bool) -> Result<RemindersResult, String> {
        ensure_access()?;

        let store = reminders_store();
        let reminder = find_reminder(&store, &task_id)?;
        unsafe {
            reminder.setCompleted(completed);
        }
        save_reminder(&store, &reminder)?;

        Ok(RemindersResult {
            success: Some(true),
            error: None,
            id: None,
        })
    }

    pub fn update_title(task_id: String, title: String) -> Result<RemindersResult, String> {
        ensure_access()?;

        let store = reminders_store();
        let reminder = find_reminder(&store, &task_id)?;
        let title = ns_string(&title);
        unsafe {
            reminder.setTitle(Some(&title));
        }
        save_reminder(&store, &reminder)?;

        Ok(RemindersResult {
            success: Some(true),
            error: None,
            id: None,
        })
    }

    pub fn update_due(task_id: String, due_on: Option<String>) -> Result<RemindersResult, String> {
        ensure_access()?;

        let store = reminders_store();
        let reminder = find_reminder(&store, &task_id)?;
        set_due_on(&reminder, due_on.as_deref())?;
        save_reminder(&store, &reminder)?;

        Ok(RemindersResult {
            success: Some(true),
            error: None,
            id: None,
        })
    }

    pub fn update_notes(task_id: String, notes: String) -> Result<RemindersResult, String> {
        ensure_access()?;

        let store = reminders_store();
        let reminder = find_reminder(&store, &task_id)?;
        let notes = ns_string(&notes);
        unsafe {
            reminder.setNotes(Some(&notes));
        }
        save_reminder(&store, &reminder)?;

        Ok(RemindersResult {
            success: Some(true),
            error: None,
            id: None,
        })
    }

    pub fn delete_task(task_id: String) -> Result<RemindersResult, String> {
        ensure_access()?;

        let store = reminders_store();
        let reminder = find_reminder(&store, &task_id)?;
        remove_reminder(&store, &reminder)?;

        Ok(RemindersResult {
            success: Some(true),
            error: None,
            id: None,
        })
    }

    pub fn create_task(
        list_id: String,
        title: String,
        due_on: Option<String>,
    ) -> Result<RemindersResult, String> {
        ensure_access()?;

        let store = reminders_store();
        let calendar = find_calendar(&store, &list_id)?;
        let reminder = unsafe { EKReminder::reminderWithEventStore(&store) };
        let title = ns_string(&title);

        unsafe {
            reminder.setTitle(Some(&title));
            reminder.setCalendar(Some(&calendar));
        }
        set_due_on(&reminder, due_on.as_deref())?;
        save_reminder(&store, &reminder)?;

        Ok(RemindersResult {
            success: Some(true),
            error: None,
            id: Some(unsafe { reminder.calendarItemIdentifier() }.to_string()),
        })
    }
}

#[cfg(target_os = "macos")]
async fn run_reminders_blocking<T, F>(work: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|e| format!("Reminders background task failed: {e}"))?
}

/// Fetch all Reminders lists
#[command]
pub async fn fetch_reminders_lists() -> Result<Vec<RemindersList>, String> {
    #[cfg(not(target_os = "macos"))]
    {
        return Ok(vec![]);
    }

    #[cfg(target_os = "macos")]
    {
        run_reminders_blocking(native_eventkit::fetch_lists).await
    }
}

/// Fetch tasks from a specific Reminders list
#[command]
pub async fn fetch_reminders_tasks(list_id: String) -> Result<Vec<RemindersTask>, String> {
    #[cfg(not(target_os = "macos"))]
    {
        let _ = list_id;
        return Ok(vec![]);
    }

    #[cfg(target_os = "macos")]
    {
        run_reminders_blocking(move || native_eventkit::fetch_tasks(list_id)).await
    }
}

/// Update the completion status of a Reminders task
#[command]
pub async fn update_reminders_status(
    task_id: String,
    completed: bool,
) -> Result<RemindersResult, String> {
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (task_id, completed);
        return Ok(RemindersResult {
            success: Some(false),
            error: Some("Not on macOS".into()),
            id: None,
        });
    }

    #[cfg(target_os = "macos")]
    {
        run_reminders_blocking(move || native_eventkit::update_status(task_id, completed)).await
    }
}

/// Update the title of a Reminders task
#[command]
pub async fn update_reminders_title(
    task_id: String,
    title: String,
) -> Result<RemindersResult, String> {
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (task_id, title);
        return Ok(RemindersResult {
            success: Some(false),
            error: Some("Not on macOS".into()),
            id: None,
        });
    }

    #[cfg(target_os = "macos")]
    {
        run_reminders_blocking(move || native_eventkit::update_title(task_id, title)).await
    }
}

/// Set or clear the due date of a Reminders task ("YYYY-MM-DD", or null)
#[command]
pub async fn update_reminders_due(
    task_id: String,
    due_on: Option<String>,
) -> Result<RemindersResult, String> {
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (task_id, due_on);
        return Ok(RemindersResult {
            success: Some(false),
            error: Some("Not on macOS".into()),
            id: None,
        });
    }

    #[cfg(target_os = "macos")]
    {
        run_reminders_blocking(move || native_eventkit::update_due(task_id, due_on)).await
    }
}

/// Update the notes of a Reminders task
#[command]
pub async fn update_reminders_notes(
    task_id: String,
    notes: String,
) -> Result<RemindersResult, String> {
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (task_id, notes);
        return Ok(RemindersResult {
            success: Some(false),
            error: Some("Not on macOS".into()),
            id: None,
        });
    }

    #[cfg(target_os = "macos")]
    {
        run_reminders_blocking(move || native_eventkit::update_notes(task_id, notes)).await
    }
}

/// Delete a Reminders task
#[command]
pub async fn delete_reminders_task(task_id: String) -> Result<RemindersResult, String> {
    #[cfg(not(target_os = "macos"))]
    {
        let _ = task_id;
        return Ok(RemindersResult {
            success: Some(false),
            error: Some("Not on macOS".into()),
            id: None,
        });
    }

    #[cfg(target_os = "macos")]
    {
        run_reminders_blocking(move || native_eventkit::delete_task(task_id)).await
    }
}

/// Create a new Reminders task
#[command]
pub async fn create_reminders_task(
    list_id: String,
    title: String,
    due_on: Option<String>,
) -> Result<RemindersResult, String> {
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (list_id, title, due_on);
        return Ok(RemindersResult {
            success: Some(false),
            error: Some("Not on macOS".into()),
            id: None,
        });
    }

    #[cfg(target_os = "macos")]
    {
        run_reminders_blocking(move || native_eventkit::create_task(list_id, title, due_on))
            .await
    }
}

/// Open macOS Reminders privacy settings page
#[command]
pub fn open_reminders_privacy_settings() -> Result<(), String> {
    #[cfg(not(target_os = "macos"))]
    return Ok(());

    #[cfg(target_os = "macos")]
    {
        // NSWorkspace instead of spawning `open`: works in sandboxed MAS builds.
        crate::opener::open_external(
            "x-apple.systempreferences:com.apple.preference.security?Privacy_Reminders",
        )
    }
}
