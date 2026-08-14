CREATE TABLE `workspace_files` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`path` varchar(1024) NOT NULL,
	`content` text NOT NULL,
	`language` varchar(48) NOT NULL DEFAULT 'text',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `workspace_files_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `project_snapshots` ADD `snapshotJson` text;