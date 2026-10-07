"use client";

/*
 * The title bar, the group and list tab rows, and the search row with the people filter.
 *
 * Part of TodoPage's markup, moved out of TodoPage.tsx. Each function takes
 * the page's model (`m`, from useTodoPage) and reads the names it needs
 * from it. The JSX is TodoPage's own, word for word.
 */

import { TodoOfflineStatusPill } from "@/components/todo/TodoOfflineStatusPill";
import { TodoPersonAvatar } from "@/components/todo/TodoPeopleEditor";
import { ViewSwitcher } from "@/components/todo/ViewSwitcher";
import {
  FocusModeIcon,
  HeartIcon,
  ListsIcon,
  PlanViewIcon,
  SettingsGearIcon,
} from "@/components/todo/task-icons";
import {
  renderAllListTab,
  renderGroupTab,
  renderListTab,
} from "@/components/todo/todo-list-chrome";
import type { TodoPageModel } from "@/components/todo/use-todo-page";
import { shortPersonName } from "@/lib/todo/people";
import {
  FOCUS_MODE_KEY,
  persistPref,
} from "@/lib/todo/saved-prefs";
import { toggleId } from "@/lib/todo/task-helpers";

export function renderTitleBar(m: TodoPageModel) {
  const {
    isOffline,
    pendingOpsCount,
    isSyncing,
    syncOfflineOps,
    syncError,
    view,
    setView,
    focusMode,
    setFocusMode,
    setSettingsOpen,
    kanbanEnabled,
    planEnabled,
    t,
  } = m;
  return (
    <div className="title-bar" data-tauri-drag-region="deep">
      <div className="title-bar-toolbar">
        <button
          type="button"
          className={`title-bar-focus-btn${focusMode ? " active" : ""}`}
          title={focusMode ? t("exitFocusMode") : t("focusMode")}
          aria-pressed={focusMode}
          onClick={() => {
            setFocusMode((v) => {
              const next = !v;
              persistPref(FOCUS_MODE_KEY, next ? "1" : "0");
              return next;
            });
          }}
        >
          <FocusModeIcon on={focusMode} />
        </button>
        {/* The board has no favourites view, so it has no switch —
            unless the Planner View is on, which needs a way there and
            back. */}
        {!kanbanEnabled || planEnabled ? (
          <ViewSwitcher
            active={view}
            onSelect={setView}
            items={[
              { id: "lists" as const, title: "Lists View", icon: <ListsIcon /> },
              ...(!kanbanEnabled
                ? [
                    {
                      id: "favourites" as const,
                      title: "Favourites View",
                      icon: <HeartIcon size={16} filled />,
                    },
                  ]
                : []),
              ...(planEnabled
                ? [
                    {
                      id: "plan" as const,
                      title: t("enablePlanMode"),
                      icon: <PlanViewIcon />,
                    },
                  ]
                : []),
            ]}
          />
        ) : null}
        <TodoOfflineStatusPill
          isOffline={isOffline}
          pendingOpsCount={pendingOpsCount}
          isSyncing={isSyncing}
          onRetry={() => void syncOfflineOps()}
          lastError={syncError}
        />
        <button
          className="title-bar-settings-btn"
          title={t("settingsTooltip")}
          onClick={() => setSettingsOpen(true)}
        >
          <SettingsGearIcon />
        </button>
      </div>
    </div>
  );
}

export function renderGroupsRow(m: TodoPageModel) {
  const {
    view,
    focusMode,
    groupsEnabled,
    groupsRowRef,
    groupsForRender,
    openCreateGroupModal,
  } = m;
  return (
    view === "lists" && groupsEnabled && !focusMode ? (
      <div className="groups-container" style={{ display: "flex" }}>
        <div className="groups" ref={groupsRowRef} style={{ display: "flex" }}>
          {groupsForRender.map((group) => renderGroupTab(m, group))}
          <button
            className="add-group-btn"
            title="Add new group"
            onClick={openCreateGroupModal}
          >
            +
          </button>
        </div>
      </div>
    ) : null
  );
}

export function renderTabsRow(m: TodoPageModel) {
  const {
    view,
    focusMode,
    tabsRowRef,
    lists,
    openCreateListModal,
  } = m;
  return (
    view === "lists" && !focusMode ? (
      <div className="tabs-container">
        <div className="tabs" ref={tabsRowRef}>
          {lists.length > 1 ? renderAllListTab(m) : null}
          {lists.map((list) => renderListTab(m, list))}
          <button
            className="add-tab-btn-subtle"
            title="Add new tab"
            onClick={openCreateListModal}
          >
            +
          </button>
        </div>
      </div>
    ) : null
  );
}

