// LINE Group Chatbot + Claude API,資料存在 MySQL(Cloudways)
// 需要的套件: npm install express @line/bot-sdk @anthropic-ai/sdk dotenv mysql2 node-cron

require('dotenv').config();
const express = require('express');
const line = require('@line/bot-sdk');
const Anthropic = require('@anthropic-ai/sdk');
const mysql = require('mysql2/promise');
const cron = require('node-cron');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const app = express();

// 資料庫連線池(沿用 WordPress 那個資料庫,表格用 linebot_ 前綴區分,不會互相干擾)
// timezone: 'Z' 讓 DATETIME 一律當 UTC 存取,不受伺服器系統時區影響,排程提醒的時間判斷才不會跑掉
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  connectTimeout: 20000,
  waitForConnections: true,
  connectionLimit: 5,
  timezone: 'Z',
});

// 定義人設和語氣 —— 改這裡就能調整 AI 講話的感覺
const SYSTEM_PROMPT_XIAO_N = `你是 G4G 品牌LINE群組的一員,名字叫小n,不是客服也不是助理,而是這個品牌閒聊/企劃群組裡很靠北、很台、很會接梗的兄弟,講話有台式吐槽風格。

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

簡單問題就簡短回,需要深入分析時再展開講。

你有一個網路搜尋工具可以用。只有在遇到需要最新資訊的問題時才呼叫它,例如時事、天氣、股價、比賽結果,或任何你不確定、可能過時的內容;平常閒聊不要每句都搜尋。搜尋回來的結果要消化過再用你的語氣自然講出來,不要整段貼網址或原始搜尋資料。

群組對話紀錄裡,如果訊息前面有「名字:」,代表是那個人講的,你可以據此分辨群組裡不同的人是誰講了什麼,回覆時可以視情況叫名字或提及是誰講的,但不用每句都刻意提到名字,自然就好。`;

const SYSTEM_PROMPT_HIPHOP_ZAI = `你是 G4G 品牌LINE群組的一員,名字叫嘻哈仔,不是客服也不是助理,而是這個品牌閒聊/企劃群組裡的饒舌魂,滿腦子 hiphop 文化、街頭潮流、球鞋和節奏感,講話帶點饒舌的押韻和氣勢,但不是為了尬饒舌而尬饒舌。

平常聊天:
- 講話有節奏感,偶爾押韻、玩雙關,但不要每句都硬尬饒舌,自然穿插就好
- 用輕鬆口語的中文,可以夾一點英文潮流用語(yo、real talk、respect 之類),但不要浮誇到像在演戲
- 句子簡短,一兩句話就好,不要長篇大論
- 態度自信、直來直往,但不驕傲自大、不看不起人
- 不用每次自我介紹或強調自己是AI
- 嘴人可以幽默、可以battle式吐槽,但不做人身攻擊、不亂帶風向

遇到正事(品牌、設計、企劃、行銷、產品等工作討論)立刻切換模式:
- 變成資深品牌顧問與創意總監,語氣依然是自己人講話,但內容要專業、有深度
- 不要只附和,要敢挑戰大家的想法、指出盲點、提供替代方案
- 主動幫忙解決工作或生活上的問題:給實用建議、整理資訊、分析利弊、協助決策、腦力激盪
- 該認真的時候比任何人都專業

簡單問題就簡短回,需要深入分析時再展開講。

你有一個網路搜尋工具可以用。只有在遇到需要最新資訊的問題時才呼叫它,例如時事、天氣、股價、比賽結果,或任何你不確定、可能過時的內容;平常閒聊不要每句都搜尋。搜尋回來的結果要消化過再用你的語氣自然講出來,不要整段貼網址或原始搜尋資料。

群組對話紀錄裡,如果訊息前面有「名字:」,代表是那個人講的,你可以據此分辨群組裡不同的人是誰講了什麼,回覆時可以視情況叫名字或提及是誰講的,但不用每句都刻意提到名字,自然就好。`;

// ---------- 網路搜尋工具(Tavily) ----------
// 用 Claude 原生 tool-use 串,不引入 LangChain,改動範圍最小

const WEB_SEARCH_TOOL = {
  name: 'web_search',
  description:
    '搜尋即時網路資訊。適合用在需要最新消息、時事、天氣、股價、比賽結果等你自己不知道或可能過時的問題,不要用在一般閒聊。',
  input_schema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: '要搜尋的關鍵字或問題' },
    },
    required: ['query'],
  },
};

