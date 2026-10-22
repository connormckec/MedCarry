CREATE TABLE `practices` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `staff_memberships` (
	`id` text PRIMARY KEY NOT NULL,
	`practice_id` text NOT NULL,
	`principal_id` text NOT NULL,
	`role` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`practice_id`) REFERENCES `practices`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `staff_membership_principal` ON `staff_memberships` (`practice_id`,`principal_id`);
--> statement-breakpoint
CREATE INDEX `staff_memberships_principal` ON `staff_memberships` (`principal_id`);
--> statement-breakpoint
CREATE TABLE `patients` (
	`id` text PRIMARY KEY NOT NULL,
	`practice_id` text NOT NULL,
	`legal_name` text NOT NULL,
	`dob` text NOT NULL,
	`postal_code` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`practice_id`) REFERENCES `practices`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `patients_practice` ON `patients` (`practice_id`);
--> statement-breakpoint
CREATE INDEX `patients_practice_name_dob` ON `patients` (`practice_id`,`legal_name`,`dob`);
--> statement-breakpoint
CREATE TABLE `external_patient_mappings` (
	`id` text PRIMARY KEY NOT NULL,
	`practice_id` text NOT NULL,
	`patient_id` text NOT NULL,
	`source_system` text NOT NULL,
	`external_patient_id` text NOT NULL,
	`verification_status` text NOT NULL,
	`match_method` text NOT NULL,
	`reviewer_id` text,
	`verified_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`practice_id`) REFERENCES `practices`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `external_patient_namespace` ON `external_patient_mappings` (`practice_id`,`source_system`,`external_patient_id`);
--> statement-breakpoint
CREATE INDEX `external_mappings_patient` ON `external_patient_mappings` (`patient_id`);
--> statement-breakpoint
CREATE TABLE `respondents` (
	`id` text PRIMARY KEY NOT NULL,
	`practice_id` text NOT NULL,
	`patient_id` text NOT NULL,
	`display_name` text NOT NULL,
	`relationship` text NOT NULL,
	`completion_role` text NOT NULL,
	`authorization_status` text NOT NULL,
	`principal_id` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`practice_id`) REFERENCES `practices`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `respondents_patient` ON `respondents` (`patient_id`);
--> statement-breakpoint
CREATE INDEX `respondents_principal` ON `respondents` (`principal_id`);
--> statement-breakpoint
CREATE TABLE `appointments` (
	`id` text PRIMARY KEY NOT NULL,
	`practice_id` text NOT NULL,
	`patient_id` text NOT NULL,
	`provider_name` text NOT NULL,
	`service_name` text NOT NULL,
	`starts_at` text NOT NULL,
	`timezone` text NOT NULL,
	`source_system` text,
	`external_appointment_id` text,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`practice_id`) REFERENCES `practices`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `appointments_practice_starts` ON `appointments` (`practice_id`,`starts_at`);
--> statement-breakpoint
CREATE INDEX `appointments_patient` ON `appointments` (`patient_id`);
--> statement-breakpoint
CREATE TABLE `profile_patient_links` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_id` text NOT NULL,
	`patient_id` text NOT NULL,
	`linked_by` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `profile_patient_link` ON `profile_patient_links` (`profile_id`);
