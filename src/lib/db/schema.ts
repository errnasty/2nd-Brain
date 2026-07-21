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
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
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
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
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
    // "Read later" queue — distinct from `starred` (a favourite). Saved from the
    // Daily Brief or reader; surfaced as a Feeds view.
    readLater: boolean("read_later").default(false).notNull(),
    imageUrl: text("image_url"),
    wordCount: integer("word_count"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    feedGuidUnique: uniqueIndex("articles_feed_guid_unique").on(t.feedId, t.guid),
    userReadStatusIdx: index("articles_user_status_idx").on(t.userId, t.readStatus, t.publishDate),
    // Single-feed and single-folder views filter by feed/folder + read_status and
    // sort by publish_date desc. Without these composites the (user,status,date)
    // index above had to scan/refilter — slow to switch into a busy feed/folder.
    feedStatusPubIdx: index("articles_feed_status_pub_idx").on(
      t.feedId,
      t.readStatus,
      t.publishDate.desc(),
    ),
    folderStatusPubIdx: index("articles_folder_status_pub_idx").on(
      t.folderId,
      t.readStatus,
      t.publishDate.desc(),
    ),
    folderIdx: index("articles_folder_idx").on(t.folderId),
    publishIdx: index("articles_publish_idx").on(t.publishDate),
    // Feeds "All"/"Hot" views: per-user list across every read status. The
    // (user,status,date) index above can't give a cross-status date order.
    userPubIdx: index("articles_user_pub_idx").on(t.userId, t.publishDate.desc(), t.id.desc()),
    // Feeds "Starred" view — tiny partial, exact match for its filter+sort.
    starredIdx: index("articles_user_starred_idx")
      .on(t.userId, t.publishDate.desc())
      .where(sql`${t.starred}`),
    readLaterIdx: index("articles_user_readlater_idx")
      .on(t.userId, t.publishDate.desc())
      .where(sql`${t.readLater}`),
    // Supports the retention purge (delete old read, non-kept articles).
    retentionIdx: index("articles_retention_idx")
      .on(t.readStatus, t.createdAt)
      .where(sql`not ${t.starred} and not ${t.readLater}`),
    // Supports the desktop⇄cloud sync pull ("changed since cursor").
    userUpdatedIdx: index("articles_user_updated_idx").on(t.userId, t.updatedAt),
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
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
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
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
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
    // RAG/related queries filter by user_id; without this the tenant predicate
    // was an unindexed scan layered on the global HNSW search.
    userIdx: index("article_embeddings_user_idx").on(t.userId),
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
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
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
    // Default Directory listing (newest-updated first, id tiebreaker) — the
    // (user,kind,updated) index above can't give a cross-kind date order.
    // Also serves the desktop sync pull ("changed since cursor").
    userUpdatedIdx: index("directory_items_user_updated_idx").on(
      t.userId,
      t.updatedAt.desc(),
      t.id.desc(),
    ),
    // Folder view: filter by folder, newest-updated first.
    folderUpdatedIdx: index("directory_items_folder_updated_idx").on(t.folderId, t.updatedAt.desc()),
    // Unsorted (inbox) view — partial, exact match for its filter+sort.
    unsortedUpdatedIdx: index("directory_items_unsorted_updated_idx")
      .on(t.userId, t.updatedAt.desc())
      .where(sql`${t.folderId} is null`),
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
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
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
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.tagId, t.itemKind, t.itemId] }),
    itemIdx: index("item_tags_item_idx").on(t.itemKind, t.itemId),
    userIdx: index("item_tags_user_idx").on(t.userId),
    // Tag-filter + export workload filters (user_id, item_kind, tag_id) then
    // groups by item_id. This composite serves that query shape directly.
    tagFilterIdx: index("item_tags_user_kind_tag_idx").on(t.userId, t.itemKind, t.tagId, t.itemId),
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
// Spaced-repetition flashcards. Scheduled by FSRS (stability/difficulty);
// legacy SM-2 columns (ease/intervalDays/repetitions) remain for seeding old
// rows and for stats. Cloud migration 0018 adds the FSRS columns.
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
    // FSRS state — null until the card's first FSRS review.
    stability: real("stability"),
    difficulty: real("difficulty"),
    lapses: integer("lapses").default(0).notNull(),
    lastReviewedAt: timestamp("last_reviewed_at", { withTimezone: true }),
    dueDate: timestamp("due_date", { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    dueIdx: index("directory_flashcards_due_idx").on(t.userId, t.dueDate),
    itemIdx: index("directory_flashcards_item_idx").on(t.itemId),
  }),
);

