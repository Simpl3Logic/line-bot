// LINE Group Chatbot + Claude API,資料存在 MySQL(Cloudways)
// 需要的套件: npm install express @line/bot-sdk @anthropic-ai/sdk dotenv mysql2

require('dotenv').config();
const express = require('express');
const line = require('@line/bot-sdk');
const Anthropic = require('@anthropic-ai/sdk');
const mysql = require('mysql2/promise');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
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

你有一個網路搜尋工具可以用。只有在遇到需要最新資訊的問題時才呼叫它,例如時事、天氣、股價、比賽結果,或任何你不確定、可能過時的內容;平常閒聊不要每句都搜尋。搜尋回來的結果要消化過再用你的語氣自然講出來,不要整段貼網址或原始搜尋資料。`;

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

你有一個網路搜尋工具可以用。只有在遇到需要最新資訊的問題時才呼叫它,例如時事、天氣、股價、比賽結果,或任何你不確定、可能過時的內容;平常閒聊不要每句都搜尋。搜尋回來的結果要消化過再用你的語氣自然講出來,不要整段貼網址或原始搜尋資料。`;

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

// ---------- 指令表 ----------
// 群組成員傳「/指令」開頭的訊息,直接由程式處理,不呼叫Claude(省token)

const COMMANDS = {
  '/help': async () =>
    '可用指令:\n/help - 顯示這個列表\n/reset - 清除這個群組的對話記憶\n/style 描述 - 調整這個群組的AI風格\n/style-reset - 恢復預設風格\n/nickname 新綽號 - 新增一個能叫醒我的暱稱\n/nickname-reset - 清除自訂暱稱,只留預設的',
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

async function handleEvent(bot, event) {
  if (event.type !== 'message' || event.message.type !== 'text') return null;
  if (event.replyToken === TEST_REPLY_TOKEN) return null;

  const userText = event.message.text;
  const groupId = event.source.groupId || event.source.userId;

  // 先檢查是不是指令(/開頭),是的話直接處理,不呼叫Claude API
  const parsedCommand = parseCommand(userText);
  if (parsedCommand) {
    const replyText = await parsedCommand.handler(bot.slug, groupId, parsedCommand.args);
    return bot.lineClient.replyMessage({
      replyToken: event.replyToken,
      messages: [{ type: 'text', text: replyText }],
    });
  }

  // 群組中只在提到關鍵字或自訂暱稱時才回應;1對1聊天則一律回應
  const isGroup = !!event.source.groupId;
  if (isGroup && !(await shouldRespond(bot, userText, groupId))) return null;

  await appendHistory(bot.slug, groupId, 'user', userText);
  const history = await getHistory(bot.slug, groupId);

  // 附加這個群組的自訂風格與暱稱
  const { style, nicknames } = await getGroupSettings(bot.slug, groupId);
  let systemPrompt = bot.systemPrompt;
  if (nicknames.length > 0) {
    systemPrompt += `\n\n這個群組額外幫你取的暱稱:${nicknames.join('、')},被這樣稱呼也要有反應。`;
  }
  if (style) {
    systemPrompt += `\n\n這個群組額外指定的風格調整(優先套用):\n${style}`;
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

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Listening on port ${port}`));