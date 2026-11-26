import { useState } from "react";
import { dueStatus, orderPending, shanghaiDate, type TaskView } from "../shared/task-view.ts";

interface TaskOverviewProps {
  tasks: TaskView[] | undefined;
  loading: boolean;
  busy: boolean;
  error: string;
  updatingId: string | undefined;
  onRefresh(): void;
  onToggle(task: TaskView): void;
}

export function TaskOverview({
  tasks,
  loading,
  busy,
  error,
  updatingId,
  onRefresh,
  onToggle,
}: TaskOverviewProps) {
  const [expanded, setExpanded] = useState(() => !window.matchMedia("(max-width: 760px)").matches);
  const [showDone, setShowDone] = useState(false);
  const today = shanghaiDate();
  const pending = orderPending(tasks ?? [], today);
  const completed = tasks?.filter((task) => task.done) ?? [];
  const visible = showDone ? completed : pending;
  const overdue = pending.filter((task) => dueStatus(task, today) === "已逾期").length;
  const dueToday = pending.filter((task) => dueStatus(task, today) === "今天到期").length;

  return (
    <aside className="overview" aria-label="任务面板">
      <button
        type="button"
        className="overview-heading"
        aria-expanded={expanded}
        aria-controls="overview-content"
        onClick={() => setExpanded(!expanded)}
      >
        <span>
          <strong>任务清单</strong>
          {tasks && (
            <small>
              {pending.length} 项待办
              {!expanded && " · " + dueToday + " 项今天到期 · " + overdue + " 项逾期"}
            </small>
          )}
        </span>
        <span className="overview-chevron" aria-hidden="true">
          {expanded ? "−" : "+"}
        </span>
      </button>
      <div id="overview-content" className="overview-content" hidden={!expanded}>
        {tasks && (
          <div className="overview-totals">
            <span>
              <strong>{dueToday}</strong> 今天到期
            </span>
            <span data-overdue={overdue > 0}>
              <strong>{overdue}</strong> 已逾期
            </span>
          </div>
        )}
        <div className="overview-toolbar">
          <div className="overview-filters" role="group" aria-label="任务状态">
            <button type="button" aria-pressed={!showDone} onClick={() => setShowDone(false)}>
              待办
            </button>
            <button type="button" aria-pressed={showDone} onClick={() => setShowDone(true)}>
              已完成{completed.length > 0 && " " + completed.length}
            </button>
          </div>
          <button
            type="button"
            className="overview-refresh"
            onClick={onRefresh}
            disabled={loading || busy}
            aria-label="刷新任务清单"
          >
            刷新
          </button>
        </div>
        {error && (
          <p className="overview-error" role="alert">
            {error}
          </p>
        )}
        {!tasks && loading && (
          <p className="overview-empty" role="status">
            正在加载任务…
          </p>
        )}
        {tasks && visible.length === 0 && (
          <p className="overview-empty">
            {showDone ? "暂无已完成任务。" : "暂无待办。可以在聊天中添加一项。"}
          </p>
        )}
        {visible.length > 0 && (
          <ul
            className="overview-tasks"
            aria-label={showDone ? "已完成任务" : "待办任务"}
            aria-busy={loading}
          >
            {visible.map((task) => {
              const status = dueStatus(task, today);
              const parent = tasks?.find((item) => item.id === task.parentId);
              return (
                <li key={task.id}>
                  <label className="overview-task" data-done={task.done}>
                    <input
                      type="checkbox"
                      checked={task.done}
                      onChange={() => onToggle(task)}
                      disabled={busy || loading}
                      aria-label={(task.done ? "恢复待办 " : "完成 ") + task.title}
                    />
                    <span>
                      <span className="overview-task-title">{task.title}</span>
                      <span className="overview-task-meta">
                        {updatingId === task.id && <span role="status">正在更新…</span>}
                        {status && (
                          <span className="overview-tag" data-overdue={status === "已逾期"}>
                            {status}
                          </span>
                        )}
                        {typeof task.dueDate === "string" && (
                          <time dateTime={task.dueDate}>{task.dueDate}</time>
                        )}
                        {(task.priority === "高" ||
                          task.priority === "中" ||
                          task.priority === "低") && (
                          <span data-priority={task.priority}>{task.priority}优先级</span>
                        )}
                        {parent && <span>子任务 · {parent.title}</span>}
                      </span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}
