import type { ChatMessage } from "../shared/chat.ts";
import type { TaskView } from "../shared/task-view.ts";

export async function requestReply(messages: ChatMessage[]): Promise<string> {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages }),
  });
  const body: unknown = await response.json();
  if (typeof body === "object" && body !== null) {
    if (response.ok && "reply" in body && typeof body.reply === "string") return body.reply;
    if ("error" in body && typeof body.error === "string") throw new Error(body.error);
  }
  throw new Error("服务暂时不可用。");
}

export async function requestTasks(signal: AbortSignal): Promise<TaskView[]> {
  const response = await fetch("/api/tasks", { signal, cache: "no-store" });
  if (!response.ok) throw new Error("清单加载失败，请刷新重试。");
  return response.json();
}

export async function setTaskDone(id: string, done: boolean): Promise<void> {
  const response = await fetch("/api/tasks/" + encodeURIComponent(id), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ done }),
  });
  if (!response.ok) {
    throw new Error(
      response.status === 404 ? "这项任务已不存在，清单将自动刷新。" : "任务状态更新失败，请重试。",
    );
  }
}
