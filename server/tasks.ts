import { Router } from "express";
import { z } from "zod";
import { taskDetails, title } from "./task-fields.ts";
import type { TaskStore } from "./task-store.ts";

const createTaskSchema = taskDetails.extend({ title, parentId: z.string().min(1).optional() });
const updateTaskSchema = taskDetails
  .extend({ title: title.optional(), done: z.boolean().optional() })
  .refine((changes) => Object.keys(changes).length > 0);

const taskNotFound = { error: "找不到这条任务。" };

export function taskRouter(tasks: TaskStore) {
  const router = Router();

  router.get("/", (_req, res) => {
    res.json(tasks.list());
  });

  router.post("/", (req, res) => {
    const input = createTaskSchema.safeParse(req.body);
    if (!input.success) {
      return res.status(400).json({ error: "请提供 1 至 200 个字符的标题及有效的任务属性。" });
    }
    const { title, ...details } = input.data;
    const task = tasks.create(title, details);
    if (!task) return res.status(400).json({ error: "请选择一条存在的主任务作为父任务。" });
    res.status(201).json(task);
  });

  router.patch("/:id", (req, res) => {
    const input = updateTaskSchema.safeParse(req.body);
    if (!input.success) {
      return res.status(400).json({ error: "请提供至少一个有效的任务修改字段。" });
    }

    const updated = tasks.update(req.params.id, input.data);
    if (!updated) return res.status(404).json(taskNotFound);
    res.json(updated);
  });

  router.delete("/:id", (req, res) => {
    if (!tasks.remove(req.params.id)) return res.status(404).json(taskNotFound);
    res.sendStatus(204);
  });

  return router;
}
