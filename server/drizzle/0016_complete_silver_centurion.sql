ALTER TABLE "analytics_events" DROP CONSTRAINT "analytics_events_actor_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "analytics_events" ADD CONSTRAINT "analytics_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