// ── Rabbithole: recursive select→ask→child-document trees ───────────────
// Each node is one AI-answered branch hanging off a Directory item: the user
// selected `anchor_text` (in the root document when parent_id is null, else in
// the parent node's answer), asked `question`, and got `content` back as a
// standalone mini-document. Deleting an item cascades its whole hole away.
// parent_id is intentionally NOT a foreign key (matching folders.parent_id /
// directory_folders.parent_id) — subtree deletes are done in app code.
export const rabbitholeNodes = pgTable(
  "rabbithole_nodes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    itemId: uuid("item_id")
      .notNull()
      .references(() => directoryItems.id, { onDelete: "cascade" }),
    parentId: uuid("parent_id"),
    anchorText: text("anchor_text").notNull(),
    question: text("question").notNull(),
    // Preset lens key (explain | eli5 | example | deeper) or null for a custom question.
    lens: text("lens"),
    title: text("title").notNull(),
    content: text("content").notNull(),
    model: text("model"),
    // 1 = branched from the root document; children are parent.depth + 1.
    depth: integer("depth").default(1).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    itemIdx: index("rabbithole_nodes_item_idx").on(t.itemId, t.createdAt),
    parentIdx: index("rabbithole_nodes_parent_idx").on(t.parentId),
    // Supports the desktop⇄cloud sync pull ("changed since cursor").
    userUpdatedIdx: index("rabbithole_nodes_user_updated_idx").on(t.userId, t.updatedAt),
  }),
);

// ── Quiz: mixed multiple-choice / open-ended question sets ─────────────
// Generated from one or more Directory items (item_ids — a jsonb array, not a
// join table: there's no need to query "quizzes containing item X", and the
// list is small/immutable after generation). Retaking a quiz creates another
// quiz_attempts row rather than overwriting — that history is the whole point
// of "save history, retake later".
export type QuizQuestion =
  // explanation is optional: quizzes generated before this field existed have
  // no such key in their stored jsonb — never assume it's present.
  | { id: string; type: "mc"; question: string; options: string[]; correctIndex: number; explanation?: string }
  | { id: string; type: "open"; question: string; answer: string };

export type QuizAnswer =
  | { questionId: string; type: "mc"; selectedIndex: number }
  | { questionId: string; type: "open"; selfCorrect: boolean };

export const quizzes = pgTable(
  "quizzes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    itemIds: jsonb("item_ids").$type<string[]>().notNull().default([]),
    questions: jsonb("questions").$type<QuizQuestion[]>().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    userUpdatedIdx: index("quizzes_user_updated_idx").on(t.userId, t.updatedAt),
  }),
);

export const quizAttempts = pgTable(
  "quiz_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    quizId: uuid("quiz_id")
      .notNull()
      .references(() => quizzes.id, { onDelete: "cascade" }),
    answers: jsonb("answers").$type<QuizAnswer[]>().notNull().default([]),
    score: integer("score").notNull(),
    total: integer("total").notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    quizIdx: index("quiz_attempts_quiz_idx").on(t.quizId, t.completedAt),
    userUpdatedIdx: index("quiz_attempts_user_updated_idx").on(t.userId, t.updatedAt),
  }),
);

// ── ThinkTank: AI-generated topic-learning decks ───────────────────────
// A topic becomes a deck of bite-sized "idea cards" (prerequisites → core →
// advanced), read in a swipeable card reader. Cards can be saved to the
// Directory or turned into flashcards. `pacing` is a v2 seam: "daily" will
// unlock one card per day (Imprint-style drip) without schema rework.
// SYNCED to desktop.
export type ThinkTankSection = "prerequisites" | "core" | "advanced";
export type ThinkTankRef = { itemId?: string; title: string; url?: string };

