import OpenAI from 'openai';
import { spawn, ChildProcess } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import cron from 'node-cron';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Конфигурация
const CONFIG = {
  // Интервал уведомлений (cron формат)
  // По умолчанию: каждые 30 минут
  // Можно изменить на '0 9 * * *' для ежедневного уведомления в 9:00
  REMINDER_CRON: process.env.REMINDER_CRON || '*/30 * * * *',

  // LLM конфигурация
  // Для локальной LLM (LM Studio): LLM_BASE_URL=http://127.0.0.1:1234/v1
  LLM_BASE_URL: process.env.LLM_BASE_URL || undefined, // undefined = OpenAI по умолчанию
  LLM_MODEL: process.env.LLM_MODEL || 'gpt-4o-mini',
  LLM_API_KEY: process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || 'lm-studio', // для локальной LLM можно любой

  // Путь к MCP серверу
  MCP_SERVER_PATH: join(__dirname, '../dist/mcp-server.js'),
};

// Цвета для консоли
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  red: '\x1b[31m',
};

function log(message: string, color: string = colors.reset) {
  const timestamp = new Date().toLocaleString('ru-RU');
  console.log(`${colors.cyan}[${timestamp}]${colors.reset} ${color}${message}${colors.reset}`);
}

function logHeader(message: string) {
  console.log('\n' + '═'.repeat(60));
  console.log(`${colors.bright}${colors.magenta}${message}${colors.reset}`);
  console.log('═'.repeat(60) + '\n');
}

// Класс MCP клиента для общения с сервером
class MCPClient {
  private serverProcess: ChildProcess | null = null;
  private messageId = 0;
  private pendingRequests: Map<number, { resolve: Function; reject: Function }> = new Map();
  private buffer = '';

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      log('Запуск MCP сервера...', colors.yellow);

      this.serverProcess = spawn('node', [CONFIG.MCP_SERVER_PATH], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env }
      });

      this.serverProcess.stdout?.on('data', (data) => {
        this.buffer += data.toString();
        this.processBuffer();
      });

      this.serverProcess.stderr?.on('data', (data) => {
        const message = data.toString().trim();
        if (message) {
          log(`MCP Server: ${message}`, colors.blue);
        }
      });

      this.serverProcess.on('error', (error) => {
        log(`Ошибка MCP сервера: ${error.message}`, colors.red);
        reject(error);
      });

      // Инициализация MCP протокола
      setTimeout(async () => {
        try {
          await this.initialize();
          log('MCP сервер подключен', colors.green);
          resolve();
        } catch (error) {
          reject(error);
        }
      }, 500);
    });
  }

  private processBuffer() {
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.trim()) {
        try {
          const message = JSON.parse(line);
          log(`MCP Response: ${JSON.stringify(message).substring(0, 200)}...`, colors.blue);

          if (message.id !== undefined && this.pendingRequests.has(message.id)) {
            const { resolve, reject } = this.pendingRequests.get(message.id)!;
            this.pendingRequests.delete(message.id);
            if (message.error) {
              reject(new Error(message.error.message || JSON.stringify(message.error)));
            } else {
              resolve(message.result);
            }
          }
        } catch (e) {
          // Игнорируем некорректный JSON
          log(`MCP Parse error: ${line}`, colors.red);
        }
      }
    }
  }

  private sendRequest(method: string, params?: any): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = ++this.messageId;
      const request = {
        jsonrpc: '2.0',
        id,
        method,
        params
      };

      this.pendingRequests.set(id, { resolve, reject });
      const requestStr = JSON.stringify(request);
      log(`MCP Request: ${method}`, colors.blue);
      this.serverProcess?.stdin?.write(requestStr + '\n');

      // Таймаут
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`Request timeout for method: ${method}`));
        }
      }, 10000);
    });
  }

  private async initialize(): Promise<void> {
    await this.sendRequest('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {
        tools: {}
      },
      clientInfo: {
        name: 'reminder-agent',
        version: '1.0.0'
      }
    });
    // Отправляем notification (без ожидания ответа)
    const notificationMsg = {
      jsonrpc: '2.0',
      method: 'notifications/initialized'
    };
    this.serverProcess?.stdin?.write(JSON.stringify(notificationMsg) + '\n');
  }

  async listTools(): Promise<any[]> {
    const result = await this.sendRequest('tools/list', {});
    return result.tools || [];
  }

  async callTool(name: string, args: any = {}): Promise<string> {
    const result = await this.sendRequest('tools/call', { name, arguments: args });
    return result.content?.[0]?.text || '';
  }

  disconnect(): void {
    this.serverProcess?.kill();
    this.serverProcess = null;
  }
}

