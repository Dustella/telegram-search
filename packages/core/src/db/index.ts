import type { InferModel } from 'drizzle-orm'

import { useLogger } from '@tg-search/common'
import { and, count, eq, gt, lt, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'

import { EmbeddingService } from '../services/embedding'
import { chats, folders, messages, syncState } from './schema/message'

type Message = InferModel<typeof messages>
type NewMessage = InferModel<typeof messages, 'insert'>
type Chat = InferModel<typeof chats>
type NewChat = InferModel<typeof chats, 'insert'>
type Folder = InferModel<typeof folders>
type NewFolder = InferModel<typeof folders, 'insert'>

// Database connection
const connectionString = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/tg_search'
const client = postgres(connectionString, {
  max: 1,
  onnotice: () => {},
})
export const db = drizzle(client)

const logger = useLogger()

// Initialize embedding service
const embeddingService = new EmbeddingService()

// Message operations
export interface MessageCreateInput {
  id: number
  chatId: number
  type?: 'text' | 'photo' | 'video' | 'document' | 'sticker' | 'other'
  content?: string
  fromId?: number
  replyToId?: number
  forwardFromChatId?: number
  forwardFromMessageId?: number
  views?: number
  forwards?: number
  createdAt: Date
}

export interface SearchOptions {
  chatId?: number
  type?: 'text' | 'photo' | 'video' | 'document' | 'sticker' | 'other'
  startTime?: Date
  endTime?: Date
  limit?: number
  offset?: number
}

/**
 * Create a new message
 */
export async function createMessage(data: NewMessage | NewMessage[]): Promise<Message[]> {
  const messageArray = Array.isArray(data) ? data : [data]
  logger.debug(`正在保存 ${messageArray.length} 条消息到数据库`)

  try {
    // Insert messages without embeddings
    const result = await db.insert(messages).values(
      messageArray.map(msg => ({
        id: msg.id,
        chatId: msg.chatId,
        type: msg.type || 'text',
        content: msg.content || null,
        embedding: null,
        mediaInfo: msg.mediaInfo || null,
        createdAt: msg.createdAt,
        fromId: msg.fromId || null,
        replyToId: msg.replyToId || null,
        forwardFromChatId: msg.forwardFromChatId || null,
        forwardFromMessageId: msg.forwardFromMessageId || null,
        views: msg.views || null,
        forwards: msg.forwards || null,
      }))
    ).onConflictDoNothing().returning()

    if (result.length > 0) {
      logger.debug(`已保存 ${result.length} 条消息`)
    }

    return result
  }
  catch (error) {
    logger.withError(error).error('保存消息失败')
    throw error
  }
}

/**
 * Find similar messages by vector similarity
 */
export async function findSimilarMessages(embedding: number[], options: SearchOptions = {}) {
  const {
    chatId,
    type,
    startTime,
    endTime,
    limit = 10,
    offset = 0,
  } = options

  // Build where conditions
  const conditions = []
  if (chatId)
    conditions.push(eq(messages.chatId, chatId))
  if (type)
    conditions.push(eq(messages.type, type))
  if (startTime)
    conditions.push(gt(messages.createdAt, startTime))
  if (endTime)
    conditions.push(lt(messages.createdAt, endTime))

  // Add condition for non-null embedding
  conditions.push(sql`${messages.embedding} IS NOT NULL`)

  // Convert embedding array to PG array syntax
  const embeddingStr = `'[${embedding.join(',')}]'`

  const query = db.select({
    id: messages.id,
    chatId: messages.chatId,
    type: messages.type,
    content: messages.content,
    createdAt: messages.createdAt,
    fromId: messages.fromId,
    similarity: sql<number>`1 - (${messages.embedding}::vector <=> ${sql.raw(embeddingStr)}::vector)`.as('similarity'),
  })
    .from(messages)
    .where(and(...conditions))
    .orderBy(sql`similarity DESC`)
    .limit(limit)
    .offset(offset)

  return query
}

/**
 * Find messages by chat ID
 */
export async function findMessagesByChatId(chatId: number) {
  return db.select()
    .from(messages)
    .where(eq(messages.chatId, chatId))
}

/**
 * Find message by ID
 */
export async function findMessageById(id: number) {
  return db.select()
    .from(messages)
    .where(eq(messages.id, id))
    .limit(1)
    .then(res => res[0])
}

/**
 * Get message statistics for a chat
 */
export async function getChatStats(chatId: number) {
  const [totalResult, typeResult] = await Promise.all([
    // Get total message count
    db.select({ count: count() })
      .from(messages)
      .where(eq(messages.chatId, chatId))
      .then(res => res[0].count),

    // Get message count by type
    db.select({ type: messages.type, count: count() })
      .from(messages)
      .where(eq(messages.chatId, chatId))
      .groupBy(messages.type),
  ])

  return {
    total: Number(totalResult),
    byType: Object.fromEntries(
      typeResult.map(({ type, count }) => [type, Number(count)]),
    ),
  }
}

/**
 * Get all chats in database with message counts
 */
export async function getAllChats() {
  return db.select().from(chats).orderBy(chats.lastMessageDate)
}

/**
 * Get all folders in database
 */
export async function getAllFolders() {
  return db.select().from(folders)
}

/**
 * Get chats in folder
 */
export async function getChatsInFolder(folderId: number) {
  return db.select()
    .from(chats)
    .where(eq(chats.folderId, folderId))
    .orderBy(chats.lastMessageDate)
}

/**
 * Update chat info
 */
export async function updateChat(data: NewChat) {
  return db.insert(chats)
    .values(data)
    .onConflictDoUpdate({
      target: chats.id,
      set: {
        name: data.name,
        type: data.type,
        lastMessage: data.lastMessage,
        lastMessageDate: data.lastMessageDate,
        lastSyncTime: data.lastSyncTime,
        messageCount: data.messageCount,
        folderId: data.folderId,
      },
    })
    .returning()
}

/**
 * Update folder info
 */
export async function updateFolder(data: NewFolder) {
  return db.insert(folders)
    .values(data)
    .onConflictDoUpdate({
      target: folders.id,
      set: {
        title: data.title,
        emoji: data.emoji,
        lastSyncTime: data.lastSyncTime,
      },
    })
    .returning()
}

export {
  type Message,
  messages,
  type NewMessage,
  type Chat,
  chats,
  type NewChat,
  type Folder,
  folders,
  type NewFolder,
  syncState,
}