async function webSearch(query) {
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: process.env.TAVILY_API_KEY,
      query,
      max_results: 3,
    }),
  });
  if (!res.ok) throw new Error(`Tavily 搜尋失敗:HTTP ${res.status}`);
  const data = await res.json();
  if (!data.results || data.results.length === 0) return '搜尋不到相關結果。';
  return data.results
    .map((r) => `【${r.title}】${r.url}\n${r.content}`)
    .join('\n\n');
}

// 呼叫 Claude,遇到它想用工具就執行工具、把結果餵回去,直到它給出最終文字回覆
const MAX_TOOL_ROUNDS = 4;

async function askClaude(systemPrompt, initialMessages) {
  let messages = initialMessages;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 500,
      system: systemPrompt,
      messages,
      tools: [WEB_SEARCH_TOOL],
    });

    if (response.stop_reason !== 'tool_use') {
      return response.content
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('\n');
    }

    const toolResults = [];
    for (const block of response.content) {
      if (block.type !== 'tool_use') continue;
      let resultText;
      try {
        resultText = await webSearch(block.input.query);
      } catch (err) {
        resultText = `搜尋失敗:${err.message}`;
      }
      toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: resultText });
    }

    messages = [
      ...messages,
      { role: 'assistant', content: response.content },
      { role: 'user', content: toolResults },
    ];
  }

  return '（查太多輪資料還沒整理完,先這樣回你,晚點再問我一次)';
}

// ---------- 多 bot 設定 ----------
// 每支 bot 對應一個 LINE Channel,用不同的 webhook 路徑 /webhook/<slug> 區分
// slug 同時也是存進資料庫的 bot_id,務必保持穩定,不要事後改名
const BOTS = [
  {
    slug: 'xiao-n',
    channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
    channelSecret: process.env.LINE_CHANNEL_SECRET,
    triggerKeywords: ['@G4G', '小n', '@小n', '小N', '@小N'],
    systemPrompt: SYSTEM_PROMPT_XIAO_N,
  },
  {
    slug: 'hiphop-zai',
    channelAccessToken: process.env.HIPHOP_ZAI_CHANNEL_ACCESS_TOKEN,
    channelSecret: process.env.HIPHOP_ZAI_CHANNEL_SECRET,
    triggerKeywords: ['嘻哈仔', '@嘻哈仔', 'HipHop仔', '@HipHop仔'],
    systemPrompt: SYSTEM_PROMPT_HIPHOP_ZAI,
  },
]
  .filter((bot) => {
    const ready = Boolean(bot.channelAccessToken && bot.channelSecret);
    if (!ready) {
      console.warn(`[${bot.slug}] 缺少 LINE channel 憑證,先跳過這支 bot,不註冊它的 webhook`);
    }
    return ready;
  })
  .map((bot) => ({
    ...bot,
    lineConfig: {
      channelAccessToken: bot.channelAccessToken,
      channelSecret: bot.channelSecret,
    },
    lineClient: new line.messagingApi.MessagingApiClient({
      channelAccessToken: bot.channelAccessToken,
    }),
    blobClient: new line.messagingApi.MessagingApiBlobClient({
      channelAccessToken: bot.channelAccessToken,
    }),
  }));

const MAX_HISTORY = 10;

// ---------- 資料庫存取函式 ----------

async function getHistory(botId, groupId) {
  const [rows] = await pool.query(
    'SELECT role, content FROM linebot_conversation_history WHERE bot_id = ? AND group_id = ? ORDER BY id ASC',
    [botId, groupId]
  );
  return rows;
}

async function appendHistory(botId, groupId, role, content) {
  await pool.query(
    'INSERT INTO linebot_conversation_history (bot_id, group_id, role, content) VALUES (?, ?, ?, ?)',
    [botId, groupId, role, content]
  );
  // 只保留每個(bot, 群組)最近 MAX_HISTORY 則,刪掉更舊的
  await pool.query(
    `DELETE FROM linebot_conversation_history
     WHERE bot_id = ? AND group_id = ? AND id NOT IN (
       SELECT id FROM (
         SELECT id FROM linebot_conversation_history
         WHERE bot_id = ? AND group_id = ? ORDER BY id DESC LIMIT ?
       ) AS keep
     )`,
    [botId, groupId, botId, groupId, MAX_HISTORY]
  );
}