// Класс агента с OpenAI-совместимым API
class ReminderAgent {
  private openai: OpenAI;
  private mcpClient: MCPClient;
  private tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [];

  constructor() {
    this.openai = new OpenAI({
      apiKey: CONFIG.LLM_API_KEY,
      baseURL: CONFIG.LLM_BASE_URL,
    });
    this.mcpClient = new MCPClient();

    if (CONFIG.LLM_BASE_URL) {
      log(`Используется LLM: ${CONFIG.LLM_BASE_URL} (модель: ${CONFIG.LLM_MODEL})`, colors.cyan);
    } else {
      log(`Используется OpenAI API (модель: ${CONFIG.LLM_MODEL})`, colors.cyan);
    }
  }

  async initialize(): Promise<void> {
    await this.mcpClient.connect();

    // Получаем список инструментов из MCP
    const mcpTools = await this.mcpClient.listTools();

    // Конвертируем в формат OpenAI
    this.tools = mcpTools.map((tool: any) => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema
      }
    }));

    log(`Загружено ${this.tools.length} инструментов`, colors.green);
  }

  async getSummary(): Promise<string> {
    const systemPrompt = `Ты - помощник по управлению задачами. У тебя есть доступ к инструментам для работы с задачами.

Твоя задача - предоставить краткую и информативную сводку по текущим задачам пользователя.

При создании сводки:
1. Сначала получи общую сводку через get_task_summary
2. Если есть просроченные или критические задачи - выдели их особо
3. Покажи задачи на сегодня
4. Дай краткие рекомендации по приоритетам

Отвечай на русском языке. Будь кратким, но информативным.`;

    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      {
        role: 'system',
        content: systemPrompt
      },
      {
        role: 'user',
        content: 'Пожалуйста, дай мне сводку по моим текущим задачам. Что срочно, что просрочено, на что обратить внимание?'
      }
    ];

    let response = await this.openai.chat.completions.create({
      model: CONFIG.LLM_MODEL,
      max_tokens: 2048,
      tools: this.tools,
      messages
    });

    // Цикл обработки tool_calls
    while (response.choices[0]?.message?.tool_calls?.length) {
      const assistantMessage = response.choices[0].message;
      messages.push(assistantMessage);

      // Обработка вызовов инструментов
      for (const toolCall of assistantMessage.tool_calls!) {
        log(`Вызов инструмента: ${toolCall.function.name}`, colors.yellow);

        let result: string;
        try {
          const args = JSON.parse(toolCall.function.arguments || '{}');
          result = await this.mcpClient.callTool(toolCall.function.name, args);
        } catch (error) {
          result = `Ошибка: ${error instanceof Error ? error.message : 'Unknown error'}`;
        }

        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: result
        });
      }

      response = await this.openai.chat.completions.create({
        model: CONFIG.LLM_MODEL,
        max_tokens: 2048,
        tools: this.tools,
        messages
      });
    }

    // Извлекаем текстовый ответ
    return response.choices[0]?.message?.content || 'Не удалось получить сводку';
  }

  async runInteractive(): Promise<void> {
    const readline = await import('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    const question = (prompt: string): Promise<string> => {
      return new Promise(resolve => rl.question(prompt, resolve));
    };

    logHeader('Интерактивный режим');
    console.log('Команды:');
    console.log('  summary - получить сводку');
    console.log('  exit    - выход');
    console.log('  Любой другой текст - отправить OpenAI\n');

    while (true) {
      const input = await question(`${colors.cyan}> ${colors.reset}`);

      if (input.toLowerCase() === 'exit') {
        break;
      }

      if (input.toLowerCase() === 'summary') {
        logHeader('Запрос сводки...');
        const summary = await this.getSummary();
        console.log(summary);
        continue;
      }

      // Отправка произвольного запроса
      logHeader('Обработка запроса...');
      const response = await this.chat(input);
      console.log(response);
    }

    rl.close();
  }

  async chat(userMessage: string): Promise<string> {
    const systemPrompt = `Ты - помощник по управлению задачами. У тебя есть доступ к инструментам для работы с задачами.
Отвечай на русском языке. Будь полезным и кратким.`;

    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage }
    ];

    let response = await this.openai.chat.completions.create({
      model: CONFIG.LLM_MODEL,
      max_tokens: 2048,
      tools: this.tools,
      messages
    });

    while (response.choices[0]?.message?.tool_calls?.length) {
      const assistantMessage = response.choices[0].message;
      messages.push(assistantMessage);

      for (const toolCall of assistantMessage.tool_calls!) {
        log(`Вызов: ${toolCall.function.name}`, colors.yellow);

        let result: string;
        try {
          const args = JSON.parse(toolCall.function.arguments || '{}');
          result = await this.mcpClient.callTool(toolCall.function.name, args);
        } catch (error) {
          result = `Ошибка: ${error instanceof Error ? error.message : 'Unknown'}`;
        }

        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: result
        });
      }

      response = await this.openai.chat.completions.create({
        model: CONFIG.LLM_MODEL,
        max_tokens: 2048,
        tools: this.tools,
        messages
      });
    }

    return response.choices[0]?.message?.content || 'Нет ответа';
  }

  disconnect(): void {
    this.mcpClient.disconnect();
  }
}

