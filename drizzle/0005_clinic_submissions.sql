CREATE TABLE `clinic_submissions` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`profile_id` text NOT NULL,
	`practice_id` text NOT NULL,
	`patient_id` text NOT NULL,
	`appointment_id` text NOT NULL,
	`respondent_id` text,
	`recipient_clinic_name` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`payload_json` text NOT NULL,
	`medication_revisions_json` text NOT NULL,
	`change_summary_json` text NOT NULL,
	`empty_list_attested` integer NOT NULL,
	`delivery_status` text NOT NULL,
	`staff_status` text NOT NULL,
	`aprima_status` text NOT NULL,
	`submitted_at` text NOT NULL,
	`received_at` text,
	`reviewed_at` text,
	`reviewer_principal_id` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`practice_id`) REFERENCES `practices`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`appointment_id`) REFERENCES `appointments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `clinic_submission_request` ON `clinic_submissions` (`owner_id`,`idempotency_key`);
--> statement-breakpoint
CREATE INDEX `clinic_submissions_appointment` ON `clinic_submissions` (`appointment_id`);
--> statement-breakpoint
CREATE INDEX `clinic_submissions_practice` ON `clinic_submissions` (`practice_id`,`submitted_at`);
--> statement-breakpoint
CREATE TABLE `clinic_inbox_items` (
	`id` text PRIMARY KEY NOT NULL,
	`practice_id` text NOT NULL,
	`submission_id` text NOT NULL,
	`appointment_id` text NOT NULL,
	`patient_id` text NOT NULL,
	`appointment_starts_at` text NOT NULL,
	`appointment_timezone` text NOT NULL,
	`patient_legal_name` text NOT NULL,
	`patient_dob` text NOT NULL,
	`delivery_status` text NOT NULL,
	`staff_status` text NOT NULL,
	`aprima_status` text NOT NULL,
	`summary_json` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`practice_id`) REFERENCES `practices`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`submission_id`) REFERENCES `clinic_submissions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`appointment_id`) REFERENCES `appointments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `clinic_inbox_submission` ON `clinic_inbox_items` (`submission_id`);
--> statement-breakpoint
CREATE INDEX `clinic_inbox_practice_starts` ON `clinic_inbox_items` (`practice_id`,`appointment_starts_at`);
--> statement-breakpoint
CREATE TABLE `submission_outbox` (
	`id` text PRIMARY KEY NOT NULL,
	`submission_id` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`status` text NOT NULL,
	`attempts` integer NOT NULL,
	`last_error` text,
	`created_at` text NOT NULL,
	`acked_at` text,
	FOREIGN KEY (`submission_id`) REFERENCES `clinic_submissions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `submission_outbox_key` ON `submission_outbox` (`idempotency_key`);
--> statement-breakpoint
CREATE INDEX `submission_outbox_status` ON `submission_outbox` (`status`,`created_at`);