export const thinktankDecks = pgTable(
  "thinktank_decks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    topic: text("topic").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    // "error" marks a failed generation the user can retry/delete; decks are
    // inserted whole, so "generating" only appears if async generation lands.
    status: text("status").$type<"generating" | "ready" | "error">().default("ready").notNull(),
    pacing: text("pacing").$type<"free" | "daily">().default("free").notNull(),
    // Reader resume point (index of the last card viewed).
    lastPosition: integer("last_position").default(0).notNull(),
    // Provenance + cost transparency: which model generated this deck and how
    // many tokens it consumed. Nullable for decks generated before the column
    // existed and for hand-created rows.
    model: text("model"),
    tokenCount: integer("token_count"),
    // Depth the user requested — drives card count + per-card word ceiling.
    detail: text("detail").$type<"brief" | "standard" | "deep">().default("standard").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    userCreatedIdx: index("thinktank_decks_user_created_idx").on(t.userId, t.createdAt.desc()),
    userUpdatedIdx: index("thinktank_decks_user_updated_idx").on(t.userId, t.updatedAt),
  }),
);

export const thinktankCards = pgTable(
  "thinktank_cards",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    deckId: uuid("deck_id")
      .notNull()
      .references(() => thinktankDecks.id, { onDelete: "cascade" }),
    // Reading order; doubles as the day index for v2 daily pacing.
    position: integer("position").notNull(),
    section: text("section").$type<ThinkTankSection>().notNull(),
    title: text("title").notNull(),
    // One self-contained idea, ≤ ~80 words of markdown.
    body: text("body").notNull(),
    // Library items + web sources this card draws on.
    sourceRefs: jsonb("source_refs").$type<ThinkTankRef[]>().default([]).notNull(),
    // Set when "Save to library" created a Directory note (idempotency).
    savedItemId: uuid("saved_item_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    deckIdx: index("thinktank_cards_deck_idx").on(t.deckId, t.position),
    userUpdatedIdx: index("thinktank_cards_user_updated_idx").on(t.userId, t.updatedAt),
  }),
);

// ── Background AI jobs ─────────────────────────────────────────────────
// Transient bookkeeping for long AI work (curriculum notes, gap research)
// that runs outside the request the user is waiting on: the client creates a
// job (fast), kicks a run route whose response is allowed to sever, and polls
// the job's status — so a serverless timeout can never surface as a false
// error. NOT synced (like xp_events): jobs are per-device scratch state, and
// the durable output is the Directory note they produce.
export type AiJobKind = "curriculum" | "gap_research";
export type AiJobPayload = { topic: string; folderId?: string | null };

export const aiJobs = pgTable(
  "ai_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    kind: text("kind").$type<AiJobKind>().notNull(),
    payload: jsonb("payload").$type<AiJobPayload>().notNull(),
    status: text("status").$type<"pending" | "running" | "done" | "error">().default("pending").notNull(),
    resultItemId: uuid("result_item_id"),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    userCreatedIdx: index("ai_jobs_user_created_idx").on(t.userId, t.createdAt.desc()),
  }),
);

export type AiJob = typeof aiJobs.$inferSelect;

export type Tag = typeof tags.$inferSelect;
export type ItemTag = typeof itemTags.$inferSelect;
export type DirectoryTask = typeof directoryTasks.$inferSelect;
export type DirectoryFlashcard = typeof directoryFlashcards.$inferSelect;
export type RabbitholeNode = typeof rabbitholeNodes.$inferSelect;
export type Quiz = typeof quizzes.$inferSelect;
export type QuizAttempt = typeof quizAttempts.$inferSelect;
export type ThinkTankDeck = typeof thinktankDecks.$inferSelect;
export type ThinkTankCard = typeof thinktankCards.$inferSelect;

// ── Gamification ────────────────────────────────────────────────────────
// A generic XP/skill engine. Domain-agnostic ('knowledge' now; 'fitness' etc
// later just use a different `domain`). player_profile + skills are SYNCED;
// xp_events is an append-only local ledger (feed + idempotency), NOT synced —
// like the derived tables the sync engine skips.

export const playerProfile = pgTable(
  "player_profile",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    totalXp: integer("total_xp").default(0).notNull(),
    level: integer("level").default(1).notNull(),
    streakDays: integer("streak_days").default(0).notNull(),
    lastActiveDateKey: text("last_active_date_key"),
    dailyXp: integer("daily_xp").default(0).notNull(),
    dailyDateKey: text("daily_date_key"),
    // Running tallies for achievement predicates (tasksDone, cardsGraded, …).
    counters: jsonb("counters").$type<Record<string, number>>().default({}).notNull(),
    // Unlocked achievement keys: [{ key, at }].
    unlocked: jsonb("unlocked").$type<{ key: string; at: string }[]>().default([]).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    userUnique: uniqueIndex("player_profile_user_unique").on(t.userId),
  }),
);