// Главная функция
async function main() {
  logHeader('🔔 Reminder Agent - Планировщик задач с OpenAI');

  // Проверка API ключа (не нужен для локальной LLM)
  if (!process.env.LLM_BASE_URL && !process.env.OPENAI_API_KEY && !process.env.LLM_API_KEY) {
    log('ОШИБКА: Не установлен API ключ', colors.red);
    console.log('\nДля OpenAI установите переменную окружения:');
    console.log('  export OPENAI_API_KEY=your-api-key-here\n');
    console.log('Для локальной LLM (LM Studio) установите:');
    console.log('  export LLM_BASE_URL=http://127.0.0.1:1234/v1');
    console.log('  export LLM_MODEL=your-model-name  # опционально\n');
    process.exit(1);
  }

  const agent = new ReminderAgent();

  try {
    await agent.initialize();

    const mode = process.argv[2] || 'daemon';

    if (mode === 'interactive' || mode === '-i') {
      // Интерактивный режим
      await agent.runInteractive();
    } else if (mode === 'once') {
      // Однократный запрос сводки
      logHeader('Сводка по задачам');
      const summary = await agent.getSummary();
      console.log(summary);
    } else {
      // Режим демона (24/7)
      logHeader(`Режим демона - уведомления по расписанию: ${CONFIG.REMINDER_CRON}`);

      // Первая сводка сразу
      log('Первоначальная сводка:', colors.magenta);
      const initialSummary = await agent.getSummary();
      console.log(initialSummary);

      // Запуск по расписанию
      cron.schedule(CONFIG.REMINDER_CRON, async () => {
        logHeader('⏰ Плановое уведомление');
        try {
          const summary = await agent.getSummary();
          console.log(summary);
        } catch (error) {
          log(`Ошибка получения сводки: ${error}`, colors.red);
        }
      });

      log('Агент работает. Нажмите Ctrl+C для остановки.', colors.green);

      // Обработка сигналов завершения
      process.on('SIGINT', () => {
        log('\nЗавершение работы...', colors.yellow);
        agent.disconnect();
        process.exit(0);
      });

      process.on('SIGTERM', () => {
        agent.disconnect();
        process.exit(0);
      });
    }
  } catch (error) {
    log(`Ошибка: ${error}`, colors.red);
    agent.disconnect();
    process.exit(1);
  }
}

main();
