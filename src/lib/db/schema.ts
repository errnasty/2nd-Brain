import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
} from "drizzle-orm/pg-core";

const EMBEDDING_DIMS = 1024;

export const readStatusEnum = pgEnum("read_status", ["unread", "read", "archived"]);
export const itemKindEnum = pgEnum("item_kind", ["article", "document", "directory_item"]);
export const docKindEnum = pgEnum("doc_kind", ["pdf", "markdown", "text", "epub", "docx", "pptx"]);
export const directoryItemKindEnum = pgEnum("directory_item_kind", [
  "saved_article",
  "uploaded_document",
  "user_note",
]);
// Reading pipeline states for Directory items (Kanban). Distinct from the
// feed `read_status` enum — that's per-article unread/read/archived.
export const directoryReadingStatusEnum = pgEnum("directory_reading_status", [
  "inbox",
  "reading",
  "done",
  "review",
]);

export const profiles = pgTable("profiles", {
  id: uuid("id").primaryKey().notNull(),
  email: text("email"),
  displayName: text("display_name"),
  systemPrompt: text("system_prompt"),
  llmConfig: jsonb("llm_config").$type<{
    provider?: "anthropic" | "openai" | "ollama";
    chatModel?: string;
    embeddingsProvider?: "openai" | "voyage" | "ollama";
    embeddingsModel?: string;
  }>(),
  encryptedApiKeys: text("encrypted_api_keys"),
  isSyncing: boolean("is_syncing").default(false).notNull(),
  syncStartedAt: timestamp("sync_started_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const folders = pgTable(
  "folders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    parentId: uuid("parent_id"),
    position: integer("position").default(0).notNull(),
    isInbox: boolean("is_inbox").default(false).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    userNameUnique: uniqueIndex("folders_user_name_unique").on(t.userId, t.name),
    userIdx: index("folders_user_idx").on(t.userId),
  }),
);

export const feeds = pgTable(
  "feeds",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    folderId: uuid("folder_id").references(() => folders.id, { onDelete: "set null" }),
    url: text("url").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    siteUrl: text("site_url"),
    iconUrl: text("icon_url"),
    lastFetchedAt: timestamp("last_fetched_at", { withTimezone: true }),
    lastError: text("last_error"),
    etag: text("etag"),
    lastModified: text("last_modified"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    userUrlUnique: uniqueIndex("feeds_user_url_unique").on(t.userId, t.url),
    folderIdx: index("feeds_folder_idx").on(t.folderId),
  }),
);

export const articles = pgTable(
  "articles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    feedId: uuid("feed_id")
      .notNull()
      .references(() => feeds.id, { onDelete: "cascade" }),
    folderId: uuid("folder_id").references(() => folders.id, { onDelete: "set null" }),
    guid: text("guid").notNull(),
    url: text("url").notNull(),
    title: text("title").notNull(),
    author: text("author"),
    excerpt: text("excerpt"),
    fullText: text("full_text"),
    fullTextFetchedAt: timestamp("full_text_fetched_at", { withTimezone: true }),
    publishDate: timestamp("publish_date", { withTimezone: true }),
    readStatus: readStatusEnum("read_status").default("unread").notNull(),
    starred: boolean("starred").default(false).notNull(),
    imageUrl: text("image_url"),
    wordCount: integer("word_count"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    feedGuidUnique: uniqueIndex("articles_feed_guid_unique").on(t.feedId, t.guid),
    userReadStatusIdx: index("articles_user_status_idx").on(t.userId, t.readStatus, t.publishDate),
    folderIdx: index("articles_folder_idx").on(t.folderId),
    publishIdx: index("articles_publish_idx").on(t.publishDate),
  }),
);

export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    folderId: uuid("folder_id").references(() => folders.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    kind: docKindEnum("kind").notNull(),
    sourceUrl: text("source_url"),
    storagePath: text("storage_path"),
    sizeBytes: bigint("size_bytes", { mode: "number" }),
    pageCount: integer("page_count"),
    fullText: text("full_text"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    userIdx: index("documents_user_idx").on(t.userId),
    folderIdx: index("documents_folder_idx").on(t.folderId),
  }),
);

export const documentChunks = pgTable(
  "document_chunks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    chunkIndex: integer("chunk_index").notNull(),
    content: text("content").notNull(),
    tokenCount: integer("token_count"),
    embedding: vector("embedding", { dimensions: EMBEDDING_DIMS }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    docChunkUnique: uniqueIndex("doc_chunk_unique").on(t.documentId, t.chunkIndex),
    embeddingIdx: index("document_chunks_embedding_idx")
      .using("hnsw", t.embedding.op("vector_cosine_ops")),
    userIdx: index("document_chunks_user_idx").on(t.userId),
  }),
);

export const articleEmbeddings = pgTable(
  "article_embeddings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    articleId: uuid("article_id")
      .notNull()
      .references(() => articles.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    chunkIndex: integer("chunk_index").default(0).notNull(),
    content: text("content").notNull(),
    embedding: vector("embedding", { dimensions: EMBEDDING_DIMS }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    articleChunkUnique: uniqueIndex("article_chunk_unique").on(t.articleId, t.chunkIndex),
    embeddingIdx: index("article_embeddings_embedding_idx")
      .using("hnsw", t.embedding.op("vector_cosine_ops")),
  }),
);

// ── Directory: unified permanent storage ────────────────────────────────
// `folders` continues to be used for *feed* organization. The Directory uses
// its own folder tree so renames/moves on one side don't affect the other.

