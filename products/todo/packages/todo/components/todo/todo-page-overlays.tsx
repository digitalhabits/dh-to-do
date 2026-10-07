"use client";

/*
 * What the page draws over itself: the list and group dialog, the people
 * editor, the question before a delete, Settings, the Today session and the
 * undo note.
 *
 * Part of TodoPage's markup, moved out of TodoPage.tsx. Each function takes
 * the page's model (`m`, from useTodoPage) and reads the names it needs
 * from it. The JSX is TodoPage's own, word for word.
 */

import type { DeletedTodoList } from "@/lib/todo/store";
import { ListAppearancePicker } from "@/components/todo/ListAppearancePicker";
import { TodayFocusSession } from "@/components/todo/TodayFocusSession";
import { TodoPeopleEditor } from "@/components/todo/TodoPeopleEditor";
import { TodoSelect } from "@/components/todo/TodoSelect";
import { TodoSettingsModal } from "@/components/todo/TodoSettingsModal";
import { renderNotesEditor } from "@/components/todo/todo-task-overlay";
import { taskCardChrome } from "@/components/todo/todo-task-card";
import type { TodoPageModel } from "@/components/todo/use-todo-page";
import { queueWithAdded, sessionTasksFromBoard } from "@/lib/todo/session-queue";
import { COLOR_SWATCHES } from "@/lib/todo/tab-colours";
import { type TodoTask } from "@/lib/todo/types";

export function renderListDialog(m: TodoPageModel) {
  const {
    listModal,
    setListModal,
    modalName,
    setModalName,
    modalColour,
    setModalColour,
    modalEmoji,
    setModalEmoji,
    bcProjects,
    bcTodolists,
    remindersLists,
    modalBcProjectId,
    modalBcListId,
    modalRemindersListId,
    importingGroup,
    bcConnected,
    remindersConnected,
    t,
    selectBcProject,
    selectBcList,
    selectRemindersList,
    submitListModal,
  } = m;
  return (
    listModal ? (
      <div
        id="tab-name-modal"
        className="modal-overlay"
        onClick={(e) => {
          if (e.target === e.currentTarget && !importingGroup) setListModal(null);
        }}
      >
        <div className="modal-content">
          <h3>
            {listModal.kind === "group"
              ? listModal.mode === "create"
                ? t("enterGroupName")
                : t("editGroup")
              : listModal.mode === "create"
                ? t("enterListName")
                : t("renameList")}
          </h3>
          <input
            autoFocus
            type="text"
            id="tab-name-input"
            placeholder={listModal.kind === "group" ? "My Group" : "My to-do list"}
            maxLength={50}
            value={modalName}
            disabled={importingGroup}
            onChange={(e) => setModalName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void submitListModal();
              if (e.key === "Escape" && !importingGroup) setListModal(null);
            }}
          />
          {listModal.kind === "list" ? (
            <ListAppearancePicker
              emoji={modalEmoji}
              colour={modalColour}
              onEmojiChange={setModalEmoji}
              onColourChange={setModalColour}
              emojiLabel={t("listEmoji")}
              colourLabel={t("listColour")}
            />
          ) : (
            <div className="tab-color-selection">
              <div className="bc-label">{t("tabColor")}</div>
              <div className="color-swatches">
                <button
                  type="button"
                  className={`color-swatch ${modalColour === "" ? "selected" : ""}`}
                  data-color=""
                  title="None"
                  onClick={() => setModalColour("")}
                />
                {COLOR_SWATCHES.map((swatch) => (
                  <button
                    key={swatch.key}
                    type="button"
                    className={`color-swatch ${modalColour === swatch.key ? "selected" : ""}`}
                    data-color={swatch.key}
                    title={swatch.title}
                    style={{ backgroundColor: swatch.display }}
                    onClick={() => setModalColour(swatch.key)}
                  />
                ))}
                <label
                  className={`color-swatch color-swatch-custom ${
                    modalColour.startsWith("#") ? "selected" : ""
                  }`}
                  data-color="custom"
                  title="Custom color"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <path d="M12 8v8" />
                    <path d="M8 12h8" />
                  </svg>
                  <input
                    type="color"
                    id="custom-color-input"
                    aria-label="Custom tab color"
                    value={
                      modalColour.startsWith("#") ? modalColour : "#2a9d8f"
                    }
                    onChange={(e) => setModalColour(e.target.value)}
                  />
                </label>
              </div>
            </div>
          )}
          {(listModal.kind === "list" ||
            (listModal.kind === "group" && listModal.mode === "create")) &&
          bcConnected ? (
            <div className="basecamp-selection">
              <div className="bc-label">{t("basecampProject")}</div>
              <TodoSelect
                aria-label={t("basecampProject")}
                value={modalBcProjectId}
                disabled={importingGroup}
                placeholder={t("selectBasecampProject")}
                options={bcProjects.map((p) => ({
                  value: p.id,
                  label: p.name,
                }))}
                onChange={(id) => void selectBcProject(id)}
              />
              {listModal.kind === "list" && modalBcProjectId ? (
                <>
                  <div className="bc-label">Basecamp List</div>
                  <TodoSelect
                    aria-label="Basecamp List"
                    value={modalBcListId}
                    placeholder="Select a list..."
                    options={bcTodolists.map((l) => ({
                      value: l.id,
                      label: l.name,
                    }))}
                    onChange={selectBcList}
                  />
                </>
              ) : null}
            </div>
          ) : null}
          {listModal.kind === "list" && remindersConnected ? (
            <div className="basecamp-selection">
              <div className="bc-label">{t("appleReminders")}</div>
              <TodoSelect
                aria-label={t("appleReminders")}
                value={modalRemindersListId}
                placeholder="Select a list..."
                options={remindersLists.map((l) => ({
                  value: l.id,
                  label: l.groupName ? `${l.groupName} — ${l.name}` : l.name,
                }))}
                onChange={selectRemindersList}
              />
            </div>
          ) : null}
          <div className="modal-buttons">
            <button
              className="modal-btn cancel-btn"
              disabled={importingGroup}
              onClick={() => setListModal(null)}
            >
              {t("cancel")}
            </button>
            <button
              className="modal-btn create-btn"
              disabled={importingGroup}
              onClick={() => void submitListModal()}
            >
              {importingGroup
                ? t("importing")
                : listModal.kind === "group" &&
                    listModal.mode === "create" &&
                    modalBcProjectId
                  ? t("importListsFromProject")
                  : listModal.mode === "create"
                    ? listModal.kind === "group"
                      ? t("createGroup")
                      : t("create")
                    : t("save")}
            </button>
          </div>
        </div>
      </div>
    ) : null
  );
}

