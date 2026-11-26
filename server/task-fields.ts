import { z } from "zod";

export const title = z.string().trim().min(1).max(200);
export const priority = z.enum(["高", "中", "低"]);
export const effort = z.enum(["小", "中", "大"]);
export const dueDate = z.iso.date();

export const taskDetails = z.strictObject({
  dueDate: dueDate.optional(),
  priority: priority.optional(),
  effort: effort.optional(),
});