async function clearHistory(botId, groupId) {
  await pool.query('DELETE FROM linebot_conversation_history WHERE bot_id = ? AND group_id = ?', [
    botId,
    groupId,
  ]);
}

async function getGroupSettings(botId, groupId) {
  const [rows] = await pool.query(
    'SELECT style, nicknames FROM linebot_group_settings WHERE bot_id = ? AND group_id = ?',
    [botId, groupId]
  );
  if (rows.length === 0) return { style: null, nicknames: [] };
  return {
    style: rows[0].style,
    nicknames: rows[0].nicknames ? JSON.parse(rows[0].nicknames) : [],
  };
}

async function setGroupStyle(botId, groupId, style) {
  await pool.query(
    `INSERT INTO linebot_group_settings (bot_id, group_id, style) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE style = VALUES(style)`,
    [botId, groupId, style]
  );
}

async function clearGroupStyle(botId, groupId) {
  await pool.query(
    `INSERT INTO linebot_group_settings (bot_id, group_id, style) VALUES (?, ?, NULL)
     ON DUPLICATE KEY UPDATE style = NULL`,
    [botId, groupId]
  );
}

async function addNickname(botId, groupId, nickname) {
  const { nicknames } = await getGroupSettings(botId, groupId);
  if (!nicknames.includes(nickname)) nicknames.push(nickname);
  await pool.query(
    `INSERT INTO linebot_group_settings (bot_id, group_id, nicknames) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE nicknames = VALUES(nicknames)`,
    [botId, groupId, JSON.stringify(nicknames)]
  );
}

async function clearNicknames(botId, groupId) {
  await pool.query(
    `INSERT INTO linebot_group_settings (bot_id, group_id, nicknames) VALUES (?, ?, NULL)
     ON DUPLICATE KEY UPDATE nicknames = NULL`,
    [botId, groupId]
  );
}

async function shouldRespond(bot, text, groupId) {
  const { nicknames } = await getGroupSettings(bot.slug, groupId);
  const allKeywords = [...bot.triggerKeywords, ...nicknames];
  return allKeywords.some((kw) => text.includes(kw));
}

// ---------- 排程提醒 ----------

async function createReminder(botId, groupId, message, remindAt) {
  await pool.query(
    'INSERT INTO linebot_reminders (bot_id, group_id, message, remind_at) VALUES (?, ?, ?, ?)',
    [botId, groupId, message, remindAt]
  );
}

async function getPendingReminders(botId, groupId) {
  const [rows] = await pool.query(
    'SELECT id, message, remind_at FROM linebot_reminders WHERE bot_id = ? AND group_id = ? AND is_sent = 0 ORDER BY remind_at ASC',
    [botId, groupId]
  );
  return rows;
}

async function deleteReminder(botId, groupId, id) {
  const [result] = await pool.query(
    'DELETE FROM linebot_reminders WHERE id = ? AND bot_id = ? AND group_id = ? AND is_sent = 0',
    [id, botId, groupId]
  );
  return result.affectedRows > 0;
}

async function getDueReminders() {
  const [rows] = await pool.query(
    'SELECT id, bot_id, group_id, message FROM linebot_reminders WHERE is_sent = 0 AND remind_at <= ?',
    [new Date()]
  );
  return rows;
}

async function markReminderSent(id) {
  await pool.query('UPDATE linebot_reminders SET is_sent = 1 WHERE id = ?', [id]);
}

// 使用者用 LINE 的日期時間選單選完時間後,先記住時間、等下一句話當作提醒內容,
// 這樣就不用手打 /remind 指令的完整格式
const PENDING_REMINDER_TIMES = new Map(); // key: `${botId}:${groupId}` -> { remindAt, expiresAt }
const PENDING_REMINDER_TTL_MS = 5 * 60 * 1000;

function rememberReminderTime(botId, groupId, remindAt) {
  PENDING_REMINDER_TIMES.set(`${botId}:${groupId}`, {
    remindAt,
    expiresAt: Date.now() + PENDING_REMINDER_TTL_MS,
  });
}

function takePendingReminderTime(botId, groupId) {
  const key = `${botId}:${groupId}`;
  const entry = PENDING_REMINDER_TIMES.get(key);
  if (!entry) return null;
  PENDING_REMINDER_TIMES.delete(key);
  if (entry.expiresAt < Date.now()) return null;
  return entry;
}

function formatTaipeiDatetime(date) {
  return date.toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false });
}