export function renderPeopleEditor(m: TodoPageModel) {
  const {
    state,
    markMe,
    peopleEditorOpen,
    setPeopleEditorOpen,
    standalone,
    t,
    mePersonIds,
    searchPeopleCandidates,
    addBoardPerson,
    setPersonPhoto,
    removeBoardPerson,
  } = m;
  return (
    <TodoPeopleEditor
      open={peopleEditorOpen}
      people={state.people}
      t={t}
      onClose={() => setPeopleEditorOpen(false)}
      onAdd={addBoardPerson}
      onRemove={removeBoardPerson}
      onSearch={searchPeopleCandidates}
      onSetPhoto={setPersonPhoto}
      meIds={mePersonIds}
      // In the planner the login says who the reader is.
      onSetMe={standalone ? markMe : undefined}
    />
  );
}

export function renderConfirmDialog(m: TodoPageModel) {
  const {
    confirmModal,
    setConfirmModal,
    t,
  } = m;
  return (
    confirmModal ? (
      <div
        className="modal-overlay"
        onClick={(e) => {
          if (e.target === e.currentTarget) setConfirmModal(null);
        }}
      >
        <div className="modal-content">
          <h3>{confirmModal.title}</h3>
          <p className="settings-desc" style={{ marginBottom: 20, lineHeight: 1.5 }}>
            {confirmModal.message}
          </p>
          <div className="modal-buttons">
            <button className="modal-btn cancel-btn" onClick={() => setConfirmModal(null)}>
              {t("cancel")}
            </button>
            <button
              className={`modal-btn ${confirmModal.danger ? "delete-confirm-btn" : "create-btn"}`}
              onClick={() => {
                const action = confirmModal.onConfirm;
                setConfirmModal(null);
                action();
              }}
            >
              {confirmModal.confirmLabel}
            </button>
          </div>
        </div>
      </div>
    ) : null
  );
}

