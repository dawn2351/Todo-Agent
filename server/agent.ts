import type { ChatMessage } from "../shared/chat.ts";
import { dueStatus, orderPending, shanghaiDate } from "../shared/task-view.ts";
import { dueDate, effort, priority } from "./task-fields.ts";
import { getModelCompletion } from "./model.ts";
import { decideWithModel, phraseResult, recentMessages } from "./model-reply.ts";
import { parseLocal, unquote, type TaskIntent } from "./task-intent.ts";
import type { Task, TaskStore } from "./task-store.ts";

const help =
  "你可以说“帮我记一下买牛奶”“看看我的待办”或“牛奶买好了”。想找一项任务，可以说“搜索 牛奶”。想安排任务，可以问“今天先做什么？”。";

function normalize(value: string): string {
  return unquote(value).normalize("NFKC").toLowerCase().replace(/\s+/g, "");
}

function describe(task: Task, tasks: Task[]): string {
  const parent = tasks.find((item) => item.id === task.parentId);
  const deadline = dueDate.safeParse(task.dueDate);
  const importance = priority.safeParse(task.priority);
  const size = effort.safeParse(task.effort);
  const details = [
    parent && "子任务 · " + parent.title.replace(/\s+/g, " "),
    deadline.success && "截止 " + deadline.data,
    importance.success && "优先级 " + importance.data,
    size.success && "工作量 " + size.data,
  ].filter(Boolean);
  return (
    "「" +
    task.title.replace(/\s+/g, " ") +
    "」" +
    (details.length ? " · " + details.join(" · ") : "")
  );
}

function findTask(tasks: Task[], reference: string): Task | string {
  const key = normalize(reference);
  if (!key) return "请说出要操作的任务名。";
  const exact = tasks.filter((task) => normalize(task.title) === key);
  const matches = key.startsWith("#")
    ? tasks.filter((task) => task.id.toLowerCase().startsWith(key.slice(1)))
    : exact.length
      ? exact
      : tasks.filter((task) => normalize(task.title).includes(key));
  if (matches.length === 1 && key !== "#") return matches[0];
  if (matches.length === 0 || key === "#")
    return "找不到「" + reference + "」。可以先说“看看清单”。";
  const choices = matches
    .slice(0, 8)
    .map((task) => {
      const prefix = task.id.slice(0, 8);
      const id = tasks.some((item) => item.id !== task.id && item.id.startsWith(prefix))
        ? task.id
        : prefix;
      return "• " + describe(task, tasks) + " · " + (task.done ? "已完成" : "待办") + " #" + id;
    })
    .join("\n");
  return (
    "找到 " +
    matches.length +
    " 条符合的任务。请用下面的完整任务名或编号替换原指令里的任务名。\n" +
    choices
  );
}

function formatList(selected: Task[], all: Task[], heading?: string): string {
  const sections = [
    { label: "待办", tasks: selected.filter((task) => !task.done) },
    { label: "已完成", tasks: selected.filter((task) => task.done) },
  ];
  return [
    heading,
    ...sections
      .filter((section) => section.tasks.length > 0)
      .map(({ label, tasks }) =>
        [
          label + "（" + tasks.length + "）",
          ...tasks.map((task) => "• " + describe(task, all)),
        ].join("\n"),
      ),
  ]
    .filter(Boolean)
    .join("\n\n");
}