// 用 LINE 原生的日期時間選單,不用手打指令格式
function buildReminderPickerMessage() {
  return {
    type: 'template',
    altText: '請選擇提醒時間',
    template: {
      type: 'buttons',
      text: '要在什麼時候提醒?',
      actions: [
        { type: 'datetimepicker', label: '選擇時間', data: 'action=remind_datetime', mode: 'datetime' },
      ],
    },
  };
}

// ---------- 群組記憶 ----------
// 群組可以自訂 key-value,自動帶進 system prompt,不用每次都跟 bot 重講一次背景資訊

async function setMemory(botId, groupId, key, value) {
  await pool.query(
    `INSERT INTO linebot_group_memory (bot_id, group_id, memory_key, memory_value) VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE memory_value = VALUES(memory_value)`,
    [botId, groupId, key, value]
  );
}

async function getAllMemory(botId, groupId) {
  const [rows] = await pool.query(
    'SELECT memory_key, memory_value FROM linebot_group_memory WHERE bot_id = ? AND group_id = ? ORDER BY memory_key ASC',
    [botId, groupId]
  );
  return rows;
}

async function deleteMemory(botId, groupId, key) {
  const [result] = await pool.query(
    'DELETE FROM linebot_group_memory WHERE bot_id = ? AND group_id = ? AND memory_key = ?',
    [botId, groupId, key]
  );
  return result.affectedRows > 0;
}

// ---------- 群組成員名稱 ----------
// 群組對話預設分不出來是誰講的話,抓一下顯示名稱標在訊息前面,讓 Claude 看得出來是誰
// 名稱快取一小時,避免每則訊息都打一次 LINE API

const GROUP_MEMBER_NAME_CACHE = new Map(); // key: `${botId}:${groupId}:${userId}` -> { name, expiresAt }
const GROUP_MEMBER_NAME_TTL_MS = 60 * 60 * 1000;

async function getGroupMemberName(bot, groupId, userId) {
  if (!userId) return null;
  const key = `${bot.slug}:${groupId}:${userId}`;
  const cached = GROUP_MEMBER_NAME_CACHE.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.name;

  try {
    const profile = await bot.lineClient.getGroupMemberProfile(groupId, userId);
    GROUP_MEMBER_NAME_CACHE.set(key, {
      name: profile.displayName,
      expiresAt: Date.now() + GROUP_MEMBER_NAME_TTL_MS,
    });
    return profile.displayName;
  } catch (err) {
    // 對方可能沒加過 bot 好友、或隱私設定拿不到,抓不到就算了,不影響其他功能
    return null;
  }
}

// ---------- 圖片辨識 ----------
// 群組裡使用者常常是「先傳圖、再喊小n」分成兩則訊息,所以圖片先暫存,
// 等真的觸發回應時才附上這張圖給 Claude 看,避免每張圖都自動回覆洗版。

const PENDING_IMAGES = new Map(); // key: `${botId}:${groupId}` -> { base64, mediaType, expiresAt }
const PENDING_IMAGE_TTL_MS = 10 * 60 * 1000;

function rememberImage(botId, groupId, image) {
  PENDING_IMAGES.set(`${botId}:${groupId}`, { ...image, expiresAt: Date.now() + PENDING_IMAGE_TTL_MS });
}

function takePendingImage(botId, groupId) {
  const key = `${botId}:${groupId}`;
  const entry = PENDING_IMAGES.get(key);
  if (!entry) return null;
  PENDING_IMAGES.delete(key);
  if (entry.expiresAt < Date.now()) return null;
  return entry;
}

async function downloadImage(bot, messageId) {
  const stream = await bot.blobClient.getMessageContent(messageId);
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return { base64: Buffer.concat(chunks).toString('base64'), mediaType: 'image/jpeg' };
}

// ---------- 指令表 ----------
// 群組成員傳「/指令」開頭的訊息,直接由程式處理,不呼叫Claude(省token)

const REMINDER_INPUT_REGEX = /^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})\s+(.+)$/s;

