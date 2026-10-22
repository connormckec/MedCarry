CREATE TABLE `medication_terminology` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`profile_id` text NOT NULL,
	`medication_id` text NOT NULL,
	`original_product_name` text NOT NULL,
	`original_strength` text NOT NULL,
	`original_formulation` text NOT NULL,
	`query_text` text NOT NULL,
	`rx_cui` text NOT NULL,
	`reference_name` text NOT NULL,
	`tty` text NOT NULL,
	`clinical_drug_rx_cui` text NOT NULL,
	`clinical_drug_name` text NOT NULL,
	`ingredient_rx_cuis` text NOT NULL,
	`ingredient_names` text NOT NULL,
	`strength_value` text NOT NULL,
	`strength_unit` text NOT NULL,
	`dosage_form` text NOT NULL,
	`release_characteristic` text NOT NULL,
	`mapping_status` text NOT NULL,
	`match_method` text NOT NULL,
	`terminology_version` text NOT NULL,
	`terminology_date` text NOT NULL,
	`notes_json` text NOT NULL,
	`reviewer_principal_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`medication_id`) REFERENCES `medications`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `medication_terminology_med` ON `medication_terminology` (`medication_id`);
--> statement-breakpoint
CREATE INDEX `medication_terminology_profile` ON `medication_terminology` (`owner_id`,`profile_id`);
--> statement-breakpoint
CREATE TABLE `rxnorm_query_cache` (
	`query_hash` text PRIMARY KEY NOT NULL,
	`query_text` text NOT NULL,
	`response_json` text NOT NULL,
	`fetched_at` text NOT NULL,
	`expires_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `duplicate_flags` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`profile_id` text NOT NULL,
	`medication_a_id` text NOT NULL,
	`medication_b_id` text NOT NULL,
	`flag_type` text NOT NULL,
	`explanation` text NOT NULL,
	`evidence_json` text NOT NULL,
	`status` text NOT NULL,
	`respondent_principal_id` text,
	`responded_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`medication_a_id`) REFERENCES `medications`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`medication_b_id`) REFERENCES `medications`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `duplicate_flag_pair_type` ON `duplicate_flags` (`profile_id`,`medication_a_id`,`medication_b_id`,`flag_type`);
--> statement-breakpoint
CREATE INDEX `duplicate_flags_profile` ON `duplicate_flags` (`owner_id`,`profile_id`);
