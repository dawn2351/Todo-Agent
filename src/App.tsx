import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { ChatMessage } from "../shared/chat.ts";
import type { TaskView } from "../shared/task-view.ts";
import { requestReply, requestTasks, setTaskDone } from "./chat-client.ts";
import { ChatHistory } from "./ChatHistory.tsx";
import { TaskOverview } from "./TaskOverview.tsx";

const quickPrompts = [
  { label: "今天先做什么", message: "今天先做什么？" },
  { label: "看看逾期", message: "有哪些逾期任务？" },
];

function isSendShortcut(event: KeyboardEvent<HTMLTextAreaElement>) {
  // 中文输入法会用 Enter 确认选词，部分浏览器此时只报告键码 229。
  const composing = event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229;
  return event.key === "Enter" && !event.shiftKey && !composing;
}

export default function App() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [tasks, setTasks] = useState<TaskView[]>();
  const [taskVersion, setTaskVersion] = useState(0);
  const [loadingTasks, setLoadingTasks] = useState(true);
  const [taskLoadError, setTaskLoadError] = useState("");
  const [taskUpdateError, setTaskUpdateError] = useState("");
  const [updatingId, setUpdatingId] = useState<string>();
  const input = useRef<HTMLTextAreaElement>(null);
  const busy = pending || updatingId !== undefined;

  useEffect(() => {
    const controller = new AbortController();
    setLoadingTasks(true);
    setTaskLoadError("");
    void requestTasks(controller.signal)
      .then((list) => {
        if (!controller.signal.aborted) setTasks(list);
      })
      .catch(() => {
        if (!controller.signal.aborted) setTaskLoadError("清单加载失败，请刷新重试。");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingTasks(false);
      });
    return () => controller.abort();
  }, [taskVersion]);

  function refreshTasks() {
    setLoadingTasks(true);
    setTaskVersion((version) => version + 1);
  }

  async function toggleTask(task: TaskView) {
    if (busy || loadingTasks) return;
    setUpdatingId(task.id);
    setTaskUpdateError("");
    try {
      await setTaskDone(task.id, !task.done);
    } catch (cause) {
      setTaskUpdateError(
        cause instanceof Error && cause.name !== "TypeError"
          ? cause.message
          : "任务状态更新失败，请重试。",
      );
    } finally {
      refreshTasks();
      setUpdatingId(undefined);
    }
  }

  async function send(text: string, fromDraft = true) {
    const content = text.trim();
    if (!content || busy) return;
    const outgoing: ChatMessage[] = [...messages, { role: "user", content }];
    setMessages(outgoing);
    if (fromDraft) setDraft("");
    setPending(true);
    setError("");
    setTaskUpdateError("");
    try {
      const answer = await requestReply(outgoing);
      setMessages([...outgoing, { role: "assistant", content: answer }]);
    } catch (cause) {
      setMessages(messages);
      if (fromDraft) setDraft(text);
      setError(cause instanceof Error ? `发送失败：${cause.message}` : "发送失败，请重试。");
    } finally {
      refreshTasks();
      setPending(false);
      requestAnimationFrame(() => input.current?.focus());
    }
  }

  return (
    <div className="app">
      <header>
        <img src="/logo.png" alt="" />
        <strong>TokeNow</strong>
        <span>小明智能体</span>
      </header>
      <main className="workbench">
        <section className="chat-pane" aria-label="待办聊天">
          <ChatHistory
            messages={messages}
            pending={pending}
            disabled={busy}
            onSelectPrompt={(prompt) => void send(prompt, false)}
          />
          <div className="compose">
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            {messages.length > 0 && (
              <div className="chat-shortcuts" role="group" aria-label="快捷指令">
                {quickPrompts.map(({ label, message }) => (
                  <button
                    type="button"
                    key={message}
                    onClick={() => void send(message, false)}
                    disabled={busy}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void send(draft);
              }}
            >
              <textarea
                aria-label="消息"
                ref={input}
                placeholder="记下一项任务，或问今天先做什么…"
                rows={2}
                value={draft}
                readOnly={busy}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (isSendShortcut(event)) {
                    event.preventDefault();
                    void send(draft);
                  }
                }}
              />
              <button className="send" disabled={busy || !draft.trim()} aria-label="发送消息">
                ↑
              </button>
            </form>
            <small>Enter 发送 · Shift + Enter 换行</small>
          </div>
        </section>
        <TaskOverview
          tasks={tasks}
          loading={loadingTasks}
          busy={busy}
          error={taskLoadError || taskUpdateError}
          updatingId={updatingId}
          onRefresh={() => {
            setTaskUpdateError("");
            refreshTasks();
          }}
          onToggle={(task) => void toggleTask(task)}
        />
      </main>
    </div>
  );
}
