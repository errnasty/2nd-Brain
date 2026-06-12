// AUTO-GENERATED from src/lib/db/schema.ts via drizzle-kit (desktop local schema).
// Applied once to the embedded PGlite database on first desktop launch.
// Regenerate: npm run db:local-schema

export const LOCAL_SCHEMA_SQL = `
CREATE TYPE "public"."directory_item_kind" AS ENUM('saved_article', 'uploaded_document', 'user_note');--> statement-breakpoint
CREATE TYPE "public"."directory_reading_status" AS ENUM('inbox', 'reading', 'done', 'review');--> statement-breakpoint
CREATE TYPE "public"."doc_kind" AS ENUM('pdf', 'markdown', 'text', 'epub', 'docx', 'pptx');--> statement-breakpoint
CREATE TYPE "public"."item_kind" AS ENUM('article', 'document', 'directory_item');--> statement-breakpoint
CREATE TYPE "public"."read_status" AS ENUM('unread', 'read', 'archived');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "article_embeddings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"article_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"chunk_index" integer DEFAULT 0 NOT NULL,
	"content" text NOT NULL,
	"embedding" vector(1024),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "articles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"feed_id" uuid NOT NULL,
	"folder_id" uuid,
	"guid" text NOT NULL,
	"url" text NOT NULL,
	"title" text NOT NULL,
	"author" text,
	"excerpt" text,
	"full_text" text,
	"full_text_fetched_at" timestamp with time zone,
	"publish_date" timestamp with time zone,
	"read_status" "read_status" DEFAULT 'unread' NOT NULL,
	"starred" boolean DEFAULT false NOT NULL,
	"read_later" boolean DEFAULT false NOT NULL,
	"image_url" text,
	"word_count" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "directory_flashcards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"item_id" uuid,
	"question" text NOT NULL,
	"answer" text NOT NULL,
	"ease" real DEFAULT 2.5 NOT NULL,
	"interval_days" integer DEFAULT 0 NOT NULL,
	"repetitions" integer DEFAULT 0 NOT NULL,
	"due_date" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "directory_folders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"parent_id" uuid,
	"position" integer DEFAULT 0 NOT NULL,
	"is_inbox" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "directory_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"folder_id" uuid,
	"kind" "directory_item_kind" NOT NULL,
	"title" text NOT NULL,
	"content" text,
	"source_url" text,
	"article_id" uuid,
	"document_id" uuid,
	"metadata" jsonb,
	"reading_status" "directory_reading_status" DEFAULT 'inbox' NOT NULL,
	"embedding" vector(1024),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "directory_links" (
	"source_item_id" uuid NOT NULL,
	"target_item_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "directory_links_source_item_id_target_item_id_pk" PRIMARY KEY("source_item_id","target_item_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "directory_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"text" text NOT NULL,
	"done" boolean DEFAULT false NOT NULL,
	"due_date" timestamp with time zone,
	"line_index" integer NOT NULL,
	"raw_line" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "document_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"chunk_index" integer NOT NULL,
	"content" text NOT NULL,
	"token_count" integer,
	"embedding" vector(1024),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"folder_id" uuid,
	"title" text NOT NULL,
	"kind" "doc_kind" NOT NULL,
	"source_url" text,
	"storage_path" text,
	"size_bytes" bigint,
	"page_count" integer,
	"full_text" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "feeds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"folder_id" uuid,
	"url" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"site_url" text,
	"icon_url" text,
	"last_fetched_at" timestamp with time zone,
	"last_error" text,
	"etag" text,
	"last_modified" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "folders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"parent_id" uuid,
	"position" integer DEFAULT 0 NOT NULL,
	"is_inbox" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "item_tags" (
	"tag_id" uuid NOT NULL,
	"item_kind" "item_kind" NOT NULL,
	"item_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"confidence" integer,
	"source" text DEFAULT 'user' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "item_tags_tag_id_item_kind_item_id_pk" PRIMARY KEY("tag_id","item_kind","item_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text,
	"display_name" text,
	"system_prompt" text,
	"llm_config" jsonb,
	"encrypted_api_keys" text,
	"is_syncing" boolean DEFAULT false NOT NULL,
	"sync_started_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "rate_limits" (
	"user_id" uuid NOT NULL,
	"bucket" text NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"window_start" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rate_limits_user_id_bucket_pk" PRIMARY KEY("user_id","bucket")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sync_tombstones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"table_name" text NOT NULL,
	"row_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"deleted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"color" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "article_embeddings" ADD CONSTRAINT "article_embeddings_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "article_embeddings" ADD CONSTRAINT "article_embeddings_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "articles" ADD CONSTRAINT "articles_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "articles" ADD CONSTRAINT "articles_feed_id_feeds_id_fk" FOREIGN KEY ("feed_id") REFERENCES "public"."feeds"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "articles" ADD CONSTRAINT "articles_folder_id_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."folders"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "directory_flashcards" ADD CONSTRAINT "directory_flashcards_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "directory_flashcards" ADD CONSTRAINT "directory_flashcards_item_id_directory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."directory_items"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "directory_folders" ADD CONSTRAINT "directory_folders_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "directory_items" ADD CONSTRAINT "directory_items_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "directory_items" ADD CONSTRAINT "directory_items_folder_id_directory_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."directory_folders"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "directory_items" ADD CONSTRAINT "directory_items_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "directory_items" ADD CONSTRAINT "directory_items_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "directory_links" ADD CONSTRAINT "directory_links_source_item_id_directory_items_id_fk" FOREIGN KEY ("source_item_id") REFERENCES "public"."directory_items"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "directory_links" ADD CONSTRAINT "directory_links_target_item_id_directory_items_id_fk" FOREIGN KEY ("target_item_id") REFERENCES "public"."directory_items"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "directory_links" ADD CONSTRAINT "directory_links_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "directory_tasks" ADD CONSTRAINT "directory_tasks_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "directory_tasks" ADD CONSTRAINT "directory_tasks_item_id_directory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."directory_items"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "documents" ADD CONSTRAINT "documents_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "documents" ADD CONSTRAINT "documents_folder_id_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."folders"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "feeds" ADD CONSTRAINT "feeds_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "feeds" ADD CONSTRAINT "feeds_folder_id_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."folders"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "folders" ADD CONSTRAINT "folders_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "item_tags" ADD CONSTRAINT "item_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "item_tags" ADD CONSTRAINT "item_tags_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rate_limits" ADD CONSTRAINT "rate_limits_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tags" ADD CONSTRAINT "tags_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "article_chunk_unique" ON "article_embeddings" USING btree ("article_id","chunk_index");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "article_embeddings_embedding_idx" ON "article_embeddings" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "articles_feed_guid_unique" ON "articles" USING btree ("feed_id","guid");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "articles_user_status_idx" ON "articles" USING btree ("user_id","read_status","publish_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "articles_folder_idx" ON "articles" USING btree ("folder_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "articles_publish_idx" ON "articles" USING btree ("publish_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "articles_user_readlater_idx" ON "articles" USING btree ("user_id","publish_date" DESC NULLS LAST) WHERE "articles"."read_later";--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "articles_retention_idx" ON "articles" USING btree ("read_status","created_at") WHERE not "articles"."starred" and not "articles"."read_later";--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "articles_user_updated_idx" ON "articles" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "directory_flashcards_due_idx" ON "directory_flashcards" USING btree ("user_id","due_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "directory_flashcards_item_idx" ON "directory_flashcards" USING btree ("item_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "directory_folders_user_name_unique" ON "directory_folders" USING btree ("user_id","name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "directory_folders_user_idx" ON "directory_folders" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "directory_items_user_idx" ON "directory_items" USING btree ("user_id","kind","updated_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "directory_items_reading_status_idx" ON "directory_items" USING btree ("user_id","reading_status","updated_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "directory_items_folder_idx" ON "directory_items" USING btree ("folder_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "directory_items_article_idx" ON "directory_items" USING btree ("article_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "directory_items_document_idx" ON "directory_items" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "directory_items_embedding_idx" ON "directory_items" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "directory_links_target_idx" ON "directory_links" USING btree ("target_item_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "directory_links_user_idx" ON "directory_links" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "directory_tasks_user_idx" ON "directory_tasks" USING btree ("user_id","done","due_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "directory_tasks_item_idx" ON "directory_tasks" USING btree ("item_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "doc_chunk_unique" ON "document_chunks" USING btree ("document_id","chunk_index");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_chunks_embedding_idx" ON "document_chunks" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_chunks_user_idx" ON "document_chunks" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "documents_user_idx" ON "documents" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "documents_folder_idx" ON "documents" USING btree ("folder_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "feeds_user_url_unique" ON "feeds" USING btree ("user_id","url");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "feeds_folder_idx" ON "feeds" USING btree ("folder_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "folders_user_name_unique" ON "folders" USING btree ("user_id","name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "folders_user_idx" ON "folders" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "item_tags_item_idx" ON "item_tags" USING btree ("item_kind","item_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "item_tags_user_idx" ON "item_tags" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sync_tombstones_user_deleted_idx" ON "sync_tombstones" USING btree ("user_id","deleted_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tags_user_slug_unique" ON "tags" USING btree ("user_id","slug");
`;
