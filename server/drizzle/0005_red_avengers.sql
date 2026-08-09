CREATE TABLE "auth_rate_limits" (
	"key_hash" varchar(64) PRIMARY KEY NOT NULL,
	"scope" varchar(60) NOT NULL,
	"window_started_at" timestamp with time zone NOT NULL,
	"count" integer NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "auth_rate_limits_window_idx" ON "auth_rate_limits" USING btree ("window_started_at");
