import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test, type TestContext } from "node:test";
import type { ChatMessage } from "../shared/chat.ts";
import { createReply } from "./agent.ts";
import { createApp } from "./app.ts";
import { createJsonTaskStore } from "./task-store.ts";

const originalKey = process.env.DEEPSEEK_API_KEY;
beforeEach(() => {
  delete process.env.DEEPSEEK_API_KEY;
});
afterEach(() => {
  if (originalKey === undefined) delete process.env.DEEPSEEK_API_KEY;
  else process.env.DEEPSEEK_API_KEY = originalKey;
});

async function startTestApp(t: TestContext, useAgent = false) {
  const directory = await mkdtemp(join(tmpdir(), "todo-agent-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filename = join(directory, "tasks.json");
  const conversations: ChatMessage[][] = [];
  const tasks = createJsonTaskStore(filename);
  const app = createApp({
    tasks,
    reply: useAgent
      ? createReply(tasks)
      : async (messages) => {
          conversations.push(messages);
          return "收到";
        },
  });

  const server = app.listen(0, "127.0.0.1");
  t.after(() => server[Symbol.asyncDispose]());
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;

  async function request(method: string, path: string, body?: unknown) {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return {
      status: response.status,
      body: response.status === 204 ? null : await response.json(),
    };
  }

  async function chat(content: string) {
    const messages: ChatMessage[] = [...(conversations.at(-1) ?? []), { role: "user", content }];
    const result = await request("POST", "/api/chat", { messages });
    assert.equal(result.status, 200);
    const reply: string = result.body.reply;
    conversations.push([...messages, { role: "assistant", content: reply }]);
    return reply;
  }

  return { request, conversations, filename, chat };
}

test("任务 API 可以创建、列出、修改和删除任务", async (t) => {
  const { request } = await startTestApp(t);
  const collection = "/api/tasks";
  assert.deepEqual(await request("GET", collection), { status: 200, body: [] });

  const created = await request("POST", collection, { title: " 买牛奶 " });
  assert.equal(created.status, 201);
  const task = created.body;
  assert.equal(typeof task.id, "string");
  assert.deepEqual(task, { id: task.id, title: "买牛奶", done: false });

  const item = collection + "/" + task.id;
  const completed = await request("PATCH", item, { done: true });
  assert.deepEqual(completed, { status: 200, body: { ...task, done: true } });
  const renamed = await request("PATCH", item, { title: "买面包" });
  assert.deepEqual(renamed, { status: 200, body: { ...task, title: "买面包", done: true } });
  assert.deepEqual((await request("GET", collection)).body, [renamed.body]);

  assert.deepEqual(await request("DELETE", item), { status: 204, body: null });
  assert.deepEqual((await request("GET", collection)).body, []);
});

test("任务 API 拒绝无效输入并区分不存在的任务", async (t) => {
  const { request } = await startTestApp(t);
  assert.equal((await request("POST", "/api/tasks", { title: " " })).status, 400);
  assert.equal((await request("PATCH", "/api/tasks/missing", {})).status, 400);
  assert.equal((await request("PATCH", "/api/tasks/missing", { done: true })).status, 404);
  assert.equal((await request("DELETE", "/api/tasks/missing")).status, 404);
});

test("更新已有 JSON 清单时保留其他任务和扩展字段", async (t) => {
  const { request, filename } = await startTestApp(t);
  const first = { id: "a", title: "买牛奶", done: false, priority: 1 };
  const second = { id: "b", title: "取快递", done: false };
  await writeFile(filename, JSON.stringify([first, second]));

  assert.equal((await request("PATCH", "/api/tasks/a", { done: true })).status, 200);
  assert.deepEqual(createJsonTaskStore(filename).list(), [{ ...first, done: true }, second]);
});

test("聊天 API 只将有效的完整对话传给智能体，并返回其回复", async (t) => {
  const { request, conversations } = await startTestApp(t);
  const messages = [
    { role: "user", content: "你好" },
    { role: "assistant", content: "你好！" },
    { role: "user", content: "今天有哪些待办？" },
  ];
  const valid = await request("POST", "/api/chat", { messages });
  assert.deepEqual(valid, { status: 200, body: { reply: "收到" } });

  const invalid = await request("POST", "/api/chat", { messages: messages.slice(0, 2) });
  assert.equal(invalid.status, 400);
  assert.deepEqual(conversations, [messages]);
});

test("README 的六轮对话更新同一份清单，重新加载后保留状态", async (t) => {
  const { chat, filename, request } = await startTestApp(t, true);
  assert.match(await chat("帮我记一下买牛奶"), /已添加待办.*买牛奶/);
  assert.match(await chat("再记一条取快递"), /已添加待办.*取快递/);
  assert.match(await chat("我有哪些任务？"), /待办（2）[\s\S]*买牛奶[\s\S]*取快递/);
  assert.match(await chat("牛奶买好了"), /已标记完成.*买牛奶/);
  const { body: tasks } = await request("GET", "/api/tasks");
  assert.deepEqual(
    tasks.map(({ title, done }: { title: string; done: boolean }) => [title, done]),
    [
      ["买牛奶", true],
      ["取快递", false],
    ],
  );
  assert.match(await chat("取快递这条删掉吧"), /已删除.*取快递/);
  const list = await chat("再给我看看清单");
  assert.match(list, /已完成（1）[\s\S]*买牛奶/);
  assert.doesNotMatch(list, /取快递/);
  const reloadedReply = createReply(createJsonTaskStore(filename));
  assert.equal(await reloadedReply([{ role: "user", content: "查看清单" }]), list);
});

test("同名任务要求指定编号，否定指令、重复完成和查无任务给出明确反馈", async (t) => {
  const { chat, request } = await startTestApp(t, true);
  assert.match(await chat("查看清单"), /空/);
  assert.match(await chat("记一下"), /标题/);
  assert.match(await chat("添加待办：「」"), /标题/);
  await chat("新建任务：周报");
  await chat("添加任务：周报");
  const { body: tasks } = await request("GET", "/api/tasks");
  const clarification = await chat("删除周报");
  assert.match(clarification, /找到 2 条/);
  assert.match(clarification, /待办 #[a-f0-9]{8}(?:\n|$)/);
  assert.match(await chat("把周报别删掉"), /好的/);
  assert.deepEqual((await request("GET", "/api/tasks")).body, tasks);
  assert.match(await chat("完成 #" + tasks[0].id.slice(0, 8)), /已标记完成/);
  assert.match(await chat("完成 #" + tasks[0].id), /已经完成了/);
  assert.match(await chat("重新打开 #" + tasks[0].id), /已恢复待办/);
  assert.match(await chat("删除不存在的任务"), /找不到/);
  assert.deepEqual((await request("GET", "/api/tasks")).body, tasks);
});

test("支持到期筛选、任务属性与子任务，删除主任务时保留子任务", async (t) => {
  const { chat, request } = await startTestApp(t, true);
  const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai" }).format(new Date());
  assert.match(
    await chat("添加待办：准备面试，今天到期，优先级高，工作量大"),
    /优先级 高 · 工作量 大/,
  );
  assert.match(await chat("给「准备面试」添加子任务「练自我介绍」"), /已添加子任务/);
  assert.match(await chat("查看准备面试的子任务"), /待办（1）[\s\S]*练自我介绍/);
  assert.match(await chat("给练自我介绍添加子任务计时"), /一层子任务/);
  assert.match(await chat("把准备面试的工作量改成中"), /工作量 中/);
  assert.match(await chat("完成练自我介绍"), /已标记完成/);
  assert.match(await chat("添加任务：交报告，截止2027-02-30"), /请用有效的截止日期/);
  assert.match(await chat("把准备面试的截止日期改成constructor"), /请提供有效属性/);
  const due = await chat("今天有哪些任务到期？");
  assert.match(due, /今天到期[\s\S]*准备面试/);
  assert.doesNotMatch(due, /练自我介绍/);
  const { body: tasks } = await request("GET", "/api/tasks");
  assert.equal(tasks[0].dueDate, today);
  assert.equal(tasks[1].parentId, tasks[0].id);
  assert.match(await chat("删除准备面试"), /子任务已保留/);
  assert.deepEqual((await request("GET", "/api/tasks")).body, [
    { id: tasks[1].id, title: "练自我介绍", done: true },
  ]);
  assert.match(await chat("今天有哪些任务到期？"), /没有到期/);
});

async function startModelTest(t: TestContext, ...contents: string[]) {
  const directory = await mkdtemp(join(tmpdir(), "todo-agent-model-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const tasks = createJsonTaskStore(join(directory, "tasks.json"));
  process.env.DEEPSEEK_API_KEY = "test-key";
  const requests: {
    url: string;
    body: {
      thinking?: { type: string };
      response_format?: { type: string };
      messages: { role: string; content: string }[];
    };
  }[] = [];
  t.mock.method(globalThis, "fetch", async (url: string | URL | Request, options?: RequestInit) => {
    const content = contents[requests.length];
    requests.push({ url: String(url), body: JSON.parse(String(options?.body)) });
    assert.notEqual(content, undefined, "出现了额外的模型调用");
    return Response.json({ choices: [{ finish_reason: "stop", message: { content } }] });
  });
  return { tasks, reply: createReply(tasks), requests };
}

test("配置 DeepSeek 后先理解意图，再根据实际任务结果回复并保留上下文", async (t) => {
  const { tasks, reply, requests } = await startModelTest(
    t,
    '{"action":"create","title":"给阿姨打电话","priority":"中"}',
    "这件事可以放心交给清单了。\n{{TASK_RESULT}}",
    '{"action":"complete","target":"给阿姨打电话"}',
    "{{TASK_RESULT}}\n电话打完就清爽多了。",
  );
  const first = { role: "user", content: "帮我记一下给阿姨打电话" } as const;
  const answer = await reply([first]);
  assert.match(answer, /^这件事可以放心交给清单了。[\s\S]*已添加待办.*给阿姨打电话/);
  assert.doesNotMatch(answer, /\{\{TASK_RESULT\}\}/);
  assert.deepEqual(
    tasks.list().map(({ title, done, priority }) => ({ title, done, priority })),
    [{ title: "给阿姨打电话", done: false, priority: "中" }],
  );
  assert.equal(requests[0].url, "https://api.deepseek.com/chat/completions");
  assert.deepEqual(requests[0].body.response_format, { type: "json_object" });
  assert.deepEqual(requests[0].body.thinking, { type: "disabled" });
  assert.deepEqual(requests[0].body.messages.at(-1), first);
  const wording = requests[1].body.messages.map(({ content }) => content).join("\n");
  assert.match(wording, /\{\{TASK_RESULT\}\}/);
  assert.match(wording, /已添加待办.*给阿姨打电话/);

  const last = { role: "user", content: "刚才那件事我已经办完了" } as const;
  const followup = await reply([first, { role: "assistant", content: answer }, last]);
  assert.match(followup, /已标记完成.*给阿姨打电话/);
  assert.match(followup, /电话打完就清爽多了。$/);
  assert.deepEqual(requests[2].body.messages.slice(-3), [
    first,
    { role: "assistant", content: answer },
    last,
  ]);
  assert.equal(tasks.list().length, 1);
  assert.equal(tasks.list()[0].done, true);
  assert.equal(requests.length, 4);
});

test("模型直接追问时不执行本地操作", async (t) => {
  const { tasks, reply, requests } = await startModelTest(
    t,
    '{"action":"reply","reply":"要删的是整项周报任务，还是其中一个子任务？"}',
  );
  tasks.create("周报");
  const saved = tasks.list();
  assert.equal(
    await reply([{ role: "user", content: "删除周报" }]),
    "要删的是整项周报任务，还是其中一个子任务？",
  );
  assert.deepEqual(tasks.list(), saved);
  assert.equal(requests.length, 1);
});

test("无效模型操作使用本地降级，润色失败时保留已执行结果", async (t) => {
  const { tasks, reply, requests } = await startModelTest(
    t,
    '{"action":"delete","target":"买牛奶","extra":true}',
    '{"action":"create","title":"给阿姨打电话"}',
    "都完成了。",
  );
  tasks.create("买牛奶");
  const saved = tasks.list();
  assert.match(await reply([{ role: "user", content: "看看清单" }]), /买牛奶/);
  assert.deepEqual(tasks.list(), saved);
  assert.equal(requests.length, 1);
  assert.match(
    await reply([{ role: "user", content: "我怕忘了给阿姨打个电话" }]),
    /^已添加待办.*给阿姨打电话/,
  );
  assert.deepEqual(
    tasks.list().map(({ title }) => title),
    ["买牛奶", "给阿姨打电话"],
  );
  assert.equal(requests.length, 3);
});

test("今日建议优先展示逾期和今天到期的待办，搜索保留完成状态", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-11-25T16:10:00Z") });
  const { chat } = await startTestApp(t, true);
  assert.match(await chat("今天先做什么？"), /没有待办/);
  await chat("添加待办：季度报告，明天到期，优先级高");
  await chat("添加待办：交报告，今天到期，优先级中");
  await chat("添加待办：缴电费，截止2026-11-25");
  await chat("添加待办：取快递，优先级低");
  await chat("添加待办：整理报告，截止2026-11-24");
  await chat("完成整理报告");
  const focus = await chat("今天先做什么？");
  assert.match(
    focus,
    /1\. .*缴电费.*已逾期[\s\S]*2\. .*交报告.*今天到期[\s\S]*3\. .*季度报告[\s\S]*还有 1 项待办/,
  );
  assert.doesNotMatch(focus, /整理报告|取快递/);
  const overdue = await chat("有哪些逾期任务？");
  assert.match(overdue, /逾期待办[\s\S]*缴电费/);
  assert.doesNotMatch(overdue, /整理报告|交报告/);
  assert.match(
    await chat("搜索 报告"),
    /搜索「报告」 · 3 项[\s\S]*待办（2）[\s\S]*已完成（1）[\s\S]*整理报告/,
  );
  assert.match(await chat("搜索 发票"), /更短的关键词/);
  assert.match(await chat("谢谢小明"), /不客气/);
});