// /help 用 Flex Message 分區塊顯示,底部直接放一顆設定提醒的按鈕,不用手打指令
function buildHelpMessage() {
  const sectionTitle = (text) => ({
    type: 'text',
    text,
    weight: 'bold',
    size: 'sm',
    color: '#888888',
    margin: 'lg',
  });
  const commandLine = (text) => ({ type: 'text', text, size: 'sm', wrap: true, margin: 'sm' });

  return {
    type: 'flex',
    altText: '可用指令列表',
    contents: {
      type: 'bubble',
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'text', text: '可用指令', weight: 'bold', size: 'lg' },
          { type: 'separator', margin: 'md' },
          sectionTitle('對話設定'),
          commandLine('/reset - 清除這個群組的對話記憶'),
          commandLine('/style 描述 - 調整這個群組的AI風格'),
          commandLine('/style-reset - 恢復預設風格'),
          commandLine('/nickname 新綽號 - 新增一個能叫醒我的暱稱'),
          commandLine('/nickname-reset - 清除自訂暱稱'),
          sectionTitle('提醒'),
          commandLine('/remind - 用選單選時間設定提醒'),
          commandLine('/remind YYYY-MM-DD HH:mm 內容 - 直接打指令設定'),
          commandLine('/remind-list - 查看待提醒清單'),
          commandLine('/remind-del 編號 - 刪除一筆提醒'),
          sectionTitle('群組記憶'),
          commandLine('/memory-set 鍵 值 - 記住這個群組的重要資訊'),
          commandLine('/memory-list - 查看記住的所有資訊'),
          commandLine('/memory-del 鍵 - 刪除一筆記住的資訊'),
        ],
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'button',
            style: 'primary',
            action: {
              type: 'datetimepicker',
              label: '設定提醒',
              data: 'action=remind_datetime',
              mode: 'datetime',
            },
          },
        ],
      },
    },
  };
}