export function renderListSearch(m: TodoPageModel) {
  const {
    view,
    assigneeFilterIds,
    setAssigneeFilterIds,
    choosePeopleScope,
    searchRevealed,
    setSearchRevealed,
    searchQuery,
    setSearchQuery,
    setSearchListId,
    searchInputRef,
    listSearchRef,
    draggingPersonId,
    personDragRef,
    filterRowRef,
    suppressPersonClickUntil,
    t,
    revealSearch,
    navigateToList,
    searchGroups,
    selectedSearchGroup,
    otherListSearchHits,
    openTasks,
    assigneeFilterPeople,
    hasMe,
    scope,
    myOpenCount,
  } = m;
  return (
    <div
      id="list-search"
      ref={listSearchRef}
      className={`list-search${
        (view === "favourites" && searchGroups.length > 0) ||
        otherListSearchHits.length > 0
          ? " has-tabs"
          : ""
      }${
        assigneeFilterPeople.length > 0 ? " has-assignee-filter" : ""
      }`}
    >
      <div className="list-search-row">
        {hasMe ? (
          /* Mine or everyone: a two-way switch, and the person pills
             only on "everyone". The everyday view stays quiet. */
          <div
            className="board-people-scope"
            role="group"
            aria-label={t("filterByAssignee")}
          >
            <button
              type="button"
              className={`board-people-scope-btn${scope === "mine" ? " active" : ""}`}
              aria-pressed={scope === "mine"}
              onClick={() => choosePeopleScope("mine")}
            >
              {t("myTasks")}
              <span className="board-people-scope-count">{myOpenCount}</span>
            </button>
            <button
              type="button"
              className={`board-people-scope-btn${scope === "everyone" ? " active" : ""}`}
              aria-pressed={scope === "everyone"}
              onClick={() => choosePeopleScope("everyone")}
            >
              {t("filterEveryone")}
              <span className="board-people-scope-count">{openTasks.length}</span>
            </button>
          </div>
        ) : null}
        {assigneeFilterPeople.length > 0 && (!hasMe || scope === "everyone") ? (
          <div
            className={`board-assignee-filter${hasMe ? " after-scope" : ""}`}
            role="group"
            aria-label={t("filterByAssignee")}
            ref={filterRowRef}
          >
            {hasMe ? null : (
              <button
                type="button"
                className={`board-assignee-filter-btn${
                  assigneeFilterIds.length === 0 ? " active" : ""
                }`}
                onClick={() => setAssigneeFilterIds([])}
              >
                {t("filterEveryone")}
              </button>
            )}
            {assigneeFilterPeople.map((person) => (
              <button
                key={person.id}
                type="button"
                className={`board-assignee-filter-btn${
                  assigneeFilterIds.includes(person.id) ? " active" : ""
                }${draggingPersonId === person.id ? " dragging" : ""}`}
                title={person.name}
                aria-pressed={assigneeFilterIds.includes(person.id)}
                data-person-id={person.id}
                onPointerDown={(e) => {
                  if (e.button !== 0) return;
                  // The chip is the handle, so the guard the tabs use
                  // against dragging by their controls cannot apply.
                  personDragRef.current = {
                    personId: person.id,
                    startX: e.clientX,
                    startY: e.clientY,
                    started: false,
                  };
                }}
                onClick={() => {
                  // A drag ends over a chip and would otherwise also
                  // turn its filter on.
                  if (Date.now() < suppressPersonClickUntil.current) return;
                  setAssigneeFilterIds((ids) => toggleId(ids, person.id));
                }}
              >
                <TodoPersonAvatar
                  name={person.name}
                  colour={person.colour}
                  photoUrl={person.photoUrl}
                  size={22}
                />
                <span>{shortPersonName(person.name)}</span>
              </button>
            ))}
          </div>
        ) : null}
        {/* An icon until it is opened; then a field that takes the
            rest of the row. */}
        <div
          className={`list-search-inner${searchRevealed ? " open" : ""}`}
          onMouseDown={(e) => {
            if (searchRevealed) return;
            e.preventDefault();
            revealSearch();
          }}
        >
          <button
            type="button"
            className="list-search-toggle"
            aria-label={t("listSearchPlaceholder")}
            aria-expanded={searchRevealed}
            tabIndex={searchRevealed ? -1 : 0}
            onClick={() => {
              if (searchRevealed) searchInputRef.current?.focus();
              else revealSearch();
            }}
          >
            <svg className="list-search-icon" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </button>
          <input
            ref={searchInputRef}
            type="text"
            className="list-search-input"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            placeholder={t("listSearchPlaceholder")}
            value={searchQuery}
            tabIndex={searchRevealed ? 0 : -1}
            onFocus={() => setSearchRevealed(true)}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        {m.boardExtension?.renderToolbar({ allTab: m.isAllListsView }) ?? null}
      </div>
      {view === "favourites" && searchGroups.length > 0 ? (
        <div className="list-search-tabs" role="tablist">
          {searchGroups.map((group) => {
            const selected =
              group.list.id === selectedSearchGroup?.list.id;
            return (
              <button
                key={group.list.id}
                type="button"
                className={`list-search-tab ${selected ? "active" : ""}`}
                role="tab"
                aria-selected={selected}
                onClick={() => {
                  setSearchListId(group.list.id);
                  searchInputRef.current?.focus();
                }}
              >
                <span className="list-search-tab-name">
                  {group.list.name}
                </span>
                <span className="list-search-tab-count">
                  {group.tasks.length}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
      {view === "lists" && otherListSearchHits.length > 0 ? (
        <div className="list-search-tabs" role="tablist">
          {otherListSearchHits.map((group) => (
            <button
              key={group.list.id}
              type="button"
              className="list-search-tab"
              role="tab"
              onClick={() => {
                navigateToList(group.list.id);
                setSearchListId(group.list.id);
                searchInputRef.current?.focus();
              }}
            >
              <span className="list-search-tab-name">
                {group.list.name}
              </span>
              <span className="list-search-tab-count">
                {group.tasks.length}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
