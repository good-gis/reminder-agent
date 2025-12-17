import { readFileSync, writeFileSync, existsSync } from 'fs';
import { Task, TasksData, TaskFilter, TaskSummary, TaskStatus, Priority } from './types.js';

export class TaskService {
  private tasksFilePath: string;
  private tasks: Task[] = [];

  constructor(tasksFilePath: string) {
    this.tasksFilePath = tasksFilePath;
    this.loadTasks();
  }

  // Загрузка задач из JSON
  private loadTasks(): void {
    if (!existsSync(this.tasksFilePath)) {
      // Создаём файл с примерами, если не существует
      this.createSampleTasks();
    }

    try {
      const data = readFileSync(this.tasksFilePath, 'utf-8');
      const tasksData: TasksData = JSON.parse(data);
      this.tasks = tasksData.tasks;
      this.updateOverdueStatus();
    } catch (error) {
      console.error('Ошибка загрузки tasks.json:', error);
      this.tasks = [];
    }
  }

  // Перезагрузка задач (для актуализации)
  public reloadTasks(): void {
    this.loadTasks();
  }

  // Обновление статуса просроченных задач
  private updateOverdueStatus(): void {
    const now = new Date();
    let hasChanges = false;

    this.tasks.forEach(task => {
      if (task.dueDate && task.status !== 'completed') {
        const dueDate = new Date(task.dueDate);
        if (dueDate < now && task.status !== 'overdue') {
          task.status = 'overdue';
          task.updatedAt = now.toISOString();
          hasChanges = true;
        }
      }
    });

    if (hasChanges) {
      this.saveTasks();
    }
  }

  // Сохранение задач
  private saveTasks(): void {
    const data: TasksData = {
      tasks: this.tasks,
      lastUpdated: new Date().toISOString()
    };
    writeFileSync(this.tasksFilePath, JSON.stringify(data, null, 2), 'utf-8');
  }

  // Создание примеров задач
  private createSampleTasks(): void {
    const now = new Date();
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const sampleTasks: Task[] = [
      {
        id: '1',
        title: 'Подготовить отчёт по проекту',
        description: 'Квартальный отчёт для руководства',
        priority: 'high',
        status: 'in_progress',
        dueDate: tomorrow.toISOString(),
        tags: ['работа', 'отчёт'],
        createdAt: now.toISOString(),
        updatedAt: now.toISOString()
      },
      {
        id: '2',
        title: 'Созвон с командой',
        description: 'Еженедельный статус-митинг',
        priority: 'medium',
        status: 'pending',
        dueDate: tomorrow.toISOString(),
        tags: ['работа', 'митинг'],
        createdAt: now.toISOString(),
        updatedAt: now.toISOString()
      },
      {
        id: '3',
        title: 'Оплатить счета',
        description: 'Коммунальные платежи',
        priority: 'high',
        status: 'pending',
        dueDate: yesterday.toISOString(),
        tags: ['личное', 'финансы'],
        createdAt: now.toISOString(),
        updatedAt: now.toISOString()
      },
      {
        id: '4',
        title: 'Изучить новый фреймворк',
        description: 'Посмотреть документацию Angular 17',
        priority: 'low',
        status: 'pending',
        dueDate: nextWeek.toISOString(),
        tags: ['обучение', 'angular'],
        createdAt: now.toISOString(),
        updatedAt: now.toISOString()
      },
      {
        id: '5',
        title: 'Code review',
        description: 'Проверить PR от коллеги',
        priority: 'critical',
        status: 'pending',
        dueDate: now.toISOString(),
        tags: ['работа', 'код'],
        createdAt: now.toISOString(),
        updatedAt: now.toISOString()
      }
    ];

    const data: TasksData = {
      tasks: sampleTasks,
      lastUpdated: now.toISOString()
    };

    writeFileSync(this.tasksFilePath, JSON.stringify(data, null, 2), 'utf-8');
    this.tasks = sampleTasks;
  }

  // Получить все задачи
  public getAllTasks(): Task[] {
    this.reloadTasks();
    return this.tasks;
  }

  // Получить задачи с фильтрами
  public getTasks(filter?: TaskFilter): Task[] {
    this.reloadTasks();
    let result = [...this.tasks];

    if (filter) {
      if (filter.status) {
        result = result.filter(t => t.status === filter.status);
      }
      if (filter.priority) {
        result = result.filter(t => t.priority === filter.priority);
      }
      if (filter.tag) {
        result = result.filter(t => t.tags?.includes(filter.tag!));
      }
      if (filter.dueBefore) {
        const before = new Date(filter.dueBefore);
        result = result.filter(t => t.dueDate && new Date(t.dueDate) <= before);
      }
      if (filter.dueAfter) {
        const after = new Date(filter.dueAfter);
        result = result.filter(t => t.dueDate && new Date(t.dueDate) >= after);
      }
    }

    return result;
  }

  // Получить задачу по ID
  public getTaskById(id: string): Task | undefined {
    this.reloadTasks();
    return this.tasks.find(t => t.id === id);
  }

  // Получить сводку по задачам
  public getSummary(): TaskSummary {
    this.reloadTasks();
    const now = new Date();
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);

    const summary: TaskSummary = {
      total: this.tasks.length,
      byStatus: {
        pending: 0,
        in_progress: 0,
        completed: 0,
        overdue: 0
      },
      byPriority: {
        low: 0,
        medium: 0,
        high: 0,
        critical: 0
      },
      overdueTasks: [],
      upcomingTasks: [],
      todayTasks: []
    };

    this.tasks.forEach(task => {
      // Подсчёт по статусу
      summary.byStatus[task.status]++;
      
      // Подсчёт по приоритету
      summary.byPriority[task.priority]++;

      // Просроченные
      if (task.status === 'overdue') {
        summary.overdueTasks.push(task);
      }

      // Задачи на сегодня
      if (task.dueDate) {
        const dueDate = new Date(task.dueDate);
        if (dueDate >= todayStart && dueDate < todayEnd && task.status !== 'completed') {
          summary.todayTasks.push(task);
        }
        // Задачи на ближайшие 24 часа
        if (dueDate >= now && dueDate <= tomorrow && task.status !== 'completed') {
          summary.upcomingTasks.push(task);
        }
      }
    });

    return summary;
  }

  // Добавить задачу
  public addTask(task: Omit<Task, 'id' | 'createdAt' | 'updatedAt'>): Task {
    const now = new Date().toISOString();
    const newTask: Task = {
      ...task,
      id: Date.now().toString(),
      createdAt: now,
      updatedAt: now
    };
    
    this.tasks.push(newTask);
    this.saveTasks();
    return newTask;
  }

  // Обновить статус задачи
  public updateTaskStatus(id: string, status: TaskStatus): Task | null {
    const task = this.tasks.find(t => t.id === id);
    if (!task) return null;

    task.status = status;
    task.updatedAt = new Date().toISOString();
    this.saveTasks();
    return task;
  }

  // Удалить задачу
  public deleteTask(id: string): boolean {
    const index = this.tasks.findIndex(t => t.id === id);
    if (index === -1) return false;

    this.tasks.splice(index, 1);
    this.saveTasks();
    return true;
  }
}
