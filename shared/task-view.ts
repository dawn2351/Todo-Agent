export interface TaskView {
  id: string;
  title: string;
  done: boolean;
  dueDate?: unknown;
  priority?: unknown;
  effort?: unknown;
  parentId?: unknown;
}

const shanghaiCalendar = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai" });

export function shanghaiDate(): string {
  return shanghaiCalendar.format(new Date());
}

function deadline(task: TaskView): string | undefined {
  if (typeof task.dueDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(task.dueDate)) {
    return task.dueDate;
  }
}

export function dueStatus(task: TaskView, today: string): "已逾期" | "今天到期" | undefined {
  const date = deadline(task);
  if (task.done || !date || date > today) return undefined;
  return date < today ? "已逾期" : "今天到期";
}

function priorityOrder(task: TaskView): number {
  return task.priority === "高" ? 0 : task.priority === "中" ? 1 : task.priority === "低" ? 2 : 3;
}

export function orderPending<T extends TaskView>(tasks: T[], today: string): T[] {
  const urgency = (task: T) => {
    const status = dueStatus(task, today);
    return status === "已逾期" ? 0 : status === "今天到期" ? 1 : 2;
  };
  return tasks
    .filter((task) => !task.done)
    .sort(
      (first, second) =>
        urgency(first) - urgency(second) ||
        priorityOrder(first) - priorityOrder(second) ||
        (deadline(first) ?? "9999-12-31").localeCompare(deadline(second) ?? "9999-12-31"),
    );
}
