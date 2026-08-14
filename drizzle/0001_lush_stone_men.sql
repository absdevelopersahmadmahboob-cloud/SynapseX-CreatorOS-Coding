CREATE TABLE `approval_requests` (
	`id` int AUTO_INCREMENT NOT NULL,
	`runId` int NOT NULL,
	`actionType` enum('delete_file','push_live','permanent_operation') NOT NULL,
	`description` text NOT NULL,
	`status` enum('pending','approved','rejected') NOT NULL DEFAULT 'pending',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`resolvedAt` timestamp,
	CONSTRAINT `approval_requests_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `coding_file_changes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`runId` int NOT NULL,
	`path` text NOT NULL,
	`operation` enum('create','update','delete') NOT NULL,
	`previousContent` text,
	`nextContent` text,
	`diffText` text,
	`reviewStatus` enum('pending','accepted','rejected') NOT NULL DEFAULT 'pending',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `coding_file_changes_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `coding_projects` (
	`id` int AUTO_INCREMENT NOT NULL,
	`ownerId` int NOT NULL,
	`name` varchar(120) NOT NULL,
	`workspaceKey` varchar(64) NOT NULL,
	`sourceType` enum('scratch','zip_import','git_import') NOT NULL DEFAULT 'scratch',
	`storageKey` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `coding_projects_id` PRIMARY KEY(`id`),
	CONSTRAINT `coding_projects_workspaceKey_unique` UNIQUE(`workspaceKey`)
);
--> statement-breakpoint
CREATE TABLE `coding_runs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`ownerId` int NOT NULL,
	`prompt` text NOT NULL,
	`inputLanguage` varchar(80) NOT NULL,
	`taskType` varchar(160) NOT NULL,
	`deliverable` text NOT NULL,
	`taskJson` text NOT NULL,
	`assistantResponse` text NOT NULL,
	`status` enum('planned','awaiting_review','verifying','passed','failed','needs_approval') NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `coding_runs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `project_snapshots` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`runId` int,
	`label` varchar(180) NOT NULL,
	`archiveStorageKey` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `project_snapshots_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `verification_runs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`runId` int NOT NULL,
	`checkType` enum('typecheck','lint','build','test','custom') NOT NULL,
	`status` enum('queued','running','passed','failed','skipped') NOT NULL,
	`logText` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`completedAt` timestamp,
	CONSTRAINT `verification_runs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `users` MODIFY COLUMN `role` enum('admin','user') NOT NULL DEFAULT 'user';