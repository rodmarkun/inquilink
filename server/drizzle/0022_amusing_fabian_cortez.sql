CREATE INDEX "one_time_tokens_expiry_idx" ON "one_time_tokens" USING btree ("expires_at","id");--> statement-breakpoint
CREATE INDEX "one_time_tokens_used_idx" ON "one_time_tokens" USING btree ("used_at","id");--> statement-breakpoint
CREATE INDEX "sessions_expiry_idx" ON "sessions" USING btree ("expires_at","id");