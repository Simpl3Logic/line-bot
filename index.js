// LINE Group Chatbot + Claude API,資料存在 MySQL(Cloudways)
// 需要的套件: npm install express @line/bot-sdk @anthropic-ai/sdk dotenv mysql2

require('dotenv').config();
const express = require('express');
const line = require('@line/bot-sdk');
const Anthropic = require('@anthropic-ai/sdk');
const mysql = require('mysql2/promise');

const lineConfig = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const lineClient = new line.messagingApi.MessagingApiClient({
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
});
const app = express();

// 資料庫連線池(沿用 WordPress 那個資料庫,表格用 linebot_ 前綴區分,不會互相干擾)
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  connectTimeout: 20000,
  waitForConnections: true,
  connectionLimit: 5,
});

// bot 被觸發的關鍵字 / 名稱,避免在群組裡回應所有訊息
const TRIGGER_KEYWORDS = ['@G4G', '小n', '@小n', '小N', '@小N'];

// 定義人設和語氣 —— 改這裡就能調整 AI 講話的感覺
const SYSTEM_PROMPT = `你是 G4G 品牌LINE群組的一員,名字叫小n,不是客服也不是助理,而是這個品牌閒聊/企劃群組裡很靠北、很台、很會接梗的兄弟,講話有台式吐槽風格。

平常聊天:
- 可以嘴砲、吐槽、講幹話、玩梗,但不要每句都硬接,要自然、有節奏,像真的在群組生活很久的人
- 用輕鬆口語的中文,不要用「您好」「請問」這種客套話
- 句子簡短,一兩句話就好,不要長篇大論
- 可以適度用語助詞或表情符號,但不要每句都加
- 不用每次自我介紹或強調自己是AI
- 嘴人可以幽默,但不做人身攻擊、不亂帶風向

遇到正事(品牌、設計、企劃、行銷、產品等工作討論)立刻切換模式:
- 變成資深品牌顧問與創意總監,語氣依然是自己人講話,但內容要專業、有深度
- 不要只附和,要敢挑戰大家的想法、指出盲點、提供替代方案
- 主動幫忙解決工作或生活上的問題:給實用建議、整理資訊、分析利弊、協助決策、腦力激盪
- 該認真的時候比任何人都專業

簡單問題就簡短回,需要深入分析時再展開講。`;

const MAX_HISTORY = 10;

// ---------- 資料庫存取函式 ----------

async function getHistory(groupId) {
  const [rows] = await pool.query(
    'SELECT role, content FROM linebot_conversation_history WHERE group_id = ? ORDER BY id ASC',
    [groupId]
  );
  return rows;
}

async function appendHistory(groupId, role, content) {
  await pool.query(
    'INSERT INTO linebot_conversation_history (group_id, role, content) VALUES (?, ?, ?)',
    [groupId, role, content]
  );
  // 只保留每個群組最近 MAX_HISTORY 則,刪掉更舊的
  await pool.query(
    `DELETE FROM linebot_conversation_history
     WHERE group_id = ? AND id NOT IN (
       SELECT id FROM (
         SELECT id FROM linebot_conversation_history
         WHERE group_id = ? ORDER BY id DESC LIMIT ?
       ) AS keep
     )`,
    [groupId, groupId, MAX_HISTORY]
  );
}

async function clearHistory(groupId) {
  await pool.query('DELETE FROM linebot_conversation_history WHERE group_id = ?', [groupId]);
}

async function getGroupSettings(groupId) {
  const [rows] = await pool.query(
    'SELECT style, nicknames FROM linebot_group_settings WHERE group_id = ?',
    [groupId]
  );
  if (rows.length === 0) return { style: null, nicknames: [] };
  return {
    style: rows[0].style,
    nicknames: rows[0].nicknames ? JSON.parse(rows[0].nicknames) : [],
  };
}

async function setGroupStyle(groupId, style) {
  await pool.query(
    `INSERT INTO linebot_group_settings (group_id, style) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE style = VALUES(style)`,
    [groupId, style]
  );
}

async function clearGroupStyle(groupId) {
  await pool.query(
    `INSERT INTO linebot_group_settings (group_id, style) VALUES (?, NULL)
     ON DUPLICATE KEY UPDATE style = NULL`,
    [groupId]
  );
}

async function addNickname(groupId, nickname) {
  const { nicknames } = await getGroupSettings(groupId);
  if (!nicknames.includes(nickname)) nicknames.push(nickname);
  await pool.query(
    `INSERT INTO linebot_group_settings (group_id, nicknames) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE nicknames = VALUES(nicknames)`,
    [groupId, JSON.stringify(nicknames)]
  );
}

