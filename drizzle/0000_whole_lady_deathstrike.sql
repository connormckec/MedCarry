CREATE TABLE `audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`profile_id` text NOT NULL,
	`entity_id` text NOT NULL,
	`action` text NOT NULL,
	`revision` integer,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_owner` ON `audit_events` (`owner_id`,`profile_id`);--> statement-breakpoint
CREATE TABLE `medications` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`profile_id` text NOT NULL,
	`data` text NOT NULL,
	`source_ids` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`confirmed_revision` integer,
	`confirmed_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `medications_owner` ON `medications` (`owner_id`,`profile_id`);--> statement-breakpoint
CREATE TABLE `profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`name` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `profiles_owner` ON `profiles` (`owner_id`);--> statement-breakpoint
CREATE TABLE `snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`profile_id` text NOT NULL,
	`recipient` text NOT NULL,
	`patient_name` text NOT NULL,
	`data` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `snapshots_owner` ON `snapshots` (`owner_id`,`profile_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `snapshot_request` ON `snapshots` (`owner_id`,`idempotency_key`);--> statement-breakpoint
CREATE TABLE `uploads` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`profile_id` text NOT NULL,
	`object_key` text NOT NULL,
	`mime_type` text NOT NULL,
	`size` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `uploads_owner` ON `uploads` (`owner_id`,`profile_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uploads_object` ON `uploads` (`object_key`);