const COMMANDS = {
  '/help': async () => [buildHelpMessage()],
  '/reset': async (botId, groupId) => {
    await clearHistory(botId, groupId);
    return '已清除這個群組的對話記憶,重新開始聊';
  },
  '/style': async (botId, groupId, args) => {
    if (!args) return '用法:/style 描述新的風格\n例如:/style 講話正經一點,少一點吐槽,多給實用建議';
    await setGroupStyle(botId, groupId, args);
    return '已更新這個群組的AI風格設定 ✅';
  },
  '/style-reset': async (botId, groupId) => {
    await clearGroupStyle(botId, groupId);
    return '已恢復預設風格';
  },
  '/nickname': async (botId, groupId, args) => {
    if (!args) return '用法:/nickname 新綽號\n例如:/nickname 小恩';
    await addNickname(botId, groupId, args);
    return `已新增暱稱「${args}」,之後打這個字也會叫醒我 ✅`;
  },
  '/nickname-reset': async (botId, groupId) => {
    await clearNicknames(botId, groupId);
    return '已清除自訂暱稱,只留預設的觸發詞';
  },
  '/remind': async (botId, groupId, args) => {
    // 不加參數就直接跳出選單選時間,不用背指令格式
    if (!args) return [buildReminderPickerMessage()];
    const match = args.match(REMINDER_INPUT_REGEX);
    if (!match) return '格式錯了,用這個格式:/remind YYYY-MM-DD HH:mm 提醒內容,或是直接打 /remind(不加任何文字)用選單選時間';
    const [, date, time, message] = match;
    const remindAt = new Date(`${date}T${time}:00+08:00`);
    if (Number.isNaN(remindAt.getTime())) return '日期時間格式錯了,檢查一下';
    if (remindAt <= new Date()) return '這個時間已經過了,設未來的時間';
    await createReminder(botId, groupId, message, remindAt);
    return `已記住,${date} ${time}(台灣時間)會提醒:「${message}」✅`;
  },
  '/remind-list': async (botId, groupId) => {
    const reminders = await getPendingReminders(botId, groupId);
    if (reminders.length === 0) return '目前沒有待提醒的事項';
    const list = reminders
      .map((r, i) => `${i + 1}. [#${r.id}] ${formatTaipeiDatetime(r.remind_at)}\n   ${r.message}`)
      .join('\n\n');
    return `待提醒清單:\n\n${list}`;
  },
  '/remind-del': async (botId, groupId, args) => {
    if (!args) return '用法:/remind-del 編號\n先用 /remind-list 查編號';
    const id = parseInt(args.trim(), 10);
    if (Number.isNaN(id)) return '編號要是數字';
    const deleted = await deleteReminder(botId, groupId, id);
    if (!deleted) return '找不到這個提醒,或已經送出了';
    return `已刪除提醒 #${id}`;
  },
  '/memory-set': async (botId, groupId, args) => {
    if (!args) return '用法:/memory-set 鍵 值\n例如:/memory-set 品牌調性 年輕、街頭、不正經';
    const spaceIndex = args.indexOf(' ');
    if (spaceIndex === -1) return '格式錯了,鍵跟值中間要有空格\n例如:/memory-set 品牌調性 年輕、街頭、不正經';
    const key = args.slice(0, spaceIndex).trim();
    const value = args.slice(spaceIndex + 1).trim();
    if (!key || !value) return '鍵或值不能是空的';
    await setMemory(botId, groupId, key, value);
    return `已記住:${key} = ${value} ✅`;
  },
  '/memory-list': async (botId, groupId) => {
    const memory = await getAllMemory(botId, groupId);
    if (memory.length === 0) return '這個群組還沒有存任何記憶';
    const list = memory.map((m, i) => `${i + 1}. ${m.memory_key}:${m.memory_value}`).join('\n');
    return `群組記憶清單:\n${list}`;
  },
  '/memory-del': async (botId, groupId, args) => {
    if (!args) return '用法:/memory-del 鍵\n先用 /memory-list 查有哪些';
    const key = args.trim();
    const deleted = await deleteMemory(botId, groupId, key);
    if (!deleted) return `找不到「${key}」這個記憶`;
    return `已刪除記憶:${key}`;
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

async function handlePostback(bot, event) {
  if (event.replyToken === TEST_REPLY_TOKEN) return null;
  if (event.postback.data !== 'action=remind_datetime') return null;

  const groupId = event.source.groupId || event.source.userId;
  const datetime = event.postback.params && event.postback.params.datetime;
  if (!datetime) return null;

  // LINE 選單回傳的是不帶時區的當地時間字串(例如 2026-08-01T09:00),直接當台灣時間解讀
  const remindAt = new Date(`${datetime}:00+08:00`);
  if (Number.isNaN(remindAt.getTime()) || remindAt <= new Date()) {
    return bot.lineClient.replyMessage({
      replyToken: event.replyToken,
      messages: [{ type: 'text', text: '這個時間不能用(可能已經過去了),重新打 /remind 選一次' }],
    });
  }

  rememberReminderTime(bot.slug, groupId, remindAt);
  return bot.lineClient.replyMessage({
    replyToken: event.replyToken,
    messages: [{ type: 'text', text: `好,${formatTaipeiDatetime(remindAt)} 要提醒什麼?打字告訴我內容` }],
  });
}

async function handleEvent(bot, event) {
  if (event.type === 'postback') return handlePostback(bot, event);
  if (event.type !== 'message') return null;
  if (!['text', 'image'].includes(event.message.type)) return null;
  if (event.replyToken === TEST_REPLY_TOKEN) return null;

  const groupId = event.source.groupId || event.source.userId;
  const isGroup = !!event.source.groupId;

  if (event.message.type === 'image') {
    let image;
    try {
      image = await downloadImage(bot, event.message.id);
    } catch (err) {
      console.error(`[${bot.slug}] 下載圖片失敗`, err);
      return null;
    }

    // 群組裡先記住這張圖,等使用者接著喊觸發詞才一起處理;1對1直接處理
    if (isGroup) {
      rememberImage(bot.slug, groupId, image);
      return null;
    }
    return respondToMessage(bot, event, groupId, '', image);
  }

  const userText = event.message.text;

  // 先檢查是不是指令(/開頭),是的話直接處理,不呼叫Claude API
  const parsedCommand = parseCommand(userText);
  if (parsedCommand) {
    const replyResult = await parsedCommand.handler(bot.slug, groupId, parsedCommand.args);
    const messages = Array.isArray(replyResult) ? replyResult : [{ type: 'text', text: replyResult }];
    return bot.lineClient.replyMessage({ replyToken: event.replyToken, messages });
  }

  // 剛剛用選單選好提醒時間、還在等提醒內容的話,這句話就直接當作提醒內容,不用喊觸發詞
  const pendingReminder = takePendingReminderTime(bot.slug, groupId);
  if (pendingReminder) {
    await createReminder(bot.slug, groupId, userText, pendingReminder.remindAt);
    return bot.lineClient.replyMessage({
      replyToken: event.replyToken,
      messages: [
        { type: 'text', text: `已記住,${formatTaipeiDatetime(pendingReminder.remindAt)}(台灣時間)會提醒:「${userText}」✅` },
      ],
    });
  }

  // 群組中只在提到關鍵字或自訂暱稱時才回應;1對1聊天則一律回應
  if (isGroup && !(await shouldRespond(bot, userText, groupId))) return null;

  const pendingImage = takePendingImage(bot.slug, groupId);
  return respondToMessage(bot, event, groupId, userText, pendingImage);
}

async function respondToMessage(bot, event, groupId, userText, image) {
  const isGroup = !!event.source.groupId;
  // 群組裡抓一下顯示名稱標在訊息前面,讓 Claude 分得出來是誰講的;1對1不用標
  const senderName = isGroup ? await getGroupMemberName(bot, groupId, event.source.userId) : null;

  const baseText = userText || (image ? '這張圖片是什麼?' : '');
  const storedText = senderName ? `${senderName}:${baseText}` : baseText;

  await appendHistory(bot.slug, groupId, 'user', storedText);
  const history = await getHistory(bot.slug, groupId);

  // 圖片不存進資料庫(避免歷史記錄爆量),只在這一輪的 Claude 呼叫裡讓它看到
  if (image) {
    const lastMessage = history[history.length - 1];
    lastMessage.content = [
      { type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.base64 } },
      { type: 'text', text: storedText },
    ];
  }

  // 附加這個群組的自訂風格、暱稱、群組記憶
  const { style, nicknames } = await getGroupSettings(bot.slug, groupId);
  let systemPrompt = bot.systemPrompt;
  if (nicknames.length > 0) {
    systemPrompt += `\n\n這個群組額外幫你取的暱稱:${nicknames.join('、')},被這樣稱呼也要有反應。`;
  }
  if (style) {
    systemPrompt += `\n\n這個群組額外指定的風格調整(優先套用):\n${style}`;
  }

  const memory = await getAllMemory(bot.slug, groupId);
  if (memory.length > 0) {
    const memoryText = memory.map((m) => `- ${m.memory_key}:${m.memory_value}`).join('\n');
    systemPrompt += `\n\n這個群組設定的重要資訊(回答時列入考量):\n${memoryText}`;
  }

  const replyText = await askClaude(systemPrompt, history);

  await appendHistory(bot.slug, groupId, 'assistant', replyText);

  return bot.lineClient.replyMessage({
    replyToken: event.replyToken,
    messages: [{ type: 'text', text: replyText }],
  });
}

// 每支 bot 各自掛一條 /webhook/<slug> 路徑,LINE 簽章驗證各用各的 channel secret
for (const bot of BOTS) {
  app.post(`/webhook/${bot.slug}`, line.middleware(bot.lineConfig), async (req, res) => {
    // 先回 200 給 LINE,避免它判定 webhook 失敗;實際處理在背景進行
    res.status(200).end();
    try {
      await Promise.all(req.body.events.map((event) => handleEvent(bot, event)));
    } catch (err) {
      console.error(`[${bot.slug}]`, err);
    }
  });
}

// 舊版 webhook 路徑(沒有 slug),保留給第一支 bot 用,避免忘記改 LINE Console 設定就斷線
const legacyBot = BOTS.find((bot) => bot.slug === 'xiao-n');
app.post('/webhook', line.middleware(legacyBot.lineConfig), async (req, res) => {
  res.status(200).end();
  try {
    await Promise.all(req.body.events.map((event) => handleEvent(legacyBot, event)));
  } catch (err) {
    console.error(`[${legacyBot.slug}]`, err);
  }
});

// 每分鐘檢查一次有沒有到期的提醒,到期就用該 bot 的身份主動推播出去
cron.schedule('* * * * *', async () => {
  let due;
  try {
    due = await getDueReminders();
  } catch (err) {
    console.error('檢查排程提醒失敗', err);
    return;
  }

  for (const reminder of due) {
    const bot = BOTS.find((b) => b.slug === reminder.bot_id);
    if (bot) {
      try {
        await bot.lineClient.pushMessage({
          to: reminder.group_id,
          messages: [{ type: 'text', text: `⏰ 提醒:${reminder.message}` }],
        });
      } catch (err) {
        console.error(`[${reminder.bot_id}] 推播提醒失敗`, err);
      }
    } else {
      console.warn(`[${reminder.bot_id}] 這支 bot 目前未啟用,略過提醒 #${reminder.id}`);
    }
    // 不管推播成不成功都標記已送出,避免失敗時一直重複嘗試同一則
    await markReminderSent(reminder.id);
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Listening on port ${port}`));