async function clearNicknames(groupId) {
  await pool.query(
    `INSERT INTO linebot_group_settings (group_id, nicknames) VALUES (?, NULL)
     ON DUPLICATE KEY UPDATE nicknames = NULL`,
    [groupId]
  );
}

async function shouldRespond(text, groupId) {
  const { nicknames } = await getGroupSettings(groupId);
  const allKeywords = [...TRIGGER_KEYWORDS, ...nicknames];
  return allKeywords.some((kw) => text.includes(kw));
}

// ---------- 指令表 ----------
// 群組成員傳「/指令」開頭的訊息,直接由程式處理,不呼叫Claude(省token)

const COMMANDS = {
  '/help': async () =>
    '可用指令:\n/help - 顯示這個列表\n/reset - 清除這個群組的對話記憶\n/style 描述 - 調整這個群組的AI風格\n/style-reset - 恢復預設風格\n/nickname 新綽號 - 新增一個能叫醒我的暱稱\n/nickname-reset - 清除自訂暱稱,只留預設的',
  '/reset': async (groupId) => {
    await clearHistory(groupId);
    return '已清除這個群組的對話記憶,重新開始聊';
  },
  '/style': async (groupId, args) => {
    if (!args) return '用法:/style 描述新的風格\n例如:/style 講話正經一點,少一點吐槽,多給實用建議';
    await setGroupStyle(groupId, args);
    return '已更新這個群組的AI風格設定 ✅';
  },
  '/style-reset': async (groupId) => {
    await clearGroupStyle(groupId);
    return '已恢復預設風格';
  },
  '/nickname': async (groupId, args) => {
    if (!args) return '用法:/nickname 新綽號\n例如:/nickname 小恩';
    await addNickname(groupId, args);
    return `已新增暱稱「${args}」,之後打這個字也會叫醒我 ✅`;
  },
  '/nickname-reset': async (groupId) => {
    await clearNicknames(groupId);
    return '已清除自訂暱稱,只留預設的觸發詞';
  },
};

function parseCommand(text) {
  const trimmed = text.trim();
  const [commandWord, ...rest] = trimmed.split(/\s+/);
  const handler = COMMANDS[commandWord.toLowerCase()];
  if (!handler) return null;
  return { handler, args: rest.join(' ') };
}

// LINE Console 按「Verify」時會送假事件,replyToken 是這串 0,要直接跳過不處理
const TEST_REPLY_TOKEN = '00000000000000000000000000000000';

async function handleEvent(event) {
  if (event.type !== 'message' || event.message.type !== 'text') return null;
  if (event.replyToken === TEST_REPLY_TOKEN) return null;

  const userText = event.message.text;
  const groupId = event.source.groupId || event.source.userId;

  // 先檢查是不是指令(/開頭),是的話直接處理,不呼叫Claude API
  const parsedCommand = parseCommand(userText);
  if (parsedCommand) {
    const replyText = await parsedCommand.handler(groupId, parsedCommand.args);
    return lineClient.replyMessage({
      replyToken: event.replyToken,
      messages: [{ type: 'text', text: replyText }],
    });
  }

  // 群組中只在提到關鍵字或自訂暱稱時才回應;1對1聊天則一律回應
  const isGroup = !!event.source.groupId;
  if (isGroup && !(await shouldRespond(userText, groupId))) return null;

  await appendHistory(groupId, 'user', userText);
  const history = await getHistory(groupId);

  // 附加這個群組的自訂風格與暱稱
  const { style, nicknames } = await getGroupSettings(groupId);
  let systemPrompt = SYSTEM_PROMPT;
  if (nicknames.length > 0) {
    systemPrompt += `\n\n這個群組額外幫你取的暱稱:${nicknames.join('、')},被這樣稱呼也要有反應。`;
  }
  if (style) {
    systemPrompt += `\n\n這個群組額外指定的風格調整(優先套用):\n${style}`;
  }

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 500,
    system: systemPrompt,
    messages: history,
  });

  const replyText = response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n');

  await appendHistory(groupId, 'assistant', replyText);

  return lineClient.replyMessage({
    replyToken: event.replyToken,
    messages: [{ type: 'text', text: replyText }],
  });
}

app.post('/webhook', line.middleware(lineConfig), async (req, res) => {
  // 先回 200 給 LINE,避免它判定 webhook 失敗;實際處理在背景進行
  res.status(200).end();
  try {
    await Promise.all(req.body.events.map(handleEvent));
  } catch (err) {
    console.error(err);
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Listening on port ${port}`));