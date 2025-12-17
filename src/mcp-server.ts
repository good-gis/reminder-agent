#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { TaskService } from './task-service.js';
import { TaskFilter, TaskStatus, Priority } from './types.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Путь к файлу задач
const TASKS_FILE = process.env.TASKS_FILE || join(__dirname, '..', 'data', 'tasks.json');

// Инициализация сервиса задач
const taskService = new TaskService(TASKS_FILE);

// Определение инструментов MCP
const tools: Tool[] = [
  {
    name: 'get_tasks',
    description: 'Получить список задач с возможностью фильтрации по статусу, приоритету, тегу или дате',
    inputSchema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['pending', 'in_progress', 'completed', 'overdue'],
          description: 'Фильтр по статусу задачи'
        },
        priority: {
          type: 'string',
          enum: ['low', 'medium', 'high', 'critical'],
          description: 'Фильтр по приоритету'
        },
        tag: {
          type: 'string',
          description: 'Фильтр по тегу'
        }
      }
    }
  },
  {
    name: 'get_task_summary',
    description: 'Получить сводку по всем задачам: общее количество, распределение по статусам и приоритетам, просроченные задачи, задачи на сегодня',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'get_task_by_id',
    description: 'Получить детальную информацию о конкретной задаче по её ID',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'ID задачи'
        }
      },
      required: ['id']
    }
  },
  {
    name: 'add_task',
    description: 'Добавить новую задачу',
    inputSchema: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Название задачи'
        },
        description: {
          type: 'string',
          description: 'Описание задачи'
        },
        priority: {
          type: 'string',
          enum: ['low', 'medium', 'high', 'critical'],
          description: 'Приоритет задачи'
        },
        dueDate: {
          type: 'string',
          description: 'Срок выполнения (ISO формат)'
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Теги задачи'
        }
      },
      required: ['title', 'priority']
    }
  },
  {
    name: 'update_task_status',
    description: 'Обновить статус задачи',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'ID задачи'
        },
        status: {
          type: 'string',
          enum: ['pending', 'in_progress', 'completed', 'overdue'],
          description: 'Новый статус'
        }
      },
      required: ['id', 'status']
    }
  },
  {
    name: 'delete_task',
    description: 'Удалить задачу по ID',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'ID задачи для удаления'
        }
      },
      required: ['id']
    }
  },
  {
    name: 'get_overdue_tasks',
    description: 'Получить список просроченных задач',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'get_today_tasks',
    description: 'Получить задачи на сегодня',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  }
];

// Создание MCP сервера
const server = new Server(
  {
    name: 'reminder-mcp-server',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Обработчик списка инструментов
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools };
});

// Обработчик вызова инструментов
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'get_tasks': {
        const filter: TaskFilter = {};
        if (args?.status) filter.status = args.status as TaskStatus;
        if (args?.priority) filter.priority = args.priority as Priority;
        if (args?.tag) filter.tag = args.tag as string;
        
        const tasks = taskService.getTasks(filter);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(tasks, null, 2)
            }
          ]
        };
      }

      case 'get_task_summary': {
        const summary = taskService.getSummary();
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(summary, null, 2)
            }
          ]
        };
      }

      case 'get_task_by_id': {
        const task = taskService.getTaskById(args?.id as string);
        if (!task) {
          return {
            content: [{ type: 'text', text: 'Задача не найдена' }],
            isError: true
          };
        }
        return {
          content: [{ type: 'text', text: JSON.stringify(task, null, 2) }]
        };
      }

      case 'add_task': {
        const newTask = taskService.addTask({
          title: args?.title as string,
          description: args?.description as string,
          priority: (args?.priority || 'medium') as Priority,
          status: 'pending',
          dueDate: args?.dueDate as string,
          tags: args?.tags as string[]
        });
        return {
          content: [
            {
              type: 'text',
              text: `Задача создана:\n${JSON.stringify(newTask, null, 2)}`
            }
          ]
        };
      }

      case 'update_task_status': {
        const updated = taskService.updateTaskStatus(
          args?.id as string,
          args?.status as TaskStatus
        );
        if (!updated) {
          return {
            content: [{ type: 'text', text: 'Задача не найдена' }],
            isError: true
          };
        }
        return {
          content: [
            {
              type: 'text',
              text: `Статус обновлён:\n${JSON.stringify(updated, null, 2)}`
            }
          ]
        };
      }

      case 'delete_task': {
        const deleted = taskService.deleteTask(args?.id as string);
        return {
          content: [
            {
              type: 'text',
              text: deleted ? 'Задача удалена' : 'Задача не найдена'
            }
          ],
          isError: !deleted
        };
      }

      case 'get_overdue_tasks': {
        const summary = taskService.getSummary();
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(summary.overdueTasks, null, 2)
            }
          ]
        };
      }

      case 'get_today_tasks': {
        const summary = taskService.getSummary();
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(summary.todayTasks, null, 2)
            }
          ]
        };
      }

      default:
        return {
          content: [{ type: 'text', text: `Неизвестный инструмент: ${name}` }],
          isError: true
        };
    }
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: `Ошибка: ${error instanceof Error ? error.message : 'Неизвестная ошибка'}`
        }
      ],
      isError: true
    };
  }
});

// Запуск сервера
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Reminder MCP Server запущен');
}

main().catch(console.error);
