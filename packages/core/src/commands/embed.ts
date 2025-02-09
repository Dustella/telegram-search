import { useLogger } from '@tg-search/common'
import { Command } from 'commander'
import { and, eq, isNull, sql, type SQL } from 'drizzle-orm'

import { db } from '../db'
import { messages } from '../db/schema/message'
import { EmbeddingService } from '../services/embedding'

interface EmbedOptions {
  batchSize?: number
  chatId?: number
}

/**
 * Generate embeddings for messages that don't have them
 */
export default async function embed(options: Partial<EmbedOptions> = {}) {
  const logger = useLogger()
  const embedding = new EmbeddingService()

  // 如果没有直接传入参数，则从命令行获取
  if (!options.batchSize) {
    const program = new Command()
    program
      .option('-b, --batch-size <size>', 'Batch size for processing', '100')
      .option('-c, --chat-id <id>', 'Only process messages from this chat')
      .parse()

    const opts = program.opts()
    options.batchSize = Number(opts.batchSize)
    options.chatId = opts.chatId ? Number(opts.chatId) : undefined
  }

  const batchSize = options.batchSize || 100

  try {
    // 构建查询条件
    const conditions: SQL[] = [isNull(messages.embedding)]
    if (options.chatId) {
      conditions.push(eq(messages.chatId, options.chatId))
    }

    // 获取需要处理的消息总数
    const [{ count }] = await db
      .select({ count: sql<number>`count(${messages.id})` })
      .from(messages)
      .where(and(...conditions))

    if (count === 0) {
      logger.log('没有需要处理的消息')
      return
    }

    logger.log(`找到 ${count} 条消息需要生成向量嵌入`)
    let processed = 0
    let failed = 0

    while (processed < count) {
      // 获取一批消息
      const batch = await db
        .select({
          id: messages.id,
          content: messages.content,
        })
        .from(messages)
        .where(and(...conditions))
        .limit(batchSize)

      if (batch.length === 0) break

      try {
        // 过滤并准备文本
        const validBatch = batch.filter(msg => msg.content && msg.content.trim().length > 0)
        if (validBatch.length === 0) {
          logger.warn('批次中没有有效的消息内容，跳过')
          processed += batch.length
          failed += batch.length
          continue
        }

        // 生成向量嵌入
        const texts = validBatch.map(msg => msg.content!.trim())
        const embeddings = await embedding.generateEmbeddings(texts)

        // 批量更新
        await Promise.all(
          validBatch.map((msg, idx) =>
            db
              .update(messages)
              .set({ embedding: embeddings[idx] })
              .where(eq(messages.id, msg.id))
          )
        )

        const skipped = batch.length - validBatch.length
        processed += batch.length
        failed += skipped
        logger.debug(`已处理 ${processed}/${count} 条消息，本批次跳过 ${skipped} 条空消息`)
      }
      catch (error) {
        logger.withError(error).warn(`处理消息批次时失败，跳过 ${batch.length} 条消息`)
        failed += batch.length
        processed += batch.length
      }
    }

    logger.log(`处理完成，共处理 ${processed} 条消息，${failed} 条消息失败或被跳过`)
  }
  catch (error) {
    logger.withError(error).error('生成向量嵌入失败')
    process.exit(1)
  }
} 