export function renderSettings(m: TodoPageModel) {
  const {
    appVersion,
    somedayEnabled,
    assignEnabled,
    focusTimerAlways,
    settingsOpen,
    setSettingsOpen,
    kanbanEnabled,
    planEnabled,
    groupsEnabled,
    lang,
    theme,
    zoom,
    t,
    handleGroupsEnabledChange,
    exportData,
    importData,
    changeLang,
    changeTheme,
    changeZoom,
    changeKanbanEnabled,
    changeSomedayEnabled,
    changeAssignEnabled,
    changeFocusTimerAlways,
    changePlanEnabled,
  } = m;
  return (
    settingsOpen ? (
      <TodoSettingsModal
        t={t}
        lang={lang}
        onLangChange={changeLang}
        theme={theme}
        onThemeChange={changeTheme}
        zoom={zoom}
        onZoomChange={changeZoom}
        onExport={exportData}
        onImport={importData}
        onClose={() => setSettingsOpen(false)}
        appVersion={appVersion}
        kanbanEnabled={kanbanEnabled}
        onKanbanEnabledChange={changeKanbanEnabled}
        somedayEnabled={somedayEnabled}
        onSomedayEnabledChange={changeSomedayEnabled}
        assignEnabled={assignEnabled}
        onAssignEnabledChange={changeAssignEnabled}
        focusTimerAlways={focusTimerAlways}
        onFocusTimerAlwaysChange={changeFocusTimerAlways}
        groupsEnabled={groupsEnabled}
        onGroupsEnabledChange={handleGroupsEnabledChange}
        planEnabled={planEnabled}
        onPlanEnabledChange={changePlanEnabled}
        loadDeletedLists={async () =>
          ((await m.api("/api/todo/lists/deleted", "GET")) as { lists: DeletedTodoList[] }).lists
        }
        onRestoreList={async (id) => {
          await m.api("/api/todo/lists/deleted", "POST", { id });
          await m.refresh();
        }}
      />
    ) : null
  );
}

export function renderTodaySession(m: TodoPageModel) {
  const {
    state,
    focusTimerAlways,
    sessionIds,
    setSessionIds,
    t,
    mutateTask,
    uncompleteSessionTask,
    skipSessionTask,
    reorderSessionTasks,
    addSessionTask,
    boardColumns,
    toggleNotes,
    subtasksByTask,
    toggleSubtaskDone,
  } = m;
  return (
    sessionIds ? (
      <TodayFocusSession
        tasks={sessionTasksFromBoard(sessionIds, boardColumns.today, state.tasks)}
        t={t}
        timerAlways={focusTimerAlways}
        subtasksOf={(taskId) => subtasksByTask.get(taskId) ?? []}
        renderChrome={(task) => taskCardChrome(m, task, "session")}
        handlers={{
          onComplete: (task) => {
            void mutateTask(task.id, { completed: true });
            // A task that came into Today during the session is in the
            // queue too, so it shows with the finished ones.
            setSessionIds((ids) => (ids?.includes(task.id) ? ids : queueWithAdded(ids, task.id)));
          },
          onUncomplete: uncompleteSessionTask,
          onToggleNotes: toggleNotes,
          renderNotes: (task: TodoTask) => renderNotesEditor(m, task),
          onSetDuration: (task, minutes) =>
            void mutateTask(task.id, { expectedDurationMinutes: minutes }),
          onSkip: skipSessionTask,
          onReorder: reorderSessionTasks,
          onAddTask: (text, durationMinutes) =>
            void addSessionTask(text, durationMinutes),
          onPersistTime: (taskId, totalSeconds) =>
            void mutateTask(taskId, { timeSpentSeconds: totalSeconds }),
          onEditText: (task, text) => void mutateTask(task.id, { text }),
          onToggleSubtask: toggleSubtaskDone,
          onExit: () => setSessionIds(null),
        }}
      />
    ) : null
  );
}

export function renderUndoNote(m: TodoPageModel) {
  const {
    undoState,
    setUndoState,
    lastUndoRef,
    t,
  } = m;
  return (
    undoState ? (
      <div className="undo-toast">
        <span>{undoState.message}</span>
        <button
          className="undo-btn"
          onClick={() => {
            const restore = undoState.restore;
            lastUndoRef.current = null;
            setUndoState(null);
            restore();
          }}
        >
          {t("undo")}
        </button>
        <button className="close-undo-btn" onClick={() => setUndoState(null)}>
          ×
        </button>
      </div>
    ) : null
  );
}
