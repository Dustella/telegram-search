import type { ClientAdapter } from './client'
import type { TelegramMessage } from './types'

import * as input from '@inquirer/prompts'
import { useLogger } from '@tg-search/common'
import { config } from 'dotenv'

import { createMessage } from '../db'
import { createAdapter } from './factory'

// Load environment variables
config()

const logger = useLogger()

process.on('unhandledRejection', (error) => {
  logger.log('Unhandled promise rejection:', String(error))
})

async function watchChat(adapter: ClientAdapter, chatId: number) {
  // Get dialog info
  const result = await adapter.getDialogs(0, 100)
  const selectedDialog = result.dialogs.find(d => d.id === chatId)
  if (!selectedDialog) {
    logger.log('找不到该对话')
    return
  }

  // Get folders
  const folders = await adapter.getFolders(chatId)
  if (folders.length === 0) {
    logger.log('该对话没有文件夹')
    return
  }

  // Let user select a folder
  const folderChoices = folders.map(folder => ({
    name: folder.title,
    value: folder.id,
  }))

  const folderId = await input.select({
    message: '请选择要监听的文件夹：',
    choices: folderChoices,
  })

  logger.log(`\n开始监听 "${selectedDialog.name}" 的 "${folders.find(f => f.id === folderId)?.title}" 文件夹...`)
  let count = 0

  // Setup message handler
  adapter.onMessage(async (message: TelegramMessage) => {
    // Only handle messages from selected chat
    if (message.chatId !== chatId)
      return

    try {
      await createMessage({
        id: message.id,
        chatId: message.chatId,
        type: message.type,
        content: message.content,
        fromId: message.fromId,
        replyToId: message.replyToId,
        forwardFromChatId: message.forwardFromChatId,
        forwardFromMessageId: message.forwardFromMessageId,
        views: message.views,
        forwards: message.forwards,
        createdAt: message.createdAt,
      })
      count++
      logger.log(`[${new Date().toLocaleString()}] 已保存 ${count} 条新消息`)
      if (message.mediaInfo?.localPath) {
        logger.log(`已下载媒体文件: ${message.mediaInfo.localPath}`)
      }
    }
    catch (error) {
      logger.log('保存消息失败:', String(error))
    }
  })

  // Keep the process running
  logger.log('按 Ctrl+C 停止监听')
  process.on('SIGINT', () => {
    logger.log(`\n停止监听，共保存了 ${count} 条新消息。`)
    process.exit(0)
  })
}

async function main() {
  // Check required environment variables
  const apiId = Number(process.env.API_ID)
  const apiHash = process.env.API_HASH
  const phoneNumber = process.env.PHONE_NUMBER

  if (!apiId || !apiHash || !phoneNumber) {
    logger.log('API_ID, API_HASH and PHONE_NUMBER are required')
    process.exit(1)
  }

  // Create client adapter
  const adapter = createAdapter({
    type: 'client',
    apiId,
    apiHash,
    phoneNumber,
  }) as ClientAdapter

  try {
    logger.log('连接到 Telegram...')
    await adapter.connect()
    logger.log('已连接！')

    // Display dialogs and get selected chat ID
    const result = await adapter.getDialogs(0, 100)
    const dialogs = result.dialogs

    // Let user select a dialog
    const choices = dialogs.map(dialog => ({
      name: `[${dialog.type}] ${dialog.name}`,
      value: dialog.id,
    }))

    const chatId = await input.select({
      message: '请选择要监听的对话：',
      choices,
    })

    // Start watching
    await watchChat(adapter, chatId)

    // Keep the process running
    await new Promise(() => {})
  }
  catch (error) {
    logger.log('错误:', String(error))
    await adapter.disconnect()
    process.exit(1)
  }
}

main()
