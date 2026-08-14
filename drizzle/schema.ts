import { int, mysqlEnum, mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core";

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["admin", "user"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export const codingProjects = mysqlTable("coding_projects", {
  id: int("id").autoincrement().primaryKey(),
  ownerId: int("ownerId").notNull(),
  name: varchar("name", { length: 120 }).notNull(),
  workspaceKey: varchar("workspaceKey", { length: 64 }).notNull().unique(),
  sourceType: mysqlEnum("sourceType", ["scratch", "zip_import", "git_import"]).default("scratch").notNull(),
  storageKey: text("storageKey"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const codingRuns = mysqlTable("coding_runs", {
  id: int("id").autoincrement().primaryKey(),
  projectId: int("projectId").notNull(),
  ownerId: int("ownerId").notNull(),
  prompt: text("prompt").notNull(),
  inputLanguage: varchar("inputLanguage", { length: 80 }).notNull(),
  taskType: varchar("taskType", { length: 160 }).notNull(),
  deliverable: text("deliverable").notNull(),
  taskJson: text("taskJson").notNull(),
  assistantResponse: text("assistantResponse").notNull(),
  status: mysqlEnum("status", ["planned", "awaiting_review", "verifying", "passed", "failed", "needs_approval"]).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const codingFileChanges = mysqlTable("coding_file_changes", {
  id: int("id").autoincrement().primaryKey(),
  runId: int("runId").notNull(),
  path: text("path").notNull(),
  operation: mysqlEnum("operation", ["create", "update", "delete"]).notNull(),
  previousContent: text("previousContent"),
  nextContent: text("nextContent"),
  diffText: text("diffText"),
  reviewStatus: mysqlEnum("reviewStatus", ["pending", "accepted", "rejected"]).default("pending").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const workspaceFiles = mysqlTable("workspace_files", {
  id: int("id").autoincrement().primaryKey(),
  projectId: int("projectId").notNull(),
  path: varchar("path", { length: 1024 }).notNull(),
  contentKey: text("content").notNull(),
  language: varchar("language", { length: 48 }).notNull().default("text"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const verificationRuns = mysqlTable("verification_runs", {
  id: int("id").autoincrement().primaryKey(),
  runId: int("runId").notNull(),
  checkType: mysqlEnum("checkType", ["typecheck", "lint", "build", "test", "custom"]).notNull(),
  status: mysqlEnum("status", ["queued", "running", "passed", "failed", "skipped"]).notNull(),
  logText: text("logText"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  completedAt: timestamp("completedAt"),
});

export const approvalRequests = mysqlTable("approval_requests", {
  id: int("id").autoincrement().primaryKey(),
  runId: int("runId").notNull(),
  actionType: mysqlEnum("actionType", ["delete_file", "push_live", "permanent_operation"]).notNull(),
  description: text("description").notNull(),
  status: mysqlEnum("status", ["pending", "approved", "rejected"]).default("pending").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  resolvedAt: timestamp("resolvedAt"),
});

export const projectSnapshots = mysqlTable("project_snapshots", {
  id: int("id").autoincrement().primaryKey(),
  projectId: int("projectId").notNull(),
  runId: int("runId"),
  label: varchar("label", { length: 180 }).notNull(),
  archiveKey: text("archiveStorageKey"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