function executeIntent(tasks: TaskStore, intent: TaskIntent, today: string): string {
  const all = tasks.list();
  if (intent.action === "focus") {
    const pending = orderPending(all, today);
    if (!pending.length) return "目前没有待办任务。";
    const suggestions = pending.slice(0, 3).map((task, index) => {
      const status = dueStatus(task, today);
      return index + 1 + ". " + describe(task, all) + (status ? " · " + status : "");
    });
    const rest = pending.length - suggestions.length;
    return [
      "建议先处理",
      ...suggestions,
      ...(rest ? ["还有 " + rest + " 项待办，可以说“看看清单”。"] : []),
    ].join("\n");
  }
  if (intent.action === "search") {
    const query = normalize(intent.query);
    const matches = query ? all.filter((task) => normalize(task.title).includes(query)) : [];
    return matches.length
      ? formatList(matches, all, "搜索「" + intent.query + "」 · " + matches.length + " 项")
      : "没有找到包含「" + intent.query + "」的任务。可以试试更短的关键词。";
  }
  if (intent.action === "create") {
    const { action: _action, title, parent, ...details } = intent;
    const parentTask = parent === undefined ? undefined : findTask(all, parent);
    if (typeof parentTask === "string") return parentTask;
    const task = tasks.create(title, { ...details, parentId: parentTask?.id });
    if (!task) return "请为子任务选择一条主任务。目前支持一层子任务。";
    return "已添加" + (parentTask ? "子任务" : "待办") + " " + describe(task, all) + "。";
  }

  if (intent.action === "list") {
    const parent = intent.parent === undefined ? undefined : findTask(all, intent.parent);
    if (typeof parent === "string") return parent;
    const list = parent ? all.filter((task) => task.parentId === parent.id) : all;
    const selected = list.filter((task) => {
      switch (intent.filter) {
        case "pending":
          return !task.done;
        case "done":
          return task.done;
        case "today":
          return task.dueDate === today;
        case "overdue":
          return dueStatus(task, today) === "已逾期";
        default:
          return true;
      }
    });
    const label = parent ? "「" + parent.title + "」的子任务" : undefined;
    const heading =
      intent.filter === "today"
        ? "今天到期（" + today + "）"
        : intent.filter === "overdue"
          ? "逾期待办"
          : label;
    if (selected.length) return formatList(selected, all, heading);
    if (intent.filter === "today") return "今天（" + today + "）没有到期的任务。";
    if (intent.filter === "overdue") return "目前没有逾期的待办。";
    if (label) return label + "中暂无符合条件的任务。";
    if (intent.filter === "pending") return "目前没有待办。";
    if (intent.filter === "done") return "目前没有已完成的任务。";
    return "清单还是空的。可以说“帮我记一下买牛奶”。";
  }

  const task = findTask(all, intent.target);
  if (typeof task === "string") return task;
  const display = "「" + task.title + "」";
  if (intent.action === "delete") {
    const hasChildren = all.some((item) => item.parentId === task.id);
    tasks.remove(task.id);
    return "已删除 " + display + "。" + (hasChildren ? "它的子任务已保留在主清单中。" : "");
  }
  if (intent.action === "edit") {
    const { action: _action, target: _target, ...changes } = intent;
    if (Object.keys(changes).length === 0) {
      return "请告诉我新的截止日期、优先级或工作量。";
    }
    const updated = tasks.update(task.id, changes);
    return updated ? "已更新 " + describe(updated, all) + "。" : "这条任务已不存在。";
  }
  const done = intent.action === "complete";
  if (task.done === done) return display + (done ? " 已经完成了。" : " 目前就是待办。");
  tasks.update(task.id, { done });
  return (done ? "已标记完成 " : "已恢复待办 ") + display + "。";
}

export function createReply(tasks: TaskStore) {
  return async (messages: ChatMessage[]): Promise<string> => {
    const latest = messages.at(-1);
    if (!latest) return help;
    if (latest.content.length > 1500) return "请用一条简短的消息说明要操作的任务。";
    const today = shanghaiDate();
    const complete = getModelCompletion();

    if (complete) {
      const decision = await decideWithModel(complete, recentMessages(messages), today);
      if (decision?.action === "reply") return decision.reply;
      if (decision) {
        const result = executeIntent(tasks, decision, today);
        return phraseResult(complete, latest.content, result);
      }
    }

    const intent = parseLocal(latest.content, today);
    if (!intent || typeof intent === "string") return intent ?? help;
    return executeIntent(tasks, intent, today);
  };
}
