import { z } from "zod";
import { dueDate, effort, priority, taskDetails, title } from "./task-fields.ts";

const reference = z.string().trim().min(1).max(200);
const filter = z.enum(["all", "pending", "done", "today", "overdue"]);
export const intentSchema = z.discriminatedUnion("action", [
  taskDetails.extend({ action: z.literal("create"), title, parent: reference.optional() }),
  z.strictObject({ action: z.literal("list"), filter, parent: reference.optional() }),
  z.strictObject({ action: z.literal("focus") }),
  z.strictObject({ action: z.literal("search"), query: reference }),
  z.strictObject({ action: z.literal("complete"), target: reference }),
  z.strictObject({ action: z.literal("reopen"), target: reference }),
  z.strictObject({ action: z.literal("delete"), target: reference }),
  taskDetails.extend({ action: z.literal("edit"), target: reference }),
]);

export type TaskIntent = z.infer<typeof intentSchema>;

export function unquote(value: string): string {
  return value
    .trim()
    .replace(/^「([\s\S]*)」$|^“([\s\S]*)”$|^"([\s\S]*)"$/, "$1$2$3")
    .trim();
}

const relativeDates = ["今天", "明天", "后天"];

function calendarDate(value: string, today: string): string {
  const offset = relativeDates.indexOf(value.trim());
  if (offset === -1) return value.trim();
  const date = new Date(today + "T00:00:00Z");
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function parseCreate(rawTitle: string, today: string, parent?: string): TaskIntent | string {
  const fields: z.infer<typeof taskDetails> = {};
  // 属性可以通过逗号追加。未识别的逗号内容继续作为标题的一部分。
  const quotedTitle = /^(?:「[^」]*」|“[^”]*”|"[^"]*")(?=\s*(?:[，,]|$))/.exec(rawTitle);
  const [first, ...parts] = rawTitle.slice(quotedTitle?.[0].length ?? 0).split(/[，,]/);
  let taskTitle = quotedTitle?.[0] ?? first;
  for (const part of parts) {
    const value = part.trim();
    const deadline = /^(?:截止(?:日期)?(?:是|为|[：:])?\s*(.+)|(.+?)到期)$/.exec(value);
    const importance = /^(?:优先级(?:是|为|[：:])?\s*(.*)|([高中低])优先级)$/.exec(value);
    const size = /^工作量(?:是|为|[：:])?\s*(.*)$/.exec(value);
    if (deadline) {
      const parsed = dueDate.safeParse(calendarDate((deadline[1] ?? deadline[2]).trim(), today));
      if (!parsed.success) return "请用有效的截止日期，例如“明天”或“2027-01-15”。";
      fields.dueDate = parsed.data;
    } else if (importance) {
      const parsed = priority.safeParse(importance[1] ?? importance[2]);
      if (!parsed.success) return "优先级可以设为高、中或低。";
      fields.priority = parsed.data;
    } else if (size) {
      const parsed = effort.safeParse(size[1]);
      if (!parsed.success) return "工作量可以设为小、中或大。";
      fields.effort = parsed.data;
    } else {
      taskTitle += "，" + part;
    }
  }
  const datedTitle = /^(今天|明天|后天)(?:要|前)?\s*(.+)$/.exec(taskTitle);
  if (datedTitle && !fields.dueDate) {
    fields.dueDate = calendarDate(datedTitle[1], today);
    taskTitle = datedTitle[2];
  }
  const parsed = title.safeParse(unquote(taskTitle));
  if (!parsed.success) return "请告诉我任务内容，标题需要 1 至 200 个字符。";
  return { action: "create", title: parsed.data, parent, ...fields };
}

export function parseLocal(message: string, today: string): TaskIntent | string | undefined {
  const text = message
    .trim()
    .replace(/[。！？!?]+$/, "")
    .trim();
  const command = text.replace(/^(?:(?:请|麻烦|帮我|给我|再)\s*)+/u, "");
  if (
    /^(?:先\s*)?(?:不要|别|不用|不必|暂不)/.test(command) ||
    /^把.+(?:别|不要|不用)(?:删|移除|标|勾)/.test(command)
  ) {
    return "好的。你可以随时让我查看清单。";
  }
  if (/[，,；;。]\s*(?:然后|接着|并且|再)\s*(?:帮我|把|删除|完成|添加|新建|记)/.test(text)) {
    return "请把这些操作分开说，我可以逐条处理。";
  }

  if (/^(?:你好|您好|嗨|哈喽)$/.test(command)) {
    return "你好，我是小明。可以帮你记录待办，也可以一起看看今天先做什么。";
  }
  if (/^(?:谢谢(?:你|小明)?|感谢(?:你|小明)?|辛苦了)$/.test(command)) {
    return "不客气！有新任务随时告诉我。";
  }
  if (
    /^(?:(?:我)?(?:今天|现在)?(?:该|应该)?先做(?:什么|哪(?:一)?个|哪(?:一)?件)(?:好|呢)?|今日重点|推荐下一步)$/.test(
      command,
    )
  ) {
    return { action: "focus" };
  }
  if (
    /^(?:(?:查看|看看|列出)(?:所有)?(?:已经)?(?:逾期|超期)(?:的)?(?:任务|待办)?|(?:我)?(?:有|还有)(?:哪些|什么)(?:已经)?(?:逾期|超期)(?:的)?(?:任务|待办)|(?:哪些|什么)(?:任务|待办)(?:已经)?(?:逾期|超期)(?:了)?)(?:呢|吗)?$/.test(
      command,
    )
  ) {
    return { action: "list", filter: "overdue" };
  }
  const search = /^(?:搜索|查找|找一下)\s*[：:]?\s*(.*)$/.exec(command);
  if (search) {
    const parsed = reference.safeParse(unquote(search[1]));
    return parsed.success
      ? { action: "search", query: parsed.data }
      : "请告诉我关键词，例如“搜索 报告”。";
  }

  const childList = /^(?:查看|看看|列出)\s*(.+?)的子任务$|^(.+?)有哪些子任务$/.exec(command);
  if (childList)
    return { action: "list", filter: "all", parent: unquote(childList[1] ?? childList[2]) };
  if (
    /^(?:今天(?:有|还|哪).*(?:到期|截止)(?:吗|呢)?|(?:查看|列出|看看)?今天(?:到期|截止)的(?:任务|待办))$/.test(
      command,
    )
  ) {
    return { action: "list", filter: "today" };
  }
  const statusList =
    /^(?:查看|看看|列出)\s*(?:(?:我的|所有)\s*)?(未完成|已完成|已办)(?:的)?(?:任务|待办)?$/.exec(
      command,
    );
  if (statusList)
    return { action: "list", filter: statusList[1] === "未完成" ? "pending" : "done" };
  if (
    /^(?:(?:看看|查看|列出|显示|看一下|看下)\s*)?(?:我(?:的|有(?:哪些|什么))?\s*)?(?:所有|全部)?(?:待办(?:清单|事项|任务)?|任务(?:清单|列表)?|清单)(?:有(?:哪些|什么))?(?:吧|吗|呢)?$/.test(
      command,
    ) ||
    /^(?:今天)?(?:我)?(?:还)?有(?:哪些|什么)(?:待办|任务)$/.test(command)
  ) {
    return { action: "list", filter: "all" };
  }

  const child =
    /^(?:给|在)\s*(.+?)(?:下面|下)?\s*(?:加|添加|新增|创建)(?:一(?:条|个))?\s*子任务\s*[：:]?\s*(.*)$/.exec(
      command,
    );
  if (child) return parseCreate(child[2], today, unquote(child[1]));
  const create =
    /^(?:先\s*)?(?:记(?:一下|下|个)?|提醒我|添加|新增|新建|创建|加)\s*(?:一条|一个)?(?:待办(?:事项)?|任务)?\s*[：:]?\s*([\s\S]*)$/.exec(
      command,
    );
  if (create) return parseCreate(create[1], today);

  const fieldEdit =
    /^把\s*(.+?)的(优先级|工作量|截止日期|截止时间)\s*(?:设(?:置)?为|改成|改为|调为)\s*(.+)$/.exec(
      command,
    );
  if (fieldEdit) {
    const [, target, field, value] = fieldEdit;
    const change = {
      优先级: { priority: value },
      工作量: { effort: value },
      截止日期: { dueDate: calendarDate(value, today) },
      截止时间: { dueDate: calendarDate(value, today) },
    }[field];
    const parsed = taskDetails.safeParse(change);
    if (!parsed.success)
      return "请提供有效属性：优先级为高、中、低，工作量为小、中、大，截止日期可用“明天”或“2027-01-15”。";
    return { action: "edit", target: unquote(target), ...parsed.data };
  }

  const reopen =
    /^(?:重新打开|恢复待办|取消完成)\s*(.+)$|^把\s*(.+?)\s*(?:改回|恢复为|标为)(?:待办|未完成)$/.exec(
      command,
    );
  if (reopen) return { action: "reopen", target: unquote(reopen[1] ?? reopen[2]) };
  const remove =
    /^(?:删掉|删除|移除)\s*(.+?)$|^(?:把\s*)?(.+?)\s*(?:这条(?:任务)?|这个任务)?(?:删掉|删除|移除)(?:吧|了)?$/.exec(
      command,
    );
  if (remove) return { action: "delete", target: unquote(remove[1] ?? remove[2]) };
  const complete =
    /^(?:完成|勾掉|勾选)\s*(.+?)$|^(?:把\s*)?(.+?)\s*(?:这条(?:任务)?|这个任务)?\s*(?:标(?:记)?(?:为|成)?(?:已)?完成|已经?完成了|完成了|做完了|做好了|搞定了|(?:已经)?[买取交寄付缴办订](?:好|完)了)(?:吧)?$/.exec(
      command,
    );
  if (complete) return { action: "complete", target: unquote(complete[1] ?? complete[2]) };
}