export const skills = pgTable(
  "skills",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    // Expandability seam: group + isolate domains (knowledge, fitness, …).
    domain: text("domain").default("knowledge").notNull(),
    emoji: text("emoji"),
    color: text("color"),
    xp: integer("xp").default(0).notNull(),
    level: integer("level").default(1).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    userDomainSlugUnique: uniqueIndex("skills_user_domain_slug_unique").on(t.userId, t.domain, t.slug),
    userIdx: index("skills_user_idx").on(t.userId),
  }),
);

export const xpEvents = pgTable(
  "xp_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    skillId: uuid("skill_id").references(() => skills.id, { onDelete: "set null" }),
    source: text("source").notNull(),
    amount: integer("amount").notNull(),
    refKind: text("ref_kind"),
    refId: text("ref_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    // Idempotency: at most one grant per (user, source, ref).
    refUnique: uniqueIndex("xp_events_ref_unique")
      .on(t.userId, t.source, t.refKind, t.refId)
      .where(sql`${t.refId} is not null`),
    feedIdx: index("xp_events_feed_idx").on(t.userId, t.createdAt.desc()),
  }),
);

export type PlayerProfile = typeof playerProfile.$inferSelect;
export type Skill = typeof skills.$inferSelect;
export type XpEvent = typeof xpEvents.$inferSelect;

// ── User settings ───────────────────────────────────────────────────────
// One row per user; `settings` is a merged JSONB blob of UI preferences that
// must persist + sync (board WIP limits, board filters, …). SYNCED to desktop.
export type UserSettingsData = {
  // Preferred AI model id (a CHAT_MODELS id) applied to EVERY AI call in the
  // app — Ask + background generation (decks, quizzes, flashcards, tagging…).
  // Unset/null = the env-configured provider defaults. Additive jsonb key —
  // no migration needed.
  aiModel?: string | null;
  // #10 Directory board WIP limits, keyed by reading-status column id.
  wipLimits?: Record<string, number>;
  // #1 Auto-summarize an article when it's opened in the reader.
  autoSummarizeOnOpen?: boolean;
  // Flashcard/quiz generation preferences (Settings → Flashcards & Quiz).
  // Unset = the DEFAULT_* constants in src/lib/ai/study-options.ts.
  flashcardDifficulty?: "easy" | "medium" | "hard";
  flashcardCount?: number;
  quizDifficulty?: "easy" | "medium" | "hard";
  quizCount?: number;
  // Watermark for the "What's New" panel: the id of the newest changelog entry
  // this user has acknowledged (see src/data/changelog.ts). Entries with a
  // greater id are shown as unseen. Additive jsonb key — no migration needed.
  lastSeenChangelog?: string;
  // Whether this user finished (or dismissed) the intro tour. Server-side so
  // it holds across devices/browsers; the legacy localStorage flag is
  // backfilled on first load. Additive jsonb key — no migration needed.
  onboardingDone?: boolean;
  // Topics the user said they want to learn (onboarding step / Settings).
  // Seeds ThinkTank suggestions. Shallow-merge caveat: always send the whole
  // array. Additive jsonb key — no migration needed.
  interests?: string[];
};

export const userSettings = pgTable(
  "user_settings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    settings: jsonb("settings").$type<UserSettingsData>().default({}).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    userUnique: uniqueIndex("user_settings_user_unique").on(t.userId),
  }),
);

export type UserSettings = typeof userSettings.$inferSelect;

// ── Sync (desktop ⇄ cloud) ──────────────────────────────────────────────
// Row deletions recorded by an AFTER DELETE trigger (see migration 0013 /
// local bootstrap) so the desktop⇄cloud sync can propagate deletes. Exists on
// BOTH sides. Written only by triggers; read + pruned by the sync engine.
export const syncTombstones = pgTable(
  "sync_tombstones",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tableName: text("table_name").notNull(),
    rowId: uuid("row_id").notNull(),
    userId: uuid("user_id").notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    userDeletedIdx: index("sync_tombstones_user_deleted_idx").on(t.userId, t.deletedAt),
  }),
);

export const SCHEMA_INIT_SQL = sql`CREATE EXTENSION IF NOT EXISTS vector;`;
export { EMBEDDING_DIMS };