export const directoryFolders = pgTable(
  "directory_folders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    parentId: uuid("parent_id"),
    position: integer("position").default(0).notNull(),
    isInbox: boolean("is_inbox").default(false).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    userNameUnique: uniqueIndex("directory_folders_user_name_unique").on(t.userId, t.name),
    userIdx: index("directory_folders_user_idx").on(t.userId),
  }),
);

export const directoryItems = pgTable(
  "directory_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    folderId: uuid("folder_id").references(() => directoryFolders.id, { onDelete: "set null" }),
    kind: directoryItemKindEnum("kind").notNull(),
    title: text("title").notNull(),
    content: text("content"),
    sourceUrl: text("source_url"),
    articleId: uuid("article_id").references(() => articles.id, { onDelete: "set null" }),
    documentId: uuid("document_id").references(() => documents.id, { onDelete: "set null" }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    // Reading pipeline (Kanban) state. Defaults to 'inbox' for every item.
    readingStatus: directoryReadingStatusEnum("reading_status").default("inbox").notNull(),
    // For user_note rows we store the embedding directly here (notes have no
    // separate documents row). For saved_article + uploaded_document this is
    // left null — their embeddings live on article_embeddings / document_chunks.
    embedding: vector("embedding", { dimensions: EMBEDDING_DIMS }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    userKindUpdatedIdx: index("directory_items_user_idx").on(t.userId, t.kind, t.updatedAt),
    readingStatusIdx: index("directory_items_reading_status_idx").on(
      t.userId,
      t.readingStatus,
      t.updatedAt,
    ),
    folderIdx: index("directory_items_folder_idx").on(t.folderId),
    articleIdx: index("directory_items_article_idx").on(t.articleId),
    documentIdx: index("directory_items_document_idx").on(t.documentId),
    embeddingIdx: index("directory_items_embedding_idx").using(
      "hnsw",
      t.embedding.op("vector_cosine_ops"),
    ),
  }),
);

export const directoryLinks = pgTable(
  "directory_links",
  {
    sourceItemId: uuid("source_item_id")
      .notNull()
      .references(() => directoryItems.id, { onDelete: "cascade" }),
    targetItemId: uuid("target_item_id")
      .notNull()
      .references(() => directoryItems.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.sourceItemId, t.targetItemId] }),
    targetIdx: index("directory_links_target_idx").on(t.targetItemId),
    userIdx: index("directory_links_user_idx").on(t.userId),
  }),
);

export const tags = pgTable(
  "tags",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    color: text("color"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    userSlugUnique: uniqueIndex("tags_user_slug_unique").on(t.userId, t.slug),
  }),
);

export const itemTags = pgTable(
  "item_tags",
  {
    tagId: uuid("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
    itemKind: itemKindEnum("item_kind").notNull(),
    itemId: uuid("item_id").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    confidence: integer("confidence"),
    source: text("source").default("user").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.tagId, t.itemKind, t.itemId] }),
    itemIdx: index("item_tags_item_idx").on(t.itemKind, t.itemId),
    userIdx: index("item_tags_user_idx").on(t.userId),
  }),
);

export const rateLimits = pgTable(
  "rate_limits",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    bucket: text("bucket").notNull(),
    count: integer("count").default(0).notNull(),
    windowStart: timestamp("window_start", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.bucket] }),
  }),
);

// Markdown checkbox tasks extracted from Directory items. Materialized so the
// global / Today view doesn't have to scan every note's content. Re-synced
// whenever the host item is saved: delete the item's rows, re-insert parsed.
export const directoryTasks = pgTable(
  "directory_tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    itemId: uuid("item_id")
      .notNull()
      .references(() => directoryItems.id, { onDelete: "cascade" }),
    text: text("text").notNull(),
    done: boolean("done").default(false).notNull(),
    dueDate: timestamp("due_date", { withTimezone: true, mode: "date" }),
    // Locate the source line for safe toggle/rewrite back into the markdown.
    lineIndex: integer("line_index").notNull(),
    rawLine: text("raw_line").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    userIdx: index("directory_tasks_user_idx").on(t.userId, t.done, t.dueDate),
    itemIdx: index("directory_tasks_item_idx").on(t.itemId),
  }),
);

export type Profile = typeof profiles.$inferSelect;
export type Folder = typeof folders.$inferSelect;
export type Feed = typeof feeds.$inferSelect;
export type Article = typeof articles.$inferSelect;
export type Document = typeof documents.$inferSelect;
export type DocumentChunk = typeof documentChunks.$inferSelect;
export type DirectoryFolder = typeof directoryFolders.$inferSelect;
export type DirectoryItem = typeof directoryItems.$inferSelect;
export type DirectoryLink = typeof directoryLinks.$inferSelect;
// Spaced-repetition flashcards (SM-2). Generated on demand from a Directory item.
export const directoryFlashcards = pgTable(
  "directory_flashcards",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    itemId: uuid("item_id").references(() => directoryItems.id, { onDelete: "set null" }),
    question: text("question").notNull(),
    answer: text("answer").notNull(),
    ease: real("ease").default(2.5).notNull(),
    intervalDays: integer("interval_days").default(0).notNull(),
    repetitions: integer("repetitions").default(0).notNull(),
    dueDate: timestamp("due_date", { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    dueIdx: index("directory_flashcards_due_idx").on(t.userId, t.dueDate),
    itemIdx: index("directory_flashcards_item_idx").on(t.itemId),
  }),
);

export type Tag = typeof tags.$inferSelect;
export type ItemTag = typeof itemTags.$inferSelect;
export type DirectoryTask = typeof directoryTasks.$inferSelect;
export type DirectoryFlashcard = typeof directoryFlashcards.$inferSelect;

export const SCHEMA_INIT_SQL = sql`CREATE EXTENSION IF NOT EXISTS vector;`;
export { EMBEDDING_DIMS };
