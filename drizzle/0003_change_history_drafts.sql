ALTER TABLE `medications` ADD `list_state` text DEFAULT 'active' NOT NULL;--> statement-breakpoint
CREATE INDEX `medications_list_state` ON `medications` (`owner_id`,`profile_id`,`list_state`);--> statement-breakpoint
CREATE TABLE `medication_change_events` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`profile_id` text NOT NULL,
	`medication_id` text NOT NULL,
	`actor_principal_id` text NOT NULL,
	`reason` text NOT NULL,
	`prior_data` text NOT NULL,
	`prior_source_ids` text NOT NULL,
	`prior_revision` integer NOT NULL,
	`prior_confirmed_revision` integer,
	`prior_confirmed_at` text,
	`prior_list_state` text NOT NULL,
	`undone_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`medication_id`) REFERENCES `medications`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `change_events_profile` ON `medication_change_events` (`owner_id`,`profile_id`);
--> statement-breakpoint
CREATE INDEX `change_events_medication` ON `medication_change_events` (`medication_id`);
--> statement-breakpoint
CREATE TABLE `editor_drafts` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`profile_id` text NOT NULL,
	`principal_id` text NOT NULL,
	`medication_id` text NOT NULL,
	`draft_json` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `editor_draft_unique` ON `editor_drafts` (`owner_id`,`profile_id`,`principal_id`,`medication_id`);
--> statement-breakpoint
CREATE INDEX `editor_drafts_principal` ON `editor_drafts` (`principal_id`,`profile_id`);
